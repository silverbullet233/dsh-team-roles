/** Read-only access to the existing native DSH credential document. */
import { CredentialProvider, credentialRef, parseCredentialKey } from '@deepseek-ai/dsh-credentials';
import { parseCredentialsDocument } from '@deepseek-ai/dsh-credentials-local';
import { isDeepStrictEqual } from 'node:util';
import z from '@deepseek-ai/schemastery';
import { readOwnerFile, ReadOnlyCredentialError, resolveReadOnlyConfig } from './read-owner-file.mjs';

/** Native credential provider that refuses every persistent modification. */
export class ReadOnlyNativeCredentials extends CredentialProvider {
  static Config = z.object({ path: z.string().required(), maxDocumentBytes: z.natural().min(1).max(67_108_864).default(1_048_576) });

  constructor(ctx, config) {
    super(ctx);
    this.spec = resolveReadOnlyConfig(config);
  }

  async document() {
    const contents = await readOwnerFile(this.spec);
    try { return parseCredentialsDocument(contents, this.spec.path); }
    catch (error) {
      // Native parser errors are safe, but callers need only the failure category.
      throw new ReadOnlyCredentialError('credentials/invalid-store', 'The existing native credential document is unsupported or malformed; no migration was attempted.');
    }
  }

  async resolve(ref) {
    credentialRef(ref);
    const value = (await this.document()).refs.get(ref);
    return value === undefined ? undefined : { value, source: 'file' };
  }

  async describe(ref) {
    credentialRef(ref);
    const configured = (await this.document()).refs.has(ref);
    return { configured, ...(configured ? { source: 'file' } : {}), writable: false };
  }

  async readRecord(key) {
    parseCredentialKey(key);
    const record = (await this.document()).records.get(key);
    return record === undefined ? undefined : structuredClone(record);
  }

  async describeRecord(key) {
    parseCredentialKey(key);
    const record = (await this.document()).records.get(key);
    return { configured: record !== undefined, ...(record === undefined ? {} : { kind: record.kind }), writable: false };
  }

  async listRecords() {
    return [...(await this.document()).records].map(([key, record]) => ({ key: parseCredentialKey(key), kind: record.kind }));
  }

  async set() { throw readOnly(); }
  async unset() { throw readOnly(); }
  async modifyRecord(key, mutate) {
    const current = await this.readRecord(key);
    const detached = structuredClone(current);
    const proposed = await mutate(detached);
    if (proposed !== undefined || !isDeepStrictEqual(detached, current)) throw readOnly();
    if (!isDeepStrictEqual(await this.readRecord(key), current)) {
      throw new ReadOnlyCredentialError('credentials/store-changed', 'The native credential record changed during its read-only check; retry the operation.');
    }
    return current;
  }
  async deleteRecord() { throw readOnly(); }
}

function readOnly() {
  return new ReadOnlyCredentialError('credentials/read-only', 'Native credentials are read-only in this host; credential creation, refresh, modification and deletion require separate authorization.');
}

export default ReadOnlyNativeCredentials;
