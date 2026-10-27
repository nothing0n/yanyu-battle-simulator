import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile(new URL('../dist/app.js',import.meta.url),'utf8');
const catalog=JSON.parse(await fs.readFile(new URL('../dist/data/catalog.json',import.meta.url),'utf8'));
const weaponAppearance=JSON.parse(await fs.readFile(new URL('../dist/data/weapon-appearance.json',import.meta.url),'utf8'));
const sceneCatalog=JSON.parse(await fs.readFile(new URL('../dist/data/presentation-backgrounds.json',import.meta.url),'utf8'));
const elements=new Map();
const element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',disabled:false,querySelectorAll:()=>[]});return elements.get(id);};
const context=vm.createContext({fixtureCatalog:catalog,fixtureWeaponAppearance:weaponAppearance,fixtureSceneCatalog:sceneCatalog,window:{},document:{getElementById:element,querySelectorAll:()=>[]}});
vm.runInContext(source.slice(0,source.indexOf('async function init'))+'\nnormalizeCatalog(fixtureCatalog);weaponAppearance=fixtureWeaponAppearance;sceneCatalog=fixtureSceneCatalog;createDefault();',context);
const run=code=>vm.runInContext(code,context);
test('UI default formation uses only original seven targetable stands',()=>{const config=JSON.parse(run('JSON.stringify(validateConfig(config))'));assert.equal(config.teams.ally.length,4);assert.equal(config.teams.enemy.length,4);for(const side of ['ally','enemy']){assert.ok(config.teams[side].every(r=>r.position>=0&&r.position<=6));assert.equal(new Set(config.teams[side].map(r=>r.position)).size,4);}assert.throws(()=>run('validateConfig({...config,teams:{...config.teams,ally:config.teams.ally.map((r,i)=>({...r,position:i===0?7:r.position}))}})'),/7/);});
test('seven displayed stands follow recovered camera offsets and mirror horizontally',()=>{run('renderBoard()');const expected={ally:[[4,1],[2,1],[5,2],[3,2],[1,2],[4,3],[2,3]],enemy:[[2,1],[4,1],[1,2],[3,2],[5,2],[2,3],[4,3]]};for(const side of ['ally','enemy']){const html=element(side+'Grid').innerHTML,buttons=[...html.matchAll(/<button (.*?)<\/button>/gs)];assert.equal(buttons.length,7);assert.equal((html.match(/data-role=/g)||[]).length,4);buttons.forEach((match,index)=>{const place=/grid-column:(\d+) \/ span 2;grid-row:(\d+)/.exec(match[1]);assert.ok(place);assert.deepEqual(place.slice(1).map(Number),expected[side][index]);});}});
test('configuration validates weapon attack independently and rejects duplicate positions',()=>{const config=JSON.parse(run('JSON.stringify(validateConfig(config))'));assert.ok(config.teams.ally.every(r=>r.stats.weaponAtk===0));assert.throws(()=>run('validateConfig({...config,teams:{...config.teams,ally:config.teams.ally.map(r=>({...r,position:1}))}})'),/重叠/);});

test('weapon appearance is selected from the original type-compatible skin table',()=>{const configuration=JSON.parse(run('JSON.stringify(validateConfig(config))'));for(const side of ['ally','enemy'])for(const role of configuration.teams[side]){const skill=catalog.taolu.find(x=>x.id===role.skills.wai);assert.ok(weaponAppearance.byType[skill.type].some(x=>x.id===role.weaponSkin));}assert.throws(()=>run('validateConfig({...config,teams:{...config.teams,ally:config.teams.ally.map((r,i)=>i===0?{...r,weaponSkin:999999}:r)}})'),/武器外观/);});

test('original scene selection survives configuration import and defaults to scene 10',()=>{assert.equal(run('validateConfig(config).sceneId'),10);assert.equal(run('validateConfig({...config,sceneId:1}).sceneId'),1);assert.equal(run('validateConfig({...config,sceneId:undefined}).sceneId'),10);assert.throws(()=>run('validateConfig({...config,sceneId:999999})'),/999999/);});

const optionConfig=expression=>JSON.parse(run(`JSON.stringify(validateConfig({...config,teams:{...config.teams,ally:config.teams.ally.map((r,i)=>i===0?{...r,...(${expression})}:r)}}))`));

