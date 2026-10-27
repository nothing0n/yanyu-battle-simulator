import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRuntime} from '../dist/engine/runtime.mjs';
import {createBattleRole} from '../dist/integration/actors.mjs';
import {resolveSkillSelection,applySkillSelection} from '../dist/integration/skill-selection.mjs';

const rt=await createRuntime({readJSON:async url=>JSON.parse(fs.readFileSync(url,'utf8').replace(/^\uFEFF/,'')),seed:12345});
rt.require('app/ai/JHAIConfig');
const stats={hp:40000,atk:10000,def:7000,speed:1600,hit:1600,dodge:1000,parry:1000,mp:50,mpBack:8,str:300,dex:300,con:300,int:300};
const ids=list=>[...list.entries.values()].map(move=>rt.firstMethod(move,'getID'));
const make=(nei,options={},chong=10,extra={})=>createBattleRole(rt,{roleId:10010,name:'主角',level:90,position:0,skills:{wai:21750,nei},skillLevels:{wai:10,nei:chong},skillOptions:{nei:options},stats,...extra},true,0);
const skill=(role,id)=>rt.firstMethod(role,'getWG',id);
const moves=(role,id)=>ids(rt.firstMethod(skill(role,id),'getZhaos'));
const buffs=role=>ids(rt.firstMethod(role,'getCommonBuffs'));

// Exact lists come from original 73460 acquisition and ReZhaoShi event calls,
// rather than from the adapter's selection implementation.
for(const [form,prop,expected,start] of [
  ['mixed',3,[53061,53062,53063,53064,53065],1813],
  ['yin',1,[53061,53066,53068,53064,53065],1815],
  ['yang',2,[53061,53067,53069,53064,53065],1814],
]){
  const role=await make(53060,{form});
  assert.deepEqual(moves(role,53060),expected);
  assert.equal(rt.firstMethod(skill(role,53060),'getProp'),prop);
  assert.deepEqual(buffs(role).filter(id=>[1813,1814,1815].includes(id)),[start]);
  assert.equal(rt.firstMethod(role,'getBattleMpBack'),form==='yin'?9:8);
}
await assert.rejects(()=>make(53060,{form:'yin'},9),/大圆满/);
assert.throws(()=>resolveSkillSelection(rt,{key:'nei',id:53060,options:{form:'yin',specialProp:3}}),/不一致/);

const healing=[];
for(const [stage,expected] of [
  ['four-sha',[23621,23622,23623,23624,23625]],
  ['five-sha',[23621,23622,23626,23624,23625]],
  ['six-sha',[23621,23622,23626,23627,23625]],
]){
  const role=await make(23620,{stage});
  assert.deepEqual(moves(role,23620),expected);
  const sources=rt.firstMethod(skill(role,23620),'getMoreAttack');
  assert.equal(sources.entries.size,1,'Only one drinking-blood attack version may be active');
  healing.push(rt.firstMethod(role,'getBattleHpBack'));
}
assert.deepEqual(healing,[416,416,583],'Original curmp healing must use one stage, not 416+583');
await assert.rejects(()=>make(23620,{stage:'five-sha'},9),/十重/);

const originalYuhua=await make(23720);
assert.deepEqual(moves(originalYuhua,23720),[23721,23722,23723,23724,23725,23726,23727]);
const ownedYuhua=await make(23720,{yuhuaChoices:{third:'zhenliu',fourth:'wending'},specialProp:1});
assert.deepEqual(moves(ownedYuhua,23720),[23721,23722,123724,123726,23725,23726,23727]);
assert.equal(rt.firstMethod(skill(ownedYuhua,23720),'getProp'),1);
// An explicit change to one owned slot retains every other serialized choice.
applySkillSelection(rt,skill(ownedYuhua,23720),resolveSkillSelection(rt,{key:'nei',id:23720,options:{yuhuaChoices:{fourth:'bishou'}}}),{actor:ownedYuhua});
assert.deepEqual(moves(ownedYuhua,23720),[23721,23722,123724,123725,23725,23726,23727]);
assert.equal(rt.firstMethod(skill(ownedYuhua,23720),'getProp'),1);
const alternatives=await make(23720,{yuhuaChoices:{second:'suoqi',third:'zhenshan',fourth:'bishou',fifth:'jinghua'}});
assert.deepEqual(moves(alternatives,23720),[23721,123721,123723,123725,123727,123728,123729]);
const blood=await make(23720,{yuhuaChoices:{second:'yingxue'}});
assert.equal(moves(blood,23720)[1],123722,'Original event order differs from numeric ID order');

const refinements=[{ID:217501,Chong:4,MaxChong:10},{ID:217502,Chong:1,MaxChong:10},{ID:217503,Chong:10,MaxChong:10}];
const full=await make(23720,{},10,{skillOptions:{wai:{jingjins:refinements},nei:{jingjins:[{id:237201,chong:5},{id:237203,chong:10}]}}});
assert.deepEqual(moves(full,21750),[21751,21752,21753,21754,21755,21756,21757,21758,21759,121753,121751,121752]);
const jj=rt.firstMethod(skill(full,21750),'getJingjins');
assert.deepEqual([...jj.entries.values()].map(item=>[rt.firstMethod(item,'getID'),rt.firstMethod(item,'getChong'),rt.firstMethod(item,'getMaxChong')]),[[217501,4,10],[217502,1,10],[217503,10,10]]);
const low=await make(23720,{},10,{skillLevels:{wai:6,nei:10}});
const activeLow=ids(rt.firstMethod(low,'getActiveZS'));
assert(activeLow.includes(121753));assert(!activeLow.includes(121751));assert(!activeLow.includes(121752));
const activeFull=ids(rt.firstMethod(full,'getActiveZS'));
assert(activeFull.includes(121751));assert(activeFull.includes(121752));

for(const input of [
  {key:'nei',id:23720,options:{form:'mixed'}},
  {key:'nei',id:53060,options:{stage:'six-sha'}},
  {key:'nei',id:23620,options:{specialProp:3}},
  {key:'nei',id:23620,options:{yuhuaChoices:{third:'zhenliu'}}},
  {key:'wai',id:21750,options:{jingjins:[{id:237201,chong:5}]}},
  {key:'wai',id:21750,options:{jingjins:[{id:217501,chong:11}]}},
  {key:'wai',id:21750,options:{jingjins:[{id:217501,chong:1},{id:217501,chong:2}]}},
  {key:'nei',id:23720,options:{yuhuaChoices:{third:'unknown'}}},
  {key:'nei',id:23720,options:{unknown:1}},
  {key:'wai',id:23720,options:{}},
])assert.throws(()=>resolveSkillSelection(rt,input));
console.log(JSON.stringify({pass:true,guiyunForms:3,daoxinStages:3,daoxinHealingAtMp50:healing,yuhuaIndependentChoices:true,duotiandiFullMoves:12,originalRefinementsRestored:true}));
