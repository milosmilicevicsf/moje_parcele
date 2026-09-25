import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createNearbyLoader,nearbyFixState} from '../public/nearby-loader.js';
import {createLocationTracker} from '../public/location-tracker.js';
import {searchNearby,placeNames} from '../public/geosrbija.js';
import * as geo from '../public/geo.js';
import * as field from '../public/field-geo.js';
import * as neighborhoods from '../public/parcel-neighborhood.js';
import {parseKoTable,findKoId,ekatastarUrl,EKATASTAR_HOME} from '../public/ekatastar.js';
import {createTileLayer,tileZoom,tileAt,tileLon,tileLat,tilesFor,tileUrl,MAX_ZOOM} from '../public/satellite.js';
import * as measure from '../public/parcel-measure.js';
import {navigationLinks} from '../public/navigation.js';
import * as portfolio from '../public/portfolio.js';
import * as backup from '../public/backup.js';
import * as guideModule from '../public/guide.js';
import {createCompass} from '../public/compass.js';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check,tries=50){for(let i=0;i<tries&&!check();i++)await flush();assert(check(),'condition not reached');}
const fix=(coords=[20,44],accuracy=5,timestamp=0)=>({coords,accuracy,timestamp});
const fixture=JSON.parse(fs.readFileSync('tests/fixtures/belgrade-parcel.json','utf8'));
const koTableText='# test\nlajkovac|pepeljevac|700001\nstari grad|stari grad|700002\n';

test('coarse, invalid and stale fixes cannot trigger even a forced nearby query',async()=>{
 const calls=[];let time=100000;
 const loader=createNearbyLoader({now:()=>time,online:()=>true,onError:assert.fail,load:async c=>calls.push(c)});
 for(const f of [null,fix([20,44],6306,time),fix([20,44],101,time),fix([20,44],NaN,time),fix([20,44],-1,time),fix([200,44],5,time),fix([20,44],5,time-30001)])await loader.update(f,true);
 assert.equal(calls.length,0);
 await loader.update(fix([20,44],8,time));assert.equal(calls.length,1);
 assert.equal(nearbyFixState(fix([20,44],100,time),time),'ready');
});

test('jitter is throttled; a moved fix received during a request is not lost',async()=>{
 let time=0,calls=[],release;
 const loader=createNearbyLoader({now:()=>time,online:()=>true,onError:assert.fail,load:async(c,valid)=>{calls.push({coords:c,valid});await new Promise(r=>release=r);}});
 const first=loader.update(fix());assert.equal(calls.length,1);
 time=40000;await loader.update(fix([20.002,44],5,time));assert.equal(calls.length,1);assert(!calls[0].valid());
 release();await flush();assert.equal(calls.length,2);assert.deepEqual(calls[1].coords,[20.002,44]);
 release();await first;
 time+=31000;await loader.update(fix([20.00201,44],5,time));assert.equal(calls.length,2);
});

test('offline does not query; failures retry and disabling invalidates pending results',async()=>{
 let online=false,time=0,calls=0,errors=0,active,release;
 const loader=createNearbyLoader({now:()=>time,online:()=>online,onError:()=>errors++,load:async(c,valid)=>{calls++;if(calls===1)throw Error('timeout');active=valid;await new Promise(r=>release=r);}});
 await loader.update(fix());assert.equal(calls,0);
 online=true;await loader.update(fix());assert.equal(errors,1);
 await loader.update(fix());assert.equal(calls,1);
 time=31000;const pending=loader.update(fix([20,44],5,time));assert.equal(calls,2);assert(active());
 loader.disable();assert(!active());loader.enable();assert(!active());release();await pending;
});

test('coarse fix invalidates a pending response; recovered fix loads without another GPS event',async()=>{
 let release,calls=0,time=0,active;
 const loader=createNearbyLoader({now:()=>time,online:()=>true,onError:assert.fail,load:async(c,valid)=>{calls++;active=valid;await new Promise(r=>release=r);}});
 const pending=loader.update(fix());
 time=1000;await loader.update(fix([20,44],6306,time));assert(!active());
 time=2000;await loader.update(fix([20,44],8,time));assert(!active());
 release();await flush();assert.equal(calls,2);assert(active());release();await pending;
});

test('nearby search covers every regional cadastral layer, never addresses or outlines, and decodes the real Belgrade record',async t=>{
 const rural=JSON.parse(fs.readFileSync('tests/fixtures/parcel.json','utf8')).record;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  const layers=JSON.parse(options.body).request.layers.split(',');
  assert.deepEqual(layers.filter(Boolean),['586','587','588','589','899','939'],'Niš, Kragujevac and Vojvodina return nothing without their layers');
  return Response.json({d:{success:true,total:2,records:[rural,fixture.record].filter(r=>layers.includes(r.layerId))}});
 });
 const result=await searchNearby(...geo.wgs84ToUtm34(20.4604,44.8178),150);
 assert.deepEqual(new Set(result.records.map(r=>r.layerId)),new Set(['586','939']));
 const geometry=geo.parcelGeometry(result.records.find(r=>r.layerId==='939'));
 assert(geometry.area>0);assert(geometry.points.every(p=>Math.abs(p.lat-44.8178)<.01&&Math.abs(p.lon-20.4604)<.01));
});

test('nearby service paginates and deduplicates geometry',async t=>{
 const starts=[],record=i=>({uid:String(i),title:String(i),fullGeom:'POLYGON ((1 1,2 1,2 2,1 1))'});
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  const {request}=JSON.parse(options.body);starts.push(request.start);
  return Response.json({d:{success:true,total:102,records:request.start===0?Array.from({length:100},(_,i)=>record(i)):[record(99),record(100)]}});
 });
 const result=await searchNearby(432954,4909699,150);
 assert.deepEqual(starts,[0,100]);assert.equal(result.records.length,101);assert.equal(result.total,102);
});

test('an upstream that repeats the first page cannot loop forever',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({success:true,total:10000,records:Array.from({length:100},(_,i)=>({uid:String(i),title:String(i),fullGeom:'POLYGON ((1 1,2 1,2 2,1 1))'}))});});
 const result=await searchNearby(432954,4909699,150);assert.equal(calls,2);assert.equal(result.records.length,100);assert.equal(result.total,10000);
});

test('empty spatial result is data, not evidence that a cadastral plan is missing',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({success:true,total:0,records:[]}));
 assert.deepEqual(await searchNearby(432954,4909699,150),{records:[],total:0});
});

