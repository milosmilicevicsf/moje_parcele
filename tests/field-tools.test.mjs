import test from 'node:test';
import assert from 'node:assert/strict';
import {parcelGeometry,utm34ToWgs84} from '../public/geo.js';
import {ringSides,perimeter,roadVertex} from '../public/parcel-measure.js';
import {navigationLinks} from '../public/navigation.js';
import {PALETTE,colorOf,nameOf,totalArea,hectares,parcelCount,photoCount,groupByPlace,groupByOwn} from '../public/portfolio.js';
import {BACKUP_KIND,backupBlob,readBackup,mergeParcel,toBase64,fromBase64} from '../public/backup.js';
import {guidance,createCrossing} from '../public/guide.js';
import {headingFrom,smoothHeading,createCompass} from '../public/compass.js';

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
 assert.deepEqual(groupByPlace(items).map(g=>[g.title,g.items.map(x=>x.record.title)]),[['Grošnica I, Kragujevac',['7']],['Pepeljevac, Lajkovac',['3','12']]],
  'a searched parcel and one picked on the map share their place; numbers sort naturally');
 const grouped=[pkg('1','K','M',{group:'Brat'}),pkg('2','K','M'),pkg('3','K','M',{group:'brat'}),pkg('4','K','M',{group:'Čika Ana'}),pkg('5','K','M',{group:'---'})];
 assert.deepEqual(groupByOwn(grouped).map(g=>[g.title,g.items.map(x=>x.record.title)]),[['---',['5']],['Brat',['1','3']],['Čika Ana',['4']],['Bez grupe',['2']]],
  'own groups alphabetically and parcels without a group last; case does not split a group, a name without letters is still a group');
 assert.deepEqual([1,2,5,11,12,21,22,25].map(parcelCount),['1 parcela','2 parcele','5 parcela','11 parcela','12 parcela','21 parcela','22 parcele','25 parcela']);
 assert.deepEqual([1,3,14,24].map(photoCount),['1 fotografija','3 fotografije','14 fotografija','24 fotografije']);
});

test('a backup carries own data and photos byte for byte, and leaves downloaded surroundings out',async()=>{
 const bytes=Uint8Array.from({length:70000},(_,i)=>(i*7919)%256),photo=new Blob([bytes],{type:'image/jpeg'});
 assert.deepEqual(new Uint8Array(await fromBase64(await toBase64(photo),'image/jpeg').arrayBuffer()),bytes,'longer than one 32 KB chunk');
 assert.equal(fromBase64(btoa('<svg/>'),'image/svg+xml').type,'image/jpeg','only photo types are kept');
 const parcel={id:'A',record:{title:'A',fullGeom:wkt([ring(433000,4909700,10)])},ko:'K',municipality:'M',savedAt:'2026-09-25T10:00:00.000Z',label:'Njiva',marks:[{id:'m',type:'ulaz',lon:20,lat:44}],osm:{elements:[{}]},neighborhood:{records:[]},geometry:{area:100}};
 const file=await backupBlob([parcel],[{id:'p',parcel:'A',blob:photo,at:'2026-09-25T10:00:00.000Z',coords:[20.1,44.3],accuracy:6}],'2026-09-25T12:00:00.000Z');
 const data=JSON.parse(await file.text());
 assert.equal(data.kind,BACKUP_KIND);assert.equal(data.exportedAt,'2026-09-25T12:00:00.000Z');
 assert.deepEqual(Object.keys(data.parcels[0]).sort(),['id','ko','label','marks','municipality','record','savedAt']);
 assert.deepEqual({...data.photos[0],data:undefined},{id:'p',parcel:'A',at:'2026-09-25T10:00:00.000Z',coords:[20.1,44.3],accuracy:6,type:'image/jpeg',data:undefined});
 const read=readBackup(data);assert.equal(read.parcels.length,1);assert.equal(read.photos.length,1);
 assert.equal(readBackup({...data,photos:[...data.photos,{id:'bad',parcel:'A',data:'',coords:['x',1]},null]}).photos.length,1,'malformed photos are dropped');
 assert.equal(readBackup({record:parcel.record,ko:'K',municipality:'M'}),null,'a single exported parcel is not a backup');
 assert.throws(()=>readBackup({kind:BACKUP_KIND}),/oštećena/);
});

