// Parcels for whatever the map shows, without a long press. The UTM 34N plane is cut into fixed
// 250 m cells; each cell is fetched once through the circle that encloses it (the public "circle"
// query a map click sends in GeoSrbija) and kept, so panning back costs nothing. Neighbouring
// circles overlap, so the same parcel can arrive from several cells.
export const CELL=250;
export const CELL_RADIUS=Math.ceil(CELL*Math.SQRT1_2);
// About 1.5 × 1.5 km, a phone screen at the zoom where parcel numbers are still readable. Further out
// the map asks to zoom in rather than downloading thousands of parcels.
export const MAX_CELLS=36;
// A device copy older than this is shown at once and refreshed in the background when online.
export const REFRESH_MS=7*24*3600*1000;
export const RETRY_MS=20000;
const DELAY_MS=300,KEEP=150;

const cellKey=(i,j)=>i+':'+j;
export function cellCenter(key){const [i,j]=key.split(':').map(Number);return [(i+.5)*CELL,(j+.5)*CELL];}
// Cells touching a UTM box [west,south,east,north], nearest to its centre first; null when there are too many.
export function cellsFor(box,max=MAX_CELLS){
  const [i0,j0,i1,j1]=box.map(v=>Math.floor(v/CELL));
  if(![i0,j0,i1,j1].every(Number.isFinite)||(i1-i0+1)*(j1-j0+1)>max)return null;
  const mid=[(box[0]+box[2])/2,(box[1]+box[3])/2],away=key=>{const c=cellCenter(key);return Math.hypot(c[0]-mid[0],c[1]-mid[1]);};
  const keys=[];
  for(let i=i0;i<=i1;i++)for(let j=j0;j<=j1;j++)keys.push(cellKey(i,j));
  return keys.sort((a,b)=>away(a)-away(b));
}

// search(east,north,radius) -> {records,total}. store is the optional device copy: get(key), put(entry).
// view() is called on every map change; schedule/cancel debounce it so only a resting map loads.
export function createAreaLoader({search,store=null,onChange=()=>{},schedule=(fn,ms)=>setTimeout(fn,ms),cancel=clearTimeout,now=()=>Date.now(),online=()=>navigator.onLine,concurrency=3}){
  const cells=new Map(),queue=[];
  let wanted=[],wide=false,box=null,timer=null,active=0;
  function view(next){
    if(timer!==null)cancel(timer);
    timer=schedule(()=>{timer=null;run(next);},DELAY_MS);
  }
  function run(next){
    box=next;const keys=next?cellsFor(next):[];
    wide=!!next&&!keys;wanted=keys||[];
    const t=now();queue.length=0;
    for(const key of wanted){
      const c=cells.get(key);
      if(c)c.used=t;
      if(!c||!c.loading&&(c.state==='failed'&&t>=c.retryAt||c.state==='missing'&&online()||c.stale&&online()))queue.push(key);
    }
    pump();onChange();
  }
  function pump(){
    while(active<concurrency&&queue.length){
      const key=queue.shift();
      // A cell that left the view before its turn waits for the next visit.
      if(!wanted.includes(key)||cells.get(key)?.loading)continue;
      active++;void load(key);
    }
  }
  async function load(key){
    let c=cells.get(key);
    if(!c){c={state:'loading'};cells.set(key,c);}
    c.loading=true;c.used=now();
    try{
      if(!c.records&&store){
        const copy=await store.get(key).catch(()=>null);
        if(Array.isArray(copy?.records)){Object.assign(c,{state:'ready',records:copy.records,total:copy.total,downloadedAt:copy.downloadedAt});onChange();}
      }
      c.stale=!!c.records&&!(now()-Date.parse(c.downloadedAt)<REFRESH_MS);
      if(c.records&&!c.stale)return;
      if(!online()){if(!c.records)c.state='missing';return;}
      const result=await search(...cellCenter(key),CELL_RADIUS);
      const downloadedAt=new Date(now()).toISOString();
      Object.assign(c,{state:'ready',records:result.records,total:result.total,downloadedAt,stale:false});
      store?.put({key,records:result.records,total:result.total,downloadedAt}).catch(()=>{});
    }catch(error){
      // A failed refresh keeps the older copy on screen; a cell without one is retried later.
      if(c.records){c.state='ready';c.stale=false;}
      else Object.assign(c,{state:'failed',error,retryAt:now()+RETRY_MS});
    }finally{c.loading=false;active--;evict();pump();onChange();}
  }
  function evict(){
    if(cells.size<=KEEP)return;
    const old=[...cells].filter(([key,c])=>!c.loading&&!wanted.includes(key)).sort((a,b)=>(a[1].used||0)-(b[1].used||0));
    for(const [key] of old){if(cells.size<=KEEP)break;cells.delete(key);}
  }
  function status(){
    const s={wide,cells:wanted.length,loading:0,failed:0,missing:0,ready:0};
    for(const key of wanted){const c=cells.get(key);if(!c||c.loading)s.loading++;else if(c.state==='failed')s.failed++;else if(c.state==='missing')s.missing++;else s.ready++;}
    if(s.failed)s.error=wanted.map(key=>cells.get(key)).find(c=>c?.state==='failed')?.error;
    return s;
  }
  // Every kept cell with data; the caller removes parcels repeated across cells.
  function parcels(){return [...cells].filter(([,c])=>c.records).map(([key,c])=>({key,records:c.records,downloadedAt:c.downloadedAt}));}
  function retry(){for(const c of cells.values())if(c.state==='failed')c.retryAt=0;if(box)run(box);}
  return {view,status,parcels,retry,get size(){return cells.size;}};
}