test('import and JSON export preserve legal inner choices and refinement records',()=>{
  const value=optionConfig("{skills:{...r.skills,nei:53060},skillOptions:{wai:{jingjins:[{ID:203901,Chong:4,MaxChong:10}]},nei:{form:'yin',specialProp:1,jingjins:[{id:530601,chong:3}]}}}");
  assert.deepEqual(value.teams.ally[0].skillOptions,{wai:{jingjins:[{id:203901,chong:4,maxChong:10}]},nei:{form:'yin',specialProp:1,jingjins:[{id:530601,chong:3,maxChong:10}]}});
  context.roundtripConfig=value;
  assert.deepEqual(JSON.parse(run('JSON.stringify(validateConfig(JSON.parse(JSON.stringify(roundtripConfig))))')),value);
  const advanced=optionConfig("{skills:{...r.skills,nei:23620},skillOptions:{nei:{stage:'six-sha'}}}");
  assert.equal(advanced.teams.ally[0].skillOptions.nei.stage,'six-sha');
});

test('UI import rejects mismatched forms, stages, properties and malformed refinements',()=>{
  for(const expression of [
    "{skills:{...r.skills,nei:53060},skillOptions:{nei:{form:'yin',specialProp:2}}}",
    "{skills:{...r.skills,nei:53060},skillOptions:{nei:{form:'all'}}}",
    "{skills:{...r.skills,nei:23720},skillOptions:{nei:{form:'mixed'}}}",
    "{skills:{...r.skills,nei:23720},skillOptions:{nei:{specialProp:4}}}",
    "{skills:{...r.skills,nei:23720},skillOptions:{nei:{yuhuaChoices:{third:'both'}}}}",
    "{skills:{...r.skills,nei:23720},skillOptions:{nei:{yuhuaChoices:{unknown:'zhenyuan'}}}}",
    "{skills:{...r.skills,nei:53060},skillOptions:{nei:{yuhuaChoices:{}}}}",
    "{skills:{...r.skills,nei:23620},skillOptions:{nei:{stage:'both'}}}",
    "{skills:{...r.skills,nei:23620},skillLevels:{...r.skillLevels,nei:9},skillOptions:{nei:{stage:'six-sha'}}}",
    "{skills:{...r.skills,nei:53060},skillLevels:{...r.skillLevels,nei:9},skillOptions:{nei:{form:'yin'}}}",
    "{skills:{...r.skills,nei:23620},skillOptions:{nei:{specialProp:1}}}",
    "{skillOptions:{wai:{stage:'six-sha'}}}",
    "{skillOptions:{nei:{jingjins:[{id:1,chong:11}]}}}",
    "{skillOptions:{wai:{jingjins:[{id:203901,chong:1},{id:203901,chong:2}]}}}",
    "{skillOptions:{wai:{jingjins:[{id:203901,chong:3,maxChong:2}]}}}",
    "{skillOptions:{wai:{jingjins:[{id:203901,ID:203902,chong:1}]}}}",
    "{skillOptions:{unknown:{}}}",
  ])assert.throws(()=>optionConfig(expression),/体态|属性|招式|选项|精进|十重|选择/);
});

test('changing a skill clears its old form, stage and refinements while retaining other categories',()=>{
  run("var changingRole=JSON.parse(JSON.stringify(config.teams.ally[0]));changingRole.skills.nei=53060;changingRole.skillOptions={wai:{jingjins:[{id:203901,chong:4,maxChong:10}]},nei:{form:'yang',specialProp:2,jingjins:[{id:530601,chong:3,maxChong:10}]}};changeRoleSkill(changingRole,'nei',23620);");
  assert.deepEqual(JSON.parse(run('JSON.stringify(changingRole.skillOptions)')),{wai:{jingjins:[{id:203901,chong:4,maxChong:10}]},nei:{stage:'four-sha'}});
  run("changeRoleSkill(changingRole,'nei',23720)");
  assert.deepEqual(JSON.parse(run('JSON.stringify(changingRole.skillOptions.nei)')),{specialProp:3,yuhuaChoices:{second:'yangyu',third:'zhenyuan',fourth:'benshou',fifth:'diyu'}});
  run("changeRoleSkill(changingRole,'nei',53060)");
  assert.deepEqual(JSON.parse(run('JSON.stringify(changingRole.skillOptions.nei)')),{form:'mixed',specialProp:3});
  run("changeRoleSkill(changingRole,'nei',22010)");
  assert.equal(run('Object.hasOwn(changingRole.skillOptions,\'nei\')'),false);
  assert.equal(run('changingRole.skillOptions.wai.jingjins[0].chong'),4);
});

