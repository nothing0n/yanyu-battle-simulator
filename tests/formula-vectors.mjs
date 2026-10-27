import assert from 'node:assert/strict';
import {originalHitChance as hit,originalParryChance as parry,originalDamageCore as damage,originalDamageReduction as reduction} from '../dist/engine/formulas.js';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
close(hit({hit:1000,dodge:1000,attackerLevel:100,defenderLevel:100}),86.66666666666667);
close(parry({parry:1000,speed:1000,attackerLevel:100,defenderLevel:100}),22.5);
assert.equal(parry({parry:1000000,speed:1000,attackerLevel:100,defenderLevel:100}),100);
close(hit({hit:1000,dodge:0,attackerLevel:100,defenderLevel:100}),100);
close(parry({parry:0,speed:1000,attackerLevel:100,defenderLevel:100}),0);
const base={attack:1000,defence:500,strength:100,constitution:100};
const vectors=[
 [{},666],[{randomInt:98},653],[{randomInt:102},680],
 [{parryResult:1},347],[{parryResult:1,strength:0,constitution:0},347],
 [{defenceIgnore:1},1000],[{defenceIgnore:2},1000],
 [{damageReduction:.5},333],[{damageReduction:.9},333],
 [{critical:true,criticalMultiplier:1.5},1000],
 [{gangqi:1000},199],[{gangqi:1000,damageReduction:.5},199],
 [{gangqi:1000,damageReduction:.5,reduction80:.2},200],
 [{lockHp:true},0],[{transformedZero:true},0],
 [{parryResult:-1,parryBreakDamage:.5},1000]
];
for(const [props,expected] of vectors)assert.equal(damage({...base,...props}).damage,expected,JSON.stringify(props));
close(reduction({damageReduction:.8,damageReductionIgnore:.4,reductionCount:.2}),.6);
assert.throws(()=>damage({...base,randomInt:99.5}),RangeError);
assert.throws(()=>damage({attack:0,defence:0}),RangeError);
console.log(`PASS: ${vectors.length} explicit damage vectors and probability/reduction boundaries; numerical slice verification only.`);
