// Read-only investigation helper. Never prints configured identities, secrets or URL queries.
const fs=require('node:fs');require('dotenv').config({quiet:true});
const registry=JSON.parse(fs.readFileSync('ai/projects/registry.json','utf8'));
const names=new Set(Object.keys(process.env).filter(name=>/(PASSWORD|PASSWD|PWD|TOKEN|SECRET|API_KEY|PRIVATE_KEY|EMAIL|USERNAME)/i.test(name)));
for(const app of registry.applications)for(const environment of Object.values(app.environments))for(const name of Object.values(environment.credentials||{}))names.add(name);
function safe(value){let text=String(value);for(const name of names){const secret=process.env[name];if(secret&&secret.length>=3)text=text.split(secret).join('[REDACTED]');}
  return text.replace(/https?:\/\/[^\s'"<>\\]+/g,value=>{try{const u=new URL(value);return u.origin+u.pathname;}catch{return '[URL REDACTED]';}}).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[IDENTITY REDACTED]').replace(/\.fill\(\s*(['"])(.*?)\1\s*\)/g,'.fill("[INPUT REDACTED]")');}
module.exports={safe};
if(require.main===module)for(const file of process.argv.slice(2)){console.log('\nFILE '+file);console.log(safe(fs.readFileSync(file,'utf8')));}
