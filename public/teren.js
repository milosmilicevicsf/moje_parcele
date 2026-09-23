import {parcelGeometry,wgs84ToUtm34} from './geo.js';
import {searchParcel as liveSearch,searchNearby,latinPlace} from './geosrbija.js';
import {local,unlocal,boundary,bearing,distance} from './field-geo.js';
import {SURROUNDINGS_URL} from './config.js';
import {createNearbyLoader,nearbyFixState} from './nearby-loader.js';
const $=s=>document.getElementById(s), canvas=$('map'),ctx=canvas.getContext('2d');
// Search radius for the automatically loaded cadastral neighborhood.
const NEARBY_RADIUS=150;
// Projection origin before any parcel is shown; replaced by the parcel or the first GPS fix.
let current=null, nearby=[], saved=[], db, shellReady=false, gps=null,watch=null,following=false,selection=0,view={origin:[20.9,44.2],center:[0,0],scale:2},width=0,height=0,roadsBusy=false;
const message=(s,error=false)=>{$('message').textContent=s;$('message').className=error?'error':'';};
const metres=m=>m<1000?Math.round(m)+' m':(m/1000).toFixed(1)+' km';
let nearbyMode=true,nearbyState={kind:'waiting',detail:''},gpsError=null;
const date=s=>new Date(s).toLocaleDateString('sr-Latn');
function validPackage(x){if(!x||typeof x.ko!=='string'||typeof x.municipality!=='string'||typeof x.record?.title!=='string'||typeof x.record?.fullGeom!=='string')throw Error('Ovo nije rezervna kopija parcele iz ove aplikacije.');x.geometry=parcelGeometry(x.record);if(x.osm&&(!Array.isArray(x.osm.elements)||x.osm.elements.length>100000))throw Error('Neispravna mapa okoline.');return x;}
function openDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open('moje-parcele-teren',1);r.onupgradeneeded=()=>r.result.createObjectStore('parcels',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function dbCall(mode,fn){return new Promise((resolve,reject)=>{const t=db.transaction('parcels',mode),r=fn(t.objectStore('parcels'));t.oncomplete=()=>resolve(r.result);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||Error('Čuvanje je prekinuto.'));});}
function idFor(x){return x.record.uid||[x.record.title,x.ko,x.municipality].join('|');}
function revealMap(){if(innerWidth<760)canvas.scrollIntoView({behavior:'smooth'});}
async function refreshSaved(){saved=await dbCall('readonly',s=>s.getAll());$('savedCount').textContent=saved.length;$('savedList').replaceChildren();if(!saved.length){const p=document.createElement('p');p.className='small';p.textContent='Još nema sačuvanih parcela.';$('savedList').append(p);}for(const x of saved){const row=document.createElement('div');row.className='saved-row';const b=document.createElement('button');b.textContent=x.record.title+' · '+x.ko;const sub=document.createElement('small');sub.textContent=(x.osm?'Granica i okolina':'Samo granica')+' · '+date(x.savedAt);b.append(sub);b.onclick=()=>{show(x);revealMap();};const del=document.createElement('button');del.textContent='×';del.setAttribute('aria-label','Obriši sačuvanu parcelu '+x.record.title);del.onclick=async()=>{if(confirm('Obrisati preuzetu parcelu '+x.record.title+' sa ovog uređaja?')){try{await dbCall('readwrite',s=>s.delete(x.id));await refreshSaved();status();}catch{message('Brisanje nije uspelo.',true);}}};row.append(b,del);$('savedList').append(row);}}
function show(x,refit=true){if(refit){nearbyMode=false;nearbyLoader.disable();nearby=[];}current=validPackage(x);const prior=saved.find(p=>p.id===idFor(x));if(!current.osm&&prior?.osm)current.osm=prior.osm;selection=0;following=false;$('parcelCard').hidden=false;$('parcelTitle').textContent=x.record.title;$('parcelPlace').textContent=[x.ko,x.municipality].filter(Boolean).join(' · ');$('area').textContent=(x.geometry.area/10000).toLocaleString('sr-Latn',{maximumFractionDigits:3})+' ha';$('corners').textContent=x.geometry.points.length;$('source').textContent='GeoSrbija · preuzeto '+date(x.downloadedAt);$('destination').replaceChildren(...x.geometry.points.map((p,i)=>{const o=document.createElement('option');o.value=i;o.textContent=p.name+' · '+p.lat.toFixed(6)+', '+p.lon.toFixed(6);return o;}));if(refit)fit();else draw();status();updateGps();routes();}
function fit(){const points=(current?[current]:nearby).flatMap(x=>x.geometry.points.map(p=>[p.lon,p.lat]));if(!points.length)return;view.origin=points[0];const ps=points.map(p=>local(p,view.origin));const min=[Math.min(...ps.map(p=>p[0])),Math.min(...ps.map(p=>p[1]))],max=[Math.max(...ps.map(p=>p[0])),Math.max(...ps.map(p=>p[1]))];view.center=[(min[0]+max[0])/2,(min[1]+max[1])/2];view.scale=Math.min((width-130)/Math.max(60,max[0]-min[0]),(height-230)/Math.max(60,max[1]-min[1]));view.scale=Math.max(.015,view.scale);following=false;draw();}
function pixel(c){const p=local(c,view.origin);return [width/2+(p[0]-view.center[0])*view.scale,height/2-(p[1]-view.center[1])*view.scale];}
function path(coords,close=false){if(!coords?.length)return;coords.forEach((p,i)=>{const q=pixel(Array.isArray(p)?p:[p.lon,p.lat]);i?ctx.lineTo(...q):ctx.moveTo(...q);});if(close)ctx.closePath();}
function niceScale(n){const power=10**Math.floor(Math.log10(n)),v=n/power;return (v>=5?5:v>=2?2:1)*power;}
function drawGps(){
 if(!gps)return;
 const p=pixel(gps.coords),quality=nearbyFixState(gps),stale=quality==='stale'||watch===null;
 const coarse=quality==='coarse',color=stale?'#888888':coarse?'#aa7829':'#2778d8';
 ctx.beginPath();ctx.arc(...p,Math.max(6,gps.accuracy*view.scale),0,Math.PI*2);
 ctx.fillStyle=color+'1c';ctx.fill();ctx.strokeStyle=color+'50';ctx.lineWidth=1;ctx.stroke();
 ctx.beginPath();ctx.arc(...p,7,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();ctx.strokeStyle='white';ctx.lineWidth=3;ctx.stroke();
}
const preciseLocationHelp='Uključite „Precise Location / Precizna lokacija“ za pregledač u podešavanjima telefona ili sačekajte bolji signal na otvorenom.';
function drawEmpty(){
 drawGps();$('emptyHint').hidden=false;
 const quality=nearbyFixState(gps);
 let title='Parcele oko vas',detail='Dozvolite lokaciju ili pronađite parcelu po broju.';
 if(gpsError){title=gpsError.title;detail=gpsError.detail;}
 else if(!navigator.onLine){title='Bez mreže';detail='Otvorite ranije sačuvanu parcelu. Za učitavanje novih granica treba internet.';}
 else if(quality==='coarse'){
  title='Lokacija nije dovoljno precizna';
  detail='Tačnost ±'+metres(gps.accuracy)+'. Uključite „Precise Location“ za pregledač ili sačekajte bolji signal.';
 }else if(quality==='stale'||gps&&watch===null){title='Čekamo svež položaj';detail='Poslednji položaj je zastareo ili je GPS isključen.';}
 else if(nearbyState.kind==='loading'){title='Učitavamo okolne parcele…';detail='Preuzimamo granice u krugu od '+NEARBY_RADIUS+' m. Položaj je približan.';}
 else if(nearbyState.kind==='empty'||nearbyState.kind==='error'){
  title=nearbyState.kind==='empty'?'Pretraga nije vratila granice':'Granice trenutno nisu učitane';detail=nearbyState.detail;
 }else if(watch!==null){title='Čekamo precizniji položaj';detail='Dozvolite preciznu lokaciju. Parcele će se učitati automatski kada telefon odredi položaj.';}
 $('emptyTitle').textContent=title;$('emptyDetail').textContent=detail;
 $('scale').textContent='';$('scale').style.width='0';$('coverage').textContent='';$('mapMode').textContent=title;
}
function setNearbyState(kind,detail=''){nearbyState={kind,detail};draw();}
function drawNearby(){for(const x of nearby){if(current&&idFor(x)===idFor(current))continue;ctx.beginPath();for(const poly of x.geometry.polygons)for(const ring of poly)path(ring,true);ctx.fillStyle='#a8b98f26';ctx.fill('evenodd');ctx.strokeStyle='#7f9668';ctx.lineWidth=1.5;ctx.stroke();if(view.scale>.3){const pts=x.geometry.points,c=pixel([pts.reduce((s,p)=>s+p.lon,0)/pts.length,pts.reduce((s,p)=>s+p.lat,0)/pts.length]);ctx.font='bold 11px sans-serif';ctx.textAlign='center';ctx.lineWidth=3;ctx.strokeStyle='#f3f5e8';ctx.strokeText(x.record.title,...c);ctx.fillStyle='#4a6140';ctx.fillText(x.record.title,...c);}}}
function draw(){ctx.clearRect(0,0,width,height);ctx.fillStyle='#e9eddd';ctx.fillRect(0,0,width,height);if(!current&&!nearby.length){drawEmpty();return;}$('emptyHint').hidden=true;const step=niceScale(70/view.scale),spacing=step*view.scale;ctx.strokeStyle='#dce2ce';ctx.lineWidth=1;const zero=pixel(view.origin);ctx.beginPath();for(let x=((zero[0]%spacing)+spacing)%spacing;x<width;x+=spacing){ctx.moveTo(x,0);ctx.lineTo(x,height);}for(let y=((zero[1]%spacing)+spacing)%spacing;y<height;y+=spacing){ctx.moveTo(0,y);ctx.lineTo(width,y);}ctx.stroke();
 const elements=current?.osm?.elements||[];for(const e of elements){if(!e.geometry?.length||e.tags?.highway)continue;const t=e.tags||{},closed=e.geometry.length>2&&e.geometry[0].lat===e.geometry.at(-1).lat&&e.geometry[0].lon===e.geometry.at(-1).lon;ctx.beginPath();path(e.geometry,closed);if(closed){ctx.fillStyle=t.building?'#cecabc':t.natural==='water'||t.landuse==='reservoir'?'#b9d5d5':t.landuse==='forest'||t.natural==='wood'?'#cfdfbc':'#e1e7ce';ctx.fill();}if(t.waterway){ctx.strokeStyle='#9bbfc5';ctx.lineWidth=2;ctx.stroke();}}
 for(const e of elements){if(!e.tags?.highway||!e.geometry?.length)continue;const trail=['path','footway','track','bridleway'].includes(e.tags.highway);ctx.beginPath();path(e.geometry);ctx.lineJoin='round';ctx.strokeStyle=trail?'#a9ad8d':'#c6c5b3';ctx.lineWidth=trail?2:6;ctx.setLineDash(trail?[5,4]:[]);ctx.stroke();ctx.setLineDash([]);if(!trail){ctx.strokeStyle='#fffef4';ctx.lineWidth=3;ctx.stroke();}if(e.tags.name&&view.scale>.12){const p=pixel([e.geometry[Math.floor(e.geometry.length/2)].lon,e.geometry[Math.floor(e.geometry.length/2)].lat]);ctx.font='11px sans-serif';ctx.fillStyle='#7c816b';ctx.textAlign='center';ctx.fillText(e.tags.name,...p);}}
 drawNearby();
 if(current){ctx.beginPath();for(const poly of current.geometry.polygons)for(const ring of poly)path(ring,true);ctx.fillStyle='#bfda7060';ctx.fill('evenodd');ctx.strokeStyle='#436530';ctx.lineWidth=3;ctx.stroke();
 current.geometry.points.forEach(p=>{const q=pixel([p.lon,p.lat]);ctx.beginPath();ctx.arc(...q,4,0,Math.PI*2);ctx.fillStyle='#fffef4';ctx.fill();ctx.strokeStyle='#436530';ctx.lineWidth=2;ctx.stroke();if(view.scale>.9){ctx.font='bold 11px sans-serif';ctx.textAlign='center';ctx.lineWidth=4;ctx.strokeStyle='#f9faf0';ctx.strokeText(p.name,q[0],q[1]-12);ctx.fillStyle='#36562b';ctx.fillText(p.name,q[0],q[1]-12);}});}
 drawGps();
 const scale=niceScale(80/view.scale);$('scale').textContent=metres(scale);$('scale').style.width=scale*view.scale+'px';const vc=unlocal(view.center,view.origin),bb=current?.osm?.bbox,outside=bb&&(vc[1]<bb[0]||vc[1]>bb[2]||vc[0]<bb[1]||vc[0]>bb[3]);$('coverage').textContent=!current?'Parcele iz GeoSrbije u krugu od '+NEARBY_RADIUS+' m · dodirnite parcelu da je izaberete':current.osm?(outside?'Van preuzete okoline · prikažite parcelu za povratak na mapu':'Preuzeta okolina ~1 km oko parcele · nije satelitski snimak'):'Okolina nije preuzeta. Prikazana je granica na koordinatnoj mreži.';$('mapMode').textContent=!current?'Parcele u okolini':current.osm?'Terenska mapa · putevi i granica':'Granica parcele';
}
new ResizeObserver(()=>{const r=canvas.getBoundingClientRect(),d=devicePixelRatio||1;width=r.width;height=r.height;canvas.width=width*d;canvas.height=height*d;ctx.setTransform(d,0,0,d,0,0);draw();}).observe(canvas);
// Screen position -> lon/lat (inverse of pixel()).
function coordsAt(clientX,clientY){const r=canvas.getBoundingClientRect(),x=clientX-r.left,y=clientY-r.top;return unlocal([(x-width/2)/view.scale+view.center[0],view.center[1]-(y-height/2)/view.scale],view.origin);}
function tap(clientX,clientY){if(!nearby.length)return;const c=coordsAt(clientX,clientY),hit=nearby.find(x=>boundary(c,x.geometry.polygons).inside);if(!hit||(current&&idFor(hit)===idFor(current)))return;show(hit,false);revealMap();message('Izabrana parcela '+hit.record.title+'. Sačuvajte je za rad bez mreže ili dodirnite drugu.');}
const pointers=new Map();let previous=null,pressed=null;canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,[e.clientX,e.clientY]);pressed=pointers.size===1?[e.clientX,e.clientY]:null;previous=null;following=false;});canvas.addEventListener('pointerup',e=>{if(pressed&&pointers.size===1&&Math.hypot(e.clientX-pressed[0],e.clientY-pressed[1])<8)tap(e.clientX,e.clientY);pressed=null;});canvas.addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId))return;const old=pointers.get(e.pointerId);pointers.set(e.pointerId,[e.clientX,e.clientY]);if(pointers.size===1){view.center[0]-=(e.clientX-old[0])/view.scale;view.center[1]+=(e.clientY-old[1])/view.scale;}else{const p=[...pointers.values()],d=Math.hypot(p[0][0]-p[1][0],p[0][1]-p[1][1]);if(previous)zoom(d/previous);previous=d;}draw();});for(const name of ['pointerup','pointercancel'])canvas.addEventListener(name,e=>{pointers.delete(e.pointerId);previous=null;});canvas.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY<0?1.2:1/1.2);},{passive:false});function zoom(f){view.scale=Math.max(.002,Math.min(30,view.scale*f));draw();}$('zoomIn').onclick=()=>zoom(1.5);$('zoomOut').onclick=()=>zoom(1/1.5);$('fit').onclick=fit;
async function checkShell(){if(!('serviceWorker'in navigator))return false;const r=await navigator.serviceWorker.getRegistration();if(!r?.active)return false;return new Promise(resolve=>{const ch=new MessageChannel(),timer=setTimeout(()=>resolve(false),3000);ch.port1.onmessage=e=>{clearTimeout(timer);resolve(e.data.ok===true);};r.active.postMessage('CHECK_SHELL',[ch.port2]);});}
function status(){if(!current)return;const x=saved.find(x=>x.id===idFor(current));$('savedStatus').textContent=!x?'Nije sačuvana na ovom uređaju.':!shellReady?'Podaci sačuvani. Aplikacija još nije spremna za otvaranje bez mreže.':x.osm?'Spremno bez mreže: aplikacija, granica i okolina. · '+date(x.savedAt):'Sačuvana granica i aplikacija. Okolina nije preuzeta.';$('save').textContent=x?'↓ Osveži paket za teren':'↓ Sačuvaj za teren';}
async function fetchSurroundings(x){const pts=x.geometry.points,lat=pts.reduce((s,p)=>s+p.lat,0)/pts.length,lon=pts.reduce((s,p)=>s+p.lon,0)/pts.length;const r=await fetch(SURROUNDINGS_URL+'?lat='+lat.toFixed(3)+'&lon='+lon.toFixed(3),{signal:AbortSignal.timeout(90000)});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'Servis okoline nije dostupan ('+r.status+').');if(!Array.isArray(data.elements)||!Array.isArray(data.bbox)||data.bbox.length!==4||typeof data.downloadedAt!=='string')throw Error('Servis nije vratio kompletnu okolinu.');return{elements:data.elements,bbox:data.bbox,downloadedAt:data.downloadedAt,source:data.source||'OpenStreetMap contributors, ODbL 1.0'};}
async function saveCurrent(){if(roadsBusy||!current)return;if(!db)throw Error('Čuvanje nije dostupno u ovom pregledaču.');roadsBusy=true;$('save').disabled=true;const x=structuredClone(current);try{message('Preuzimam puteve i okolinu…');let warning='';try{if(navigator.onLine||!x.osm)x.osm=await fetchSurroundings(x);}catch(e){warning=' Okolina nije osvežena: '+e.message;}x.id=idFor(x);x.savedAt=new Date().toISOString();await dbCall('readwrite',s=>s.put(x));await refreshSaved();if(idFor(current)===x.id)current=x;shellReady=await checkShell();if(navigator.storage?.persist)await navigator.storage.persist().catch(()=>false);status();draw();message((x.osm?'Granica i okolina su sačuvani na ovom uređaju.':'Sačuvana je samo granica.')+warning+(!shellReady?' Offline otvaranje aplikacije još nije potvrđeno; otvorite link direktno preko HTTPS-a i pokušajte ponovo.':''),!!warning||!shellReady);return{id:x.id,boundarySaved:true,surroundingsSaved:!!x.osm,appOfflineReady:shellReady};}finally{roadsBusy=false;$('save').disabled=false;}}
$('save').onclick=()=>saveCurrent().catch(e=>message('Čuvanje nije uspelo: '+e.message,true));
async function searchParcel(p,ko,m){if(!p.trim()||!ko.trim()||!m.trim())throw Error('Popunite sva tri polja.');if(!navigator.onLine)throw Error('Za novu pretragu treba internet. Otvorite ranije sačuvanu parcelu.');nearbyMode=false;nearbyLoader.disable();$('searchButton').disabled=true;message('Tražim granicu u GeoSrbiji…');try{const data={records:await liveSearch(p,ko,m),downloadedAt:new Date().toISOString()};$('results').replaceChildren();const packages=data.records.map(record=>validPackage({record,ko,municipality:m,downloadedAt:data.downloadedAt}));if(packages.length===1){show(packages[0]);revealMap();message('Granica pronađena. Sačuvajte je za rad bez mreže.');}else{message('Više rezultata. Izaberite odgovarajuću parcelu.');for(const x of packages){const b=document.createElement('button');b.textContent=x.record.title+' · '+x.record.desc;b.onclick=()=>{show(x);revealMap();$('results').replaceChildren();};$('results').append(b);}}return{matches:packages.length,selected:packages.length===1?packages[0].record.title:null};}finally{$('searchButton').disabled=false;}}
// Load actual cadastral polygons around the GPS fix; never synthesize parcel boundaries.
async function findNearby(centre,isActive=()=>true){
 if(!navigator.onLine)throw Error('Za pretragu okoline treba internet. Otvorite sačuvanu parcelu za rad bez mreže.');
 $('nearby').disabled=true;setNearbyState('loading');message('Tražim parcele oko vašeg položaja…');
 try{
  const [east,north]=wgs84ToUtm34(...centre);
  const {records,total}=await searchNearby(east,north,NEARBY_RADIUS);
  if(!isActive())return;
  const downloadedAt=new Date().toISOString();
  const packages=records.map(record=>validPackage({record,ko:latinPlace(record.desc),municipality:'',downloadedAt}));
  nearby=packages;
  if(following){view.origin=centre;view.center=[0,0];view.scale=Math.max(.015,Math.min(width,height)/(2.3*NEARBY_RADIUS));}
  $('results').replaceChildren();
  if(!nearby.length){
   const detail='GeoSrbija nije vratila granice za ovaj upit. To ne znači da parcele ne postoje ili da plan nije digitalizovan. Pokušajte ponovo ili pretražite parcelu po broju.';
   setNearbyState('empty',detail);message(detail,true);return;
  }
  setNearbyState('ready');
  const under=nearby.find(x=>{const b=boundary(gps.coords,x.geometry.polygons);return b.inside&&b.distance>gps.accuracy;});
  message(nearby.length+' parcela u krugu od '+NEARBY_RADIUS+' m'+(total>records.length?' (prikaz je nepotpun: '+records.length+' od '+total+')':'')+'. Dodirnite parcelu da je izaberete.'+(under?' Prema trenutnoj GPS proceni: parcela '+under.record.title+'.':''));
 }finally{$('nearby').disabled=false;}
}
const nearbyLoader=createNearbyLoader({load:findNearby,onError:e=>{setNearbyState('error',e.message);message(e.message,true);}});
function queueNearby(force=false){
 if(!nearbyMode)return;
 const quality=nearbyFixState(gps);
 if(quality!=='ready'){
  setNearbyState('waiting');
  if(quality==='coarse')message('Lokacija je previše neprecizna (±'+metres(gps.accuracy)+') za pretragu okoline od '+NEARBY_RADIUS+' m. '+preciseLocationHelp,true);
 }
 nearbyLoader.update(gps,force);
}
function openNearby(){
 nearbyMode=true;nearbyLoader.enable();current=null;$('parcelCard').hidden=true;following=true;revealMap();
 if(watch===null)startGps();
 if(gps){view.origin=gps.coords;view.center=[0,0];updateGps();draw();queueNearby(true);}
}
$('nearby').onclick=openNearby;
$('search').onsubmit=e=>{e.preventDefault();searchParcel($('number').value,$('ko').value,$('municipality').value).catch(e=>message(e.name==='TimeoutError'?'GeoSrbija nije odgovorila na vreme. Pokušajte ponovo.':e.message,true));};
function startGps(){
 if(watch!==null){
  navigator.geolocation.clearWatch(watch);watch=null;following=false;nearbyLoader.disable();
  $('gps').textContent='Uključi GPS';updateGps();draw();return;
 }
 if(!navigator.geolocation){
  gpsError={title:'Lokacija nije dostupna',detail:'Otvorite aplikaciju direktno u Safariju ili Chrome-u.'};
  message(gpsError.detail,true);updateGps();draw();return;
 }
 gpsError=null;following=true;if(nearbyMode)nearbyLoader.enable();
 $('gpsTitle').textContent='Tražim GPS signal…';$('gpsDetail').textContent='Dozvolite preciznu lokaciju u pregledaču.';
 watch=navigator.geolocation.watchPosition(p=>{
  const c=p.coords;
  if(!Number.isFinite(c.latitude)||!Number.isFinite(c.longitude)||!Number.isFinite(c.accuracy)||c.accuracy<0)return;
  const firstFix=!gps;gpsError=null;gps={coords:[c.longitude,c.latitude],accuracy:c.accuracy,timestamp:p.timestamp};
  if(following&&!current&&!nearby.length){view.origin=gps.coords;view.center=[0,0];}
  else if(following)view.center=local(gps.coords,view.origin);
  updateGps();queueNearby();draw();if(firstFix&&following)revealMap();
 },e=>{
  gpsError={title:e.code===1?'Lokacija nije dozvoljena':'GPS signal nije dostupan',detail:e.code===1?'Dozvolite lokaciju u podešavanjima pregledača.':'Sačekajte bolji signal na otvorenom. Poslednji položaj može biti zastareo.'};
  if(e.code===1){navigator.geolocation.clearWatch(watch);watch=null;nearbyLoader.disable();$('gps').textContent='Uključi GPS';}
  updateGps();draw();
 },{enableHighAccuracy:true,maximumAge:0,timeout:20000});
 $('gps').textContent='Isključi GPS';
}
function updateGps(){
 if(gpsError){$('gpsTitle').textContent=gpsError.title;$('gpsDetail').textContent=gpsError.detail;return;}
 if(!gps)return;
 const quality=nearbyFixState(gps),age=Date.now()-gps.timestamp,stale=quality==='stale'||watch===null;
 if(stale){
  $('gpsTitle').textContent='Poslednji položaj · nije uživo';
  $('gpsDetail').textContent='Tačnost ±'+metres(gps.accuracy)+' · pre '+Math.max(0,Math.round(age/1000))+' s';
 }else if(quality==='coarse'){
  $('gpsTitle').textContent='Lokacija nije dovoljno precizna';
  $('gpsDetail').textContent='Tačnost ±'+metres(gps.accuracy)+' · čeka se precizniji položaj.';
 }else if(current){
  const b=boundary(gps.coords,current.geometry.polygons);
  $('gpsTitle').textContent=b.distance<=gps.accuracy?'Blizu granice · položaj nesiguran':b.inside?'Nalazite se unutar parcele':'Nalazite se van parcele';
  $('gpsDetail').textContent=metres(b.distance)+' do granice · tačnost ±'+metres(gps.accuracy);
 }else{
  $('gpsTitle').textContent='Položaj pronađen';
  $('gpsDetail').textContent='Tačnost ±'+metres(gps.accuracy)+' · položaj je približan.';
 }
 routes();
}
$('gps').onclick=startGps;$('locate').onclick=()=>{if(watch===null)startGps();else if(gps){following=true;view.center=local(gps.coords,view.origin);draw();}};setInterval(()=>{updateGps();draw();},5000);
function routes(){if(!current)return;const p=current.geometry.points[selection],dest=p.lat+','+p.lon;$('googleRoute').href='https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(dest)+'&travelmode=driving';$('appleRoute').href='https://maps.apple.com/?daddr='+encodeURIComponent(dest)+'&dirflg=d';if(gps){const b=bearing(gps.coords,[p.lon,p.lat]),dirs=['sever','severoistok','istok','jugoistok','jug','jugozapad','zapad','severozapad'];$('bearingText').textContent=p.name+': '+metres(distance(gps.coords,[p.lon,p.lat]))+' vazdušno · '+Math.round(b)+'° ('+dirs[Math.round(b/45)%8]+')'+(Date.now()-gps.timestamp>30000||watch===null?' · prema poslednjem položaju':'');}}
$('destination').onchange=()=>{selection=Number($('destination').value);routes();};$('route').onclick=()=>{routes();$('routeDialog').showModal();};$('help').onclick=()=>$('helpDialog').showModal();document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$('export').onclick=()=>{if(!current)return;const x=structuredClone(current);delete x.geometry;const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(x)],{type:'application/json'}));a.href=url;document.body.append(a);a.download='parcela-'+x.record.title.replace('/','-')+'.json';a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);};$('import').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>15000000)throw Error('Datoteka je veća od 15 MB.');const x=validPackage(JSON.parse(await f.text()));show(x);message('Kopija je otvorena. Pritisnite „Sačuvaj za teren“ da je zadržite na ovom uređaju.');}catch(e){message(e.message,true);}finally{$('import').value='';}};
function network(){ $('network').textContent=navigator.onLine?'Veza dostupna':'Bez mreže'; }addEventListener('online',()=>{network();if(watch!==null)queueNearby(true);draw();});addEventListener('offline',()=>{network();draw();});network();
async function boot(){try{db=await openDb();await refreshSaved();}catch{message('Lokalno čuvanje nije dostupno. Proverite podešavanja pregledača.',true);}if(!navigator.onLine&&saved.length){try{show(saved[0]);}catch(e){message('Nije moguće otvoriti sačuvanu parcelu: '+e.message,true);}}else draw();if(navigator.onLine)startGps();if('serviceWorker'in navigator){try{await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;shellReady=await checkShell();status();}catch{shellReady=false;status();}}}
await boot();
if(document.modelContext?.registerTool){for(const tool of [{name:'list_saved_parcels',description:'Read parcels saved on this device and offline readiness.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:async()=>({parcels:saved.map(x=>({id:x.id,number:x.record.title,ko:x.ko,municipality:x.municipality,surroundingsSaved:!!x.osm})),appOfflineReady:await checkShell()})},{name:'open_saved_parcel',description:'Display a parcel already saved on this device.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},execute:async input=>{const x=saved.find(x=>x.id===input?.id);if(!x)throw Error('Parcela nije sačuvana.');show(x);return{selected:x.id};}}]){try{await document.modelContext.registerTool(tool);}catch{}}}
