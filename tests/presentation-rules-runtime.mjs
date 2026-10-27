import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRuntime} from '../dist/engine/runtime.mjs';
import {runOriginalBattle} from '../dist/engine/battle-runner.mjs';
import {createMotionPlanner} from '../dist/presentation/motion-planner.mjs';
import {createSceneEffectPlanner} from '../dist/presentation/scene-effect-planner.mjs';
import {createEffectPlanner} from '../dist/presentation/effect-planner.mjs';
import {createPresentationPlanner} from '../dist/presentation/action-planner.mjs';
import {buildTimeline} from '../dist/presentation/timeline.mjs';
import {loadCocosTimelines} from '../dist/presentation/cocos-timeline.mjs';
import {createFloatingTextRecorder,resolveAtlasFont} from '../dist/presentation/floating-text.mjs';
import {createReactionResolver} from '../dist/presentation/reactions.mjs';

const readJSON=async url=>JSON.parse(fs.readFileSync(url,'utf8'));
const assets=await readJSON(new URL('../dist/data/presentation-assets.json',import.meta.url));
assert.deepEqual(Object.keys(assets).sort(),['audio','backgrounds','fonts','spines','spriteSheets']);
const fontPaths=['fonts/num_atk.png','fonts/num_hit.png','fonts/num_recover.png','fonts/num_mp.png'];
for(const path of fontPaths)assert.equal(resolveAtlasFont(assets,path)?.inputPath,path);
assert.equal(resolveAtlasFont(assets,'fonts/missing.png'),undefined);
const floating=await createFloatingTextRecorder({readJSON});
let labelFonts=0;
for(const args of [[false,1,-123,false,0],[false,1,123,false,0],[false,0,-123,false,0]]){
 const record=floating.record('addHp',args);
 for(const node of record.nodes.filter(n=>n.kind==='LabelAtlas')){
  assert.ok(resolveAtlasFont(assets,node.path),'Unmapped original LabelAtlas '+node.path);labelFonts++;
 }
}
assert.ok(labelFonts>0);
const cocos=await loadCocosTimelines({readJSON});
assert.equal(cocos.data.frameIntervalSeconds,0.01666666753590107);
assert.ok(!Object.hasOwn(cocos.data,'nativeTiming'));
let cocosSamples=0;
for(const [path,asset]of Object.entries(cocos.data.assets)){
 const endMs=asset.durationFrames*cocos.data.frameIntervalSeconds/asset.timeSpeed*1000;
 for(const t of [0,endMs/2,endMs]){
  const sample=cocos.sample(path,t);assert.ok(Number.isFinite(sample.frame));assert.ok(sample.nodes.length>0);cocosSamples++;
 }
 const final=cocos.sample(path,endMs);assert.equal(final.frame,asset.durationFrames);assert.equal(final.finished,true);
}
const moveResolver=await createReactionResolver({readJSON});
for(const kind of [1,2]){
 const move=moveResolver.planMoveAnimations({timeSpeed:1},kind,.5,true),prefix=kind===1?'move':'moveback';
 assert.deepEqual(move.events.filter(e=>e.method==='playAnimation').map(e=>e.animationName),[prefix+'_up',prefix+'_loop',prefix+'_down']);
 assert.ok(Math.abs(move.durationMs-500)<1e-9);assert.equal(move.events.at(-1).method,'playBattleIdle');
}
const rules=await readJSON(new URL('../dist/data/presentation-rules.json',import.meta.url));
assert.deepEqual(Object.keys(rules).sort(),['animation','formation']);
assert.deepEqual(Object.keys(rules.formation).sort(),['center','positions']);
assert.deepEqual(rules.formation.positions.map(p=>p.stand),[1,2,3,4,5,6,7]);
for(const row of rules.formation.positions)assert.deepEqual(Object.keys(row).sort(),['offsetX','offsetY','stand']);
for(const row of rules.animation.idle.variants){
 assert.deepEqual(Object.keys(row).sort(),['calls','input']);
 assert.ok(row.calls.length&&row.calls.every(call=>call.method==='playAnimation'));
}

