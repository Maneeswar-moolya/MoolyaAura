/** Faults run only in guarded synthetic workers; never mutate the user's checkout. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const contract='ai/dashboard/credential-redaction.fixture.ts';
const mutants=[
  {name:'credential identifier persisted literally',file:'ai/dashboard/recorder.ts',
    from:'  const provenance = credentialProvenance(value);\n  if (provenance)',
    to:"  const provenance = credentialProvenance(value);\n  if (provenance && provenance.field === 'password')",
    marker:'credential identifier is protected by provenance despite a neutral label'},
  {name:'password persisted literally',file:'ai/dashboard/recorder.ts',
    from:'  const provenance = credentialProvenance(value);\n  if (provenance)',
    to:"  const provenance = credentialProvenance(value);\n  if (provenance && provenance.field === 'email')",
    marker:'credential password is protected and classified SECRET'},
  {name:'JSON credential profile username ignored',file:'ai/dashboard/recorder.ts',
    from:"        add(resolved?.appCredentials?.email, 'email', 'CREDENTIAL_PROFILE');",to:'',
    marker:'JSON Credential Profile username is protected through the selected profile'},
  {name:'registry credentials.email ignored',file:'ai/dashboard/recorder.ts',
    from:"    add(refs?.email && process.env[refs.email], 'email', 'APPLICATION_CREDENTIALS');",to:'',
    marker:'credential identifier is protected by provenance despite a neutral label'},
  {name:'label-only security used instead of provenance',file:'ai/dashboard/recorder.ts',
    from:'const SENSITIVE = /password|passwd|pwd|secret|token|otp|cvv|credit\\s*card|card\\s*number/i;',
    to:'const SENSITIVE = /password|passwd|pwd|secret|token|otp|cvv|credit\\s*card|card\\s*number|email|user|account|login|sign-?in/i;',
    marker:'a business email that is not a credential is NOT redacted'},
  {name:'generation ignores provenance and infers from redaction alone',file:'ai/autocode/from-recording.ts',
    from:"  if (source && (source.kind === 'CREDENTIAL_PROFILE' || source.kind === 'APPLICATION_CREDENTIALS'))",
    to:'  if (false)',
    marker:'generated code uses appCredentials.email for the protected identifier'},
  {name:'generation breaks the legacy inference for older recordings',file:'ai/autocode/from-recording.ts',
    from:"    return source.field === 'password' ? 'password' : 'email';\n  return null;",
    to:"    return source.field === 'password' ? 'password' : 'email';\n  return 'email';",
    marker:'a legacy recording without provenance keeps its original inference exactly'},
  {name:'protected value leaks through the recorded source scrub',file:'ai/dashboard/recorder.ts',
    from:'  for (const entry of protectedCredentials() as Array<RecordedValueSource & { value: string }>)\n    out = out.split(entry.value).join(PLACEHOLDER);',
    to:'',
    marker:'an account identifier survived in a URL or comment'},
];
const selected=process.argv.find(arg=>arg.startsWith('--mutant='));
if(!selected&&!process.env.AURA_SYNTHETIC_FIXTURE_ROOT){
  for(let index=0;index<mutants.length;index++){
    const result=spawnSync(process.execPath,[require.resolve('tsx/cli'),__filename,`--mutant=${index}`],{stdio:'inherit',windowsHide:true,timeout:300000});
    assert.equal(result.status,0,`Mutation ${index}: ${result.error??''}`);
  }
  console.log(`PASS ${mutants.length} credential redaction mutants killed`);
}else{
  require('./isolated-checkout');assert.equal(process.cwd(),process.env.AURA_SYNTHETIC_FIXTURE_ROOT);
  const mutant=mutants[Number(selected?.split('=')[1])];assert.ok(mutant);
  const original=fs.readFileSync(mutant.file,'utf8');assert.ok(original.includes(mutant.from),'Mutation anchor: '+mutant.name);
  try{
    fs.writeFileSync(mutant.file,original.replace(mutant.from,mutant.to));
    const result=spawnSync(process.execPath,[require.resolve('tsx/cli'),contract],{encoding:'utf8',timeout:240000,windowsHide:true});
    assert.ok(!result.error,`${mutant.name}: ${result.error}`);
    assert.notEqual(result.status,0,'SURVIVED '+mutant.name);
    assert.ok((result.stdout+result.stderr).includes(mutant.marker),'Wrong failure for '+mutant.name+': '+result.stdout+result.stderr);
    console.log('KILLED '+mutant.name);
  }finally{fs.writeFileSync(mutant.file,original);}
}
