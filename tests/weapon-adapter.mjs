import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRuntime} from '../dist/engine/runtime.mjs';
import {createBattleRole} from '../dist/integration/actors.mjs';
import {attachPanelWeapon} from '../dist/integration/weapon.mjs';
const rt=await createRuntime({readJSON:async u=>JSON.parse(fs.readFileSync(u,'utf8')),seed:1001});rt.require('app/ai/JHAIConfig');
const cases=[{id:20020,name:'基础剑法',zhao:20021},{id:20300,name:'狂风剑法',zhao:20301},{id:20530,name:'幻影无形剑',zhao:20531},{id:20030,name:'基础刀法',zhao:20031},{id:20390,name:'太虚神悟刀',zhao:20391},{id:20120,name:'齐眉棍',zhao:20121}];
const report=[];
for(const t of cases){
 const input={roleId:10012,level:90,skills:{wai:t.id},stats:{hp:18000,atk:4500,def:2500,speed:700,hit:1000,dodge:500,parry:650,mp:200,mpBack:10}};
 const role=await createBattleRole(rt,input,true,0);
 // Isolate the original missing-equipment regression even after actors auto-equip.
 rt.vm.set(role,'m_tEquips',rt.vm.table([]));
 const before=rt.firstMethod(role,'getUseZSWeapon');
 const beforeIds=[...(before?.entries?.values()||[])].map(x=>rt.firstMethod(x,'getID'));
 const weapon=attachPanelWeapon(rt,role,{weaponAtk:0});
 const after=rt.firstMethod(role,'getUseZSWeapon');
 const afterIds=[...(after?.entries?.values()||[])].map(x=>rt.firstMethod(x,'getID'));
 assert.equal(beforeIds.includes(t.zhao),false);assert.equal(afterIds.includes(t.zhao),true);
 for(const name of ['getMainAtk','getAttack','getMainHit','getMainDef','getMoreBlood','getMoreDefIgnore','getCritMore','getMoreSwordAdd','getMoreBladeAdd'])assert.equal(rt.firstMethod(weapon,name),0,name);
 report.push({skill:t.id,weaponType:rt.firstMethod(weapon,'getType'),weaponId:rt.firstMethod(weapon,'getID'),before:beforeIds,after:afterIds});
}
const raw=await createBattleRole(rt,{roleId:10012,level:90,skills:{wai:20020}},true,0);
rt.vm.set(raw,'m_tEquips',rt.vm.table([]));
const panelWeapon=attachPanelWeapon(rt,raw,{weaponAtk:750});
assert.equal(rt.firstMethod(panelWeapon,'getMainAtk'),750);
console.log(JSON.stringify({pass:true,explicitWeaponAttack:750,report},null,2));
