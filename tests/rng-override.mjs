import fs from 'node:fs';
import assert from 'node:assert/strict';
import {LuaVM,allResults} from '../dist/runtime/lua-vm.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('./rng-override-fixtures.json',import.meta.url),'utf8'));
let draws=0,seeded=[];
let value=0;
const native={getWhaleRand:self=>{assert.equal(self,native);draws++;return value;},setWhaleSeed:(self,s)=>{assert.equal(self,native);seeded.push(s);}};
const vm=new LuaVM({globals:{jh:{JHCommonUtils:native}}});
const expected=[
 [0,[],0],[2147483647,[],1],[12345,[],12345/2147483647],
 [0,[100],1],[2147483647,[10],8],[12345,[100],46],
 [0,[98,102],98],[2147483647,[5,9],7],[12345,[98,102],98],
 [12345,[-5,5],-2]
];
for(const [input,args,result] of expected){value=input;assert.equal(vm.runFirst(fixture.random,args),result);}
assert.equal(draws,expected.length);
for(const seed of [0,1,12345,2147483647])assert.equal(allResults(vm.run(fixture.randomseed,[seed])).length,0);
assert.deepEqual(seeded,[0,1,12345,2147483647]);
console.log('PASS '+expected.length+' original math.random override vectors and 4 exact native seed calls. RNG algorithm is supplied by getWhaleRand, not stock LuaJIT.');