async function appHarness(search=async()=>({records:[fixture.record],total:1}),stored=new Map(),url=''){
 const labels=[],elements=new Map(),tileRequests=[],images=[],compassHandlers={},blobs=[],created=[];let resize,gpsCallback,gpsFailure,queries=0,strokes=0,reads=0,interval,time=Date.now();
 const compassTarget={ondeviceorientationabsolute:null,addEventListener:(type,fn)=>compassHandlers[type]=fn,removeEventListener:type=>delete compassHandlers[type]};
 const context2d=new Proxy({strokeText:text=>labels.push(text),stroke:()=>strokes++,drawImage:(...args)=>images.push(args),measureText:text=>({width:text.length*7})},{get:(obj,key)=>obj[key]??(()=>{})});
 function element(id){if(!elements.has(id))elements.set(id,{textContent:'',style:{},hidden:false,classList:{toggle(name,on){this[name]=on;},add(){},remove(){}},append(){},replaceChildren(){},scrollIntoView(){},setPointerCapture(){},listeners:new Map(),addEventListener(type,fn){const handlers=this.listeners.get(type)||[];handlers.push(fn);this.listeners.set(type,handlers);},dispatch(type,event){for(const fn of this.listeners.get(type)||[])fn(event);},close(){this.open=false;},setAttribute(name,value){this[name]=value;},dataset:{},parentElement:{classList:{toggle(name,on){this[name]=on;}}},getBoundingClientRect:()=>({width:800,height:600,left:0,top:0}),getContext:()=>context2d});return elements.get(id);}
 const scope={...geo,...field,...neighborhoods,...measure,navigationLinks,...portfolio,...backup,...guideModule,Blob,URL:{createObjectURL:blob=>{blobs.push(blob);return 'blob:'+blobs.length;},revokeObjectURL(){}},
  createCompass:options=>createCompass({...options,target:compassTarget,Orientation:{},screenAngle:()=>0}),createLocationTracker:options=>createLocationTracker({...options,now:()=>time,setTimer:()=>1,clearTimer(){}}),nearbyFixState:(f,n=time)=>nearbyFixState(f,n),
  createNearbyLoader:options=>createNearbyLoader({...options,online:()=>scope.navigator.onLine,now:()=>time}),
  latinPlace:x=>x,placeNames,searchNearby:async(...args)=>{queries++;return search(...args);},
  SURROUNDINGS_URL:'/api/surroundings',SATELLITE_TILES:'https://tiles.test/{z}/{y}/{x}',SATELLITE_ATTRIBUTION:'Test imagery',
  createTileLayer:options=>{const layer=createTileLayer({...options,load:(url,done)=>{tileRequests.push(url);queueMicrotask(()=>done(true));return {url};}});return layer;},
  parseKoTable,findKoId,ekatastarUrl,EKATASTAR_HOME,fetch:async url=>url==='/ko-ids.txt'?new Response(koTableText):new Response('',{status:404}),
  localStorage:{getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value)},requestAnimationFrame:fn=>queueMicrotask(fn),
  document:{getElementById:element,querySelectorAll:()=>[],body:{append(){}},createElement:tag=>{const e={tag,style:{},dataset:{},children:[],classList:{add(){},remove(){},toggle(){}},append(...items){this.children.push(...items);},replaceChildren(){},setAttribute(name,value){this[name]=value;},addEventListener(){},click(){this.clicked=true;},remove(){}};created.push(e);return e;},addEventListener(){}},navigator:{onLine:true,geolocation:{watchPosition(fn,error){gpsCallback=fn;gpsFailure=error;return 1;},getCurrentPosition(){reads++;},clearWatch(){}}},
  indexedDB:{open(){const request={};queueMicrotask(()=>request.onerror());return request;}},
  ResizeObserver:class{constructor(fn){this.fn=fn;resize=fn;}observe(){queueMicrotask(this.fn);}},structuredClone,innerWidth:800,devicePixelRatio:1,addEventListener(){},setInterval(fn){interval=fn;},console,Date:class extends Date{static now(){return time;}},Map,Math,setTimeout,clearTimeout,
  URLSearchParams,location:{search:url,pathname:'/teren.html',origin:'https://test.local'},history:{replaceState(){}}};
 vm.createContext(scope);
 const source=fs.readFileSync('public/teren.js','utf8').replace(/^import .*;\n/gm,'').replace('await boot();','boot();').split('if(document.modelContext?.registerTool)')[0];
 vm.runInContext(source,scope);await flush();assert.equal(typeof gpsCallback,'function');
 return {element,labels,tileRequests,images,stored,blobs,created,resize:()=>resize(),get reads(){return reads;},get queries(){return queries;},get strokes(){return strokes;},
  async emit(accuracy,coords=[20.4604,44.8178]){gpsCallback({coords:{latitude:coords[1],longitude:coords[0],accuracy},timestamp:time});await flush();},
  async tick(ms){time+=ms;interval();await flush();},
  async fail(code){gpsFailure({code});await flush();},
  compass(event){compassHandlers.deviceorientationabsolute?.(event);},
  run(code){return vm.runInContext(code,scope);},scope};
}

test('screenshot regression: 6306 m accuracy shows actionable guidance, then precise fix draws automatically',async()=>{
 const app=await appHarness();
 await app.emit(6306);assert.equal(app.queries,0);
 assert.match(app.element('gpsTitle').textContent,/nije dovoljno precizna/);
 assert.match(app.element('gpsDetail').textContent,/6\.3 km/);
 assert.match(app.element('emptyDetail').textContent,/Ponovi lociranje/);
 assert.equal(app.element('retryGps').hidden,false);
 assert.equal(app.reads,1);app.element('retryGps').onclick();await flush();assert.equal(app.reads,2,'retry button requests a new uncached reading');
 assert.doesNotMatch(app.element('emptyTitle').textContent,/Učitavamo/);
 app.element('locate').onclick();await flush();assert.equal(app.queries,0,'button cannot bypass accuracy validation');
 await app.tick(1000);await app.emit(8);assert.equal(app.queries,1);assert(app.labels.includes(fixture.record.title));assert(app.strokes>0);
 assert.equal(app.element('emptyHint').hidden,true);assert.equal(app.element('mapMode').textContent,'Parcele u okolini');
 app.scope.fixture=structuredClone(fixture);app.run('show(fixture)');await flush();
 const afterOpen=app.queries;assert.equal(afterOpen,2,'manual open loads its own neighborhood');
 await app.tick(31000);await app.emit(5,[20.47,44.82]);assert.equal(app.queries,afterOpen,'GPS updates cannot replace the remote neighborhood');
});

test('empty and failed queries stop the map loading message',async()=>{
 for(const [search,title] of [[async()=>({records:[],total:0}),'Pretraga nije vratila granice'],[async()=>{throw Error('HTTP 503');},'Granice trenutno nisu učitane']]){
  const app=await appHarness(search);await app.emit(5);
  assert.equal(app.element('emptyTitle').textContent,title);
  assert.doesNotMatch(app.element('emptyDetail').textContent,/Učitavamo/);
 }
});

test('location quality deterioration, staleness, denial and stopping GPS remain visible',async()=>{
 const app=await appHarness();await app.emit(6306);await app.tick(31000);
 assert.match(app.element('gpsTitle').textContent,/nije uživo/);
 await app.fail(1);assert.match(app.element('gpsTitle').textContent,/nije dozvoljena/);
 assert.match(app.element('emptyTitle').textContent,/nije dozvoljena/);
 const other=await appHarness();await other.emit(8);await other.tick(1000);await other.emit(6306);
 assert.equal(other.queries,1);assert.match(other.element('gpsTitle').textContent,/nije dovoljno precizna/);
 other.element('gps').onclick();assert.match(other.element('gpsTitle').textContent,/nije uživo/);
});

// Synthetic UTM circle: more vertices than the legacy 500-pin Maps limit.
function largeRecord(count=2000){
 const ring=Array.from({length:count},(_,i)=>{const a=2*Math.PI*i/count;return [457350+50*Math.cos(a),4962840+50*Math.sin(a)];});
 ring.push(ring[0]);
 return {...fixture.record,uid:'synthetic-large',title:'Test large polygon',fullGeom:'POLYGON (('+ring.map(p=>p.join(' ')).join(',')+'))'};
}
test('large boundaries retain every vertex and survive export/import without simplification',()=>{
 const record=largeRecord(),geometry=geo.parcelGeometry(record);
 assert.equal(geometry.points.length,2000);assert.equal(geometry.polygons[0][0].length,2000);
 assert(Math.abs(geometry.area-Math.PI*2500)<1);
 assert.deepEqual(geo.parcelGeometry(JSON.parse(JSON.stringify(record))),geometry);
});
test('nearby renders large parcels; one malformed record does not block valid boundaries',async()=>{
 const record=largeRecord();
 const app=await appHarness(async()=>({records:[record,fixture.record,{...fixture.record,fullGeom:'POLYGON ((bad))'}],total:3}));
 await app.emit(9);
 assert(app.strokes>0);assert(app.labels.includes(record.title));
 assert.equal(app.run('nearby.length'),2);
 assert.equal(app.run('nearby[0].geometry.points.length'),2000);
 assert.equal(app.element('emptyHint').hidden,true);
 assert.match(app.run("$('message').textContent"),/nepotpun/);
 app.run('show(nearby[0])');assert.equal(app.run('current.geometry.points.length'),2000);
});
test('unreadable geometries report a decoding failure instead of missing cadastral coverage',async()=>{
 const app=await appHarness(async()=>({records:[{...fixture.record,fullGeom:'POLYGON ((bad))'}],total:1}));
 await app.emit(9);
 assert.match(app.element('emptyDetail').textContent,/nisu mogle da se pročitaju/);
});

