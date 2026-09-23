// WGS84 / UTM zone 34N conversion; output order is longitude, latitude.
export function utm34ToWgs84(east, north) {
  const a = 6378137, e2 = 0.0066943799901413165, k = 0.9996;
  const ep2 = e2 / (1 - e2), e1 = (1 - Math.sqrt(1-e2)) / (1 + Math.sqrt(1-e2));
  const mu = (north/k) / (a * (1-e2/4-3*e2**2/64-5*e2**3/256));
  const phi = mu+(3*e1/2-27*e1**3/32)*Math.sin(2*mu)+(21*e1**2/16-55*e1**4/32)*Math.sin(4*mu)+151*e1**3/96*Math.sin(6*mu)+1097*e1**4/512*Math.sin(8*mu);
  const n = a/Math.sqrt(1-e2*Math.sin(phi)**2), t=Math.tan(phi)**2, c=ep2*Math.cos(phi)**2;
  const r=a*(1-e2)/(1-e2*Math.sin(phi)**2)**1.5, d=(east-500000)/(n*k);
  const lat=phi-(n*Math.tan(phi)/r)*(d**2/2-(5+3*t+10*c-4*c*c-9*ep2)*d**4/24+(61+90*t+298*c+45*t*t-252*ep2-3*c*c)*d**6/720);
  const lon=21*Math.PI/180+(d-(1+2*t+c)*d**3/6+(5-2*c+28*t-3*c*c+8*ep2+24*t*t)*d**5/120)/Math.cos(phi);
  return [lon*180/Math.PI,lat*180/Math.PI];
}

// Forward UTM zone 34N (central meridian 21°E); input order is longitude, latitude.
export function wgs84ToUtm34(lon, lat) {
  const a = 6378137, e2 = 0.0066943799901413165, k = 0.9996, ep2 = e2 / (1 - e2);
  const phi = lat * Math.PI / 180, dl = (lon - 21) * Math.PI / 180;
  const n = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2), t = Math.tan(phi) ** 2, c = ep2 * Math.cos(phi) ** 2, A = Math.cos(phi) * dl;
  const m = a * ((1 - e2/4 - 3*e2**2/64 - 5*e2**3/256) * phi - (3*e2/8 + 3*e2**2/32 + 45*e2**3/1024) * Math.sin(2*phi) + (15*e2**2/256 + 45*e2**3/1024) * Math.sin(4*phi) - (35*e2**3/3072) * Math.sin(6*phi));
  const east = 500000 + k * n * (A + (1 - t + c) * A**3/6 + (5 - 18*t + t*t + 72*c - 58*ep2) * A**5/120);
  const north = k * (m + n * Math.tan(phi) * (A*A/2 + (5 - t + 9*c + 4*c*c) * A**4/24 + (61 - 58*t + t*t + 600*c - 330*ep2) * A**6/720));
  return [east, north];
}

const cy='абвгдђежзијклљмнњопрстћуфхцчџш', la=['a','b','v','g','d','dj','e','z','z','i','j','k','l','lj','m','n','nj','o','p','r','s','t','c','u','f','h','c','c','dz','s'];
export function normalize(s) {
  return String(s).toLowerCase().replace(/[абвгдђежзијклљмнњопрстћуфхцчџш]/g,c=>la[cy.indexOf(c)]).replace(/đ/g,'dj').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9/]+/g,' ').trim().replace(/\s+/g,' ');
}
export function normalizeNumber(s) {
  const value=String(s).trim();
  if (!/^\d+(?:\/\d+)?$/.test(value)) throw new Error('Unesite broj parcele, na primer 1227/2.');
  return value.split('/').map(n=>String(Number(n))).join('/');
}
function phraseIn(text, phrase) { return (' '+normalize(text)+' ').includes(' '+normalize(phrase)+' '); }
export function selectRecords(records, parcel, ko, municipality) {
  const number=normalizeNumber(parcel);
  if (!normalize(ko) || !normalize(municipality)) throw new Error('Unesite i katastarsku opštinu i opštinu/grad.');
  return records.filter(r=>{
    let same=false;try { same=normalizeNumber(r.title)===number; } catch {}
    return same && phraseIn(r.desc,ko) && phraseIn(r.desc,municipality) && /^(?:MULTI)?POLYGON\b/i.test(String(r.fullGeom||'').trim());
  });
}

