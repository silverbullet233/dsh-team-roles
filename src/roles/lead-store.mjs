/** Small pre-Session role reservation store; it owns no execution or scheduling state. */
import { open, mkdir, lstat, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { inputDigest, text } from './config.mjs';
import { parseBinding } from './state.mjs';

/** Persist immutable Lead snapshots before native session creation begins. */
export class LeadStore {
  constructor(stateDirectory) {
    this.directory = join(stateDirectory, 'role-leads');
    this.tail = Promise.resolve();
  }

  path(sessionId) { return join(this.directory, `${inputDigest(text(sessionId, 'sessionId'))}.json`); }

  async prepare() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const stats = await lstat(this.directory);
    if (!stats.isDirectory() || stats.isSymbolicLink() || stats.uid !== process.getuid() || (stats.mode & 0o077) !== 0) {
      throw new Error('role reservation directory must be owned by the current UID with mode 0700');
    }
  }

  async read(sessionId) {
    let handle;
    try { handle = await open(this.path(sessionId), constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    let data;
    try {
      const stats = await handle.stat();
      if (!stats.isFile() || stats.uid !== process.getuid() || (stats.mode & 0o077) !== 0) throw new Error('Lead role reservation must be a current-UID private file');
      data = await handle.readFile('utf8');
    } finally { await handle.close(); }
    const value = JSON.parse(data);
    if (value.version !== 1 || value.sessionId !== sessionId) throw new Error('invalid Lead role reservation');
    return parseBinding(value.binding);
  }

  async reserve(sessionId, snapshot) {
    const operation = this.tail.then(async () => {
      await this.prepare();
      const old = await this.read(sessionId);
      if (old !== null) {
        if (old.role !== snapshot.role) throw new Error('Lead role conflicts with the durable reservation');
        return old;
      }
      const binding = parseBinding({ name: 'lead', ...snapshot, inputDigest: inputDigest({ sessionId, role: snapshot.role }), memberId: sessionId });
      const temporary = join(this.directory, `.${randomUUID()}.tmp`);
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(`${JSON.stringify({ version: 1, sessionId, binding })}\n`);
        await handle.sync();
      } finally { await handle.close(); }
      try { await rename(temporary, this.path(sessionId)); }
      catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
      const directory = await open(this.directory, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
      return binding;
    });
    this.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }
}
