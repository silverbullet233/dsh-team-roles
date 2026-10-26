import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNonsecretBackup } from '../../scripts/profile-backup-safety.mjs';

test('backup admission refuses nested quoted and normalized sensitive keys without quoting their values', () => {
  for (const key of ['secret', 'API-Key', 'Authorization', 'COOKIE', 'Refresh_Token', '_authToken', 'privateKey', 'databasePassword']) {
    const document = JSON.stringify({ config: { [key]: 'synthetic-secret-must-not-appear' } });
    assert.throws(() => assertNonsecretBackup(document, { kind: 'package' }), error => error.message === 'Profile backup refused potential authentication material.' && !error.message.includes('synthetic-secret'));
    assert.throws(() => assertNonsecretBackup(`config:\n  '${key}': synthetic-secret-must-not-appear\n`, { kind: 'profile' }));
  }
  assert.throws(() => assertNonsecretBackup(JSON.stringify({ grant: { type: 'oauth', access: 'synthetic-access', refresh: 'synthetic-refresh' } }), { kind: 'package' }));
  for (const value of ['Authorization: Bearer synthetic-token', 'Cookie: session=synthetic-cookie', '-----BEGIN PRIVATE KEY-----\nsynthetic-key\n-----END PRIVATE KEY-----']) {
    assert.throws(() => assertNonsecretBackup(JSON.stringify({ config: { values: [value] } }), { kind: 'package' }));
  }
});

test('backup admission refuses authenticated URLs in dependencies, comments and encoded query names', () => {
  for (const url of ['https://user:synthetic-password@example.invalid/pkg.tgz', 'https://synthetic-token@example.invalid/pkg.tgz', 'https://example.invalid/pkg.tgz?token=synthetic-token', 'https://example.invalid/pkg.tgz?%41PI%5FKEY=synthetic-token', 'https://example.invalid/pkg.tgz#access_token=synthetic-token', 'https://example.invalid/pkg.tgz?X-Amz-Signature=synthetic-signature', 'https://example.invalid/pkg.tgz?X-Goog-Signature=synthetic-signature']) {
    assert.throws(() => assertNonsecretBackup(JSON.stringify({ dependencies: { ordinary: url } }), { kind: 'package' }));
    assert.throws(() => assertNonsecretBackup(`# previous download: ${url}\npackages: []\n`, { kind: 'workspace' }));
  }
  assert.throws(() => assertNonsecretBackup('config: {} # Authorization: Bearer synthetic-token\n', { kind: 'profile' }));
});

test('ordinary dependency maps, lock data, safe headers and explicit references remain backupable', () => {
  assert.doesNotThrow(() => assertNonsecretBackup(JSON.stringify({ name: 'synthetic-package', dependencies: { cookie: '^1.0.0', token: '^2.0.0', secret: 'https://registry.npmjs.org/secret/-/secret-1.0.0.tgz?download=1' }, scripts: { test: 'node --test' } }), { kind: 'package' }));
  assert.doesNotThrow(() => assertNonsecretBackup("lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      cookie:\n        specifier: ^1.0.0\n        version: 1.0.0\npackages:\n  cookie@1.0.0:\n    resolution:\n      integrity: sha512-syntheticDigest\nsnapshots:\n  cookie@1.0.0: {}\n", { kind: 'lock' }));
  assert.doesNotThrow(() => assertNonsecretBackup('packages:\n  - packages/*\ncatalogs:\n  browser:\n    cookie: ^1.0.0\n', { kind: 'workspace' }));
  assert.doesNotThrow(() => assertNonsecretBackup('- name: synthetic\n  config:\n    apiKey: OPENCODE_API_KEY\n    tokenRef: FIXTURE_TOKEN\n    headers:\n      Accept: application/json\n      Content-Type: application/json\n    cookie: null\n', { kind: 'profile' }));
  assert.throws(() => assertNonsecretBackup('config:\n  dependencies:\n    cookie: synthetic-cookie\n', { kind: 'profile' }));
});

test('Cordis expressions are inspected as text and never executed while unsafe or unreadable documents fail closed', () => {
  assert.doesNotThrow(() => assertNonsecretBackup("- id: synthetic\n  config: !!js JSON.parse(process.getBuiltinModule('node:fs').readFileSync(dshHomePath('dsh-agent-team.json'), 'utf8'))\n", { kind: 'profile' }));
  assert.throws(() => assertNonsecretBackup("config: !!js ({ApiKey: 'synthetic-secret'})\n", { kind: 'profile' }));
  assert.throws(() => assertNonsecretBackup('a: &cycle\n  self: *cycle\n', { kind: 'profile' }), /recursive configuration aliases/);
  for (const [kind, contents] of [['package', '{"secret":"synthetic-secret",'], ['profile', 'config: [synthetic-secret']]) {
    assert.throws(() => assertNonsecretBackup(contents, { kind }), error => error.message === 'Profile backup refused an unreadable configuration document.' && !error.message.includes('synthetic-secret'));
  }
});
