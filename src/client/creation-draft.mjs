/** Per-tab durable creation identity survives Settings remounts and page reloads. */
const key = 'dsh-team-roles.pending-create.v1';
export function loadCreationDraft(storage = globalThis.sessionStorage) {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  const draft = JSON.parse(raw);
  if (draft.version !== 1 || !draft.request || ['key', 'cwd', 'text'].some(field => typeof draft.request[field] !== 'string' || !draft.request[field])) throw new Error('Saved Team creation is invalid; inspect browser session storage before starting another request.');
  return draft;
}
export function saveCreationDraft(request, receipt = null, storage = globalThis.sessionStorage) {
  storage.setItem(key, JSON.stringify({ version: 1, request, receipt }));
}
export function clearCreationDraft(storage = globalThis.sessionStorage) { storage.removeItem(key); }
