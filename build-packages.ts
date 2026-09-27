#!/usr/bin/env tsx

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

const ORIGINAL_DIR = process.cwd();
const PACKAGES_DIR = path.resolve(ORIGINAL_DIR, 'packages');

// Get all package directories
const packages = fs.readdirSync(PACKAGES_DIR).filter(item => {
  const itemPath = path.join(PACKAGES_DIR, item);
  return fs.statSync(itemPath).isDirectory() && !item.startsWith('.');
});

// console.debug(`Found ${packages.length} packages to process`);

const NPM_VERSION_TAG = (process.env.NPM_VERSION_TAG || 'latest').replace(/^v/, '');

// Process all packages
const results = packages
  .map(dir => {
    const json = path.join(PACKAGES_DIR, dir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(json, 'utf8'));

    if (pkg.private === true) {
      // console.debug(`Skipping package: ${pkg.name}`);
      return null;
    }

    // console.debug(`\nProcessing package: ${pkg.name}`);
    process.chdir(path.join(PACKAGES_DIR, dir));

    // Run npm publish dry-run
    const result = spawnSync('npm', ['publish', '--dry-run'], { encoding: 'utf8' });
    const output = `${result.stdout}\n${result.stderr}`;

    // Extract values using inline functions
    const shasum = extractFromOutput(output, /npm notice shasum:\s+([a-f0-9]{40})/);
    const integrity = extractFromOutput(
      output,
      /npm notice integrity:\s+(sha\d+-[A-Za-z0-9+/=]+(?:\[\.\.\.\][A-Za-z0-9+/=]*==?)?)/
    );

    // console.debug(`  Package: ${pkg.name}`);
    // console.debug(`  Tarball hash: ${integrity}`);
    // console.debug(`  Shasum: ${shasum}`);

    const registryUrl = `https://registry.npmjs.org/${pkg.name}/${NPM_VERSION_TAG}`;
    const registryCheck = spawnSync('curl', [registryUrl], {
      encoding: 'utf8',
    });
    const registryData = JSON.parse(registryCheck.stdout);
    const registryShasum = registryData.dist?.shasum;

    return {
      name: pkg.name,
      tarballHash: integrity,
      shasum,
      differs: registryShasum === shasum,
    };
  })
  .filter(Boolean) as (PackageInfo & { differs: boolean })[];

// Restore original directory
process.chdir(ORIGINAL_DIR);

// Output final results
// console.debug('\n=== PACKAGE BUILD RESULTS ===');
// console.debug(results);

// Output JSON array of differing packages
const differingPackages = results.filter(r => r.differs).map(r => r.name);
console.log(JSON.stringify(differingPackages));

// HELPERS
function extractFromOutput(output: string, regex: RegExp): string {
  return (
    output
      .split('\n')
      .map(line => line.match(regex)?.[1])
      .find(Boolean) || 'Not found'
  );
}

interface PackageInfo {
  name: string;
  tarballHash: string;
  shasum: string;
}
