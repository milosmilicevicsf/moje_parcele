// Shared by the /api/surroundings Worker route and its Node tests, so it must stay
// free of Cloudflare-only imports.
export const RADIUS=.009; // half-width of the downloaded box, in degrees of latitude (~1 km)
// Buildings are only useful right around the parcel; in towns they dominate the payload
// (central Belgrade: 6.7 MB for the full box), so they are limited to ~500 m.
export const BUILDING_RADIUS=.0045;
export const SERBIA={lat:[41.8,46.3],lon:[18.7,23.1]};
export const USER_AGENT='MojeParcele/1.0 (+https://github.com/milosmilicevicsf/moje_parcele)';
export const SOURCE='OpenStreetMap contributors, ODbL 1.0';
// Public instances are often busy; the route tries them in order. Override with the
// comma-separated OVERPASS_URL variable, ideally pointing at your own instance first.
export const DEFAULT_UPSTREAMS=['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter','https://overpass.private.coffee/api/interpreter'];

export class RequestError extends Error{constructor(message,status){super(message);this.status=status;}}

/** @param {string|undefined} value @returns {string[]} */
export function upstreams(value){
  const list=String(value||'').split(',').map(s=>s.trim()).filter(Boolean);
  return list.length?list:DEFAULT_UPSTREAMS;
}

// Centers are rounded to ~100 m so neighbouring parcels share one cached download;
// the returned bbox is derived from the rounded center, so coverage stays exact.
/** @param {URLSearchParams} params @returns {[number, number]} */
export function parseCenter(params){
  const lat=Number(params.get('lat')??NaN),lon=Number(params.get('lon')??NaN);
  if(!Number.isFinite(lat)||!Number.isFinite(lon))throw new RequestError('Nedostaju koordinate središta parcele.',400);
  if(lat<SERBIA.lat[0]||lat>SERBIA.lat[1]||lon<SERBIA.lon[0]||lon>SERBIA.lon[1])throw new RequestError('Središte je van područja koje servis pokriva.',400);
  return [Number(lat.toFixed(3)),Number(lon.toFixed(3))];
}
/** @param {[number, number]} center @returns {number[]} south, west, north, east */
export function bbox([lat,lon],radius=RADIUS){
  const dlon=radius/Math.cos(lat*Math.PI/180);
  return [lat-radius,lon-dlon,lat+radius,lon+dlon].map(n=>Number(n.toFixed(6)));
}
/** @param {[number, number]} center */
export function overpassQuery(center){
  const b=bbox(center).join(','),s=bbox(center,BUILDING_RADIUS).join(',');
  return `[out:json][timeout:25];(way[highway](${b});way[waterway](${b});way[natural~"wood|water"](${b});way[landuse](${b});way[building](${s}););out geom;`;
}
export function packageFrom(data,box){
  if(!data||data.remark||!Array.isArray(data.elements))throw new RequestError('Servis nije vratio kompletnu okolinu.',502);
  if(data.elements.length>100000)throw new RequestError('Okolina je prevelika za preuzimanje.',502);
  return {elements:data.elements,bbox:box,downloadedAt:new Date().toISOString(),source:SOURCE};
}
