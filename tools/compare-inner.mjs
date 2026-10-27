import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {Worker, isMainThread, parentPort, workerData} from 'node:worker_threads';
import {summarizeGroup, pairedWinDifference} from './inner-benchmark-stats.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const list = value => Array.isArray(value) ? value : Object.values(value || {});
const clone = value => structuredClone(value);

/** Bijective 32-bit mixing spreads adjacent experiment indexes over the seed space. */
export function spacedSeeds(base, count) {
  const seeds = [], seen = new Set();
  for (let i = 0; seeds.length < count; i++) {
    let x = (base + Math.imul(i, 0x9e3779b9)) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
    x = (x ^ (x >>> 16)) >>> 0;
    const seed = x || 4294967295;
    if (!seen.has(seed)) { seen.add(seed); seeds.push(seed); }
  }
  return seeds;
}

/** Metrics are derived only from explicit original messages. Ambiguous HP attribution stays null. */
export function extractBattleMetrics(result, config, mainUid, watchedBuffIds = []) {
  const main = result.stats.find(s => s.uid === mainUid);
  if (!main) throw new Error('Main actor missing from original battle statistics');
  const byId = new Map(result.stats.map(s => [s.battleId, s]));
  const hp = new Map(result.stats.map(s => [s.battleId, s.maxHp]));
  const watched = new Set(watchedBuffIds.map(Number)), firstObservedRounds = {};
  let round = 0, firstDown = null, firstAction = null, rawDirect = 0, knownEffective = 0, ambiguousImpacts = 0;
  let early3Raw = 0, early5Raw = 0, early3Effective = 0, early5Effective = 0, early3Unknown = false, early5Unknown = false, actions = 0;
  const remember = row => {
    if (!row || !byId.has(row.battle_id)) return;
    if (row.battle_id === main.battleId) {
      if (firstDown === null && (row.die === true || Number.isFinite(row.hp) && row.hp <= 0)) firstDown = round;
      for (const buff of [...list(row.buff), ...list(row.nowbuff), ...list(row.buff_use)]) {
        const id = Number(buff.id);
        if (watched.has(id)) firstObservedRounds[`buff:${id}`] ??= round;
      }
    }
    if (Number.isFinite(row.hp)) hp.set(row.battle_id, Math.max(0, row.hp));
  };
  for (const message of result.rawMessages || []) {
    if (Number.isFinite(message.round)) round = message.round;
    if (message.type === 'create' && message.owner?.BattleID) {
      const id = message.owner.BattleID;
      if (Number.isFinite(message.ownerhp)) hp.set(id, message.ownerhp);
      remember({battle_id:id, hp:message.ownerhp, buff:message.buff});
      continue;
    }
    const hurts = message.hurt ? [message.hurt] : list(message.hurts);
    const attack = message.attack;
    const isAttack = message.type === 'skill' || attack && hurts.some(row => Number.isFinite(row.hp));
    if (isAttack) {
      const sourceId = attack?.battle_id ?? message.attack_battleid;
      if (sourceId === main.battleId) {
        actions++; firstAction ??= round;
        const id = Number(message.id || message.skill_id || attack?.skill_id);
        if (id) firstObservedRounds[`skill:${id}`] ??= round;
      }
      for (const hurt of hurts) {
        const target = byId.get(hurt.battle_id), rawDamage = Math.max(0, -(Number(hurt.sub_hp) || 0));
        if (sourceId === main.battleId && target?.team === 'enemy' && rawDamage > 0) {
          rawDirect += rawDamage;
          if (round <= 3) early3Raw += rawDamage;
          if (round <= 5) early5Raw += rawDamage;
          const before = hp.get(hurt.battle_id), after = hurt.hp;
          const hasOtherHpEffect = list(hurt.nowbuff).some(effect => Number(effect.sub_hp));
          const expected = Math.max(0, before - rawDamage);
          const auditable = Number.isFinite(before) && Number.isFinite(after) && !hasOtherHpEffect && Math.abs(Math.max(0, after) - expected) <= 1;
          if (auditable) {
            const effective = Math.min(rawDamage, before);
            knownEffective += effective;
            if (round <= 3) early3Effective += effective;
            if (round <= 5) early5Effective += effective;
          } else {
            ambiguousImpacts++;
            if (round <= 3) early3Unknown = true;
            if (round <= 5) early5Unknown = true;
          }
        }
        remember(hurt);
      }
      remember(attack);
    } else {
      remember(attack); remember(message.hurt);
      for (const row of hurts) remember(row);
    }
    for (const row of [...list(message.left), ...list(message.right)]) remember(row);
  }
  const survived = Number(main.hp > 0), completed = !result.metadata.roundLimitReached;
  return {
    metrics: {
      rounds:result.rounds,
      mainRawAttributedDamage:main.damage,
      teamRawAttributedDamage:result.stats.filter(s => s.team === 'ally').reduce((sum, s) => sum + s.damage, 0),
      mainRawDirectDamage:rawDirect,
      mainEffectiveDirectDamage:ambiguousImpacts ? null : knownEffective,
      mainAuditedEffectiveDirectDamageSubtotal:knownEffective,
      mainAmbiguousEffectiveDamageImpacts:ambiguousImpacts,
      mainRawDirectDamageFirst3Rounds:early3Raw,
      mainRawDirectDamageFirst5Rounds:early5Raw,
      mainEffectiveDirectDamageFirst3Rounds:early3Unknown ? null : early3Effective,
      mainEffectiveDirectDamageFirst5Rounds:early5Unknown ? null : early5Effective,
      mainRawHealing:main.healing,
      mainRawTaken:main.taken,
      mainFinalHp:main.hp,
      mainFinalHpFraction:main.maxHp > 0 ? Math.max(0, main.hp) / main.maxHp : null,
      mainFinalAlive:survived,
      mainFirstKnockdownRound:firstDown,
      mainSurvivedWithoutObservedKnockdown:firstDown === null && survived ? 1 : 0,
      mainFirstActionRound:firstAction,
      mainActionMessages:actions,
      unattributedStatusDamage:result.metadata.unattributedDamage,
      logicFrames:result.metadata.frames,
      completed:Number(completed)
    },
    firstObservedRounds
  };
}

