#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT_CHANGELOG = 'CHANGELOG.md';
const PACKAGE_CHANGELOG_RE = /^packages\/[^/]+\/CHANGELOG\.md$/;

const changedChangelogs = changedPackageChangelogs();

if (changedChangelogs.length === 0) {
  console.log('No package changelog changes found; root changelog unchanged.');
  process.exit(0);
}

await normalizePackageChangelogs(changedChangelogs);

const packages = (await Promise.all(changedChangelogs.map(readPackageRelease))).filter(Boolean);

if (packages.length === 0) {
  console.log('No package release sections found; root changelog unchanged.');
  process.exit(0);
}

packages.sort((a, b) => a.name.localeCompare(b.name));

const versions = new Set(packages.map((pkg) => pkg.version));
if (versions.size !== 1) throw new Error(`Expected one release version, found: ${[...versions].join(', ')}`);

const version = [...versions][0];
const root = await readFile(ROOT_CHANGELOG, 'utf8');
const previousVersion = extractPreviousRootVersion(root, version);
const repo = getRepoSlug(JSON.parse(await readFile('package.json', 'utf8')));
const releaseSection = renderReleaseSection({ version, previousVersion, repo, groups: groupPackages(packages) });

await writeFile(ROOT_CHANGELOG, upsertReleaseSection(root, version, releaseSection));
console.log(`Updated ${ROOT_CHANGELOG} for ${version}.`);

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function changedPackageChangelogs() {
  return git(['diff', '--name-only', '--', 'packages/*/CHANGELOG.md'])
    .split('\n')
    .filter((file) => PACKAGE_CHANGELOG_RE.test(file));
}

async function readPackageRelease(changelogPath) {
  const packageDir = path.dirname(changelogPath);
  const packageJson = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'));
  const body = extractTopReleaseBody(await readFile(changelogPath, 'utf8'));
  const section = body && normalizePackageSection(body);
  return section ? { name: packageJson.name, version: packageJson.version, section } : null;
}

async function normalizePackageChangelogs(changelogPaths) {
  await Promise.all(
    changelogPaths.map(async (changelogPath) => {
      const packageDir = path.dirname(changelogPath);
      const markdown = await readFile(changelogPath, 'utf8');
      const next = replaceTopReleaseBody(markdown, (body) =>
        normalizePersistedPackageSection(body),
      );
      if (next !== markdown) await writeFile(changelogPath, next);
    }),
  );
}

function extractTopReleaseBody(markdown) {
  const heading = /^##\s+.+$/m.exec(markdown);
  if (!heading) return null;
  const restStart = heading.index + heading[0].length;
  const next = /^##\s+.+$/m.exec(markdown.slice(restStart));
  const end = next ? restStart + next.index : markdown.length;
  return markdown.slice(restStart, end).trim();
}

function replaceTopReleaseBody(markdown, transform) {
  const heading = /^##\s+.+$/m.exec(markdown);
  if (!heading) return markdown;
  const bodyStart = heading.index + heading[0].length;
  const nextHeading = /^##\s+.+$/m.exec(markdown.slice(bodyStart));
  const bodyEnd = nextHeading ? bodyStart + nextHeading.index : markdown.length;
  const body = markdown.slice(bodyStart, bodyEnd).trim();
  const nextBody = transform(body).trim();
  return `${markdown.slice(0, bodyStart)}\n\n${nextBody}\n\n${markdown.slice(bodyEnd).replace(/^\n+/, '')}`;
}

function normalizePersistedPackageSection(section) {
  const cleaned = stripBoilerplate(section);
  const withoutDeps = stripDependencyBlocks(cleaned, '');
  if (withoutDeps.changed && !compactReleaseSection(withoutDeps.section)) {
    return '**Note:** Updated sibling dependencies only.';
  }

  const compactDeps = stripDependencyBlocks(cleaned, '- Updated internal dependencies.\n').section;
  return compactReleaseSection(
    compactDeps.replace(/^\*\*Note:\*\* Version bump only for package .+$/gm, '**Note:** Updated sibling dependencies only.'),
    { headingLevel: 3 },
  );
}

function normalizePackageSection(section) {
  return compactReleaseSection(
    stripDependencyBlocks(stripBoilerplate(section), '').section
      .replace(/^\*\*Note:\*\* Version bump only for package .+\n?/gm, '')
      .replace(/^\*\*Note:\*\* Updated sibling dependencies only\.\n?/gm, '')
      .replace(/^- Updated internal dependencies\.\n?/gm, ''),
    { headingLevel: 4 },
  );
}

function stripBoilerplate(section) {
  return section
    .replace(/^All notable changes to this project will be documented in this file\.\n?/gm, '')
    .replace(/^See \[Conventional Commits\]\(https:\/\/conventionalcommits\.org\) for commit guidelines\.\n?/gm, '');
}

function stripDependencyBlocks(section, replacement) {
  let changed = false;
  const next = section.replace(/^- Updated dependencies.*:\n(?:  - .+\n?)+/gm, () => {
    changed = true;
    return replacement;
  });
  return { section: next, changed };
}

function compactReleaseSection(section, { headingLevel }) {
  const heading = '#'.repeat(headingLevel);
  return section
    .replace(/^#{3,4} /gm, `${heading} `)
    .split(new RegExp(`(?=^${heading} )`, 'm'))
    .map((block) => block.trim())
    .filter((block) => block && !new RegExp(`^${heading} .+$`).test(block))
    .join('\n\n');
}

function groupPackages(packages) {
  const groups = new Map();
  for (const pkg of packages) {
    const group = groups.get(pkg.section) ?? { names: [], section: pkg.section };
    group.names.push(pkg.name);
    groups.set(pkg.section, group);
  }
  return [...groups.values()];
}

function extractPreviousRootVersion(markdown, currentVersion) {
  const headings = [...markdown.matchAll(/^##\s+\[?([0-9]+\.[0-9]+\.[0-9][^\]\s]*)\]?/gm)];
  return headings.map((match) => match[1]).find((version) => version !== currentVersion) ?? null;
}

function getRepoSlug(packageJson) {
  const raw = packageJson.repository?.url ?? 'https://github.com/stx-labs/stacks.js.git';
  return raw
    .replace(/^git\+/, '')
    .replace(/^https:\/\/github\.com\//, '')
    .replace(/^git@github\.com:/, '')
    .replace(/\.git$/, '');
}

function renderReleaseSection({ version, previousVersion, repo, groups }) {
  const compare =
    previousVersion && previousVersion !== version
      ? `https://github.com/${repo}/compare/v${previousVersion}...v${version}`
      : `https://github.com/${repo}/releases/tag/v${version}`;
  const date = new Date().toISOString().slice(0, 10);
  const packageSections = groups
    .map(({ names, section }) => `### ${names.join(', ')}\n\n${section}`)
    .join('\n\n');
  return `## [${version}](${compare}) (${date})\n\n${packageSections}\n\n`;
}

function upsertReleaseSection(markdown, version, releaseSection) {
  const existing = new RegExp(`^## \\[${escapeRegExp(version)}\\][\\s\\S]*?(?=^##\\s+)`, 'm');
  if (existing.test(markdown)) return markdown.replace(existing, releaseSection);

  const firstRelease = /^##\s+/m.exec(markdown);
  if (!firstRelease) return `${markdown.trimEnd()}\n\n${releaseSection}`;

  return `${markdown.slice(0, firstRelease.index)}${releaseSection}${markdown.slice(firstRelease.index)}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
