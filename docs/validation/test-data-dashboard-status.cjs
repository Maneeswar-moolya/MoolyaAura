async function main(){
 const output={};for(const [key,route]of Object.entries({health:'/api/health',recording:'/api/record',generation:'/api/autocode',runs:'/api/runs?applicationId=ksp'})){
  try{const r=await fetch('http://127.0.0.1'+route,{signal:AbortSignal.timeout(3000)}),data=await r.json();output[key]=key==='health'?{status:r.status,api:data.api}:key==='runs'?{active:data.active??null}: {recording:data.recording??null,running:data.running??null,active:data.active??null,status:data.status??null};}catch{output[key]={unavailable:true};}
 }console.log(JSON.stringify(output));
}
main();