test('inner controls show only the applicable selection with legal defaults',()=>{
  const html=id=>run(`innerSkillOptionsControl({...config.teams.ally[0],skills:{...config.teams.ally[0].skills,nei:${id}},skillOptions:{}})`);
  const gui=html(53060),yu=html(23720),dao=html(23620);
  assert.match(gui,/id="innerForm"/);assert.match(gui,/value="mixed" selected/);assert.doesNotMatch(gui,/id="innerProp"|id="innerStage"/);
  assert.match(yu,/id="innerProp"/);assert.match(yu,/value="3" selected/);assert.doesNotMatch(yu,/id="innerForm"|id="innerStage"/);
  for(const field of ['second','third','fourth','fifth'])assert.match(yu,new RegExp(`id="yuhua-${field}"`));
  assert.match(dao,/id="innerStage"/);assert.match(dao,/value="four-sha" selected/);assert.doesNotMatch(dao,/id="innerForm"|id="innerProp"/);
  assert.equal(html(22010),'');
});

test('import preserves all independent yuhua route choices and fills only omitted defaults',()=>{
  const custom=optionConfig("{skills:{...r.skills,nei:23720},skillOptions:{nei:{specialProp:1,yuhuaChoices:{second:'suoqi',third:'zhenliu',fourth:'wending',fifth:'jinghua'}}}}");
  assert.deepEqual(custom.teams.ally[0].skillOptions.nei,{specialProp:1,yuhuaChoices:{second:'suoqi',third:'zhenliu',fourth:'wending',fifth:'jinghua'}});
  const partial=optionConfig("{skills:{...r.skills,nei:23720},skillOptions:{nei:{yuhuaChoices:{fourth:'bishou'}}}}");
  assert.deepEqual(partial.teams.ally[0].skillOptions.nei.yuhuaChoices,{second:'yangyu',third:'zhenyuan',fourth:'bishou',fifth:'diyu'});
});

test('lowering inner level restores a legal form or stage without dropping refinements',()=>{
  run("var loweringRole=JSON.parse(JSON.stringify(config.teams.ally[0]));loweringRole.skills.nei=53060;loweringRole.skillOptions={nei:{form:'yin',specialProp:1,jingjins:[{id:530601,chong:3,maxChong:10}]}};changeRoleSkillLevel(loweringRole,'nei',9)");
  assert.equal(run('loweringRole.skillLevels.nei'),9);
  assert.deepEqual(JSON.parse(run('JSON.stringify(loweringRole.skillOptions.nei)')),{form:'mixed',specialProp:3,jingjins:[{id:530601,chong:3,maxChong:10}]});
  run("changeRoleSkill(loweringRole,'nei',23620);changeRoleSkillLevel(loweringRole,'nei',10);loweringRole.skillOptions.nei.stage='six-sha';changeRoleSkillLevel(loweringRole,'nei',9)");
  assert.equal(run('loweringRole.skillOptions.nei.stage'),'four-sha');
});

test('web imports reject native state and learned assumptions instead of falling back to a manual panel',()=>{
  for(const field of ['savedState','learnedAssumptions','assumedSkills','freezeTimeSource','pvp','Neis','Equips','nativeState']){
    assert.throws(()=>optionConfig(`{${field}:null}`),/本地CLI/);
  }
  assert.throws(()=>optionConfig('{savedState:{ID:1,Level:100},stats:undefined}'),/本地CLI/);
  const manual=optionConfig("{skills:{...r.skills,nei:23720},skillOptions:{nei:{specialProp:2,jingjins:[{id:237201,chong:5}]}}}");
  assert.equal(manual.teams.ally[0].skillOptions.nei.specialProp,2);
  assert.equal(manual.teams.ally[0].skillOptions.nei.jingjins[0].chong,5);
});

test('skill editor tells users that route and inner changes do not recalculate the entered panel',()=>{
  run("selected={side:'ally',uid:config.teams.ally[0].uid};renderEditor()");
  const html=element('editorContent').innerHTML;
  assert.match(html,/手工最终面板不会随内功、体态或招式路线自动重算/);
  assert.match(html,/请按该搭配重新填写面板；统计仅针对所填面板/);
});
