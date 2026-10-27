import {LuaTable,firstResult} from '../runtime/lua-vm.mjs';
import {createRuntime} from './runtime.mjs';

export function resolveFightType(config){
  const value=config.fightType??1;
  if(value!==1&&value!==2)throw new Error('fightType must be 1 (original default) or 2 (original client PVP branches).');
  return value;
}

export function luaToJSON(value,seen=new WeakSet()){
  if(!(value instanceof LuaTable))return typeof value==='function'?undefined:value;
  if(seen.has(value))return '[循环引用]';seen.add(value);
  const entries=[...value.entries];
  const array=entries.length>0 && entries.every(([k])=>Number.isInteger(k)&&k>=1&&k<=entries.length);
  const out=array?[]:{};
  for(const [k,v] of entries){const converted=luaToJSON(v,seen);if(converted!==undefined)out[array?k-1:String(k)]=converted;}
  seen.delete(value);return out;
}

/** Advance the game's JHAITest/JHBaseAI directly, without a replacement turn loop. */
export async function runOriginalBattle(config,options={}){
  const fightType=resolveFightType(config);
  const runtime=await createRuntime({...options,seed:config.seed});
  const {vm}=runtime;
  runtime.require('app/ai/JHAIConfig');
  const ai=runtime.instantiate('app/ai/JHAITest');
  // Call the original setter explicitly. Actor initForPVP does not set AI mode.
  // Type 2 selects original client PVP branches; server arena parity is unproven.
  runtime.callMethod(ai,'setFightType',fightType);
  // Use the original base class scheduler hooks; the web host supplies ticks.
  vm.set(ai,'startUpdate',vm.get(runtime.require('app/ai/JHBaseAI'),'startUpdate'));
  vm.set(ai,'stopUpdate',vm.get(runtime.require('app/ai/JHBaseAI'),'stopUpdate'));
  const random=vm.get(ai,'m_tRndCtl');
  if(random)vm.set(random,'__RandSeed',Math.max(1,Math.trunc(Number(config.seed)||1)));
  const actors=[];
  const makeRole=options.createBattleRole || (async(runtime,row,left,index)=>{
    if(row.build){const {createEditorBattleRole}=await import('../integration/editor-model.mjs');return createEditorBattleRole(runtime,row,left,index);}
    const {createBattleRole}=await import('../integration/actors.mjs');return createBattleRole(runtime,row,left,index);
  });
  for(const [team,left] of [['ally',true],['enemy',false]]){
    for(const [index,row] of (config.teams?.[team]||[]).entries()){
      const actor=await makeRole(runtime,row,left,index);
      actors.push({actor,row,team});
      runtime.callMethod(ai,left?'addLeftModel':'addRightModel',1,actor);
    }
  }
  if(!actors.some(x=>x.team==='ally')||!actors.some(x=>x.team==='enemy'))throw new Error('双方至少需要一名角色。');
  const messages=[];let ended=false,win=null,round=0;
  const roundLimit=Number(config.maxRounds)||0;
  if(roundLimit){
    if(!Number.isInteger(roundLimit)||roundLimit<1||roundLimit>100)throw new Error('回合上限须为 1–100。');
    const newRound=vm.get(ai,'doNewRound');
    vm.set(ai,'doNewRound',(...args)=>{
      if(vm.get(ai,'m_nRound')>roundLimit){const stop=new Error('Web host round limit reached');stop.details={hostRoundLimit:true};throw stop;}
      return vm.call(newRound,args);
    });
  }
  vm.set(ai,'sendBattleMsg',(_self,msg)=>messages.push(luaToJSON(msg)));
  runtime.finishBootstrap();
  runtime.callMethod(ai,'startBattle',false,(_messages,result,rounds)=>{ended=true;win=result;round=rounds;});
  const budget=options.frameBudget||120000;
  let frames=0,limited=false;
  while(!ended&&frames++<budget){
    try{runtime.callMethod(ai,'onUpdate');}catch(error){if(error.details?.hostRoundLimit){limited=true;round=roundLimit;break;}throw error;}
    round=vm.get(ai,'m_nRound')||round;
    if(roundLimit&&round>roundLimit){limited=true;round=roundLimit;break;}
    if(frames%256===0){
      options.onProgress?.({frames,round,messages:messages.length});
      await new Promise(resolve=>setTimeout(resolve,0));
    }
  }
  if(!ended&&!limited)throw new Error(`原始调度超过 ${budget} 帧运行预算，尚未产生完整结果。`);
  const stats=actors.map(({actor,row,team})=>({uid:row.uid,name:row.name,team,damage:0,healing:0,taken:0,hp:runtime.firstMethod(actor,'getBattleHp'),maxHp:runtime.firstMethod(actor,'getBattleHpMax'),battleId:runtime.firstMethod(actor,'getBattleID')}));
  const events=convertMessages(messages,stats,id=>{for(const key of ['kongfu_zs_data','kongfu_ngf_data','kongfu_dodgef_data','play_kongfu_zs_data']){const row=vm.get(runtime.configFor(key),String(id));if(row)return vm.get(row,'name');}return String(id);},id=>{const row=vm.get(runtime.configFor('kongfu_buff'),String(id));return row?(vm.get(row,'buff')||String(id)):String(id);});
  if(limited)events.push({round,type:'end',rawType:'host_limit',text:`达到 ${roundLimit} 回合上限，停止推演`,snapshot:Object.fromEntries(stats.map(s=>[s.uid,s.hp]))});
  return {winner:win==='Left'?'ally':win==='Right'?'enemy':'draw',rounds:round,events,stats,rawMessages:messages,metadata:{engine:'JHAITest + JHBaseAI original bytecode',snapshot:'73460 / 2026-10-07',fightType,serverArenaModeValidated:false,frames,roundLimitReached:limited,seed:config.seed,missingImports:[...runtime.missing],originalBattleValidated:false,rngStatus:'original math wrapper and intRand bytecode; native getWhaleRand validated against 1536 ARM64 outputs',rngNativeVectors:1536,unattributedDamage:events.reduce((n,event)=>n+(event.unattributed?event.damage:0),0),statisticsMeaning:'Raw damage and healing include overkill and overhealing; buff damage without a source ID is recorded as taken but not attributed to an attacker',validationScope:'Original code executes; a complete replay has not yet been compared frame by frame with the game'}};
}

