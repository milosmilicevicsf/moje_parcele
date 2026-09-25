import {normalize,parcelGeometry} from './geo.js';

// Colours that stay readable on the light map and on satellite imagery.
export const PALETTE=['#e8590c','#1c7ed6','#ae3ec9','#f59f00','#0ca678','#e64980'];
export const colorOf=x=>PALETTE.includes(x.color)?x.color:PALETTE[0];
export const nameOf=x=>x.label?x.label+' · '+x.record.title:'Parcela '+x.record.title;
export const geometryOf=x=>x.geometry||=parcelGeometry(x.record);
export const totalArea=items=>items.reduce((sum,x)=>sum+geometryOf(x).area,0);
export const hectares=m2=>(m2/10000).toLocaleString('sr-Latn',{maximumFractionDigits:2})+' ha';
export const parcelCount=n=>n+' '+(n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?'parcele':'parcela');

// A searched parcel stores "KO" and "municipality", one picked on the map both words in ko; normalizing joins them.
export function groupByPlace(items){
  const groups=new Map();
  for(const x of items){
    const key=normalize([x.ko,x.municipality].join(' '));
    if(!groups.has(key))groups.set(key,{place:[x.ko,x.municipality].filter(Boolean).join(', ')||'Bez mesta',items:[]});
    groups.get(key).items.push(x);
  }
  const byName=(a,b)=>(a.label||a.record.title).localeCompare(b.label||b.record.title,'sr',{numeric:true});
  return [...groups.values()].sort((a,b)=>a.place.localeCompare(b.place,'sr')).map(g=>({...g,items:g.items.sort(byName)}));
}
