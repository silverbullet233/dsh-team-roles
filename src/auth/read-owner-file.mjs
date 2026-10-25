/** Bounded credential reads that reject symlinks, foreign ownership and permissive files. */
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, normalize } from 'node:path';

/** A credential operation failed before any caller could receive an untrusted value. */
export class ReadOnlyCredentialError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReadOnlyCredentialError';
    this.code = code;
  }
}

/** Resolve an explicit native store path without reading ambient environment files. */
export function resolveReadOnlyConfig(config) {
  if (!config || typeof config.path !== 'string' || !isAbsolute(config.path) || normalize(config.path) !== config.path) {
    throw new ReadOnlyCredentialError('credentials/invalid-path', 'An explicit normalized absolute native credential path is required.');
  }
  const maxDocumentBytes = config.maxDocumentBytes ?? 1_048_576;
  if (!Number.isSafeInteger(maxDocumentBytes) || maxDocumentBytes < 1 || maxDocumentBytes > 67_108_864) {
    throw new ReadOnlyCredentialError('credentials/invalid-limit', 'maxDocumentBytes must be an integer between 1 and 67108864.');
  }
  return Object.freeze({ path: config.path, maxDocumentBytes });
}

function assertFile(metadata) {
  if (!metadata.isFile()) throw new ReadOnlyCredentialError('credentials/not-regular', 'The native credential store must be a regular file.');
  if (typeof process.getuid !== 'function' || metadata.uid !== process.getuid()) {
    throw new ReadOnlyCredentialError('credentials/foreign-owner', 'The native credential store must belong to the current OS user.');
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new ReadOnlyCredentialError('credentials/unsafe-mode', 'The native credential store must have owner-only permissions.');
  }
}

/** Read one complete stable UTF-8 document; never create, migrate or watch it. */
export async function readOwnerFile(config) {
  const spec = resolveReadOnlyConfig(config);
  let before;
  try { before = await lstat(spec.path); }
  catch (error) {
    if (error.code === 'ENOENT') throw new ReadOnlyCredentialError('credentials/missing-store', 'The existing native credential store is missing.');
    throw new ReadOnlyCredentialError('credentials/read-failed', 'The existing native credential store cannot be inspected.');
  }
  if (before.isSymbolicLink()) throw new ReadOnlyCredentialError('credentials/symlink', 'Symlink credential stores are refused.');
  assertFile(before);
  let canonical;
  try { canonical = await realpath(spec.path); }
  catch (error) { throw new ReadOnlyCredentialError('credentials/read-failed', 'The existing native credential path cannot be resolved.'); }
  if (canonical !== spec.path) throw new ReadOnlyCredentialError('credentials/symlink', 'The credential path must not traverse symlinks.');
  let handle;
  try { handle = await open(spec.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { throw new ReadOnlyCredentialError('credentials/read-failed', 'The existing native credential store cannot be opened read-only.'); }
  try {
    const admitted = await handle.stat();
    assertFile(admitted);
    if (admitted.ino !== before.ino || admitted.dev !== before.dev) {
      throw new ReadOnlyCredentialError('credentials/store-changed', 'The credential store changed during admission; retry the read.');
    }
    if (admitted.size > spec.maxDocumentBytes) throw new ReadOnlyCredentialError('credentials/oversize', 'The native credential document exceeds the configured byte limit.');
    const bytes = Buffer.alloc(spec.maxDocumentBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > spec.maxDocumentBytes) throw new ReadOnlyCredentialError('credentials/oversize', 'The native credential document exceeds the configured byte limit.');
    const after = await handle.stat();
    assertFile(after);
    if (admitted.size !== after.size || admitted.mtimeMs !== after.mtimeMs || admitted.ctimeMs !== after.ctimeMs || length !== after.size) {
      throw new ReadOnlyCredentialError('credentials/store-changed', 'The credential store changed during the read; retry the read.');
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)); }
    catch (error) { throw new ReadOnlyCredentialError('credentials/invalid-encoding', 'The native credential document must be valid UTF-8.'); }
  } finally {
    await handle.close();
  }
}
