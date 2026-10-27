import {allResults,LuaTable} from '../runtime/lua-vm.mjs';
import {resolveSkillSelection,applySkillSelection} from './skill-selection.mjs';
import {compileLiteral} from './lua-literal.mjs';

const collections={wai:'Taolus',nei:'Neis',qing:'Qings'};
const list=value=>Array.isArray(value)?value:Object.values(value||{});
const clone=value=>JSON.parse(JSON.stringify(value));
const statMethods={hp:'getHp',atk:'getAttack',def:'getDefence',speed:'getSpeed',hit:'getHit',dodge:'getDodge',parry:'getParry',mp:'getMpFirst',mpBack:'getMpBack',neijin:'getNeijin',gangqi:'getGangqi',str:'getBaseStr',dex:'getBaseDex',con:'getBaseCon',int:'getBaseInt'};
const extraMethods={dmgOff:'getDmgOff',dmgRef:'getDmgRef',defIgnore:'getDefIgnore',blood:'getBlood',poDodge:'getPoDodge',poParry:'getPoParry',renxing:'getRenXing',critMore:'getCritMore',critProMore:'getCritProMore',hpBack:'getHpBack',hpBackPercent:'getHpBackPercent',cure:'getCure',cureSJ:'getCureSJ',cureSJDown:'getCureSJDown',attackMpBack:'getAttackMpBack',xiNei:'getXiNei',xiNeiNum:'getXiNeiNum'};
const detailMethods=['getHpDetail','getAttackDetail','getDefenceDetail','getSpeedDetail','getHitDetail','getDodgeDetail','getParryDetail','getMpFirstDetail','getMpBackDetail','getNeijinDetail','getGangqiDetail'];
const finite=(value,label)=>{if(typeof value!=='number'||!Number.isFinite(value))throw Error(`原角色面板 ${label} 未返回有限数值。`);return value;};

export function unwrapSaveData(save){
  const data=save?.data||save;
  if(!data?.MainRole||!Array.isArray(data.Roles))throw Error('存档须包含 MainRole 和 Roles；只接受已解密的本地 JSON 数据。');
  return data;
}

function validateState(state){
  if(!state||typeof state!=='object'||Array.isArray(state))throw Error('savedState 须为原始角色数据对象。');
  for(const key of ['ID','Level','Type','Stand'])if(!Number.isInteger(state[key]))throw Error(`savedState 缺少整数 ${key}。`);
  for(const key of ['Taolus','Neis','Qings','Equips','Talents','JingMais','LifeSkills','LifeProps'])if(!state[key]||typeof state[key]!=='object')throw Error(`savedState 缺少 ${key}；不能用零值替代真实养成状态。`);
}

/** Import a private raw role without reducing its equipment, talents or skills to panels.
 * savedState is consumed in memory and is never included in returned panel JSON.
 * Existing skill records keep their original Zhao/Jingjin/SpecialProp data unless
 * explicit skillOptions request a change. Unowned skills require assumedSkills.
 */
