import test from 'node:test';
import assert from 'node:assert/strict';
import {CELL,CELL_RADIUS,MAX_CELLS,REFRESH_MS,RETRY_MS,cellsFor,cellCenter,createAreaLoader} from '../public/area-loader.js';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
const settle=async()=>{for(let i=0;i<30;i++)await flush();};
const box=[433000,4909600,433700,4910300];

// Debounce, clock and network are injected; show() lets the map rest and runs the pending load.
function loader({search,store=null,online=true}={}){
  let task=null,time=Date.parse('2026-09-29T10:00:00Z');
  const calls=[];
  const h={calls,online,
    loader:createAreaLoader({
      search:search||(async(e,n,r)=>{calls.push([e,n,r]);return {records:[{uid:e+','+n}],total:1};}),
      store,online:()=>h.online,now:()=>time,schedule:fn=>{task=fn;return 1;},cancel:()=>{task=null;}
    }),
    async show(next){h.loader.view(next);const fn=task;task=null;fn?.();await settle();},
    advance(ms){time+=ms;},
    get pending(){return task!==null;}
  };
  return h;
}

test('cells cover the view nearest first, each query circle encloses its cell, and a wide view asks to zoom in',()=>{
  const keys=cellsFor(box),inCell=([e,n])=>keys.some(k=>{const [x,y]=cellCenter(k);return Math.abs(e-x)<=CELL/2&&Math.abs(n-y)<=CELL/2;});
  for(const corner of [[box[0],box[1]],[box[2],box[3]],[box[0],box[3]],[433350,4909950]])assert(inCell(corner),corner.join(','));
  const mid=[(box[0]+box[2])/2,(box[1]+box[3])/2],away=k=>{const c=cellCenter(k);return Math.hypot(c[0]-mid[0],c[1]-mid[1]);};
  assert.deepEqual(keys.map(away),keys.map(away).sort((a,b)=>a-b));
  assert(CELL_RADIUS>=Math.hypot(CELL/2,CELL/2),'the circle reaches the cell corners');
  assert.equal(cellsFor([0,0,CELL*6-1,CELL*6-1]).length,MAX_CELLS);
  assert.equal(cellsFor([433000,4909600,443000,4919600]),null,'a 10 km view does not request 1,600 cells');
});

test('only a resting map loads; each cell is fetched once, a few at a time, and panning back needs no request',async()=>{
  const release=[],calls=[];
  const h=loader({search:(e,n,r)=>{calls.push([e,n,r]);return new Promise(resolve=>release.push(()=>resolve({records:[{uid:e+','+n}],total:1})));}});
  h.loader.view([0,0,1,1]);h.loader.view(box);assert(h.pending);
  await h.show(box);
  const keys=cellsFor(box);
  assert.equal(calls.length,3,'three requests at a time');assert(calls.every(c=>c[2]===CELL_RADIUS));
  assert.equal(h.loader.status().loading,keys.length);
  while(release.length){release.shift()();await settle();}
  assert.equal(calls.length,keys.length,'the earlier view never loaded');
  assert.deepEqual(new Set(calls.map(c=>c.join())).size,keys.length);
  assert.deepEqual(h.loader.status(),{wide:false,cells:keys.length,loading:0,failed:0,missing:0,ready:keys.length});
  assert.equal(h.loader.parcels().length,keys.length);
  await h.show(box);assert.equal(calls.length,keys.length,'the same view again costs nothing');
  await h.show([box[0]+CELL,box[1],box[2]+CELL,box[3]]);
  const column=cellsFor([box[0]+CELL,box[1],box[2]+CELL,box[3]]).filter(k=>!keys.includes(k));
  while(release.length){release.shift()();await settle();}
  assert.equal(calls.length,keys.length+column.length,'one cell further east loads only the new column');
  await h.show(box);assert.equal(calls.length,keys.length+column.length,'panning back needs no request');
  await h.show([400000,4900000,420000,4920000]);
  assert.equal(h.loader.status().wide,true);assert.equal(calls.length,keys.length+column.length,'zoomed out, nothing is requested');
  await h.show(null);assert.deepEqual(h.loader.status(),{wide:false,cells:0,loading:0,failed:0,missing:0,ready:0});
});

