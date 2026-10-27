import {LuaTable} from '../runtime/lua-vm.mjs';
import {luaToJSON} from '../engine/battle-runner.mjs';

/** Execute the original impact callback against explicit presentation sinks.
 * Model numbers come from the already-resolved battle state. Unknown calls
 * still fail in the VM; this bridge never calculates damage or substitutes flags. */
export function captureImpactCalls(vm,fn,{actorData={},attackerData={}}={}){
 if(!['root/64/14','root/64/5','root/64/6'].includes(fn.proto.id))throw Error('Unsupported original impact callback '+fn.proto.id);
 const success=fn.proto.id==='root/64/14',actorIndex=success?0:fn.proto.id==='root/64/6'?2:1,calls=[],events=[],callbacks={};
 const data=(v)=>v instanceof LuaTable?luaToJSON(v):v;
 function makeActor(input){
  const owner=input.owner||{},point=input.point||{x:0,y:0};
  let hp=input.hp??input.maxHp,mp=input.mp??0,state=input.state??-1;
  function required(value,name){if(value==null)throw Error('Impact host requires '+name);return value;}
  const model={
   getBattleHp:()=>required(hp,'actorData.hp'),getBattleHpMax:()=>required(input.maxHp,'actorData.maxHp'),
   getBattleMp:()=>mp,getBattleMpMax:()=>required(input.maxMp,'actorData.maxMp'),
   getLeft:()=>required(owner.left,'owner.left'),getStand:()=>required(owner.Stand,'owner.Stand'),
   getBattleStage:()=>required(owner.BattleStage,'owner.BattleStage'),getIsDie:()=>hp<=0,
   getDute:()=>owner.Dute??null,setBattleHp:(_,v)=>{hp=v;},setBattleMp:(_,v)=>{mp=v;}
  };
  const actor={Model:model,m_nState:state,m_bIsFlipX:!owner.left,m_pBasePosition:vm.table(input.basePoint||point),m_fSpeedY:input.speedY??0,m_fSpeedX:input.speedX??0};
  for(const method of ['addHp','addMp','addNJHp','playMiss','playMissPo'])actor[method]=(_, ...args)=>calls.push({method,args:args.map(data)});
  for(const method of ['playMissAnimation','playParryAnimation','toast','updateBuffs','playHitEffect','playHitSound','playParrySound','addZSName','playSpineEffectFull','setDun','playAnimationByExcel','playHitedByExcel','tryDie','playBattleIdle','stopGravity','startGravity','setPauseGravity','setSpeedX','setSpeedY','setGravity','setTimeScale','setTopHighFunc','setLandFunc'])actor[method]=(_, ...args)=>events.push({method,args:args.map(x=>typeof x==='object'&&!(x instanceof LuaTable)?x?.proto?{callback:x.proto.id}:null:data(x))});
  actor.setLandFunc=(_,fn)=>{callbacks.land=fn;events.push({method:'setLandFunc',args:[{callback:fn?.proto?.id}]});};
  actor.setTopHighFunc=(_,fn)=>{callbacks.top=fn;events.push({method:'setTopHighFunc',args:[{callback:fn?.proto?.id}]});};
  actor.setHp=(_,v)=>{hp=v;events.push({method:'setHp',args:[v]});};
  actor.setMp=(_,v)=>{mp=v;events.push({method:'setMp',args:[v]});};
  actor.setState=(_,v)=>{state=v;actor.m_nState=v;events.push({method:'setState',args:[v]});};
  actor.getPositionX=()=>point.x;actor.getPositionY=()=>point.y;
  return actor;
 }
 const actor=makeActor(actorData),previousCC=vm.globals.cc;
 const upvalues=fn.upvalues.map((cell,i)=>i===actorIndex?actor:{__cell:true,value:cell.value});
 // The JHEvent table is the only module replaced: dispatch is a recording sink.
 if(success)upvalues[14]=vm.table({Main:{dispatchEvent:(_,event)=>events.push({method:'dispatchEvent',event:data(event)})},BattleUpdateHpMp:'BattleUpdateHpMp'});
 vm.globals.cc={...(previousCC||{}),c3b:(r,g,b)=>({r,g,b})};
 try{
  vm.call(vm.closure(fn.proto,upvalues),[]);
  const result={floatingCalls:calls,events,finalState:actor.m_nState,source:{method:'hurtZhaoShi callback',prototype:fn.proto.id}};
  Object.defineProperty(result,'runtimeCapture',{value:{actor,vm,callbacks,events},enumerable:false});
  return result;
 }finally{vm.globals.cc=previousCC;}
}