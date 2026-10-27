import fs from 'node:fs';
import {createRuntime} from '../dist/engine/runtime.mjs';
import {createBattleRole} from '../dist/integration/actors.mjs';
const rt=await createRuntime({readJSON:async u=>JSON.parse(fs.readFileSync(u,'utf8').replace(/^\uFEFF/,'')),seed:1001});rt.require('app/ai/JHAIConfig');
const c=JSON.parse(fs.readFileSync(new URL('../dist/data/catalog.json',import.meta.url)));
const wanted=['苏念雪','姜逸尘','李一尘','商昊乾','月蓉','萧佩吟','桃花'];
const skills=['基础拳法','太虚神悟刀','五狱剑诀','西子君剑','无暇棍法'];
const stats={hp:18000,atk:4500,def:2500,speed:700,hit:1000,dodge:500,parry:650,mp:30,mpBack:10};let passed=0;
for(const char of c.characters.filter(x=>wanted.includes(x.name))){for(const skill of c.taolu.filter(x=>skills.includes(x.name))){
 try{const a=await createBattleRole(rt,{uid:'a',roleId:char.id,name:char.name,level:90,position:0,skills:{wai:skill.id,nei:22010,qing:24010},skillLevels:{wai:10,nei:10,qing:10},stats},true,0);const zs=rt.firstMethod(a,'getActiveZS');const active=rt.firstMethod(a,'getActiveTaolu');console.log(char.name,skill.name,'active',rt.firstMethod(active,'getID'),'zhaos',zs?.size);passed++;}catch(e){console.log('FAIL',char.name,skill.name,e.message,JSON.stringify(e.details));process.exitCode=1;break;}
}}
console.log('passed',passed);
