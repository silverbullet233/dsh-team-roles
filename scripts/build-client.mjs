/** Emit the official native module-loader closure format; no separate dashboard. */
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
const result = await build({ entryPoints: ['src/client/index.jsx'], bundle: true, format: 'cjs', platform: 'browser', external: ['react'], write: false, minify: true, target: 'es2022' });
await mkdir('lib', { recursive: true });
await writeFile('lib/client.js', `window.__ModuleLoader__.load({ id: 'dsh-team-roles', factory: (require) => { const module = { exports: {} }; const exports = module.exports;\n${result.outputFiles[0].text}\nreturn module.exports; } });\n`);
console.log('Native Settings client built.');
