/** A page inside the native Settings shell; native Remote authentication is retained. */
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { remote } from '../settings/remote.mjs';

export const inject = ['remote', 'remote.session', 'slots', 'configForms'];
const clone = value => structuredClone(value);
const box = { padding: 12, border: '1px solid var(--border-color, #8884)', borderRadius: 8, marginBlock: 12 };
const field = { display: 'grid', gap: 5, marginBlock: 10 };
const control = { width: '100%', padding: 8, border: '1px solid #8886', borderRadius: 5, background: 'transparent', color: 'inherit', font: 'inherit' };

function TeamRoles({ form, save, models }) {
  const snapshot = useSyncExternalStore(listener => form.subscribe(listener), () => form.getSnapshot());
  const [draft, setDraft] = useState(null), [revision, setRevision] = useState(null);
  const [dirty, setDirty] = useState(false), [saving, setSaving] = useState(false), [message, setMessage] = useState('');
  const [catalog, setCatalog] = useState(null), [modelError, setModelError] = useState('');
  const reloadModels = async () => { try { const result = await models(); setCatalog(result); setModelError(''); } catch (error) { setModelError(error.message); } };
  useEffect(() => { void reloadModels(); }, []);
  useEffect(() => {
    if (!dirty && snapshot.value?.catalog && (revision === null || snapshot.revision >= revision)) { setDraft(clone(snapshot.value.catalog)); setRevision(snapshot.revision); }
  }, [snapshot.revision, snapshot.value, dirty]);
  const edit = next => { setDraft(next); setDirty(true); setMessage(''); };
  const roleEdit = (index, key, value) => edit({ ...draft, roles: draft.roles.map((role, i) => i === index ? { ...role, [key]: value } : role) });
  const discard = () => { setDraft(clone(snapshot.value.catalog)); setRevision(snapshot.revision); setDirty(false); setMessage('Reloaded saved roles.'); };
  const submit = async event => {
    event.preventDefault(); setSaving(true); setMessage('');
    try {
      const value = clone(draft);
      for (const role of value.roles) if (role.reasoningEffort === '') delete role.reasoningEffort;
      const saved = await save(value, revision);
      setRevision(saved.revision);
      setDraft(value); setDirty(false); setMessage(value.roles.length ? 'Saved. New Leads and new members use these roles. Existing members retain their snapshots.' : 'Saved. New Teams use native main Agent selection and teammate inheritance. Existing Teams retain their behavior.');
    } catch (error) { setMessage(error.message); }
    finally { setSaving(false); }
  };
  if (!draft) return <section style={{ padding: 20 }}><h2>Team roles</h2><p role="status">{snapshot.status === 'unavailable' ? 'Role settings are unavailable. Check that the native plugin is active.' : 'Loading role settings…'}</p></section>;
  const disabled = saving || !snapshot.writable;
  const stale = dirty && snapshot.revision > revision;
  return <section style={{ padding: 20, maxWidth: 900 }}>
    <h2>Team roles</h2>
    <p>Configure role instructions and exact native provider routes. Changes apply immediately to new Leads and new members. Existing members, follow-ups and recovered members keep their original snapshots.</p>
    <p>With no roles configured, new Teams use native main Agent model selection and teammate inheritance. Removing a role prevents new members using it; bound members remain available. Saves use the native Web profile. Reload saved roles to discard a draft.</p>
    {stale && <p role="alert">Roles changed in another editor. Reload saved roles before saving.</p>}
    {modelError && <p role="alert">Model catalog: {modelError}</p>}
    {catalog?.failures?.map(failure => <p role="status" key={failure.id}>{failure.id}: {failure.message}</p>)}
    <form onSubmit={submit}>
      <label style={field}>Default Lead role<select aria-label="Default Lead role" style={control} value={draft.leadRole} disabled={disabled} onChange={event => edit({ ...draft, leadRole: event.target.value })}>
        {draft.roles.length === 0 ? <option value="">Native main Agent model</option> : !draft.roles.some(role => role.name === draft.leadRole) && <option value={draft.leadRole}>{draft.leadRole || '(select Lead role)'} (missing)</option>}
        {draft.roles.map((role, i) => <option key={i} value={role.name}>{role.name || '(unnamed)'}</option>)}
      </select></label>
      {draft.roles.map((role, index) => {
        const provider = catalog?.groups.find(item => item.id === role.provider);
        const model = provider?.models.find(item => item.id === role.model);
        const efforts = model?.reasoning?.efforts ?? [];
        return <fieldset key={index} style={box} disabled={disabled}>
          <legend>Role {index + 1}: {role.name}</legend>
          <label style={field}>Name<input aria-label={`Role ${index + 1} name`} style={control} value={role.name} onChange={event => roleEdit(index, 'name', event.target.value)} /></label>
          <label style={field}>Description<input aria-label={`Role ${index + 1} description`} style={control} value={role.description} onChange={event => roleEdit(index, 'description', event.target.value)} /></label>
          <label style={field}>Instructions<textarea aria-label={`Role ${index + 1} instructions`} rows={5} style={control} value={role.instructions} onChange={event => roleEdit(index, 'instructions', event.target.value)} /></label>
          <label style={field}>Provider<select aria-label={`Role ${index + 1} provider`} style={control} value={role.provider} onChange={event => roleEdit(index, 'provider', event.target.value)}>
            {!provider && <option value={role.provider}>{role.provider || '(select provider)'} — unavailable</option>}
            {catalog?.groups.map(item => <option value={item.id} key={item.id}>{item.name} ({item.id})</option>)}
          </select></label>
          <label style={field}>Model<input aria-label={`Role ${index + 1} model`} style={control} list={`role-models-${index}`} value={role.model} onChange={event => roleEdit(index, 'model', event.target.value)} />
            <datalist id={`role-models-${index}`}>{provider?.models.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</datalist>
          </label>
          <label style={field}>Reasoning effort<select aria-label={`Role ${index + 1} effort`} style={control} value={role.reasoningEffort ?? ''} onChange={event => roleEdit(index, 'reasoningEffort', event.target.value)}>
            <option value="">Native adapter default</option>
            {role.reasoningEffort && !efforts.some(item => item.id === role.reasoningEffort) && <option value={role.reasoningEffort}>{role.reasoningEffort} — unavailable</option>}
            {efforts.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
          </select></label>
          <button type="button" onClick={() => { const roles = draft.roles.filter((_, i) => i !== index); edit({ ...draft, roles, leadRole: roles.length ? draft.leadRole : '' }); }}>Remove role {role.name}</button>
        </fieldset>;
      })}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <button type="button" disabled={disabled} onClick={() => edit({ ...draft, roles: [...draft.roles, { name: '', description: '', instructions: '', provider: '', model: '' }] })}>Add role</button>
        <button type="submit" disabled={disabled || !dirty || stale}>{saving ? 'Saving…' : 'Save roles'}</button>
        <button type="button" disabled={saving} onClick={discard}>Reload saved roles</button>
        <button type="button" disabled={saving} onClick={() => { void reloadModels(); }}>Refresh model catalog</button>
      </div>
      <p role="status" aria-live="polite">{message || (dirty ? 'Unsaved changes.' : 'Saved roles loaded.')}</p>
    </form>
  </section>;
}

export async function apply(ctx) {
  await ctx.remote.$mount(remote);
  await ctx.inject(['remote.teamRoleSettings'], child => {
  const form = child.configForms.get('dsh-agent-team');
  child.slots.inject('settings.section', () => child.slots.register({
    name: 'settings.section', id: 'team-roles', label: 'Team roles', order: 45,
    inject: () => ({ form,
      save: async (catalog, revision) => { const result = await child.remote.teamRoleSettings.save(catalog, revision); if (!result.ok) throw new Error(result.error.message); return result.value; },
      models: async () => { const result = await child.remote.session.modelCatalog(); if (!result.ok) throw new Error(result.error.message); return result.value; },
    }),
  }, TeamRoles));
  });
}
