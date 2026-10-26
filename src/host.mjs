/** Load native peers through the official DSH profile resolver, with actionable diagnostics. */
let plugin;
try { plugin = await import('./native-host.mjs'); }
catch (cause) {
  const error = new Error(`Cannot load dsh-team-roles native peers: ${cause.message}. Install this package through the compatible official dsh profile; keep the launcher runtime resolver enabled. Do not install a separate registry DSH runtime or create manual dependency links.`, { cause });
  error.code = 'DSH_NATIVE_PEERS_UNAVAILABLE';
  throw error;
}
export const name = plugin.name;
export const Config = plugin.Config;
export const inject = plugin.inject;
export const apply = plugin.apply;
