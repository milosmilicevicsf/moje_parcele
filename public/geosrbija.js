import {normalize,normalizeNumber,selectRecords} from './geo.js';
const base='https://a3.geosrbija.rs/';
// Public application identifier published by GeoSrbija, not an authentication token.
// Direct SearchProxy requests were verified without a homepage visit on 2026-09-16.
// The public search service accepts JSON requests without a session header.
export async function searchParcel(parcel,ko,municipality) {
  parcel=normalizeNumber(parcel);
  if(!normalize(ko)||!normalize(municipality))throw new Error('Unesite katastarsku opštinu i opštinu/grad.');
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),35000);
  try {
    const response=await fetch(base+'WebServices/search/SearchProxy.asmx/Search',{
      method:'POST',signal:controller.signal,
      headers:{'Content-Type':'application/json; charset=utf-8'},
      body:JSON.stringify({request:{q:parcel+' '+normalize(ko),srsid:'32634',start:0,limit:100,layers:'507,941,948,695,694,693,589,587,586,588,939,899,1178,1177,910,49,AdaptiveNames,AdaptiveAddresses,AdaptiveThemes',bbox:{bottom:4750000,left:300000,top:5200000,right:700000}}})
    }).catch(error=>{
      if(error.name==='TypeError')throw new Error('Veza sa GeoSrbija servisom nije uspela. Otvorite https://a3.geosrbija.rs/ u običnom Chrome tabu. Ako ni tamo ne radi, proverite vezu ili pokušajte kasnije. Ako sajt radi, ponovite pretragu; servis za parcele može biti privremeno nedostupan.');
      throw error;
    });
    if(!response.ok)throw new Error('GeoSrbija pretraga nije dostupna (HTTP '+response.status+').');
    const json=await response.json(), data=json.d||json;
    if(data?.sessionExpired)throw new Error('GeoSrbija traži važeću sesiju. Otvorite GeoSrbiju u browseru pa ponovite pretragu.');
    if(data?.success!==true||!Array.isArray(data.records))throw new Error('GeoSrbija nije vratila uspešan rezultat. Servis je možda privremeno nedostupan ili je promenio interfejs.');
    if(data.total>100)throw new Error('Previše rezultata. Potrebna je preciznija pretraga.');
    const matches=selectRecords(data.records,parcel,ko,municipality);
    if(!matches.length)throw new Error('Nema podudaranja za ovaj broj, katastarsku opštinu i opštinu/grad. Proverite unos.');
    return matches;
  } catch(error) {
    if(error.name==='AbortError')throw new Error('GeoSrbija servis nije odgovorio za 35 sekundi. Otvorite https://a3.geosrbija.rs/ u običnom Chrome tabu da proverite dostupnost, pa pokušajte ponovo.');
    if(error.name==='SyntaxError')throw new Error('GeoSrbija servis je vratio nečitljiv odgovor. Pokušajte kasnije.');
    throw error;
  } finally {clearTimeout(timer);}
}
