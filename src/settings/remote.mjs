/** Shared wire descriptors built with the official Typert metadata API. */
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info';
import { z } from 'zod';
const role = z.strictObject({ name: z.string(), description: z.string(), instructions: z.string(), provider: z.string(), model: z.string(), reasoningEffort: z.string().optional() });
const catalog = z.strictObject({ leadRole: z.string(), roles: z.array(role).max(128) });
const codec = (schema) => ({ mode: 'strict', typeSymbol: 'dsh-team-roles#SettingsValue', create: () => schema, jsonSchema: z.toJSONSchema(schema) });
const parameter = (name, schema) => ({ name, source: 'json', codec: codec(schema), strictCodec: codec(schema) });
const method = (parameters, result) => ({ service: 'teamRoleSettings', invocation: { kind: 'direct' }, parameters, result: codec(result) });
export const remote = createTypertRemoteInfo({ package: 'dsh-team-roles', methods: {
  'teamRoleSettings/save': method([parameter('catalog', catalog), parameter('revision', z.number().int().nonnegative())], z.strictObject({ revision: z.number(), applies: z.literal('new-members') })),
} }, z);
