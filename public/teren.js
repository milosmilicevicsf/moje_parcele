import {parcelGeometry,wgs84ToUtm34} from './geo.js';
import {searchParcel as liveSearch,searchNearby,latinPlace} from './geosrbija.js';
import {local,unlocal,boundary,bearing,distance} from './field-geo.js';
import {SURROUNDINGS_URL,SATELLITE_TILES,SATELLITE_ATTRIBUTION} from './config.js';
import {createTileLayer} from './satellite.js';
import {parseKoTable,findKoId,ekatastarUrl,EKATASTAR_HOME} from './ekatastar.js';
import {createNearbyLoader,nearbyFixState} from './nearby-loader.js';
import {createLocationTracker} from './location-tracker.js';
import {downloadNeighborhood,readNeighborhood,neighborhoodSummary} from './parcel-neighborhood.js';
const $=s=>document.getElementById(s), canvas=$('map'),ctx=canvas.getContext('2d');
// Search radius for the automatically loaded cadastral neighborhood.
const NEARBY_RADIUS=150;
// Projection origin before any parcel is shown; replaced by the parcel or the first GPS fix.
let current=null, nearby=[], mapSurroundings=null, saved=[], db, shellReady=false, gps=null,watch=null,following=false,selection=0,view={origin:[20.9,44.2],center:[0,0],scale:2},width=0,height=0,roadsBusy=false;
const message=(s,error=false)=>{$('message').textContent=s;$('message').className=error?'error':'';};
const metres=m=>m<1000?Math.round(m)+' m':(m/1000).toFixed(1)+' km';
let nearbyMode=true,nearbyState={kind:'waiting',detail:''},gpsError=null;
let parcelNeighborhoodVersion=0,mapNeighborhood=null,parcelNeighborhoodState='';
const neighborhoodRequests=new Map();
const storedBasemap=()=>{try{return localStorage.getItem('basemap');}catch{return null;}};
let basemap=storedBasemap()==='satellite'?'satellite':'map',imagery={pending:0,missing:0,tooWide:false},redrawQueued=false;
const tiles=createTileLayer({template:SATELLITE_TILES,onChange:()=>{if(!redrawQueued){redrawQueued=true;requestAnimationFrame(()=>{redrawQueued=false;draw();});}},load:(url,done)=>{const image=new Image();image.decoding='async';image.onload=()=>done(true);image.onerror=()=>done(false);image.src=url;return image;}});
// Imagery needs the network; offline the vector map is shown and the preference is kept.
const satelliteOn=()=>basemap==='satellite'&&navigator.onLine;
const date=s=>new Date(s).toLocaleDateString('sr-Latn');
function validPackage(x){if(!x||typeof x.ko!=='string'||typeof x.municipality!=='string'||typeof x.record?.title!=='string'||typeof x.record?.fullGeom!=='string')throw Error('Ovo nije rezervna kopija parcele iz ove aplikacije.');x.geometry=parcelGeometry(x.record);if(x.osm&&(!Array.isArray(x.osm.elements)||x.osm.elements.length>100000))throw Error('Neispravna mapa okoline.');return x;}
function openDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open('moje-parcele-teren',1);r.onupgradeneeded=()=>r.result.createObjectStore('parcels',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function dbCall(mode,fn){return new Promise((resolve,reject)=>{const t=db.transaction('parcels',mode),r=fn(t.objectStore('parcels'));t.oncomplete=()=>resolve(r.result);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||Error('Čuvanje je prekinuto.'));});}
function idFor(x){return x.record.uid||[x.record.title,x.ko,x.municipality].join('|');}
function revealMap(){if(innerWidth<760)canvas.scrollIntoView({behavior:'smooth'});}
async function refreshSaved(){saved=await dbCall('readonly',s=>s.getAll());$('savedCount').textContent=saved.length;$('savedList').replaceChildren();if(!saved.length){const p=document.createElement('p');p.className='small';p.textContent='Još nema sačuvanih parcela.';$('savedList').append(p);}for(const x of saved){const row=document.createElement('div');row.className='saved-row';const b=document.createElement('button');b.textContent=x.record.title+' · '+x.ko;const sub=document.createElement('small');sub.textContent=(x.osm?'Granica i okolina':'Samo granica')+' · '+date(x.savedAt);b.append(sub);b.onclick=()=>{show(x);revealMap();};const del=document.createElement('button');del.textContent='×';del.setAttribute('aria-label','Obriši sačuvanu parcelu '+x.record.title);del.onclick=async()=>{if(confirm('Obrisati preuzetu parcelu '+x.record.title+' sa ovog uređaja?')){try{await dbCall('readwrite',s=>s.delete(x.id));await refreshSaved();status();}catch{message('Brisanje nije uspelo.',true);}}};row.append(b,del);$('savedList').append(row);}}
function show(x,refit=true){if(refit){nearbyMode=false;nearbyLoader.disable();}current=validPackage(x);const prior=saved.find(p=>p.id===idFor(x));if(!current.osm&&prior?.osm)current.osm=prior.osm;if(!current.neighborhood&&prior?.neighborhood)current.neighborhood=prior.neighborhood;if(!refit&&!current.neighborhood&&mapNeighborhood)current.neighborhood=mapNeighborhood;if(current.osm)mapSurroundings=current.osm;selection=0;following=false;$('parcelCard').hidden=false;$('parcelTitle').textContent=x.record.title;$('parcelPlace').textContent=[x.ko,x.municipality].filter(Boolean).join(' · ');$('area').textContent=(x.geometry.area/10000).toLocaleString('sr-Latn',{maximumFractionDigits:3})+' ha';$('corners').textContent=x.geometry.points.length;$('source').textContent='GeoSrbija · preuzeto '+date(x.downloadedAt);$('destination').replaceChildren();x.geometry.points.forEach((p,i)=>{const o=document.createElement('option');o.value=i;o.textContent=p.name+' · '+p.lat.toFixed(6)+', '+p.lon.toFixed(6);$('destination').append(o);});if(refit){openParcelNeighborhood(current);fit();}else draw();status();updateGps();routes();updateEkatastar(current);
 // The desktop panel scrolls on its own; on phones the map stays in view and "Detalji" scrolls down.
 if(innerWidth>=760)$('parcelCard').scrollIntoView({block:'nearest',behavior:'smooth'});}
