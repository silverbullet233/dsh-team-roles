/** Safe registered-route metadata; endpoint and credential values never leave this reader. */

/** Inspect exact existing native provider/model registrations without selecting a route. */
export async function registeredRouteCatalog(ctx, requests) {
  if (!Array.isArray(requests) || requests.length === 0 || requests.length > 32) throw new Error('Provide between 1 and 32 exact provider/model requests.');
  const providers = ctx.llm.listProviders();
  const output = [];
  for (const request of requests) {
    if (!request || typeof request.provider !== 'string' || !request.provider || typeof request.model !== 'string' || !request.model || Object.keys(request).some(key => !['provider', 'model'].includes(key))) {
      throw new Error('Route inspection accepts only exact provider and model names.');
    }
    const provider = providers.find(item => item.id === request.provider);
    if (provider === undefined) {
      output.push({ provider: request.provider, model: request.model, registered: false, available: false });
      continue;
    }
    const listed = (await ctx.llm.listModels(provider.id)).find(model => model.id === request.model);
    if (listed === undefined) {
      output.push({ provider: provider.id, providerName: provider.name, model: request.model, registered: true, available: false });
      continue;
    }
    const resolved = await ctx.llm.resolveModelInfo(provider.id, listed.id);
    output.push({
      provider: provider.id, providerName: provider.name, model: listed.id, modelName: listed.name,
      registered: true, available: true,
      reasoningEfforts: resolved.reasoning?.efforts.map(effort => ({ id: effort.id, name: effort.name })) ?? [],
      defaultReasoningEffort: resolved.reasoning?.defaultEffort ?? null,
    });
  }
  return output;
}

/** Presence metadata required before native browser authentication can activate. */
export async function nativeCredentialPresence(ctx, refs = []) {
  if (!Array.isArray(refs) || refs.some(ref => typeof ref !== 'string')) throw new Error('Credential references must be a string array.');
  const browser = await ctx.credentials.describeRecord('client-connection/browser-session');
  const references = await Promise.all(refs.map(async ref => {
    const descriptor = await ctx.credentials.describe(ref);
    return { ref, configured: descriptor.configured, ...(descriptor.source === undefined ? {} : { source: descriptor.source }), writable: descriptor.writable };
  }));
  return { browserSessionConfigured: browser.configured && browser.kind === 'grant', writable: browser.writable, references };
}