// Synthetic neighboring UTM parcels keep tap coordinates deterministic.
function squareRecord(uid,east,north,size=30){
 const ring=[[east,north],[east+size,north],[east+size,north+size],[east,north+size],[east,north]];
 return {...fixture.record,uid,title:uid,fullGeom:'POLYGON (('+ring.map(p=>p.join(' ')).join(',')+'))'};
}
function pointer(app,type,point,id=1){app.element('map').dispatch(type,{pointerId:id,clientX:point[0],clientY:point[1]});}
function tapAt(app,east,north){
 const coords=geo.utm34ToWgs84(east,north),p=app.run('pixel('+JSON.stringify(coords)+')');
 pointer(app,'pointerdown',p);pointer(app,'pointerup',p);
}
async function holdAt(app,east,north){
 const coords=geo.utm34ToWgs84(east,north),p=app.run('pixel('+JSON.stringify(coords)+')');
 pointer(app,'pointerdown',p);await app.tick(600);pointer(app,'pointerup',p);await flush();
}
test('map taps switch parcels and toggle or explicitly clear selection without losing context',async()=>{
 const records=[squareRecord('A',457300,4962800),squareRecord('B',457340,4962800)];
 const app=await appHarness(async()=>({records,total:2}));await app.emit(9);
 tapAt(app,457315,4962815);assert.equal(app.run('current.record.title'),'A');
 assert.equal(app.element('clearSelection').hidden,false);
 assert.equal(app.element('mapMode').textContent,'Parcela A');
 tapAt(app,457355,4962815);assert.equal(app.run('current.record.title'),'B');
 const view=app.run('JSON.stringify(view)');
 app.element('clearSelection').onclick();
 assert.equal(app.run('current'),null);assert.equal(app.run('nearby.length'),2);
 assert.equal(app.run('JSON.stringify(view)'),view);assert.equal(app.element('parcelCard').hidden,true);
 assert.equal(app.element('clearSelection').hidden,true);assert.equal(app.run('watch'),1);
 assert.equal(app.queries,1,'clearing a loaded map does not require another network request');
 tapAt(app,457315,4962815);tapAt(app,457315,4962815);assert.equal(app.run('current'),null);
 tapAt(app,457355,4962815);tapAt(app,457395,4962815);assert.equal(app.run('current'),null,'empty map clears selection');
});
test('opening a saved parcel retains selectable neighbors and its downloaded background on clearing',async()=>{
 const records=[squareRecord('A',457300,4962800),squareRecord('B',457340,4962800)];
 const app=await appHarness(async()=>({records,total:2}));await app.emit(9);
 app.run("nearby[0].osm={elements:[],bbox:[44,20,45,21]};show(nearby[0])");
 assert.equal(app.run('nearby.length'),2);
 app.element('clearSelection').onclick();assert.equal(app.run('mapSurroundings.bbox.length'),4);
 tapAt(app,457355,4962815);assert.equal(app.run('current.record.title'),'B');
 app.scope.navigator.onLine=false;
 app.scope.offlinePackage={...fixture,record:squareRecord('offline',457380,4962800)};
 app.run('show(offlinePackage)');app.element('clearSelection').onclick();
 tapAt(app,457395,4962815);assert.equal(app.run('current.record.title'),'offline');
});
test('a large overlapping polygon does not swallow taps on a smaller parcel',async()=>{
 const records=[squareRecord('large',457300,4962800,100),squareRecord('small',457310,4962810,20)];
 const app=await appHarness(async()=>({records,total:2}));await app.emit(9);
 tapAt(app,457380,4962880);assert.equal(app.run('current.record.title'),'large');
 tapAt(app,457320,4962820);assert.equal(app.run('current.record.title'),'small');
});
test('dragging, pinching and cancelled touches never change parcel selection',async()=>{
 const app=await appHarness(async()=>({records:[squareRecord('A',457300,4962800)],total:1}));await app.emit(9);
 tapAt(app,457315,4962815);
 pointer(app,'pointerdown',[100,100]);pointer(app,'pointermove',[150,100]);pointer(app,'pointermove',[100,100]);pointer(app,'pointerup',[100,100]);
 assert.equal(app.run('current.record.title'),'A','returning to the drag origin is not a tap');
 pointer(app,'pointerdown',[100,100]);pointer(app,'pointerdown',[150,100],2);pointer(app,'pointerup',[150,100],2);pointer(app,'pointerup',[100,100]);
 assert.equal(app.run('current.record.title'),'A');
 pointer(app,'pointerdown',[100,100]);pointer(app,'pointercancel',[100,100]);pointer(app,'pointerup',[100,100]);
 assert.equal(app.run('current.record.title'),'A');
});
test('a quick tap beside parcels keeps them and never queries; a long press or right click loads another area',async()=>{
 const records=[squareRecord('A',457300,4962800),squareRecord('B',457340,4962800)];
 const app=await appHarness(async()=>({records,total:2}));await app.emit(9);
 const queries=app.queries;
 tapAt(app,457395,4962815);await flush();
 assert.equal(app.queries,queries);assert.equal(app.run('nearby.length'),2);assert.equal(app.run('mapPin'),null);
 assert.match(app.element('message').textContent,/držite prst/);
 tapAt(app,457315,4962815);assert.equal(app.run('current.record.title'),'A');
 const view=app.run('JSON.stringify(view)');
 tapAt(app,457395,4962815);await flush();
 assert.equal(app.run('current'),null,'a mistaken tap only clears the selection');
 assert.equal(app.queries,queries);assert.equal(app.run('nearby.length'),2);assert.equal(app.run('JSON.stringify(view)'),view);
 await holdAt(app,457355,4962815);assert.equal(app.run('current.record.title'),'B','a long press on a parcel selects it');assert.equal(app.queries,queries);
 await holdAt(app,457395,4962815);
 assert.equal(app.queries,queries+1,'a long press on an empty spot loads parcels around it');assert.equal(app.run('current'),null);assert(app.run('mapPin'));
 const map=app.element('map'),empty=()=>app.run('pixel('+JSON.stringify(geo.utm34ToWgs84(457395,4962900))+')');
 let p=empty(),prevented=false;
 map.dispatch('pointerdown',{pointerId:5,button:0,clientX:p[0],clientY:p[1]});
 map.dispatch('contextmenu',{clientX:p[0],clientY:p[1],preventDefault(){prevented=true;}});
 map.dispatch('pointerup',{pointerId:5,button:0,clientX:p[0],clientY:p[1]});await flush();
 assert(prevented);assert.equal(app.queries,queries+2,'Android reports a touch long press as a context menu');
 p=empty();
 map.dispatch('pointerdown',{pointerId:6,button:2,clientX:p[0],clientY:p[1]});map.dispatch('pointerup',{pointerId:6,button:2,clientX:p[0],clientY:p[1]});
 map.dispatch('contextmenu',{clientX:p[0]+40,clientY:p[1],preventDefault(){}});await flush();
 assert.equal(app.queries,queries+3,'a right click loads parcels on desktop');
});
test('wheel and pinch zoom keep the point under the cursor or between the fingers in place',async()=>{
 const app=await appHarness(async()=>({records:[squareRecord('A',457300,4962800)],total:1}));await app.emit(9);
 tapAt(app,457315,4962815);
 const at=(x,y)=>app.run(`coordsAt(${x},${y})`),same=(a,b)=>Math.abs(a[0]-b[0])<1e-9&&Math.abs(a[1]-b[1])<1e-9;
 const before=at(200,150),scale=app.run('view.scale');let prevented=false;
 app.element('map').dispatch('wheel',{deltaY:-100,clientX:200,clientY:150,preventDefault(){prevented=true;}});
 assert(prevented);assert(Math.abs(app.run('view.scale')/scale-1.2)<1e-9);assert(same(at(200,150),before),'the point under the cursor stays');
 const start=at(400,300),s0=app.run('view.scale');
 pointer(app,'pointerdown',[300,300],1);pointer(app,'pointerdown',[500,300],2);
 pointer(app,'pointermove',[500,300],2);pointer(app,'pointermove',[600,300],2);
 assert(Math.abs(app.run('view.scale')/s0-1.5)<1e-9,'finger distance 200 -> 300 zooms 1.5x');
 assert(same(at(450,300),start),'the point between the fingers follows their midpoint');
 pointer(app,'pointerup',[600,300],2);pointer(app,'pointerup',[300,300],1);
 assert.equal(app.run('current.record.title'),'A','zooming never changes the selection');
});
test('a save completing after selection is cleared does not restore or replace a selected parcel',async()=>{
 const app=await appHarness(async()=>({records:[squareRecord('A',457300,4962800),squareRecord('B',457340,4962800)],total:2}));await app.emit(9);
 app.run("show(nearby[0],false);db={};let releaseSave;fetchSurroundings=()=>new Promise(resolve=>releaseSave=resolve);dbCall=async()=>{};refreshSaved=async()=>{};checkShell=async()=>true;var pendingSave=saveCurrent()");
 app.element('clearSelection').onclick();
 app.run("releaseSave({elements:[],bbox:[44,20,45,21]})");await app.run('pendingSave');
 assert.equal(app.run('current'),null);assert.equal(app.element('save').disabled,false);
 app.run("show(nearby[0],false);pendingSave=saveCurrent();show(nearby[1],false);releaseSave({elements:[],bbox:[44,20,45,21]})");await app.run('pendingSave');
 assert.equal(app.run('current.record.title'),'B');
});

