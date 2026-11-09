import z from '@deepseek-ai/schemastery';
const role = z.object({
  name: z.string().required(), description: z.string().required(), instructions: z.string().required(),
  provider: z.string().required(), model: z.string().required(), reasoningEffort: z.string(),
});
// Schemastery arrays otherwise default to []; omission must stay distinct from an explicit empty list.
export const Config = z.object({
  stateDirectory: z.string().required(), allowedRoots: z.array(z.string()).default(undefined),
  catalog: z.object({ leadRole: z.string().required(), roles: z.array(role).required() }).default({ leadRole: '', roles: [] }).volatile(),
  validation: z.any(),
});
