import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {boundary,bearing,distance,unlocal} from '../public/field-geo.js';import {parcelGeometry,utm34ToWgs84,wgs84ToUtm34} from '../public/geo.js';import {nearbyRequest,textRequest,latinPlace,placeNames} from '../public/geosrbija.js';import {parseCenter,bbox,overpassQuery,packageFrom,upstreams,DEFAULT_UPSTREAMS,RequestError} from '../lib/surroundings.js';
const origin=[20,44], ring=p=>p.map(x=>unlocal(x,origin));const square=ring([[0,0],[100,0],[100,100],[0,100]]),hole=ring([[40,40],[60,40],[60,60],[40,60]]);
test('distance uses nearest segment; holes are outside and separate polygons work',()=>{const center=unlocal([50,50],origin),a=boundary(center,[[square]]);assert(a.inside);assert(Math.abs(a.distance-50)<.01);const h=boundary(center,[[square,hole]]);assert(!h.inside);assert(Math.abs(h.distance-10)<.01);const out=boundary(unlocal([150,30],origin),[[square]]);assert(!out.inside);assert(Math.abs(out.distance-50)<.01);assert(boundary(unlocal([250,50],origin),[[square],[ring([[200,0],[300,0],[300,100],[200,100]])]]).inside);});
test('bearings and long-range distance',()=>{assert(Math.abs(bearing([20,44],[20,45]))<.01);assert(Math.abs(bearing([20,44],[21,44])-90)<1);assert(Math.abs(distance([20,44],[20,45])-111195)<2);});
test('fixture parcel has exact eight vertices and plausible area',()=>{const s=JSON.parse(fs.readFileSync('tests/fixtures/parcel.json')),g=parcelGeometry(s.record);assert.equal(g.points.length,8);assert(g.area>1000&&g.area<4000);assert(Math.abs(g.points[0].lat-44.3374173087)<1e-8);});
test('app starts without any built-in parcel',()=>{const html=fs.readFileSync('public/teren.html','utf8');for(const id of ['number','municipality','ko'])assert.doesNotMatch(html,new RegExp(`<input id="${id}"[^>]*\\svalue=`),id+' must not be prefilled');assert.match(html,/<section id="parcelCard"[^>]*\shidden/);assert(!fs.existsSync('public/sample.json'));assert.doesNotMatch(fs.readFileSync('public/sw.js','utf8'),/sample\.json/);assert.doesNotMatch(fs.readFileSync('public/teren.js','utf8'),/sample\.json/);});
test('forward UTM matches the inverse and the point a3 sends for the fixture parcel',()=>{
 for(const [e,n] of [[433000.4513,4909693.590501],[300000,4600000],[700000,5200000]]){const [e2,n2]=wgs84ToUtm34(...utm34ToWgs84(e,n));assert(Math.hypot(e2-e,n2-n)<.001,e+','+n);}
 // Captured click at UTM (432954.08, 4909699.68) is 46 m west of the fixture's first vertex.
 const [e,n]=wgs84ToUtm34(20.1595475,44.3374173);assert(Math.abs(e-433000.45)<.05&&Math.abs(n-4909693.59)<.05);
});
test('nearby search mirrors the a3 map click request and reads place names from desc',()=>{
 const r=nearbyRequest(432954.0831709,4909699.6789006,150);assert.deepEqual(r,{srsid:'32634',st:'circle',s:'432954.08,4909699.68,150',start:0,limit:100,layers:'586,587,588,589,899,939,'});
 for(const bad of [[NaN,1,10],[1,1,0],[1,1,5000]])assert.throws(()=>nearbyRequest(...bad));
 assert.equal(textRequest('1227/2','Pepeljevac').q,'1227/2 pepeljevac');
 assert.equal(latinPlace('PEPELJEVAC LAJKOVAC ПЕПЕЉЕВАЦ ЛАЈКОВАЦ'),'Pepeljevac Lajkovac');assert.equal(latinPlace(undefined),'');
 // Descriptions observed live on 2026-09-25: roman numerals appear in both halves, Vojvodina lists Cyrillic first.
 assert.equal(latinPlace('GROŠNICA I KRAGUJEVAC ГРОШНИЦА I КРАГУЈЕВАЦ'),'Grošnica I Kragujevac');
 assert.equal(latinPlace('ЗРЕЊАНИН I ZRENJANIN I ЗРЕЊАНИН ZRENJANIN'),'Zrenjanin I Zrenjanin');
 assert.equal(latinPlace('PALILULA PALILULA (BEOGRAD) ПАЛИЛУЛА ПАЛИЛУЛА (БЕОГРАД)'),'Palilula Palilula (Beograd)');
 assert.deepEqual(placeNames('GROŠNICA I KRAGUJEVAC ГРОШНИЦА I КРАГУЈЕВАЦ','grosnica i','kragujevac'),{ko:'Grošnica I',municipality:'Kragujevac'});
 assert.deepEqual(placeNames('PALILULA PALILULA (BEOGRAD) ПАЛИЛУЛА ПАЛИЛУЛА (БЕОГРАД)','Palilula','Palilula Beograd'),{ko:'Palilula',municipality:'Palilula (Beograd)'});
 assert.deepEqual(placeNames('GROŠNICA I KRAGUJEVAC ГРОШНИЦА I КРАГУЈЕВАЦ','Grosnica','Kragujevac'),{ko:'Grosnica',municipality:'Kragujevac'},'a KO typed without its numeral keeps the typed names');
 const html=fs.readFileSync('public/teren.html','utf8');assert.match(html,/<button id="locate"/);assert.doesNotMatch(html,/id="nearby"/);
});
test('surroundings service validates the center, builds a bounded query and a complete package',()=>{
 const center=parseCenter(new URLSearchParams('lat=44.33741&lon=20.15887'));assert.deepEqual(center,[44.337,20.159]);
 const box=bbox(center);assert.equal(box.length,4);assert(box[0]<center[0]&&box[2]>center[0]&&box[1]<center[1]&&box[3]>center[1]);assert(Math.abs((box[2]-box[0])-.018)<1e-6);assert((box[3]-box[1])>.018);
 const query=overpassQuery(center),small=bbox(center,.0045);assert.match(query,/^\[out:json\]\[timeout:25\];/);assert(query.includes('way[highway]('+box.join(',')+')'));assert(query.includes('way[building]('+small.join(',')+')'),'buildings limited to the inner box');assert(small[0]>box[0]&&small[2]<box[2]&&small[1]>box[1]&&small[3]<box[3]);assert.match(query,/out geom;$/);
 for(const bad of ['','lat=x&lon=20','lat=44.3']){assert.throws(()=>parseCenter(new URLSearchParams(bad)),e=>e instanceof RequestError&&e.status===400&&/Nedostaju/.test(e.message),bad);}
 for(const bad of ['lat=48.9&lon=20.1','lat=44.3&lon=30']){assert.throws(()=>parseCenter(new URLSearchParams(bad)),e=>e.status===400&&/van područja/.test(e.message),bad);}
 assert.deepEqual(upstreams(undefined),DEFAULT_UPSTREAMS);assert.deepEqual(upstreams(' https://a/x , https://b/y,'),['https://a/x','https://b/y']);
 const pkg=packageFrom({elements:[{type:'way',id:1}]},box);assert.deepEqual(pkg.elements,[{type:'way',id:1}]);assert.deepEqual(pkg.bbox,box);assert(!Number.isNaN(Date.parse(pkg.downloadedAt)));assert.match(pkg.source,/OpenStreetMap/);
 assert.throws(()=>packageFrom({remark:'runtime error',elements:[]},box),e=>e.status===502);assert.throws(()=>packageFrom({},box),e=>e.status===502);
 assert.doesNotMatch(fs.readFileSync('public/teren.js','utf8'),/overpass-api\.de/,'browser must not call Overpass directly');
});
test('offline worker serves shell without any network and excludes API',async()=>{const handlers={},files=new Map();let networkCalls=0;const cache={addAll:async ps=>ps.forEach(p=>files.set(p,new Response(p))),match:async p=>files.get(p)?.clone()};vm.runInNewContext(fs.readFileSync('public/sw.js','utf8'),{URL,Response,caches:{open:async()=>cache,keys:async()=>[],delete:async()=>true},fetch:()=>{networkCalls++;throw Error('offline');},self:{location:{origin:'https://test.local'},addEventListener:(n,f)=>handlers[n]=f,skipWaiting:async()=>{},clients:{claim:async()=>{}}}});let promise;handlers.install({waitUntil:p=>promise=p});await promise;for(const p of files.keys())assert(fs.existsSync('public'+p),p);handlers.fetch({request:{url:'https://test.local/',method:'GET',mode:'navigate'},respondWith:p=>promise=p});assert.equal(await(await promise).text(),'/teren.html');handlers.fetch({request:{url:'https://test.local/teren.js',method:'GET'},respondWith:p=>promise=p});assert.equal(await(await promise).text(),'/teren.js');let intercepted=false;handlers.fetch({request:{url:'https://test.local/api/parcel',method:'GET'},respondWith:()=>intercepted=true});assert(!intercepted);assert.equal(networkCalls,0);});
test('every element id in the app page is unique',()=>{
 const ids=[...fs.readFileSync('public/teren.html','utf8').matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]);
 assert(ids.length>100);assert.deepEqual(ids.filter((id,i)=>ids.indexOf(id)!==i),[]);
});
test('the offline shell holds every module the app imports, directly or through another module',()=>{
 const shell=JSON.parse(fs.readFileSync('public/sw.js','utf8').match(/const SHELL=(\[[^\]]*\])/)[1].replaceAll("'",'"')),seen=new Set();
 const visit=file=>{if(seen.has(file))return;seen.add(file);for(const [,dep] of fs.readFileSync('public'+file,'utf8').matchAll(/^import .* from '\.(\/[^']+)';$/gm))visit(dep);};
 visit('/teren.js');assert(seen.size>15);
 for(const file of seen)assert(shell.includes(file),file+' is missing from the offline shell');
});
test('cached redirected HTML is safe for repeated manual-redirect navigations',async()=>{
 const {createServer}=await import('node:http');
 const server=createServer((req,res)=>{if(req.url==='/teren.html'){res.writeHead(302,{location:'/teren'});res.end();}else{res.writeHead(200,{'Content-Type':'text/html','X-Test':'preserved'});res.end('<html>Parcel map</html>');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const response=await fetch(`http://127.0.0.1:${server.address().port}/teren.html`);
  assert.equal(response.redirected,true);
  const handlers={};
  vm.runInNewContext(fs.readFileSync('public/sw.js','utf8'),{URL,Response,caches:{open:async()=>({match:async()=>response.clone()})},fetch:()=>{throw Error('Network must not be used');},self:{location:{origin:'https://test.local'},addEventListener:(n,f)=>handlers[n]=f}});
  for(const path of ['/teren','/teren.html','/']){
   let result;handlers.fetch({request:{url:'https://test.local'+path,method:'GET',mode:'navigate',redirect:'manual'},respondWith:p=>result=p});
   const served=await result;assert.equal(served.redirected,false);assert.equal(served.status,200);assert.equal(served.headers.get('Content-Type'),'text/html');assert.equal(served.headers.get('X-Test'),'preserved');assert.equal(await served.text(),'<html>Parcel map</html>');
  }
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