test('searching a remote parcel loads its neighbors without GPS and clearing stays in that area',async()=>{
 const remote=JSON.parse(fs.readFileSync('tests/fixtures/parcel.json','utf8'));
 const neighbor=squareRecord('remote-neighbor',433050,4909700),calls=[];
 const app=await appHarness(async(...args)=>{calls.push(args);return {records:[remote.record,neighbor],total:2};});
 app.scope.liveSearch=async()=>[remote.record];
 await app.run("searchParcel('1227/2','Pepeljevac','Lajkovac')");await flush();
 const q=neighborhoods.parcelNeighborhoodQuery(geo.parcelGeometry(remote.record));
 assert.deepEqual(calls[0],[...q.center,q.radius]);
 assert.equal(app.run('current.record.title'),'1227/2');assert(app.run("nearby.some(x=>x.record.title==='remote-neighbor')"));
 const view=app.run('JSON.stringify(view)');app.element('clearSelection').onclick();
 await app.emit(8,[20.46,44.82]);assert.equal(calls.length,1);
 assert.equal(app.run('JSON.stringify(view)'),view,'GPS must not move a remote overview back to the phone');
 tapAt(app,433065,4909715);assert.equal(app.run('current.record.title'),'remote-neighbor');
});

test('a long press on an empty remote location places a pin and loads selectable parcels there without GPS',async()=>{
 const remote=squareRecord('remote',433000,4909700),calls=[];
 const app=await appHarness(async(east,north,radius)=>{calls.push([east,north,radius]);return {records:[remote],total:1};});
 const point=geo.utm34ToWgs84(433015,4909745);
 app.run('view.origin='+JSON.stringify(point)+';view.center=[0,0];view.scale=2;draw()');
 tapAt(app,433015,4909745);await flush();assert.equal(calls.length,0,'a quick tap does not query');
 await holdAt(app,433015,4909745);
 assert.equal(calls.length,1);assert(Math.abs(calls[0][0]-433015)<1);assert(Math.abs(calls[0][1]-4909745)<1);
 assert.equal(calls[0][2],150);assert.equal(app.run('nearbyMode'),false);
 assert.equal(app.run('nearby[0].record.title'),'remote');
 assert.equal(app.element('mapMode').textContent,'Parcele oko pina');
 assert.match(app.element('coverage').textContent,/parcela oko pina/);
 assert.deepEqual([...app.run('mapPin')],point);
 await app.emit(8,geo.utm34ToWgs84(457315,4962815));
 assert.equal(calls.length,1,'a GPS fix must not replace manually loaded parcels');
 tapAt(app,433015,4909715);assert.equal(app.run('current.record.title'),'remote');
 app.element('locate').onclick();await flush();
 assert.equal(app.run('mapPin'),null);assert.equal(app.run('nearbyMode'),true);assert.equal(calls.length,2);
});

test('latest pin wins, a drag does not place a pin, and offline taps do not query',async()=>{
 const pending=[],app=await appHarness((...args)=>new Promise(resolve=>pending.push({args,resolve})));
 const a=geo.utm34ToWgs84(433015,4909745),b=geo.utm34ToWgs84(443015,4919745);
 app.run('view.origin='+JSON.stringify(a)+';view.center=[0,0];view.scale=1;draw()');
 pointer(app,'pointerdown',[100,100]);pointer(app,'pointermove',[140,100]);pointer(app,'pointerup',[140,100]);
 assert.equal(pending.length,0);
 app.run('loadAtPin('+JSON.stringify(a)+');loadAtPin('+JSON.stringify(b)+')');
 assert.equal(pending.length,2);
 pending[1].resolve({records:[squareRecord('B',443000,4919700)],total:1});await flush();
 pending[0].resolve({records:[squareRecord('A',433000,4909700)],total:1});await flush();
 assert.equal(app.run('nearby[0].record.title'),'B');assert.deepEqual([...app.run('mapPin')],b);
 app.scope.navigator.onLine=false;
 const count=pending.length;await app.run('loadAtPin('+JSON.stringify(a)+')');assert.equal(pending.length,count);
 assert.equal(app.run('nearby[0].record.title'),'B');
});

test('a late searched-parcel neighborhood cannot replace the pin area',async()=>{
 const pending=[],app=await appHarness((...args)=>new Promise(resolve=>pending.push({args,resolve})));
 app.scope.remote={...fixture,record:squareRecord('searched',433000,4909700)};
 app.run('show(remote)');assert.equal(pending.length,1);
 const pin=geo.utm34ToWgs84(443015,4919745);
 app.run('loadAtPin('+JSON.stringify(pin)+')');assert.equal(pending.length,2);
 pending[1].resolve({records:[squareRecord('pin-neighbor',443000,4919700)],total:1});await flush();
 pending[0].resolve({records:[squareRecord('old-neighbor',433040,4909700)],total:1});await flush();
 assert.equal(app.run('current'),null);
 assert.equal(app.run('nearby[0].record.title'),'pin-neighbor');
 assert.deepEqual([...app.run('mapPin')],pin);
});

test('switching remote parcels or returning to GPS ignores late parcel-centered responses',async()=>{
 const pending=[],app=await appHarness((...args)=>new Promise(resolve=>pending.push({args,resolve})));
 app.scope.a={...fixture,record:squareRecord('A',433000,4909700)};
 app.scope.b={...fixture,record:squareRecord('B',443000,4919700)};
 app.run('show(a);show(b)');assert.equal(pending.length,2);
 pending[1].resolve({records:[app.scope.b.record,squareRecord('B-neighbor',443040,4919700)],total:2});await flush();
 pending[0].resolve({records:[app.scope.a.record],total:1});await flush();
 assert.equal(app.run('current.record.title'),'B');assert.equal(app.run('nearby[1].record.title'),'B-neighbor');
 app.run('show(a)');assert.equal(pending.length,3);app.element('locate').onclick();
 pending[2].resolve({records:[app.scope.a.record],total:1});await flush();
 assert.equal(app.run('current.record.title'),'A','returning to GPS keeps the selected parcel');assert.equal(app.run('nearby.length'),0);
});

function fakeStorage(app,initial=[]){
 app.scope.initialPackages=structuredClone(initial);
 app.run(`db={};var storedPackages=new Map(initialPackages.map(x=>[x.id,x]));
 dbCall=async(mode,fn)=>{
  const request=fn({
   get(id){const r={result:structuredClone(storedPackages.get(id))};Promise.resolve().then(()=>r.onsuccess?.());return r;},
   put(x){storedPackages.set(x.id,structuredClone(x));return {result:x.id};}
  });
  await Promise.resolve();return request.result;
 };
 refreshSaved=async()=>{saved=[...storedPackages.values()];};
 checkShell=async()=>true;
 fetchSurroundings=async()=>({elements:[],bbox:[44,20,45,21]});
 saved=[...storedPackages.values()];`);
}