function argumentsFor(argv) {
  const options = {samples:200, seed:20261027, jobs:Math.max(1, Math.min(6, os.availableParallelism() - 1)), frameBudget:120000};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') return {...options, help:true};
    if (arg === '--private-input') { options.privateInput = true; continue; }
    if (!['--samples','--seed','--jobs','--out','--config','--matchups','--variants','--frame-budget'].includes(arg)) throw new Error(`Unknown argument ${arg}`);
    if (i + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
    const key = {'--frame-budget':'frameBudget'}[arg] || arg.slice(2);
    options[key] = ['--samples','--seed','--jobs','--frame-budget'].includes(arg) ? Number(argv[++i]) : argv[++i];
  }
  for (const [key, max] of [['samples',10000],['seed',4294967295],['jobs',32],['frameBudget',1000000]]) {
    if (!Number.isInteger(options[key]) || options[key] < 1 || options[key] > max) throw new Error(`Invalid ${key}`);
  }
  return options;
}

export function buildTasks(fixture, options, seeds) {
  if (!fixture?.ally?.length || !fixture?.variants?.length || !fixture?.matchups?.length) throw new Error('Fixture requires ally, variants, and matchups');
  const nowSeconds = fixture.nowSeconds ?? 1792800000;
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 1) throw new Error('Fixture nowSeconds must be a positive integer Unix timestamp');
  const instructionBudget = fixture.instructionBudget ?? 5000000;
  if (!Number.isSafeInteger(instructionBudget) || instructionBudget < 1) throw new Error('Fixture instructionBudget must be a positive safe integer');
  const variants = fixture.variants.filter(v => !options.variants || options.variants.split(',').includes(v.id));
  const matchups = fixture.matchups.filter(m => !options.matchups || options.matchups.split(',').includes(m.id));
  if (!variants.length || !matchups.length) throw new Error('No matching experiment conditions');
  const main = fixture.ally.find(r => r.uid === fixture.mainUid);
  if (!main || main.skills?.wai !== 21750) throw new Error('Main actor must use 夺天地造化功21750');
  const tasks = [];
  for (const matchup of matchups) for (const [sampleIndex, seed] of seeds.entries()) for (const variant of variants) {
    const ally = clone(fixture.ally), hero = ally.find(r => r.uid === fixture.mainUid);
    hero.skills.nei = variant.nei;
    // Do not carry form/stage from one inner skill into another.
    hero.skillOptions = {...hero.skillOptions, ...clone(variant.skillOptions || {}), nei:clone(variant.skillOptions?.nei || {})};
    if (variant.assumedSkills) hero.assumedSkills = {...hero.assumedSkills, ...clone(variant.assumedSkills)};
    if (variant.skillLevels) hero.skillLevels = {...hero.skillLevels, ...clone(variant.skillLevels)};
    if (hero.savedState && variant.stats) throw new Error('Raw saved-state variants must use original panel calculation, not stats overrides');
    if (variant.stats) Object.assign(hero.stats, variant.stats);
    const config = {version:1, name:`constructed-${matchup.id}-${variant.id}`, seed, nowSeconds, instructionBudget, fightType:fixture.fightType ?? 1, maxRounds:fixture.maxRounds || 50, teams:{ally, enemy:clone(matchup.enemy)}};
    tasks.push({matchupId:matchup.id, variantId:variant.id, sampleIndex, seed, config});
  }
  return {tasks, variants, matchups};
}

