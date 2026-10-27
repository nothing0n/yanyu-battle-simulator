import {createPresentationPlanner} from './action-planner.mjs';
const list=value=>Array.isArray(value)?value:Object.values(value||{});
let sharedPlanner;
export function timelineGameTimeAt(timeline,wallMs){
  const segments=timeline.clock?.segments;if(!segments?.length)return wallMs;
  let segment=segments[0];for(const candidate of segments){if(candidate.atMs>wallMs)break;segment=candidate;}
  return segment.gameAtMs+(wallMs-segment.atMs)*segment.scale;
}
export function timelineWallTimeAt(timeline,gameMs){
  const segments=timeline.clock?.segments;if(!segments?.length)return gameMs;
  let segment=segments[0];for(const candidate of segments){if(candidate.gameAtMs>gameMs)break;segment=candidate;}
  return segment.atMs+(gameMs-segment.gameAtMs)/segment.scale;
}
function originalSchedulerClock(cues){
  const segments=[{gameAtMs:0,atMs:0,scale:1}];
  for(const cue of cues.filter(c=>c.type==='schedulerScale')){
    if(!(cue.scale>0))throw Error('Original presentation scheduler has invalid scale '+cue.scale);
    const last=segments.at(-1),atMs=last.atMs+(cue.atMs-last.gameAtMs)/last.scale;
    if(cue.scale!==last.scale)segments.push({gameAtMs:cue.atMs,atMs,scale:cue.scale,source:cue.originalCallback});
  }
  return {segments,source:'Original JHBaseRole.playLastAttack Cocos scheduler calls',segmentFields:'Motion segments, opacity and nested callbacks remain in game milliseconds'};
}

export function originalEffectPath(animation,variant){
  if(animation==='wait')return null;
  const special=['effect','effectfen','effectmore','effectcenter','effectsj'].includes(animation);
  if(!special&&!(Number(variant)>0))return null;
  let name=special?String(variant):String(animation).split('&')[0]+'_'+variant;
  if(name.includes('attack'))return 'effect/'+name.replaceAll('attack','effect');
  return name.includes('effect_')?'effect/'+name:'effect/effect_'+name;
}
/** Raw packets are dispatched by JHBattleControl at frame/JH_LOGIC_FRAMES.
 * Skill subevents come from the original Cocos action graph, not interpolation. */