export async function createSavedBattleRole(runtime,row,left,index=0){
  validateState(row.savedState);const state=clone(row.savedState);
  if(row.level!=null&&Number(row.level)!==state.Level)throw Error('savedState 导入保留存档等级；不得用另一个面板等级静默覆盖。');
  const {vm,firstMethod,callMethod}=runtime;
  if(!vm.globals.loadstring)vm.globals.loadstring=source=>compileLiteral(vm,source);
  const position=row.position==null?state.Stand-1:Number(row.position);
  if(!Number.isInteger(position)||position<0||position>6)throw Error('原存档角色必须有有效阵位；position 为 0–6。');
  const actor=runtime.instantiate('app/data/JHBattleData');
  callMethod(actor,'initWithConver',vm.fromJS(state));
  // Labels come from the caller, never from the account's character name.
  callMethod(actor,'setName',String(row.name||`角色 ${state.ID}`));
  const assumedIds=[];
  const addAssumption=(key,assumption,extraOptions={})=>{
    const id=Number(assumption?.id);
    if(!assumption||!Number.isInteger(id)||id<=0||!Number.isInteger(assumption.chong)||assumption.chong<1||assumption.chong>10||assumption.level!==3||!Array.isArray(assumption.jingjins))throw Error(`未学武学须显式提供 ${key} 的 id/chong/level=3/jingjins 假设。`);
    if(firstMethod(actor,'getWG',id))throw Error(`假设武学 ${id} 已存在，不能覆盖其真实保存状态。`);
    const selection=resolveSkillSelection(runtime,{key,id,options:{...assumption.options,...extraOptions,jingjins:assumption.jingjins}});
    const skill=firstMethod(actor,'addWG',id);if(!skill)throw Error(`原模型无法添加假设武学 ${id}。`);
    callMethod(skill,'setChong',assumption.chong);callMethod(skill,'setLevel',assumption.level);
    applySkillSelection(runtime,skill,selection,{actor,replaceZhaos:true});
    callMethod(actor,'setWGActive',skill,false);assumedIds.push(id);return skill;
  };
  // Apply the same inactive hypothetical learned set to every comparison arm.
  // This keeps learning-dependent passives fixed when the selected skill changes.
  for(const [key,assumptions]of Object.entries(row.learnedAssumptions||{})){
    if(!collections[key]||!Array.isArray(assumptions))throw Error('learnedAssumptions 须按 wai/nei/qing 提供数组。');
    for(const assumption of assumptions)addAssumption(key,assumption);
  }
  for(const key of Object.keys(collections)){
    const requested=row.skills?.[key];if(requested==null)continue;
    const id=Number(requested);if(!Number.isInteger(id)||id<=0)throw Error(`${key} 武学 ID 无效。`);
    let skill=firstMethod(actor,'getWG',id);
    if(!skill){
      const assumption=row.assumedSkills?.[key];
      if(Number(assumption?.id)!==id)throw Error(`原角色未拥有武学 ${id}；须显式提供 assumedSkills.${key}。`);
      skill=addAssumption(key,assumption,row.skillOptions?.[key]);
    }else{
      if(!skill)throw Error(`原存档导入后缺少已拥有武学 ${id}。`);
      if(row.skillLevels?.[key]!=null){const chong=Number(row.skillLevels[key]);if(!Number.isInteger(chong)||chong<1||chong>10)throw Error('武学重数须为 1–10。');callMethod(skill,'setChong',chong);}
      if(row.skillOptions?.[key])applySkillSelection(runtime,skill,resolveSkillSelection(runtime,{key,id,options:row.skillOptions[key]}),{actor,replaceZhaos:false});
    }
    const group=firstMethod(actor,{wai:'getTaolus',nei:'getNeis',qing:'getQings'}[key]);
    for(const other of group.entries.values())if(other!==skill)callMethod(actor,'setWGActive',other,false);
    callMethod(actor,'setWGActive',skill,true);
    const active=firstMethod(actor,{wai:'getActiveTaolu',nei:'getActiveNei',qing:'getActiveQing'}[key]);
    if(!active||firstMethod(active,'getID')!==id)throw Error(`原模型未能唯一激活所选武学 ${id}。`);
  }
  if(row.pvp!==false)callMethod(actor,'initForPVP');
  callMethod(actor,'setLeft',Boolean(left));callMethod(actor,'setStand',position+1);
  // Keep original Type and AI priorities from the save. Replace only the battle RNG.
  vm.set(actor,'__RandSeed',Math.max(1,Math.trunc(Number(runtime.seed)||1)+index+(left?0:4)));
  callMethod(actor,'resetBattle');
  vm.set(actor,'__webUid',String(row.uid||`${left?'ally':'enemy'}-${index}`));
  vm.set(actor,'__webSavedStateImported',true);
  vm.set(actor,'__webSavedPVP',row.pvp!==false);
  vm.set(actor,'__webAssumedSkillIDs',vm.table(assumedIds));
  vm.set(actor,'__webFreezeTimeSource',String(row.freezeTimeSource||'runtime.nowSeconds'));
  return actor;
}

