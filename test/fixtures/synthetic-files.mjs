import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const allowedReads = new Set(['nonce.txt', 'left.txt', 'right.txt', 'left-result.txt', 'right-result.txt']);
const allowedWrites = new Set(['left-result.txt', 'right-result.txt']);

/** Two bounded fixture operations over an isolated synthetic directory. */
export async function syntheticFiles(directory) {
  const requested = resolve(directory);
  await mkdir(requested, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(requested);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Synthetic fixture root must not be a symlink.');
  const root = await realpath(requested);
  const checked = async (name, allowlist) => {
    if (typeof name !== 'string' || !allowlist.has(name)) throw new Error('Fixture file is not allowlisted.');
    if (await realpath(root) !== root) throw new Error('Synthetic fixture root changed.');
    const path = join(root, name);
    try { if ((await lstat(path)).isSymbolicLink()) throw new Error('Fixture symlinks are forbidden.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return path;
  };
  return {
    async read(name) {
      const path = await checked(name, allowedReads);
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await file.stat();
        if (!info.isFile() || info.nlink !== 1 || info.size > 256) throw new Error('Fixture file must be regular, unlinked elsewhere and at most 256 bytes.');
        return await file.readFile('utf8');
      } finally { await file.close(); }
    },
    async write(name, text) {
      if (typeof text !== 'string' || Buffer.byteLength(text) > 256) throw new Error('Fixture output must be text of at most 256 bytes.');
      const path = await checked(name, allowedWrites);
      const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
      try {
        const info = await file.stat();
        if (!info.isFile() || info.nlink !== 1) throw new Error('Fixture output must be regular and unlinked elsewhere.');
        await file.truncate(0);
        await file.writeFile(text);
        await file.sync();
      }
      finally { await file.close(); }
      return { name, bytes: Buffer.byteLength(text) };
    },
  };
}
