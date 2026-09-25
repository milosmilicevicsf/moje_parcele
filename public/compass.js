// Heading of the top of the screen, clockwise from north. iOS reports webkitCompassHeading once a tap granted
// permission; Android reports an absolute alpha that grows counter-clockwise. Relative orientation is no compass.
export function headingFrom(event,screenAngle=0){
  let h=null;
  if(Number.isFinite(event.webkitCompassHeading))h=event.webkitCompassHeading;
  else if(event.absolute&&Number.isFinite(event.alpha))h=360-event.alpha;
  return h==null?null:((h+screenAngle)%360+360)%360;
}

// Low-pass filter that takes the short way across north (350° to 10° passes 0°, not 180°).
export function smoothHeading(previous,next,factor=.25){
  if(previous==null)return next;
  const delta=((next-previous+540)%360)-180;
  return ((previous+delta*factor)%360+360)%360;
}

export function createCompass({onHeading,target=globalThis,Orientation=globalThis.DeviceOrientationEvent,screenAngle=()=>globalThis.screen?.orientation?.angle||0}){
  let heading=null,type=null;
  const handle=e=>{const h=headingFrom(e,screenAngle());if(h==null)return;heading=smoothHeading(heading,h);onHeading(heading);};
  return {
    // Call from a tap: iOS shows its permission prompt only in response to one.
    async start(){
      if(type)return true;
      if(!Orientation)return false;
      if(typeof Orientation.requestPermission==='function'&&await Orientation.requestPermission().catch(()=>'denied')!=='granted')return false;
      type='ondeviceorientationabsolute' in target?'deviceorientationabsolute':'deviceorientation';
      target.addEventListener(type,handle);
      return true;
    },
    stop(){if(type)target.removeEventListener(type,handle);type=null;heading=null;onHeading(null);},
    get heading(){return heading;}
  };
}
