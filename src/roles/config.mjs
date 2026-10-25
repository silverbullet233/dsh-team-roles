/** Validated role catalog. Provider values name native registrations, never endpoints. */
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** Refuse unknown fields so credentials and endpoint overrides cannot enter role records. */
export function record(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`${label} has unsupported field ${key}`);
  return value;
}

/** Validate one nonempty string without changing its model-visible content. */
export function text(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be nonempty text`);
  return value;
}

/** Validate an instance or role name. */
export function memberName(value, allowLead = false) {
  if (typeof value !== 'string' || !NAME.test(value) || value.length > 64 || (!allowLead && value === 'lead')) {
    throw new Error('name must be lower-kebab-case, at most 64 characters, and not lead');
  }
  return value;
}

/** Return a detached, immutable role snapshot from untrusted configuration. */
export function roleSnapshot(name, value) {
  memberName(name, true);
  record(value, ['description', 'instructions', 'provider', 'model', 'reasoningEffort'], `role ${name}`);
  const provider = text(value.provider, 'provider');
  if (/[\s/:\\]/u.test(provider)) throw new Error('provider must name an existing DSH registration, not an endpoint');
  const result = {
    role: name,
    description: text(value.description, 'description'),
    instructions: text(value.instructions, 'instructions'),
    provider,
    model: text(value.model, 'model'),
    ...(value.reasoningEffort === undefined ? {} : { reasoningEffort: text(value.reasoningEffort, 'reasoningEffort') }),
  };
  return Object.freeze(result);
}

/** Resolve deployment configuration once; existing members keep their stored snapshots. */
export function resolveConfig(value) {
  record(value, ['stateDirectory', 'leadRole', 'spawnProvider', 'roles'], 'role plugin config');
  if (typeof value.stateDirectory !== 'string' || !isAbsolute(value.stateDirectory)) throw new Error('stateDirectory must be absolute');
  record(value.roles, Object.keys(value.roles ?? {}), 'roles');
  const roles = Object.fromEntries(Object.entries(value.roles).map(([name, role]) => [name, roleSnapshot(name, role)]));
  if (Object.keys(roles).length === 0) throw new Error('roles must contain at least one role');
  const leadRole = text(value.leadRole, 'leadRole');
  if (!Object.hasOwn(roles, leadRole)) throw new Error('leadRole must name an allowlisted role');
  const spawnProvider = value.spawnProvider ?? 'spawn';
  if (spawnProvider !== 'spawn') throw new Error('only the native in-process spawn backend is supported');
  return Object.freeze({ stateDirectory: value.stateDirectory, leadRole, spawnProvider, roles: Object.freeze(roles) });
}

/** Hash only caller content; changing the role catalog never rewrites a prior member. */
export function inputDigest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** The configured LLM route, distinct from the native spawn backend. */
export function routeOf(binding) {
  return {
    provider: binding.provider,
    model: binding.model,
    ...(binding.reasoningEffort === undefined ? {} : { reasoningEffort: binding.reasoningEffort }),
  };
}
