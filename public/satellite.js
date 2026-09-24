// Web Mercator (XYZ) imagery drawn under the vector map. Tiles are placed through the map's own
// lon/lat -> pixel function, so imagery and parcel boundaries share one projection.
const TILE=256, EARTH=156543.03392804097;
export const MAX_ZOOM=19;
// Overzoom limit: tiles missing at the requested zoom are replaced by an ancestor scaled up.
const MAX_ANCESTOR=6, MAX_TILES=120, MAX_CACHED=400;

export function tileZoom(metresPerPixel,lat){
  const z=Math.ceil(Math.log2(EARTH*Math.cos(lat*Math.PI/180)/metresPerPixel));
  return Math.max(0,Math.min(MAX_ZOOM,Number.isFinite(z)?z:0));
}
export function tileLon(x,z){return x/2**z*360-180;}
export function tileLat(y,z){return Math.atan(Math.sinh(Math.PI*(1-2*y/2**z)))*180/Math.PI;}
export function tileAt(lon,lat,z){
  const n=2**z, s=Math.sin(Math.max(-85.05,Math.min(85.05,lat))*Math.PI/180);
  return [Math.floor((lon+180)/360*n),Math.floor((0.5-Math.log((1+s)/(1-s))/(4*Math.PI))*n)];
}
// Tiles covering [west,south,east,north] at zoom z, or null when the view needs too many.
export function tilesFor(bounds,z){
  const n=2**z,[x0,y0]=tileAt(bounds[0],bounds[3],z),[x1,y1]=tileAt(bounds[2],bounds[1],z),tiles=[];
  const clamp=v=>Math.max(0,Math.min(n-1,v));
  if((x1-x0+1)*(y1-y0+1)>MAX_TILES)return null;
  for(let y=clamp(y0);y<=clamp(y1);y++)for(let x=clamp(x0);x<=clamp(x1);x++)tiles.push([z,x,y]);
  return tiles;
}
export function tileUrl(template,[z,x,y]){return template.replace('{z}',z).replace('{x}',x).replace('{y}',y);}

// load(url, done(ok)) returns an image-like object; injectable for tests.
export function createTileLayer({template,onChange,load}){
  const cache=new Map();
  function entry(tile){
    const key=tile.join('/');let item=cache.get(key);
    if(item){cache.delete(key);cache.set(key,item);return item;}
    item={state:'loading'};cache.set(key,item);
    item.image=load(tileUrl(template,tile),ok=>{item.state=ok?'ready':'missing';onChange();});
    for(const [old,value] of cache){if(cache.size<=MAX_CACHED)break;if(value.state!=='loading')cache.delete(old);}
    return item;
  }
  // Draws what is available and reports whether anything is still pending or failed at every level.
  function draw(ctx,pixel,bounds,metresPerPixel){
    const lat=(bounds[1]+bounds[3])/2,z=tileZoom(metresPerPixel,lat),tiles=tilesFor(bounds,z);
    if(!tiles)return{pending:0,missing:0,tooWide:true};
    let pending=0,missing=0;
    const ancestor=(tile,d)=>[tile[0]-d,tile[1]>>d,tile[2]>>d];
    for(const tile of tiles){
      const item=entry(tile);
      if(item.state==='ready'){paint(ctx,pixel,tile,item.image,0);continue;}
      if(item.state==='loading'){
        pending++;
        // Placeholder from an already loaded ancestor while the sharper tile arrives; no extra requests.
        for(let d=1;d<=MAX_ANCESTOR&&d<=tile[0];d++){const up=cache.get(ancestor(tile,d).join('/'));if(up?.state==='ready'){paint(ctx,pixel,tile,up.image,d);break;}}
        continue;
      }
      // The provider has no imagery at this zoom here (common above z18 in rural areas): overzoom an ancestor.
      let resolved=false;
      for(let d=1;d<=MAX_ANCESTOR&&d<=tile[0]&&!resolved;d++){
        const up=entry(ancestor(tile,d));
        if(up.state==='ready'){paint(ctx,pixel,tile,up.image,d);resolved=true;}
        else if(up.state==='loading'){pending++;resolved=true;}
      }
      if(!resolved)missing++;
    }
    return{pending,missing,tooWide:false};
  }
  return{draw};
}
function paint(ctx,pixel,[z,x,y],image,depth){
  const a=pixel([tileLon(x,z),tileLat(y,z)]),b=pixel([tileLon(x+1,z),tileLat(y+1,z)]);
  const size=TILE/2**depth,sx=(x%2**depth)*size,sy=(y%2**depth)*size;
  // Half-pixel overlap hides hairline seams between neighbouring tiles.
  ctx.drawImage(image,sx,sy,size,size,Math.floor(a[0]),Math.floor(a[1]),Math.ceil(b[0]-a[0])+1,Math.ceil(b[1]-a[1])+1);
}