test('a failed cell is reported, retried after a pause or at once on request, and a failed refresh keeps the older copy',async()=>{
  let fail=true;const calls=[];
  const h=loader({search:async(e,n)=>{calls.push([e,n]);if(fail)throw Error('HTTP 503');return {records:[{uid:e+','+n}],total:1};}});
  const small=[433010,4909610,433020,4909620];
  await h.show(small);
  assert.equal(h.loader.status().failed,1);assert.equal(h.loader.status().error.message,'HTTP 503');
  await h.show(small);assert.equal(calls.length,1,'no hammering right after a failure');
  h.advance(RETRY_MS);await h.show(small);assert.equal(calls.length,2);
  fail=false;h.loader.retry();await settle();
  assert.equal(calls.length,3);assert.equal(h.loader.status().ready,1);
});

test('the device copy shows a cell offline and while GeoSrbija is down; an old copy is refreshed in the background',async()=>{
  const stored=new Map(),store={get:async key=>structuredClone(stored.get(key)),put:async entry=>{stored.set(entry.key,structuredClone(entry));}};
  const first=loader({store});
  await first.show(box);
  const keys=cellsFor(box);assert.equal(stored.size,keys.length);assert.equal(first.calls.length,keys.length);

  const offline=loader({store,online:false});
  await offline.show(box);
  assert.equal(offline.calls.length,0);assert.equal(offline.loader.status().ready,keys.length);
  assert.equal(offline.loader.parcels().length,keys.length);
  await offline.show([box[0]+10*CELL,box[1],box[0]+10*CELL+10,box[1]+10]);
  assert.equal(offline.loader.status().missing,1,'an area never loaded is reported, not shown as empty');
  offline.online=true;await offline.show([box[0]+10*CELL,box[1],box[0]+10*CELL+10,box[1]+10]);
  assert.equal(offline.calls.length,1,'it loads once the network is back');

  const key=keys[0];stored.set(key,{...stored.get(key),downloadedAt:new Date(Date.parse('2026-09-29T10:00:00Z')-REFRESH_MS-1).toISOString(),records:[{uid:'old'}]});
  let release;const seen=[];
  const later=loader({store,search:()=>new Promise(resolve=>release=resolve)});
  const cell=cellCenter(key);
  await later.show([cell[0]-1,cell[1]-1,cell[0]+1,cell[1]+1]);
  for(const c of later.loader.parcels())seen.push(...c.records.map(r=>r.uid));
  assert.deepEqual(seen,['old'],'the old copy is on screen while it refreshes');
  release({records:[{uid:'new'}],total:1});await settle();
  assert.deepEqual(later.loader.parcels()[0].records.map(r=>r.uid),['new']);
  assert.deepEqual(stored.get(key).records.map(r=>r.uid),['new']);

  stored.set(key,{...stored.get(key),downloadedAt:'2020-01-01T00:00:00.000Z'});
  const down=loader({store,search:async()=>{throw Error('HTTP 503');}});
  await down.show([cell[0]-1,cell[1]-1,cell[0]+1,cell[1]+1]);
  assert.deepEqual(down.loader.status(),{wide:false,cells:1,loading:0,failed:0,missing:0,ready:1},'GeoSrbija down: the older copy stays');
});

test('memory holds a bounded number of cells however far the map travels',async()=>{
  const h=loader();
  for(let step=0;step<12;step++)await h.show([step*6*CELL,0,step*6*CELL+6*CELL-1,6*CELL-1]);
  assert.equal(h.calls.length,12*MAX_CELLS);
  assert(h.loader.size<=150+MAX_CELLS,'kept '+h.loader.size);
  assert.equal(h.loader.status().ready,MAX_CELLS,'the cells in view are always kept');
});
