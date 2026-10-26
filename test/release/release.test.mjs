import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseVersion } from '../../scripts/release/version.mjs';
import { publishDraft, sha256 } from '../../scripts/release/publish-draft.mjs';
import { verifyMetadata } from '../../scripts/ci/native-metadata.mjs';
const pkg = { name: 'dsh-team-roles', version: '0.3.0' };
const commit = 'a'.repeat(40);
test('tag/version and pinned metadata failures stop before release execution', () => {
  assert.equal(releaseVersion(pkg, 'v0.3.0').tarball, 'dsh-team-roles-0.3.0.tgz');
  for (const tag of ['v0.2.0', '0.3.0', 'v0.3.0;bad']) assert.throws(() => releaseVersion(pkg, tag), /Tag must/);
  assert.throws(() => releaseVersion({ ...pkg, version: '../bad' }), /valid/);
  assert.throws(() => verifyMetadata(Buffer.from('unverified metadata')), /digest mismatch/);
});
async function fixture(t, existing) {
  const directory = await mkdtemp(join(tmpdir(), 'release-draft-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const archive = Buffer.from('synthetic archive bytes');
  const sums = Buffer.from(`${sha256(archive)}  dsh-team-roles-0.3.0.tgz\n`);
  await writeFile(join(directory, 'dsh-team-roles-0.3.0.tgz'), archive);
  await writeFile(join(directory, 'SHA256SUMS'), sums);
  const calls = [];
  const draft = { id: 1, target_commitish: commit, tag_name: 'v0.3.0', draft: true, assets: [], upload_url: 'https://uploads.github.com/repos/example/plugin/releases/1/assets{?name,label}', html_url: 'https://github.com/example/plugin/releases/tag/v0.3.0' };
  const args = { repository: 'example/plugin', commit, tag: 'v0.3.0', pkg, directory, request: async (url, options = {}) => {
    calls.push({ url, ...options });
    if (url.includes('/git/ref/')) return { object: { type: 'commit', sha: commit } };
    if (url.includes('/releases/tags/')) throw new Error('By-tag lookup cannot discover draft releases');
    if (url.includes('/releases?')) return existing === undefined ? [] : [{ ...draft, ...existing }];
    if (url.endsWith('/releases/1')) return { ...draft, ...existing };
    if (url.endsWith('/releases')) { assert.equal(options.json.draft, true); assert.equal(options.json.target_commitish, commit); return draft; }
    if (url.startsWith('https://uploads.github.com/')) return { id: 1 };
    throw new Error(`Unexpected mock request: ${url}`);
  } };
  return { args, calls, archive, sums, directory };
}
test('first run creates only a draft and uploads the tarball/checksums without tag mutation', async t => {
  const { args, calls } = await fixture(t);
  const result = await publishDraft(args);
  assert.equal(result.draft, true); assert.equal(result.uploaded.length, 2);
  assert.equal(calls.filter(call => call.method === 'POST').length, 3);
  assert(!calls.some(call => ['PATCH','DELETE'].includes(call.method) || /git\/refs/.test(call.url)));
});
test('identical draft reruns skip assets and partial reruns upload only missing assets', async t => {
  const base = await fixture(t);
  const assets = [{ name: 'dsh-team-roles-0.3.0.tgz', digest: `sha256:${sha256(base.archive)}` }, { name: 'SHA256SUMS', digest: `sha256:${sha256(base.sums)}` }];
  const same = await fixture(t, { assets });
  assert.deepEqual((await publishDraft(same.args)).uploaded, []);
  assert(!same.calls.some(call => call.method));
  const partial = await fixture(t, { assets: assets.slice(0,1) });
  assert.deepEqual((await publishDraft(partial.args)).uploaded, ['SHA256SUMS']);
});
test('published releases and mismatched draft assets reject with zero write calls', async t => {
  for (const existing of [{ draft: false }, { assets: [{ name: 'SHA256SUMS', digest: `sha256:${'f'.repeat(64)}` }] }]) {
    const { args, calls } = await fixture(t, existing);
    await assert.rejects(publishDraft(args), /already published|differs/);
    assert(!calls.some(call => call.method));
  }
});
test('moved tags and invalid local checksums reject before creating a draft', async t => {
  const first = await fixture(t);
  await assert.rejects(publishDraft({ ...first.args, commit: 'b'.repeat(40) }), /Remote tag moved/);
  assert(!first.calls.some(call => call.method));
  const second = await fixture(t);
  await writeFile(join(second.directory, 'SHA256SUMS'), 'invalid');
  await assert.rejects(publishDraft(second.args), /checksum mismatch/);
  assert(!second.calls.some(call => call.method));
});


test('draft discovery paginates and refuses duplicate tag releases before any write', async t => {
  const base = await fixture(t, { assets: [{ name: 'dsh-team-roles-0.3.0.tgz', digest: `sha256:${sha256(Buffer.from('synthetic archive bytes'))}` }] });
  const original = base.args.request;
  const firstPage = Array.from({ length: 100 }, (_, id) => ({ id: id + 10, tag_name: `v9.0.${id}` }));
  const request = async (url, options) => url.includes('/releases?') && new URL(url).searchParams.get('page') === '1' ? firstPage : original(url, options);
  assert.deepEqual((await publishDraft({ ...base.args, request })).uploaded, ['SHA256SUMS']);
  const duplicate = async (url, options) => url.includes('/releases?') ? [{ id: 1, tag_name: 'v0.3.0' }, { id: 2, tag_name: 'v0.3.0' }] : original(url, options);
  await assert.rejects(publishDraft({ ...base.args, request: duplicate }), /Multiple releases/);
});
