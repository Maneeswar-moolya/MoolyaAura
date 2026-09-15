/** Retain the action timeline without native DOM snapshots, response bodies or account data. */
import fs from 'node:fs';
import path from 'node:path';
import { diagnosticData } from './artifacts';
export async function sanitizeTrace(input:string,output:string):Promise<void> {
  const {yauzl,yazl}=require(path.join(path.dirname(require.resolve('playwright-core/package.json')),'lib/utilsBundle.js'));
  const archive=new yazl.ZipFile();
  await new Promise<void>((resolve,reject)=>{
    const destination=fs.createWriteStream(output,{flags:'wx'});
    archive.outputStream.pipe(destination);destination.on('close',resolve);destination.on('error',reject);
    yauzl.open(input,{lazyEntries:true},(error:any,zip:any)=>{
      if(error){reject(error);return;}
      zip.on('error',reject);
      zip.on('entry',(entry:any)=>{
        if(!/^[A-Za-z0-9_.-]+\.(trace|stacks|network)$/.test(entry.fileName)||entry.uncompressedSize>32*1024*1024){zip.readEntry();return;}
        zip.openReadStream(entry,(error:any,stream:any)=>{
          if(error){reject(error);return;}
          const chunks:Buffer[]=[];stream.on('data',(chunk:Buffer)=>chunks.push(chunk));stream.on('error',reject);
          stream.on('end',()=>{
            try{
              const text=Buffer.concat(chunks).toString('utf8');
              const safe=entry.fileName.endsWith('.network')?'':text.split('\n').filter(Boolean).map(line=>JSON.stringify(diagnosticData(JSON.parse(line)))).join('\n');
              archive.addBuffer(Buffer.from(safe+'\n'),entry.fileName);zip.readEntry();
            }catch(error){reject(error);zip.close();}
          });
        });
      });
      zip.on('end',()=>archive.end());zip.readEntry();
    });
  });
}
if(require.main===module)sanitizeTrace(process.argv[2],process.argv[3]).catch(()=>{process.stderr.write('Trace sanitization failed; raw trace was not retained.\n');process.exitCode=1;});
