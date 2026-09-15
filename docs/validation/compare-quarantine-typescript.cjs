const fs=require('fs');
const parse=file=>[...fs.readFileSync(file,'utf8').matchAll(/^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/gm)].map(match=>({file:match[1],line:Number(match[2]),column:Number(match[3]),code:match[4],message:match[5].trim()}));
const before=parse('docs/validation/quarantine-typescript-before.log'),after=parse('docs/validation/quarantine-typescript-after.log');
// Expanded inferred object displays change when optional diagnostic fields are added;
// the existing missing-property diagnostic is the same issue and callsite.
const key=item=>item.file+'|'+item.code+'|'+item.message.replace(/(Property '[^']+' does not exist on type) .*/, '$1');
const available=new Map();for(const item of before){const k=key(item);available.set(k,[...(available.get(k)||[]),item]);}
const introduced=[],matched=[];for(const item of after){const list=available.get(key(item));if(list?.length)matched.push({before:list.shift(),after:item});else introduced.push(item);}
const removed=[...available.values()].flat();const result={beforeCount:before.length,afterCount:after.length,introduced,removed,changedDiagnosticDisplay:matched.filter(pair=>pair.before.message!==pair.after.message),changedModuleExistingDiagnostics:after.filter(item=>['ai/dashboard/server.ts','ai/dashboard/live-recorder.ts'].includes(item.file))};
fs.writeFileSync('docs/validation/quarantine-typescript-comparison.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=introduced.length?1:0;
