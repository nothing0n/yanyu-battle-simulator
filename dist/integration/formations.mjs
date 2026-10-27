/** Public formation layout rules. Combat effects stay in original role getters. */
export const FORMATION_GRID=Object.freeze([
 {stand:1,lane:0,depth:0,label:'上排前位'},
 {stand:2,lane:0,depth:2,label:'上排后位'},
 {stand:3,lane:1,depth:0,label:'中排前位'},
 {stand:4,lane:1,depth:1,label:'中排中位'},
 {stand:5,lane:1,depth:2,label:'中排后位'},
 {stand:6,lane:2,depth:0,label:'下排前位'},
 {stand:7,lane:2,depth:2,label:'下排后位'},
].map(Object.freeze));

export async function loadFormationCatalog(reader){
 const readJSON=typeof reader==='function'?reader:reader?.readJSON;
 const url=new URL('../data/formations.json',import.meta.url);
 const data=readJSON?await readJSON(url):await (await fetch(url)).json();
 if(!Array.isArray(data?.formations)||!data.coveredLevels)throw Error('阵法目录格式无效');
 return data;
}
export function getFormation(catalog,id){return catalog?.formations?.find(f=>f.id===Number(id))||null;}
export function getRoleKey(row){
 if(row?.roleKey)return row.roleKey;
 const id=Number(row?.roleId??row?.savedState?.ID??row?.build?.roleId);
 return({1:'main',10010:'main',10060:'step',10059:'barbarian',10057:'snow',10031:'merchant',10041:'peach'})[id]||String(row?.uid||'').split('-').at(-1)||'other';
}
export function getRoleStand(row){
 if(row?.stand!=null)return Number(row.stand);
 if(row?.position!=null)return Number(row.position)+1;
 return row?.savedState?.Stand==null?NaN:Number(row.savedState.Stand);
}
function formationIssues(catalog,formation){
 const selected=getFormation(catalog,formation?.id),level=Number(formation?.level??3),issues=[];
 if(!selected)issues.push({code:'formation-id',message:'请选择已覆盖的阵法：四方508、云垂515、万化519或四时520。'});
 if(!Number.isInteger(level)||level<catalog.coveredLevels.min||level>catalog.coveredLevels.max)issues.push({code:'formation-level',message:`当前网页只覆盖阵法${catalog.coveredLevels.min}–${catalog.coveredLevels.max}级；3级为完整buff开启阈值，并非已证明的游戏上限。`});
 return{selected,level,issues};
}
export function validateFormationTeam(catalog,formation,roles,{requireFour=true}={}){
 const {selected,level,issues}=formationIssues(catalog,formation),warnings=[],occupied=new Map();
 if(!Array.isArray(roles))issues.push({code:'roles',message:'阵容必须是角色数组。'});
 else{
  if(requireFour&&roles.length!==4)issues.push({code:'team-size',message:'四人对照阵容需要正好4名角色。'});
  for(const [index,row]of roles.entries()){
   const stand=getRoleStand(row);
   if(!Number.isInteger(stand)||stand<1||stand>7)issues.push({code:'stand-range',roleIndex:index,stand:Number.isFinite(stand)?stand:null,message:`第${index+1}名角色需要1–7号站位。`});
   else if(selected&&!selected.allowedSlots.includes(stand))issues.push({code:'stand-unavailable',roleIndex:index,stand,message:selected.slots.find(s=>s.stand===stand)?.disabledReason||`${selected.name}未开放${stand}号位。`});
   if(occupied.has(stand))issues.push({code:'stand-duplicate',roleIndex:index,stand,message:`${stand}号位已有角色，不能重复占位。`});
   occupied.set(stand,index);
   if(row?.position!=null&&row?.stand!=null&&Number(row.position)+1!==Number(row.stand))issues.push({code:'stand-mismatch',roleIndex:index,message:`第${index+1}名角色的position与stand不一致。`});
  }
 }
 const eyeOccupied=selected?.eyeSlots.length?selected.eyeSlots.some(s=>occupied.has(s)):null;
 if(selected?.id===519&&!eyeOccupied)warnings.push('4号阵眼没有角色：原阵眼条件效果不会激活。');
 if(selected?.id===508&&!eyeOccupied)warnings.push('四方阵4号中心为空：外圈效果仍按原规则处理，中心八极效果不可得。');
 if(selected&&level<3)warnings.push('阵法低于3级：数值属性按等级/3结算，首次/每回合阵法buff尚未开启。');
 return{valid:issues.length===0,errors:issues.map(i=>i.message),issues,warnings,slots:selected?.slots||FORMATION_GRID.map(g=>({...g,allowed:false,disabledReason:'阵法尚未选择'})),formation:selected?{id:selected.id,level}:null,activation:{eyeOccupied,buffLevelReached:level>=3,conditionalEffectsRequireOriginalScheduler:true}};
}
function assertSingle(catalog,formation,stand){
 const {selected,level,issues}=formationIssues(catalog,formation);
 if(issues.length)throw Error(issues.map(i=>i.message).join(' '));
 if(!Number.isInteger(stand)||!selected.allowedSlots.includes(stand))throw Error(selected.slots.find(s=>s.stand===stand)?.disabledReason||'角色站位无效。');
 return{id:selected.id,level};
}
export function applyFormationToSavedRow(row,formation,stand,{catalog}={}){
 if(!catalog)throw Error('应用阵法前需要阵法目录。');
 const normalized=assertSingle(catalog,formation,Number(stand)),out=structuredClone(row);
 out.formation=normalized;out.position=Number(stand)-1;
 if(Object.hasOwn(out,'stand'))out.stand=Number(stand);
 if(out.savedState)Object.assign(out.savedState,{Zhen:normalized.id,ZhenLv:normalized.level,Stand:Number(stand)});
 return out;
}
export function applyFormationToActor(runtime,actor,formation,stand,{catalog}={}){
 if(!catalog)throw Error('应用阵法前需要阵法目录。');
 const normalized=assertSingle(catalog,formation,Number(stand));
 runtime.callMethod(actor,'setZhen',normalized.id,normalized.level);
 runtime.callMethod(actor,'setStand',Number(stand));
 if(runtime.vm.get(actor,'clearPropTemp'))runtime.callMethod(actor,'clearPropTemp');
 if(runtime.vm.get(actor,'m_nZhen')!==normalized.id||runtime.vm.get(actor,'m_nZhenLv')!==normalized.level||runtime.firstMethod(actor,'getStand')!==Number(stand))throw Error('原角色阵法字段未正确应用。');
 return{formation:normalized,stand:Number(stand),requiresBattleReset:true};
}
export function reflowFormationTeam(catalog,formation,roles,{preset='general',keepExisting=true}={}){
 const {selected,level,issues}=formationIssues(catalog,formation);if(issues.length)throw Error(issues.map(i=>i.message).join(' '));
 if(!Array.isArray(roles)||roles.length>selected.allowedSlots.length)throw Error('角色数量超过该阵法可用格位。');
 const layout=selected.presets?.[preset],warnings=[];
 if(!layout)warnings.push('该阵法没有当前队形预设：保留可用站位后，按剩余合法空位重排；请核对角色位置。');
 const assigned=new Map(),used=new Set();
 if(keepExisting)for(const[i,row]of roles.entries()){const stand=getRoleStand(row);if(selected.allowedSlots.includes(stand)&&!used.has(stand)){assigned.set(i,stand);used.add(stand);}}
 for(const[i,row]of roles.entries())if(!assigned.has(i)){
  const key=getRoleKey(row),wanted=layout?.[key]??(['snow','merchant','peach','other'].includes(key)?layout?.other:null);
  const stand=selected.allowedSlots.includes(wanted)&&!used.has(wanted)?wanted:selected.allowedSlots.find(s=>!used.has(s));
  assigned.set(i,stand);used.add(stand);
 }
 const moves=[],output=roles.map((row,i)=>{const stand=assigned.get(i),from=getRoleStand(row);if(from!==stand)moves.push({roleIndex:i,roleKey:getRoleKey(row),from:Number.isFinite(from)?from:null,to:stand});return applyFormationToSavedRow(row,{id:selected.id,level},stand,{catalog});});
 if(moves.length)warnings.push(`已重排${moves.length}名角色；请核对下方站位。`);
 const validation=validateFormationTeam(catalog,{id:selected.id,level},output);
 return{formation:{id:selected.id,level},roles:output,moves,warnings:[...warnings,...validation.warnings],validation};
}
