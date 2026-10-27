import {firstResult} from '../runtime/lua-vm.mjs';

const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
const kinds={wai:{kind:'TL',table:'kongfu_tl_data',upgrade:'kongfu_zsupgrade_data'},nei:{kind:'NG',table:'kongfu_ng_data',upgrade:'kongfu_ngupgrade_data'},qing:{kind:'QG',table:'kongfu_dodge_data',upgrade:'kongfu_dodgeupgrade_data'}};
const forms={yin:1,yang:2,mixed:3};
const keys=new Set(['form','stage','specialProp','jingjins','yuhuaChoices']);
const yuhuaGroups={
  second:{yangyu:[23722],yingxue:[123722],suoqi:[123721]},
  third:{zhenyuan:[23723],zhenshan:[123723],zhenliu:[123724]},
  fourth:{benshou:[23724],bishou:[123725],wending:[123726]},
  fifth:{diyu:[23725,23726,23727],jinghua:[123727,123728,123729]},
};

function integer(value,label,min,max){
  const result=Number(value);
  if(!Number.isInteger(result)||result<min||result>max)throw new Error(`${label}须为 ${min}–${max} 的整数。`);
  return result;
}

/** Resolve a manual/assumed skill input against this snapshot's original config.
 * Existing saved skills retain their serialized Zhaos/Jingjins unless an option
 * is explicitly supplied. This does not replace the game's acquisition checks.
 */
