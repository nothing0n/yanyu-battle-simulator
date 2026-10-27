import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRuntime} from '../dist/engine/runtime.mjs';
import {createSavedBattleRole,readSavedBattlePanel,savedPartyRows,unwrapSaveData} from '../dist/integration/save-panel.mjs';

const args=process.argv.slice(2),option=name=>{const at=args.indexOf(name);return at<0?null:args[at+1];};
if(args.includes('--help')||!option('--save')){
  console.log('Usage: node tools/inspect-save-panel.mjs --save <private-decoded.json> [--output <private-summary.json>] [--seed <integer>] [--now-seconds <timestamp>] [--no-pvp]');
  console.log('Reads only. Outputs numeric party panels and selected public skills, never the raw save, account names, item instance IDs, private paths or stored RNG state.');
  process.exit(args.includes('--help')?0:1);
}
const seed=Number(option('--seed')||20261027);if(!Number.isInteger(seed)||seed<1||seed>4294967295)throw Error('seed must be 1–4294967295.');
const buffer=await fs.readFile(option('--save')),save=JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/,'')),data=unwrapSaveData(save),pvp=!args.includes('--no-pvp');
const nowSeconds=Number(option('--now-seconds')??data.RealTime);
if(!Number.isFinite(nowSeconds)||nowSeconds<1000000000||nowSeconds>10000000000)throw Error('A plausible Unix-second clock is required; use --now-seconds if save.RealTime is unavailable.');
const freezeTimeSource=option('--now-seconds')?'explicit --now-seconds':'historical save.RealTime';
const runtime=await createRuntime({readJSON:async url=>JSON.parse((await fs.readFile(url,'utf8')).replace(/^\uFEFF/,'')),seed,nowSeconds});runtime.require('app/ai/JHAIConfig');
const catalog=JSON.parse(await fs.readFile(new URL('../dist/data/catalog.json',import.meta.url),'utf8')),names=new Map(catalog.characters.map(role=>[Number(role.id),role.name]));
const panels=[];
for(const [index,row]of savedPartyRows(save,{pvp,freezeTimeSource}).entries()){
  row.name=row.savedState.ID===1?'主角':names.get(row.savedState.ID)||`侠士 ${row.savedState.ID}`;
  const actor=await createSavedBattleRole(runtime,row,true,index);
  const first=readSavedBattlePanel(runtime,actor,row),second=readSavedBattlePanel(runtime,actor,row);
  if(JSON.stringify(first)!==JSON.stringify(second))throw Error(`Original panel getters were unstable for ${row.uid}.`);
  panels.push(first);
}
const summary={schemaVersion:1,source:{saveVersion:String(save.version||data.DBVersion),sha256:crypto.createHash('sha256').update(buffer).digest('hex')},mode:pvp?'pvp':'raw',seed,freezeTime:{unixSeconds:nowSeconds,source:freezeTimeSource},panels,diagnostics:{missingImports:[...runtime.missing],getterReadsStable:true},privacy:{rawStateIncluded:false,accountNamesIncluded:false,equipmentInstanceIdsIncluded:false,privatePathsIncluded:false}};
const text=JSON.stringify(summary,null,2)+'\n',output=option('--output');
if(output){await fs.mkdir(path.dirname(path.resolve(output)),{recursive:true});await fs.writeFile(output,text);console.log(`Wrote ${panels.length} public role summaries.`);}else console.log(text);