async function workerLoop() {
  const {runOriginalBattle} = await import('../dist/engine/battle-runner.mjs');
  const {createBattleRole} = await import('../dist/integration/actors.mjs');
  const {createSavedBattleRole} = await import('../dist/integration/save-panel.mjs');
  const cache = new Map();
  const readJSON = async url => {
    const key = String(url);
    if (!cache.has(key)) cache.set(key, JSON.parse(fs.readFileSync(url, 'utf8').replace(/^\uFEFF/, '')));
    return cache.get(key);
  };
  parentPort.on('message', async task => {
    if (task === null) { parentPort.close(); return; }
    const started = performance.now();
    let row = {matchupId:task.matchupId, variantId:task.variantId, sampleIndex:task.sampleIndex, seed:task.seed};
    try {
      const result = await runOriginalBattle(task.config, {readJSON, frameBudget:workerData.frameBudget, nowSeconds:task.config.nowSeconds, instructionBudget:task.config.instructionBudget,
        createBattleRole:(runtime, row, left, index) => row.savedState ? createSavedBattleRole(runtime, row, left, index) : createBattleRole(runtime, row, left, index)});
      row = {...row, status:result.metadata.roundLimitReached ? 'limited' : 'completed', winner:result.metadata.roundLimitReached ? null : result.winner,
        ...extractBattleMetrics(result, task.config, workerData.mainUid, workerData.watchedBuffIds),
        metadata:{engine:result.metadata.engine, snapshot:result.metadata.snapshot, originalBattleValidated:result.metadata.originalBattleValidated,
          missingImports:result.metadata.missingImports, roundLimitReached:result.metadata.roundLimitReached}};
    } catch (error) {
      row = {...row, status:'failed', winner:null, metrics:{}, firstObservedRounds:{},
        error:{name:error.name, message:error.message, details:error.details || null}};
    }
    row.elapsedMs = performance.now() - started;
    row.workerHeapUsedBytes = process.memoryUsage().heapUsed;
    parentPort.postMessage(row);
  });
}

async function runPool(tasks, options, context, onRow) {
  let next = 0, completed = 0, peakRss = process.memoryUsage().rss;
  const rows = [], workers = [];
  let aborted = false;
  const workerCount = Math.min(options.jobs, tasks.length);
  await Promise.all(Array.from({length:workerCount}, () => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {workerData:{benchmarkWorker:true, frameBudget:options.frameBudget, ...context}});
    workers.push(worker);
    let finished = false;
    worker.on('message', row => {
      if (aborted) return;
      rows.push(row); completed++; peakRss = Math.max(peakRss, process.memoryUsage().rss); onRow(row, completed, tasks.length);
      if (next < tasks.length) worker.postMessage(tasks[next++]);
      else { finished = true; worker.postMessage(null); }
    });
    const fail = error => { aborted = true; for (const peer of workers) void peer.terminate(); reject(error); };
    worker.on('error', fail);
    worker.on('exit', code => finished && code === 0 ? resolve() : fail(new Error(`Benchmark worker exited before completion (${code})`)));
    worker.postMessage(tasks[next++]);
  })));
  return {rows, peakRss, workerCount};
}

