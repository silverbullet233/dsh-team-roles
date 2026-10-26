/** Tag-only draft publication. Never replace assets, publish a release or create a tag. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseVersion } from './version.mjs';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export async function publishDraft({ repository, commit, tag, pkg, directory, request }) {
  assert(/^[\w.-]+\/[\w.-]+$/.test(repository), 'Invalid repository');
  assert(/^[a-f0-9]{40}$/.test(commit), 'Expected exact source commit');
  const release = releaseVersion(pkg, tag);
  const prefix = `https://api.github.com/repos/${repository}`;
  let ref = await request(`${prefix}/git/ref/tags/${encodeURIComponent(tag)}`);
  for (let depth = 0; ref.object.type === 'tag' && depth < 8; depth++) ref = await request(`${prefix}/git/tags/${ref.object.sha}`);
  assert.equal(ref.object.type, 'commit', 'Release tag must resolve to a commit');
  assert.equal(ref.object.sha, commit, 'Remote tag moved; refusing a different source commit');
  const archive = await readFile(join(directory, release.tarball));
  const sums = await readFile(join(directory, 'SHA256SUMS'));
  assert.equal(sums.toString(), `${sha256(archive)}  ${release.tarball}\n`, 'Release checksum mismatch');
  const files = [{ name: release.tarball, bytes: archive }, { name: 'SHA256SUMS', bytes: sums }];
  // The by-tag endpoint is for published releases; authenticated listing includes drafts.
  const matches = [];
  for (let page = 1; ; page++) {
    if (page > 100) throw new Error('Release lookup exceeded its page bound; no release was changed');
    const rows = await request(`${prefix}/releases?per_page=100&page=${page}`);
    assert(Array.isArray(rows), 'Expected a release list');
    matches.push(...rows.filter(row => row.tag_name === tag));
    if (rows.length < 100) break;
  }
  if (matches.length > 1) throw new Error('Multiple releases use this tag; resolve the ambiguity manually. No release was changed.');
  let existing = matches.length ? await request(`${prefix}/releases/${matches[0].id}`) : null;
  if (existing !== null && !existing.draft) throw new Error('Release is already published; assets were left untouched. Use a new version.');
  if (existing === null) existing = await request(`${prefix}/releases`, { method: 'POST', json: { tag_name: tag, target_commitish: commit, name: `dsh-team-roles ${release.version}`, draft: true, prerelease: release.version.includes('-'), body: `Native Team role settings and portable package ${release.version}.\n\nRequires Node >=24.9.0 and complete compatible official DSH source build 22ddee3792402c3e70ec5f86a63c3e3e895a2f60; released rc.3 alone is insufficient. Empty role catalogs preserve native model inheritance.\n\nBuilt and tested without provider credentials or inference. Native integration/runtime suites require the separately prepared supported DSH build and are not run by this workflow. npm is not published. Verify the attached SHA256SUMS and review before publishing.` } });
  assert.equal(existing.draft, true, 'Expected an unpublished draft release');
  assert.equal(existing.tag_name, tag);
  assert.equal(existing.target_commitish, commit, 'Draft source commit differs; review it manually before retrying');
  const upload = new URL(existing.upload_url.split('{')[0]);
  assert.equal(upload.origin, 'https://uploads.github.com');
  // Preflight all existing names before uploading any missing assets. Never clobber.
  const missing = [];
  for (const file of files) {
    const old = existing.assets?.find(asset => asset.name === file.name);
    if (!old) { missing.push(file); continue; }
    const digest = old.digest ?? `sha256:${sha256(await request(`${prefix}/releases/assets/${old.id}`, { bytes: true }))}`;
    if (digest !== `sha256:${sha256(file.bytes)}`) throw new Error(`Draft asset ${file.name} differs; no existing asset was overwritten. Use a new version or review the draft manually.`);
  }
  for (const file of missing) {
    upload.searchParams.set('name', file.name);
    await request(upload.href, { method: 'POST', body: file.bytes });
  }
  return { url: existing.html_url, draft: true, uploaded: missing.map(file => file.name) };
}
export function githubRequest(token) {
  if (!token) throw new Error('GITHUB_TOKEN is required only for the tag publication job');
  return async (url, options = {}) => {
    const parsed = new URL(url);
    if (!['https://api.github.com', 'https://uploads.github.com'].includes(parsed.origin)) throw new Error('Unexpected GitHub API origin');
    const response = await fetch(url, { method: options.method ?? 'GET', headers: { Authorization: `Bearer ${token}`, Accept: options.bytes ? 'application/octet-stream' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(options.body ? { 'Content-Type': 'application/octet-stream' } : options.json ? { 'Content-Type': 'application/json' } : {}) }, body: options.body ?? (options.json ? JSON.stringify(options.json) : undefined), signal: AbortSignal.timeout(60000) });
    if (options.missing && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub ${options.method ?? 'GET'} ${parsed.pathname} failed: HTTP ${response.status}`);
    return options.bytes ? Buffer.from(await response.arrayBuffer()) : response.json();
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.GITHUB_EVENT_NAME !== 'push' || process.env.GITHUB_REF_TYPE !== 'tag') throw new Error('Draft publication is restricted to a version tag push');
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  console.log(JSON.stringify(await publishDraft({ repository: process.env.GITHUB_REPOSITORY, commit: process.env.RELEASE_COMMIT, tag: process.env.RELEASE_TAG, pkg, directory: resolve('dist/release'), request: githubRequest(process.env.GITHUB_TOKEN) })));
}
