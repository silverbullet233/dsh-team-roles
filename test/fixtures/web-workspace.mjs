import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';

export async function webWorkspace(home) {
  const directory = join(home, 'fixture');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return realpath(directory);
}
