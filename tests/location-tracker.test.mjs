import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocationTracker} from '../public/location-tracker.js';

function setup(){
 let time=100000,id=0,timerId=0;
 const watches=[],reads=[],cleared=[],positions=[],errors=[],states=[],timers=new Map();
 const tracker=createLocationTracker({
  geolocation:{watchPosition(ok,error,options){const watch={id:++id,ok,error,options};watches.push(watch);return watch.id;},clearWatch:id=>cleared.push(id),getCurrentPosition(ok,error,options){reads.push({ok,error,options});}},
  onPosition:p=>positions.push(p),onError:e=>errors.push(e),onState:s=>states.push(s),now:()=>time,
  setTimer(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimer:id=>timers.delete(id)
 });
 const position=(accuracy=6306,timestamp=time)=>({coords:{latitude:44.8178,longitude:20.4604,accuracy},timestamp});
 return {tracker,watches,reads,cleared,positions,errors,states,timers,position,
  advance(ms){time+=ms;},fireTimer(){assert.equal(timers.size,1);const [id,timer]=[...timers][0];timers.delete(id);time+=timer.ms;timer.fn();}};
}

test('starts watch plus uncached high-accuracy reading; recovery is bounded',()=>{
 const x=setup();x.tracker.start();assert.equal(x.watches.length,1);assert.equal(x.reads.length,1);
 assert.deepEqual(x.reads[0].options,{enableHighAccuracy:true,maximumAge:0,timeout:30000});
 x.watches[0].ok(x.position());x.fireTimer();assert.equal(x.watches.length,2);assert.deepEqual(x.cleared,[1]);
 x.watches[1].ok(x.position());x.fireTimer();assert.equal(x.watches.length,3);
 x.watches[2].ok(x.position());assert.equal(x.timers.size,0);assert.equal(x.states.at(-1).phase,'limited');
 x.tracker.retry();assert.equal(x.watches.length,4);assert.equal(x.reads.length,4);assert(x.tracker.active);
});

test('precise reading resumes automatically and a late one-shot timeout cannot replace it',()=>{
 const x=setup();x.tracker.start();x.watches[0].ok(x.position());x.advance(1000);x.reads[0].ok(x.position(8));
 assert.equal(x.positions.at(-1).accuracy,8);assert.equal(x.states.at(-1).phase,'ready');assert.equal(x.timers.size,0);
 x.reads[0].error({code:3});assert.equal(x.errors.length,0);
 x.advance(1000);x.watches[0].ok(x.position(6306));assert.equal(x.positions.at(-1).accuracy,6306);assert.equal(x.timers.size,1,'recover if location quality deteriorates again');
});

test('old callbacks and out-of-order fixes never move the current location backwards',()=>{
 const x=setup();x.tracker.start();x.watches[0].ok(x.position(8));x.tracker.retry();
 x.advance(1000);x.watches[0].ok(x.position(2));x.reads[0].error({code:1});assert.equal(x.positions.length,1);assert(x.tracker.active);
 x.watches[1].ok(x.position(7));x.reads[1].ok(x.position(6306,100000));assert.equal(x.positions.length,2);assert.equal(x.positions.at(-1).accuracy,7);
 x.tracker.stop();x.watches[1].ok(x.position(5));assert.equal(x.positions.length,2);assert.equal(x.timers.size,0);
});

test('denied permission stops automatic recovery; visibility resume respects manual stop',()=>{
 const x=setup();x.tracker.start();x.reads[0].error({code:1});assert(!x.tracker.active);assert.equal(x.timers.size,0);
 x.tracker.resume();assert.equal(x.watches.length,1);
 x.tracker.retry();x.watches[1].ok(x.position(8));x.tracker.suspend();assert.equal(x.timers.size,0);
 x.tracker.resume();assert.equal(x.watches.length,3);
 x.tracker.stop();x.tracker.resume();assert.equal(x.watches.length,3);
});
