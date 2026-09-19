/** Download free official 2026 source files. No credentials or paid APIs. */
import {mkdir,writeFile} from 'node:fs/promises';
const root='data/candidates/raw';
await mkdir(root,{recursive:true});
async function download(url,file){
 let last;
 for(let attempt=0;attempt<3;attempt++){
  try{
   const res=await fetch(url,{signal:AbortSignal.timeout(45000)});
   if(!res.ok)throw new Error('HTTP '+res.status);
   const body=Buffer.from(await res.arrayBuffer());
   await writeFile(root+'/'+file,body);
   console.log(file,body.length,'bytes');
   return body;
  }catch(e){last=e;}
 }
 throw new Error(file+': '+last.message);
}
for(const [file,url] of [
 ['fec.zip','https://www.fec.gov/files/bulk-downloads/2026/cn26.zip'],
 ['ca.pdf','https://elections.cdn.sos.ca.gov/statewide-elections/2026-general/cert-list-candidates.pdf'],
 ['md.csv','https://elections.maryland.gov/elections/2026/general_candidates/2026_GG_statewide_candidatelist.csv'],
])await download(url,file);
const indexUrl='https://voterguide.sos.ca.gov/candidates/';
const index=(await download(indexUrl,'ca-guide-index.html')).toString();
const urls=[...new Set([...index.matchAll(/href="([^"]+candidate-statements\.htm)"/g)].map(m=>new URL(m[1],indexUrl).href))].filter(u=>!u.includes('info-about'));
for(const url of urls){
 const file='ca-'+new URL(url).pathname.split('/').pop().replace('-candidate-statements.htm','.html');
 await download(url,file);
}

