#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT_CHANGELOG = 'CHANGELOG.md';
const PACKAGE_CHANGELOG_RE = /^packages\/[^/]+\/CHANGELOG\.md$/;

const changedChangelogs = git(['diff', '--name-only', '--', 'packages/*/CHANGELOG.md'])
  .split('\n')
  .filter((file) => PACKAGE_CHANGELOG_RE.test(file));

if (changedChangelogs.length === 0) {
  console.log('No package changelog changes found; root changelog unchanged.');
  process.exit(0);
}

const packages = (
  await Promise.all(
    changedChangelogs.map(async (changelogPath) => {
      const packageDir = path.dirname(changelogPath);
      const packageJson = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'));
      const section = extractTopReleaseSection(await readFile(changelogPath, 'utf8'));
      if (!section) return null;
      const normalized = normalizePackageSection(section.body);
      if (!normalized) return null;
      return {
        name: packageJson.name,
        version: packageJson.version,
        section: normalized,
      };
    }),
  )
).filter(Boolean);

if (packages.length === 0) {
  console.log('No package release sections found; root changelog unchanged.');
  process.exit(0);
}

packages.sort((a, b) => a.name.localeCompare(b.name));

const version = packages[0].version;
const root = await readFile(ROOT_CHANGELOG, 'utf8');
const previousVersion = extractPreviousRootVersion(root, version);
const repo = getRepoSlug(JSON.parse(await readFile('package.json', 'utf8')));
const releaseSection = renderReleaseSection({ version, previousVersion, repo, groups: groupPackages(packages) });

await writeFile(ROOT_CHANGELOG, upsertReleaseSection(root, version, releaseSection));
console.log(`Updated ${ROOT_CHANGELOG} for ${version}.`);

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function extractTopReleaseSection(markdown) {
  const heading = /^##\s+(.+)$/m.exec(markdown);
  if (!heading) return null;
  const start = heading.index;
  const restStart = start + heading[0].length;
  const next = /^##\s+.+$/m.exec(markdown.slice(restStart));
  const end = next ? restStart + next.index : markdown.length;
  return {
    heading: heading[1].trim(),
    body: markdown.slice(restStart, end).trim(),
  };
}

function normalizePackageSection(section) {
  const cleaned = section
    .replace(/^### /gm, '#### ')
    .replace(/^-\s+Updated dependencies \[\]:/gm, '- Updated dependencies:')
    .replace(/^All notable changes to this project will be documented in this file\.\n?/gm, '')
    .replace(/^See \[Conventional Commits\]\(https:\/\/conventionalcommits\.org\) for commit guidelines\.\n?/gm, '')
    .trim();
  return removeEmptyHeadings(removeUpdatedDependencies(cleaned));
}

function removeUpdatedDependencies(section) {
  const lines = section.split('\n');
  const kept = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === '- Updated dependencies:') {
      while (lines[i + 1]?.startsWith('  - ')) i += 1;
      continue;
    }
    kept.push(lines[i]);
  }

  return kept.join('\n').trim();
}

function removeEmptyHeadings(section) {
  const lines = section.split('\n');
  const blocks = [];
  let activeHeading = null;
  let activeLines = [];

  const flush = () => {
    if (activeHeading && activeLines.join('\n').trim()) {
      blocks.push([activeHeading, '', ...trimBlankEdges(activeLines)].join('\n'));
    } else if (!activeHeading && activeLines.join('\n').trim()) {
      blocks.push(trimBlankEdges(activeLines).join('\n'));
    }
  };

  for (const line of lines) {
    if (line.startsWith('#### ')) {
      flush();
      activeHeading = line;
      activeLines = [];
    } else {
      activeLines.push(line);
    }
  }
  flush();

  return blocks.join('\n\n').trim();
}

function trimBlankEdges(lines) {
  const copy = [...lines];
  while (copy[0] === '') copy.shift();
  while (copy.at(-1) === '') copy.pop();
  return copy;
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
