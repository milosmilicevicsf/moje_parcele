import {local} from './field-geo.js';

// Side lengths come from the projected UTM 34N rings in metres; the zone's scale error stays below 0.05% in Serbia.
export function ringSides(geometry){
  const names=new Map(geometry.points.map(p=>[p.lon.toFixed(8)+','+p.lat.toFixed(8),p.name]));
  const name=c=>names.get(c[0].toFixed(8)+','+c[1].toFixed(8));
  const sides=[];
  geometry.projected.forEach((poly,pi)=>poly.forEach((ring,ri)=>ring.forEach((p,i)=>{
    const j=(i+1)%ring.length,q=ring[j],a=geometry.polygons[pi][ri][i],b=geometry.polygons[pi][ri][j];
    sides.push({from:name(a),to:name(b),length:Math.hypot(q[0]-p[0],q[1]-p[1]),mid:[(a[0]+b[0])/2,(a[1]+b[1])/2],hole:ri>0});
  })));
  return sides;
}
export const perimeter=geometry=>ringSides(geometry).reduce((sum,side)=>sum+side.length,0);

// Roads a car or tractor can use; footpaths and steps are no access to a parcel.
const ACCESS=/^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|road|track)(_link)?$/;
function segmentDistance(p,a,b){
  const A=local(a,p),B=local(b,p),dx=B[0]-A[0],dy=B[1]-A[1],l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,-(A[0]*dx+A[1]*dy)/l)):0;
  return Math.hypot(A[0]+t*dx,A[1]+t*dy);
}
// Boundary vertex closest to a road of the downloaded OpenStreetMap surroundings, within maxDistance metres.
export function roadVertex(geometry,elements,maxDistance=150){
  const pts=geometry.points,pad=maxDistance/80000;
  const box=[Math.min(...pts.map(p=>p.lon))-pad*1.5,Math.min(...pts.map(p=>p.lat))-pad,Math.max(...pts.map(p=>p.lon))+pad*1.5,Math.max(...pts.map(p=>p.lat))+pad];
  let best=null;
  for(const e of elements||[]){
    if(!ACCESS.test(e.tags?.highway||'')||!Array.isArray(e.geometry))continue;
    for(let i=0;i+1<e.geometry.length;i++){
      const a=[e.geometry[i].lon,e.geometry[i].lat],b=[e.geometry[i+1].lon,e.geometry[i+1].lat];
      if(Math.max(a[0],b[0])<box[0]||Math.min(a[0],b[0])>box[2]||Math.max(a[1],b[1])<box[1]||Math.min(a[1],b[1])>box[3])continue;
      pts.forEach((p,index)=>{const d=segmentDistance([p.lon,p.lat],a,b);if(d<=maxDistance&&(!best||d<best.distance))best={index,distance:d};});
    }
  }
  return best;
}
