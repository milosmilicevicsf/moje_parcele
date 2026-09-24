import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createNearbyLoader,nearbyFixState} from '../public/nearby-loader.js';
import {createLocationTracker} from '../public/location-tracker.js';
import {searchNearby} from '../public/geosrbija.js';
import * as geo from '../public/geo.js';
import * as field from '../public/field-geo.js';
import * as neighborhoods from '../public/parcel-neighborhood.js';
import {createTileLayer,tileZoom,tileAt,tileLon,tileLat,tilesFor,tileUrl,MAX_ZOOM} from '../public/satellite.js';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const fix=(coords=[20,44],accuracy=5,timestamp=0)=>({coords,accuracy,timestamp});
const fixture=JSON.parse(fs.readFileSync('tests/fixtures/belgrade-parcel.json','utf8'));

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

test('nearby search covers both observed cadastral layers and decodes the real Belgrade record',async t=>{
 const rural=JSON.parse(fs.readFileSync('tests/fixtures/parcel.json','utf8')).record;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  const layers=JSON.parse(options.body).request.layers.split(',');
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

async function appHarness(search=async()=>({records:[fixture.record],total:1}),stored=new Map()){
 const labels=[],elements=new Map(),tileRequests=[],images=[];let gpsCallback,gpsFailure,queries=0,strokes=0,reads=0,interval,time=Date.now();
 const context2d=new Proxy({strokeText:text=>labels.push(text),stroke:()=>strokes++,drawImage:(...args)=>images.push(args)},{get:(obj,key)=>obj[key]??(()=>{})});
 function element(id){if(!elements.has(id))elements.set(id,{textContent:'',style:{},hidden:false,append(){},replaceChildren(){},scrollIntoView(){},setPointerCapture(){},listeners:new Map(),addEventListener(type,fn){const handlers=this.listeners.get(type)||[];handlers.push(fn);this.listeners.set(type,handlers);},dispatch(type,event){for(const fn of this.listeners.get(type)||[])fn(event);},close(){this.open=false;},setAttribute(name,value){this[name]=value;},parentElement:{classList:{toggle(name,on){this[name]=on;}}},getBoundingClientRect:()=>({width:800,height:600,left:0,top:0}),getContext:()=>context2d});return elements.get(id);}
 const scope={...geo,...field,...neighborhoods,createLocationTracker:options=>createLocationTracker({...options,now:()=>time,setTimer:()=>1,clearTimer(){}}),nearbyFixState:(f,n=time)=>nearbyFixState(f,n),
  createNearbyLoader:options=>createNearbyLoader({...options,online:()=>scope.navigator.onLine,now:()=>time}),
  latinPlace:x=>x,searchNearby:async(...args)=>{queries++;return search(...args);},
  SURROUNDINGS_URL:'/api/surroundings',SATELLITE_TILES:'https://tiles.test/{z}/{y}/{x}',SATELLITE_ATTRIBUTION:'Test imagery',
  createTileLayer:options=>{const layer=createTileLayer({...options,load:(url,done)=>{tileRequests.push(url);queueMicrotask(()=>done(true));return {url};}});return layer;},
  localStorage:{getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value)},requestAnimationFrame:fn=>queueMicrotask(fn),
  document:{getElementById:element,querySelectorAll:()=>[],createElement:()=>({}),addEventListener(){}},navigator:{onLine:true,geolocation:{watchPosition(fn,error){gpsCallback=fn;gpsFailure=error;return 1;},getCurrentPosition(){reads++;},clearWatch(){}}},
  indexedDB:{open(){const request={};queueMicrotask(()=>request.onerror());return request;}},
  ResizeObserver:class{constructor(fn){this.fn=fn;}observe(){queueMicrotask(this.fn);}},structuredClone,innerWidth:800,devicePixelRatio:1,addEventListener(){},setInterval(fn){interval=fn;},console,Date:class extends Date{static now(){return time;}},Map,Math,setTimeout,clearTimeout};
 vm.createContext(scope);
 const source=fs.readFileSync('public/teren.js','utf8').replace(/^import .*;\n/gm,'').replace('await boot();','boot();').split('if(document.modelContext?.registerTool)')[0];
 vm.runInContext(source,scope);await flush();assert.equal(typeof gpsCallback,'function');
 return {element,labels,tileRequests,images,stored,get reads(){return reads;},get queries(){return queries;},get strokes(){return strokes;},
  async emit(accuracy,coords=[20.4604,44.8178]){gpsCallback({coords:{latitude:coords[1],longitude:coords[0],accuracy},timestamp:time});await flush();},
  async tick(ms){time+=ms;interval();await flush();},
  async fail(code){gpsFailure({code});await flush();},
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
 app.element('nearby').onclick();await flush();assert.equal(app.queries,0,'button cannot bypass accuracy validation');
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
  assert.equal(app.element('nearby').disabled,false);
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
 assert(app.labels.includes(record.title));assert(app.labels.includes(fixture.record.title));
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
 assert.equal(app.element('nearby').disabled,false);
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
 assert.equal(app.run('current.record.title'),'1227/2');assert(app.labels.includes('remote-neighbor'));
 const view=app.run('JSON.stringify(view)');app.element('clearSelection').onclick();
 await app.emit(8,[20.46,44.82]);assert.equal(calls.length,1);
 assert.equal(app.run('JSON.stringify(view)'),view,'GPS must not move a remote overview back to the phone');
 tapAt(app,433065,4909715);assert.equal(app.run('current.record.title'),'remote-neighbor');
});

test('switching remote parcels or returning to GPS ignores late parcel-centered responses',async()=>{
 const pending=[],app=await appHarness((...args)=>new Promise(resolve=>pending.push({args,resolve})));
 app.scope.a={...fixture,record:squareRecord('A',433000,4909700)};
 app.scope.b={...fixture,record:squareRecord('B',443000,4919700)};
 app.run('show(a);show(b)');assert.equal(pending.length,2);
 pending[1].resolve({records:[app.scope.b.record,squareRecord('B-neighbor',443040,4919700)],total:2});await flush();
 pending[0].resolve({records:[app.scope.a.record],total:1});await flush();
 assert.equal(app.run('current.record.title'),'B');assert.equal(app.run('nearby[1].record.title'),'B-neighbor');
 app.run('show(a)');assert.equal(pending.length,3);app.element('nearby').onclick();
 pending[2].resolve({records:[app.scope.a.record],total:1});await flush();
 assert.equal(app.run('current'),null);assert.equal(app.run('nearby.length'),0);
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
