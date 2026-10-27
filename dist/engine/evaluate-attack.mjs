import {firstResult,multi} from '../runtime/lua-vm.mjs';
import {createRuntime} from './runtime.mjs';
import {originalHitChance,originalParryChance,originalDamageCore} from './formulas.js';

const finite=(value,fallback)=>{const x=Number(value??fallback);if(!Number.isFinite(x))throw new Error('属性必须是有限数值');return x;};
/** Original hit/parry/damage functions, with explicit resolved-property inputs. */
export async function evaluateAttack(input,options={}){
  const attacker=input.attacker||{},defender=input.defender||{},a=attacker.stats||{},d=defender.stats||{};
  const p={attack:finite(a.atk,1000),defence:finite(d.def,500),strength:finite(a.str,100),constitution:finite(d.con,100),
    hit:finite(a.hit,1000),dodge:finite(d.dodge,1000),speed:finite(a.speed,1000),parry:finite(d.parry,1000),
    attackerLevel:finite(attacker.level,90),defenderLevel:finite(defender.level,90),gangqi:finite(d.gangqi,0),
    defenceIgnore:finite(a.defenceIgnore,0),damageReduction:finite(d.damageReduction,0),damageReductionIgnore:finite(a.damageReductionIgnore,0),
    gangqiIgnore:finite(a.gangqiIgnore,0),critical:!!input.critical,criticalMultiplier:finite(input.criticalMultiplier,1.5),attackRate:finite(input.attackRate,1)};
  const runtime=await createRuntime({...options,seed:input.seed});const {vm}=runtime;
  runtime.require('app/ai/JHAIConfig');const originalAI=runtime.instantiate('app/ai/JHAITest');
  const rng=vm.get(originalAI,'m_tRndCtl');vm.set(rng,'__RandSeed',Math.max(1,Math.trunc(Number(input.seed)||1)));
  runtime.finishBootstrap();
  const A={getLeft:()=>true,getIsMonster:()=>true,getSex:()=>1,getBattleAttackSkill:()=>multi(p.attack,null,p.attackRate),
    getBattleDefIgnore:()=>p.defenceIgnore,getBaseStr:()=>p.strength,getBattleDmgOffIgnore:()=>p.damageReductionIgnore,
    getRealDmg:()=>0,getSexCrit:()=>0,getBattleFanJiAtkMore:()=>0,getParryDmg:()=>0,getBattleGangqiIgn:()=>p.gangqiIgnore,
    getBattleHit:()=>p.hit,getLevel:()=>p.attackerLevel,getBattleSpeed:()=>p.speed,getBattleSpeedMore:()=>0,
    getBattlePoDodge:()=>finite(a.poDodge,0),getBattlePoParry:()=>finite(a.poParry,0),getAOEFocus:()=>0,getAOEAtkMore:()=>0,getActiveTaolu:()=>null};
  const D={getLeft:()=>false,getSex:()=>1,getBattleDefence:()=>p.defence,getBaseCon:()=>p.constitution,
    getBattleDmgOff:()=>p.damageReduction,getBattleDmgOffCount:()=>0,getDexDmgOffCompare:()=>0,getBattleDmgOff80:()=>0,
    getParryDmgOffCompare:()=>0,getBattleBossDmgOff:()=>0,getSexCrit:()=>0,getBattleGangqi:()=>p.gangqi,
    getLockHp:()=>false,getSkillHpIgnore:()=>false,getIsZhuZi:()=>false,getIsYun:()=>false,getIsWang:()=>false,
    getWaitRound:()=>0,getBattleDodge:()=>p.dodge,getLevel:()=>p.defenderLevel,getNoSkill:()=>false,getBattleParry:()=>p.parry,
    getMissSkill:()=>0,getCommonBuff:()=>null};
  const AI={m_nRound:1,getGlobleBuffs:()=>vm.table([]),getGlobalSpeffects:()=>vm.table([]),getModelsCount:()=>2,getModelsLeft:()=>vm.table([]),
    m_tRndCtl:rng,getNoMissAndParry:vm.get(originalAI,'getNoMissAndParry'),isRandomCan:vm.get(originalAI,'isRandomCan')};
  const skillID=21901;
  const hit=firstResult(vm.call(vm.get(originalAI,'getIsHit'),[AI,A,D,skillID,0]));
  const parry=hit?firstResult(vm.call(vm.get(originalAI,'getIsParry'),[AI,A,D,skillID,0,false])):0;
  p.parryResult=input.parried===undefined?parry:input.parried?1:0;
  const damageFn=vm.get(originalAI,'getSubHp');
  const damageArgs=()=>[AI,A,D,null,null,1,null,skillID,null,p.critical,p.criticalMultiplier,p.parryResult,1,null,null,0,1,false,null,null,null];
  const rawDamage=firstResult(vm.call(damageFn,damageArgs()));
  const nativeRng=AI.m_tRndCtl;
  AI.m_tRndCtl={intRandBetween:()=>98,boolRand:()=>false};const damageMin=firstResult(vm.call(damageFn,damageArgs()));
  AI.m_tRndCtl={intRandBetween:()=>102,boolRand:()=>false};const damageMax=firstResult(vm.call(damageFn,damageArgs()));
  AI.m_tRndCtl=nativeRng;
  return {damage:hit?rawDamage:0,damageOnHit:rawDamage,damageMin,damageMax,hitChance:originalHitChance(p),parryChance:originalParryChance(p),
    hitResult:hit,parryResult:p.parryResult,critical:p.critical,details:originalDamageCore({...p,randomInt:100}),
    metadata:{scope:'原始普攻公式 · 已结算面板 · 无武学被动与Buff',engine:'JHBaseAI.getIsHit/getIsParry/getSubHp original bytecode',
      sourceDate:'2026-10-07',seed:input.seed,normalSkillID:skillID,probabilityMeaning:'hitChance/parryChance为基础判定率；原结果另含破闪/破招架判定',
      unsupported:['选中武学的自动面板换算','武学被动与连击','战斗累计暴击状态','整场胜率'],fullCombatParity:false}};
}