export function resolveSkillSelection(runtime,{key,id,options={}}){
  const spec=kinds[key];if(!spec)throw new Error(`不支持的武学栏：${key}`);
  id=integer(id,'武学 ID',1,1e9);
  const {vm}=runtime,cfg=vm.get(runtime.configFor(spec.table),String(id));
  if(!cfg)throw new Error(`武学 ${id} 不属于${{wai:'外功',nei:'内功',qing:'轻功'}[key]}栏。`);
  if(!options||typeof options!=='object'||Array.isArray(options))throw new Error('武学选项须为对象。');
  for(const field of Object.keys(options))if(!keys.has(field))throw new Error(`未知武学选项：${field}`);
  if(own(options,'form')&&!(key==='nei'&&id===53060))throw new Error('只有归云诀可以选择体态 form。');
  if(own(options,'stage')&&!(key==='nei'&&id===23620))throw new Error('只有镇派道心种魔可以选择进阶 stage。');
  if(own(options,'yuhuaChoices')&&!(key==='nei'&&id===23720))throw new Error('只有羽化真功可以选择 yuhuaChoices。');
  const variableProp=key==='nei'&&vm.get(cfg,'prop')===4;
  if(own(options,'specialProp')&&!variableProp)throw new Error(`武学 ${id} 的内功属性固定，不能指定 specialProp。`);
  let specialProp=variableProp?3:undefined;
  if(own(options,'specialProp'))specialProp=integer(options.specialProp,'内功属性',1,3);
  let form;
  if(key==='nei'&&id===53060){
    form=options.form??(own(options,'specialProp')?Object.keys(forms).find(name=>forms[name]===specialProp):'mixed');
    if(!own(forms,form))throw new Error('归云体态须为 yin、yang 或 mixed。');
    if(own(options,'specialProp')&&forms[form]!==specialProp)throw new Error('归云体态与 specialProp 不一致。');
    specialProp=forms[form];
  }
  let stage;
  if(key==='nei'&&id===23620){
    stage=options.stage??'four-sha';
    if(!['four-sha','five-sha','six-sha'].includes(stage))throw new Error('道心阶段须为 four-sha、five-sha 或 six-sha。');
  }
  const utils=runtime.require('app/excelutils/JHWGUtils'),zhaoIds=[];
  for(let offset=1;offset<=9;offset++){
    const zhao=id+offset;
    if(firstResult(vm.call(vm.get(utils,'getZhaosById'),[spec.kind,zhao])))zhaoIds.push(zhao);
  }
  // The target skills have alternative acquisitions; never activate every row.
  // Saved-state imports use the player's exact serialized list instead.
  let groups=[];
  if(id===23620&&key==='nei'){
    groups=[{ids:[23623,23626],selected:stage==='four-sha'?23623:23626},{ids:[23624,23627],selected:stage==='six-sha'?23627:23624}];
  }
  if(id===53060&&key==='nei'){
    const selected={mixed:[53062,53063],yin:[53066,53068],yang:[53067,53069]}[form];
    groups=[{ids:[53062,53066,53067],selected:selected[0]},{ids:[53063,53068,53069],selected:selected[1]}];
  }
  let yuhuaChoices;
  if(id===23720&&key==='nei'){
    const choices=options.yuhuaChoices??{};
    if(!choices||typeof choices!=='object'||Array.isArray(choices))throw new Error('羽化 yuhuaChoices 须为对象。');
    for(const choice of Object.keys(choices))if(!own(yuhuaGroups,choice))throw new Error(`未知羽化选择组：${choice}`);
    yuhuaChoices={};
    for(const [choice,variants] of Object.entries(yuhuaGroups)){
      const variant=choices[choice]??Object.keys(variants)[0];
      if(!own(variants,variant))throw new Error(`羽化 ${choice} 选择无效：${variant}`);
      yuhuaChoices[choice]=variant;
      const ids=Object.values(variants).flat(),selected=variants[variant];
      groups.push({ids,selected,choice});
    }
  }
  // Original event4697 grants 121753 with the first book (max 3), and grants
  // 121751/121752 with the lower book (max 10, available from skill level 24).
  // These are retained in the full-book manual preset; original layer_rel
  // gates 121753 at 3 chong and 121751/121752 at 10 chong during combat.
  if(id===21750&&key==='wai')for(const extra of [121753,121751,121752]){
    if(!firstResult(vm.call(vm.get(utils,'getZhaosById'),[spec.kind,extra])))throw new Error(`原始夺天地隐藏招式 ${extra} 缺失。`);
    zhaoIds.push(extra);
  }
  let selectedIds=[...zhaoIds];
  for(const group of groups){
    const position=selectedIds.findIndex(move=>group.ids.includes(move));
    selectedIds=selectedIds.filter(move=>!group.ids.includes(move));
    selectedIds.splice(position<0?selectedIds.length:position,0,...(Array.isArray(group.selected)?group.selected:[group.selected]));
  }
  for(const move of selectedIds)if(!firstResult(vm.call(vm.get(utils,'getZhaosById'),[spec.kind,move])))throw new Error(`原始招式 ${move} 缺失。`);
  let jingjins;
  if(own(options,'jingjins')){
    if(!Array.isArray(options.jingjins))throw new Error('精进 jingjins 须为数组。');
    const maximum=Number(vm.globals.JH_SKILL_JINGJIN_MAX);
    if(!Number.isInteger(maximum)||maximum<1)throw new Error('原始精进重数上限尚未加载。');
    const used=new Set(),table=runtime.configFor(spec.upgrade);
    jingjins=options.jingjins.map(row=>{
      if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('每项精进须为对象。');
      for(const field of Object.keys(row))if(!['id','chong','maxChong','ID','Chong','MaxChong'].includes(field))throw new Error(`未知精进字段：${field}`);
      for(const [lower,upper] of [['id','ID'],['chong','Chong'],['maxChong','MaxChong']])if(own(row,lower)&&own(row,upper)&&Number(row[lower])!==Number(row[upper]))throw new Error(`精进 ${lower}/${upper} 不一致。`);
      const branch=integer(row.id??row.ID,'精进 ID',1,1e9);
      if(![1,2,3].some(n=>branch===Number(String(id)+n))||!vm.get(table,String(branch)))throw new Error(`精进 ${branch} 不属于武学 ${id} 的有效精进。`);
      if(used.has(branch))throw new Error(`精进 ${branch} 重复。`);used.add(branch);
      const maxChong=integer(row.maxChong??row.MaxChong??maximum,'精进上限',0,maximum);
      const chong=integer(row.chong??row.Chong,'精进重数',0,maxChong);
      return {id:branch,chong,maxChong};
    });
  }
  const replacementGroups=groups.filter(group=>!group.choice||own(options.yuhuaChoices??{},group.choice));
  return {key,id,zhaoIds:selectedIds,specialProp,specialPropExplicit:own(options,'specialProp')||own(options,'form'),jingjins,groups,replacementGroups,replaceBranches:own(options,'form')||own(options,'stage')||(id===53060&&own(options,'specialProp'))||Object.keys(options.yuhuaChoices??{}).length>0,form,stage,yuhuaChoices};
}

