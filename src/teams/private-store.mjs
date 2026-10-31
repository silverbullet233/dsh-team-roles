/** Private metadata storage. It retains correlations, never execution queues. */
import { constants } from 'node:fs';
import { mkdir, lstat, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { TeamError } from './errors.mjs';

export function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Existing paths must already belong only to the current UID. */
export async function privateDirectory(directory) {
  const path = resolve(directory);
  await mkdir(path, { mode: 0o700, recursive: true });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.()
    || (info.mode & 0o077) !== 0) {
    throw new TeamError('UNSAFE_DIRECTORY', 'Managed-Team directory must be a non-symlink directory owned by this UID with mode 0700.');
  }
  return path;
}

/** Atomic replacement includes file and directory durability barriers. */
export async function durableWrite(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
  const directory = await open(resolve(path, '..'), constants.O_RDONLY);
  try { await directory.sync(); } finally { await directory.close(); }
}

/** One native host owns this metadata writer. A dead PID may be reclaimed. */
export class TeamStore {
  constructor(directory) { this.directory = directory; this.lock = undefined; }

  async open() {
    this.directory = await privateDirectory(this.directory);
    const path = join(this.directory, 'writer.json');
    const record = { pid: process.pid, nonce: randomUUID() };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try { await handle.writeFile(JSON.stringify(record)); await handle.sync(); } finally { await handle.close(); }
        this.lock = record;
        return this;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const recoveryPath = join(this.directory, 'recovery.lock');
        let recovery;
        try { recovery = await open(recoveryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
        catch (claim) { if (claim.code === 'EEXIST') throw new TeamError('WRITER_HELD', 'Another process is inspecting the metadata writer; retry after it finishes.'); throw claim; }
        try {
          const prior = JSON.parse(await readFile(path, 'utf8'));
          if (!Number.isSafeInteger(prior.pid) || prior.pid < 1) throw new TeamError('WRITER_HELD', 'Metadata writer lock is invalid; inspect it manually.');
          let stopped = false;
          try { process.kill(prior.pid, 0); }
          catch (probe) {
            if (probe.code === 'ESRCH') stopped = true;
            else throw new TeamError('WRITER_HELD', 'Cannot establish that the existing metadata writer has stopped.');
          }
          if (stopped && attempt === 0) { await unlink(path); continue; }
          throw new TeamError('WRITER_HELD', 'A live process already owns this managed-Team metadata directory.');
        } finally { await recovery.close(); await unlink(recoveryPath); }
      }
    }
    throw new TeamError('WRITER_HELD', 'Could not acquire the metadata writer lock.');
  }

  path(kind, key) { return join(this.directory, `${kind}-${digest(key)}.json`); }

  async get(kind, key) {
    const path = this.path(kind, key);
    try {
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) {
          throw new TeamError('UNSAFE_METADATA', 'Metadata file owner or permissions are invalid.');
        }
        const value = JSON.parse(await handle.readFile('utf8'));
        if (value?.version !== 1) throw new TeamError('INVALID_METADATA', 'Unsupported metadata version.');
        return value;
      } finally { await handle.close(); }
    } catch (error) {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async list(kind) {
    const names = (await readdir(this.directory)).filter(name => name.startsWith(`${kind}-`) && name.endsWith('.json'));
    return Promise.all(names.map(async name => {
      const file = await open(join(this.directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await file.stat();
        if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) throw new TeamError('UNSAFE_METADATA', 'Metadata permissions are invalid.');
        const value = JSON.parse(await file.readFile('utf8'));
        if (value.version !== 1) throw new TeamError('INVALID_METADATA', 'Unsupported metadata version.');
        return value;
      } finally { await file.close(); }
    }));
  }

  set(kind, key, value) { return durableWrite(this.path(kind, key), { ...value, version: 1 }); }

  async close() {
    if (this.lock === undefined) return;
    const path = join(this.directory, 'writer.json');
    const current = JSON.parse(await readFile(path, 'utf8'));
    if (current.nonce === this.lock.nonce) await unlink(path);
    this.lock = undefined;
  }
}
