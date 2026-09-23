import {distance} from './field-geo.js';

// Keep one request in flight; fresh fixes may arrive much faster than the service replies.
export function createNearbyLoader({load,onError,online=()=>navigator.onLine,now=()=>Date.now()}) {
  let enabled=true,busy=false,lastCenter=null,lastAttempt=-Infinity,latest=null,generation=0;
  async function update(coords,force=false) {
    latest=coords;
    if(!enabled||busy||!online()||(!force&&now()-lastAttempt<30000))return;
    if(!force&&lastCenter&&distance(coords,lastCenter)<75)return;
    busy=true;lastAttempt=now();const version=generation;
    try {await load(coords,()=>enabled&&version===generation);if(enabled&&version===generation)lastCenter=coords;}
    catch(error){if(enabled&&version===generation)onError(error);}
    finally {busy=false;}
  }
  return {update,disable(){enabled=false;generation++;},enable(){enabled=true;},retry(){if(latest)return update(latest,true);}};
}