test('terrain save includes raw neighboring boundaries and a fresh offline session can select them',async()=>{
 const a=squareRecord('A',433000,4909700),b=squareRecord('B',433040,4909700);
 const app=await appHarness(async()=>({records:[a,b],total:2}));fakeStorage(app);
 app.scope.target={...fixture,record:a};app.run('show(target)');await flush();
 const result=await app.run('saveCurrent()');assert.equal(result.nearbyParcelsSaved,true);
 const exported=app.run("JSON.stringify(storedPackages.get('A'))"),snapshot=JSON.parse(exported);
 assert.equal(snapshot.neighborhood.records.length,2);assert(!('neighborhood' in snapshot.neighborhood.records[0]));
 const offline=await appHarness(async()=>{throw Error('No network should be needed');});
 offline.scope.navigator.onLine=false;offline.scope.imported=JSON.parse(exported);offline.run('show(imported)');
 assert.equal(offline.queries,0);assert(offline.labels.includes('B'));tapAt(offline,433055,4909715);
 assert.equal(offline.run('current.record.title'),'B');
 offline.element('clearSelection').onclick();assert.equal(offline.run('nearby.length'),2);
});

test('opening a legacy saved package online persists neighbors and never recreates a deleted package',async()=>{
 const a=squareRecord('A',433000,4909700),b=squareRecord('B',433040,4909700),initial={...fixture,id:'A',record:a};
 const app=await appHarness(async()=>({records:[a,b],total:2}));fakeStorage(app,[initial]);
 app.run('show(saved[0])');await flush();await flush();
 assert.equal(app.run("storedPackages.get('A').neighborhood.records.length"),2);
 let release;const deleted=await appHarness(()=>new Promise(resolve=>release=resolve));fakeStorage(deleted,[initial]);
 deleted.run("show(saved[0]);storedPackages.delete('A')");release({records:[a,b],total:2});await flush();
 assert.equal(deleted.run('storedPackages.size'),0);
});

test('a failed refresh preserves cached neighbors; an old offline package reports missing neighbors',async()=>{
 const a=squareRecord('A',433000,4909700),b=squareRecord('B',433040,4909700);
 const data=await neighborhoods.downloadNeighborhood({record:a},async()=>({records:[a,b],total:2}));
 const app=await appHarness(async()=>{throw Error('HTTP 503');});
 app.scope.cached={...fixture,record:a,neighborhood:data.snapshot};app.run('show(cached)');await flush();
 assert.equal(app.run('nearby.length'),2);assert.match(app.element('coverage').textContent,/sačuvane/);
 assert.equal(app.run('current.record.title'),'A');
 app.scope.navigator.onLine=false;app.scope.old={...fixture,record:squareRecord('old',443000,4919700)};app.run('show(old)');
 assert.equal(app.run('nearby.length'),1);assert.match(app.element('coverage').textContent,/nisu sačuvane/);
});

test('parcel query radius includes a margin and large parcels/partial records remain explicit',async()=>{
 const geometry=geo.parcelGeometry(squareRecord('large',433000,4909700,2000));
 assert.deepEqual(neighborhoods.parcelNeighborhoodQuery(geometry),{center:[434000,4910700],radius:1000,limited:true});
 const good=squareRecord('good',433000,4909700);
 const result=await neighborhoods.downloadNeighborhood({record:good},async()=>({records:[good,{...good,uid:'bad',fullGeom:'POLYGON ((bad))'}],total:3}));
 assert.equal(result.parcels.length,1);assert.equal(result.snapshot.skipped,1);
 assert.match(neighborhoods.neighborhoodSummary(result.snapshot),/nepotpun/);
 assert.throws(()=>neighborhoods.readNeighborhood({...result.snapshot,records:new Array(1001)}));
});

test('satellite tiles: zoom choice, tile grid and URL template',()=>{
 // ~0.3 m/px at Belgrade needs z19; zooming far out lowers the level; never above the provider maximum.
 assert.equal(tileZoom(0.2,44.81),MAX_ZOOM);assert.equal(tileZoom(1.1,44.81),17);assert(tileZoom(500,44.81)<=9);
 const [x,y]=tileAt(20.4604,44.8178,18);
 assert(tileLon(x,18)<=20.4604&&tileLon(x+1,18)>20.4604);assert(tileLat(y,18)>=44.8178&&tileLat(y+1,18)<44.8178);
 assert.equal(tileUrl('https://t/{z}/{y}/{x}',[18,x,y]),`https://t/18/${y}/${x}`);
 assert.equal(tilesFor([20.46,44.81,20.461,44.811],18).length<=4,true);
 assert.equal(tilesFor([19,42,23,46],18),null,'a whole-country view does not request thousands of tiles');
});

test('satellite tiles: missing zoom falls back to a scaled-up ancestor',async()=>{
 const state=new Map(),drawn=[];let changes=0;
 const layer=createTileLayer({template:'{z}/{x}/{y}',onChange:()=>changes++,load:(url,done)=>{const z=Number(url.split('/')[0]);queueMicrotask(()=>done(z<=18));state.set(url,z);return {url};}});
 const ctx={drawImage:(image,sx,sy,sw)=>drawn.push([image.url,sw])},pixel=([lon,lat])=>[(lon-20.46)*1e5,(44.82-lat)*1e5];
 const bounds=[20.4600,44.8170,20.4601,44.8171];
 let result=layer.draw(ctx,pixel,bounds,0.2);assert(result.pending>0);assert.equal(drawn.length,0);
 await flush();drawn.length=0;
 result=layer.draw(ctx,pixel,bounds,0.2);
 assert(result.pending>0,'z19 is missing, so its z18 parent is requested');await flush();drawn.length=0;
 result=layer.draw(ctx,pixel,bounds,0.2);
 assert.equal(result.pending,0);assert.equal(result.missing,0);
 assert(drawn.length>0&&drawn.every(([url,size])=>url.startsWith('18/')&&size===128),'draws the matching half of the z18 tile');
 assert(changes>0);
});

test('basemap toggle shows imagery under parcels, remembers the choice and falls back offline',async()=>{
 const app=await appHarness();await app.emit(8);
 assert.equal(app.element('basemap').textContent,'Satelit');assert.equal(app.tileRequests.length,0,'default map requests no imagery');
 app.element('basemap').onclick();await flush();await flush();
 assert.equal(app.stored.get('basemap'),'satellite');assert.equal(app.element('basemap').textContent,'Mapa');
 assert(app.tileRequests.length>0&&app.tileRequests.every(u=>u.startsWith('https://tiles.test/')));
 assert(app.images.length>0,'loaded tiles are drawn');assert.equal(app.element('imageryCredit').hidden,false);
 assert.match(app.element('coverage').textContent,/Satelitski snimak/);
 app.scope.navigator.onLine=false;app.run('draw()');
 assert.equal(app.element('imageryCredit').hidden,true);assert.match(app.element('coverage').textContent,/zahteva internet/);
 app.scope.navigator.onLine=true;
 const again=await appHarness(undefined,new Map([['basemap','satellite']]));await again.emit(8);await flush();
 assert.equal(again.element('basemap').textContent,'Mapa','choice survives reload');
 again.element('basemap').onclick();assert.equal(again.stored.get('basemap'),'map');assert.equal(again.element('imageryCredit').hidden,true);
});

test('bug: after searching a remote parcel, the location button loads parcels around the phone again',async()=>{
 const remote=JSON.parse(fs.readFileSync('tests/fixtures/parcel.json','utf8')),calls=[];
 const local=squareRecord('mine',457300,4962800);
 const app=await appHarness(async(east,north,radius)=>{calls.push([east,north,radius]);return east>450000?{records:[local],total:1}:{records:[remote.record],total:1};});
 await app.emit(8,geo.utm34ToWgs84(457315,4962815));assert.equal(calls.length,1);
 app.scope.liveSearch=async()=>[remote.record];
 await app.run("searchParcel('1227/2','Pepeljevac','Lajkovac')");await flush();
 assert.equal(calls.length,2);assert.equal(app.run('nearbyMode'),false);
 app.element('locate').onclick();await flush();
 assert.equal(calls.length,3,'the same GPS position is queried again even without 75 m of movement');
 assert.equal(app.run('nearbyMode'),true);assert.equal(app.run('nearby[0].record.title'),'mine');
 assert.equal(app.run('current.record.title'),'1227/2');
 const center=app.run('JSON.stringify(unlocal(view.center,view.origin))');
 assert.deepEqual(JSON.parse(center).map(n=>+n.toFixed(4)),geo.utm34ToWgs84(457315,4962815).map(n=>+n.toFixed(4)));
 tapAt(app,457315,4962815);assert.equal(app.run('current.record.title'),'mine','local parcels are selectable');
 app.scope.remote=remote;app.run('show(remote,false)');
 app.element('fit').onclick();await flush();
 assert.equal(app.run('nearbyMode'),false,'"show parcel" returns to the remote parcel and its neighbors');assert.equal(calls.length,4);
});

