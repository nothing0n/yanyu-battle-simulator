/** Literal native JHShake::update port from captured ARM64 73460.
 * Native progress accumulates EACH update argument and alternates offset/base.
 * Sampling therefore replays an explicit 60 Hz Cocos reference update schedule,
 * rather than claiming frame-rate-independent native output. */
const f=Math.fround;
export const nativeShakeSource={referenceFps:60};
export const originalShakeParameters={shake:{duration:2,amplitudeX:20,amplitudeY:30},shake_small:{duration:.5,amplitudeX:10,amplitudeY:15}};
export function createOriginalShake({duration,amplitudeX,amplitudeY,baseX=0,baseY=0}){
 duration=f(duration);amplitudeX=f(amplitudeX);amplitudeY=f(amplitudeY);baseX=f(baseX);baseY=f(baseY);
 let elapsed=f(0),on=true,stopped=false,x=baseX,y=baseY;
 return{
  update(input){
   if(stopped)return{x,y,stopped,elapsed};
   elapsed=f(elapsed+f(input));const q=f(elapsed/duration);
   if(q>=1){stopped=true;x=baseX;y=baseY;return{x,y,stopped,elapsed};}
   if(on){
    const angle=f(elapsed*3.14*5),remain=f(1-q);
    x=f(baseX+f(remain*f(amplitudeX*Math.cos(angle))));
    y=f(baseY+f(remain*f(amplitudeY*Math.sin(angle))));
   }else{x=baseX;y=baseY;}
   on=!on;return{x,y,stopped,elapsed};
  },
  stop(){stopped=true;x=baseX;y=baseY;return{x,y,stopped,elapsed};}
 };
}
export function sampleOriginalShake(kind,timeMs,{fps=60,baseX=0,baseY=0}={}){
 const config=originalShakeParameters[kind];if(!config)throw Error('Unsupported native JHShake preset '+kind);
 if(!Number.isFinite(fps)||fps<=0)throw Error('Invalid reference update rate');
 const action=createOriginalShake({...config,baseX,baseY});
 const ticks=Math.max(0,Math.floor(timeMs*fps/1000));
 let state=action.update(0),elapsed=f(0),dt=f(1/fps);
 for(let tick=1;tick<=ticks&&!state.stopped;tick++){
  elapsed=f(elapsed+dt);
  const progress=Math.max(0,Math.min(1,f(elapsed/f(config.duration))));
  const eased=f(Math.sin(progress*Math.PI/2));
  state=action.update(eased);
 }
 return{...state,referenceFps:fps,source:nativeShakeSource};
}
