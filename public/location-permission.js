// The steps to allow location differ between Safari on iPhone and iPad (in the browser or from the home
// screen), Android and desktop browsers. iPadOS reports a Mac user agent, so touch points tell it apart.
export function platformOf(nav=globalThis.navigator,standalone=()=>globalThis.matchMedia?.('(display-mode: standalone)').matches){
  const ua=nav?.userAgent||'',ios=/iPhone|iPad|iPod/.test(ua)||nav?.platform==='MacIntel'&&nav?.maxTouchPoints>1;
  if(ios)return nav.standalone===true||standalone()?'ios-app':'ios';
  return /Android/.test(ua)?'android':'desktop';
}

const IOS_SYSTEM='Podešavanja → Privacy & Security → Location Services → Safari Websites → While Using the App, i uključite Precise Location.';
// What to do once location is blocked. A website cannot open these settings itself.
export function locationHelp(platform){
  if(platform==='ios')return ['U Safariju dodirnite ikonicu levo od adrese (aA), pa Website Settings → Location → Allow. Posle toga Safari više ne pita za ovaj sajt.','Ako ni to ne pomaže: '+IOS_SYSTEM];
  if(platform==='ios-app')return [IOS_SYSTEM,'Ako i dalje pita ili ne radi, otvorite ovu adresu u Safariju, dodirnite ikonicu levo od adrese (aA), pa Website Settings → Location → Allow.'];
  if(platform==='android')return ['Dodirnite ikonicu levo od adrese, pa Dozvole → Lokacija → Dozvoli. U instaliranoj aplikaciji to uradite u Chrome-u, na ovoj adresi.','Ako je lokacija isključena za ceo pregledač: Podešavanja telefona → Aplikacije → Chrome → Dozvole → Lokacija → Dozvoli samo dok se aplikacija koristi, i uključite preciznu lokaciju.'];
  return ['Kliknite ikonicu levo od adrese i u dozvolama za sajt izaberite Lokacija → Dozvoli.'];
}

// null where the Permissions API is missing (Safari before 16).
export async function permissionStatus(nav=globalThis.navigator){
  try{return await nav.permissions.query({name:'geolocation'});}catch{return null;}
}
