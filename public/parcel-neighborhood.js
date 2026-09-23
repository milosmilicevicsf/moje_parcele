import {parcelGeometry} from './geo.js';
import {searchNearby,latinPlace} from './geosrbija.js';

// Include the entire parcel plus a 150 m margin within the service's 1 km query limit.
export function parcelNeighborhoodQuery(geometry){
 const min=[Infinity,Infinity],max=[-Infinity,-Infinity];
 for(const poly of geometry.projected)for(const ring of poly)for(const p of ring){
  for(let i=0;i<2;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}
 }
 const center=min.map((n,i)=>(n+max[i])/2),wanted=Math.ceil(Math.hypot(max[0]-min[0],max[1]-min[1])/2+150);
 return {center,radius:Math.min(1000,wanted),limited:wanted>1000};
}

// Persist raw records only: no nested neighborhoods or copies of computed geometry.
export function readNeighborhood(value){
 if(!value||value.version!==1||!Array.isArray(value.records)||value.records.length>1000||
  !Array.isArray(value.center)||value.center.length!==2||!value.center.every(Number.isFinite)||
  !Number.isFinite(value.radius)||value.radius<=0||value.radius>1000||
  typeof value.downloadedAt!=='string'||!Number.isFinite(Date.parse(value.downloadedAt)))throw Error('Neispravan paket okolnih parcela.');
 const parcels=[],records=[],seen=new Set();let skipped=Number.isInteger(value.skipped)&&value.skipped>=0?value.skipped:0;
 for(const record of value.records){
  try{
   if(typeof record?.title!=='string'||typeof record.fullGeom!=='string')throw Error('Invalid record');
   const key=record.uid||record.title+'|'+record.fullGeom;if(seen.has(key))continue;
   const geometry=parcelGeometry(record);seen.add(key);records.push(record);
   parcels.push({record,geometry,ko:latinPlace(record.desc),municipality:'',downloadedAt:value.downloadedAt});
  }catch{skipped++;}
 }
 if(value.records.length&&!parcels.length)throw Error('Granice okolnih parcela nisu mogle da se pročitaju.');
 const total=Math.max(records.length,Number(value.total)||0);
 const snapshot={version:1,center:value.center,radius:value.radius,limited:!!value.limited,downloadedAt:value.downloadedAt,total,skipped,records};
 return {snapshot,parcels};
}
export async function downloadNeighborhood(parcel,search=searchNearby){
 const query=parcelNeighborhoodQuery(parcel.geometry||parcelGeometry(parcel.record));
 const result=await search(...query.center,query.radius);
 return readNeighborhood({...query,...result,version:1,downloadedAt:new Date().toISOString()});
}
export function neighborhoodSummary(snapshot){
 const partial=snapshot.limited||snapshot.skipped>0||snapshot.total>snapshot.records.length;
 return snapshot.records.length+' parcela oko otvorene parcele · '+snapshot.radius+' m'+(partial?' · nepotpun prikaz':'');
}