// Parse polygon nesting explicitly, preserving holes and separate polygons.
export function parseWkt(wkt) {
  const source=String(wkt).trim();
  const head=/^(MULTIPOLYGON|POLYGON)\s*/i.exec(source);
  if (!head) throw new Error('Servis nije vratio poligon granice parcele.');
  const rest=source.slice(head[0].length);
  const tokens=rest.match(/[(),]|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/g)||[];
  if(tokens.join('')!==rest.replace(/\s+/g,'')) throw new Error('Nepodržan format geometrije.');
  let i=0;
  const eat=t=>{if(tokens[i++]!==t)throw new Error('Neispravna geometrija parcele.');};
  function group(){eat('(');const items=[];while(true){if(tokens[i]==='(')items.push(group());else{const pair=[Number(tokens[i++]),Number(tokens[i++])];if(pair.some(n=>!Number.isFinite(n)))throw new Error('Neispravne koordinate.');items.push(pair);}if(tokens[i]===')'){i++;break;}eat(',');}return items;}
  const nested=group();if(i!==tokens.length)throw new Error('Nepotpuno pročitana geometrija.');
  const polygons=head[1].toUpperCase()==='POLYGON'?[nested]:nested;
  return polygons.map(poly=>poly.map(ring=>{
    if(!Array.isArray(ring) || ring.length<4 || ring.some(p=>p.length!==2 || p.some(n=>!Number.isFinite(n))))throw new Error('Neispravan prsten parcele.');
    const first=ring[0],last=ring.at(-1);
    if(Math.hypot(first[0]-last[0],first[1]-last[1])>0.001)throw new Error('Granica parcele nije zatvorena.');
    const unique=ring.slice(0,-1).filter((p,j,a)=>j===0||p[0]!==a[j-1][0]||p[1]!==a[j-1][1]);
    if(unique.length<3)throw new Error('Premalo tačaka granice.');
    if(unique.some(([e,n])=>e<250000||e>800000||n<4550000||n>5250000))throw new Error('Koordinate su van očekivanog područja Srbije (UTM 34N).');
    return unique;
  }));
}
export function parcelGeometry(record) {
  const projected=parseWkt(record.fullGeom), polygons=projected.map(p=>p.map(r=>r.map(([e,n])=>utm34ToWgs84(e,n))));
  const points=[], seen=new Set();let area=0;
  projected.forEach((poly,pi)=>poly.forEach((ring,ri)=>{
    let twice=0;ring.forEach((p,i)=>{const q=ring[(i+1)%ring.length];twice+=p[0]*q[1]-q[0]*p[1];});area+=(ri===0?1:-1)*Math.abs(twice)/2;
    ring.forEach((p,i)=>{const coords=polygons[pi][ri][i],key=coords.map(n=>n.toFixed(8)).join(',');if(!seen.has(key)){seen.add(key);points.push({name:'T'+(points.length+1),lon:coords[0],lat:coords[1],polygon:pi,ring:ri});}});
  }));
  // Preserve every boundary vertex; the former Maps pin limit does not apply to terrain polygons.
  return {polygons,projected,points,area};
}
export function escapeXml(s){return String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));}
export function toKml(record, geometry) {
  const coordinate=c=>`${c[0].toFixed(8)},${c[1].toFixed(8)},0`;
  const orient=(ring,outer)=>{let area=0;ring.forEach((p,i)=>{const q=ring[(i+1)%ring.length];area+=p[0]*q[1]-q[0]*p[1];});return (area>0)===outer?ring:[...ring].reverse();};
  const oriented=geometry.polygons.map(poly=>poly.map((ring,i)=>orient(ring,i===0)));
  const rings=oriented.map(poly=>'<Polygon><altitudeMode>clampToGround</altitudeMode>'+poly.map((ring,i)=>`<${i?'inner':'outer'}BoundaryIs><LinearRing><coordinates>${[...ring,ring[0]].map(coordinate).join(' ')}</coordinates></LinearRing></${i?'inner':'outer'}BoundaryIs>`).join('')+'</Polygon>').join('');
  const description='Geometrija iz javnog prikaza GeoSrbije; informativno, nije geodetsko obeležavanje međe.';
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${escapeXml(record.title+' · '+record.desc)}</name><description>${description}</description><Style id="boundary"><LineStyle><color>ff00c8ff</color><width>3</width></LineStyle><PolyStyle><color>3300c8ff</color></PolyStyle></Style><Placemark><name>Granica parcele</name><styleUrl>#boundary</styleUrl><MultiGeometry>${rings}</MultiGeometry></Placemark>${geometry.points.map(p=>`<Placemark><name>${p.name}</name><description>${description}</description><Point><coordinates>${p.lon.toFixed(8)},${p.lat.toFixed(8)},0</coordinates></Point></Placemark>`).join('')}</Document></kml>`;
}
