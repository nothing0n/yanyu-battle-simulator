import {createPose} from './spine-pose.mjs';
/** AnimationState's native zero-mix behavior preserves properties not keyed by
 * the next clip. Precomputed transition poses also make backward seeks stable. */
export function buildPoseTrack(data,input,appearance){
 const events=input.filter(e=>e.animation&&data.animations[e.animation]).map((e,i)=>({...e,serial:i})).sort((a,b)=>a.atMs-b.atMs||a.serial-b.serial),pending=[];let generation=0;
 for(const e of events){const g=++generation,duration=e.durationMs??(data.animations[e.animation].duration-(e.beginFrame||0)/30)/(e.timeScale||1)*1000;pending.push({...e,generation:g,durationMs:duration});if(!e.loop&&!e.hold&&e.idle&&Number.isFinite(duration))pending.push({atMs:e.atMs+Math.max(0,duration),animation:e.idle,loop:true,beginFrame:0,timeScale:1,idleFor:g,serial:e.serial+.5});}
 pending.sort((a,b)=>a.atMs-b.atMs||a.serial-b.serial);const clips=[];
 for(const e of pending){const last=clips.at(-1);if(e.idleFor&&last?.generation!==e.idleFor)continue;let basePose=null;if(last){const sample=clipSample(last,e.atMs);basePose=createPose(data,last.animation,sample.time,{loop:sample.loop,appearance,basePose:last.basePose});}clips.push({...e,basePose});}
 function current(timeMs){let low=0,high=clips.length-1;if(high<0)return null;while(low<high){const middle=Math.ceil((low+high)/2);if(clips[middle].atMs<=timeMs)low=middle;else high=middle-1;}return clips[low];}
 return {clips,current,sample(timeMs){const c=current(timeMs);if(!c)return createPose(data,null,0,{appearance});const sample=clipSample(c,timeMs);return createPose(data,c.animation,sample.time,{loop:sample.loop,appearance,basePose:c.basePose});}};
}
export function createAnimationClock(cues){const pauses=[];let start=null;for(const c of cues){if(c.type==='pauseAnimation'&&start==null)start=c.atMs;if(c.type==='resumeAnimation'&&start!=null){pauses.push([start,c.atMs]);start=null;}}if(start!=null)pauses.push([start,Infinity]);return{pauses,time(ms){let out=ms;for(const[a,b]of pauses){if(ms<=a)break;out-=Math.max(0,Math.min(ms,b)-a);}return out;},real(time){let out=time;for(const[a,b]of pauses){if(out<=a)break;out+=b-a;}return out;},elapsed(start,end){let out=end-start;for(const[a,b]of pauses)if(a>=start)out-=Math.max(0,Math.min(end,b)-a);return Math.max(0,out);}};}

function clipSample(clip,timeMs){const start=(clip.beginFrame||0)/30,elapsed=Math.max(0,(timeMs-clip.atMs)/1000*(clip.timeScale||1));if(clip.endFrame!=null){const length=Math.max(0,clip.endFrame/30-start);return{time:start+(clip.loop&&length?elapsed%length:Math.min(elapsed,length)),loop:false};}return{time:start+elapsed,loop:clip.loop};}
