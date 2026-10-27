import {createRuntime} from '../engine/runtime.mjs';
import {firstResult} from '../runtime/lua-vm.mjs';

/** Resolve reaction names by executing original JHBaseRole methods.
 * This is a separate presentation runtime/RNG; it never mutates battle results. */
export async function createReactionResolver(options={}){
 const read=options.readJSON||(async url=>{const r=await fetch(url);if(!r.ok)throw Error('Cannot load '+url);return r.json();});
 const runtime=options.runtime||await createRuntime({...options,readJSON:read,seed:options.visualSeed??1}),{vm}=runtime;
 runtime.require('app/ai/JHAIConfig');
 const [bundle,kidFrames]=await Promise.all([read(new URL('./bundles/JHBaseRole.json',import.meta.url)),read(new URL('./kid-frames.json',import.meta.url))]);
 vm.load(bundle,'presentation/JHBaseRole');
 const dot=runtime.require('app/excelutils/JHAtkDotUtils');
 const cls=vm.table({CommonAnimaiton:600});
 const closure=(name,uv=[])=>vm.closure(bundle.prototypes[bundle.methods[name]],uv);
 const byExcel=closure('playAnimationByExcel',[cls,dot]);
 const methods={parry:closure('playParryAnimation',[vm.table(kidFrames),dot]),miss:closure('playMissAnimation'),hurt:closure('playHitedByExcel'),die:closure('playDie'),idle:closure('playBattleIdle')};
 let calls=[];
 vm.globals.JHPlayEffect=name=>calls.push({method:'sound',name});
 function resolveReactionAnimation(data={},kind='hurt'){
  if(kind==='dodge')kind='miss';
  const fn=methods[kind];if(!fn)throw Error('Unknown original reaction '+kind);
  calls=[];
  const stage=data.stage??data.battleStage??data.BattleStage??1,job=data.job??data.Job??1,dute=data.dute??data.Dute??null;
  const speed=data.timeSpeed??vm.globals.JH_TIME_SPEED;
  const previous=vm.globals.JH_TIME_SPEED;vm.globals.JH_TIME_SPEED=speed;
  let timeScale=1/speed,animation=null,state=vm.get(vm.globals.JH_BATTLE_STATE,'Normal');
  const model={getBattleStage:()=>stage,getBattleJob:()=>job,getDute:()=>dute,getBattleHited:()=>data.battleHited??data.BattleHited??1,getBattleIdle:()=>data.idle??data.BattleIdle??1,getID:()=>data.id??data.ID??0,getLeft:()=>data.left??true,getIsDie:()=>!!data.dead,m_bDieRemove:false};
  const actor={
   Model:model,m_bIsBlue:!!data.isBlue,m_bIsSkillBlue:!!data.isSkillBlue,m_SpBlueColor:data.spBlueColor??0,
   m_nWaitRound:data.waitRound??0,m_bIsDrop:!!data.weaponDropped,m_bIsBattleIdle:false,m_tRewartd:vm.table([]),
   getState:()=>state,setState:(_,next)=>{state=next;},isHaveBuff:(_,id)=>(data.buffIds||[]).includes(id),
   setTimeScale:(_,value)=>{timeScale=value;calls.push({method:'setTimeScale',value});},
   playAnimation:(_,name,loop=false)=>{animation={animationName:name,loop};calls.push({method:'playAnimation',...animation});},
   addAnimation:(_,name,loop=false)=>{animation={animationName:name,loop,queued:true};calls.push({method:'addAnimation',...animation});},
   playAnimationFromTo:(_,beginFrame,endFrame,name,loop=false)=>{animation={animationName:name,loop,beginFrame,endFrame};calls.push({method:'playAnimationFromTo',...animation});},
   playSpineEffectFull:(_,name,...args)=>calls.push({method:'spineEffect',name,args}),
   setHitRed:()=>calls.push({method:'hitRed'}),setHitBlue:()=>calls.push({method:'hitBlue'}),
   stopMoveAcion:()=>calls.push({method:'stopMove'}),stopZhaoShiAcion:()=>calls.push({method:'stopAction'}),
   dieRemove:()=>calls.push({method:'dieRemove'}),playSoul:()=>calls.push({method:'soul'}),
   RootNode:{runAction:(_,action)=>calls.push({method:'rootAction',action})},
   playAnimationByExcel:byExcel
  };
  vm.globals.jh={JHShake:{create:(_,...args)=>({type:'shake',args})}};
  try{
   if(kind==='hurt')vm.call(fn,[actor,false,data.autoLine??null]);else vm.call(fn,[actor,false]);
   return{...(animation||{}),timeScale,calls:[...calls],source:{module:'JHBaseRole',method:({parry:'playParryAnimation',miss:'playMissAnimation',hurt:'playHitedByExcel',die:'playDie',idle:'playBattleIdle'})[kind],prototype:fn.proto.id},playedAnimation:!!animation};
  }finally{vm.globals.JH_TIME_SPEED=previous;}
 }
 function planMoveAnimations(data={},moveKind=1,durationSeconds=.5,returnIdle=false){
  const fn=closure('playMove',[vm.table(kidFrames),vm.table({MoveAnimation:700})]),previousCC=vm.globals.cc,previousSpeed=vm.globals.JH_TIME_SPEED;
  const graph=[],events=[];let atMs=0;
  const actor={
   Model:{getDute:()=>data.dute??data.Dute??null,getBattleStage:()=>data.stage??data.battleStage??data.BattleStage??1},
   runAction:(_,action)=>graph.push(action),
   setTimeScale:(_,value)=>events.push({atMs,method:'setTimeScale',value}),
   playAnimation:(_,animationName,loop=false)=>events.push({atMs,method:'playAnimation',animationName,loop}),
   playBattleIdle:()=>events.push({atMs,method:'playBattleIdle'})
  };
  vm.globals.JH_TIME_SPEED=data.timeSpeed??previousSpeed;
  vm.globals.cc={
   CallFunc:{create:(_,fn)=>({kind:'call',fn})},
   DelayTime:{create:(_,seconds)=>({kind:'delay',seconds})},
   Sequence:{create:(_,actions)=>({kind:'sequence',actions,setTag:()=>{}})}
  };
  function walk(action){
   if(action.kind==='delay'){atMs+=action.seconds*1000;return;}
   if(action.kind==='call'){vm.call(action.fn,[]);return;}
   if(action.kind==='sequence'){for(const[,a]of action.actions.entries)walk(a);return;}
   throw Error('Unsupported move animation graph '+action.kind);
  }
  try{
   vm.call(fn,[actor,moveKind,durationSeconds,returnIdle]);
   for(const action of graph)walk(action);
   return{events,durationMs:atMs,source:{module:'JHBaseRole',method:'playMove',prototype:fn.proto.id}};
  }finally{vm.globals.cc=previousCC;vm.globals.JH_TIME_SPEED=previousSpeed;}
 }
 return{resolveReactionAnimation,planMoveAnimations,runtime};
}
