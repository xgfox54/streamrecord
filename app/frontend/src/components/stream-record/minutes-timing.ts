export type MinutesWorkEvent =
 | {kind:'plan';total:number;reused:number;pendingUnits:number}
 | {kind:'batch-start';units:number}
 | {kind:'batch-done';cached:boolean}
 | {kind:'retry'|'waiting'|'generating'|'saving'};

export type MinutesTiming = {
 phase:'preparing'|'processing'|'waiting'|'saving';
 total:number;completed:number;reused:number;remainingUnits:number;activeUnits:number;
 activeElapsedMs:number;activeSince:number|null;sampledMs:number;sampledUnits:number;
 estimateSeconds:number|null;updatedAt:number;
};

const INITIAL_SECONDS_PER_UNIT=45;
const FINAL_SAVE_SECONDS=5;

export function startMinutesTiming(now:number):MinutesTiming {
 return {phase:'preparing',total:0,completed:0,reused:0,remainingUnits:0,activeUnits:0,
  activeElapsedMs:0,activeSince:null,sampledMs:0,sampledUnits:0,estimateSeconds:null,updatedAt:now};
}

export function remainingMinutesSeconds(timing:MinutesTiming,now:number):number|null {
 if(timing.estimateSeconds===null)return null;
 const elapsed=timing.phase==='waiting'?0:Math.max(0,now-timing.updatedAt)/1000;
 const remaining=timing.estimateSeconds-elapsed;
 return remaining>0?Math.ceil(remaining):null;
}

export function updateMinutesTiming(timing:MinutesTiming,event:MinutesWorkEvent,now:number):MinutesTiming {
 const rate=timing.sampledUnits>0?timing.sampledMs/1000/timing.sampledUnits:INITIAL_SECONDS_PER_UNIT;
 const activeElapsed=timing.activeElapsedMs+(timing.activeSince===null?0:Math.max(0,now-timing.activeSince));
 switch(event.kind){
  case 'plan':return {...timing,phase:'processing',total:event.total,reused:event.reused,remainingUnits:event.pendingUnits,
   estimateSeconds:event.pendingUnits*rate+FINAL_SAVE_SECONDS,updatedAt:now};
  case 'batch-start':return {...timing,phase:'processing',activeUnits:event.units,activeElapsedMs:0,activeSince:now};
  case 'waiting':return {...timing,phase:'waiting',activeElapsedMs:activeElapsed,activeSince:null,
   estimateSeconds:remainingMinutesSeconds(timing,now),updatedAt:now};
  case 'generating':return {...timing,phase:'processing',activeSince:timing.activeSince??now,updatedAt:now,
   estimateSeconds:remainingMinutesSeconds(timing,now)??timing.remainingUnits*rate+FINAL_SAVE_SECONDS};
  case 'retry':return {...timing,estimateSeconds:(remainingMinutesSeconds(timing,now)??FINAL_SAVE_SECONDS)+timing.activeUnits*rate,updatedAt:now};
  case 'batch-done':{
   const sampledMs=timing.sampledMs+(event.cached?0:activeElapsed);
   const sampledUnits=timing.sampledUnits+(event.cached?0:timing.activeUnits);
   const remainingUnits=Math.max(0,timing.remainingUnits-(event.cached?0:timing.activeUnits));
   const measuredRate=sampledUnits>0?Math.max(1,sampledMs/1000/sampledUnits):rate;
   return {...timing,phase:'processing',completed:timing.completed+1,remainingUnits,sampledMs,sampledUnits,
    activeUnits:0,activeSince:null,activeElapsedMs:0,estimateSeconds:remainingUnits*measuredRate+FINAL_SAVE_SECONDS,updatedAt:now};
  }
  case 'saving':return {...timing,phase:'saving',activeUnits:0,activeSince:null,estimateSeconds:FINAL_SAVE_SECONDS,updatedAt:now};
 }
}
