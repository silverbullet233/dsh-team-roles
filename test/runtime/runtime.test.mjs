import assert from 'node:assert/strict';
import test from 'node:test';
import { requireSupportedVersion, requireCapabilities, verifyRuntime } from '../../scripts/runtime/verify.mjs';
const native = async () => {
 const [agent,controller,team,projections,boot,reflection]=await Promise.all([import('@deepseek-ai/dsh-agent'),import('@deepseek-ai/dsh-api-session-controller'),import('@deepseek-ai/dsh-experimental-agent-team'),import('@deepseek-ai/dsh-session-projection'),import('@deepseek-ai/dsh-app-boot'),import('@deepseek-ai/dsh-api-session-controller/typert')]);
 return {agent,controller,team,projections,boot,reflection};
};
test('the supported official npm runtime exposes matching APIs, reflection and Web assets', async () => {
 const result=await verifyRuntime();assert.equal(result.packageVersion,'0.2.2-alpha.2');assert.equal(result.sourceSha,null);assert.equal(result.build.kind,'official-npm-release');assert.equal(result.capabilities.generatedReflection,true);
 assert.match(result.resolvedModules.sessionReflection,/dsh-api-session-controller\/lib\/typert.host.js$/);
});
test('only the exact validated release version is accepted', () => {
 requireSupportedVersion('0.2.2-alpha.2');
 for(const version of ['0.2.1-rc.3','0.2.1-rc.4','0.2.2-alpha.3','0.2.2']) assert.throws(()=>requireSupportedVersion(version),/unsupported/);
});
test('missing public model-selection APIs fail with an actionable capability name', async () => {
 const modules=await native();
 assert.throws(()=>requireCapabilities({...modules,agent:{AgentModel:class {},modelSelectionProjectionDefinition:modules.agent.modelSelectionProjectionDefinition}}),/agent.model.select/);
});
test('missing session reflection and controller calls cannot pass capability verification', async () => {
 const modules=await native();
 assert.throws(()=>requireCapabilities({...modules,reflection:{TYPERT:{invocations:[]}}}),/session\/create reflection/);
 assert.throws(()=>requireCapabilities({...modules,controller:{SessionController:class {}}}),/SessionController.create/);
});
test('a profile cannot use a different CLI version or bypass installation module identity', async () => {
 const { mkdtemp,writeFile,rm }=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const root=await mkdtemp(join(tmpdir(),'dsh-release-anchor-'));const anchor=join(root,'package.json');
 try {
  await writeFile(anchor,JSON.stringify({name:'@deepseek-ai/dsh',version:'0.2.1-rc.4'}));
  await assert.rejects(verifyRuntime({context:{get:name=>name==='profileContext'?{installAnchor:anchor}:undefined}}),{code:'DSH_RUNTIME_INCOMPATIBLE'});
  await writeFile(anchor,JSON.stringify({name:'@deepseek-ai/dsh',version:'0.2.2-alpha.2'}));
  await assert.rejects(verifyRuntime({context:{get:name=>name==='profileContext'?{installAnchor:anchor}:{packageOf:()=>({dir:root})}}}),/differs from the serving installation/);
 } finally {await rm(root,{recursive:true,force:true});}
});
