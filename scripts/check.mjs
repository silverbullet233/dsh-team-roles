import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
async function files(root) {
  const entries = await readdir(root, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(root, entry.name)) : join(root, entry.name)))).flat();
}
for (const root of ['src', 'scripts', 'test']) for (const file of await files(root)) {
  if (!file.endsWith('.mjs')) continue;
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('ESM syntax checks passed.');
