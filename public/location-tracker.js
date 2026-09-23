import {nearbyFixState} from './nearby-loader.js';

const OPTIONS={enableHighAccuracy:true,maximumAge:0,timeout:30000};
// Ask the browser for a fresh fix as well as a watch. This cannot force the OS
// to use GPS or override the user's precision/permission settings.
export function createLocationTracker({geolocation,onPosition,onError,onState=()=>{},
  now=()=>Date.now(),setTimer=setTimeout,clearTimer=clearTimeout}) {
  let active=false,paused=false,watch=null,timer=null,generation=0,attempts=0,last=null;
  const ready=()=>nearbyFixState(last,now())==='ready';
  const state=phase=>onState({active,phase,attempts});
  function clear(){if(timer!==null)clearTimer(timer);timer=null;if(watch!==null)geolocation.clearWatch(watch);watch=null;}
  function stop(){active=false;paused=false;generation++;clear();state('stopped');}
  function schedule(){
    if(!active||paused||timer!==null||ready()||attempts>=2)return;
    timer=setTimer(()=>{
      timer=null;if(!active||ready())return;
      attempts++;acquire();
    },35000);
  }
  function acquire(){
    clear();paused=false;const version=++generation;state(attempts?'retrying':'locating');
    const accept=position=>{
      if(!active||version!==generation)return;
      const c=position.coords;
      const fix={coords:[c.longitude,c.latitude],accuracy:c.accuracy,timestamp:position.timestamp};
      if(nearbyFixState(fix,now())==='missing')return;
      // Concurrent watch and one-shot callbacks may arrive out of order.
      if(last&&(fix.timestamp<last.timestamp||fix.timestamp===last.timestamp&&fix.accuracy>=last.accuracy))return;
      last=fix;onPosition(fix);
      if(ready()){
        attempts=0;if(timer!==null)clearTimer(timer);timer=null;state('ready');
      }else{state(attempts>=2?'limited':'waiting');schedule();}
    };
    const failure=error=>{
      if(!active||version!==generation)return;
      // A one-shot timeout must not hide a good live fix from the watch.
      if(error.code!==1&&ready())return;
      if(error.code===1)stop();
      onError(error);if(active){state(attempts>=2?'limited':'waiting');schedule();}
    };
    try {
      const id=geolocation.watchPosition(accept,failure,{...OPTIONS});
      if(!active||version!==generation){geolocation.clearWatch(id);return;}
      watch=id;
      if(geolocation.getCurrentPosition)geolocation.getCurrentPosition(accept,failure,{...OPTIONS});
      schedule();
    }catch(error){failure({code:2,message:error.message});}
  }
  return {
    start(){if(active)return;active=true;attempts=0;acquire();},
    retry(){active=true;attempts=0;acquire();},
    suspend(){if(active){generation++;clear();paused=true;state('paused');}},
    resume(){if(active&&(paused||!ready())){attempts=0;acquire();}},
    stop,
    get active(){return active;}
  };
}
