#!/usr/bin/env node
// Rewrite packages/*/package.json to a snapshot version like
// `<base>-<tag>.<counter>` (or `<base>-pr.<num>.<counter>`). Run between
// `changeset version` and `changeset publish --tag <tag>`.
//
// Usage: node .github/scripts/snapshot-version.mjs <tag> [--pr <number>]
//   <tag>      lowercase npm dist-tag (e.g. beta, next). Becomes the suffix
//              before the counter: `<base>-<tag>.<N>`.
//   --pr <n>   required only when <tag> is "pr"; produces `<base>-pr.<n>.<N>`.

import { readFile, writeFile, readdir, appendFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const [tag, , prNumber] = process.argv.slice(2);
const isWord = /^[a-z][a-z0-9]*$/.test(tag || '');
if (!isWord || (tag === 'pr' && !prNumber)) {
  console.error('Usage: snapshot-version.mjs <tag> [--pr <number>]   (tag must be a lowercase word; --pr is required when tag is "pr")');
  process.exit(1);
}

const DEP_TYPES = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

const entries = await readdir('packages', { withFileTypes: true });
const pkgs = (await Promise.all(
  entries
    .filter((e) => e.isDirectory())
    .map((e) => `packages/${e.name}/package.json`)
    .map(async (file) => {
      try { return { file, json: JSON.parse(await readFile(file, 'utf8')) }; }
      catch { return null; }
    }),
)).filter(Boolean);

const rep = pkgs.find(({ json }) => json.name && !json.private && /^\d+\.\d+\.\d+$/.test(json.version));
if (!rep) {
  console.error('No non-private workspace package with plain semver — did you run `changeset version` first?');
  process.exit(1);
}

const prefix = tag === 'pr' ? `${rep.json.version}-pr.${prNumber}.` : `${rep.json.version}-${tag}.`;
const version = `${prefix}${nextCounter(rep.json.name, prefix)}`;
console.log(`Snapshot version: ${version} (base from ${rep.json.name})`);

const internals = new Set(pkgs.map(({ json }) => json.name).filter(Boolean));
const named = pkgs.filter(({ json }) => json.name);

await Promise.all(named.map(({ file, json }) =>
  writeFile(file, JSON.stringify(rewrite(json, version, internals), null, 2) + '\n'),
));
named.forEach(({ json }) => console.log(`  ${json.name} → ${version}`));

if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\n`);

function rewrite(json, version, internals) {
  const rewriteDeps = (deps) =>
    Object.fromEntries(Object.entries(deps).map(([n, v]) => [n, internals.has(n) ? version : v]));
  return DEP_TYPES.reduce(
    (acc, dt) => (acc[dt] ? { ...acc, [dt]: rewriteDeps(acc[dt]) } : acc),
    { ...json, version },
  );
}

function nextCounter(name, prefix) {
  let raw;
  try {
    raw = execFileSync('npm', ['view', name, 'versions', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    if ((e.stderr || '').includes('E404')) return 0;
    throw e;
  }
  const all = JSON.parse(raw);
  const counters = (Array.isArray(all) ? all : [all])
    .filter((v) => v.startsWith(prefix))
    .map((v) => Number(v.slice(prefix.length)))
    .filter(Number.isInteger);
  return counters.length ? Math.max(...counters) + 1 : 0;
}
