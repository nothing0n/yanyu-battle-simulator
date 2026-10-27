import {createBuffPlanner} from './buff-planner.mjs';
import {createGravityPlanner} from './gravity-planner.mjs';
import {createImpactEffectPlanner} from './impact-effects.mjs';
import {createDimensionsResolver} from './dimensions.mjs';
import {createLifecycleRecorder} from './lifecycle-recorder.mjs';
import {createEffectPlanner} from './effect-planner.mjs';
import {createPhaseRecorder} from './phase-recorder.mjs';
import {captureImpactCalls} from './impact-planner.mjs';
import {createReactionResolver} from './reactions.mjs';
import {createMotionPlanner} from './motion-planner.mjs';
import {createRuntime} from '../engine/runtime.mjs';
import {LuaTable,firstResult} from '../runtime/lua-vm.mjs';
import {luaToJSON} from '../engine/battle-runner.mjs';
const array=value=>Array.isArray(value)?value:Object.values(value||{});
/** The original functions construct Cocos actions. This host records those actions;
 * it does not substitute an animation-duration or damage-distribution formula. */
export async function createPresentationPlanner(options={}){
  const runtime=await createRuntime(options),{vm}=runtime,read=options.readJSON||(async url=>{const response=await fetch(url);if(!response.ok)throw Error(`Cannot load presentation data: ${url}`);return response.json();});
  runtime.require('app/ai/JHAIConfig');
  const [bundle,kidFrames,rules,gravityBundle,otherBundle,assets,buffSpines]=await Promise.all([read(new URL('./bundles/JHBaseRole.json',import.meta.url)),read(new URL('./kid-frames.json',import.meta.url)),read(new URL('../data/presentation-rules.json',import.meta.url)),read(new URL('./bundles/JHBaseGravity.json',import.meta.url)),read(new URL('./bundles/JHOtherUtils.json',import.meta.url)),read(new URL('../data/presentation-assets.json',import.meta.url)),read(new URL('../data/buff-spine-metadata.json',import.meta.url))]);
  vm.load(bundle,'app/module/spine/JHBaseRole');
  const reactionResolver=await createReactionResolver({...options,runtime});
  const motion=createMotionPlanner(runtime,bundle,rules,reactionResolver);
  const impactEffects=createImpactEffectPlanner(vm,bundle),gravityPlanner=createGravityPlanner(vm,gravityBundle,{roleBundle:bundle});
  const dimensions=createDimensionsResolver(runtime,bundle,kidFrames);
  const buffPlanner=createBuffPlanner(runtime,bundle,{otherBundle,assets,spines:buffSpines,pointFor:motion.pointFor});
  const lifecycle=createLifecycleRecorder(runtime,bundle,motion.pointFor);
  const phaseRecorder=createPhaseRecorder(runtime,bundle),effects=createEffectPlanner(runtime,bundle,{pointFor:motion.pointFor,center:rules.formation.center});
  const mod=name=>runtime.require('app/excelutils/'+name),empty=vm.table({}),mods={action:mod('JHActionUtils'),wg:mod('JHWGUtils'),aq:mod('JHAnQiUtils'),zs:mod('JHTL_ZSUtils'),ai:runtime.require('app/ai/JHAIUtils'),dot:mod('JHAtkDotUtils')};
  let graphs=[];
  vm.globals.cc={CallFunc:{create:(_,fn)=>({kind:'call',fn})},DelayTime:{create:(_,seconds)=>({kind:'delay',seconds})},Sequence:{create:(_,actions)=>({kind:'sequence',actions,setTag:()=>{}})}};
  vm.globals.JHToast=message=>{throw Error(String(message));};vm.globals.JHError=message=>{throw Error(String(message));};
  const attack=vm.closure(bundle.prototypes['root/36'],[mods.action,mods.wg,mods.aq,mods.zs,mods.ai,mods.dot,empty,empty,empty,empty]);
  const hurt=vm.closure(bundle.prototypes['root/64'],[mods.action,mods.wg,mods.zs,mod('JHTLUtils'),mods.aq,mods.dot,mod('JHSkillUtils'),mod('JHBuffUtils'),empty,vm.table(kidFrames),empty]);
  const call=(module,name,...args)=>firstResult(vm.call(vm.get(module,name),args));
  const nilTable=value=>vm.table(value??{}),noop=()=>{};
  function makeRole(data={}){
    const owner=data.owner||{},point=data.point||{x:0,y:0},pos=()=>vm.table(point);
    return {m_nState:data.state??-1,m_nMoreWidth:data.moreWidth??0,Model:{getStand:()=>owner.Stand||1,getBattleHp:()=>data.hp??data.maxHp??18000,getBattleMp:()=>data.mp??0},getBasePosition:pos,getHurtPosition:pos,setState:noop,setLandY:noop,stopMoveAcion:noop,stopZhaoShiAcion:noop,setPauseGravity:noop,startGravity:noop,flyZSEffect:noop,flyAQEffect:noop,playSceneEffectFull:noop,addZSName:noop,tooFatRole:()=>!!owner.TooFat,playBattleIdle:noop,runAction:(_,graph)=>{graphs.push(graph);return graph;},HurtAction:800};
  }
  function flatten(graph,time=0,out=[]){
    if(graph.kind==='delay'){if(!Number.isFinite(graph.seconds)||graph.seconds<0)throw Error('Invalid original DelayTime');return time+graph.seconds;}
    if(graph.kind==='call'){out.push({offsetMs:time*1000,fn:graph.fn});return time;}
    if(graph.kind==='sequence'){for(const[,action]of graph.actions.entries)time=flatten(action,time,out);return time;}
    throw Error('Unsupported original action graph node');
  }
  function run(fn,args){graphs=[];vm.call(fn,args);const calls=[];let durationMs=0;for(const graph of graphs)durationMs=Math.max(durationMs,flatten(graph,0,calls)*1000);return{calls,durationMs};}
  const nonAnimation=new Set(['wait','effect','effectfen','effectmore','effectcenter','effectsj','changexx']);
  function phaseName(act){const name=vm.get(act,1);return nonAnimation.has(name)?null:call(mods.dot,'getAniByName',name);}
  function normalEffect(owner,id,variant,buffs){
    if(variant!==100||!call(mods.zs,'isNormalAttack',id))return variant;
    const active=array(owner.Taolus).find(x=>x.Active),cfg=active&&vm.get(runtime.configFor('kongfu_tl_data'),String(active.ID));
    if(!cfg||vm.get(cfg,'type')!==call(mods.zs,'isNormalType',id)||!vm.get(cfg,'eff_natk'))return variant;
    const condition=luaToJSON(vm.get(cfg,'eff_cond'));
    if(condition){const rows=Array.isArray(condition[0])?condition:[condition];if(!rows.some(row=>row[0]==='equip'?array(owner.Equips).some(x=>x.ID===row[1]):row[0]==='buff'?array(buffs).some(x=>x.id===row[1]):false))return variant;}
    return vm.get(cfg,'eff_natk');
  }
  function planSkill(message,actorData,targetsData){
    const source=message.attack||{},rows=message.hurt?[message.hurt]:array(message.hurts),id=message.id,actor=makeRole(actorData),targets=rows.map((row,i)=>makeRole(targetsData[i]));
    if(!id)throw Error('Original skill message has no ID');
    const cfg=call(mods.wg,'getAniById',id);if(!cfg)return{durationMs:0,phases:[],hits:[],reactions:[],diagnostics:['Original skill has no kongfu_action animation']};
    const range=call(mods.wg,'getZSRange',id),changeTarget=call(mods.zs,'isChangeRoleRange',range>10000?Math.floor(range/10000):range);
    if(changeTarget)throw Error(`Original alternating-target animation ${id} requires hurtZhaoShiTemp scheduling`);
    const counter=message.type==='fanzhi',dun=source.dun||{total:0,dun:0,sub_dun:0};
    const a=run(attack,[actor,null,id,vm.table({x:0,y:0}),vm.table(targets.length?targets:[actor]),!!message.over,nilTable(source.life),nilTable(source.buff),nilTable(source.nowbuff),source.hp??actorData.hp,source.mp??actorData.mp??0,source.sub_hp??0,source.sub_mp??0,source.blood_hp??0,source.xinei??0,nilTable(dun),!!source.die,counter,nilTable(message.more),null,nilTable(source.njbuff)]);
    const positionData={...actorData,point:{...(actorData.point||motion.pointFor(actorData.owner))}};
    const phases=a.calls.filter(x=>x.fn.proto.id==='root/36/11').map(({offsetMs,fn})=>{
      const phaseMotion=motion.planPhaseMotion(fn,positionData);positionData.point={...phaseMotion.to};
      const u=i=>fn.upvalues[i]?.value,act=u(18),animation=vm.get(act,1),variant=normalEffect(actorData.owner||{},id,u(21),source.buff);
      const recorded=phaseRecorder.recordPhase(fn,{...positionData,buffs:source.buff},targetsData);
      for(const event of recorded.events){if(event.method==='setHp')positionData.hp=event.args[0];if(event.method==='setMp')positionData.mp=event.args[0];}
      const phaseEffects=[];for(const event of recorded.events.filter(x=>x.method==='attackEffect')){
        const point=phaseMotion.from; // Cocos actions begin asynchronously; only zero-time setPosition changes apply immediately.
        const immediate=phaseMotion.segments.filter(x=>x.teleport&&x.offsetMs===0).at(-1);
        const effectPlan=effects.planEffects({dispatch:event.effect},{...positionData,point:immediate?.to||point},targetsData,id);
        for(const effect of effectPlan.effects)phaseEffects.push({offsetMs:event.offsetMs,...effect});
        recorded.diagnostics.push(...effectPlan.diagnostics);
      }
      return{recorded,effects:phaseEffects,offsetMs,motion:phaseMotion,index:u(5),durationMs:u(43)*1000,animation,animationName:phaseName(act),beginFrame:nonAnimation.has(animation)?0:call(mods.dot,'getBeginByName',animation),frames:nonAnimation.has(animation)?0:call(mods.dot,'getFramesByName',animation),timeScale:u(22),hitOffsetMs:u(27)*1000,rawAction:luaToJSON(act),move:luaToJSON(u(7)),sound:luaToJSON(u(28)),effectVariant:variant,range,attackType:u(2),originalCallback:fn.proto.id};
    });
    const lifecycleEvents=[];
    for(const entry of a.calls.filter(x=>x.fn.proto.id!=='root/36/11')){const end=lifecycle.recordLifecycle(entry.fn,actor,{...positionData,hp:source.hp??positionData.hp});for(const e of end.events)lifecycleEvents.push({...e,offsetMs:e.offsetMs+entry.offsetMs,battleId:actorData.battleId,originalCallback:entry.fn.proto.id});}
    const hits=[],reactions=[],targetsMeta=[];let durationMs=a.durationMs;
    for(const[rowIndex,row]of rows.entries()){
      if(message.tag&&message.tag!=='attack'&&message.type!=='fanzhi')continue;
      if(row.protectbattle_id||row.hurtmother||row.transmother)throw Error(`Original protected/split target ${row.battle_id} requires a presentation role bridge`);
      const graph=run(hurt,[targets[rowIndex],null,id,!!message.over,row.hit??1,row.crit??false,row.parry??0,row.hp,row.sub_hp??0,row.mp??0,row.sub_mp??0,nilTable(row.dun||{total:0,dun:0,sub_dun:0}),nilTable(row.buff),nilTable(row.nowbuff),row.jinghua??null,nilTable(row.state),actor,counter,null,null,null,row.beatback??null,nilTable(row.njbuff)]);
      durationMs=Math.max(durationMs,graph.durationMs);targetsMeta.push({battleId:row.battle_id,durationMs:graph.durationMs});
      let targetState=targetsData[rowIndex].state??-1,targetHp=targetsData[rowIndex].hp,targetMp=targetsData[rowIndex].mp,previousGravity=null;
      for(const{offsetMs,fn}of graph.calls){
        const u=i=>fn.upvalues[i]?.value;
        const sample=previousGravity?.plan.samples.filter(s=>s.offsetMs<=offsetMs-previousGravity.start+1e-7).at(-1);if(sample)targetState=sample.state;
        const impactData={...targetsData[rowIndex],hp:targetHp,mp:targetMp,state:targetState,basePoint:motion.pointFor(targetsData[rowIndex].owner),...(sample?{point:sample.point,speedX:sample.speedX,speedY:sample.speedY}: {})};
        if(fn.proto.id==='root/64/14'||fn.proto.id==='root/64/5'){
          const success=fn.proto.id==='root/64/14',act=u(2),serialized=JSON.stringify(luaToJSON(act)),phase=phases.find(p=>JSON.stringify(p.rawAction)===serialized);
          const impact=captureImpactCalls(vm,fn,{actorData:impactData,attackerData:actorData});
          if(impact.finalState!=null)targetState=impact.finalState;for(const e of impact.events){if(e.method==='setHp')targetHp=e.args[0];if(e.method==='setMp')targetMp=e.args[0];}
          const hitEffects=impactEffects.plan(impact.events,impactData);
          const gravity=gravityPlanner.plan(impact.runtimeCapture,{point:impactData.point,basePoint:impactData.basePoint,owner:impactData.owner,landY:impactData.basePoint.y});if(gravity)previousGravity={start:offsetMs,plan:gravity};
          hits.push({gravity,...{effects:hitEffects.effects,sounds:hitEffects.sounds,floatingCalls:impact.floatingCalls,presentationCalls:impact.events,offsetMs,battleId:row.battle_id,phaseIndex:phase?.index,deltaHp:success?u(16):u(3),deltaMp:success?u(20):u(6),shieldDelta:success?u(21):u(7),hit:row.hit,parry:row.parry,crit:row.crit,rawHurt:row,originalCallback:fn.proto.id}});
        }else if(fn.proto.id==='root/64/6'){
          const impact=captureImpactCalls(vm,fn,{actorData:impactData,attackerData:actorData});if(impact.finalState!=null)targetState=impact.finalState;for(const e of impact.events){if(e.method==='setHp')targetHp=e.args[0];if(e.method==='setMp')targetMp=e.args[0];}
          const hitEffects=impactEffects.plan(impact.events,impactData);
          reactions.push({effects:hitEffects.effects,sounds:hitEffects.sounds,offsetMs,battleId:row.battle_id,type:row.hit===0?'miss':'parry',floatingCalls:impact.floatingCalls,presentationCalls:impact.events,originalCallback:fn.proto.id});
        }
        else{const end=lifecycle.recordLifecycle(fn,targets[rowIndex],{...impactData,hp:row.hp,state:targetState});for(const e of end.events)lifecycleEvents.push({...e,offsetMs:e.offsetMs+offsetMs,battleId:row.battle_id,originalCallback:fn.proto.id});}

      }
    }
    return JSON.parse(JSON.stringify({diagnostics:phases.flatMap(p=>p.recorded.diagnostics),durationMs,phases,hits,reactions,lifecycleEvents,targets:targetsMeta,finalPoint:positionData.point,action:luaToJSON(cfg),source:'Original JHBaseRole.playZhaoShi + hurtZhaoShi Cocos action graph'}));
  }
  return {planSkill,planRoundBuff:(data,row)=>{const plan=lifecycle.recordRoundBuff(data,row);for(const event of plan.events){const media=impactEffects.plan([event],data);event.effects=media.effects;event.sounds=media.sounds;}return plan;},planBuffState:buffPlanner.planBuffState,beginTimeline:buffPlanner.reset,describeActor:owner=>dimensions.resolve(owner),...motion,logicFps:vm.globals.JH_LOGIC_FRAMES,timeSpeed:vm.globals.JH_TIME_SPEED,constants:{moveFrames:vm.globals.JH_MOVE_FRAMES,jumpFrames:vm.globals.JH_JUMP_FRAMES},runtime};
}