test('importing keeps what is on this phone, fills empty fields and adds missing points',()=>{
 const here={id:'A',label:'Moja',marks:[{id:'1',type:'ulaz'}],osm:{elements:[]}};
 const merged=mergeParcel(here,{id:'A',label:'Njiva',note:'Uz potok',color:PALETTE[2],group:'Brat',marks:[{id:'1',type:'kapija'},{id:'2',type:'bunar'}]});
 assert.equal(merged.label,'Moja');assert.equal(merged.note,'Uz potok');assert.equal(merged.color,PALETTE[2]);assert.equal(merged.group,'Brat');
 assert.deepEqual(merged.marks,[{id:'1',type:'ulaz'},{id:'2',type:'bunar'}]);assert(merged.osm,'downloaded surroundings on this phone stay');
 const fresh={id:'B'};assert.equal(mergeParcel(undefined,fresh),fresh);
});

test('guidance distance and arrow; boundary crossings ignore changes within the GPS accuracy',()=>{
 const fix=(e,n,accuracy=5)=>({coords:utm34ToWgs84(e,n),accuracy}),t=utm34ToWgs84(433000,4909700),near=(a,b)=>Math.abs(((a-b+540)%360)-180)<2;
 const g=guidance(fix(433000,4909660),t);
 assert(Math.abs(g.distance-40)<.1);assert(near(g.rotation,0));assert(!g.arrived);
 assert(near(guidance(fix(433000,4909660),t,90).rotation,270),'with the phone facing east, north is to the left');
 assert(guidance(fix(433001,4909701),t).arrived,'within the accuracy counts as arrived');
 const cross=createCrossing(squareGeometry().polygons);
 assert.equal(cross(fix(433015,4909650)),null,'the first fix only sets the state');
 assert.equal(cross(fix(433015,4909715)),'entered');
 assert.equal(cross(fix(433015,4909702)),null,'2 m from the boundary with ±5 m says nothing');
 assert.equal(cross(fix(433015,4909650)),'left');
});

test('compass heading from iOS and Android events, smoothed across north, started only with permission',async()=>{
 assert.equal(headingFrom({webkitCompassHeading:45}),45);
 assert.equal(headingFrom({alpha:90,absolute:true}),270,'Android alpha grows counter-clockwise');
 assert.equal(headingFrom({alpha:90,absolute:false}),null,'relative orientation is no compass');
 assert.equal(headingFrom({alpha:0,absolute:true},90),90,'landscape adds the screen angle');
 assert(Math.abs(smoothHeading(350,10,.5))<1e-9,'350° to 10° passes through north, not south');
 const handlers={},seen=[],target={ondeviceorientationabsolute:null,addEventListener:(type,fn)=>handlers[type]=fn,removeEventListener:type=>delete handlers[type]};
 assert.equal(await createCompass({onHeading:h=>seen.push(h),target,Orientation:{requestPermission:async()=>'denied'}}).start(),false);
 assert.equal(await createCompass({onHeading:()=>{},target,Orientation:undefined}).start(),false,'no DeviceOrientationEvent, no compass');
 const compass=createCompass({onHeading:h=>seen.push(h),target,Orientation:{requestPermission:async()=>'granted'},screenAngle:()=>0});
 assert.equal(await compass.start(),true);handlers.deviceorientationabsolute({alpha:270,absolute:true});
 assert.equal(compass.heading,90);compass.stop();assert.equal(seen.at(-1),null);assert(!handlers.deviceorientationabsolute);
});

test('navigation links carry the destination and name it for other map apps',()=>{
 const links=navigationLinks([20.1595471,44.3374173],'Parcela 1227/2 · T1');
 assert.equal(links.google,'https://www.google.com/maps/dir/?api=1&destination=44.337417%2C20.159547&travelmode=driving');
 assert.equal(links.apple,'https://maps.apple.com/?daddr=44.337417%2C20.159547&dirflg=d');
 assert.equal(links.waze,'https://waze.com/ul?ll=44.337417%2C20.159547&navigate=yes');
 assert.equal(links.geo,'geo:44.337417,20.159547?q=44.337417,20.159547(Parcela%201227%2F2%20%C2%B7%20T1)');
});
