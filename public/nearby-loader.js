import {distance} from './field-geo.js';

// A 150 m neighborhood is not useful around a fix uncertain by hundreds of metres.
// This threshold is only for loading the overview, not for surveying a boundary.
export const MAX_NEARBY_ACCURACY=100;
export function nearbyFixState(fix,now=Date.now()) {
  if(!fix||!Array.isArray(fix.coords)||fix.coords.length!==2||
    !fix.coords.every(Number.isFinite)||Math.abs(fix.coords[0])>180||Math.abs(fix.coords[1])>90||
    !Number.isFinite(fix.accuracy)||fix.accuracy<0||!Number.isFinite(fix.timestamp))return 'missing';
  if(now-fix.timestamp>30000||fix.timestamp-now>5000)return 'stale';
  return fix.accuracy>MAX_NEARBY_ACCURACY?'coarse':'ready';
}

// Keep one request in flight and discard results after the location becomes unsuitable.
export function createNearbyLoader({load,onError,online=()=>navigator.onLine,now=()=>Date.now()}) {
  let enabled=true,busy=false,lastCenter=null,lastAttempt=-Infinity,latest=null,generation=0,pending=false;
  async function update(fix,force=false) {
    latest=fix;
    if(!enabled)return;
    if(nearbyFixState(fix,now())!=='ready'){
      generation++;lastCenter=null;lastAttempt=-Infinity;
      return;
    }
    if(!online())return;
    if(busy){pending=true;return;}
    if(!force&&(now()-lastAttempt<30000||lastCenter&&distance(fix.coords,lastCenter)<75))return;
    busy=true;pending=false;lastAttempt=now();const version=generation,coords=[...fix.coords];
    const isActive=()=>enabled&&version===generation&&online()&&
      nearbyFixState(latest,now())==='ready'&&distance(coords,latest.coords)<75;
    try {await load(coords,isActive);if(isActive())lastCenter=coords;}
    catch(error){if(isActive())onError(error);}
    finally {
      busy=false;
      // A better fix received during the request must not wait for another GPS event.
      if(pending&&!isActive()&&enabled&&nearbyFixState(latest,now())==='ready'){
        pending=false;await update(latest,true);
      }
    }
  }
  return {update,disable(){enabled=false;generation++;pending=false;},enable(){enabled=true;},retry(){if(latest)return update(latest,true);}};
}
