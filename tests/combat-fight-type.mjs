import fs from 'node:fs';
import assert from 'node:assert/strict';
import {runOriginalBattle,resolveFightType} from '../dist/engine/battle-runner.mjs';
import {createRuntime} from '../dist/engine/runtime.mjs';
import {createBattleRole} from '../dist/integration/actors.mjs';
import {buildTasks} from '../tools/compare-inner.mjs';

const cache=new Map();
const readJSON=async url=>{const k=String(url);if(!cache.has(k))cache.set(k,JSON.parse(fs.readFileSync(url,'utf8')));return cache.get(k);};
assert.equal(resolveFightType({}),1,'Legacy default must stay unchanged');
assert.equal(resolveFightType({fightType:2}),2);
for(const value of [0,3,'2',false,NaN])assert.throws(()=>resolveFightType({fightType:value}),/fightType/);

const role=(uid,id)=>({uid,roleId:id,name:uid,level:90,position:0,
  skills:{wai:20010,nei:22010,qing:24010},skillLevels:{wai:10,nei:10,qing:10},
  stats:{hp:10000,atk:4500,def:2500,speed:700,hit:1000,dodge:500,parry:650,mp:30,mpBack:10,str:200,dex:200,con:200,int:200}});
// Wiring check only: intercept the start boundary, never execute combat turns.
for(const type of [undefined,1,2]){
  const observed=[];
  const config={seed:1001,maxRounds:100,teams:{ally:[role('a',10011)],enemy:[role('b',10012)]}};
  if(type!==undefined)config.fightType=type;
  const result=await runOriginalBattle(config,{readJSON,createBattleRole:async(rt,row,left,index)=>{
    rt.vm.set(rt.require('app/ai/JHAITest'),'startBattle',(ai,_skip,callback)=>{
      observed.push(rt.vm.get(ai,'m_nFightType'));
      rt.vm.call(callback,[rt.vm.table({}),'Left',1]);
    });
    return createBattleRole(rt,row,left,index);
  }});
  assert.deepEqual(observed,[type??1]);
  assert.equal(result.metadata.fightType,type??1);
  assert.equal(result.metadata.serverArenaModeValidated,false);
  assert.equal(result.metadata.originalBattleValidated,false);
  assert.equal(result.metadata.frames,0,'Wiring test must not be counted as a full fight');
}

// Exercise original Result branch with dependency stubs; do not replace its rule.
const rt=await createRuntime({readJSON});
rt.require('app/ai/JHAIConfig');
const ai=rt.instantiate('app/ai/JHAITest');
rt.vm.set(ai,'checkAllDie',()=>false);
rt.vm.set(ai,'addBattleReward',()=>{});
rt.vm.set(ai,'sendBattleMsg',()=>{});
const boundary=[];
for(const [type,round,expected] of [[1,51,'Left'],[2,50,'Left'],[2,51,'Right']]){
  rt.callMethod(ai,'setFightType',type);
  rt.vm.set(ai,'m_nRound',round);
  rt.vm.set(ai,'m_bStatus',4); // Result constant in original JHBaseAI root TDUP.
  let seen;
  rt.vm.set(ai,'endBattle',(_ai,win,rounds)=>{seen={win,rounds};});
  rt.callMethod(ai,'onUpdate');
  assert.deepEqual(seen,{win:expected,rounds:round});
  boundary.push({type,round,win:seen.win});
}

const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/inner-benchmark.json',import.meta.url),'utf8'));
for(const type of [undefined,1,2]){
  const f=structuredClone(fixture);
  if(type!==undefined)f.fightType=type;
  const built=buildTasks(f,{},[1001]);
  assert(built.tasks.length>0);
  assert(built.tasks.every(t=>t.config.fightType===(type??1)),'Batch dispatcher must preserve explicit AI type');
}
// One controlled terminal regression, never part of any inner-skill comparison.
const fortress=uid=>{const r=role(uid,uid==='left'?10011:10012);Object.assign(r.stats,{hp:1000000,atk:1,def:1000000});return r;};
const terminal=await runOriginalBattle({seed:1001,fightType:2,maxRounds:100,teams:{ally:[fortress('left')],enemy:[fortress('right')]}},{readJSON,frameBudget:120000});
assert.equal(terminal.metadata.roundLimitReached,false,'Original termination must run before host safety cap');
assert.equal(terminal.rounds,51);
assert.equal(terminal.winner,'enemy');
assert(terminal.stats.every(s=>s.hp>0),'This case must terminate by the original round rule, not actor death');
assert(terminal.rawMessages.some(m=>m.type==='over'&&m.win==='Right'));
console.log(JSON.stringify({ok:true,scope:'Wiring, original terminal branch and one controlled cutoff regression; no inner-skill comparison',boundary,nativeCutoff:{rounds:terminal.rounds,winner:terminal.winner,bothAlive:true,hostLimited:false},serverArenaModeValidated:false}));
