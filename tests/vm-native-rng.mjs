import fs from 'node:fs';
import assert from 'node:assert/strict';
import {AndroidIntegerRNG} from '../dist/runtime/android-rng.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/native-whale-rng.json',import.meta.url),'utf8'));
let n=0;
for(const test of fixture.vectors){
 const rng=new AndroidIntegerRNG(test.seed);
 for(const expected of test.raw31){assert.equal(rng.next31(),expected);n++;}
 for(const args of [[],[100],[98,102],[0],[1.25],[4.2,99.7]]){
  rng.seed(test.seed);
  const raw=test.raw31[0],got=rng.random(...args);
  const expected=args.length===0?raw/2147483647:args.length===1?raw%args[0]+1:raw%(args[1]-args[0]+1)+args[0];
  if(Number.isNaN(expected))assert.ok(Number.isNaN(got));else assert.equal(got,expected);
 }
}
console.log('PASS '+n+' exact ARM64 getWhaleRand vectors + original math override ranges');