export function summarizeExperiment(rows, variants, matchups) {
  const conditions = matchups.map(matchup => ({matchupId:matchup.id, label:matchup.label, constructed:true,
    variants:Object.fromEntries(variants.map(v => [v.id, summarizeGroup(rows.filter(r => r.matchupId === matchup.id && r.variantId === v.id))])),
    paired:variants.flatMap((a, i) => variants.slice(i + 1).map(b => ({A:a.id, B:b.id,
      ...pairedWinDifference(rows.filter(r => r.matchupId === matchup.id && r.variantId === a.id), rows.filter(r => r.matchupId === matchup.id && r.variantId === b.id))})))
  }));
  const descriptive = summary => {
    summary.winRateCI95 = null;
    summary.mainSurvival.ci95 = null;
    for (const collection of [summary.metrics, summary.firstObservedRounds]) for (const metric of Object.values(collection)) {
      metric.se = null; metric.ci95 = null;
    }
    summary.uncertainty = 'Descriptive only: seeds are shared across matchups (clusters), so pooled rows are not independent binomial or metric observations';
    return summary;
  };
  return {conditions,
    aggregate:Object.fromEntries(variants.map(v => [v.id, descriptive(summarizeGroup(rows.filter(r => r.variantId === v.id)))])),
    aggregateSeedClusters:new Set(rows.map(r => r.seed)).size,
    aggregateMeaning:'Equal number of synthetic matches per listed matchup; descriptive benchmark mixture, not real opponent prevalence. Use per-matchup intervals for uncertainty.',
    aggregatePaired:variants.flatMap((a, i) => variants.slice(i + 1).map(b => {
      const comparison = pairedWinDifference(rows.filter(r => r.variantId === a.id), rows.filter(r => r.variantId === b.id));
      return {A:a.id, B:b.id, ...comparison, ci95:null, seedClusters:new Set(rows.filter(r => r.variantId === a.id || r.variantId === b.id).map(r => r.seed)).size,
        method:'Descriptive paired mixture only; repeated seeds across matchups are dependent clusters. No pooled independent-binomial interval is reported.'};
    }))
  };
}

