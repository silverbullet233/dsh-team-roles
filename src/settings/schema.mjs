import z from '@deepseek-ai/schemastery';
const role = z.object({
  name: z.string().required(), description: z.string().required(), instructions: z.string().required(),
  provider: z.string().required(), model: z.string().required(), reasoningEffort: z.string(),
});
export const Config = z.object({
  stateDirectory: z.string().required(), allowedRoots: z.array(z.string()).required(),
  catalog: z.object({ leadRole: z.string().required(), roles: z.array(role).required() }).default({ leadRole: '', roles: [] }).volatile(),
  validation: z.any(),
});
