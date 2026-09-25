import {bearing,distance,boundary} from './field-geo.js';

// Distance and arrow toward a target. With a compass heading the arrow is relative to the top of the phone,
// otherwise to north, which is up on the map.
export function guidance(fix,target,heading=null){
  const d=distance(fix.coords,target),b=bearing(fix.coords,target);
  return {distance:d,bearing:b,rotation:heading==null?b:(b-heading+360)%360,arrived:d<=Math.max(3,fix.accuracy)};
}

// Inside/outside changes count only once the fix is clear of the boundary by more than its accuracy.
export function createCrossing(polygons){
  let inside=null;
  return fix=>{
    const b=boundary(fix.coords,polygons);
    if(b.distance<=fix.accuracy)return null;
    const was=inside;inside=b.inside;
    return was===null||was===inside?null:inside?'entered':'left';
  };
}