test('bundled RGZ KO table resolves reference parcels and never returns a wrong KO',()=>{
 const entries=parseKoTable(fs.readFileSync('public/ko-ids.txt','utf8'));
 assert(entries.length>5000);
 assert.equal(new Set(entries.map(e=>e.id)).size,entries.length);
 const remote=JSON.parse(fs.readFileSync('tests/fixtures/parcel.json','utf8'));
 assert.equal(findKoId(entries,{desc:remote.record.desc}),'728195','Pepeljevac exists in three municipalities; Lajkovac is chosen');
 assert.equal(findKoId(entries,{desc:fixture.record.desc}),'704059','Stari Grad Belgrade, not Stari Grad Subotica');
 assert.equal(findKoId(entries,{desc:'ČUKARICA ČUKARICA'}),'704083','value observed in a live eKatastar URL');
 assert.equal(findKoId(entries,{desc:'ЗРЕЊАНИН I ZRENJANIN I ЗРЕЊАНИН ZRENJANIN'}),'805742','Vojvodina descriptions list Cyrillic first');
 assert.equal(findKoId(entries,{desc:'PALILULA PALILULA (BEOGRAD) ПАЛИЛУЛА ПАЛИЛУЛА (БЕОГРАД)'}),'703907');
 for(const e of entries){const id=findKoId(entries,{desc:(e.ko+' '+e.opstina).toUpperCase()});assert.equal(id,e.id,e.ko+' / '+e.opstina);}
});

test('eKatastar KoID: unique matches only, namesakes resolved by municipality, never guessed',()=>{
 const entries=parseKoTable('# c\nlajkovac|pepeljevac|700001\nstari grad|stari grad|700002\npalilula beograd|palilula|700003\npalilula nis|palilula|700004\naleksandrovac|velika|700005\nkrusevac|velika vrbnica gornja|700006\nx|dupla|700007\ny|dupla|700008\nbad|row|12\n');
 assert.equal(entries.length,8);
 assert.equal(findKoId(entries,{desc:'PEPELJEVAC LAJKOVAC ПЕПЕЉЕВАЦ ЛАЈКОВАЦ'}),'700001');
 assert.equal(findKoId(entries,{desc:'PEPELJEVAC LAJKOVAC ПЕПЕЉЕВАЦ ЛАЈКОВАЦ',ko:'Pepeljevac',municipality:'Lajkovac'}),'700001');
 assert.equal(findKoId(entries,{desc:'STARI GRAD STARI GRAD СТАРИ ГРАД СТАРИ ГРАД'}),'700002');
 assert.equal(findKoId(entries,{desc:'PALILULA NIŠ'}),'700004');
 assert.equal(findKoId(entries,{desc:'PALILULA BEOGRAD'}),'700003');
 assert.equal(findKoId(entries,{desc:'VELIKA VRBNICA GORNJA KRUŠEVAC'}),'700006');
 assert.equal(findKoId(entries,{desc:'DUPLA'}),null,'same KO name in two municipalities without a municipality is ambiguous');
 assert.equal(findKoId(entries,{desc:'NEPOZNATO MESTO'}),null);
 assert.equal(ekatastarUrl('704083'),'https://katastar.rgz.gov.rs/eKatastarPublic/FindParcela.aspx?KoID=704083');
});

test('opening a parcel points the eKatastar link at the preselected cadastral municipality',async()=>{
 const app=await appHarness();
 const remote=JSON.parse(fs.readFileSync('tests/fixtures/parcel.json','utf8'));
 app.scope.remote=remote;app.run('show(remote)');
 assert.equal(app.element('ekatastar').href,EKATASTAR_HOME,'generic page until the table is loaded');
 await until(()=>app.element('ekatastar').href===ekatastarUrl('700001'));
 assert.match(app.element('ekatastarHint').textContent,/već izabrane/);
 app.element('ekatastar').onclick();assert.match(app.element('message').textContent,/1227\/2 je kopiran.*Broj parcele/);
 app.scope.other={...remote,record:{...remote.record,uid:'x',desc:'NEPOZNATO MESTO'}};app.run('show(other)');for(let i=0;i<10;i++)await flush();
 assert.equal(app.element('ekatastar').href,EKATASTAR_HOME,'unknown KO falls back to the generic page');
});

test('selecting a parcel on the map offers a visible way to its details',async()=>{
 const app=await appHarness(async()=>({records:[squareRecord('A',457300,4962800)],total:1}));await app.emit(9);
 assert.equal(app.element('details').hidden,true);
 let scrolled=null;app.element('parcelCard').scrollIntoView=options=>scrolled=options;
 tapAt(app,457315,4962815);assert.equal(app.run('current.record.title'),'A');
 assert.equal(app.element('details').hidden,false);
 assert.equal(scrolled?.block,'nearest','wide screens scroll the side panel to the card');
 scrolled=null;app.element('details').onclick();assert.equal(scrolled.block,'start');
 app.element('clearSelection').onclick();assert.equal(app.element('details').hidden,true);
});


test('mobile navigation opens search and saved panels and preserves map dimensions while hidden',async()=>{
 const app=await appHarness();app.scope.innerWidth=390;
 await app.emit(8);
 const view=app.run('JSON.stringify(view)'),size=app.run('JSON.stringify([width,height])');
 app.element('navSearch').onclick();
 assert.equal(app.element('app').dataset.view,'search');
 assert.equal(app.element('navSearch')['aria-current'],'page');
 app.element('map').getBoundingClientRect=()=>({width:0,height:0,left:0,top:0});app.resize();
 assert.equal(app.run('JSON.stringify([width,height])'),size);
 app.element('navSaved').onclick();assert.equal(app.element('app').dataset.view,'saved');
 app.element('navMap').onclick();assert.equal(app.element('app').dataset.view,'map');
 assert.equal(app.run('JSON.stringify(view)'),view);
 app.run('show(nearby[0],false)');app.element('details').onclick();
 assert.equal(app.element('app').dataset.view,'details');
 app.element('backToMap').onclick();assert.equal(app.element('app').dataset.view,'map');
 app.element('navSearch').onclick();app.scope.liveSearch=async()=>[fixture.record];
 await app.run("searchParcel('1','Stari Grad','Beograd')");
 assert.equal(app.element('app').dataset.view,'map','a search result returns directly to the map');
});

test('selected parcel has an automatic summary, direct navigation and compact GPS toggle',async()=>{
 const app=await appHarness(async()=>({records:[squareRecord('A',457300,4962800)],total:1}));await app.emit(9);
 assert.equal(app.element('mapParcelCard').hidden,true);
 assert.equal(app.element('gps')['aria-pressed'],'true');
 assert.equal(app.element('gps')['aria-label'],'Isključi GPS');
 tapAt(app,457315,4962815);
 assert.equal(app.element('mapParcelCard').hidden,false);
 assert.equal(app.element('mapParcelTitle').textContent,'Parcela A');
 assert.match(app.element('mapParcelPlace').textContent,/ha/);
 let opened=0;app.element('routeDialog').showModal=()=>opened++;
 app.element('mapRoute').onclick();assert.equal(opened,1);
 await app.element('mapSave').onclick();
 assert.match(app.element('mapActionStatus').textContent,/Čuvanje nije uspelo/);
 assert.equal(app.element('mapSave').disabled,false);
 app.element('clearSelection').onclick();
 assert.equal(app.element('mapParcelCard').hidden,true);
 app.element('mapRoute').onclick();assert.equal(opened,1);
 app.element('gps').onclick();assert.equal(app.element('gps')['aria-pressed'],'false');
});