/** Apply acquisition choices to an in-memory skill using original model methods.
 * replaceZhaos is for newly constructed manual/assumed skills only. An owned
 * save import must leave it false to preserve its additional replacement moves.
 * resetBattle remains the caller's responsibility after all skills are ready.
 */
export function applySkillSelection(runtime,skill,selection,{actor,replaceZhaos=false}={}){
  const {vm,firstMethod,callMethod}=runtime;
  if(!actor&&(replaceZhaos||selection.replaceBranches))throw new Error('装配招式时需要原始角色对象。');
  const chong=firstMethod(skill,'getChong'),level=firstMethod(skill,'getLevel');
  if(selection.form&&selection.form!=='mixed'&&(replaceZhaos||selection.replaceBranches)&&((chong-1)*4+level+1)<40)throw new Error('归云诀须达到10重大圆满（原技能等级40）才可切换阴、阳体态。');
  if(selection.stage&&selection.stage!=='four-sha'&&(replaceZhaos||selection.replaceBranches)&&chong<10)throw new Error('道心种魔第五斩及之后的进阶预设要求内功十重。');
  if(replaceZhaos){
    vm.set(skill,'m_tZhaos',vm.table([]));
    for(const id of selection.zhaoIds)firstMethod(actor,'addZhao',skill,id);
  }else if(selection.replaceBranches){
    const original=[...firstMethod(skill,'getZhaos').entries.values()];
    let rows=original;
    for(const group of selection.replacementGroups){
      const positions=rows.map((move,index)=>group.ids.includes(firstMethod(move,'getID'))?index:-1).filter(index=>index>=0);
      if(!positions.length)throw new Error(`已保存武学 ${selection.id} 缺少可替换招式；请保留其原始 Zhaos 或提供准确存档。`);
      const replacements=[];
      for(const id of Array.isArray(group.selected)?group.selected:[group.selected]){
        let replacement=rows.find(move=>firstMethod(move,'getID')===id);
        if(!replacement){
          firstMethod(actor,'addZhao',skill,id);
          replacement=[...firstMethod(skill,'getZhaos').entries.values()].find(move=>firstMethod(move,'getID')===id);
        }
        if(!replacement)throw new Error(`无法装配原始招式 ${id}。`);
        replacements.push(replacement);
      }
      const position=positions[0];
      rows=rows.filter(move=>!group.ids.includes(firstMethod(move,'getID')));
      rows.splice(position,0,...replacements);
    }
    vm.set(skill,'m_tZhaos',vm.table(rows));
  }
  if(selection.specialProp!==undefined&&(replaceZhaos||selection.specialPropExplicit))callMethod(skill,'setSpecialProp',selection.specialProp);
  if(selection.jingjins!==undefined){
    // Original SetWuGongJingjinLv does updateJingJin, then sets the three levels.
    // Zero omitted branches so an explicit input cannot inherit unrelated state.
    if(selection.jingjins.length){
      callMethod(skill,'updateJingJin');
      const requested=new Map(selection.jingjins.map(row=>[row.id,row]));
      for(const branch of firstMethod(skill,'getJingjins').entries.values()){
        const row=requested.get(firstMethod(branch,'getID'));
        if(row)callMethod(branch,'setMaxChong',row.maxChong);
        callMethod(branch,'setChong',row?.chong??0);
      }
    }else callMethod(skill,'clearJingjin');
  }
  return skill;
}
