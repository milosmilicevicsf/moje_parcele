import {normalize,normalizeNumber,selectRecords,latinWords} from './geo.js';
import {GEOSRBIJA_URL} from './config.js';
// The public a3.geosrbija.rs search accepts JSON requests without a session or token
// (verified from captured browser traffic on 2026-09-23). Two request shapes are used:
// text search ("q") and the spatial "circle" search the map viewer runs on every click.
const LAYERS='507,941,948,695,694,693,589,587,586,588,939,899,1178,1177,910,49,AdaptiveNames,AdaptiveAddresses,AdaptiveThemes';
// Cadastral parcels are split into regional layers (circle queries in 32 towns, 2026-09-25): 586 west and
// central Serbia, 587 Kragujevac/Kraljevo/Kruševac, 588 Niš and the east, 589 the south, 899 Vojvodina,
// 939 Belgrade. A missing layer silently returns an empty result in its region. The same query on 49
// returns settlement outlines and on 910 addresses, so those stay out.
const PARCEL_LAYERS='586,587,588,589,899,939,';
const unreachable='Veza sa GeoSrbija servisom nije uspela. Otvorite https://a3.geosrbija.rs/ u običnom Chrome tabu. Ako ni tamo ne radi, proverite vezu ili pokušajte kasnije. Ako sajt radi, ponovite pretragu; servis za parcele može biti privremeno nedostupan.';

export function textRequest(parcel,ko){
  return {q:parcel+' '+normalize(ko),srsid:'32634',start:0,limit:100,layers:LAYERS,bbox:{bottom:4750000,left:300000,top:5200000,right:700000}};
}
// east/north in EPSG:32634, radius in metres.
export function nearbyRequest(east,north,radius){
  if(![east,north,radius].every(Number.isFinite)||radius<=0||radius>1000)throw new Error('Neispravan prostorni upit.');
  return {srsid:'32634',st:'circle',s:east.toFixed(2)+','+north.toFixed(2)+','+Math.round(radius),start:0,limit:100,layers:PARCEL_LAYERS};
}
// "PEPELJEVAC LAJKOVAC ПЕПЕЉЕВАЦ ЛАЈКОВАЦ" -> "Pepeljevac Lajkovac"; "GROŠNICA I KRAGUJEVAC ..." -> "Grošnica I Kragujevac".
export function latinPlace(desc){
  return latinWords(desc).map(w=>/^[IVX]+$/.test(w)?w:w.toLowerCase().replace(/\p{L}/u,c=>c.toUpperCase())).join(' ');
}
const isPolygon=r=>/^(?:MULTI)?POLYGON\b/i.test(String(r.fullGeom||'').trim());

async function call(request){
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),35000);
  try {
    const response=await fetch(GEOSRBIJA_URL,{
      method:'POST',signal:controller.signal,
      headers:{'Content-Type':'application/json; charset=utf-8'},
      body:JSON.stringify({request})
    }).catch(error=>{if(error.name==='TypeError')throw new Error(unreachable);throw error;});
    if(!response.ok)throw new Error('GeoSrbija pretraga nije dostupna (HTTP '+response.status+').');
    const json=await response.json(), data=json.d||json;
    if(data?.sessionExpired)throw new Error('GeoSrbija traži važeću sesiju. Otvorite GeoSrbiju u browseru pa ponovite pretragu.');
    if(data?.success!==true||!Array.isArray(data.records))throw new Error('GeoSrbija nije vratila uspešan rezultat. Servis je možda privremeno nedostupan ili je promenio interfejs.');
    return data;
  } catch(error) {
    if(error.name==='AbortError')throw new Error('GeoSrbija servis nije odgovorio za 35 sekundi. Otvorite https://a3.geosrbija.rs/ u običnom Chrome tabu da proverite dostupnost, pa pokušajte ponovo.');
    if(error.name==='SyntaxError')throw new Error('GeoSrbija servis je vratio nečitljiv odgovor. Pokušajte kasnije.');
    throw error;
  } finally {clearTimeout(timer);}
}

export async function searchParcel(parcel,ko,municipality) {
  parcel=normalizeNumber(parcel);
  if(!normalize(ko)||!normalize(municipality))throw new Error('Unesite katastarsku opštinu i opštinu/grad.');
  const data=await call(textRequest(parcel,ko));
  if(data.total>100)throw new Error('Previše rezultata. Potrebna je preciznija pretraga.');
  const matches=selectRecords(data.records,parcel,ko,municipality);
  if(!matches.length)throw new Error('Nema podudaranja za ovaj broj, katastarsku opštinu i opštinu/grad. Proverite unos.');
  return matches;
}

// Parcels whose boundary lies within `radius` metres of a UTM point; the map viewer uses 12 m for a click.
export async function searchNearby(east,north,radius) {
  const request=nearbyRequest(east,north,radius), records=[], seen=new Set();
  let total=0;
  // Bound work even if the upstream ignores pagination or reports a bogus total.
  for(let page=0;page<10;page++){
    const data=await call({...request,start:page*request.limit});
    total=Math.max(total,Number(data.total)||0);
    let added=0;
    for(const record of data.records.filter(r=>typeof r.title==='string'&&isPolygon(r))){
      const key=record.uid||record.title+'|'+record.fullGeom;
      if(!seen.has(key)){seen.add(key);records.push(record);added++;}
    }
    if(!added||data.records.length<request.limit||(page+1)*request.limit>=total)break;
  }
  return {records,total:Math.max(total,records.length)};
}