export function convertMessages(messages,stats,skillName=id=>String(id),buffName=id=>String(id)){
  const byId=new Map(stats.map(s=>[s.battleId,s])),events=[],hp=Object.fromEntries(stats.map(s=>[s.uid,s.maxHp])),buffOwners=new Map();let round=1;
  const list=value=>Array.isArray(value)?value:Object.values(value||{});
  const snapshot=()=>({...hp});
  const remember=row=>{
    if(!row)return;
    const target=byId.get(row.battle_id);if(target&&Number.isFinite(row.hp))hp[target.uid]=row.hp;
    const grouped=new Map();
    for(const buff of list(row.buff))if(buff.WhoBattleID){if(!grouped.has(buff.id))grouped.set(buff.id,new Set());grouped.get(buff.id).add(buff.WhoBattleID);}
    for(const [id,owners] of grouped)buffOwners.set(`${row.battle_id}:${id}`,owners);
  };
  const effectRows=(row,field,msg)=>{
    const target=byId.get(row?.battle_id);if(!target)return;
    for(const effect of list(row[field])){
      const delta=Number(effect.sub_hp)||0,mp=Number(effect.sub_mp)||0;if(!delta&&!mp)continue;
      const owners=buffOwners.get(`${row.battle_id}:${effect.id}`),owner=owners?.size===1?byId.get([...owners][0]):null;
      const damage=Math.max(0,-delta),healing=Math.max(0,delta),skill=buffName(effect.id);
      target.taken+=damage;if(owner)owner.damage+=damage;(owner||target).healing+=healing;
      events.push({round,frame:msg.frame,rawType:msg.type,actor:(owner||target).name,actorId:owner?.uid,target:target.name,targetId:target.uid,
        type:damage?'damage':healing?'heal':'effect',skill,buffId:effect.id,damage,healing,mpChange:mp,unattributed:damage>0&&!owner,hpAfter:row.hp,
        text:`${target.name}「${skill}」${damage?`受到 ${damage} 伤害`:healing?`恢复 ${healing} 气血`:mp>0?`恢复 ${mp} 内力`:`减少 ${-mp} 内力`}`,snapshot:snapshot()});
    }
  };
  for(const msg of messages){
    round=msg.round||round;
    if(msg.type==='round')events.push({round,frame:msg.frame,type:'round',text:`第 ${round} 回合`,snapshot:snapshot()});
    const hurtRows=msg.hurt?[msg.hurt]:list(msg.hurts);
    const isAttack=msg.type==='skill'||(msg.attack&&hurtRows.some(x=>Number.isFinite(x.hp)));
    if(isAttack){
      const source=msg.attack||{},actor=byId.get(source.battle_id||msg.attack_battleid),skill=skillName(msg.id||msg.skill_id||source.skill_id||msg.tag||'招式');
      remember(source);
      const begin=events.length;
      for(const hurt of hurtRows){
        remember(hurt);
        const target=byId.get(hurt.battle_id),delta=Number(hurt.sub_hp)||0,damage=Math.max(0,-delta),healing=Math.max(0,delta);
        if(actor){actor.damage+=damage;actor.healing+=healing;}if(target)target.taken+=damage;
        const status=hurt.hit===0?'闪避':hurt.parry===1?'招架':hurt.parry===-1?'破招架':hurt.hit===2?'破闪避':'';
        const critical=!!hurt.crit;
        events.push({round,frame:msg.frame,rawType:msg.type,actor:actor?.name||'角色',actorId:actor?.uid,target:target?.name||'目标',targetId:target?.uid,skill,
          type:damage?'damage':healing?'heal':hurt.hit===0?'miss':'action',damage,healing,hpAfter:hurt.hp,critical,parried:hurt.parry===1,
          text:`${actor?.name||'角色'} 以 ${skill} → ${target?.name||'目标'}${damage?`，${critical?'暴击 ':''}${damage} 伤害`:healing?`，恢复 ${healing} 气血`:''}${status?`（${status}）`:''}`,snapshot:snapshot()});
        effectRows(hurt,'nowbuff',msg);
      }
      const selfDelta=Number(source.sub_hp)||0,blood=Math.max(0,Number(source.blood_hp)||0);
      if(actor&&(selfDelta||blood)){
        const healing=Math.max(selfDelta,0)+blood,damage=Math.max(-selfDelta,0);actor.healing+=healing;actor.taken+=damage;
        events.push({round,frame:msg.frame,rawType:msg.type,actor:actor.name,actorId:actor.uid,target:actor.name,targetId:actor.uid,skill,type:healing?'heal':'damage',damage,healing,hpAfter:source.hp,text:`${actor.name}${healing?`恢复 ${healing} 气血`:`受到 ${damage} 伤害`}`,snapshot:snapshot()});
      }
      effectRows(source,'nowbuff',msg);
      if(events.length===begin)events.push({round,frame:msg.frame,rawType:msg.type,actor:actor?.name||'角色',actorId:actor?.uid,skill,type:'action',text:`${actor?.name||'角色'} 施展「${skill}」`,snapshot:snapshot()});
    }
    if(msg.type==='value'||msg.type==='buff')for(const row of [...list(msg.left),...list(msg.right)]){
      remember(row);const target=byId.get(row.battle_id);if(!target)continue;
      const delta=Number(row.sub_hp)||0,damage=Math.max(0,-delta),healing=Math.max(0,delta);
      target.taken+=damage;target.healing+=healing;
      if(delta)events.push({round,frame:msg.frame,rawType:msg.type,actor:target.name,actorId:target.uid,target:target.name,targetId:target.uid,type:healing?'heal':'damage',skill:'回合结算',damage,healing,hpAfter:row.hp,text:`${target.name}${healing?`恢复 ${healing} 气血`:`受到 ${damage} 持续伤害`}`,snapshot:snapshot()});
      effectRows(row,'buff_use',msg);effectRows(row,'nowbuff',msg);
    }
    if(msg.type==='over')events.push({round,frame:msg.frame,type:'end',text:msg.win==='Left'?'我方获胜':msg.win==='Right'?'敌方获胜':'战斗结束',snapshot:snapshot()});
  }
  return events;
}
