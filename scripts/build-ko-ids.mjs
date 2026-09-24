// Builds public/ko-ids.txt from rows of https://katastar.rgz.gov.rs/JavniOglasi/katastarske-opstine
// saved as TSV: page, municipality, municipality number, cadastral municipality, KO number, status.
// Usage: node scripts/build-ko-ids.mjs <dir with *.tsv> [YYYY-MM-DD]
import fs from 'node:fs';
import path from 'node:path';
import {normalize} from '../public/geo.js';

const [dir,retrieved=new Date().toISOString().slice(0,10)]=process.argv.slice(2);
if(!dir)throw Error('Usage: node scripts/build-ko-ids.mjs <dir> [date]');
const rows=new Map(),problems=[];
for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.tsv')).sort()){
  for(const line of fs.readFileSync(path.join(dir,file),'utf8').split('\n')){
    const cols=line.split('\t').map(s=>s.trim());
    if(cols.length<2)continue;
    if(cols[1]==='FAILED'){problems.push('page '+cols[0]+' failed');continue;}
    if(cols[1]==='EMPTY')continue;
    const [,opstina,,ko,id]=cols;
    if(!opstina||!ko||!/^\d{6}$/.test(id)){problems.push('bad row: '+line);continue;}
    rows.set(id,[normalize(opstina),normalize(ko),id]);
  }
}
const lines=[...rows.values()].sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1])).map(r=>r.join('|'));
fs.writeFileSync('public/ko-ids.txt','# Katastarske opštine (RGZ, katastar.rgz.gov.rs/JavniOglasi/katastarske-opstine), preuzeto '+retrieved+'\n# opština|katastarska opština|matični broj KO (KoID za eKatastar)\n'+lines.join('\n')+'\n');
console.log(lines.length+' KO written');
if(problems.length){console.error(problems.join('\n'));process.exitCode=1;}
