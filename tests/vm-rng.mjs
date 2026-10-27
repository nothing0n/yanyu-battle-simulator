import fs from 'node:fs';
import assert from 'node:assert/strict';
import {LuaVM} from '../dist/runtime/lua-vm.mjs';
import {AndroidIntegerRNG,installAndroidIntegerRNG} from '../dist/runtime/android-rng.mjs';
const data=JSON.parse(fs.readFileSync(new URL('../dist/integration/bundles/JHBaseData.json',import.meta.url)));
const p=data.prototypes['root/68'];
const expected=(seed,max)=>{
 const mix=BigInt.asUintN(64,(BigInt(seed)+BigInt(max))*245109059551232n+48083817484545n);
 const raw=(mix>>17n)&2147483647n;
 const next=Number(raw%2047483645n+1n);
 return{seed:next,value:next%max+1};
};
let checked=0;
for(const initial of [1,2,99,12345,1000000000,2047483645]){
 const vm=new LuaVM();installAndroidIntegerRNG(vm,{seed:7,time:()=>10000});
 const model=vm.table({__RandSeed:initial});let seed=initial;
 for(let i=0;i<1000;i++){
  const max=[1,2,5,100,1000,1000000,2047483645][i%7],ref=expected(seed,max);
  const got=vm.runFirst(p,[model,max]);assert.equal(got,ref.value);assert.equal(vm.get(model,'__RandSeed'),ref.seed);
  seed=ref.seed;checked++;
 }
}
const a=new AndroidIntegerRNG(1234),b=new AndroidIntegerRNG(1234);
for(let i=0;i<100;i++)assert.equal(a.integer(98,102),b.integer(98,102));
console.log('Original intRand bytecode: '+checked+' sequential draw/seed comparisons passed');
