import assert from 'node:assert/strict';
import {wilsonInterval, exactBinomialInterval, pairedWinDifference, summarizeMetric, summarizeGroup} from '../tools/inner-benchmark-stats.mjs';
import {spacedSeeds, extractBattleMetrics, summarizeExperiment} from '../tools/compare-inner.mjs';
assert.equal(wilsonInterval(0, 0), null);
assert.throws(() => wilsonInterval(3, 2));
const zero = wilsonInterval(0, 10), one = wilsonInterval(10, 10), half = wilsonInterval(5, 10);
assert.ok(zero[0] < 1e-15 && Math.abs(zero[1] - 0.2775327998628892) < 1e-12);
assert.ok(Math.abs(one[0] - (1 - zero[1])) < 1e-12);
assert.ok(Math.abs(half[0] + half[1] - 1) < 1e-12);
const cp0 = exactBinomialInterval(0, 10), cp10 = exactBinomialInterval(10, 10), cp5 = exactBinomialInterval(5, 10);
assert.ok(Math.abs(cp0[1] - (1 - 0.025 ** 0.1)) < 1e-12);
assert.ok(Math.abs(cp10[0] - 0.025 ** 0.1) < 1e-12);
assert.ok(Math.abs(cp5[0] - 0.18708602844739852) < 1e-10);
assert.ok(Math.abs(cp5[0] + cp5[1] - 1) < 1e-12);
assert.deepEqual(summarizeMetric([null, undefined, NaN]), {n:0, mean:null, sd:null, se:null, ci95:null, min:null, max:null});
assert.equal(summarizeMetric([0, 2, null]).mean, 1);
const row = (seed, winner, status = 'completed') => ({matchupId:'x', seed, winner, status, metrics:{x:seed === 1 ? null : 10}});
const a = [row(1, 'ally'), row(2, 'enemy'), row(3, 'draw'), row(4, null, 'failed'), row(5, 'draw', 'limited')];
const b = [row(1, 'ally'), row(2, 'ally'), row(3, 'enemy'), row(4, 'ally'), row(5, 'ally')];
const group = summarizeGroup(a);
assert.deepEqual([group.attempted, group.completed, group.failed, group.limited, group.wins, group.losses, group.draws], [5,3,1,1,1,1,1]);
assert.equal(group.winRate, 1/3);
assert.equal(group.metrics.x.n, 2);
const paired = pairedWinDifference(a, b);
assert.equal(paired.n, 3);
assert.equal(paired.difference, 1/3);
assert.equal(paired.bOnly, 1);
assert.equal(paired.aOnly, 0);
assert.ok(paired.ci95[0] < paired.difference && paired.ci95[1] > paired.difference);
const identical = pairedWinDifference(a, a);
assert.equal(identical.difference, 0);
assert.ok(identical.ci95[0] < 0 && identical.ci95[1] > 0, 'unseen discordance is not zero uncertainty');
assert.equal(pairedWinDifference([], b).difference, null);
const seeds = spacedSeeds(20261027, 200);
assert.equal(new Set(seeds).size, 200);
assert.ok(seeds.every(n => Number.isInteger(n) && n >= 1 && n <= 4294967295));
assert.deepEqual(spacedSeeds(20261027, 200), seeds);
assert.notDeepEqual(spacedSeeds(20261028, 200), seeds);
const result = {
  stats:[{uid:'hero',battleId:1,team:'ally',damage:140,healing:30,taken:100,hp:20,maxHp:100},{uid:'target',battleId:2,team:'enemy',hp:0,maxHp:100,damage:0}],
  rounds:6, metadata:{roundLimitReached:false,unattributedDamage:0,frames:800},
  rawMessages:[
    {type:'create',owner:{BattleID:1},ownerhp:100,buff:[{id:5028}]},
    {type:'skill',round:2,id:21751,attack:{battle_id:1,hp:100},hurts:[{battle_id:2,hp:40,sub_hp:-60}]},
    {type:'skill',round:4,id:21753,attack:{battle_id:1,hp:100},hurts:[{battle_id:2,hp:0,sub_hp:-80,die:true}]},
    {type:'buff',round:5,left:[{battle_id:1,hp:0,die:true}]},
    {type:'value',round:6,left:[{battle_id:1,hp:20}]}
  ]
};
const measured = extractBattleMetrics(result, {}, 'hero', [5028]);
assert.equal(measured.metrics.mainRawDirectDamage, 140);
assert.equal(measured.metrics.mainEffectiveDirectDamage, 100);
assert.equal(measured.metrics.mainEffectiveDirectDamageFirst3Rounds, 60);
assert.equal(measured.metrics.mainFinalAlive, 1);
assert.equal(measured.metrics.mainFirstKnockdownRound, 5);
assert.equal(measured.metrics.mainSurvivedWithoutObservedKnockdown, 0);
assert.equal(measured.firstObservedRounds['buff:5028'], 0);
assert.equal(measured.firstObservedRounds['skill:21753'], 4);
const ambiguous = structuredClone(result);
ambiguous.rawMessages[1].hurts[0].nowbuff = [{id:2,sub_hp:-5}];
assert.equal(extractBattleMetrics(ambiguous, {}, 'hero').metrics.mainEffectiveDirectDamage, null);
assert.equal(extractBattleMetrics(ambiguous, {}, 'hero').metrics.mainAmbiguousEffectiveDamageImpacts, 1);
const mixtureRows = [
  ...a.map(r => ({...r,variantId:'A'})), ...b.map(r => ({...r,variantId:'B'})),
  ...a.map(r => ({...r,matchupId:'y',variantId:'A'})), ...b.map(r => ({...r,matchupId:'y',variantId:'B'}))
];
const mixture = summarizeExperiment(mixtureRows, [{id:'A'},{id:'B'}], [{id:'x'},{id:'y'}]);
assert.equal(mixture.aggregate.A.winRateCI95, null, 'shared seeds across scenarios are dependent clusters');
assert.equal(mixture.aggregate.A.metrics.x.ci95, null);
assert.equal(mixture.aggregatePaired[0].ci95, null);
assert.notEqual(mixture.conditions[0].variants.A.winRateCI95, null);
assert.notEqual(mixture.conditions[0].paired[0].ci95, null);
assert.equal(mixture.aggregateSeedClusters, 5);
console.log('inner benchmark statistics: passed');
