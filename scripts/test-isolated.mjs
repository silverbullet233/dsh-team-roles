/** Local gate without listeners, ps, host lifecycle or real credentials. Full npm test remains separate. */
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
function run(args) { const result = spawnSync(process.execPath, args, { stdio: 'inherit' }); if (result.status !== 0) process.exit(result.status ?? 1); }
for (const root of ['test/auth', 'test/teams', 'test/roles']) run(['--test', ...(await readdir(root)).filter(name => name.endsWith('.test.mjs')).map(name => `${root}/${name}`)]);
run(['--test', 'test/native/synthetic-fixtures.test.mjs']);
console.log('Isolated native gate excludes gateway.test.mjs, lifecycle-composition.test.mjs and the socket-based flushed-process-crash case. Shared-session data tests run in a separate batch.');
run(['--test', ...(await readdir('test/native')).filter(name => name.endsWith('.test.mjs') && !['gateway.test.mjs', 'lifecycle-composition.test.mjs', 'synthetic-fixtures.test.mjs', 'shared-session.test.mjs'].includes(name)).map(name => `test/native/${name}`)]);
run(['--test', '--test-skip-pattern=^a flushed process crash recovers', 'test/native/shared-session.test.mjs']);
for (const root of ['test/runtime', 'test/release']) run(['--test', ...(await readdir(root)).filter(name => name.endsWith('.test.mjs')).map(name => `${root}/${name}`)]);
