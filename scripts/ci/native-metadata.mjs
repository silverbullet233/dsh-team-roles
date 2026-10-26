/** Build-only official Remote metadata; no native services or provider execution. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
export const metadataSource = Object.freeze({
  commit: '22ddee3792402c3e70ec5f86a63c3e3e895a2f60',
  path: 'packages/typert/protocol/src/remote-info.ts',
  sha256: 'e89fc959e61271aa57366b8c64a56278099e58e7d82936a2fc305398e507f79d',
});
export function verifyMetadata(bytes) {
  if (createHash('sha256').update(bytes).digest('hex') !== metadataSource.sha256) throw new Error('Official build metadata digest mismatch; refusing a different native API helper');
  return bytes;
}
export async function prepareNativeMetadata() {
  const directory = resolve(import.meta.dirname, '../../.runtime/ci');
  const target = resolve(directory, 'remote-info.ts');
  let bytes;
  try { bytes = await readFile(target); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(`https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/${metadataSource.commit}/${metadataSource.path}`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Official metadata download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  verifyMetadata(bytes);
  await mkdir(directory, { recursive: true });
  await writeFile(target, bytes);
  return target;
}
