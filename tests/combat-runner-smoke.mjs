import fs from 'node:fs';
import {runOriginalBattle} from '../dist/engine/battle-runner.mjs';
const role=(uid,id,name,pos=0)=>({uid,roleId:id,name,level:90,position:pos,skills:{wai:20010,nei:22010,qing:24010},skillLevels:{wai:10,nei:10,qing:10},stats:{hp:10000,atk:4500,def:2500,speed:700,hit:1000,dodge:500,parry:650,mp:30,mpBack:10,str:200,dex:200,con:200,int:200}});
const config={seed:1001,maxRounds:20,teams:{ally:[role('a',10011,'苏念雪')],enemy:[role('b',10012,'厉若海')]}};
try{
 const result=await runOriginalBattle(config,{readJSON:async url=>JSON.parse(fs.readFileSync(url,'utf8')),frameBudget:20000});
 fs.writeFileSync(new URL('./combat-runner-result.json',import.meta.url),JSON.stringify(result,null,2));
 console.log(JSON.stringify({winner:result.winner,rounds:result.rounds,stats:result.stats,events:result.events.length,raw:result.rawMessages.length,metadata:result.metadata},null,2));
}catch(e){console.error(e,e.details);process.exitCode=1;}
