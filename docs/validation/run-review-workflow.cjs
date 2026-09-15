// Focused ordered validation only. No live applications or complete regression sweep.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const steps={
  focused:[
    ['A','ai/dashboard/review-selectors.fixture.ts'],['A','ai/dashboard/recording-mapping.fixture.ts','--phase=catalog'],
    ['B','ai/dashboard/authoring-browser.fixture.ts'],['C','ai/dashboard/recording-mapping.fixture.ts','--phase=save'],
    ['D','ai/dashboard/recording-mapping.fixture.ts','--phase=reuse'],['E','ai/dashboard/recording-mapping.fixture.ts','--phase=isolation'],
    ['E','ai/autocode/user-confirmed-auth.fixture.ts'],['E','ai/dashboard/explicit-authoring.fixture.ts'],
    ['E','ai/autocode/ownership-reuse.fixture.ts'],['E','ai/autocode/recorded-flow.fixture.ts'],['E','ai/dashboard/dashboard-startup.fixture.ts']],
  mutations:[['F','ai/testing/recording-mapping-mutations.ts'],['F','ai/testing/user-confirmed-auth-mutations.ts'],['F','ai/testing/explicit-authoring-mutations.ts']]
};
(async()=>{const phase=process.argv[2],checks=steps[phase];if(!checks)throw Error('Use focused or mutations');const results=[];
  for(const [stage,file,...args] of checks){const started=Date.now();let output='';const child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs',file,...args],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,AURA_UI_CAPTURE_DIR:stage==='B'?path.resolve('docs/validation/review-workflow-images'):''}});
    child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
    const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
    const log=`docs/validation/review-workflow-${stage}-${path.basename(file,'.ts')}.log`;fs.writeFileSync(log,output);
    const result={stage,file,args,exitCode,seconds:(Date.now()-started)/1000,log};results.push(result);console.log(JSON.stringify(result));
    fs.writeFileSync(`docs/validation/review-workflow-${phase}-results.json`,JSON.stringify(results,null,2));
    if(exitCode!==0){console.log(output.slice(-7000));process.exitCode=1;break;}
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