const runtime=await createRuntime({readJSON});runtime.require('app/ai/JHAIConfig');
const roleBundle=await readJSON(new URL('../dist/presentation/bundles/JHBaseRole.json',import.meta.url));
runtime.vm.load(roleBundle,'app/module/spine/JHBaseRole');
const motion=createMotionPlanner(runtime,roleBundle,rules);
const effects=createEffectPlanner(runtime,roleBundle,{pointFor:motion.pointFor,center:rules.formation.center});
// These points are the original pre-projection module outputs, not a second
// implementation of the placement formula. Exercise the actual module API.
const expectedLeft=[[779,260],[629,260],[854,199],[704,200],[554,201],[779,140],[629,140]];
const expectedRight=[[1269,260],[1419,260],[1194,199],[1344,200],[1494,201],[1269,140],[1419,140]];
let geometry=0,attackEffects=0;
for(const left of [true,false])for(let stand=1;stand<=7;stand++){
 const [x,y]=(left?expectedLeft:expectedRight)[stand-1],owner={BattleID:1,Stand:stand,left};
 const point=motion.pointFor(owner);assert.deepEqual(point,{x,y});geometry++;
 const actor={owner,point},targetOwner={BattleID:2,Stand:4,left:!left};
 const target={owner:targetOwner,point:motion.pointFor(targetOwner)};
 const phase={animation:'attack_sword1',effectVariant:1,timeScale:1};
 const world=effects.planEffects({...phase,attackType:1},actor,[target],10001).effects[0];
 assert.ok(world);assert.equal(world.anchor,'world');assert.deepEqual(world.point,point);attackEffects++;
 const attached=effects.planEffects({...phase,attackType:22},actor,[target],10001).effects[0];
 assert.ok(attached);assert.equal(attached.anchor,'actor');assert.deepEqual(attached.point,{x:0,y:0});attackEffects++;
}
assert.throws(()=>motion.pointFor({Stand:0,left:true}),/Unknown original formation stand/);
assert.throws(()=>motion.pointFor({Stand:8,left:false}),/Unknown original formation stand/);

const cameraBundle=await readJSON(new URL('../dist/presentation/bundles/JHBattleCamera.json',import.meta.url));
const scene=createSceneEffectPlanner(runtime,cameraBundle,rules);
for(const left of [true,false]){
 const item=scene.plan({tag:'centerspine_down',effect:'effect_txswd',left})[0];
 assert.deepEqual(item.point,{x:left?704:1344,y:200});
 assert.equal(item.layer,'belowActors');assert.equal(item.loop,false);
}
// Deleting stand must fail in both real consumers. This guards the regression
// that a formula-only projection audit previously failed to notice.
const bad=structuredClone(rules);for(const row of bad.formation.positions)delete row.stand;
const badMotion=createMotionPlanner(runtime,roleBundle,bad);
assert.throws(()=>badMotion.pointFor({Stand:1,left:true}),/Unknown original formation stand/);
const badScene=createSceneEffectPlanner(runtime,cameraBundle,bad);
assert.throws(()=>badScene.plan({tag:'centerspine_down',effect:'effect_txswd',left:true}),/stand is not bound/);

const config=await readJSON(new URL('./fixtures/ui-default-config.json',import.meta.url));
const result=await runOriginalBattle(config,{readJSON});
const planner=await createPresentationPlanner({readJSON});
const timeline=await buildTimeline(result,{readJSON,planner});
assert.equal(timeline.logicFps,15);assert.equal(timeline.actors.length,8);
assert.deepEqual(timeline.diagnostics,[]);
const moves=timeline.cues.filter(c=>c.type==='move'&&c.segments?.length);
assert.ok(moves.length>0,'Original default battle must retain movement segments');
for(const cue of moves)for(const segment of cue.segments){
 for(const point of [segment.from,segment.to])for(const value of [point.x,point.y])assert.ok(Number.isFinite(value));
 assert.ok(segment.durationMs>=0);
}
for(const index of result.events.keys())assert.ok(timeline.cues.some(c=>c.logIndices.includes(index)),'Missing log '+index);
console.log(JSON.stringify({passed:true,geometry,attackEffects,sceneEffects:2,missingStandGuards:2,labelFonts,cocosSamples,defaultBattle:{rounds:result.rounds,actors:timeline.actors.length,moves:moves.length,cues:timeline.cues.length,diagnostics:timeline.diagnostics}}));
