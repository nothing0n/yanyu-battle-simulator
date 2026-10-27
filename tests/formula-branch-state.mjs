import fs from 'node:fs';
import assert from 'node:assert/strict';
import {LuaVM,multi,allResults} from '../dist/runtime/lua-vm.mjs';
const fixtures=JSON.parse(fs.readFileSync(new URL('./formula-fixtures.json',import.meta.url),'utf8')).functions;
const proto=n=>fixtures[n].prototype;
const uv={isNormalAttack:()=>true,getCfgById:()=>null};
function pair({hit=1000,parry=1000,speed=1000,wait=0,sameSide=false,noMiss=false,decisions=[]}={}){
 const calls=[];
 const A={getLeft:()=>true,getBattleHit:()=>hit,getLevel:()=>100,getBattleSpeed:()=>speed,getBattleSpeedMore:()=>0,getBattlePoDodge:()=>0,getBattlePoParry:()=>0};
 const D={getLeft:()=>sameSide,getIsZhuZi:()=>false,getIsYun:()=>false,getIsWang:()=>false,getWaitRound:()=>wait,getBattleDodge:()=>1000,getLevel:()=>100,getNoSkill:()=>false,getBattleParry:()=>parry};
 const AI={m_nRound:1,getNoMissAndParry:()=>noMiss,getModelsCount:()=>2,getModelsLeft:()=>[],
  getGlobleBuffs:(self,left)=>{assert.equal(self,AI);assert.equal(typeof left,'boolean','CALLM must preserve getLeft multireturn arg');return [];},
  isRandomCan:(self,threshold,max)=>{assert.equal(self,AI);assert.equal(max,100);calls.push(threshold);assert.ok(decisions.length,'unexpected random call');return decisions.shift();}};
 return {A,D,AI,calls};
}
let checks=0;
for(const [options,expected,count] of [
 [{decisions:[true]},1,1],[{decisions:[false,true]},2,2],[{decisions:[false,false]},0,2],
 [{hit:1000000,decisions:[false]},2,1],[{hit:1000000,decisions:[true]},1,1],
 [{wait:1},1,0],[{sameSide:true},1,0],[{noMiss:true},1,0]
]){const {A,D,AI,calls}=pair(options),vm=new LuaVM();assert.equal(vm.runFirst(proto('getIsHit'),[AI,A,D,null,0],[uv]),expected);assert.equal(calls.length,count);checks++;}
for(const [options,expected,count] of [
 [{decisions:[false]},0,1],[{decisions:[true,true]},-1,2],[{decisions:[true,false]},1,2],
 [{speed:1000000,decisions:[true]},-1,1],[{speed:1000000,decisions:[false]},0,1],
 [{wait:1},0,0],[{sameSide:true},0,0],[{noMiss:true},0,0]
]){const {A,D,AI,calls}=pair(options),vm=new LuaVM();assert.equal(vm.runFirst(proto('getIsParry'),[AI,A,D,null,0,false],[uv]),expected);assert.equal(calls.length,count);checks++;}
for(const [threshold,roll,expected] of [[22.5,22,true],[22.5,23,false],[0,1,false],[100,100,true]]){
 let called=0;const rng={intRandBetween:(self,min,max)=>{assert.equal(self,rng);assert.equal(min,1);assert.equal(max,100);called++;return roll;}};
 assert.equal(new LuaVM().runFirst(proto('isRandomCan'),[{m_tRndCtl:rng},threshold,100]),expected);assert.equal(called,1);checks++;
}
function critRole(baseCrit,outcomes){
 const calls=[];let jitterCalls=0;
 const skill={getClass:()=> 'TL_ZS',getCrit:()=>baseCrit,getCritPercent:()=>1.5};
 const role={m_nCritFake:0,m_tHeDaoSkill:[],m_fCommonBuffs:[],
  getBattleCritProAdd:()=>multi(0,0),getZhaoShi:()=>skill,getSkillAddCrit:()=>multi(0,0),getBattleCritProMore:()=>0,
  getLifeSkillsAndProps:()=>[],getActiveTaolu:()=>null,getCritMore:()=>0,
  intRandBetween:(self,lo,hi)=>{assert.equal(self,role);assert.equal(lo,90);assert.equal(hi,110);jitterCalls++;return 100;},
  boolRand:(self,threshold)=>{assert.equal(self,role);calls.push(threshold);assert.ok(outcomes.length,'unexpected crit roll');return outcomes.shift();}};
 return {role,calls,jitterCount:()=>jitterCalls};
}
{
 const {role,calls,jitterCount}=critRole(.2,[false,false,true,false]),vm=new LuaVM();
 for(const [i,[result,fake,multiplier]] of [[false,20,1],[false,40,1],[true,-40,1.5],[false,-20,1]].entries()){
  const r=allResults(vm.run(proto('getIsCrit'),[role,123,{},null,null],[uv,{convertValue:v=>v}]));
  assert.equal(r[0],result);assert.equal(r[1],multiplier);assert.equal(role.m_nCritFake,fake);checks++;
 }
 assert.deepEqual(calls,[20,40,60,-20]);assert.equal(jitterCount(),4);
}
{
 const {role,calls,jitterCount}=critRole(1,[]),vm=new LuaVM();
 const r=allResults(vm.run(proto('getIsCrit'),[role,123,{},null,null],[uv,{convertValue:v=>v}]));
 assert.equal(r[0],true);assert.equal(r[1],1.5);assert.equal(role.m_nCritFake,0);assert.equal(jitterCount(),0);assert.equal(calls.length,0);checks++;
}
console.log('PASS '+checks+' original-bytecode branch, integer random consumption and stateful critical checks.');
