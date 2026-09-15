const {spawnSync}=require('child_process'),fs=require('fs');let failed=false;const selected=[1,6,7,8,9,10,11];
for(const index of selected){const result=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','ai/testing/authoring-workspace-mutations.ts','--mutant='+index],{encoding:'utf8',timeout:300000,windowsHide:true,maxBuffer:5*1024*1024});process.stdout.write((result.stdout||'')+(result.stderr||''));if(result.status!==0){failed=true;break;}}
if(!failed)process.stdout.write('PASS all 7 selected Code Workspace mutants killed\n');process.exitCode=failed?1:0;
