/** READ-ONLY probe: the exact statement TC_SMOKE_026 died on, against the real ksp registry. */
process.env.AURA_APPLICATION='ksp';process.env.AURA_ENVIRONMENT='stg';process.env.AURA_RUN_ID='readonly-probe';
delete process.env.AURA_EXECUTION_SELECTION;
const recorded='https://stgsupport.keysight.com/us/en/home';
function attempt(label:string){
  delete require.cache[require.resolve(require('node:path').resolve(process.cwd(),'tests-e2e/support/execution-environment'))];
  try{const {executionUrl}=require(require('node:path').resolve(process.cwd(),'tests-e2e/support/execution-environment'));console.log(label,'->',executionUrl(recorded));}
  catch(error:any){console.log(label,'-> REFUSED:',error.message);}
}
delete process.env.AURA_EXECUTION_CONTEXT;delete process.env.AURA_SOURCE_ENVIRONMENT;
attempt('no context (the state this case failed in)');
process.env.AURA_SOURCE_ENVIRONMENT='stg';
attempt('flat AURA_SOURCE_ENVIRONMENT=stg');
delete process.env.AURA_SOURCE_ENVIRONMENT;
process.env.AURA_EXECUTION_CONTEXT=JSON.stringify({applicationId:'ksp',environmentId:'stg',sourceEnvironmentId:'stg',browserEngine:'chromium',headed:true,locatorTimeoutMs:40000});
attempt('full AURA_EXECUTION_CONTEXT (source stg, headed)');
process.env.AURA_EXECUTION_CONTEXT=JSON.stringify({applicationId:'ksp',environmentId:'stg',sourceEnvironmentId:'qa',browserEngine:'chromium',headed:true,locatorTimeoutMs:40000});
attempt('source qa rebased onto target stg');
process.env.AURA_EXECUTION_CONTEXT=JSON.stringify({applicationId:'ksp',environmentId:'stg',sourceEnvironmentId:'nowhere',browserEngine:'chromium',headed:false,locatorTimeoutMs:40000});
attempt('unconfigured source');
