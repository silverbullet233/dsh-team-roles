/** Native Typert descriptors shared by Web and external Node Gateway clients. */
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info';
import { z } from 'zod';
const text = z.string().min(1).max(65536);
const id = z.string().min(1).max(256);
const team = z.strictObject({ teamId: id });
const requests = {
  health: z.strictObject({}), activity: z.strictObject({}), prepareShutdown: z.strictObject({}),
  create: z.strictObject({ key: id, text, cwd: text, workspaceId: id.optional(), agentPreset: id.optional(), leadRole: id.optional(), permissionPreset: id.optional(), permissionProfile: z.strictObject({ sandboxMode: z.enum(['read-only', 'workspace-write', 'danger-full-access']), approvalPolicy: z.enum(['ask', 'never']), writableRoots: z.array(z.string().min(1).max(4096)).max(64), networkAccess: z.enum(['enabled', 'restricted']), binding: z.string().regex(/^[a-f0-9]{64}$/) }).optional() }),
  send: z.strictObject({ teamId: id, inputId: id, text, mode: z.enum(['queue', 'steer']).optional(), continue: z.boolean().optional() }),
  status: team, result: team, stop: team,
  input: z.strictObject({ teamId: id, inputId: id }),
  withdrawInput: z.strictObject({ teamId: id, inputId: id, expectedMessageId: id }),
  jobs: z.strictObject({ teamId: id, limit: z.number().int().min(1).max(25).optional() }),
  turnResult: z.strictObject({ teamId: id, turn: z.number().int().positive().optional(), resultRef: z.string().min(1).max(2048).optional(), offset: z.number().int().nonnegative().optional(), maxBytes: z.number().int().min(4).max(32768).optional() }),
};
const codec = schema => ({ mode: 'strict', typeSymbol: 'dsh-team-roles#ManagedTeamValue', create: () => schema, jsonSchema: z.toJSONSchema(schema) });
export const remote = createTypertRemoteInfo({ package: 'dsh-team-roles/teams', methods: Object.fromEntries(
  Object.entries(requests).map(([name, schema]) => [`roleTeams/${name}`, {
    service: 'roleTeams', invocation: { kind: 'direct' },
    parameters: [{ name: 'request', source: 'json', codec: codec(schema), strictCodec: codec(schema) }],
    result: codec(z.json()),
  }]),
) }, z);
