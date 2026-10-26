/** Reject recognizable credential material before preserving exact profile bytes. */
import yaml from 'js-yaml';

const KINDS = new Set(['package', 'lock', 'workspace', 'profile']);
const PACKAGE_MAPS = new Set(['dependencies', 'devdependencies', 'peerdependencies', 'optionaldependencies', 'overrides', 'resolutions', 'catalog']);
const CREDENTIAL_KEYS = new Set(['key', 'auth', 'authtoken', 'authorization', 'proxyauthorization', 'bearer', 'password', 'passwd', 'secret', 'clientsecret', 'token', 'apikey', 'accesskey', 'privatekey', 'signingkey', 'signingsecret', 'cookie', 'cookies', 'setcookie', 'cookiejar', 'credentials']);
const QUERY_KEYS = new Set([...CREDENTIAL_KEYS, 'code', 'sig', 'signature', 'xamzcredential', 'xamzsignature', 'xamzsecuritytoken']);
const REFERENCE_NAME = '[A-Z][A-Z0-9_]*(?:_API_KEY|_ACCESS_TOKEN|_REFRESH_TOKEN|_TOKEN|_PASSWORD|_SECRET|_KEY|_CREDENTIALS)';
const REFERENCE = new RegExp(`^(?:${REFERENCE_NAME}|\\$\\{${REFERENCE_NAME}\\})$`, 'u');
const JS_SCHEMA = yaml.DEFAULT_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: value => ({ cordisExpression: value ?? '' }) })]);

const normalize = key => key.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/gu, '');
const sensitiveKey = key => CREDENTIAL_KEYS.has(key) || /(?:password|passwd|secret|token|apikey|privatekey|signingkey)$/u.test(key);
const material = value => typeof value === 'string' ? value.trim().length > 0 : typeof value === 'number' || (value !== null && typeof value === 'object' && Object.keys(value).length > 0);
const fail = () => { throw new Error('Profile backup refused potential authentication material.'); };

function inspectString(value, { headers = true } = {}) {
  if (/-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/u.test(value)) fail();
  if (headers && /(?:^|[\r\n])\s*(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key)\s*[:=]\s*\S/iu.test(value)) fail();
  for (const match of value.matchAll(/(?:https?|ssh):\/\/[^\s"'<>`]+/giu)) {
    let url;
    try { url = new URL(match[0]); }
    catch (error) { fail(); }
    if (url.password || (url.username && !(url.protocol === 'ssh:' && url.username === 'git'))) fail();
    const parameters = [...url.searchParams, ...new URLSearchParams(url.hash.slice(1))];
    for (const [key, item] of parameters) if ((QUERY_KEYS.has(normalize(key)) || sensitiveKey(normalize(key)) || /(?:signature|credential)$/u.test(normalize(key))) && item.trim()) fail();
  }
}

function inspectAssignments(value) {
  if (typeof value !== 'string') fail();
  for (const match of value.matchAll(/(?:^|[\s,{;])['"]?([a-z_][a-z0-9_.-]*)['"]?\s*[:=]\s*(\S[^\r\n]*)/giu)) {
    if (sensitiveKey(normalize(match[1]))) fail();
  }
}

/** Parse configuration without executing Cordis expressions and inspect copied comments too. */
export function assertNonsecretBackup(contents, { kind } = {}) {
  if (typeof contents !== 'string' || !KINDS.has(kind)) throw new Error('A supported profile backup document kind is required.');
  let document;
  try { document = kind === 'package' ? JSON.parse(contents) : yaml.load(contents, { schema: JS_SCHEMA }); }
  catch (error) { throw new Error('Profile backup refused an unreadable configuration document.'); }
  inspectString(contents, { headers: false });
  for (const line of contents.split(/\r?\n/u)) {
    const comment = line.match(/(?:^|\s)#(.*)$/u)?.[1];
    if (comment !== undefined) inspectAssignments(comment);
  }
  const ancestors = new Set();
  function visit(value, packageNames = false, catalogGroups = false) {
    if (typeof value === 'string') { inspectString(value); return; }
    if (value === null || typeof value !== 'object') return;
    if (ancestors.has(value)) throw new Error('Profile backup refused recursive configuration aliases.');
    ancestors.add(value);
    try {
      if (value.type === 'oauth' && (material(value.access) || material(value.refresh))) fail();
      for (const [key, child] of Object.entries(value)) {
        const normalized = normalize(key);
        if (normalized === 'cordisexpression') inspectAssignments(child);
        if (!packageNames && sensitiveKey(normalized) && material(child) && !(typeof child === 'string' && REFERENCE.test(child))) fail();
        const dependencyMap = kind !== 'profile' && (catalogGroups || PACKAGE_MAPS.has(normalized));
        visit(child, dependencyMap, kind !== 'profile' && normalized === 'catalogs');
      }
    } finally { ancestors.delete(value); }
  }
  visit(document);
}