// Parcel-centered loading must not depend on GPS permission or move the map back to the user.
function fetchParcelNeighborhood(x){
 const key=idFor(x)+'|'+x.record.fullGeom;
 if(!neighborhoodRequests.has(key)){
  const task=downloadNeighborhood(x,searchNearby).finally(()=>neighborhoodRequests.delete(key));
  neighborhoodRequests.set(key,task);
 }
 return neighborhoodRequests.get(key);
}
function displayNeighborhood(data,anchor){
 mapNeighborhood=data.snapshot;nearby=data.parcels;
 if(anchor&&!nearby.some(x=>idFor(x)===idFor(anchor)))nearby.push(anchor);
 parcelNeighborhoodState=neighborhoodSummary(data.snapshot);draw();
}
async function cacheSavedNeighborhood(id,snapshot){
 if(!db||!saved.some(x=>x.id===id))return;
 // Read and update in one transaction: a deleted package must never be recreated by a late response.
 const stored=await dbCall('readwrite',store=>{
  const request=store.get(id);
  request.onsuccess=()=>{if(request.result)store.put({...request.result,neighborhood:snapshot});};
  return request;
 });
 if(stored){const item=saved.find(x=>x.id===id);if(item)item.neighborhood=snapshot;status();}
}
function openParcelNeighborhood(x){
 const version=++parcelNeighborhoodVersion,isActive=()=>version===parcelNeighborhoodVersion&&!nearbyMode;
 const alreadyVisible=nearby.some(p=>idFor(p)===idFor(x));
 if(!alreadyVisible){nearby=[x];mapSurroundings=x.osm||null;mapNeighborhood=null;}
 let cached=false;
 try{if(x.neighborhood){displayNeighborhood(readNeighborhood(x.neighborhood),x);cached=true;}}catch{delete x.neighborhood;}
 parcelNeighborhoodState=navigator.onLine?'Učitavamo parcele oko otvorene parcele…':cached?neighborhoodSummary(mapNeighborhood):'Okolne parcele nisu sačuvane. Otvorite ovu parcelu uz internet.';
 if(!navigator.onLine)return;
 fetchParcelNeighborhood(x).then(async data=>{
  if(!isActive())return;
  x.neighborhood=data.snapshot;displayNeighborhood(data,current||x);
  try{await cacheSavedNeighborhood(idFor(x),data.snapshot);}
  catch{if(isActive()){parcelNeighborhoodState+=' · čuvanje na telefonu nije uspelo';draw();}}
 }).catch(error=>{
  if(!isActive())return;
  parcelNeighborhoodState=(cached?'Prikazane su sačuvane okolne parcele. ':'')+'Okolne parcele nisu osvežene: '+error.message;draw();
 });
}
function fit(){const points=(current?[current]:nearby).flatMap(x=>x.geometry.points.map(p=>[p.lon,p.lat]));if(!points.length)return;view.origin=points[0];const min=[Infinity,Infinity],max=[-Infinity,-Infinity];for(const point of points){const p=local(point,view.origin);for(let i=0;i<2;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}}view.center=[(min[0]+max[0])/2,(min[1]+max[1])/2];view.scale=Math.min((width-130)/Math.max(60,max[0]-min[0]),(height-230)/Math.max(60,max[1]-min[1]));view.scale=Math.max(.015,view.scale);following=false;draw();}
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
const preciseLocationHelp='Pregledač trenutno šalje samo približan položaj. Pritisnite „Ponovi lociranje“. Ako ostane isto i uz uključenu preciznu lokaciju, otvorite ovu adresu direktno u Safariju i proverite položaj na otvorenom.';
function drawEmpty(){
 drawGps();$('emptyHint').hidden=false;
 const quality=nearbyFixState(gps);
 let title='Parcele oko vas',detail='Dozvolite lokaciju ili pronađite parcelu po broju.';
 if(gpsError){title=gpsError.title;detail=gpsError.detail;}
 else if(!navigator.onLine){title='Bez mreže';detail='Otvorite ranije sačuvanu parcelu. Za učitavanje novih granica treba internet.';}
 else if(quality==='coarse'){
  title='Lokacija nije dovoljno precizna';
  detail='Tačnost ±'+metres(gps.accuracy)+'. Pritisnite „Ponovi lociranje“. Ako je precizna lokacija već uključena, probajte ovu adresu direktno u Safariju.';
 }else if(quality==='stale'||gps&&watch===null){title='Čekamo svež položaj';detail='Poslednji položaj je zastareo ili je GPS isključen.';}
 else if(nearbyState.kind==='loading'){title='Učitavamo okolne parcele…';detail='Preuzimamo granice u krugu od '+NEARBY_RADIUS+' m. Položaj je približan.';}
 else if(nearbyState.kind==='empty'||nearbyState.kind==='error'){
  title=nearbyState.kind==='empty'?'Pretraga nije vratila granice':'Granice trenutno nisu učitane';detail=nearbyState.detail;
 }else if(watch!==null){title='Čekamo precizniji položaj';detail='Dozvolite preciznu lokaciju. Parcele će se učitati automatski kada telefon odredi položaj.';}
 $('emptyTitle').textContent=title;$('emptyDetail').textContent=detail;
 $('scale').textContent='';$('scale').style.width='0';$('coverage').textContent=gps?imageryNote():'';$('mapMode').textContent=title;
}
function setNearbyState(kind,detail=''){nearbyState={kind,detail};draw();}
function drawNearby(sat,labels){
 for(const x of nearby){
  if(current&&idFor(x)===idFor(current))continue;
  ctx.beginPath();for(const poly of x.geometry.polygons)for(const ring of poly)path(ring,true);
  ctx.fillStyle=sat?'#ffffff12':'#a8b98f26';ctx.fill('evenodd');
  ctx.strokeStyle=sat?'#ffffffd0':'#7f9668';ctx.lineWidth=1.5;ctx.stroke();
  if(view.scale>.3){
   const pts=x.geometry.points;
   labels.push({text:x.record.title,point:pixel([pts.reduce((sum,p)=>sum+p.lon,0)/pts.length,pts.reduce((sum,p)=>sum+p.lat,0)/pts.length]),selected:false});
  }
 }
}
// Prefer the selected parcel and leave room around labels, controls and the GPS card.
function drawParcelLabels(labels,sat){
 const mobile=width<760,occupied=[];
 for(const label of labels.sort((a,b)=>Number(b.selected)-Number(a.selected))){
  const [x,y]=label.point,text=label.text;
  ctx.font=label.selected?'bold 11px sans-serif':'bold 11px sans-serif';
  const half=ctx.measureText(text).width/2+5;
  const box=[x-half,y-15,x+half,y+5];
  if(box[0]<(mobile?8:4)||box[2]>width-(mobile?58:5)||box[1]<(mobile?86:60)||box[3]>height-(mobile?95:72))continue;
  if(occupied.some(other=>box[0]<other[2]+6&&box[2]+6>other[0]&&box[1]<other[3]+4&&box[3]+4>other[1]))continue;
  occupied.push(box);
  ctx.textAlign='center';ctx.lineWidth=label.selected?4:3;
  ctx.strokeStyle=sat?'#1d2419dc':'#f3f5e8';ctx.strokeText(text,x,y);
  ctx.fillStyle=sat?(label.selected?'#fff6c8':'#ffffff'):'#4a6140';ctx.fillText(text,x,y);
 }
}
function viewBounds(){
 const [west,north]=unlocal([view.center[0]-width/2/view.scale,view.center[1]+height/2/view.scale],view.origin);
 const [east,south]=unlocal([view.center[0]+width/2/view.scale,view.center[1]-height/2/view.scale],view.origin);
 return [west,south,east,north];
}
function updateBasemapControls(sat){
 const wantsSatellite=basemap==='satellite';
 $('basemap').textContent=wantsSatellite?'Mapa':'Satelit';
 $('basemap').setAttribute('aria-label',wantsSatellite?'Prikaži običnu mapu':'Prikaži satelitski snimak');
 $('imageryCredit').hidden=!sat;canvas.parentElement.classList.toggle('satellite',sat);
}
function imageryNote(){
 if(basemap!=='satellite')return '';
 if(!navigator.onLine)return 'Satelitski snimak zahteva internet · prikazana je obična mapa';
 if(imagery.tooWide)return 'Uvećajte mapu za satelitski snimak';
 if(imagery.missing)return 'Satelitski snimak nije dostupan za deo prikaza';
 if(imagery.pending)return 'Učitavamo satelitski snimak…';
 return 'Satelitski snimak · datum snimanja zavisi od područja';
}
function toggleBasemap(){
 basemap=basemap==='satellite'?'map':'satellite';
 try{localStorage.setItem('basemap',basemap);}catch{}
 draw();
 if(basemap==='satellite'&&!navigator.onLine)message('Satelitski snimak se učitava samo uz internet. Do tada je prikazana obična mapa.',true);
}
$('basemap').onclick=toggleBasemap;$('imageryCredit').textContent=' · Snimak: '+SATELLITE_ATTRIBUTION;
function draw(){
 $('clearSelection').hidden=!current;$('details').hidden=!current;$('fit').textContent=current?'▱ Prikaži parcelu':'▱ Prikaži parcele';
 const sat=satelliteOn();updateBasemapControls(sat);
 ctx.clearRect(0,0,width,height);ctx.fillStyle=sat?'#3a4234':'#e9eddd';ctx.fillRect(0,0,width,height);
 if(sat&&(current||nearby.length||gps))imagery=tiles.draw(ctx,pixel,viewBounds(),1/(view.scale*Math.min(2,devicePixelRatio||1)));
 if(!current&&!nearby.length){drawEmpty();return;}$('emptyHint').hidden=true;
 if(!sat){const step=niceScale(70/view.scale),spacing=step*view.scale;ctx.strokeStyle='#dce2ce';ctx.lineWidth=1;const zero=pixel(view.origin);ctx.beginPath();for(let x=((zero[0]%spacing)+spacing)%spacing;x<width;x+=spacing){ctx.moveTo(x,0);ctx.lineTo(x,height);}for(let y=((zero[1]%spacing)+spacing)%spacing;y<height;y+=spacing){ctx.moveTo(0,y);ctx.lineTo(width,y);}ctx.stroke();}
 // Over imagery the OSM buildings and land use would hide what the photo shows.
 const surroundings=current?.osm||mapSurroundings,elements=sat?[]:surroundings?.elements||[];for(const e of elements){if(!e.geometry?.length||e.tags?.highway)continue;const t=e.tags||{},closed=e.geometry.length>2&&e.geometry[0].lat===e.geometry.at(-1).lat&&e.geometry[0].lon===e.geometry.at(-1).lon;ctx.beginPath();path(e.geometry,closed);if(closed){ctx.fillStyle=t.building?'#cecabc':t.natural==='water'||t.landuse==='reservoir'?'#b9d5d5':t.landuse==='forest'||t.natural==='wood'?'#cfdfbc':'#e1e7ce';ctx.fill();}if(t.waterway){ctx.strokeStyle='#9bbfc5';ctx.lineWidth=2;ctx.stroke();}}
 for(const e of elements){if(!e.tags?.highway||!e.geometry?.length)continue;const trail=['path','footway','track','bridleway'].includes(e.tags.highway);ctx.beginPath();path(e.geometry);ctx.lineJoin='round';ctx.strokeStyle=trail?'#a9ad8d':'#c6c5b3';ctx.lineWidth=trail?2:6;ctx.setLineDash(trail?[5,4]:[]);ctx.stroke();ctx.setLineDash([]);if(!trail){ctx.strokeStyle='#fffef4';ctx.lineWidth=3;ctx.stroke();}if(e.tags.name&&view.scale>.12){const p=pixel([e.geometry[Math.floor(e.geometry.length/2)].lon,e.geometry[Math.floor(e.geometry.length/2)].lat]);ctx.font='11px sans-serif';ctx.fillStyle='#7c816b';ctx.textAlign='center';ctx.fillText(e.tags.name,...p);}}
 const labels=[];drawNearby(sat,labels);
 if(current){const line=sat?'#ffd84a':'#436530';ctx.beginPath();for(const poly of current.geometry.polygons)for(const ring of poly)path(ring,true);ctx.fillStyle=sat?'#ffd84a2e':'#bfda7060';ctx.fill('evenodd');ctx.strokeStyle=line;ctx.lineWidth=3;ctx.stroke();
 current.geometry.points.forEach(p=>{const q=pixel([p.lon,p.lat]);ctx.beginPath();ctx.arc(...q,4,0,Math.PI*2);ctx.fillStyle='#fffef4';ctx.fill();ctx.strokeStyle=line;ctx.lineWidth=2;ctx.stroke();if(view.scale>.9)labels.push({text:p.name,point:[q[0],q[1]-12],selected:true});});}
 drawParcelLabels(labels,sat);
 drawGps();
 const scale=niceScale(80/view.scale);$('scale').textContent=metres(scale);$('scale').style.width=scale*view.scale+'px';const vc=unlocal(view.center,view.origin),bb=surroundings?.bbox,outside=bb&&(vc[1]<bb[0]||vc[1]>bb[2]||vc[0]<bb[1]||vc[0]>bb[3]);const parcelsNote=!nearbyMode&&parcelNeighborhoodState?parcelNeighborhoodState:!current?'Parcele iz GeoSrbije u krugu od '+NEARBY_RADIUS+' m · dodirnite parcelu da je izaberete':sat?'':surroundings?(outside?'Van preuzete okoline · prikažite parcelu za povratak na mapu':'Preuzeta okolina ~1 km oko parcele · nije satelitski snimak'):'Okolina nije preuzeta. Prikazana je granica na koordinatnoj mreži.';$('coverage').textContent=[imageryNote(),parcelsNote].filter(Boolean).join(' · ');$('mapMode').textContent=current?'Parcela '+current.record.title:'Parcele u okolini';
}
new ResizeObserver(()=>{const r=canvas.getBoundingClientRect(),d=devicePixelRatio||1;width=r.width;height=r.height;canvas.width=width*d;canvas.height=height*d;ctx.setTransform(d,0,0,d,0,0);draw();}).observe(canvas);
// Screen position -> lon/lat (inverse of pixel()).
function coordsAt(clientX,clientY){const r=canvas.getBoundingClientRect(),x=clientX-r.left,y=clientY-r.top;return unlocal([(x-width/2)/view.scale+view.center[0],view.center[1]-(y-height/2)/view.scale],view.origin);}
// Clear only the selection, retaining the viewport, nearby boundaries and downloaded context.
function clearSelection(){
 if(current&&!nearby.some(x=>idFor(x)===idFor(current)))nearby.push(current);
 current=null;selection=0;$('parcelCard').hidden=true;$('destination').replaceChildren();
 if($('routeDialog').open)$('routeDialog').close();
 if(nearbyMode&&watch!==null)nearbyLoader.enable();
 updateGps();draw();message('Izbor je uklonjen. Dodirnite drugu parcelu na mapi.');
 if(nearbyMode&&!nearby.length&&watch!==null)queueNearby();
}
$('clearSelection').onclick=clearSelection;
$('details').onclick=()=>$('parcelCard').scrollIntoView({behavior:'smooth',block:'start'});
function tap(clientX,clientY){
 const c=coordsAt(clientX,clientY);
 // Prefer a smaller parcel over a larger overlapping polygon, regardless of response order.
 const hits=nearby.filter(x=>boundary(c,x.geometry.polygons).inside).sort((a,b)=>a.geometry.area-b.geometry.area);
 const hit=hits[0];
 if(!hit||(current&&idFor(hit)===idFor(current))){if(current)clearSelection();return;}
 show(hit,false);message('Izabrana parcela '+hit.record.title+'. Dodirnite drugu parcelu ili uklonite izbor.');
}
const pointers=new Map();let previous=null,pressed=null;
canvas.addEventListener('pointerdown',e=>{
 canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,[e.clientX,e.clientY]);
 pressed=pointers.size===1?[e.clientX,e.clientY]:null;previous=null;following=false;
});
canvas.addEventListener('pointerup',e=>{
 if(pressed&&pointers.size===1&&Math.hypot(e.clientX-pressed[0],e.clientY-pressed[1])<8)tap(e.clientX,e.clientY);
 pressed=null;
});
canvas.addEventListener('pointermove',e=>{
 if(!pointers.has(e.pointerId))return;
 let old=pointers.get(e.pointerId);pointers.set(e.pointerId,[e.clientX,e.clientY]);
 if(pointers.size===1){
  if(pressed){if(Math.hypot(e.clientX-pressed[0],e.clientY-pressed[1])<8)return;old=pressed;pressed=null;}
  view.center[0]-=(e.clientX-old[0])/view.scale;view.center[1]+=(e.clientY-old[1])/view.scale;
 }else{
  const p=[...pointers.values()],d=Math.hypot(p[0][0]-p[1][0],p[0][1]-p[1][1]);
  if(previous)zoom(d/previous);previous=d;
 }
 draw();
});
for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,e=>{
 pointers.delete(e.pointerId);previous=null;pressed=null;
});
canvas.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY<0?1.2:1/1.2);},{passive:false});function zoom(f){view.scale=Math.max(.002,Math.min(30,view.scale*f));draw();}$('zoomIn').onclick=()=>zoom(1.5);$('zoomOut').onclick=()=>zoom(1/1.5);
async function checkShell(){if(!('serviceWorker'in navigator))return false;const r=await navigator.serviceWorker.getRegistration();if(!r?.active)return false;return new Promise(resolve=>{const ch=new MessageChannel(),timer=setTimeout(()=>resolve(false),3000);ch.port1.onmessage=e=>{clearTimeout(timer);resolve(e.data.ok===true);};r.active.postMessage('CHECK_SHELL',[ch.port2]);});}
function status(){if(!current)return;const x=saved.find(x=>x.id===idFor(current));$('savedStatus').textContent=!x?'Nije sačuvana na ovom uređaju.':!shellReady?'Podaci sačuvani. Aplikacija još nije spremna za otvaranje bez mreže.':x.osm?'Spremno bez mreže: aplikacija, granica i okolina. · '+date(x.savedAt):'Sačuvana granica i aplikacija. Okolina nije preuzeta.';if(x)$('savedStatus').textContent+=x.neighborhood?' Okolne parcele su sačuvane.':' Okolne parcele još nisu sačuvane.';$('save').textContent=x?'↓ Osveži paket za teren':'↓ Sačuvaj za teren';}
async function fetchSurroundings(x){const pts=x.geometry.points,lat=pts.reduce((s,p)=>s+p.lat,0)/pts.length,lon=pts.reduce((s,p)=>s+p.lon,0)/pts.length;const r=await fetch(SURROUNDINGS_URL+'?lat='+lat.toFixed(3)+'&lon='+lon.toFixed(3),{signal:AbortSignal.timeout(90000)});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'Servis okoline nije dostupan ('+r.status+').');if(!Array.isArray(data.elements)||!Array.isArray(data.bbox)||data.bbox.length!==4||typeof data.downloadedAt!=='string')throw Error('Servis nije vratio kompletnu okolinu.');return{elements:data.elements,bbox:data.bbox,downloadedAt:data.downloadedAt,source:data.source||'OpenStreetMap contributors, ODbL 1.0'};}
async function saveCurrent(){
 if(roadsBusy||!current)return;if(!db)throw Error('Čuvanje nije dostupno u ovom pregledaču.');
 roadsBusy=true;$('save').disabled=true;const x=structuredClone(current);
 try{
  message('Preuzimam puteve i granice okolnih parcela…');const warnings=[];
  if(navigator.onLine){
   const [roads,parcels]=await Promise.allSettled([fetchSurroundings(x),fetchParcelNeighborhood(x)]);
   if(roads.status==='fulfilled')x.osm=roads.value;else warnings.push('Putevi nisu osveženi: '+roads.reason.message);
   if(parcels.status==='fulfilled'){
    x.neighborhood=parcels.value.snapshot;
    if(current&&idFor(current)===idFor(x))displayNeighborhood(parcels.value,current);
   }else warnings.push('Okolne parcele nisu osvežene: '+parcels.reason.message);
  }
  if(!x.neighborhood)warnings.push('Okolne parcele nisu sačuvane za rad bez mreže.');
  else if(x.neighborhood.limited||x.neighborhood.skipped||x.neighborhood.total>x.neighborhood.records.length)warnings.push('Paket okolnih parcela je nepotpun.');
  x.id=idFor(x);x.savedAt=new Date().toISOString();
  await dbCall('readwrite',store=>store.put(x));await refreshSaved();
  if(current&&idFor(current)===x.id){current=x;mapSurroundings=x.osm||mapSurroundings;}
  shellReady=await checkShell();if(navigator.storage?.persist)await navigator.storage.persist().catch(()=>false);
  status();draw();
  message('Parcela '+x.record.title+' je sačuvana.'+(x.neighborhood?' Sačuvane su i granice okolnih parcela.':'')+(x.osm?' Putevi i okolina su sačuvani.':'')+' '+warnings.join(' ')+(!shellReady?' Offline otvaranje aplikacije još nije potvrđeno.':''),!!warnings.length||!shellReady);
  return{id:x.id,boundarySaved:true,nearbyParcelsSaved:!!x.neighborhood,surroundingsSaved:!!x.osm,appOfflineReady:shellReady};
 }finally{roadsBusy=false;$('save').disabled=false;}
}
$('save').onclick=()=>saveCurrent().catch(e=>message('Čuvanje nije uspelo: '+e.message,true));
async function searchParcel(p,ko,m){if(!p.trim()||!ko.trim()||!m.trim())throw Error('Popunite sva tri polja.');if(!navigator.onLine)throw Error('Za novu pretragu treba internet. Otvorite ranije sačuvanu parcelu.');nearbyMode=false;nearbyLoader.disable();$('searchButton').disabled=true;message('Tražim granicu u GeoSrbiji…');try{const data={records:await liveSearch(p,ko,m),downloadedAt:new Date().toISOString()};$('results').replaceChildren();const packages=data.records.map(record=>validPackage({record,ko,municipality:m,downloadedAt:data.downloadedAt}));if(packages.length===1){show(packages[0]);revealMap();message('Granica pronađena. Sačuvajte je za rad bez mreže.');}else{message('Više rezultata. Izaberite odgovarajuću parcelu.');for(const x of packages){const b=document.createElement('button');b.textContent=x.record.title+' · '+x.record.desc;b.onclick=()=>{show(x);revealMap();$('results').replaceChildren();};$('results').append(b);}}return{matches:packages.length,selected:packages.length===1?packages[0].record.title:null};}finally{$('searchButton').disabled=false;}}
// Load actual cadastral polygons around the GPS fix; never synthesize parcel boundaries.
async function findNearby(centre,isActive=()=>true){
 if(!navigator.onLine)throw Error('Za pretragu okoline treba internet. Otvorite sačuvanu parcelu za rad bez mreže.');
 setNearbyState('loading');message('Tražim parcele oko vašeg položaja…');
 const [east,north]=wgs84ToUtm34(...centre);
 const {records,total}=await searchNearby(east,north,NEARBY_RADIUS);
 if(!isActive())return;
 const downloadedAt=new Date().toISOString();
 const packages=[];let skipped=0;
 for(const record of records){
  try{packages.push(validPackage({record,ko:latinPlace(record.desc),municipality:'',downloadedAt}));}
  catch{skipped++;}
 }
 if(records.length&&!packages.length)throw Error('GeoSrbija je vratila parcele, ali njihove granice nisu mogle da se pročitaju. Pokušajte ponovo ili pretražite parcelu po broju.');
 nearby=packages;
 if(following){view.origin=centre;view.center=[0,0];view.scale=Math.max(.015,Math.min(width,height)/(2.3*NEARBY_RADIUS));}
 $('results').replaceChildren();
 if(!nearby.length){
  const detail='GeoSrbija nije vratila granice za ovaj upit. To ne znači da parcele ne postoje ili da plan nije digitalizovan. Pokušajte ponovo ili pretražite parcelu po broju.';
  setNearbyState('empty',detail);message(detail,true);return;
 }
 setNearbyState('ready');
 const under=nearby.find(x=>{const b=boundary(gps.coords,x.geometry.polygons);return b.inside&&b.distance>gps.accuracy;});
 message(nearby.length+' parcela u krugu od '+NEARBY_RADIUS+' m'+(total>records.length?' (prikaz je nepotpun: '+records.length+' od '+total+')':'')+'. '+(skipped?'Prikaz je nepotpun: '+skipped+' parcela nije prikazano zbog neispravne geometrije. ':'')+'Dodirnite parcelu da je izaberete.'+(under?' Prema trenutnoj GPS proceni: parcela '+under.record.title+'.':''));
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
// Back to the phone: leave a searched parcel's area and load parcels around the GPS position again.
// A selected remote parcel stays selected so its distance and route remain available.
function returnToLocation(){
 const wasNearby=nearbyMode;
 if(!wasNearby){parcelNeighborhoodVersion++;mapNeighborhood=null;parcelNeighborhoodState='';nearby=[];mapSurroundings=null;nearbyMode=true;}
 if(watch===null)startGps();else if(!gps||nearbyFixState(gps)!=='ready')startGps(true);
 following=true;nearbyLoader.enable();
 if(!gps){draw();return;}
 if(wasNearby)view.center=local(gps.coords,view.origin);else{view.origin=gps.coords;view.center=[0,0];}
 updateGps();draw();queueNearby(!wasNearby||!nearby.length);
}
$('locate').onclick=returnToLocation;
// From the GPS area, "show parcel" returns to a remote parcel together with its own neighbors.
$('fit').onclick=()=>{if(current&&nearbyMode&&!nearby.some(x=>idFor(x)===idFor(current)))show(current);else fit();};
$('search').onsubmit=e=>{e.preventDefault();searchParcel($('number').value,$('ko').value,$('municipality').value).catch(e=>message(e.name==='TimeoutError'?'GeoSrbija nije odgovorila na vreme. Pokušajte ponovo.':e.message,true));};
let locationPhase='stopped';
const locationTracker=createLocationTracker({
 geolocation:navigator.geolocation,
 onState:state=>{
  watch=state.active?1:null;locationPhase=state.phase;
  $('gps').textContent=state.active?'Isključi GPS':'Uključi GPS';
  if(!state.active)nearbyLoader.disable();
  updateGps();draw();
 },
 onPosition:fix=>{
  const firstFix=!gps;gpsError=null;gps=fix;
  if(following&&!current&&!nearby.length){view.origin=gps.coords;view.center=[0,0];}
  else if(following)view.center=local(gps.coords,view.origin);
  updateGps();queueNearby();draw();if(firstFix&&following)revealMap();
 },
 onError:error=>{
  gpsError={title:error.code===1?'Lokacija nije dozvoljena':'GPS signal nije dostupan',detail:error.code===1?'Dozvolite lokaciju za ovaj sajt i pregledač.':'Pritisnite „Ponovi lociranje“ ili proverite položaj direktno u Safariju, na otvorenom.'};
  updateGps();draw();
 }
});
function startGps(retry=false){
 if(locationTracker.active&&!retry){locationTracker.stop();following=false;return;}
 if(!navigator.geolocation){
  gpsError={title:'Lokacija nije dostupna',detail:'Otvorite aplikaciju direktno u Safariju ili Chrome-u.'};
  message(gpsError.detail,true);updateGps();draw();return;
 }
 gpsError=null;following=true;if(nearbyMode)nearbyLoader.enable();
 $('gpsTitle').textContent='Tražim nov položaj…';$('gpsDetail').textContent='Čekamo novo očitavanje telefona.';
 if(retry)locationTracker.retry();else locationTracker.start();
}
$('retryGps').onclick=()=>startGps(true);
document.addEventListener('visibilitychange',()=>{
 if(document.visibilityState==='hidden')locationTracker.suspend();
 if(document.visibilityState==='visible'&&locationTracker.active){gpsError=null;locationTracker.resume();updateGps();draw();}
});
function updateGps(){
 $('retryGps').textContent=['locating','retrying'].includes(locationPhase)?'Lociranje…':'Ponovi lociranje';
 $('retryGps').disabled=['locating','retrying'].includes(locationPhase);
 $('retryGps').hidden=!gpsError&&(!gps||nearbyFixState(gps)==='ready')&&watch!==null;
 if(gpsError){$('gpsTitle').textContent=gpsError.title;$('gpsDetail').textContent=gpsError.detail;return;}
 if(!gps)return;
 const quality=nearbyFixState(gps),age=Date.now()-gps.timestamp,stale=quality==='stale'||watch===null;
 if(stale){
  $('gpsTitle').textContent='Poslednji položaj · nije uživo';
  $('gpsDetail').textContent='Tačnost ±'+metres(gps.accuracy)+' · pre '+Math.max(0,Math.round(age/1000))+' s';
 }else if(quality==='coarse'){
  $('gpsTitle').textContent='Lokacija nije dovoljno precizna';
  $('gpsDetail').textContent='Pregledač prijavljuje ±'+metres(gps.accuracy)+' · očitano pre '+Math.max(0,Math.round(age/1000))+' s.'+(['locating','retrying'].includes(locationPhase)?' Novo očitavanje…':'');
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
// Owner data is only in eKatastar behind a captcha (registered API access needs an RGZ contract),
// so the app preselects the cadastral municipality there and hands over the parcel number.
let koTable=null;
const loadKoTable=()=>koTable??=fetch('/ko-ids.txt').then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.text();}).then(parseKoTable).catch(error=>{koTable=null;throw error;});
function updateEkatastar(x){
 const link=$('ekatastar');link.href=EKATASTAR_HOME;link.dataset.koId='';
 $('ekatastarHint').textContent='Otvara javni eKatastar. Tamo izaberite opštinu i katastarsku opštinu, unesite broj parcele i kod sa slike.';
 Promise.resolve().then(loadKoTable).then(entries=>{
  if(current!==x)return;
  const koId=findKoId(entries,{desc:x.record.desc,ko:x.ko,municipality:x.municipality});
  if(!koId)return;
  link.href=ekatastarUrl(koId);link.dataset.koId=koId;
  $('ekatastarHint').textContent='Opština i katastarska opština biće već izabrane. Nalepite broj parcele (kopira se klikom) i prepišite kod sa slike.';
 }).catch(()=>{});
}
$('ekatastar').onclick=()=>{
 if(!current)return;
 navigator.clipboard?.writeText(current.record.title).catch(()=>{});
 const place=[current.ko,current.municipality].filter(Boolean).join(', ');
 message('Broj parcele '+current.record.title+' je kopiran. '+($('ekatastar').dataset.koId?'Na eKatastru nalepite broj u polje „Broj parcele“ i prepišite kod sa slike.':'U eKatastru izaberite '+(place||'opštinu i katastarsku opštinu')+', nalepite broj i prepišite kod sa slike.'));
};
$('gps').onclick=()=>startGps();setInterval(()=>{updateGps();draw();},5000);
function routes(){if(!current)return;const p=current.geometry.points[selection],dest=p.lat+','+p.lon;$('googleRoute').href='https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(dest)+'&travelmode=driving';$('appleRoute').href='https://maps.apple.com/?daddr='+encodeURIComponent(dest)+'&dirflg=d';if(gps){const b=bearing(gps.coords,[p.lon,p.lat]),dirs=['sever','severoistok','istok','jugoistok','jug','jugozapad','zapad','severozapad'];$('bearingText').textContent=p.name+': '+metres(distance(gps.coords,[p.lon,p.lat]))+' vazdušno · '+Math.round(b)+'° ('+dirs[Math.round(b/45)%8]+')'+(Date.now()-gps.timestamp>30000||watch===null?' · prema poslednjem položaju':'');}}
$('destination').onchange=()=>{selection=Number($('destination').value);routes();};$('route').onclick=()=>{routes();$('routeDialog').showModal();};$('help').onclick=()=>$('helpDialog').showModal();document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$('export').onclick=()=>{if(!current)return;const x=structuredClone(current);delete x.geometry;const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(x)],{type:'application/json'}));a.href=url;document.body.append(a);a.download='parcela-'+x.record.title.replace('/','-')+'.json';a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);};$('import').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>15000000)throw Error('Datoteka je veća od 15 MB.');const x=validPackage(JSON.parse(await f.text()));show(x);message('Kopija je otvorena. Pritisnite „Sačuvaj za teren“ da je zadržite na ovom uređaju.');}catch(e){message(e.message,true);}finally{$('import').value='';}};
function network(){ $('network').textContent=navigator.onLine?'Veza dostupna':'Bez mreže'; }addEventListener('online',()=>{network();if(!nearbyMode&&current)openParcelNeighborhood(current);else if(watch!==null)queueNearby(true);draw();});addEventListener('offline',()=>{network();draw();});network();
async function boot(){try{db=await openDb();await refreshSaved();}catch{message('Lokalno čuvanje nije dostupno. Proverite podešavanja pregledača.',true);}if(!navigator.onLine&&saved.length){try{show(saved[0]);}catch(e){message('Nije moguće otvoriti sačuvanu parcelu: '+e.message,true);}}else draw();if(navigator.onLine)startGps();if('serviceWorker'in navigator){try{await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;shellReady=await checkShell();status();}catch{shellReady=false;status();}}}
await boot();
if(document.modelContext?.registerTool){for(const tool of [{name:'list_saved_parcels',description:'Read parcels saved on this device and offline readiness.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:async()=>({parcels:saved.map(x=>({id:x.id,number:x.record.title,ko:x.ko,municipality:x.municipality,surroundingsSaved:!!x.osm})),appOfflineReady:await checkShell()})},{name:'open_saved_parcel',description:'Display a parcel already saved on this device.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},execute:async input=>{const x=saved.find(x=>x.id===input?.id);if(!x)throw Error('Parcela nije sačuvana.');show(x);return{selected:x.id};}}]){try{await document.modelContext.registerTool(tool);}catch{}}}
