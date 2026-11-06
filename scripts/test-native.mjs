/** Run every native file in a fresh process, serially, with a failing deadline. */
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const isolated = process.argv.includes('--isolated');
if (process.argv.slice(2).some(arg => arg !== '--isolated')) throw new Error('Only --isolated is supported.');
const excluded = isolated ? ['gateway.test.mjs', 'lifecycle-composition.test.mjs'] : [];
const files = (await readdir('test/native')).filter(name => name.endsWith('.test.mjs') && !excluded.includes(name)).sort();
if (isolated) console.log(`Isolated native exclusions: ${excluded.join(', ')} and the flushed-process-crash socket case in shared-session.test.mjs.`);
console.log(`Native plan: ${files.length} files, one process per file, serial execution; 45s process deadline, 30s test deadline. A deadline is a failure.`);
for (const file of files) {
  const args = ['--test', '--test-isolation=none', '--test-timeout=30000'];
  if (isolated && file === 'shared-session.test.mjs') args.push('--test-skip-pattern=^a flushed process crash recovers');
  args.push(`test/native/${file}`);
  console.log(`Native file: ${file}`);
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', timeout: 45000, killSignal: 'SIGKILL' });
  if (result.error || result.signal || result.status !== 0) {
    console.error(`Native file failed: ${file}; ${result.error?.code ?? result.signal ?? `exit ${result.status}`}. Remaining files were not run.`);
    process.exit(1);
  }
}
console.log(`Native plan completed: ${files.length}/${files.length} files. ${isolated ? 'Declared listener exclusions remain unverified.' : 'No files or tests excluded.'}`);
