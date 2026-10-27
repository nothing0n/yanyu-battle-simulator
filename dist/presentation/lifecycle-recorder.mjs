import {LuaTable} from '../runtime/lua-vm.mjs';
import {luaToJSON} from '../engine/battle-runner.mjs';
/** Finish/cancel callbacks and recovery use the original state branches. */
export function createLifecycleRecorder(runtime,bundle,pointFor){
 const{vm}=runtime,original=name=>vm.closure(bundle.prototypes[bundle.methods[name]]),hurtIdle=original('hurtToIdle'),tryDie=original('tryDie');
 const cls=vm.table({AttackAction:800,CommonAnimaiton:801}),roundBuff=vm.closure(bundle.prototypes[bundle.methods.roundBuff],[cls]),hited=original('playHitedByExcel'),byExcel=vm.closure(bundle.prototypes[bundle.methods.playAnimationByExcel],[cls,runtime.require('app/excelutils/JHAtkDotUtils')]);
 function recordLifecycle(fn,oldActor,data,args=[]){
  const events=[],graphs=[],previousCC=vm.globals.cc;let atMs=0,state=data.state??-1,hp=data.hp,isDie=data.hp<=0;
  const emit=(method,...args)=>events.push({offsetMs:atMs,method,args:args.map(x=>luaToJSON(x))});
  const base=pointFor(data.owner),point={...(data.point||base)},actor={m_nState:state,m_tEffects:vm.table([]),Model:{getIsDie:()=>isDie,getStroyRemove:()=>!!data.owner.StroyRemove,setIsDie:(_,v)=>{isDie=v;},setBattleMp:()=>{},getBattleHited:()=>data.owner.BattleHited??1,getBattleStage:()=>data.owner.BattleStage??1},getPositionX:()=>point.x,getPositionY:()=>point.y,getBasePosition:()=>vm.table(base)};
  for(const method of ['addHp','addMp','setUpdateBuffs','setDun','playSpineEffectFull','setHitRed','setHitBlue','updateShadow','playBattleIdle','playDie','dieRemove','playHappy','playAttackOver','clearTracks','stopMoveAcion','stopGravity','updateDieHeight','playAnimationByExcel','setPauseGravity','setTimeScale','setOpacity','stopAllActionsByTag','backBlueState','playMissAnimation','playParryAnimation'])actor[method]=(_,...args)=>emit(method,...args);
  actor.setHp=(_,value)=>{hp=value;emit('setHp',value);};actor.setMp=(_,value)=>emit('setMp',value);actor.playHitedByExcel=hited;actor.playAnimationByExcel=byExcel;actor.playAnimationFromTo=(_,beginFrame,endFrame,name,loop)=>emit('playAnimationFromTo',beginFrame,endFrame,name,loop);
  actor.setPosition=(_,x,y)=>{const p=x instanceof LuaTable?{x:vm.get(x,'x'),y:vm.get(x,'y')}:{x,y};Object.assign(point,p);emit('setPosition',p);};
  actor.setState=(_,value)=>{state=value;actor.m_nState=value;};actor.hurtToIdle=()=>vm.call(hurtIdle,[actor]);actor.tryDie=()=>vm.call(tryDie,[actor]);actor.fenRole=()=>emit('unsupported','split-body recovery');
  actor.RootNode={pause:()=>emit('pauseAnimation'),resume:()=>emit('resumeAnimation')};actor.runAction=(_,graph)=>{graphs.push({graph,atMs});return graph;};
  const tagged=(kind,extra={})=>({kind,...extra,setTag:()=>{}});
  vm.globals.cc={CallFunc:{create:(_,fn)=>tagged('call',{fn})},DelayTime:{create:(_,seconds)=>tagged('delay',{seconds})},Sequence:{create:(_,...actions)=>tagged('sequence',{actions:actions.length===1&&actions[0] instanceof LuaTable?actions[0]:new LuaTable(actions.map((x,i)=>[i+1,x]))})}};
  const cells=fn.upvalues.map(cell=>cell.value===oldActor?actor:{__cell:true,value:cell.value});
  function walk(graph,time){atMs=time;if(graph.kind==='delay')return time+graph.seconds*1000;if(graph.kind==='call'){vm.call(graph.fn,[]);return time;}if(graph.kind==='sequence'){for(const[,item]of graph.actions.entries)time=walk(item,time);return time;}throw Error('Unsupported lifecycle graph '+graph.kind);}
  try{vm.call(vm.closure(fn.proto,cells),args.length?[actor,...args]:[]);for(let i=0;i<graphs.length;i++){if(i>100)throw Error('Lifecycle queue exceeded bound');walk(graphs[i].graph,graphs[i].atMs);}return{events,state};}
  finally{vm.globals.cc=previousCC;}
 }
 return{recordLifecycle,recordRoundBuff:(data,row)=>recordLifecycle(roundBuff,null,data,[vm.table(row)])};
}
