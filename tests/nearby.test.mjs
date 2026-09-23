import test from 'node:test';
import assert from 'node:assert/strict';
import {createNearbyLoader} from '../public/nearby-loader.js';
import {searchNearby} from '../public/geosrbija.js';

test('first fix loads automatically; jitter and concurrent GPS fixes do not flood requests',async()=>{
 let time=0,calls=[],release;
 const loader=createNearbyLoader({now:()=>time,online:()=>true,onError:assert.fail,load:async(c)=>{calls.push(c);await new Promise(r=>release=r);}});
 const first=loader.update([20,44]);assert.equal(calls.length,1);
 time=40000;await loader.update([20.002,44]);assert.equal(calls.length,1);
 release();await first;
 await loader.update([20.00001,44]);assert.equal(calls.length,1);
 const moved=loader.update([20.002,44]);assert.equal(calls.length,2);release();await moved;
});
test('offline does not query; failures retry, disabling invalidates pending results',async()=>{
 let online=false,time=0,calls=0,errors=0,active,release;
 const loader=createNearbyLoader({now:()=>time,online:()=>online,onError:()=>errors++,load:async(c,valid)=>{calls++;if(calls===1)throw Error('timeout');active=valid;await new Promise(r=>release=r);}});
 await loader.update([20,44]);assert.equal(calls,0);
 online=true;await loader.update([20,44]);assert.equal(errors,1);
 await loader.update([20,44]);assert.equal(calls,1);
 time=31000;const pending=loader.update([20,44]);assert.equal(calls,2);assert(active());
 loader.disable();assert(!active());loader.enable();assert(!active());release();await pending;
});
test('nearby service paginates and deduplicates actual geometry',async t=>{
 const starts=[];
 const record=i=>({uid:String(i),title:String(i),fullGeom:'POLYGON ((1 1,2 1,2 2,1 1))'});
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

test('app startup requests GPS and draws returned parcels without a button click',async()=>{
 const {default:vm}=await import('node:vm');const {default:fs}=await import('node:fs');
 const geo=await import('../public/geo.js'),field=await import('../public/field-geo.js');
 const labels=[],elements=new Map();let gpsCallback,queries=0,strokes=0;
 const context2d=new Proxy({strokeText:text=>labels.push(text),stroke:()=>strokes++},{get:(obj,key)=>obj[key]??(()=>{})});
 function element(id){if(!elements.has(id))elements.set(id,{textContent:'',style:{},hidden:false,append(){},replaceChildren(){},scrollIntoView(){},addEventListener(){},getBoundingClientRect:()=>({width:800,height:600,left:0,top:0}),getContext:()=>context2d});return elements.get(id);}
 const fixture=JSON.parse(fs.readFileSync('tests/fixtures/parcel.json','utf8'));
 const scope={...geo,...field,createNearbyLoader:options=>createNearbyLoader({...options,online:()=>true}),latinPlace:x=>x,searchNearby:async()=>{queries++;return{records:[fixture.record],total:1};},
  SURROUNDINGS_URL:'/api/surroundings',document:{getElementById:element,querySelectorAll:()=>[],createElement:()=>({})},navigator:{onLine:true,geolocation:{watchPosition(fn){gpsCallback=fn;return 1;},clearWatch(){}}},
  indexedDB:{open(){const request={};queueMicrotask(()=>request.onerror());return request;}},
  ResizeObserver:class{constructor(fn){this.fn=fn;}observe(){queueMicrotask(this.fn);}},innerWidth:800,devicePixelRatio:1,addEventListener(){},setInterval(){},console,Date,Map,Math,setTimeout,clearTimeout};
 vm.createContext(scope);
 const source=fs.readFileSync('public/teren.js','utf8').replace(/^import .*;\n/gm,'').replace('await boot();','boot();').split('if(document.modelContext?.registerTool)')[0];
 vm.runInContext(source,scope);await new Promise(r=>setImmediate(r));assert.equal(typeof gpsCallback,'function');
 gpsCallback({coords:{latitude:44.3374,longitude:20.159,accuracy:5},timestamp:Date.now()});
 await new Promise(r=>setImmediate(r));
 assert.equal(queries,1);assert(labels.includes('1227/2'));assert(strokes>0);assert.equal(element('emptyHint').hidden,true);assert.equal(element('mapMode').textContent,'Parcele u okolini');
 // Choosing a saved/manual parcel disables further automatic neighborhood searches.
 scope.fixture=fixture;vm.runInContext('show(fixture)',scope);
 gpsCallback({coords:{latitude:44.339,longitude:20.16,accuracy:5},timestamp:Date.now()});
 await new Promise(r=>setImmediate(r));assert.equal(queries,1);
});
