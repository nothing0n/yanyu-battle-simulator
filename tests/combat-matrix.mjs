import fs from 'node:fs';
import {runOriginalBattle} from '../dist/engine/battle-runner.mjs';
const readJSON=async url=>JSON.parse(fs.readFileSync(url,'utf8'));
const role=(uid,id,name,wai=20010,nei=22010,qing=24010,pos=0)=>({uid,roleId:id,name,level:90,position:pos,skills:{wai,nei,qing},skillLevels:{wai:10,nei:10,qing:10},stats:{hp:18000,atk:5000,def:3000,speed:800,hit:1500,dodge:800,parry:900,mp:50,mpBack:10,str:250,dex:250,con:250,int:250}});
const cases=[
 {name:'basic4v4',ally:[role('a0',10010,'主角',20010,22010,24010,0),role('a1',10012,'苏念雪',20020,22010,24010,1),role('a2',10013,'厉若海',20030,22010,24010,2),role('a3',10015,'柳如意',20040,22010,24010,3)],enemy:[role('b0',10011,'陈元封',20040,22010,24010,0),role('b1',10012,'苏念雪',20020,22010,24010,1),role('b2',10013,'厉若海',20030,22010,24010,2),role('b3',10014,'田鹏',20010,22010,24010,3)]},
 {name:'advancedFist',ally:[role('a',10010,'主角',20460,22250,24320)],enemy:[role('b',10013,'厉若海',20390,22130,24320)]},
 {name:'advancedSword',ally:[role('a',10012,'苏念雪',20380,22340,24320)],enemy:[role('b',10011,'陈元封',20390,22330,24320)]}
];
const ui=JSON.parse(fs.readFileSync(new URL('./fixtures/ui-default-config.json',import.meta.url),'utf8'));cases.push({name:'uiDefault',ally:ui.teams.ally,enemy:ui.teams.enemy,seed:ui.seed,maxRounds:ui.maxRounds});
const results=[];
for(const c of cases){try{const r=await runOriginalBattle({seed:c.seed||1001,maxRounds:c.maxRounds||30,teams:{ally:c.ally,enemy:c.enemy}},{readJSON,frameBudget:50000});fs.writeFileSync(new URL('./combat-'+c.name+'-result.json',import.meta.url),JSON.stringify(r,null,2));results.push({name:c.name,ok:true,winner:r.winner,rounds:r.rounds,events:r.events.length,frames:r.metadata.frames,stats:r.stats,skills:[...new Set(r.events.map(x=>x.skill).filter(Boolean))]});}catch(error){results.push({name:c.name,ok:false,message:error.message,details:error.details});}console.log(JSON.stringify(results.at(-1)));}
fs.writeFileSync(new URL('./combat-matrix-result.json',import.meta.url),JSON.stringify(results,null,2));
if(results.some(x=>!x.ok))process.exitCode=1;