test('sharing links to a point inside the parcel; opening the link selects that parcel without GPS',async()=>{
 const records=[squareRecord('A',433000,4909700),squareRecord('B',433040,4909700)];
 const app=await appHarness(async()=>({records,total:2}));
 app.scope.target={...fixture,record:records[1]};app.run('show(target)');await flush();
 let shared;app.scope.navigator.share=async data=>{shared=data;};
 await app.element('mapShare').onclick();
 const url=new URL(shared.url),point=[Number(url.searchParams.get('lon')),Number(url.searchParams.get('lat'))];
 assert.equal(shared.title,'Parcela B');assert.equal(url.origin+url.pathname,'https://test.local/teren.html');assert.equal(url.searchParams.get('p'),'B');
 assert(field.boundary(point,geo.parcelGeometry(records[1]).polygons).inside,'the shared point lies inside the parcel');
 delete app.scope.navigator.share;let copied;app.scope.navigator.clipboard={writeText:async text=>{copied=text;}};
 await app.element('share').onclick();assert.equal(copied,shared.url);assert.match(app.element('message').textContent,/kopiran/);
 const calls=[];
 const opened=await appHarness(async(...args)=>{calls.push(args);return {records,total:2};},new Map(),url.search);
 await until(()=>opened.run('current?.record.title')==='B');
 const [east,north]=geo.wgs84ToUtm34(...point);
 assert(Math.abs(calls[0][0]-east)<1&&Math.abs(calls[0][1]-north)<1);assert.equal(calls[0][2],150);
 assert.equal(opened.run('nearbyMode'),false);assert.match(opened.element('message').textContent,/podeljena parcela B/);
 const count=calls.length;await opened.emit(8,geo.utm34ToWgs84(457315,4962815));
 assert.equal(calls.length,count,'a GPS fix does not replace the shared parcel');
});

test('parcel details show the perimeter and side lengths; navigation suggests the vertex nearest a road',async()=>{
 const app=await appHarness(async()=>({records:[],total:0}));
 let sides=[];app.element('sides').replaceChildren=(...items)=>sides=items;
 const record=squareRecord('A',433000,4909700);
 app.scope.target={...fixture,record};app.run('show(target)');
 assert.equal(app.element('perimeter').textContent,'120 m');
 assert.deepEqual(sides.map(li=>li.textContent),['T1–T2 · 30 m','T2–T3 · 30 m','T3–T4 · 30 m','T4–T1 · 30 m']);
 assert.match(app.element('mapParcelPlace').textContent,/obim 120 m/);
 assert.equal(app.run('selection'),'p:0');assert.match(app.element('destinationNote').textContent,/prva tačka/);
 const node=(e,n)=>{const [lon,lat]=geo.utm34ToWgs84(e,n);return {lon,lat};};
 app.scope.withRoad={...fixture,record,osm:{elements:[{tags:{highway:'track'},geometry:[node(432990,4909760),node(433010,4909760)]}],bbox:[44,20,45,21]}};
 app.run('show(withRoad)');
 assert.equal(app.run('selection'),'p:3','T4 lies next to the track');assert.match(app.element('destinationNote').textContent,/najbliža putu/);
 assert.match(app.element('wazeRoute').href,/^https:\/\/waze\.com\/ul\?ll=/);assert.equal(app.element('geoRoute').hidden,true,'iOS cannot open geo: links');
 app.scope.navigator.userAgent='Mozilla/5.0 (Linux; Android 14)';app.run('routes()');
 assert.equal(app.element('geoRoute').hidden,false);assert.match(app.element('geoRoute').href,/^geo:/);
 app.element('destination').value='p:1';app.element('destination').onchange();
 assert.equal(app.run('selection'),'p:1');app.run('fillDestinations()');assert.equal(app.run('selection'),'p:1','a picked point survives a refresh');
});

test('own names and colours are stored at once and survive a terrain save that was already running',async()=>{
 const a=squareRecord('A',433000,4909700),b=squareRecord('B',433040,4909700);
 const app=await appHarness(async()=>({records:[a,b],total:2}));fakeStorage(app);
 app.scope.target={...fixture,record:a};app.run('show(target)');await flush();
 const label=app.element('parcelLabel');label.value='  Njiva kod reke ';label.dispatch('change');await flush();await flush();
 assert.equal(app.run("storedPackages.get('A').label"),'Njiva kod reke','an unsaved parcel is stored together with its name');
 assert.equal(app.element('mapParcelTitle').textContent,'Njiva kod reke · A');
 await app.run('persistCurrent({color:PALETTE[1]})');assert.equal(app.run("storedPackages.get('A').color"),portfolio.PALETTE[1]);
 app.run('var releaseSurroundings;fetchSurroundings=()=>new Promise(r=>releaseSurroundings=r);var pendingSave=saveCurrent()');
 label.value='Vinograd';label.dispatch('change');await flush();await flush();
 app.run('releaseSurroundings({elements:[],bbox:[44,20,45,21]})');await app.run('pendingSave');
 assert.equal(app.run("storedPackages.get('A').label"),'Vinograd','a name typed during the download is not overwritten');
 assert.equal(app.run("storedPackages.get('A').color"),portfolio.PALETTE[1]);assert.equal(app.run('current.label'),'Vinograd');
 assert(app.run("storedPackages.get('A').osm"),'the terrain save itself still completes');
 label.value='';label.dispatch('change');await flush();await flush();
 assert.equal(app.run("storedPackages.get('A').label"),undefined,'a cleared name stays cleared');
});

test('all saved parcels show at once in their colours; tapping one opens it with its neighbours',async()=>{
 const a=squareRecord('A',433000,4909700),b=squareRecord('B',443000,4919700),calls=[];
 const app=await appHarness(async(...args)=>{calls.push(args);return {records:[],total:0};});
 fakeStorage(app,[{...fixture,id:'A',record:a,label:'Njiva',color:portfolio.PALETTE[1]},{...fixture,id:'B',record:b}]);
 app.element('showAllSaved').onclick();
 assert.equal(app.run('overview'),true);assert.equal(app.run('nearby.length'),0);
 assert.equal(app.element('mapMode').textContent,'Moje parcele');assert.equal(app.element('fit').textContent,'▦ Sve moje parcele');
 assert.match(app.element('coverage').textContent,/2 parcele · ukupno 0,18 ha/);
 assert(app.labels.includes('Njiva')&&app.labels.includes('B'),'own names label the overview');
 const before=calls.length;tapAt(app,433015,4909715);await flush();
 assert.equal(app.run('current.record.title'),'A');assert.equal(app.run('overview'),false);
 assert.equal(app.element('mapParcelTitle').textContent,'Njiva · A');
 assert(calls.length>before,'the opened parcel loads its neighbours');
});

test('a note and own points are stored with the parcel; an entrance becomes the suggested destination',async()=>{
 const a=squareRecord('A',433000,4909700);
 const app=await appHarness(async()=>({records:[a],total:1}));fakeStorage(app);
 app.scope.target={...fixture,record:a};app.run('show(target)');await flush();
 const note=app.element('parcelNote');note.value=' Međa uz potok ';note.dispatch('change');await flush();await flush();
 assert.equal(app.run("storedPackages.get('A').note"),'Međa uz potok');
 app.element('addMark').onclick();assert.equal(app.element('placing').hidden,false);
 const gate=geo.utm34ToWgs84(433030,4909715);app.run('view.origin='+JSON.stringify(gate)+';view.center=[0,0]');
 app.element('markType').value='ulaz';app.element('markHere').onclick();await flush();await flush();
 assert.equal(app.element('placing').hidden,true);
 const marks=()=>JSON.parse(app.run("JSON.stringify(storedPackages.get('A').marks||[])"));
 assert.deepEqual(marks().map(m=>m.type),['ulaz']);assert(Math.abs(marks()[0].lon-gate[0])<1e-9&&Math.abs(marks()[0].lat-gate[1])<1e-9,'the point lies under the crosshair');
 assert.match(app.run('selection'),/^m:/);assert.match(app.element('destinationNote').textContent,/Ulaz sa puta/);
 const here=geo.utm34ToWgs84(433010,4909720);await app.emit(8,here);
 app.element('markType').value='kamen';app.element('markGps').onclick();await flush();await flush();
 assert.deepEqual(marks().map(m=>m.type),['ulaz','kamen']);assert(Math.abs(marks()[1].lon-here[0])<1e-9,'a boundary stone at the phone position');
 await app.tick(31000);app.element('markGps').onclick();await flush();
 assert.equal(marks().length,2);assert.match(app.element('message').textContent,/Nema svežeg/);
 app.scope.imported={...fixture,record:a,marks:[{id:'x',type:'bogus',lon:1,lat:2},{id:'y',type:'bunar',lon:20.1,lat:44.3},{type:'bunar',lon:20,lat:44}]};
 assert.equal(app.run('validPackage(imported).marks.length'),1,'an imported backup keeps only well-formed points');
});

