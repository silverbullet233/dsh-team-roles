/** Native Typert descriptors shared by Web and external Node Gateway clients. */
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info';
import { z } from 'zod';
const text = z.string().min(1).max(65536);
const id = z.string().min(1).max(256);
const team = z.strictObject({ teamId: id });
const requests = {
  health: z.strictObject({}), activity: z.strictObject({}), prepareShutdown: z.strictObject({}),
  create: z.strictObject({ key: id, text, cwd: text, workspaceId: id.optional(), agentPreset: id.optional(), leadRole: id.optional() }),
  send: z.strictObject({ teamId: id, inputId: id, text, mode: z.enum(['queue', 'steer']).optional(), continue: z.boolean().optional() }),
  status: team, result: team, stop: team,
};
const codec = schema => ({ mode: 'strict', typeSymbol: 'dsh-team-roles#ManagedTeamValue', create: () => schema, jsonSchema: z.toJSONSchema(schema) });
export const remote = createTypertRemoteInfo({ package: 'dsh-team-roles/teams', methods: Object.fromEntries(
  Object.entries(requests).map(([name, schema]) => [`roleTeams/${name}`, {
    service: 'roleTeams', invocation: { kind: 'direct' },
    parameters: [{ name: 'request', source: 'json', codec: codec(schema), strictCodec: codec(schema) }],
    result: codec(z.json()),
  }]),
) }, z);
