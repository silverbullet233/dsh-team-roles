/** Native settings use an array so removing a role replaces it across profile layers. */
import { record, resolveConfig, roleSnapshot } from '../roles/config.mjs';

export function catalogValue(value, { allowUnconfigured = false } = {}) {
  record(value, ['leadRole', 'roles'], 'role catalog');
  if (!Array.isArray(value.roles) || (!allowUnconfigured && value.roles.length === 0) || value.roles.length > 128) throw new Error(`roles must contain ${allowUnconfigured ? '0' : '1'} to 128 entries`);
  const roles = {};
  for (const entry of value.roles) {
    record(entry, ['name', 'description', 'instructions', 'provider', 'model', 'reasoningEffort'], 'role entry');
    const { name, ...fields } = entry;
    if (Object.hasOwn(roles, name)) throw new Error(`duplicate role ${name}`);
    const { role, ...snapshot } = roleSnapshot(name, fields);
    Object.defineProperty(roles, role, { value: snapshot, enumerable: true });
  }
  return resolveConfig({ stateDirectory: '/catalog-validation', leadRole: value.leadRole, roles, allowUnconfigured });
}

export function catalogFromLegacy(value) {
  return { leadRole: value.leadRole, roles: Object.entries(value.roles).map(([name, fields]) => ({ name, ...fields })) };
}

/** Registry checks never infer, choose a fallback, or inspect credential values. */
export async function validateCatalog(llm, value, signal) {
  const catalog = catalogValue(value, { allowUnconfigured: true });
  const providers = new Set(llm.listProviders().map(item => item.id));
  const lists = new Map();
  for (const role of Object.values(catalog.roles)) {
    signal?.throwIfAborted();
    if (!providers.has(role.provider)) throw new Error(`Provider ${role.provider} is not registered`);
    if (!lists.has(role.provider)) lists.set(role.provider, await llm.listModels(role.provider));
    if (!lists.get(role.provider).some(model => model.id === role.model)) throw new Error(`Model ${role.provider}/${role.model} is not in the native catalog`);
    const info = await llm.resolveModelInfo(role.provider, role.model, signal);
    if (role.reasoningEffort !== undefined && !info.reasoning?.efforts.some(item => item.id === role.reasoningEffort)) throw new Error(`Effort ${role.reasoningEffort} is unsupported by ${role.provider}/${role.model}`);
  }
  return catalog;
}
