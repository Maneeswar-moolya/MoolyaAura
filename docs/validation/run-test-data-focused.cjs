const fs=require('fs'),cp=require('child_process');
const group=process.argv[2]||'focused';
const groups={focused:[
 ['ai/dashboard/test-data.fixture.ts'],['ai/dashboard/test-data.browser.fixture.ts','--runtime'],['ai/dashboard/test-data.security.fixture.ts'],
 ['ai/autocode/user-confirmed-auth.fixture.ts'],['ai/dashboard/recording-mapping.fixture.ts'],['ai/dashboard/authoring-browser.fixture.ts'],['ai/dashboard/authoring-workspace.fixture.ts'],
 ['ai/dashboard/quarantine-workspace.fixture.ts','--phase=package'],['ai/dashboard/quarantine-workspace.fixture.ts','--phase=editing'],['ai/dashboard/quarantine-workspace.fixture.ts','--phase=rerun'],['ai/dashboard/quarantine-workspace.fixture.ts','--phase=route'],
 ['ai/dashboard/secret-redaction.fixture.ts'],['ai/projects/execution-isolation.fixture.ts'],['ai/dashboard/environment-execution.fixture.ts']
],mutations:[['ai/testing/test-data-mutations.ts'],['ai/testing/user-confirmed-auth-mutations.ts']],
 'supplemental-mutations':[17,18,19].map(i=>['ai/testing/test-data-mutations.ts','--mutant='+i])};
const results=[];
for(const args of groups[group]){const started=Date.now(),key=args.join(' ').replace(/[^a-z0-9_-]/gi,'_');console.log('START '+args.join(' '));const r=cp.spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs',...args],{encoding:'utf8',windowsHide:true,timeout:group==='mutations'?900000:330000,maxBuffer:12*1024*1024});fs.writeFileSync('docs/validation/test-data-'+key+'.log',(r.stdout||'')+(r.stderr||'')+(r.error?.message||''));results.push({args,exitCode:r.status,milliseconds:Date.now()-started,error:r.error?.message});fs.writeFileSync('docs/validation/test-data-'+group+'-results.json',JSON.stringify(results,null,2));console.log((r.status===0?'PASS ':'FAIL ')+args.join(' '));if(r.status!==0){console.log((r.stdout+r.stderr).slice(-3500));break;}}
process.exitCode=results.length!==groups[group].length||results.some(r=>r.exitCode!==0)?1:0;
