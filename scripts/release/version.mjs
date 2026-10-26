import { readFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export function releaseVersion(pkg, tag) {
  if (pkg.name !== 'dsh-team-roles' || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(pkg.version)) throw new Error('Release requires a valid dsh-team-roles package version');
  if (tag !== undefined && tag !== `v${pkg.version}`) throw new Error(`Tag must be v${pkg.version} to match package.json`);
  return { version: pkg.version, tag: `v${pkg.version}`, tarball: `${pkg.name}-${pkg.version}.tgz` };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const value = releaseVersion(JSON.parse(await readFile('package.json', 'utf8')), process.env.RELEASE_TAG || undefined);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, Object.entries(value).map(([key, value]) => `${key}=${value}\n`).join(''));
  console.log(JSON.stringify(value));
}
