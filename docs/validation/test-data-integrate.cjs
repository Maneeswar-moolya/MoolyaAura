const fs=require('fs');
function edit(file,from,to){const source=fs.readFileSync(file,'utf8');if(!source.includes(from))throw Error('Missing edit anchor in '+file);fs.writeFileSync(file,source.replace(from,to));}
edit('ai/dashboard/test-data.browser.fixture.ts',"modal=page.getByRole('dialog').last();", "modal=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Add Credential Profile',exact:true})});");
