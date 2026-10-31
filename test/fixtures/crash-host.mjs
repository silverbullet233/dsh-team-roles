import { createInterface } from 'node:readline';
import { mountNativeHost, toolChunks } from './native-harness.mjs';

let leadStarted = false;
const host = await mountNativeHost({
  root: process.argv[2], maxRequests: 8,
  respond: (options) => {
    if (options.provider === 'fixture-lead' && !leadStarted) {
      leadStarted = true;
      return toolChunks('spawn_role_teammate', { name: 'crash-one', role: 'left', prompt: 'Synthetic crash recovery member.' }, 'synthetic-crash-spawn');
    }
    return 'hang';
  },
});
const { default: WebServer } = await import('@deepseek-ai/dsh-host-webserver');
await host.ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 });
process.stdout.write(`${JSON.stringify({ ready: true, url: host.ctx.connection.authenticatedUrl(host.ctx.webServer.getOrigin()), fixtureRoot: host.fixtureRoot })}\n`);
for await (const line of createInterface({ input: process.stdin })) {
  if (line !== 'flush') throw new Error('Unknown synthetic test command.');
  for (const session of host.ctx.sessions.list()) await host.ctx.sessions.flush(session);
  process.stdout.write(`${JSON.stringify({ flushed: true })}\n`);
}
await host.dispose();
