import {createRuntime} from '../engine/runtime.mjs';
import {LuaTable} from '../runtime/lua-vm.mjs';
import {createSavedBattleRole,readSavedBattlePanel} from './save-panel.mjs';

// Public gameplay blueprints only. Original serialized saves are never accepted here.
export const EDITOR_BUILD_VERSION=1;
export const PROFILE_FIELDS=Object.freeze(('Sex Type MaxLevel MaxJingJinPts AIType ZiZhi TalLucky Job BattleStage BattleIdle TotalPoint StrGift DexGift ConGift IntGift BornStr BornDex BornCon BornInt YiChuStr YiChuDex YiChuCon YiChuInt Str Dex Con Int QuanGift DaoGift JianGift GunGift NGGift QGGift StrAtk ConHp ConRen DexSpeed DexDodge IntMpFirst ExtAttack GrowAttack ExtDefence GrowDefence ExtHp GrowHp ExtMpFirst ExtHit GrowHit ExtDodge GrowDodge ExtSpeed GrowSpeed ExtParry ExtRen GrowRen ExtGangqi GrowGangqi ExtNeijin GrowNeijin NjGqOpen WXXW1 WXXW2 WXXW3 WXXW4 WXXWng WXXWqg MenPai Age IsMaster SkillOpenNum BattleQizhi CanZhu IsZhu HurtPercent IsNpc DieRemove TooFat HpState BattleHited AITypes').split(' '));
const BASE={atk:'Atk',def:'Def',hp:'Hp',hit:'Hit',dodge:'Dodge',speed:'Speed',parry:'Parry',renxing:'RenXing',neijin:'Neijin',gangqi:'Gangqi'};
const SLOT={1:'weapon',2:'weapon',3:'weapon',4:'weapon',5:'belt',6:'bracer',7:'armor',8:'ring',9:'pendant'};
const groups={wai:'Taolus',nei:'Neis',qing:'Qings'};
const clone=v=>JSON.parse(JSON.stringify(v));
const vals=v=>Array.isArray(v)?v:Object.values(v||{});
const plain=v=>v instanceof LuaTable?Object.fromEntries([...v.entries].map(([k,x])=>[k,plain(x)])):v;
const obj=(v,label)=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error(`${label} 必须是对象`);return v;};
const arr=(v,label)=>{if(!Array.isArray(v))throw Error(`${label} 必须是数组`);return v;};
const keys=(v,allowed,label)=>{obj(v,label);for(const k of Object.keys(v))if(!allowed.includes(k))throw Error(`${label} 不接受字段 ${k}；只接受脱敏网页配置`);};
const number=(n,label,min=-100000000,max=100000000)=>{if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)throw Error(`${label} 数值无效（${min}–${max}）`);return n;};
const integer=(n,label,min=0,max=100000000)=>{number(n,label,min,max);if(!Number.isInteger(n))throw Error(`${label} 必须是整数`);return n;};
const optionKeys=['jingjins','form','stage','specialProp','yuhuaChoices','wuduStage'];
let assetPromise,panelRuntimePromise;
async function defaultRead(url){if(url.protocol==='file:'&&typeof process!=='undefined'&&process.versions?.node){const fs=await import('node:fs/promises');return JSON.parse((await fs.readFile(url,'utf8')).replace(/^\uFEFF/,''));}const response=await fetch(url);if(!response.ok)throw Error(`配置读取失败：${response.status}`);return response.json();}
export async function loadEditorAssets(options={}){
 const read=options.readJSON||defaultRead;
 const load=async()=>{const [catalog,data,formationCatalog]=await Promise.all([read(new URL('../data/editor-catalog.json',import.meta.url)),read(new URL('../data/team-presets.json',import.meta.url)),read(new URL('../data/formations.json',import.meta.url))]);return {...catalog,...data,catalog,formationCatalog};};
 if(options.readJSON)return load();return assetPromise||=load().catch(e=>{assetPromise=null;throw e;});
}
export function clonePresetTeam(preset,side='enemy',formationId){
 if(!preset||!Array.isArray(preset.team))throw Error('预设阵容无效');
 const selected=preset.formations?.find(f=>f.id===Number(formationId))||preset.formations?.[0]||preset.team[0]?.formation||{id:0,level:1};
 const formation={id:Number(selected.id),level:Number(selected.level||3)};
 const rows=clone(preset.team).map((r,i)=>({...r,uid:`${side}-preset-${i}`,formation:{...formation},position:selected.positions?.[i]??r.position}));
 return {rows,formation};
}
function validateSkill(s,label){keys(s,['id','chong','level','maxChong','active','specialProp','zhaos','jingjins'],label);integer(s.id,label+'.id',1);integer(s.chong,label+'.chong',1,30);integer(s.level,label+'.level',0,3);if(s.active!=null&&typeof s.active!=='boolean')throw Error('武学激活值必须为布尔值');if(s.maxChong!=null)integer(s.maxChong,label+'.maxChong',1,30);if(s.specialProp!=null)number(s.specialProp,label+'.specialProp');arr(s.zhaos,label+'.zhaos').forEach(x=>integer(x,label+'.zhao',1));arr(s.jingjins,label+'.jingjins').forEach(x=>{keys(x,['id','chong'],label+'.jingjin');integer(x.id,label+'.jingjin.id',1);integer(x.chong,label+'.jingjin.chong',0,10);});}
function validateLife(x,label){keys(x,['id','level','projectileId'],label);integer(x.id,label+'.id',1);integer(x.level,label+'.level',1,300);if(x.projectileId!=null)integer(x.projectileId,label+'.projectileId',0,1000000);}
function validateTalent(x,label){if(x==null)return;keys(x,['id','rank'],label);integer(x.id,label+'.id',1);if(x.rank!=null)number(x.rank,label+'.rank',0);}
function secretErrors(row,catalog){
 const errors=[],secrets=row.build.secrets,ids=new Set(),only=new Set();
 const records=catalog?.secrets||[],martial=catalog?.martial?.find(x=>x.id===Number(row.skills.wai));
 const weapon=martial?.type??row.build.equipment.find(x=>x.slotKey==='weapon')?.slot;
 for(const s of secrets){if(ids.has(s.id))errors.push(`秘技 ${s.id} 重复`);ids.add(s.id);const c=records.find(x=>x.id===s.id);if(catalog&&!c){errors.push(`未知秘技 ${s.id}`);continue;}if(!c)continue;
  if(s.level>(c.maxLevel||300))errors.push(`${c.name} 等级超限`);
  if(c.exclusiveGroup!=null){if(only.has(c.exclusiveGroup))errors.push(`${c.name} 与已选秘技互斥`);only.add(c.exclusiveGroup);}
  const chars=Array.isArray(c.characterIds)?c.characterIds:[];
  if(chars.length&&!chars.some(id=>id===row.roleId||row.roleId===10010&&[1,101,10010].includes(id)))errors.push(`${c.name} 不适用于该角色`);
  if(c.weaponTypes?.length&&!c.weaponTypes.includes(weapon))errors.push(`${c.name} 不适用于当前外功武器类型`);
  // mp_sk marks school acquisition/conditional effects, not a universal equip lock.
  // Native model evaluates those effects using the blueprint's MenPai field.
 }
 return errors;
}
export function validateEditorRole(row,catalog){
 keys(row,['uid','name','roleId','level','position','pvp','skills','skillLevels','skillOptions','formation','build','stats','aiOpen','aiTypes','weaponSkin'],'角色');
 if(!row.build)throw Error('此入口要求原模型 build');
 if(typeof row.uid!=='string'||row.uid.length>120||typeof row.name!=='string'||row.name.length>80)throw Error('角色名称或网页行标识无效');
 if(row.pvp!=null&&typeof row.pvp!=='boolean')throw Error('PVP配置必须为布尔值');
 if(row.stats){keys(row.stats,['hp','atk','def','speed','hit','dodge','parry','mp','mpBack','neijin','gangqi','str','dex','con','int','weaponAtk'],'旧手填面板');Object.values(row.stats).forEach(x=>number(x,'旧手填面板'));}
 if(row.aiTypes!=null)arr(row.aiTypes,'AI').forEach(x=>integer(x,'AI',1,3));if(row.aiOpen!=null&&typeof row.aiOpen!=='boolean')throw Error('AI开关无效');if(row.weaponSkin!=null)integer(row.weaponSkin,'武器外观',0);
 integer(row.roleId,'roleId',1);integer(row.level,'角色等级',1,100);integer(row.position,'站位',0,6);
 keys(row.skills,['wai','nei','qing'],'武学');for(const key of Object.keys(groups))integer(row.skills[key],`武学.${key}`,1);
 if(row.skillLevels){keys(row.skillLevels,['wai','nei','qing'],'武学重数');for(const v of Object.values(row.skillLevels))integer(v,'武学重数',1,10);}
 if(row.skillOptions){keys(row.skillOptions,['wai','nei','qing'],'武学选项');for(const v of Object.values(row.skillOptions)){keys(v,optionKeys,'武学选项');for(const [k,x]of Object.entries(v)){if(k==='jingjins'){arr(x,'精进').forEach(j=>{keys(j,['id','chong','maxChong','ID','Chong','MaxChong'],'精进');for(const [n,a]of Object.entries(j))integer(a,`精进.${n}`,n.toLowerCase()==='id'?1:0,n.toLowerCase()==='id'?100000000:10);});}else if(k==='yuhuaChoices'){keys(x,['second','third','fourth','fifth'],'羽化分支');for(const [g,z]of Object.entries(x))if(!({second:['yangyu','yingxue','suoqi'],third:['zhenyuan','zhenshan','zhenliu'],fourth:['benshou','bishou','wending'],fifth:['diyu','jinghua']}[g].includes(z)))throw Error('羽化分支无效');}else if(k==='specialProp')integer(x,'内功属性',1,3);else if(typeof x!=='string'||x.length>40)throw Error('武学选项格式无效');}}}
 if(row.formation){keys(row.formation,['id','level'],'阵法');integer(row.formation.id,'阵法ID',0);integer(row.formation.level,'阵法等级',1,3);if(row.formation.id&&catalog?.formationCatalog){const f=catalog.formationCatalog.formations.find(f=>f.id===row.formation.id);if(!f||!f.allowedSlots.includes(row.position+1))throw Error('该角色站位不属于当前阵法合法格位');}}
 const b=row.build;keys(b,['version','profile','learned','training','equipment','secrets','secretSlots'],'build');if(b.version!==1)throw Error('不支持的 build 版本');
 keys(b.profile,PROFILE_FIELDS,'profile');for(const [k,v]of Object.entries(b.profile)){if(k==='AITypes')arr(v,k).forEach(x=>integer(x,k,1,3));else if(typeof v!=='boolean')number(v,`profile.${k}`);}
 keys(b.learned,['wai','nei','qing'],'learned');for(const key of Object.keys(groups)){arr(b.learned[key],`learned.${key}`).forEach((s,i)=>validateSkill(s,`${key}[${i}]`));if(!b.learned[key].some(s=>s.id===row.skills[key]))throw Error(`当前${key}武学尚未包含在公开学武配置`);}
 if(catalog){const martial=catalog.martial.find(x=>x.id===row.skills.wai),weapon=b.equipment.find(x=>x.slotKey==='weapon');if(!martial)throw Error('当前外功缺少可验证原始武器类型');if(weapon&&weapon.slot!==martial.type)throw Error('武器装备类型与当前外功不匹配');}
 const t=b.training;keys(t,['lifeSkills','talents','bornTalent','luckTalent','meridians','hedao','cityBuffs','sect','change'],'training');
 arr(t.lifeSkills,'生活技能').forEach(x=>validateLife(x,'生活技能'));arr(t.talents,'天赋').forEach(x=>validateTalent(x,'天赋'));validateTalent(t.bornTalent,'固有天赋');validateTalent(t.luckTalent,'额外天赋');
 arr(t.meridians,'经脉').forEach(x=>{keys(x,['id','order','index','tong'],'经脉');integer(x.id,'经脉ID',1);for(const k of ['order','index','tong'])if(typeof x[k]!=='boolean'&&x[k]!=null)number(x[k],`经脉.${k}`,-1);});
 arr(t.hedao,'合道').forEach(x=>integer(x,'合道ID',1));arr(t.cityBuffs,'城市增益').forEach(x=>{keys(x,['id','chong','round','elapsedSeconds'],'城市增益');integer(x.id,'城市增益ID',1);for(const k of ['chong','round','elapsedSeconds'])number(x[k],`城市增益.${k}`,0);});
 keys(t.sect,['job','dmgoff'],'门派数值');Object.values(t.sect).forEach(x=>number(x,'门派数值'));keys(t.change,['maskshift'],'变形数值');Object.values(t.change).forEach(x=>{if(Array.isArray(x))x.forEach(v=>integer(v,'变形buff',1));else if(typeof x!=='boolean')number(x,'变形数值');});
 const slots=new Set();arr(b.equipment,'装备').forEach((e,i)=>{keys(e,['slot','slotKey','templateId','level','color','base','modifiers','affixes','effects','fragments'],`装备${i}`);integer(e.templateId,'装备模板',1);integer(e.slot,'装备类型',1,12);const sk=SLOT[e.slot]||`special-${e.slot}`;if(e.slotKey!==sk)throw Error('装备槽与类型不一致');if(slots.has(sk))throw Error(`重复装备槽 ${sk}`);slots.add(sk);if(catalog&&!catalog.equipment.some(c=>c.id===e.templateId&&c.type===e.slot))throw Error('装备模板与类型不匹配');integer(e.level,'装备等级',0,100);integer(e.color,'装备品质',0,10);keys(e.base,Object.keys(BASE),'装备基础');Object.values(e.base).forEach(v=>number(v,'装备基础',0,10000000));keys(e.modifiers,['levelProperty','refinementLevel','extraNeijin','extraGangqi'],'装备修饰');Object.values(e.modifiers).forEach(v=>number(v,'装备修饰',0));arr(e.affixes,'装备词条').forEach(a=>{keys(a,['id','value','source'],'词条');if(typeof a.id!=='string'||a.id.length>50)throw Error('词条ID无效');if(catalog&&!catalog.affixes.some(c=>c.id===a.id))throw Error(`未知原模型词条 ${a.id}`);number(a.value,'词条数值',-1000000,1000000);if(!['extra','full','special'].includes(a.source||'extra'))throw Error('词条来源无效');});arr(e.effects,'装备效果').forEach(x=>{keys(x,['buff','type','probability','pro','count','tag','chong'],'装备效果');integer(x.buff,'装备效果buff',1);integer(x.type,'装备效果type',0,100);number(x.probability??x.pro,'效果概率',0,1);number(x.count??-1,'效果次数',-1,10000);if(x.chong!=null)integer(x.chong,'效果层级',0,100);if(typeof x.tag!=='string'||x.tag.length>100)throw Error('效果tag无效');});arr(e.fragments,'装备碎片').forEach(x=>integer(x,'碎片ID',1));});
 integer(b.secretSlots,'秘技槽',1,5);const unlocked=Math.min(5,Math.floor(row.level/30)+1+(b.profile.SkillOpenNum||0));if(b.secretSlots>unlocked)throw Error(`该等级仅有${unlocked}个秘技槽`);arr(b.secrets,'秘技').forEach(x=>validateLife(x,'秘技'));if(b.secrets.length>b.secretSlots)throw Error('秘技数量超过解锁槽位');const errors=secretErrors(row,catalog);if(errors.length)throw Error(errors.join('；'));
 return row;
}
function nativeRecord(rt,module,id,level){const x=rt.instantiate(module);rt.callMethod(x,'initWithID',id);if(level!=null)rt.callMethod(x,'setLevel',level);return plain(rt.firstMethod(x,'converToTable'));}
function nativeEquipment(rt,e){
 const x=rt.instantiate('app/data/JHEquipData');rt.vm.set(x,'m_nID',e.templateId);rt.callMethod(x,'updateCfg');
 for(const [k,native]of Object.entries(BASE))rt.vm.set(x,'m_n'+native,e.base[k]||0);
 for(const [field,key]of Object.entries({m_nLvProp:'levelProperty',m_nXLLevel:'refinementLevel',m_nExtraNeij:'extraNeijin',m_nExtraGangqi:'extraGangqi'}))rt.vm.set(x,field,e.modifiers[key]||0);
 const s=plain(rt.firstMethod(x,'converToTable'));Object.assign(s,{Level:e.level,Color:e.color,OnlyID:0,Num:1});
 let n=1;for(const [source,key]of [['extra','EnExts'],['full','EnMans'],['special','EnSpecials']])s[key]=e.affixes.filter(a=>(a.source||'extra')===source).map(a=>({S:n++,Key:a.id,Value:a.value,PropCheck:0}));
 s.EnStroys=e.effects.map(a=>({S:n++,Buff:a.buff,Type:a.type,Chong:a.chong||0,Pro:a.probability??a.pro,Desc:'',Tag:a.tag,Count:a.count??-1}));s.EnFumos=e.fragments.map(id=>({S:n++,ID:id}));return s;
}
export function buildEditorNativeState(rt,row){
 validateEditorRole(row);rt.require('app/ai/JHAIConfig');
 const base=rt.instantiate('app/data/JHBattleData'),s=plain(rt.firstMethod(base,'converToTable')),b=row.build,t=b.training;let seq=1000;
 Object.assign(s,clone(b.profile),{S:++seq,ID:row.roleId===10010?1:row.roleId,Name:row.name,Level:row.level,Stand:row.position+1,Zhen:row.formation?.id||0,ZhenLv:row.formation?.level||1});
 for(const [key,field]of Object.entries(groups))s[field]=b.learned[key].map(x=>({S:++seq,ID:x.id,Chong:x.chong,MaxChong:x.maxChong||10,Fast:0,Level:x.level,LearnTime:0,Active:x.active,ItemFast:0,...(x.specialProp!=null?{SpecialProp:x.specialProp}:{}),Zhaos:x.zhaos.map(id=>({S:++seq,ID:id})),Jingjins:x.jingjins.map(j=>({S:++seq,ID:j.id,Chong:j.chong,MaxChong:10}))}));
 const talent=x=>x?{S:++seq,ID:x.id,RC:x.rank||0,Lock:false,IDCheck:0,Time:0}:{};
 s.Talents=t.talents.map(talent);s.BornTalent=talent(t.bornTalent);s.LuckTalent=talent(t.luckTalent);
 s.JingMais=t.meridians.map(x=>({S:++seq,ID:x.id,Order:x.order,Index:x.index,Tong:x.tong}));s.HeDaoSkill=t.hedao.map(id=>({S:++seq,ID:id}));
 s.LifeSkills=t.lifeSkills.map(x=>({...nativeRecord(rt,'app/data/JHLifeData',x.id,x.level),S:++seq,AnQi:x.projectileId||0}));
 s.LifeProps=b.secrets.map(x=>({...nativeRecord(rt,'app/data/JHLifeData',x.id,x.level),S:++seq,AnQi:x.projectileId||0}));
 s.Equips=b.equipment.map(e=>({...nativeEquipment(rt,e),S:++seq,OnlyID:++seq}));
 s.CityBuffs=t.cityBuffs.map(x=>({S:++seq,ID:x.id,Chong:x.chong,Round:x.round,Time:rt.nowSeconds-x.elapsedSeconds}));s.ChangeXXData=clone(t.change);s.SectProp=clone(t.sect);s.EatDrugs={};
 return s;
}
export async function createEditorBattleRole(runtime,row,left,index=0){
 const assets=await loadEditorAssets();validateEditorRole(row,assets);
 return createSavedBattleRole(runtime,{uid:row.uid,name:row.name,position:row.position,level:row.level,pvp:row.pvp!==false,skills:row.skills,skillLevels:row.skillLevels,skillOptions:row.skillOptions,savedState:buildEditorNativeState(runtime,row)},left,index);
}
export async function inspectEditorRole(row,options={}){
 const make=()=>createRuntime({readJSON:options.readJSON||defaultRead,seed:options.seed||17,instructionBudget:options.instructionBudget||50000000,nowSeconds:options.nowSeconds??1792800000,requireIntegration:true});
 const runtime=options.runtime||await(options.readJSON||options.nowSeconds!=null||options.seed!=null?make():(panelRuntimePromise||=make().catch(e=>{panelRuntimePromise=null;throw e;})));
 const actor=await createEditorBattleRole(runtime,row,true,0),panel=readSavedBattlePanel(runtime,actor,row);
 const active=runtime.firstMethod(actor,'getLifeSkillsAndProps'),activeLifeIds=vals(active instanceof LuaTable?[...active.entries.values()]:active).map(x=>runtime.firstMethod(x,'getID'));
 const activeSecretIds=activeLifeIds.filter(id=>row.build.secrets.some(s=>s.id===id));
 return {...panel,model:'native-blueprint',activeSecretIds,formationProps:plain(runtime.firstMethod(actor,'getZhenProp')),metadata:{...panel.metadata,source:'Public gameplay blueprint → original JHEquipData/JHLifeData → JHBattleData.initWithConver/getters',containsRawState:false}};
}
export async function createEquipmentFromTemplate(templateId,options={}){
 const {catalog}=await loadEditorAssets();const c=catalog.equipment.find(x=>x.id===Number(templateId));if(!c)throw Error('未知装备模板');
 const rt=options.runtime||await createRuntime({readJSON:options.readJSON||defaultRead,seed:options.seed||17});
 const e=rt.instantiate('app/data/JHEquipData');rt.callMethod(e,'initWithID',c.id);const get=k=>Number(rt.vm.get(e,'m_n'+BASE[k])||0),s=plain(rt.firstMethod(e,'converToTable'));
 return {slot:c.type,slotKey:c.slotKey,templateId:c.id,level:s.Level||0,color:s.Color||0,base:Object.fromEntries(Object.keys(BASE).map(k=>[k,get(k)])),modifiers:{levelProperty:0,refinementLevel:0,extraNeijin:0,extraGangqi:0},affixes:[['EnExts','extra'],['EnMans','full'],['EnSpecials','special']].flatMap(([k,source])=>vals(s[k]).map(a=>({id:a.Key,value:a.Value,source}))),effects:[],fragments:[]};
}