async function main() {
  const options = argumentsFor(process.argv.slice(2));
  if (options.help) {
    console.log('node tools/compare-inner.mjs --samples 200 --seed 20261027 --jobs 6 --out <new-directory> [--config <benchmark.json>] [--matchups id,id] [--variants id,id] [--private-input]');
    console.log('Constructed PVP benchmark. Supplied JSON and resolved configuration are written to the local output; never publish private input/results without a separate privacy review.');
    return;
  }
  const fixturePath = options.config ? path.resolve(options.config) : path.join(root, 'tests/fixtures/inner-benchmark.json');
  const fixtureBytes = fs.readFileSync(fixturePath), fixture = JSON.parse(fixtureBytes.toString('utf8').replace(/^\uFEFF/, ''));
  const seeds = spacedSeeds(options.seed, options.samples), {tasks, variants, matchups} = buildTasks(fixture, options, seeds);
  const out = path.resolve(options.out || `inner-benchmark-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const privateContainsRawState = [...fixture.ally, ...matchups.flatMap(m => m.enemy)].some(row => Boolean(row.savedState));
  if (privateContainsRawState && !options.privateInput) throw new Error('Raw savedState input requires --private-input; resolved configuration will contain private role records');
  const relativeOut = path.relative(root, out);
  if (privateContainsRawState && (relativeOut === '' || relativeOut !== '..' && !relativeOut.startsWith('..' + path.sep) && !path.isAbsolute(relativeOut))) throw new Error('Private raw-state outputs must be outside the source checkout');
  fs.mkdirSync(path.dirname(out), {recursive:true});
  fs.mkdirSync(out, {recursive:false});
  const compact = fs.openSync(path.join(out, 'compact.jsonl'), 'wx');
  const sourceFiles = ['dist/runtime/lua-vm.mjs','dist/runtime/lua-library.mjs','dist/integration/actors.mjs','dist/integration/skill-selection.mjs','dist/integration/save-panel.mjs','dist/integration/manifest.json','dist/engine/runtime.mjs','dist/engine/battle-runner.mjs','dist/data/runtime-tables-typed.json','tools/compare-inner.mjs','tools/inner-benchmark-stats.mjs'];
  const directoryDigest = relative => {
    const rows = [];
    const walk = prefix => { for (const entry of fs.readdirSync(path.join(root, prefix), {withFileTypes:true}).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const child = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (/\.(?:mjs|js|json)$/.test(entry.name)) rows.push([child, hash(fs.readFileSync(path.join(root, child)))]);
    } };
    walk(relative);
    return {files:rows.length, sha256:hash(JSON.stringify(rows))};
  };
  const provenance = {createdAt:new Date().toISOString(), constructed:true, privateContainsRawState, inputScope:fixture.scope || null,
    fixtureSha256:hash(fixtureBytes), fixtureSource:options.config ? 'external supplied benchmark JSON' : 'tests/fixtures/inner-benchmark.json',
    sourceSha256:Object.fromEntries(sourceFiles.map(f => [f, hash(fs.readFileSync(path.join(root, f)))])),
    sourceTreeSha256:Object.fromEntries(['dist/runtime','dist/engine','dist/integration'].map(dir => [dir, directoryDigest(dir)])),
    samplesPerCondition:options.samples, seedGenerator:'MurmurHash3 32-bit finalizer over base+i*0x9e3779b9; zero mapped to positive seed; duplicates skipped',
    baseSeed:options.seed, commonSeeds:seeds, variants, matchups:matchups.map(m => ({id:m.id,label:m.label})),
    frozenNowSeconds:fixture.nowSeconds ?? 1792800000,
    fightType:fixture.fightType ?? 1,
    fightTypeWasExplicit:fixture.fightType !== undefined,
    serverArenaModeValidated:false,
    instructionBudget:fixture.instructionBudget ?? 5000000,
    metricMeaning:{mainRawAttributedDamage:'Host-attributed sum of original message damage; includes overkill and attributed status damage, not a native game-returned damage counter', mainRawDirectDamage:'Original direct sub_hp damage to enemies; includes overkill',
      mainEffectiveDirectDamage:'Clipped direct damage, only when prior observed HP and the original direct result reconcile within 1 HP and there is no simultaneous HP buff effect; otherwise null. Gangqi/neijin effect records can make this conservative full-battle metric unavailable.',
      mainAuditedEffectiveDirectDamageSubtotal:'Sum of individually reconciled direct impacts; excludes ambiguous impacts and unassignable status damage',
      mainFinalAlive:'1 when main actor final HP is positive, including revived actors', mainFirstKnockdownRound:'First explicit die=true or nonpositive HP observation; null when unobserved; surviving/censored observations are not zero',
      firstObservedRounds:'First round a watched buff ID appears in main actor state/instant effect/round effect records, or a main action skill ID appears; missing trigger is null/unobserved rather than round zero',
      ci:'Intervals describe seed variation conditional on fixed simulator inputs; they do not account for model error or represent real-game win probabilities'},
    limitations:fixture.limitations || []};
  fs.writeFileSync(path.join(out, 'provenance.json'), JSON.stringify(provenance, null, 2));
  fs.writeFileSync(path.join(out, 'resolved-config.json'), JSON.stringify({...fixture, variants, matchups}, null, 2));
  const started = performance.now();
  let pool;
  try {
    pool = await runPool(tasks, options, {mainUid:fixture.mainUid, watchedBuffIds:fixture.watchedBuffIds || []}, (row, done, total) => {
      fs.writeSync(compact, JSON.stringify(row) + '\n');
      if (done <= options.jobs || done % 25 === 0 || done === total) console.log(JSON.stringify({done,total,matchup:row.matchupId,variant:row.variantId,status:row.status,elapsedMs:Math.round(row.elapsedMs),error:row.error?.message}));
    });
  } finally { fs.closeSync(compact); }
  const elapsedMs = performance.now() - started;
  const summary = {createdAt:new Date().toISOString(), constructed:true, privateContainsRawState, experimentScope:fixture.scope, elapsedMs, workers:pool.workerCount,
    peakProcessRssBytes:pool.peakRss, completedTasks:pool.rows.length, requestedTasks:tasks.length,
    ...summarizeExperiment(pool.rows, variants, matchups)};
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({outputDirectory:out,elapsedSeconds:elapsedMs/1000,workers:pool.workerCount,peakProcessRssMiB:pool.peakRss/1048576,
    completed:pool.rows.filter(r => r.status === 'completed').length, failed:pool.rows.filter(r => r.status === 'failed').length, limited:pool.rows.filter(r => r.status === 'limited').length}));
  if (pool.rows.some(r => r.status === 'failed')) process.exitCode = 1;
}

if (!isMainThread && workerData?.benchmarkWorker) await workerLoop();
else if (isMainThread && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
}
