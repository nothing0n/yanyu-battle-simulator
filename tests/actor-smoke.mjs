import {installAndroidIntegerRNG} from '../dist/runtime/android-rng.mjs';
import fs from 'node:fs';
import {createRuntime} from '../dist/engine/runtime.mjs';
import {createBattleRole} from '../dist/integration/actors.mjs';
const rt=await createRuntime({readJSON:async u=>JSON.parse(fs.readFileSync(u,'utf8').replace(/^\uFEFF/,'')),seed:1001});
installAndroidIntegerRNG(rt.vm,{seed:1001,time:()=>0});
rt.require('app/ai/JHAIConfig');
const role=await createBattleRole(rt,{uid:'ally-0',roleId:10011,name:'苏念雪',level:90,position:0,skills:{wai:20010,nei:22010,qing:24010},skillLevels:{wai:10,nei:10,qing:10},stats:{hp:18000,atk:4500,def:2500,speed:700,hit:1000,dodge:500,parry:650,mp:30,mpBack:10}},true,0);
console.log('ROLE',rt.firstMethod(role,'getName'),rt.firstMethod(role,'getBattleHp'),rt.firstMethod(role,'getBattleAttack'));
