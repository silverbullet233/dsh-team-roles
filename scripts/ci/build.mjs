/** Clean npm-only release build; native execution remains an installation concern. */
import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit', env: { ...process.env, DSH_RELEASE_BUILD: '1' } });
process.exitCode = result.status ?? 1;
