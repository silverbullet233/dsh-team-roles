/** Start the user's normal native Web profile without displaying login credentials. */
import { spawn } from 'node:child_process';

const shellEnvironment = process.argv.includes('--shell-env');
const command = shellEnvironment ? '/bin/zsh' : '/Users/mxr/.local/bin/dsh';
const args = shellEnvironment ? ['-ic', 'exec /Users/mxr/.local/bin/dsh web --no-open'] : ['web', '--no-open'];
const child = spawn(command, args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
// Shell startup and native login URLs may contain credentials. Never relay raw output.
let outputBytes = 0;
child.stdout.on('data', chunk => { outputBytes += chunk.length; });
child.stderr.on('data', chunk => { outputBytes += chunk.length; });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => { console.log(JSON.stringify({ nativeHostExit: code, signal, suppressedOutputBytes: outputBytes })); process.exitCode = code ?? 1; });
console.log(JSON.stringify({ nativeHostPid: child.pid, command: '/Users/mxr/.local/bin/dsh web --no-open', shellEnvironment }));
