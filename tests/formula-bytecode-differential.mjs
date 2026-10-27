import fs from 'node:fs';
import assert from 'node:assert/strict';
import {LuaVM,multi} from '../dist/runtime/lua-vm.mjs';
import {originalHitChance,originalParryChance,originalDamageCore} from '../dist/engine/formulas.js';
const fixtures=JSON.parse(fs.readFileSync(new URL('./formula-fixtures.json',import.meta.url),'utf8'));
const proto=name=>fixtures.functions[name].prototype;
const getSubHp=proto('getSubHp'),getIsHit=proto('getIsHit'),getIsParry=proto('getIsParry');
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const obj=methods=>new Proxy(methods,{get:(o,k)=>{
 if(typeof k==='symbol'||k in o)return o[k];
 if(k==='then')return undefined;
 return undefined;
}});
function setup(p){
 const seen=[];
 const A=obj({getLeft:()=>true,getIsMonster:()=>true,getSex:()=>1,
  getBattleAttackSkill:()=>multi(p.attack,null,p.attackRate??1),
  getBattleDefIgnore:()=>p.defenceIgnore??0,getBaseStr:()=>p.strength??0,
  getBattleDmgOffIgnore:()=>p.damageReductionIgnore??0,getRealDmg:()=>0,
  getSexCrit:()=>p.attackerSexCrit??0,getBattleFanJiAtkMore:()=>p.counterattackMore??0,
  getParryDmg:()=>p.parryBreakDamage??0,getBattleGangqiIgn:()=>p.gangqiIgnore??0,
  getBattleHit:()=>p.hit??1000,getLevel:()=>p.attackerLevel??100,
  getBattleSpeed:()=>p.speed??1000,getBattleSpeedMore:()=>0,
  getBattlePoDodge:()=>0,getBattlePoParry:()=>0,getAOEFocus:()=>0,getAOEAtkMore:()=>0});
 const D=obj({getLeft:()=>false,getSex:()=>1,getBattleDefence:()=>p.defence,
  getBaseCon:()=>p.constitution??0,getBattleDmgOff:()=>p.damageReduction??0,
  getBattleDmgOffCount:()=>p.reductionCount??0,getDexDmgOffCompare:()=>p.dexReductionCompare??0,
  getBattleDmgOff80:()=>p.reduction80??0,getParryDmgOffCompare:()=>p.parryReductionCompare??0,
  getBattleBossDmgOff:()=>p.bossReduction??0,getSexCrit:()=>p.defenderSexCrit??0,
  getBattleGangqi:()=>p.gangqi??0,getLockHp:()=>p.lockHp??false,getSkillHpIgnore:()=>false,
  getIsZhuZi:()=>false,getIsYun:()=>false,getIsWang:()=>false,getWaitRound:()=>0,
  getBattleDodge:()=>p.dodge??1000,getLevel:()=>p.defenderLevel??100,getNoSkill:()=>false,
  getBattleParry:()=>p.parry??1000,getMissSkill:()=>0});
 A.getActiveTaolu=()=>null;
 const AI=obj({m_nRound:1,getGlobleBuffs:()=>[],getGlobalSpeffects:()=>[],getModelsCount:()=>2,getModelsLeft:()=>[],
  m_tRndCtl:{boolRand:()=>false,intRandBetween:()=>p.randomInt??100},
  getNoMissAndParry:()=>false,isRandomCan:(_self,chance)=>{seen.push(chance);return true;}});
 return {A,D,AI,seen};
}
const uv={getZSRange:()=>101,getZSDmgTrans:()=>0,isNormalAttack:()=>true};
let checked=0;
const cases=[{}, {parryResult:1},{parryResult:-1,parryBreakDamage:.5},
 {defenceIgnore:.3},{damageReduction:.7},{damageReduction:.9,damageReductionIgnore:.3,reductionCount:.1,reduction80:.2},
 {gangqi:1000},{gangqi:1000,damageReduction:.5},{gangqi:1000,damageReduction:.5,reduction80:.2},
 {critical:true,criticalMultiplier:1.5},{attackRate:1.2,attackRateBase:.17,actionMultiplier:1.3},
 {counterattack:true,counterattackMore:.2,attackerSexCrit:.1,defenderSexCrit:-.03},{lockHp:true}];
for(const ex of cases)for(const attack of [1,1000,14587])for(const randomInt of [98,100,102]){
 const p={attack,defence:500,strength:100,constitution:100,randomInt,...ex};
 const {A,D,AI}=setup(p);const vm=new LuaVM({fr2:true});
 const args=[AI,A,D,null,null,1,null,null,null,p.critical??false,p.criticalMultiplier??1,p.parryResult??0,1,null,null,0,p.actionMultiplier??1,p.counterattack??false,null,null,{atkratebase:p.attackRateBase??0}];
 const result=vm.runFirst(getSubHp,args,[uv,uv]);
 assert.equal(result,originalDamageCore(p).damage,JSON.stringify(p));checked++;
}
for(const hit of [100,1000,8000,1000001])for(const level of [1,90,100]){
 const p={hit,dodge:1000,speed:2500,parry:1000,attackerLevel:level,defenderLevel:level,attack:1000,defence:500};
 let {A,D,AI,seen}=setup(p),vm=new LuaVM({fr2:true});
 vm.runFirst(getIsHit,[AI,A,D,null,0],[uv]);close(seen[0],originalHitChance(p));checked++;
 ({A,D,AI,seen}=setup(p));vm=new LuaVM({fr2:true});
 vm.runFirst(getIsParry,[AI,A,D,null,0,false],[uv]);close(seen[0],originalParryChance(p));checked++;
}
console.log('PASS '+checked+' differential checks against original bytecode with explicit resolved-property stubs. Not full-game parity.');
