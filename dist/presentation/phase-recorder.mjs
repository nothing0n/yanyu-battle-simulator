import {LuaTable,firstResult} from '../runtime/lua-vm.mjs';
import {luaToJSON} from '../engine/battle-runner.mjs';
/** Execute the original phase callback after its separately-recorded movement block.
 * All remaining relative branches retain their original bytecode offsets. */
export function createPhaseRecorder(runtime,bundle){
 const {vm}=runtime,list=x=>Array.isArray(x)?x:Object.values(x||{}),mod=n=>runtime.require('app/excelutils/'+n);
 function recordPhase(fn,actorData,targetsData){
  const previousCC=vm.globals.cc,previousSound=vm.globals.JHPlayEffect;
  const events=[],graphs=[],diagnostics=[];let atMs=0;
  const emit=(method,args=[])=>events.push({offsetMs:atMs,method,args:args.map(x=>luaToJSON(x))});
  const eventBus={Main:{dispatchEvent:(_self,event)=>emit('event',[event])},BattleUpdateHpMp:'BattleUpdateHpMp',BattleCameraFocus:'BattleCameraFocus',BattleSceneEffect:'BattleSceneEffect',BattleCameraScale:'BattleCameraScale'};
  const scene=vm.closure(bundle.prototypes['root/4'],[eventBus]),lastAttack=vm.closure(bundle.prototypes[bundle.methods.playLastAttack],[eventBus]);
  vm.globals.JHPlayEffect=name=>emit('sound',[name]);
  const tagged=(kind,extra={})=>({kind,...extra,setTag:()=>{}});
  vm.globals.cc={CallFunc:{create:(_,fn)=>tagged('call',{fn})},DelayTime:{create:(_,seconds)=>tagged('delay',{seconds})},Sequence:{create:(_,...actions)=>tagged('sequence',{actions:actions.length===1&&actions[0] instanceof LuaTable?actions[0]:new LuaTable(actions.map((x,i)=>[i+1,x]))})},Director:{getInstance:()=>({getScheduler:()=>({setTimeScale:(_,value)=>emit('schedulerScale',[value])})})},c3b:(r,g,b)=>vm.table({r,g,b})};
  function makeRole(data){
   const owner=data.owner||{},active=list(owner.Taolus).find(x=>x.Active),cfg=active&&vm.get(runtime.configFor('kongfu_tl_data'),String(active.ID));let hp=data.hp??data.maxHp,mp=data.mp??0;
   const role={Model:{getLeft:()=>owner.left,getStand:()=>owner.Stand,getBattleHp:()=>hp,getBattleHpMax:()=>data.maxHp,getBattleMp:()=>mp,getActiveTaolu:()=>cfg?{getNormalEffect:()=>vm.get(cfg,'eff_natk'),getNormalEffectCond:()=>vm.get(cfg,'eff_cond'),getType:()=>vm.get(cfg,'type')}:null,getEquipByID:(_,id)=>list(owner.Equips).find(x=>x.ID===id)},m_nMoreWidth:data.moreWidth??0};
   role.m_tEffects=vm.table([]);role.RootNode={pause:()=>emit('pauseAnimation'),resume:()=>emit('resumeAnimation')};
   role.runAction=(_,graph)=>{graphs.push({graph,atMs});return graph;};
   role.setHp=(_,value,...extra)=>{hp=value;emit('setHp',[value,...extra]);};role.setMp=(_,value,...extra)=>{mp=value;emit('setMp',[value,...extra]);};
   role.isHaveBuff=(_,id)=>list(actorData.buffs).some(x=>x.id===id);
   for(const method of ['playLastAttack','addHp','addMp','addNJHp','setDun','playBattleIdle','clearTracks','setTimeScale','playAnimationByExcel','updateBuffs','setPauseGravity','toast','playSpineEffectFull','goBlueState','backBlueState'])role[method]=(_,...args)=>emit(method,args);
   role.playLastAttack=(_,target)=>vm.call(lastAttack,[role,target]);
   role.playSceneEffect=(_,cfg,index,targets)=>vm.call(scene,[role,cfg,index,targets]);
   role.playAttackEffect=(_,anqiID,name,variant,timeScale,targets,placement,deltaMp,deltaHp,sourceHp,skillID,lane,attackType)=>events.push({offsetMs:atMs,method:'attackEffect',args:[],effect:{anqiID,name,variant,timeScale,placement,deltaMp,deltaHp,sourceHp,skillID,lane,attackType,targetIds:[...targets.entries.values()].map(x=>vm.get(x,'battleId'))}});
   role.battleId=data.battleId;return role;
  }
  const actor=makeRole(actorData),targets=targetsData.map(makeRole),cells=fn.upvalues.map(c=>c); // Original shared accumulators connect successive phase callbacks.
  cells[3]=actor;cells[4]=vm.table(targets);cells[35]=mod('JHBuffUtils');cells[37]=mod('JHSkillUtils');cells[38]=eventBus;
  const p={...fn.proto,id:fn.proto.id+':after-movement',code:fn.proto.code.slice(287)};Object.defineProperty(p,'_bundle',{value:fn.proto._bundle});
  function walk(graph,time){atMs=time;if(graph.kind==='delay')return time+graph.seconds*1000;if(graph.kind==='call'){vm.call(graph.fn,[]);return time;}if(graph.kind==='sequence'){for(const[,item]of graph.actions.entries)time=walk(item,time);return time;}throw Error('Unsupported phase graph '+graph.kind);}
  try{vm.call(vm.closure(p,cells),[]);for(let i=0;i<graphs.length;i++){if(i>100)throw Error('Phase callback queue exceeded bound');walk(graphs[i].graph,graphs[i].atMs);}return{events,diagnostics};}
  finally{vm.globals.cc=previousCC;vm.globals.JHPlayEffect=previousSound;}
 }
 return{recordPhase};
}
