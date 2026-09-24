import {normalize} from './geo.js';
// eKatastar opens the parcel form with municipality and cadastral municipality preselected
// for a KO registry number; the parcel number and captcha stay with the user.
export const EKATASTAR_HOME='https://katastar.rgz.gov.rs/eKatastarPublic/Default.aspx';
export const ekatastarUrl=koId=>'https://katastar.rgz.gov.rs/eKatastarPublic/FindParcela.aspx?KoID='+encodeURIComponent(koId);

// ko-ids.txt lines: "municipality|cadastral municipality|KO number", names already normalized.
export function parseKoTable(text){
  const entries=[];
  for(const line of String(text).split('\n')){
    if(!line||line.startsWith('#'))continue;
    const [opstina,ko,id]=line.split('|');
    if(opstina&&ko&&/^\d{6}$/.test(id))entries.push({opstina,ko,id});
  }
  return entries;
}
// GeoSrbija desc repeats "KO MUNICIPALITY" in Latin and Cyrillic; keep the Latin half.
function latinDesc(desc){return normalize(String(desc||'').split(/\s+/).filter(w=>w&&!/[\u0400-\u04FF]/.test(w)).join(' '));}
const words=s=>new Set(s.split(' ').filter(Boolean));
// RGZ disambiguates repeated municipality names in parentheses, e.g. "palilula nis".
function sameMunicipality(entry,text){
  if(!text)return false;
  if(entry===text)return true;
  const a=words(entry),b=words(text);
  return [...b].every(w=>a.has(w))||[...a].every(w=>b.has(w));
}
// Returns the KO number only when exactly one registry entry matches; never guesses between namesakes.
export function findKoId(entries,{desc,ko='',municipality=''}){
  const text=latinDesc(desc),koName=normalize(ko),place=normalize(municipality);
  let candidates=entries.filter(e=>text===e.ko+' '+e.opstina||text.startsWith(e.ko+' ')||text===e.ko);
  if(koName&&candidates.some(e=>e.ko===koName))candidates=candidates.filter(e=>e.ko===koName);
  if(candidates.length>1){
    const exact=candidates.filter(e=>text===e.ko+' '+e.opstina);
    if(exact.length)candidates=exact;
    else candidates=candidates.filter(e=>sameMunicipality(e.opstina,text.slice(e.ko.length+1))||sameMunicipality(e.opstina,place));
  }
  if(candidates.length>1){
    // Prefer the longest KO name ("velika vrbnica gornja" over "velika") when the rest matches.
    const longest=Math.max(...candidates.map(e=>e.ko.length));
    candidates=candidates.filter(e=>e.ko.length===longest);
  }
  const ids=new Set(candidates.map(e=>e.id));
  return ids.size===1?[...ids][0]:null;
}
