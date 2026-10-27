/** Single replay clock. Its times come from original-frame presentation cues. */
export class PlaybackClock {
  constructor({onTime=()=>{},onPlaying=()=>{},requestFrame=cb=>requestAnimationFrame(cb),cancelFrame=id=>cancelAnimationFrame(id)}={}) {
    this.onTime=onTime;this.onPlaying=onPlaying;this.requestFrame=requestFrame;this.cancelFrame=cancelFrame;
    this.timeMs=0;this.durationMs=0;this.speed=1;this.playing=false;this.timeline=null;this.frameHandle=null;this.lastStamp=null;this.logTimes=[];this.steps=[];
  }
  setTimeline(timeline,logs=[]) {
    this.pause();this.timeline=timeline||null;this.timeMs=0;
    const cues=timeline?.cues||timeline?.events||[];
    this.durationMs=Math.max(0,Number(timeline?.durationMs)||0);
    if(!this.durationMs&&cues.length)this.durationMs=Math.max(0,...cues.map(c=>Math.max(0,Number(c.atMs)||0)+Math.max(0,Number(c.durationMs)||0)));
    const fps=Number(timeline?.logicFps)||15;
    this.logTimes=logs.map(()=>Infinity);
    for(const cue of cues) {
      const at=Number(cue.atMs);if(!Number.isFinite(at))continue;
      const indices=cue.logIndices|| (Number.isInteger(cue.logIndex)?[cue.logIndex]:[]);
      for(const index of indices)if(Number.isInteger(index)&&index>=0&&index<this.logTimes.length)this.logTimes[index]=Math.min(this.logTimes[index],at);
    }
    this.logTimes=this.logTimes.map((time,index)=>Number.isFinite(time)?time:Number.isFinite(logs[index].atMs)?logs[index].atMs:Number.isFinite(logs[index].frame)?logs[index].frame*1000/fps:Infinity);
    const supplied=Array.isArray(timeline?.steps)?timeline.steps:null;
    const candidates=supplied||cues.filter(c=>!['round','create','spawn','metadata'].includes(c.type));
    this.steps=[...new Set(candidates.map(c=>Number(typeof c==='number'?c:c.atMs)).filter(t=>Number.isFinite(t)&&t>0&&t<=this.durationMs))].sort((a,b)=>a-b);
    if(this.durationMs>0&&!this.steps.includes(this.durationMs))this.steps.push(this.durationMs);
    this.emit();
  }
  get visibleLogIndices() {
    if(this.timeline&&this.timeMs>=this.durationMs)return this.logTimes.map((_,i)=>i);
    return this.logTimes.flatMap((time,index)=>time<=this.timeMs?[index]:[]);
  }
  emit(){this.onTime({timeMs:this.timeMs,durationMs:this.durationMs,visibleLogIndices:this.visibleLogIndices,playing:this.playing});}
  seek(timeMs){this.timeMs=Math.max(0,Math.min(this.durationMs,Number(timeMs)||0));this.lastStamp=null;this.emit();if(this.timeMs>=this.durationMs&&this.playing)this.pause();}
  setSpeed(speed){const value=Number(speed);if(!Number.isFinite(value)||value<=0||value>8)throw new RangeError('Replay speed must be between 0 and 8');this.speed=value;}
  step(){this.pause();const next=this.steps.find(t=>t>this.timeMs+.01);this.seek(next??this.durationMs);}
  rewind(){this.pause();this.seek(0);}
  play(){
    if(this.playing||!this.timeline||this.durationMs<=0)return;
    if(this.timeMs>=this.durationMs)this.seek(0);
    this.playing=true;this.lastStamp=null;this.onPlaying(true);
    const tick=stamp=>{
      if(!this.playing)return;
      const delta=this.lastStamp==null?0:Math.max(0,stamp-this.lastStamp);
      this.lastStamp=stamp;this.timeMs=Math.min(this.durationMs,this.timeMs+delta*this.speed);this.emit();
      if(this.timeMs>=this.durationMs){this.pause();return;}
      this.frameHandle=this.requestFrame(tick);
    };
    this.frameHandle=this.requestFrame(tick);
  }
  pause(){if(this.frameHandle!=null)this.cancelFrame(this.frameHandle);this.frameHandle=null;this.lastStamp=null;const changed=this.playing;this.playing=false;if(changed)this.onPlaying(false);}
  reset(){this.setTimeline(null,[]);}
  dispose(){this.pause();this.timeline=null;this.logTimes=[];}
}
