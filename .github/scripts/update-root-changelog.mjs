#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT_CHANGELOG = 'CHANGELOG.md';
const PACKAGE_CHANGELOG_RE = /^packages\/[^/]+\/CHANGELOG\.md$/;

const changed = git(['diff', '--name-only', '--', 'packages/*/CHANGELOG.md'])
  .split('\n')
  .filter((file) => PACKAGE_CHANGELOG_RE.test(file));

const releases = (await Promise.all(changed.map(readRelease))).filter(Boolean);
if (releases.length === 0) {
  console.log('No package release sections found; root changelog unchanged.');
  process.exit(0);
}

releases.sort((a, b) => a.name.localeCompare(b.name));

const versions = new Set(releases.map((release) => release.version));
if (versions.size !== 1) throw new Error(`Expected one release version, found: ${[...versions].join(', ')}`);

const version = [...versions][0];
const root = await readFile(ROOT_CHANGELOG, 'utf8');
const rootPackage = JSON.parse(await readFile('package.json', 'utf8'));
const section = renderSection({
  version,
  previousVersion: previousRootVersion(root, version),
  repo: repoSlug(rootPackage),
  groups: groupByBody(releases),
});

await writeFile(ROOT_CHANGELOG, upsertSection(root, version, section));
console.log(`Updated ${ROOT_CHANGELOG} for ${version}.`);

async function readRelease(changelogPath) {
  const before = topRelease(gitShow(`HEAD:${changelogPath}`));
  const after = topRelease(await readFile(changelogPath, 'utf8'));
  if (!after || after.heading === before?.heading) return null;

  const body = rootBody(after.body);
  if (!body) return null;

  const packageJson = JSON.parse(await readFile(path.join(path.dirname(changelogPath), 'package.json'), 'utf8'));
  return { name: packageJson.name, version: packageJson.version, body };
}

function rootBody(body) {
  return body
    .replace(/^- Updated dependencies.*:\n(?:  - .+\n?)+/gm, '')
    .replace(/^All notable changes to this project will be documented in this file\.\n?/gm, '')
    .replace(/^See \[Conventional Commits\]\(https:\/\/conventionalcommits\.org\) for commit guidelines\.\n?/gm, '')
    .replace(/^### /gm, '#### ')
    .split(/(?=^#### )/m)
    .map((block) => block.trim())
    .filter((block) => block && !/^#### .+$/.test(block))
    .join('\n\n');
}

function topRelease(markdown) {
  const heading = /^##\s+.+$/m.exec(markdown);
  if (!heading) return null;
  const start = heading.index + heading[0].length;
  const next = /^##\s+.+$/m.exec(markdown.slice(start));
  const end = next ? start + next.index : markdown.length;
  return { heading: heading[0].trim(), body: markdown.slice(start, end).trim() };
}

function groupByBody(releases) {
  return [...releases.reduce((groups, release) => {
    const group = groups.get(release.body) ?? { names: [], body: release.body };
    group.names.push(release.name);
    return groups.set(release.body, group);
  }, new Map()).values()];
}

function renderSection({ version, previousVersion, repo, groups }) {
  const date = new Date().toISOString().slice(0, 10);
  const link = previousVersion
    ? `https://github.com/${repo}/compare/v${previousVersion}...v${version}`
    : `https://github.com/${repo}/releases/tag/v${version}`;
  const packages = groups
    .map(({ names, body }) => `### ${names.join(', ')}\n\n${body}`)
    .join('\n\n');
  return `## [${version}](${link}) (${date})\n\n${packages}\n\n`;
}

function upsertSection(markdown, version, section) {
  const existing = new RegExp(`^## \\[${escapeRegExp(version)}\\][\\s\\S]*?(?=^##\\s+)`, 'm');
  if (existing.test(markdown)) return markdown.replace(existing, section);

  const firstRelease = /^##\s+/m.exec(markdown);
  if (!firstRelease) return `${markdown.trimEnd()}\n\n${section}`;
  return `${markdown.slice(0, firstRelease.index)}${section}${markdown.slice(firstRelease.index)}`;
}

function previousRootVersion(markdown, currentVersion) {
  return [...markdown.matchAll(/^##\s+\[?([0-9]+\.[0-9]+\.[0-9][^\]\s]*)\]?/gm)]
    .map((match) => match[1])
    .find((version) => version !== currentVersion);
}

function repoSlug(packageJson) {
  return (packageJson.repository?.url ?? 'https://github.com/stx-labs/stacks.js.git')
    .replace(/^git\+/, '')
    .replace(/^https:\/\/github\.com\//, '')
    .replace(/^git@github\.com:/, '')
    .replace(/\.git$/, '');
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function gitShow(ref) {
  try {
    return execFileSync('git', ['show', ref], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
