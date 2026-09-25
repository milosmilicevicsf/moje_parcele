import {PERSONAL} from './portfolio.js';

// One file with every saved parcel, the user's own data and the photos. Downloaded surroundings (roads and
// neighbouring parcels) are left out: they make up most of the size and the app downloads them again.
export const BACKUP_KIND='moje-parcele-rezervna-kopija';
const DOWNLOADED=['osm','neighborhood','geometry'];
const PHOTO_TYPE=/^image\/(jpeg|png|webp|gif|heic|heif)$/;

export function backupParcel(x){const copy={...x};for(const k of DOWNLOADED)delete copy[k];return copy;}

export async function toBase64(blob){
 const bytes=new Uint8Array(await blob.arrayBuffer());let text='';
 for(let i=0;i<bytes.length;i+=0x8000)text+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
 return btoa(text);
}
export function fromBase64(data,type){
 const text=atob(data),bytes=new Uint8Array(text.length);
 for(let i=0;i<text.length;i++)bytes[i]=text.charCodeAt(i);
 return new Blob([bytes],{type:PHOTO_TYPE.test(type)?type:'image/jpeg'});
}

// Each photo goes into the file as its own part, so the whole backup never has to exist as one string.
export async function backupBlob(parcels,photos,exportedAt=new Date().toISOString()){
 const head=JSON.stringify({kind:BACKUP_KIND,version:1,exportedAt,parcels:parcels.map(backupParcel)});
 const parts=[head.slice(0,-1)+',"photos":['];
 for(const [i,p] of photos.entries())parts.push((i?',':'')+JSON.stringify({id:p.id,parcel:p.parcel,at:p.at,coords:p.coords??null,accuracy:p.accuracy??null,type:p.blob.type||'image/jpeg',data:await toBase64(p.blob)}));
 parts.push(']}');
 return new Blob(parts,{type:'application/json'});
}

const point=c=>Array.isArray(c)&&c.length===2&&c.every(Number.isFinite);
// Anything that is not a backup gives null, so a single exported parcel still opens as before.
export function readBackup(data){
 if(data?.kind!==BACKUP_KIND)return null;
 if(!Array.isArray(data.parcels))throw Error('Rezervna kopija je oštećena: nema spiska parcela.');
 const photos=(Array.isArray(data.photos)?data.photos:[]).filter(p=>typeof p?.id==='string'&&typeof p.parcel==='string'&&typeof p.data==='string'&&(p.coords==null||point(p.coords)));
 return {parcels:data.parcels,photos,exportedAt:data.exportedAt};
}

// A parcel already on this phone keeps what the user has here; the backup only fills empty fields and adds missing points.
export function mergeParcel(existing,incoming){
 if(!existing)return incoming;
 const merged={...existing};
 for(const k of PERSONAL)if(k!=='marks'&&merged[k]===undefined&&incoming[k]!==undefined)merged[k]=incoming[k];
 const have=new Set((existing.marks||[]).map(m=>m.id)),extra=(incoming.marks||[]).filter(m=>!have.has(m.id));
 if(extra.length)merged.marks=[...(existing.marks||[]),...extra];
 return merged;
}
