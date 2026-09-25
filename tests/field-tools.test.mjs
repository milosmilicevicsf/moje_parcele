import test from 'node:test';
import assert from 'node:assert/strict';
import {parcelGeometry,utm34ToWgs84} from '../public/geo.js';
import {ringSides,perimeter,roadVertex} from '../public/parcel-measure.js';
import {navigationLinks} from '../public/navigation.js';
import {PALETTE,colorOf,nameOf,totalArea,hectares,parcelCount,groupByPlace} from '../public/portfolio.js';

const ring=(east,north,size)=>[[east,north],[east+size,north],[east+size,north+size],[east,north+size],[east,north]];
const wkt=rings=>'POLYGON ('+rings.map(r=>'('+r.map(p=>p.join(' ')).join(',')+')').join(',')+')';
const node=(east,north)=>{const [lon,lat]=utm34ToWgs84(east,north);return {lon,lat};};
const squareGeometry=(size=30)=>parcelGeometry({title:'A',fullGeom:wkt([ring(433000,4909700,size)])});

test('side lengths and perimeter come from projected metres and include inner boundaries',()=>{
 const sides=ringSides(squareGeometry());
 assert.deepEqual(sides.map(s=>s.from+'-'+s.to),['T1-T2','T2-T3','T3-T4','T4-T1']);
 assert(sides.every(s=>Math.abs(s.length-30)<1e-9&&!s.hole));
 assert.equal(perimeter(squareGeometry()),120);
 const holed=parcelGeometry({title:'B',fullGeom:wkt([ring(433000,4909700,100),ring(433040,4909740,20)])});
 assert.equal(ringSides(holed).filter(s=>s.hole).length,4);
 assert.equal(perimeter(holed),480,'an enclave adds its own boundary to the fence length');
});

test('the suggested destination is the vertex nearest to a drivable road or track',()=>{
 const geometry=squareGeometry();
 const track={tags:{highway:'track'},geometry:[node(432990,4909760),node(433010,4909760)]};
 const footway={tags:{highway:'footway'},geometry:[node(433025,4909733),node(433035,4909733)]};
 const best=roadVertex(geometry,[footway,track]);
 assert.equal(geometry.points[best.index].name,'T4','footpaths are no access, the track by the north-west corner is');
 assert(Math.abs(best.distance-30)<0.5);
 assert.equal(roadVertex(geometry,[track],20),null,'roads beyond the limit are ignored');
 assert.equal(roadVertex(geometry,undefined),null);
 const far={tags:{highway:'primary'},geometry:[node(440000,4909700),node(440100,4909700)]};
 assert.equal(roadVertex(geometry,[far]),null);
});

test('saved parcels: total area, own names and colours, place groups and Serbian plurals',()=>{
 const pkg=(title,ko,municipality,extra={})=>({record:{title,fullGeom:wkt([ring(433000,4909700,10)])},ko,municipality,...extra});
 const items=[pkg('12','Pepeljevac','Lajkovac'),pkg('3','Pepeljevac Lajkovac',''),pkg('7','Grošnica I','Kragujevac',{label:'Voćnjak',color:PALETTE[1]})];
 assert.equal(hectares(totalArea(items)),'0,03 ha');
 assert.equal(nameOf(items[2]),'Voćnjak · 7');assert.equal(nameOf(items[0]),'Parcela 12');
 assert.equal(colorOf(items[2]),PALETTE[1]);assert.equal(colorOf({color:'red'}),PALETTE[0],'unknown colours fall back to the first');
 assert.deepEqual(groupByPlace(items).map(g=>[g.place,g.items.map(x=>x.record.title)]),[['Grošnica I, Kragujevac',['7']],['Pepeljevac, Lajkovac',['3','12']]],
  'a searched parcel and one picked on the map share their place; numbers sort naturally');
 assert.deepEqual([1,2,5,11,12,21,22,25].map(parcelCount),['1 parcela','2 parcele','5 parcela','11 parcela','12 parcela','21 parcela','22 parcele','25 parcela']);
});

test('navigation links carry the destination and name it for other map apps',()=>{
 const links=navigationLinks([20.1595471,44.3374173],'Parcela 1227/2 · T1');
 assert.equal(links.google,'https://www.google.com/maps/dir/?api=1&destination=44.337417%2C20.159547&travelmode=driving');
 assert.equal(links.apple,'https://maps.apple.com/?daddr=44.337417%2C20.159547&dirflg=d');
 assert.equal(links.waze,'https://waze.com/ul?ll=44.337417%2C20.159547&navigate=yes');
 assert.equal(links.geo,'geo:44.337417,20.159547?q=44.337417,20.159547(Parcela%201227%2F2%20%C2%B7%20T1)');
});