function skillSummary(runtime,actor,key){
  const {vm,firstMethod}=runtime;
  const skill=firstMethod(actor,{wai:'getActiveTaolu',nei:'getActiveNei',qing:'getActiveQing'}[key]);
  if(!skill)return null;
  const result={id:firstMethod(skill,'getID'),chong:firstMethod(skill,'getChong'),level:firstMethod(skill,'getLevel')};
  const special=vm.get(skill,'getSpecialProp');if(special)result.specialProp=firstMethod(skill,'getSpecialProp');
  const zhaos=vm.get(skill,'getZhaos');
  if(zhaos){const values=firstMethod(skill,'getZhaos');result.zhaoIds=[...(values?.entries?.values()||[])].map(value=>firstMethod(value,'getID'));}
  const mzcb=vm.get(skill,'getMZCB');if(mzcb)result.mzcb=finite(firstMethod(skill,'getMZCB'),'getMZCB');
  const jj=vm.get(skill,'getJingjins');
  if(jj){const values=firstMethod(skill,'getJingjins');result.jingjins=[...(values?.entries?.values()||[])].map(value=>({id:firstMethod(value,'getID'),chong:firstMethod(value,'getChong')}));}
  return result;
}

/** Numeric public summary only; no account name, equipment instance IDs or seeds. */
export function readSavedBattlePanel(runtime,actor,{uid,name}={}){
  const {firstMethod}=runtime;
  const stats=Object.fromEntries(Object.entries(statMethods).map(([field,method])=>[field,finite(firstMethod(actor,method),method)]));
  const weapon=firstMethod(actor,'getEquipWeapon');stats.weaponAtk=weapon?finite(firstMethod(weapon,'getMainAtk'),'getMainAtk'):0;
  const advanced=Object.fromEntries(Object.entries(extraMethods).map(([field,method])=>[field,finite(firstMethod(actor,method),method)]));
  const details=Object.fromEntries(detailMethods.map(method=>[method,allResults(runtime.callMethod(actor,method)).map(value=>finite(value,method))]));
  const skillLevels={},skills={},skillState={};
  for(const key of Object.keys(collections)){const value=skillSummary(runtime,actor,key);skillState[key]=value;skills[key]=value?.id??null;skillLevels[key]=value?.chong??null;}
  const ai=firstMethod(actor,'getAITypes');
  const assumed=runtime.vm.get(actor,'__webAssumedSkillIDs');
  return {uid:String(uid||'role'),name:String(name||'角色'),roleId:firstMethod(actor,'getID')===1?10010:firstMethod(actor,'getID'),originalRoleId:firstMethod(actor,'getID'),type:firstMethod(actor,'getType'),level:firstMethod(actor,'getLevel'),position:firstMethod(actor,'getStand')-1,formation:{id:runtime.vm.get(actor,'m_nZhen'),level:runtime.vm.get(actor,'m_nZhenLv')},stats,advanced,details,skills,skillLevels,skillState,aiPriorities:ai instanceof LuaTable?[...ai.entries.values()]:[],aiOpen:firstMethod(actor,'getAIOpen'),metadata:{source:'Original JHBattleData.initWithConver + getters after resetBattle',pvpNormalized:Boolean(runtime.vm.get(actor,'__webSavedPVP')),freezeTime:{unixSeconds:runtime.nowSeconds,source:runtime.vm.get(actor,'__webFreezeTimeSource')},assumedLearnedSkillIDs:assumed instanceof LuaTable?[...assumed.entries.values()]:[],containsRawState:false,originalBattleValidated:false,limitations:['Original getters are reproduced locally; no current in-game panel screenshot comparison has been supplied.','Party and battle auras are applied by the original battle scheduler; this summary reads each imported role before a battle starts.']}};
}

export function savedPartyRows(save,{side='ally',pvp=true,freezeTimeSource='runtime.nowSeconds'}={}){
  const data=unwrapSaveData(save);
  return [data.MainRole,...data.Roles].filter(role=>role.Stand>0).map((savedState,index)=>({uid:`${side}-${index}`,name:savedState.ID===1?'主角':`侠士 ${savedState.ID}`,position:savedState.Stand-1,pvp,freezeTimeSource,savedState}));
}
