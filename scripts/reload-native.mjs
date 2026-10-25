/** Ask native profile HMR to reconcile changed local plugin files without changing settings. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write';
import { assertNonsecretBackup } from './profile-backup-safety.mjs';

const home = join(homedir(), '.dsh');
const profile = join(home, 'profiles/web');
const patch = join(profile, 'cordis.patch.yml');
await withFileLock(join(profile, 'package.json'), async () => {
  const current = await readFile(patch, 'utf8');
  assertNonsecretBackup(current, { kind: 'profile' });
  const backup = join(home, 'dsh-agent-team', `profile-before-reconcile-${Date.now()}.yml`);
  await mkdir(join(home, 'dsh-agent-team'), { recursive: true, mode: 0o700 });
  await writeFile(backup, current, { mode: 0o600, flag: 'wx' });
  await writeFileAtomic(patch, `${current.trimEnd()}\n# dsh-agent-team local code reconciliation ${Date.now()}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ profile: 'web', settingsChanged: false, nativeHmrRequested: true, backup, restartRequested: false }));
}, { waitMs: 30000 });
