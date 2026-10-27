import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createFloatingTextRecorder,resolveAtlasFont,sampleFloatingNode} from '../dist/presentation/floating-text.mjs';
const readJSON=async url=>JSON.parse(fs.readFileSync(url,'utf8'));
const assets=await readJSON(new URL('../dist/data/presentation-assets.json',import.meta.url));
const recorder=await createFloatingTextRecorder({readJSON,visualSeed:17});
for(const flip of [false,true])for(const amount of [-123,123]){
 recorder.reset(17);const record=recorder.record('addNJHp',[amount],{flip,actorKey:'neijin'});
 assert.equal(record.source.prototype,'root/182');assert.equal(record.roots.length,1);
 const number=record.nodes.find(n=>n.kind==='LabelAtlas'),jing=record.nodes.find(n=>n.kind==='Sprite'),root=record.roots[0];
 assert.equal(number.text,'123');assert.equal(number.path,'fonts/num_hit.png');assert.ok(resolveAtlasFont(assets,number.path));
 assert.equal(jing.spriteFrame,'common_simple/txt_battle_jing.png');assert.deepEqual(jing.contentSize,{width:57,height:56});
 assert.ok(Number.isFinite(root.contentSize.width));assert.ok(root.contentSize.width>number.text.length*number.cellWidth);
 assert.equal(record.finalHurtIndex,record.hurtIndex,'neijin amount does not advance ordinary damage hurt-index');
 const start=sampleFloatingNode(root,0),visible=sampleFloatingNode(root,200),end=sampleFloatingNode(root,2000);
 assert.equal(start.opacity,0);assert.ok(visible.opacity>0);assert.ok(end.removed);assert.ok(end.y>start.y);
 assert.deepEqual(root.actions[0].params[0].map(x=>x.kind),['FadeIn','ScaleTo','ScaleTo','MoveBy','RemoveSelf']);
}
const empty=recorder.record('addNJHp',[0]);assert.equal(empty.roots.length,0);assert.equal(empty.rng.length,0);
assert.throws(()=>recorder.record('addUnsupported',[1]),/Unsupported floating-text method/);
console.log('Original addNJHp bytecode, numeric text, jing sprite and action sampling passed; no battles run.');
