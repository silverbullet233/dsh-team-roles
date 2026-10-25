/** Read-only native provider catalog validation; never starts a Session or inference. */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime from '@deepseek-ai/dsh-llm';
import Authorization from '@deepseek-ai/dsh-authorization';
import PlatformAccount from '@deepseek-ai/dsh-deepseek-account-platform';
import * as AccountAdapter from '@deepseek-ai/dsh-llm-deepseek-account';
import * as PiAiAdapter from '@deepseek-ai/dsh-llm-pi-ai';
import { createLaunchEnvironmentSnapshot, launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
import ReadOnlyNativeCredentials from '../../src/auth/provider.mjs';
import { registeredRouteCatalog } from '../../src/auth/catalog.mjs';

export const nativeCatalogRequests = Object.freeze([
  Object.freeze({ provider: 'deepseek-account', model: 'deepseek-flash' }),
  Object.freeze({ provider: 'opencode-go', model: 'deepseek-v4.1-flash' }),
]);

/** Mount existing native adapter registrations with read-only credentials and no endpoint override. */
export async function mountNativeProviders(ctx, { credentialsPath = '/Users/mxr/.dsh/.credentials.yaml' } = {}) {
  if (ctx.get('credentials') === undefined) await ctx.plugin(ReadOnlyNativeCredentials, { path: credentialsPath });
  const accountCredential = await ctx.credentials.describeRecord('deepseek-account-platform/default');
  const opencodeCredential = await ctx.credentials.describeRecord('llm-pi-ai/opencode-go');
  const opencodeReference = await ctx.credentials.describe('OPENCODE_API_KEY');
  const opencodeLaunchReference = launchEnvironmentOf(ctx).get('OPENCODE_API_KEY');
  const opencodeLaunchConfigured = typeof opencodeLaunchReference?.value === 'string' && opencodeLaunchReference.value.length > 0;
  if (accountCredential.writable || opencodeCredential.writable) throw new Error('The validation host requires read-only native credentials.');
  if (ctx.get('llm') === undefined) await ctx.plugin(LlmRuntime);
  if (ctx.get('authorization') === undefined) await ctx.plugin(Authorization);
  if (ctx.get('deepseekAccount') === undefined) await ctx.plugin(PlatformAccount);
  if (!ctx.llm.listProviders().some(provider => provider.id === 'deepseek-account')) {
    await ctx.plugin(AccountAdapter, { reasoningEffort: 'max' });
  }
  if (!ctx.llm.listProviders().some(provider => provider.id === 'opencode-go')) {
    await ctx.plugin(PiAiAdapter, { providers: { 'opencode-go': {} } });
  }
  return {
    deepseekAccountCredentialConfigured: accountCredential.configured,
    opencodeGoCredentialConfigured: opencodeCredential.configured || opencodeReference.configured || opencodeLaunchConfigured,
    opencodeGoRecordConfigured: opencodeCredential.configured,
    opencodeApiKeyReferenceConfigured: opencodeReference.configured,
    opencodeNativeLaunchReferenceConfigured: opencodeLaunchConfigured,
    opencodeNativeLaunchReferenceSource: opencodeLaunchConfigured ? opencodeLaunchReference.source : null,
    credentialsWritable: false,
  };
}

/** Return only names, availability and native reasoning efforts for the two exact requested routes. */
export async function readNativeCatalog(ctx) {
  return registeredRouteCatalog(ctx, nativeCatalogRequests);
}

/** One isolated metadata-only run; native account listing diagnostics are reduced to safe outcome tags. */
export async function inspectNativeCatalog({ credentialsPath, sourceDirectory = '/Users/mxr/github/deepseek/deepseek-harness' } = {}) {
  const sourceSha = execFileSync('git', ['-C', sourceDirectory, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (sourceSha !== '22ddee3792402c3e70ec5f86a63c3e3e895a2f60') throw new Error('Native catalog inspection requires the pinned DSH source commit.');
  const ctx = new Context();
  const inheritedOpenCodeKey = launchEnvironmentOf(ctx).getFrom('OPENCODE_API_KEY', ['process']);
  ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot(inheritedOpenCodeKey?.value
    ? [{ source: 'process', values: { OPENCODE_API_KEY: inheritedOpenCodeKey.value } }] : []));
  let accountListing = 'unobserved';
  let accountListingFailure = null;
  const originalError = console.error;
  const originalWarn = console.warn;
  const accountDiagnostic = (original) => (...args) => {
    if (args[0] === '[llm-deepseek-account]') {
      const text = typeof args[1] === 'string' ? args[1] : '';
      if (text.includes(' loaded ') && text.includes(' model(s), skipped ')) accountListing = 'loaded';
      if (text.includes(' failed (')) {
        accountListing = 'fallback';
        accountListingFailure = text.includes('could not reach ') ? 'transport'
          : text.includes(' timed out after ') ? 'timeout'
            : /answered HTTP (\d{3})/.test(text) ? `http-${text.match(/answered HTTP (\d{3})/)[1]}` : 'listing-failed';
      }
      return;
    }
    original(...args);
  };
  console.error = accountDiagnostic(originalError);
  console.warn = accountDiagnostic(originalWarn);
  try {
    const credentials = await mountNativeProviders(ctx, { credentialsPath });
    const routes = await readNativeCatalog(ctx);
    const readyForRequestedLiveInference = accountListing === 'loaded'
      && credentials.deepseekAccountCredentialConfigured && credentials.opencodeGoCredentialConfigured
      && routes.every(route => route.available && route.reasoningEfforts.some(effort => effort.id === 'max'));
    return { sourceSha, metadataOnly: true, inferenceRequests: 0, readyForRequestedLiveInference, accountListing, accountListingFailure, credentials, routes };
  } finally {
    await ctx.fiber.dispose();
    console.error = originalError;
    console.warn = originalWarn;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await inspectNativeCatalog({ credentialsPath: process.env.DSH_NATIVE_CREDENTIALS_PATH });
    console.log(JSON.stringify(result, null, 2));
    if (!result.readyForRequestedLiveInference) process.exitCode = 2;
  } catch (error) {
    console.error(JSON.stringify({ code: typeof error.code === 'string' ? error.code : 'catalog/unavailable', message: 'Native catalog inspection failed; no model inference was attempted.' }));
    process.exitCode = 1;
  }
}
