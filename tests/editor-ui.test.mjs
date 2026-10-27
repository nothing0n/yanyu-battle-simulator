import assert from 'node:assert/strict';
import {test}from'node:test';
import {readFile}from'node:fs/promises';
import {createWorkbench}from'../dist/ui/editor-workbench.mjs';

test('editor validates atomic configuration changes and recalculates native panels',async()=>{
 const priorDocument=globalThis.document;
 globalThis.document={getElementById:()=>null};
 let config={teams:{ally:[],enemy:[]}},changes=0;
 const wb=await createWorkbench({
  readJSON:async url=>JSON.parse((await readFile(url,'utf8')).replace(/^\uFEFF/,'')),
  getConfig:()=>config,validateSceneId:id=>Number(id||10),normalizeManualRole:row=>row,
  busy:()=>false,toast:()=>{},selected:()=>null,updateButtons:()=>{},panelsChanged:()=>{},
  replaceConfig:next=>{config=next;changes++},selectRole:()=>{}
 });
 try{
  config=wb.createDefault();
  assert.equal(config.fightType,2);assert.equal(config.maxRounds,100);
  assert.equal(config.presetIds.ally,'reference');assert.equal(config.teams.ally.length,4);
  assert.equal(config.teams.enemy.length,4);assert.equal(wb.getState().presetCount,5);
  const initialAlly=JSON.stringify(config.teams.ally);
  for(const preset of wb.presets){wb.loadTeam('enemy',preset.id);assert.equal(JSON.stringify(config.teams.ally),initialAlly);}
  assert.equal(changes,5);
  const current=JSON.stringify(config);
  function rejects(mutate,pattern){const candidate=JSON.parse(current);mutate(candidate);assert.throws(()=>wb.validateConfig(candidate),pattern);assert.equal(JSON.stringify(config),current);}
  rejects(c=>c.teams.enemy[0].uid=c.teams.ally[0].uid,/uid/);
  rejects(c=>c.version=999,/版本/);
  rejects(c=>c.teams.enemy[1].position=c.teams.enemy[0].position);
  rejects(c=>c.teams.enemy[0].build.secrets.push({...c.teams.enemy[0].build.secrets[0]}));
  rejects(c=>c.teams.enemy[0].stats={hp:999999},/手工面板/);
  rejects(c=>c.teams.enemy[0].build.profile=JSON.parse('{"__proto__":{"polluted":true}}'),/保留/);
  assert.equal({}.polluted,undefined);
  const started=Date.now();await wb.ensurePanels();
  assert.equal(wb.pending,false);assert.equal(wb.hasErrors,false);
  const role=config.teams.ally[0],hp=wb.getStats(role).hp;
  assert(hp>1000);assert(!Object.hasOwn(role,'stats'));
  role.build.equipment[0].base.hp+=1000;
  assert.equal(wb.getPanel(role),null,'a changed build must invalidate the previous panel');
  await wb.ensurePanels();assert(wb.getStats(role).hp>hp,'equipment values must enter original getters');
  const shown=wb.presentationConfig(config);assert(shown.teams.ally[0].stats.hp>hp);
  assert(!Object.hasOwn(role,'stats'),'presentation must not change exported native builds');
  role.weaponSkin=Number(role.weaponSkin||0)+1;
  assert(wb.getPanel(role),'cosmetic changes must not invalidate battle panels');
  console.log(`Native editor panel verification: ${Date.now()-started}ms; no combat batch started.`);
 }finally{wb.dispose();if(priorDocument===undefined)delete globalThis.document;else globalThis.document=priorDocument;}
});
