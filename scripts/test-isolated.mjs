/** Local gate without listeners, ps, host lifecycle or real credentials. Full npm test remains separate. */
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
function run(args) { const result = spawnSync(process.execPath, args, { stdio: 'inherit', timeout: 120000 }); if (result.error || result.status !== 0) { console.error(`Isolated batch failed: ${args.join(' ')}; ${result.error?.code ?? result.signal ?? result.status}`); process.exit(1); } }
for (const root of ['test/auth', 'test/teams', 'test/roles']) run(['--test', ...(await readdir(root)).filter(name => name.endsWith('.test.mjs')).map(name => `${root}/${name}`)]);
run(['scripts/test-native.mjs', '--isolated']);
for (const root of ['test/runtime', 'test/release']) run(['--test', ...(await readdir(root)).filter(name => name.endsWith('.test.mjs')).map(name => `${root}/${name}`)]);