export async function buildTimeline(result,options={}){
  const planner=options.planner||(options.readJSON?await createPresentationPlanner(options):await(sharedPlanner??=createPresentationPlanner(options)));
  planner.beginTimeline?.();
  const logicFps=planner.logicFps,actors=[],byId=new Map(),stats=new Map((result.stats||[]).map(x=>[x.battleId,x])),cues=[],diagnostics=[],rawMessages=result.rawMessages||[],logs=result.events||[],mappedLogs=new Set();let serial=0;
  const add=cue=>{const complete={id:serial++,durationMs:0,logIndices:[],...cue};cues.push(complete);for(const i of complete.logIndices)mappedLogs.add(i);return complete;};
  const buffVisual=(base,actor,packet={})=>{if(!actor)return;actor.buffs=packet.buff?list(packet.buff):actor.buffs||[];actor.innerBuffs=packet.njbuff?list(packet.njbuff):actor.innerBuffs||[];try{const visual=planner.planBuffState(actor,base.atMs,{buffs:actor.buffs,innerBuffs:actor.innerBuffs,shield:packet.dun});add({...base,type:'buffVisual',battleId:actor.battleId,visual});}catch(error){diagnostics.push({rawIndex:base.rawIndex,battleId:actor.battleId,reason:'Original Buff graphics: '+error.message});}};
  const logMatch=(msg,predicate=()=>true)=>logs.map((x,i)=>({x,i})).filter(({x,i})=>!mappedLogs.has(i)&&x.frame===msg.frame&&(x.rawType===msg.type||!x.rawType)&&predicate(x)).map(({i})=>i);
  for(const [rawIndex,msg]of rawMessages.entries()){
    const atMs=Number(msg.frame||0)/logicFps*1000,base={atMs,frame:msg.frame||0,round:msg.round,rawIndex,rawType:msg.type,payload:msg};
    if(msg.type==='create'){
      const owner=msg.owner||{},battleId=owner.BattleID,s=stats.get(battleId),actor={battleId,uid:s?.uid||String(battleId),name:owner.Name||s?.name,team:owner.left?'ally':'enemy',left:!!owner.left,stand:owner.Stand,owner,hp:msg.ownerhp,maxHp:msg.ownermaxhp,mp:msg.mpFirstByBuff??0};
      Object.assign(actor,planner.describeActor?.(owner));actor.point=planner.pointFor(owner);actors.push(actor);byId.set(battleId,{...actor});add({...base,type:'spawn',battleId,actor});buffVisual(base,byId.get(battleId));continue;
    }
    if(msg.type==='skill'||msg.type==='fanzhi'){
      const source=msg.attack||{},battleId=source.battle_id,rows=msg.hurt?[msg.hurt]:list(msg.hurts),actor=byId.get(battleId),targets=rows.map(row=>byId.get(row.battle_id));
      if(!actor||targets.some(x=>!x)){diagnostics.push({rawIndex,skillId:msg.id,reason:'Presentation actor not created'});add({...base,type:'unsupported',skillId:msg.id,battleId});continue;}
      let plan;
      try{plan=planner.planSkill(msg,actor,targets);}catch(error){diagnostics.push({rawIndex,skillId:msg.id,reason:error.message,details:error.details});add({...base,type:'unsupported',skillId:msg.id,battleId});continue;}
      for(const reason of plan.diagnostics||[])diagnostics.push({rawIndex,skillId:msg.id,reason});
      for(const target of targets)add({...base,type:'floatingReset',battleId:target.battleId});
      const start=add({...base,type:'skill',battleId,skillId:msg.id,targetIds:rows.map(x=>x.battle_id),durationMs:plan.durationMs,action:plan.action});
      for(const phase of plan.phases){
        const cue={...base,atMs:atMs+phase.offsetMs,battleId,skillId:msg.id,targetIds:rows.map(x=>x.battle_id),phaseIndex:phase.index,durationMs:phase.durationMs,phase};
        if(phase.motion?.segments?.length||phase.motion?.opacity?.length)add({...cue,type:'move',kind:'skill_move',...phase.motion});
        if(phase.animationName)add({...cue,type:'animation',animation:phase.animationName,beginFrame:phase.beginFrame,frames:phase.frames,timeScale:phase.timeScale,move:phase.move});
        for(const effect of phase.effects||[])add({...cue,...effect,atMs:cue.atMs+effect.offsetMs,type:'effect',placement:phase.attackType});
        for(const event of phase.recorded?.events||[]){
          const eventBase={...cue,atMs:cue.atMs+event.offsetMs,durationMs:0,originalCallback:phase.originalCallback};
          if(event.method==='schedulerScale')add({...eventBase,type:'schedulerScale',scale:event.args[0]});
          else if(event.method==='sound')add({...eventBase,type:'sound',name:event.args[0]});
          else if(['addHp','addMp','addNJHp'].includes(event.method))add({...eventBase,type:'floating',floatingCalls:[{method:event.method,args:event.args}]});
          else if(event.method==='setHp')add({...eventBase,type:'health',hp:event.args[0],maxHp:actor.maxHp});
          else if(event.method==='setMp')add({...eventBase,type:'health',mp:event.args[0]});
          else if(['pauseAnimation','resumeAnimation','playBattleIdle'].includes(event.method))add({...eventBase,type:event.method});
          else if(event.method==='event'&&event.args[0]?.name==='BattleSceneEffect')add({...eventBase,type:'scene',scene:event.args[0].msg});
          else if(event.method==='event'&&['BattleCameraScale','BattleCameraFocus'].includes(event.args[0]?.name))add({...eventBase,type:'camera',name:event.args[0].name,camera:event.args[0].msg});
          else if(!['attackEffect','setTimeScale','playAnimationByExcel','clearTracks','setDun','setPauseGravity','updateBuffs'].includes(event.method))add({...eventBase,type:'presentationCall',method:event.method,args:event.args});
        }
      }
      for(const reaction of plan.reactions){const reactionBase={...base,atMs:atMs+reaction.offsetMs,battleId:reaction.battleId,sourceId:battleId,skillId:msg.id};add({...reactionBase,type:reaction.type,floatingCalls:reaction.floatingCalls,presentationCalls:reaction.presentationCalls,originalCallback:reaction.originalCallback});for(const effect of reaction.effects||[])add({...reactionBase,...effect,type:'effect',impact:true});for(const sound of reaction.sounds||[])add({...reactionBase,...sound,type:'sound'});}
      for(const entry of plan.lifecycleEvents||[]){
        const end={...base,atMs:atMs+entry.offsetMs,battleId:entry.battleId,originalCallback:entry.originalCallback};
        if(['playBattleIdle','pauseAnimation','resumeAnimation'].includes(entry.method))add({...end,type:entry.method});
        else if(['playDie','dieRemove'].includes(entry.method))add({...end,type:'death',method:entry.method});
        else if(entry.method==='setPosition')add({...end,type:'move',kind:'original_recovery',from:entry.args[0],to:entry.args[0],durationMs:0,segments:[{offsetMs:0,durationMs:0,from:entry.args[0],to:entry.args[0],teleport:true}]});
        else if(['playMissAnimation','playParryAnimation'].includes(entry.method))add({...end,type:entry.method==='playMissAnimation'?'miss':'parry'});
        else if(['playHappy','playAttackOver','playAnimationByExcel','unsupported'].includes(entry.method))add({...end,type:'presentationCall',method:entry.method,args:entry.args});
      }
      for(const row of rows){
        const target=byId.get(row.battle_id),hits=plan.hits.filter(x=>x.battleId===row.battle_id),last=hits.at(-1),first=hits[0];
        for(const hit of hits){
          if(hit.gravity)add({...base,atMs:atMs+hit.offsetMs,battleId:row.battle_id,type:'gravity',gravity:hit.gravity,durationMs:hit.gravity.durationMs});
          for(const effect of hit.effects||[])add({...base,atMs:atMs+hit.offsetMs,battleId:row.battle_id,...effect,type:'effect',impact:true});
          for(const sound of hit.sounds||[])add({...base,atMs:atMs+hit.offsetMs,battleId:row.battle_id,...sound,type:'sound'});
          add({...base,atMs:atMs+hit.offsetMs,type:'hit',battleId:row.battle_id,sourceId:battleId,skillId:msg.id,phaseIndex:hit.phaseIndex,deltaHp:hit.deltaHp,deltaMp:hit.deltaMp,damage:Math.max(0,-hit.deltaHp),healing:Math.max(0,hit.deltaHp),hit:hit.hit,parry:hit.parry,crit:hit.crit,rawHurt:row,floatingCalls:hit.floatingCalls,presentationCalls:hit.presentationCalls,originalCallback:hit.originalCallback,logIndices:hit===last?logMatch(msg,x=>x.targetId===target.uid&&!x.buffId):[]});
        }
        const updateAt=atMs+(last?.offsetMs??plan.durationMs);
        if(Number.isFinite(row.hp))add({...base,atMs:updateAt,type:'health',battleId:row.battle_id,hp:row.hp,mp:row.mp,maxHp:target.maxHp});
        if(row.buff||row.njbuff){add({...base,atMs:updateAt,type:'buffs',battleId:row.battle_id,buffs:list(row.buff),innerBuffs:list(row.njbuff)});buffVisual({...base,atMs:atMs+(first?.offsetMs??plan.durationMs)},target,row);}
        for(const effect of list(row.nowbuff))add({...base,atMs:atMs+(first?.offsetMs??plan.durationMs),type:'status',floatingHandled:true,battleId:row.battle_id,skillId:msg.id,buffId:effect.id,deltaHp:effect.sub_hp||0,deltaMp:effect.sub_mp||0,payload:effect,logIndices:logMatch(msg,x=>x.targetId===target.uid&&x.buffId===effect.id)});
        if(row.die&&!plan.lifecycleEvents?.some(x=>x.battleId===row.battle_id&&['playDie','dieRemove'].includes(x.method))){diagnostics.push({rawIndex,skillId:msg.id,reason:'Original death waits for an unbound landing/recovery callback',battleId:row.battle_id});}
        if(Number.isFinite(row.hp))target.hp=row.hp;if(Number.isFinite(row.mp))target.mp=row.mp;
      }
      if(plan.finalPoint)actor.point={...plan.finalPoint};
      const ownCalls=plan.phases.flatMap(p=>(p.recorded?.events||[]).map(e=>({...e,offsetMs:e.offsetMs+p.offsetMs})));
      const ownAt=atMs+(ownCalls.find(e=>e.method==='updateBuffs')?.offsetMs??plan.durationMs);
      if(source.buff||source.njbuff)buffVisual({...base,atMs:ownAt},actor,source);
      if(Number.isFinite(source.hp))add({...base,atMs:atMs+(ownCalls.filter(e=>e.method==='setHp').at(-1)?.offsetMs??plan.durationMs),type:'health',battleId,hp:source.hp,mp:source.mp,maxHp:actor.maxHp});
      for(const effect of list(source.nowbuff))add({...base,atMs:ownAt,type:'status',floatingHandled:true,battleId,skillId:msg.id,buffId:effect.id,deltaHp:effect.sub_hp||0,deltaMp:effect.sub_mp||0,payload:effect,logIndices:logMatch(msg,x=>x.targetId===actor.uid&&x.buffId===effect.id)});
      if(Number.isFinite(source.hp))actor.hp=source.hp;if(Number.isFinite(source.mp))actor.mp=source.mp;
      if(!plan.hits.length){const indices=logMatch(msg);start.logIndices.push(...indices);for(const i of indices)mappedLogs.add(i);}
      continue;
    }
    if(msg.type==='move_on'||msg.type==='move_back'||msg.type==='move_on_protect'||msg.type==='change_stand'){
      const battleId=msg.attack?.battle_id??msg.battle_id,targetIds=msg.hurt?[msg.hurt.battle_id]:list(msg.hurts).map(x=>x.battle_id),actor=byId.get(battleId);let motion;
      try{motion=planner.planMotion(msg,actor,byId.get(targetIds[0]));actor.point={...motion.to};}
      catch(error){diagnostics.push({rawIndex,reason:error.message,type:msg.type});}
      add({...base,type:'move',battleId,kind:msg.type,targetIds,...motion,motionTiming:motion?.source||'unsupported'});continue;
    }
    if(msg.type==='buff'||msg.type==='value'||msg.type==='small_round'){
      for(const row of [...list(msg.left),...list(msg.right)]){
        const actor=byId.get(row.battle_id);if(!actor)continue;
        let recordedRound=false;if(msg.type==='buff')try{
          const plan=planner.planRoundBuff(actor,row);recordedRound=true;add({...base,type:'floatingReset',battleId:row.battle_id});let timeScale=1;
          for(const event of plan.events){const b={...base,atMs:atMs+event.offsetMs,battleId:row.battle_id};
            if(['addHp','addMp','playMiss','playMissPo'].includes(event.method))add({...b,type:'floating',floatingCalls:[{method:event.method,args:event.args}]});
            else if(['playDie','dieRemove'].includes(event.method))add({...b,type:'death',originalCallback:'JHBaseRole.roundBuff'});
            else if(event.method==='setTimeScale')timeScale=event.args[0];
            else if(event.method==='playAnimationFromTo')add({...b,type:'animation',beginFrame:event.args[0],endFrame:event.args[1],animation:event.args[2],loop:event.args[3],timeScale});
            else if(event.method==='playBattleIdle')add({...b,type:'playBattleIdle',queued:event.args[0]});
            for(const effect of event.effects||[])add({...b,...effect,type:'effect',roundEffect:true});for(const sound of event.sounds||[])add({...b,...sound,type:'sound'});
          }
        }catch(error){diagnostics.push({rawIndex,battleId:row.battle_id,reason:'Original round Buff: '+error.message,details:error.details});}
        add({...base,type:'state',battleId:row.battle_id,hp:row.hp,mp:row.mp,maxHp:row.hpmax,buffs:row.buff?list(row.buff):undefined,innerBuffs:row.njbuff?list(row.njbuff):undefined,logIndices:logMatch(msg,x=>x.targetId===actor.uid),payload:row});
        for(const effect of [...list(row.buff_use),...list(row.nowbuff)])add({...base,type:'status',floatingHandled:recordedRound,battleId:row.battle_id,buffId:effect.id,deltaHp:effect.sub_hp||0,deltaMp:effect.sub_mp||0,payload:effect});
        if(Number.isFinite(row.hp))actor.hp=row.hp;if(Number.isFinite(row.mp))actor.mp=row.mp;buffVisual(base,actor,row);
      }continue;
    }
    if(msg.type==='round'||msg.type==='over'||msg.type==='start')add({...base,type:msg.type==='over'?'end':msg.type,logIndices:logMatch(msg)});
    else add({...base,type:'message'});
  }
  for(const [index,event]of logs.entries())if(!mappedLogs.has(index)&&Number.isFinite(event.frame))add({atMs:event.frame/logicFps*1000,frame:event.frame,type:'log',logIndices:[index]});
  cues.sort((a,b)=>a.atMs-b.atMs||a.id-b.id);
  const gameDurationMs=Math.max(0,...cues.map(x=>x.atMs+(x.type==='animation'||x.type==='skill'?x.durationMs:0)));
  for(const [index,event]of logs.entries())if(!mappedLogs.has(index))add({atMs:gameDurationMs,type:'log',logIndices:[index]});
  const clock=originalSchedulerClock(cues),clockContainer={clock};
  for(const cue of cues){cue.gameAtMs=cue.atMs;cue.gameDurationMs=cue.durationMs;cue.atMs=timelineWallTimeAt(clockContainer,cue.gameAtMs);cue.durationMs=timelineWallTimeAt(clockContainer,cue.gameAtMs+cue.gameDurationMs)-cue.atMs;}
  const durationMs=timelineWallTimeAt(clockContainer,gameDurationMs);
  const steps=[...new Set(cues.filter(x=>['skill','hit','move','round','end'].includes(x.type)).map(x=>x.atMs))].sort((a,b)=>a-b).map(atMs=>({atMs}));
  return{durationMs,gameDurationMs,clock,logicFps,actors,cues,events:cues,steps,diagnostics,metadata:{coordinateBasis:{center:{x:1024,y:200},note:'Translate all actors/effects together when fitting the original background'},dispatch:'JHBattleControl.onCheckMsg frame / JH_LOGIC_FRAMES',skills:'Original JHBaseRole playZhaoShi/hurtZhaoShi action graphs',damage:'Original per-segment floor and final remainder',limitations:['Native Spine/Cocos rendering is performed by the web renderer','Alternating-target and protected/split-body presentation paths are reported unsupported'],complete:diagnostics.length===0,completeScope:'Recorded packet and action scheduling only; renderer feature coverage is reported separately',nativeVisualParityVerified:false}};
}
