import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRuntime} from '../dist/engine/runtime.mjs';
import {luaToJSON} from '../dist/engine/battle-runner.mjs';
import {compileLiteral} from '../dist/integration/lua-literal.mjs';
import {FORMATION_GRID,loadFormationCatalog,getFormation,getRoleStand,validateFormationTeam,reflowFormationTeam,applyFormationToSavedRow,applyFormationToActor} from '../dist/integration/formations.mjs';

const readJSON=async url=>JSON.parse(fs.readFileSync(url,'utf8').replace(/^\uFEFF/,''));
const catalog=await loadFormationCatalog(readJSON);
assert.deepEqual(catalog.geometry,FORMATION_GRID);
assert.equal(catalog.coveredLevels.gameMaximumVerified,false);
assert.deepEqual(catalog.formations.map(f=>f.id),[508,515,519,520]);
const actors=[{roleId:10010,position:4,build:{level:100}},{roleId:10060,position:6,build:{level:100}},{roleId:10059,position:3,build:{level:100}},{roleId:10057,position:5,build:{level:100}}];
assert(validateFormationTeam(catalog,{id:519,level:3},actors).valid);
assert(!validateFormationTeam(catalog,{id:508,level:3},actors).valid);
assert(!validateFormationTeam(catalog,{id:519,level:10},actors).valid);
assert(!validateFormationTeam(catalog,{id:519,level:0},actors).valid);
assert(!validateFormationTeam(catalog,{id:519,level:3},actors.slice(0,3)).valid);
const collision=structuredClone(actors);collision[1].position=collision[0].position;
assert(validateFormationTeam(catalog,{id:519,level:3},collision).issues.some(i=>i.code==='stand-duplicate'));
const sourceText=JSON.stringify(actors);
for(const[id,preset,expected]of [
 [508,'general',[2,7,1,6]],[515,'general',[5,7,3,6]],[519,'general',[5,7,4,6]],
 [508,'yijian',[1,2,4,6]],[515,'yijian',[3,5,6,7]],[520,'yijian',[3,5,1,7]],
]){
 const result=reflowFormationTeam(catalog,{id,level:3},actors,{preset,keepExisting:false});
 assert(result.validation.valid,id+'/'+preset);
 assert.deepEqual(result.roles.map(getRoleStand),expected,id+'/'+preset);
 assert(result.roles.every(r=>r.formation.id===id&&r.formation.level===3));
 assert(result.roles.every(r=>!r.savedState),'Public build remains a public build.');
}
assert.equal(JSON.stringify(actors),sourceText,'Reflow never mutates caller rows.');
const preserved=reflowFormationTeam(catalog,{id:519,level:3},actors,{keepExisting:true});
assert.deepEqual(preserved.roles.map(getRoleStand),[5,7,4,6]);assert.equal(preserved.moves.length,0);
const noEye=[1,2,3,5].map((stand,i)=>({...actors[i],position:stand-1}));
const noEyeValidation=validateFormationTeam(catalog,{id:519,level:3},noEye);
assert(noEyeValidation.valid,'The original UI allows the slots; missing eye is an activation warning.');
assert.equal(noEyeValidation.activation.eyeOccupied,false);assert(noEyeValidation.warnings.length);
const raw={uid:'synthetic',position:0,savedState:{Stand:1,Zhen:508,ZhenLv:1,Str:77}};
const adapted=applyFormationToSavedRow(raw,{id:515,level:2},7,{catalog});
assert.deepEqual(adapted.savedState,{Stand:7,Zhen:515,ZhenLv:2,Str:77});
assert.equal(adapted.position,6);assert.equal(raw.savedState.Stand,1);
assert.throws(()=>applyFormationToSavedRow(raw,{id:515,level:3},1,{catalog}),/未开放/);
assert.equal(catalog.teamPresets.length,5);
for(const team of catalog.teamPresets){assert.equal(team.formations.length,3);for(const f of team.formations){const roles=Object.entries(f.stands).map(([roleKey,stand])=>({roleKey,stand}));assert(validateFormationTeam(catalog,f,roles).valid);}}

// Two native synthetic actors, no battle scheduling. Verify actual fields and
// original getter buff selection rather than only web labels.
const rt=await createRuntime({readJSON,seed:827,nowSeconds:1700000000});
rt.require('app/ai/JHAIConfig');
rt.vm.globals.loadstring=s=>compileLiteral(rt.vm,s);
const left=rt.instantiate('app/data/JHBattleData'),right=rt.instantiate('app/data/JHBattleData');
rt.callMethod(left,'initWithID',10010);rt.callMethod(right,'initWithID',10060);
for(const f of catalog.formations){
 const original=rt.configFor('zhenxing'),config=rt.vm.get(original,String(f.id))||rt.vm.get(original,f.id);
 assert(config,'Native formation config exists.');
 assert.equal(rt.vm.get(config,'name'),f.name);
 for(const slot of FORMATION_GRID)assert.equal(rt.vm.get(config,'locat'+slot.stand)!=null,f.allowedSlots.includes(slot.stand));
}
const props=actor=>luaToJSON(rt.firstMethod(actor,'getZhenProp'));
const occupation=stands=>{const value=rt.vm.table();for(const stand of stands)value.rawset(stand,true);return value;};
const buffs=(actor,stands)=>[...rt.firstMethod(actor,'getZhenBuffs',occupation(stands)).entries.values()];
applyFormationToActor(rt,left,{id:519,level:1},4,{catalog});rt.callMethod(left,'resetBattle');
assert.equal(rt.vm.get(left,'m_nZhen'),519);assert.equal(rt.vm.get(left,'m_nZhenLv'),1);
assert(Math.abs(props(left).find(p=>p[0]==='mp_back')[1]+1/3)<1e-9);
assert.deepEqual(buffs(left,[1,2,4,5]),[],'Level1 has no formation first/round buffs.');
applyFormationToActor(rt,left,{id:519,level:3},4,{catalog});
assert.equal(props(left).find(p=>p[0]==='mp_back')[1],-1);
assert(buffs(left,[1,2,4,5]).includes(3045),'Eye buff comes from original getter.');
applyFormationToActor(rt,right,{id:519,level:3},5,{catalog});
assert(buffs(right,[4,5,6,7]).includes(3044),'Presence of stand4 activates original linked effect.');
assert(!buffs(right,[1,5,6,7]).includes(3044),'Missing eye does not manufacture linked effect.');
applyFormationToActor(rt,left,{id:515,level:3},3,{catalog});
assert(buffs(left,[3,5,6,7]).includes(1121));
assert.equal(rt.vm.get(right,'m_nZhen'),519,'Both sides have independent formation fields.');
applyFormationToActor(rt,left,{id:508,level:3},4,{catalog});
assert(buffs(left,[1,2,4,6]).includes(282));
assert(!buffs(left,[4]).includes(282),'Center conditional effect is not unconditional.');
applyFormationToActor(rt,left,{id:520,level:3},1,{catalog});
assert(buffs(left,[1,3,5,7]).includes(3215));
assert(!buffs(left,[1,5,7]).includes(3215),'Four-season ally condition is read by original getter.');
const dataText=fs.readFileSync(new URL('../dist/data/formations.json',import.meta.url),'utf8');
assert(!/OnlyID|savedState|private-analysis|Users[\\/]|root\/\d|wapp__/i.test(dataText));
console.log('Formation rules: public geometry/presets, reflow, levels1–3 and native getter activation passed; 2 synthetic actors, 0 battles.');
