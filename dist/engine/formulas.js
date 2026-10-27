/** Numeric slices of original JHBaseAI bytecode. Inputs are resolved properties.
 * Not a substitute for talents/buffs/action scheduling or the game's RNG.
 * Source 2026-10-07 wapp__ai-012-0b33316e.lj prototypes 109, 110, 115. */
const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
function num(name,v,fallback){v=v===undefined?fallback:Number(v);if(!Number.isFinite(v))throw new TypeError(name+' must be finite');return v;}
export function originalHitChance({hit,dodge,attackerLevel,defenderLevel}){
 const h=num('hit',hit)%100000,d=num('dodge',dodge),la=num('attackerLevel',attackerLevel),ld=num('defenderLevel',defenderLevel);
 const den=h+d/(6-ld*.04);if(den===0)throw new RangeError('Original hit formula: zero denominator');
 return clamp(h*(la*.0025+1.05)/den*100,0,100);
}
export function originalParryChance({parry,speed,attackerLevel,defenderLevel}){
 const p=num('parry',parry),s=num('speed',speed)%100000,la=num('attackerLevel',attackerLevel),ld=num('defenderLevel',defenderLevel);
 if(p>=1000000)return 100;const den=s/(.8-la*.0044)+p;if(den===0)throw new RangeError('Original parry formula: zero denominator');
 return clamp(p*(ld*.0035+.5)/den*100,0,100);
}
export function originalDamageReduction(p={}){
 let r=clamp(num('damageReduction',p.damageReduction,0)-num('damageReductionIgnore',p.damageReductionIgnore,0),0,.5);
 r+=num('reductionCount',p.reductionCount,0);r+=num('dexReductionCompare',p.dexReductionCompare,0);r+=num('reduction80',p.reduction80,0);
 if(num('parryResult',p.parryResult,0)>0)r+=num('parryReductionCompare',p.parryReductionCompare,0);
 return Math.min(Math.min(r,.8)+num('bossReduction',p.bossReduction,0),1);
}
/** attack/attackRate = getBattleAttackSkill results 1/3. randomInt is supplied. */
export function originalDamageCore(p){
 const atk=num('attack',p.attack),def=num('defence',p.defence),str=num('strength',p.strength,0),con=num('constitution',p.constitution,0);
 const parry=num('parryResult',p.parryResult,0),roll=num('randomInt',p.randomInt,100);
 if(!Number.isInteger(roll)||roll<98||roll>102)throw new RangeError('randomInt must be integer 98-102');
 const parryRatio=parry>0?(str+con===0?.375:Math.max(con*.75/(str+con),.15)):0;
 const adjustedAttack=atk*(1-parryRatio),adjustedDefence=def*(1-Math.min(num('defenceIgnore',p.defenceIgnore,0),1));
 if(adjustedAttack+adjustedDefence===0)throw new RangeError('Original damage formula: zero denominator');
 const reduction=originalDamageReduction(p);
 let value=adjustedAttack*adjustedAttack/(adjustedAttack+adjustedDefence)*(roll/100)*(1-reduction);
 let rate=num('attackRate',p.attackRate,1)+num('attackRateBase',p.attackRateBase,0);const rateBeforeCrit=rate;
 if(p.critical)rate*=num('criticalMultiplier',p.criticalMultiplier);
 rate+=num('attackerSexCrit',p.attackerSexCrit,0);rate+=num('defenderSexCrit',p.defenderSexCrit,0);
 if(p.counterattack)rate+=num('counterattackMore',p.counterattackMore,0)*rateBeforeCrit;
 rate+=num('aoeMore',p.aoeMore,0);value*=rate;value*=num('actionMultiplier',p.actionMultiplier,1);
 if(parry===-1&&num('parryBreakDamage',p.parryBreakDamage,0)>0)value+=value*p.parryBreakDamage;
 value*=num('damageTransform',p.damageTransform,1);const beforeGangqi=value;let absorbedByGangqi=0;
 if(reduction<.7){const g=Math.max(num('gangqi',p.gangqi,0),0)*(1-Math.min(num('gangqiIgnore',p.gangqiIgnore,0),1));
  if(g>0){const after=Math.max(value-g,value/(1-reduction)*.3);absorbedByGangqi=value-after;value=Math.max(after,0);}}
 value=Math.floor(Math.max(value,1));if(p.lockHp||p.transformedZero||(p.skillHpIgnore&&!p.normalAttack))value=0;
 return {damage:value,adjustedAttack,adjustedDefence,parryRatio,reduction,resolvedAttackRate:rate,randomMultiplier:roll/100,beforeGangqi,absorbedByGangqi};
}
export const formulaProvenance=Object.freeze({scope:'Resolved-property arithmetic; full battle uses the original-code runtime and remains experimental.'});
