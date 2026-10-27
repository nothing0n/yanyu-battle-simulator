import {LuaVM} from '../runtime/lua-vm.mjs';

/** Original Camera event handlers and updateFocus, executed with explicit geometry.
 * World-center translation only changes coordinates, never source camera formulas. */
export async function createCameraController({readJSON,worldWidth,worldHeight,viewportWidth,viewportHeight,battleHeight,worldCenterX=worldWidth/2,moreScale=1,portrait=false}={}){
 for(const[k,v]of Object.entries({worldWidth,worldHeight,viewportWidth,viewportHeight,battleHeight}))if(!Number.isFinite(v)||v<=0)throw Error('Camera requires '+k);
 const read=readJSON||(async url=>{const r=await fetch(url);if(!r.ok)throw Error('Cannot load '+url);return r.json();});
 const bundle=await read(new URL('./bundles/JHBattleCamera.json',import.meta.url)),vm=new LuaVM();
 vm.load(bundle,'presentation/JHBattleCamera');
 vm.globals.cc={p:(x,y)=>vm.table({x,y})};vm.globals.JH_SCENE_WIDTH=viewportWidth;
 vm.globals.JH_BATTLE_HEIGHT=battleHeight;vm.globals.JH_PORTRAIT=portrait;
 const shiftX=worldCenterX-worldWidth/2,method=name=>vm.closure(bundle.prototypes[bundle.methods[name]]);
 let self,scale=moreScale,position={x:(viewportWidth-worldWidth*moreScale)/2,y:0};
 function reset(){
  scale=moreScale;position={x:(viewportWidth-worldWidth*moreScale)/2,y:0};
  self={m_nMoreScale:moreScale,m_fNowScale:1,m_fToScale:1,m_fScaleSpeed:0,
   m_pBaseFocus:vm.table({x:worldWidth/2,y:battleHeight/2}),
   m_pNowFocus:vm.table({x:worldWidth/2,y:battleHeight/2}),
   m_pToFocus:vm.table({x:worldWidth/2,y:battleHeight/2}),
   m_Dir:vm.table({x:0,y:0}),m_fFocusSpeed:vm.table({x:0,y:0}),
   m_bStartFocus:false,m_tFocusRols:vm.table([]),m_bBluring:false,
   AdaptSize:{width:viewportWidth,height:viewportHeight},
   getScale:()=>scale,setScale:(_,v)=>{scale=v;},getContentSize:()=>({width:worldWidth,height:worldHeight}),
   setPosition:(_,x,y)=>{position={x,y};},m_MaskNode:{updatePos:()=>{}},
   setCameraScale:method('setCameraScale'),setToScale:method('setToScale'),setToFocus:method('setToFocus')
  };
  return snapshot();
 }
 function snapshot(){
  const point=k=>({x:vm.get(self[k],'x')+shiftX,y:vm.get(self[k],'y')});
  return{scale,position:{...position},focus:point('m_pNowFocus'),targetFocus:point('m_pToFocus'),targetScale:self.m_fToScale,
   effectiveCenter:{x:(viewportWidth/2-position.x)/scale+shiftX,y:(viewportHeight/2-position.y)/scale},
   following:!!self.m_bStartFocus,source:{module:'JHBattleCamera',updatePrototype:bundle.methods.updateFocus}};
 }
 function event(name,msg){
  const id=name==='BattleCameraScale'?'root/136/14':name==='BattleCameraFocus'?'root/136/12':null;
  if(!id)throw Error('Unsupported original camera event '+name);
  vm.call(vm.closure(bundle.prototypes[id],[self]),[vm.table({msg})]);return snapshot();
 }
 function setRoles(roles=[]){self.m_tFocusRols=vm.table(roles.map(p=>({getPositionX:()=>p.x-shiftX,getPositionY:()=>p.y})));}
 function step(dt=1/60){vm.call(method('updateFocus'),[self,dt]);return snapshot();}
 function buildTrack({events=[],durationMs,fps=60,rolesAt}={}){
  if(!Number.isFinite(durationMs)||durationMs<0||!Number.isFinite(fps)||fps<=0)throw Error('Invalid camera track duration/rate');
  reset();let index=0;const ordered=[...events].sort((a,b)=>a.atMs-b.atMs),frames=[];
  for(let tick=0;tick<=Math.ceil(durationMs*fps/1000);tick++){
   const atMs=tick*1000/fps;
   while(index<ordered.length&&ordered[index].atMs<=atMs){const e=ordered[index++];event(e.name,e.msg);}
   if(rolesAt)setRoles(rolesAt(atMs));
   frames.push({atMs,...(tick?step(1/fps):snapshot())});
  }
  return{referenceFps:fps,frames,sample(timeMs){return frames[Math.min(frames.length-1,Math.max(0,Math.floor(timeMs*fps/1000)))];}};
 }
 reset();return{event,setRoles,step,snapshot,reset,buildTrack,source:bundle.source};
}