test('walking guidance: distance and arrow, compass, screen kept on, vibration at the boundary and on arrival',async()=>{
 const a=squareRecord('A',433000,4909700);
 const app=await appHarness(async()=>({records:[a],total:1}));
 const vibrations=[];let locks=0,released=0;
 app.scope.navigator.vibrate=p=>vibrations.push(p);
 app.scope.navigator.wakeLock={request:async()=>{locks++;return {release:async()=>{released++;},addEventListener(){}};}};
 app.scope.target={...fixture,record:a};app.run('show(target)');await flush();
 app.element('guideStart').onclick();await flush();
 assert.equal(app.element('guide').hidden,false);assert.equal(locks,1,'the screen stays on while guiding');
 const rotation=()=>Number(app.element('guideArrow').style.transform.match(/-?[\d.]+/)[0]),near=(x,y)=>Math.abs(((x-y+540)%360)-180)<2;
 await app.tick(1000);await app.emit(5,geo.utm34ToWgs84(433000,4909660));
 assert.equal(app.element('guideDistance').textContent,'40 m');assert.match(app.element('guideTarget').textContent,/^T1 · parcela A/);
 assert(near(rotation(),0),'T1 lies north; without a compass the arrow points north');
 app.compass({alpha:270,absolute:true});
 assert(near(rotation(),270),'facing east, the target is to the left');assert.equal(app.element('guideCompass').hidden,true);
 await app.tick(1000);await app.emit(5,geo.utm34ToWgs84(433015,4909715));
 assert.equal(JSON.stringify(vibrations),'[[120,80,120]]');assert.match(app.element('message').textContent,/Ušli ste u parcelu A/);
 await app.tick(1000);await app.emit(5,geo.utm34ToWgs84(433015,4909702));
 assert.equal(vibrations.length,1,'within the accuracy of the boundary nothing changes');
 await app.tick(1000);await app.emit(5,geo.utm34ToWgs84(433001,4909701));
 assert.equal(app.element('guideDistance').textContent,'Na tački ste');assert.equal(vibrations.at(-1),80);
 app.element('guideNext').onclick();assert.match(app.element('guideTarget').textContent,/^T2/);
 app.element('guideStop').onclick();await flush();
 assert.equal(app.element('guide').hidden,true);assert.equal(released,1);assert.equal(app.run('heading'),null);
});

test('search suggests municipalities and cadastral municipalities from the RGZ table',async()=>{
 const app=await appHarness(),lists={};
 for(const id of ['municipalityList','koList'])app.element(id).replaceChildren=(...options)=>lists[id]=options;
 const m=app.element('municipality'),ko=app.element('ko');m.value='';ko.value='';
 m.dispatch('focus');await until(()=>lists.koList?.length===2);
 assert.deepEqual(lists.municipalityList.map(o=>o.value),['Lajkovac','Stari Grad']);
 assert.deepEqual(lists.koList.map(o=>[o.value,o.label]),[['Pepeljevac','Lajkovac'],['Stari Grad','Stari Grad']]);
 m.value='lajkovac';m.dispatch('input');assert.deepEqual(lists.koList.map(o=>o.value),['Pepeljevac'],'a known municipality narrows the list');
 m.value='';ko.value='Stari Grad';ko.dispatch('change');assert.equal(m.value,'Stari Grad','a KO found in one municipality fills it in');
 const html=fs.readFileSync('public/teren.html','utf8');
 assert.match(html,/<input id="municipality"[^>]*list="municipalityList"/);assert.match(html,/<input id="ko"[^>]*list="koList"/);
});

// IndexedDB with both stores: requests succeed in order and a transaction completes after the last callback.
function fakeDb(app,parcels=[],photos=[]){
 app.scope.seed={parcels:structuredClone(parcels),photos};
 app.run(`var stores={parcels:new Map(seed.parcels.map(x=>[x.id,x])),photos:new Map(seed.photos.map(x=>[x.id,x]))};
 db={transaction(){
  const t={pending:0,objectStore(name){
   const m=stores[name],copy=name==='parcels'?structuredClone:x=>x;
   const request=value=>{const r={result:value};t.pending++;Promise.resolve().then(()=>{r.onsuccess?.();if(!--t.pending)Promise.resolve().then(()=>t.oncomplete?.());});return r;};
   return {get:id=>request(copy(m.get(id))),getKey:id=>request(m.has(id)?id:undefined),getAll:()=>request([...m.values()].map(x=>copy(x))),put:x=>{m.set(x.id,copy(x));return request(x.id);},index:()=>({getAll:id=>request([...m.values()].filter(x=>x.parcel===id))})};
  }};
  Promise.resolve().then(()=>{if(!t.pending)t.oncomplete?.();});return t;
 }};`);
}

test('all parcels and photos go into one file; importing it on another phone keeps what is already there',async()=>{
 const a=squareRecord('A',433000,4909700),b=squareRecord('B',443000,4919700);
 const photo={id:'p1',parcel:'A',blob:new Blob([Uint8Array.from([255,216,255,224,1,2])],{type:'image/jpeg'}),at:'2026-09-25T10:00:00.000Z',coords:[20.1,44.3],accuracy:6};
 const app=await appHarness(async()=>({records:[],total:0}));app.scope.setTimeout=(fn,ms)=>setTimeout(fn,ms).unref();
 fakeDb(app,[{...fixture,id:'A',record:a,label:'Njiva',marks:[{id:'m1',type:'ulaz',lon:20.1,lat:44.3}],osm:{elements:[{}],bbox:[44,20,45,21]}},{...fixture,id:'B',record:b}],[photo]);
 await app.run('refreshSaved()');assert.equal(app.element('exportAll').hidden,false);
 await app.element('exportAll').onclick();
 const anchor=app.created.find(e=>e.tag==='a'&&e.clicked);assert.match(anchor.download,/^moje-parcele-\d{4}-\d{2}-\d{2}\.json$/);
 const text=await app.blobs.at(-1).text(),data=JSON.parse(text);
 assert.deepEqual(data.parcels.map(x=>x.id).sort(),['A','B']);assert.equal(data.photos.length,1);
 assert(!data.parcels.some(x=>x.osm||x.neighborhood||x.geometry),'downloaded surroundings stay out of the file');
 assert.match(app.element('backupStatus').textContent,/2 parcele i 1 fotografija/);

 const other=await appHarness(async()=>({records:[],total:0}));
 fakeDb(other,[{...fixture,id:'B',record:b,label:'Moja'}]);await other.run('refreshSaved()');
 const upload={size:text.length,text:async()=>text},stored=id=>JSON.parse(other.run(`JSON.stringify(stores.parcels.get('${id}'))`));
 await other.element('import').onchange({target:{files:[upload]}});
 assert.equal(stored('A').label,'Njiva');assert.deepEqual(stored('A').marks.map(m=>m.type),['ulaz']);assert.equal(stored('A').osm,undefined);
 assert.equal(stored('B').label,'Moja','a name on this phone is not overwritten');
 const copy=other.run("stores.photos.get('p1')");assert.equal(copy.parcel,'A');assert.deepEqual([...copy.coords],[20.1,44.3]);
 assert.deepEqual(new Uint8Array(await copy.blob.arrayBuffer()),new Uint8Array(await photo.blob.arrayBuffer()));
 assert.equal(other.run('saved.length'),2);
 assert.match(other.element('backupStatus').textContent,/Nove parcele: 1 · već na telefonu: 1 · nove fotografije: 1\..*zadržale su svoje podatke.*Sačuvaj za teren/);
 await other.element('import').onchange({target:{files:[upload]}});
 assert.match(other.element('backupStatus').textContent,/Nove parcele: 0 · već na telefonu: 2 · nove fotografije: 0/,'importing twice adds nothing');
 assert.equal(other.run('stores.photos.size'),1);
 await other.element('import').onchange({target:{files:[{size:5,text:async()=>'{nope'}]}});
 assert.equal(other.element('backupStatus').textContent,'Ovo nije rezervna kopija iz ove aplikacije.');
});
