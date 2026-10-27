const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),copy=v=>JSON.parse(JSON.stringify(v)),fmt=v=>Number(v||0).toLocaleString('zh-CN',{maximumFractionDigits:1}),waitFrame=()=>new Promise(r=>setTimeout(r,0));
const keys={draft:'yanyu-battle-v1-draft',presets:'yanyu-battle-v1-presets',baseline:'yanyu-battle-v1-baseline'},grades={1:'基础',2:'一般',3:'进阶',4:'上乘',5:'镇派'},weapons={1:'拳掌',2:'刀法',3:'剑法',4:'枪棍'},categories={wai:'外功',nei:'内功',qing:'轻功'};
const statDefs=[['hp','气血',1,9999999,1],['atk','攻击',0,999999,1],['def','防御',0,999999,1],['speed','速度',0,999999,1],['hit','命中',0,999999,1],['dodge','闪避',0,999999,1],['parry','招架',0,999999,1],['mp','初始真气',0,1000,1],['mpBack','聚气',0,1000,.1],['str','臂力',0,99999,1],['dex','身法',0,99999,1],['con','根骨',0,99999,1],['int','内息',0,99999,1],['neijin','内劲',0,999999,1],['gangqi','罡气',0,999999,1],['weaponAtk','武器基础攻击',0,999999,1]];
const defaults={hp:16000,atk:3500,def:2800,speed:1200,hit:1400,dodge:800,parry:900,mp:40,mpBack:8,str:200,dex:200,con:200,int:200,neijin:0,gangqi:0,weaponAtk:0};
const manualPanelNotice='手工最终面板不会随内功、体态或招式路线自动重算，请按该搭配重新填写面板；统计仅针对所填面板。';
let weaponAppearance={byType:{},defaults:{}},weaponAppearanceError='',sceneCatalog={backgrounds:{}},sceneCatalogError='';
let catalog={meta:{},characters:[],taolu:[],nei:[],qing:[],talents:[]},charMap=new Map(),skillMaps={wai:new Map(),nei:new Map(),qing:new Map()},config={version:1,sceneId:10,name:'初始演武阵容',seed:20261024,maxRounds:50,teams:{ally:[],enemy:[]}},selected=null,engine=null,result=null,resultConfig=null,cursor=0,timer=null,busy=false,cancelled=false,baseline=null,picker=null,sourceError='',engineFailure='',toastTimer=null;
function toast(m){clearTimeout(toastTimer);$('toast').textContent=m;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,3600)}
function readStored(k,f){try{return JSON.parse(localStorage.getItem(k))??f}catch{return f}}
function storeValue(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true}catch{toast('浏览器暂时无法保存，请导出配置备份。');return false}}
function uid(){return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`}
function portrait(r,c='fighter-portrait'){const p=charMap.get(Number(r.roleId??r.id))?.portrait;return p&&/^assets\/[a-zA-Z0-9_./-]+$/.test(p)?`<img class="${c}" src="${esc(window.YanyuAssets?.[p]||'./'+p)}" alt="${esc(r.name)}" loading="lazy">`:`<span class="fighter-initial">${esc((r.name||'侠')[0])}</span>`}
function normalizeCatalog(d){const list=v=>Array.isArray(v)?v:Object.values(v||{});catalog={...d,characters:list(d.characters),taolu:list(d.taolu),nei:list(d.nei),qing:list(d.qing),talents:list(d.talents)};charMap=new Map(catalog.characters.map(x=>[Number(x.id),x]));skillMaps={wai:new Map(catalog.taolu.map(x=>[Number(x.id),x])),nei:new Map(catalog.nei.map(x=>[Number(x.id),x])),qing:new Map(catalog.qing.map(x=>[Number(x.id),x]))}}
function skillByName(k,n,f){return (k==='wai'?catalog.taolu:catalog[k]).find(x=>x.name===n)?.id??f??null}
function weaponOptions(role){const type=Number(skillMaps.wai.get(Number(role.skills?.wai))?.type)||1;return weaponAppearance.byType?.[type]||[];}
function weaponSkinFor(role,requested,strict=false){
  const options=weaponOptions(role),value=requested==null?null:Number(requested);
  if(!options.length)return Number.isFinite(value)&&value>0?value:null;
  if(options.some(option=>Number(option.id)===value))return value;
  if(strict&&requested!=null)throw Error(`${role.name}的武器外观 ${requested} 不属于当前外功类型。`);
  const type=Number(skillMaps.wai.get(Number(role.skills?.wai))?.type)||1,preferred=Number(weaponAppearance.defaults?.[type]);
  return options.some(option=>Number(option.id)===preferred)?preferred:Number(options[0].id);
}
function normalizeWeaponSkins(value){for(const side of ['ally','enemy'])for(const role of value.teams[side])role.weaponSkin=weaponSkinFor(role,role.weaponSkin);}
const yuhuaChoiceGroups={
  second:{label:'羽化第二式',choices:[['yangyu','固神扬宇'],['yingxue','梵气盈血'],['suoqi','固乾锁气']]},
  third:{label:'羽化第三式',choices:[['zhenyuan','万化镇元'],['zhenshan','万化镇山'],['zhenliu','万化镇流']]},
  fourth:{label:'羽化摘星招式',choices:[['benshou','本手摘星'],['bishou','彼手摘星'],['wending','摘星问鼎']]},
  fifth:{label:'天地真我效果',choices:[['diyu','真吾天地·抵御'],['jinghua','天地真我·净化']]},
};
// UI validation covers the portable option schema. The original-runtime adapter
// additionally checks every refinement and selected move against its source table.
function normalizeUISkillOptions(role,raw={}){
  if(raw==null)raw={};
  if(typeof raw!=='object'||Array.isArray(raw))throw Error('武学选项须为对象。');
  for(const key of Object.keys(raw))if(!Object.hasOwn(categories,key))throw Error(`未识别的武学选项类别 ${key}。`);
  const out={};
  for(const key of Object.keys(categories)){
    const input=raw[key]??{};
    if(typeof input!=='object'||Array.isArray(input))throw Error(`${categories[key]}选项须为对象。`);
    const allowed=new Set(['jingjins']);
    const id=Number(role.skills?.[key]),skill=skillMaps[key].get(id);
    if(key==='nei'&&Number(skill?.prop)===4)allowed.add('specialProp');
    if(key==='nei'&&id===53060)allowed.add('form');
    if(key==='nei'&&id===23620)allowed.add('stage');
    if(key==='nei'&&id===23720)allowed.add('yuhuaChoices');
    for(const field of Object.keys(input))if(!allowed.has(field))throw Error(`${skill?.name||categories[key]}不适用武学选项 ${field}。`);
    const option={};
    if(input.jingjins!=null){
      if(!Array.isArray(input.jingjins))throw Error('精进记录须为数组。');
      const seen=new Set();
      option.jingjins=input.jingjins.map(row=>{
        if(!row||typeof row!=='object'||Array.isArray(row))throw Error('精进记录格式无效。');
        for(const field of Object.keys(row))if(!['id','chong','maxChong','ID','Chong','MaxChong'].includes(field))throw Error(`未识别的精进字段 ${field}。`);
        for(const [lower,upper]of [['id','ID'],['chong','Chong'],['maxChong','MaxChong']])if(Object.hasOwn(row,lower)&&Object.hasOwn(row,upper)&&Number(row[lower])!==Number(row[upper]))throw Error(`精进 ${lower}/${upper} 不一致。`);
        const jid=Number(row.id??row.ID),chong=Number(row.chong??row.Chong),maxChong=Number(row.maxChong??row.MaxChong??10);
        if(!Number.isInteger(jid)||jid<1||seen.has(jid))throw Error('精进编号须为不重复的正整数。');
        if(!Number.isInteger(maxChong)||maxChong<0||maxChong>10||!Number.isInteger(chong)||chong<0||chong>maxChong)throw Error('精进重数须为0至当前上限，上限不得超过10。');
        seen.add(jid);return{id:jid,chong,maxChong};
      });
    }
    if(key==='nei'&&id===53060){
      const props={yin:1,yang:2,mixed:3},forms={1:'yin',2:'yang',3:'mixed'};
      const form=input.form??forms[input.specialProp]??'mixed';
      if(!Object.hasOwn(props,form))throw Error('归云体态须为寒阴、赤阳或混元。');
      if(input.specialProp!=null&&Number(input.specialProp)!==props[form])throw Error('归云体态与内功属性不一致。');
      if(form!=='mixed'&&Number(role.skillLevels?.nei??10)<10)throw Error('归云寒阴态、赤阳态须十重大圆满。');
      option.form=form;option.specialProp=props[form];
    }else if(key==='nei'&&Number(skill?.prop)===4){
      const prop=Number(input.specialProp??3);
      if(![1,2,3].includes(prop))throw Error('内功属性须为阴、阳或混元。');
      option.specialProp=prop;
    }
    if(key==='nei'&&id===23620){
      const stage=input.stage??'four-sha';
      if(!['four-sha','five-sha','six-sha'].includes(stage))throw Error('道心招式须选择第四斩、第五斩或第六斩阶段。');
      if(stage!=='four-sha'&&Number(role.skillLevels?.nei??10)<10)throw Error('道心第五斩及以后招式须内功十重。');
      option.stage=stage;
    }
    if(key==='nei'&&id===23720){
      const choices=input.yuhuaChoices??{};
      if(typeof choices!=='object'||Array.isArray(choices))throw Error('羽化招式路线须为对象。');
      for(const field of Object.keys(choices))if(!Object.hasOwn(yuhuaChoiceGroups,field))throw Error(`未识别的羽化招式路线 ${field}。`);
      option.yuhuaChoices={};
      for(const [field,group]of Object.entries(yuhuaChoiceGroups)){
        const value=choices[field]??group.choices[0][0];
        if(!group.choices.some(([id])=>id===value))throw Error(`${group.label}选择无效。`);
        option.yuhuaChoices[field]=value;
      }
    }
    if(Object.keys(option).length)out[key]=option;
  }
  return out;
}
function changeRoleSkill(role,key,id){
  if(!Object.hasOwn(categories,key)||!skillMaps[key].has(Number(id)))throw Error('未找到所选武学。');
  role.skills[key]=Number(id);
  const retained=copy(role.skillOptions||{});delete retained[key];
  role.skillOptions=normalizeUISkillOptions(role,retained);
  if(key==='wai')role.weaponSkin=weaponSkinFor(role,role.weaponSkin);
}
function changeRoleSkillLevel(role,key,value){
  role.skillLevels[key]=Math.min(10,Math.max(1,Math.trunc(Number(value)||1)));
  let resetChoice='';
  if(key==='nei'&&Number(role.skills.nei)===53060&&role.skillLevels.nei<10){
    const prior=role.skillOptions?.nei;
    if(prior&&(prior.form!=='mixed'||prior.specialProp!==3))resetChoice='归云不足十重，已恢复混元态。';
    role.skillOptions={...(role.skillOptions||{}),nei:{...(prior||{}),form:'mixed',specialProp:3}};
  }
  if(key==='nei'&&Number(role.skills.nei)===23620&&role.skillLevels.nei<10){
    const prior=role.skillOptions?.nei;
    if(prior?.stage&&prior.stage!=='four-sha')resetChoice='道心不足十重，已恢复第四斩招式。';
    role.skillOptions={...(role.skillOptions||{}),nei:{...(prior||{}),stage:'four-sha'}};
  }
  role.skillOptions=normalizeUISkillOptions(role,role.skillOptions);
  return resetChoice;
}
function innerSkillOptionsControl(role){
  const id=Number(role.skills?.nei),skill=skillMaps.nei.get(id),options=normalizeUISkillOptions(role,role.skillOptions).nei||{},disabled=busy?'disabled':'';
  let control='';
  if(id===53060)control=`<label for="innerForm">归云体态</label><select id="innerForm" ${disabled}>${[['mixed','混元态'],['yin','寒阴态'],['yang','赤阳态']].map(([value,label])=>`<option value="${value}" ${options.form===value?'selected':''} ${value!=='mixed'&&role.skillLevels.nei<10?'disabled':''}>${label}</option>`).join('')}</select><p>仅启用所选开场体态，并使用对应的内功属性。寒阴、赤阳须十重大圆满；降低重数时恢复混元态。</p>`;
  else if(Number(skill?.prop)===4)control=`<label for="innerProp">内功属性</label><select id="innerProp" ${disabled}>${[[3,'混元'],[1,'阴'],[2,'阳']].map(([value,label])=>`<option value="${value}" ${options.specialProp===value?'selected':''}>${label}</option>`).join('')}</select><p>此内功可使用不同属性；请按要比较的搭配选择。</p>`;
  else if(id===23620)control=`<label for="innerStage">道心斩煞阶段</label><select id="innerStage" ${disabled}>${[['four-sha','第四斩 · 镇派初期'],['five-sha','第五斩 · 饮血祭凶升阶'],['six-sha','第六斩及以后 · 噬血擒心升阶']].map(([value,label])=>`<option value="${value}" ${options.stage===value?'selected':''} ${value!=='four-sha'&&role.skillLevels.nei<10?'disabled':''}>${label}</option>`).join('')}</select><p>升阶会替换对应的基础招式，各阶段效果不会叠加。第五斩及以后招式须十重；请按实际斩煞进度选择。</p>`;
  if(id===23720)control+=Object.entries(yuhuaChoiceGroups).map(([field,group])=>`<label for="yuhua-${field}">${group.label}</label><select id="yuhua-${field}" ${disabled}>${group.choices.map(([value,label])=>`<option value="${value}" ${options.yuhuaChoices[field]===value?'selected':''}>${label}</option>`).join('')}</select>`).join('')+'<p>每组只启用所选招式。更换路线代表已完成相应解锁前提，请按实际搭配选择。</p>';
  const refined=Object.values(role.skillOptions||{}).some(option=>option.jingjins?.length);
  return(control?`<div class="skill-options">${control}</div>`:'')+(refined?'<p class="input-note refinement-note">已保留导入的精进记录；更换对应武学时会清除该门精进。</p>':'');
}
function bindInnerSkillOptions(role){
  for(const [id,field]of [['innerForm','form'],['innerProp','specialProp'],['innerStage','stage']]){
    const control=$(id);if(!control)continue;
    control.onchange=event=>{
      const options=copy(role.skillOptions||{});options.nei={...(options.nei||{}),[field]:field==='specialProp'?Number(event.target.value):event.target.value};
      if(field==='form')delete options.nei.specialProp;
      try{role.skillOptions=normalizeUISkillOptions(role,options);afterChange();renderEditor();}catch(error){toast(error.message);renderEditor();}
    };
  }
  for(const field of Object.keys(yuhuaChoiceGroups)){
    const control=$(`yuhua-${field}`);if(!control)continue;
    control.onchange=event=>{
      const options=copy(role.skillOptions||{});options.nei={...(options.nei||{}),yuhuaChoices:{...(options.nei?.yuhuaChoices||{}),[field]:event.target.value}};
      try{role.skillOptions=normalizeUISkillOptions(role,options);afterChange();renderEditor();}catch(error){toast(error.message);renderEditor();}
    };
  }
}
function assertManualRoleInput(row){
  if(!row||typeof row!=='object'||Array.isArray(row))throw Error('网页角色配置须为手工面板对象；原生存档请使用本地CLI。');
  const allowed=new Set(['uid','roleId','name','position','level','skills','skillLevels','skillOptions','stats','team','weaponSkin']);
  for(const field of Object.keys(row))if(!allowed.has(field))throw Error(`网页手工配置不支持角色字段 ${field}；原生存档、学习假设及完整角色状态请使用本地CLI，不能作为手工面板导入。`);
}
function weaponAppearanceControl(role){
  const options=weaponOptions(role),selected=weaponSkinFor(role,role.weaponSkin);
  return `<div class="weapon-appearance"><label for="weaponSkin">武器外观 <small>仅改变画面</small></label><select id="weaponSkin" ${busy||!options.length?'disabled':''}>${options.length?options.map(option=>`<option value="${Number(option.id)}" ${Number(option.id)===selected?'selected':''}>${esc(option.name||'原始外观 #'+option.id)}</option>`).join(''):'<option>原始武器外观尚未加载</option>'}</select><p>按当前外功类型选择原始样式，不改攻击与其他战斗数值。</p></div>`;
}
async function loadWeaponAppearance(){
  try{const response=await fetch('./data/weapon-appearance.json');if(!response.ok)throw Error(`原始武器外观表读取失败（${response.status}）`);const data=await response.json();if(!data.byType||typeof data.byType!=='object')throw Error('武器外观表格式不完整');weaponAppearance=data;weaponAppearanceError='';}
  catch(error){weaponAppearanceError=error.message;}
}
function validateSceneId(value){const id=Number(value??10);if(!Number.isInteger(id)||(!sceneCatalog.backgrounds[id]&&!(id===10&&!Object.keys(sceneCatalog.backgrounds).length)))throw Error('未找到原始场景配置 '+value+'。');return id;}
function renderSceneSelect(){const select=$('sceneSelect');if(!select)return;const scenes=Object.values(sceneCatalog.backgrounds).sort((a,b)=>Number(a.id)-Number(b.id));select.innerHTML=scenes.length?scenes.map(scene=>'<option value="'+Number(scene.id)+'">原场景 #'+Number(scene.id)+(Number(scene.id)===10?' · 默认':Number(scene.id)===500?' · 纯绿色':'')+'</option>').join(''):'<option value="10">原场景 #10</option>';select.value=String(config.sceneId??10);select.disabled=busy||!scenes.length;select.title=sceneCatalogError||'原游戏场景资源编号，仅改变战斗画面';}
async function loadSceneCatalog(){try{const response=await fetch('./data/presentation-backgrounds.json');if(!response.ok)throw Error('原场景配置读取失败 ('+response.status+')');const data=await response.json();if(!data.backgrounds||!data.backgrounds[10])throw Error('原场景配置不完整');sceneCatalog=data;sceneCatalogError='';}catch(error){sceneCatalogError=error.message;}}
async function afterAppearanceChange(){
  const time=replayClock?.timeMs||0,wasPlaying=Boolean(replayClock?.playing);stopPlayback();storeValue(keys.draft,config);
  if(!result||!resultConfig){renderEditor();refreshStageConfig();return;}
  resultConfig.sceneId=config.sceneId;
  for(const side of ['ally','enemy'])for(const prior of resultConfig.teams[side]){const current=config.teams[side].find(role=>role.uid===prior.uid);if(current)prior.weaponSkin=current.weaponSkin;}
  busy=true;updateButtons();renderEditor();let ready=false;
  try{ready=await prepareBattlePresentation(result,resultConfig);if(ready)replayClock.seek(time);}catch(error){stageNotice('error',error.message);}
  finally{busy=false;updateButtons();renderEditor();}
  if(ready&&wasPlaying)play();
}

function makeRole(c,p,s){const r=c||catalog.characters[0];const role={uid:uid(),roleId:Number(r?.id),name:r?.name||'未选择角色',position:p,level:90,skills:{wai:Number(r?.tl?.['1']??catalog.taolu[0]?.id)||null,nei:Number(r?.ng?.['1']??catalog.nei[0]?.id)||null,qing:Number(r?.qg?.['1']??catalog.qing[0]?.id)||null},skillLevels:{wai:10,nei:10,qing:10},stats:{...defaults},team:s};role.skillOptions=normalizeUISkillOptions(role);role.weaponSkin=weaponSkinFor(role,null);return role;}
function createDefault(){const byName=n=>catalog.characters.find(x=>x.name===n),allies=['主角','苏念雪','陈元封','柳如意'].map((n,i)=>byName(n)||catalog.characters[i]).filter(Boolean),enemies=['商昊乾','李一尘','姜逸尘','月蓉'].map((n,i)=>byName(n)||catalog.characters[i+1]).filter(Boolean);config.teams.ally=allies.map((c,i)=>makeRole(c,[1,2,3,4][i],'ally'));config.teams.enemy=enemies.map((c,i)=>makeRole(c,[1,2,3,4][i],'enemy'));const combos=[['太虚神悟刀','龙象般若功','凌波微步'],['狂风剑法','寒冰诀','梅花步'],['碎岳枪法','浑天气功','健行步'],['烈阳神掌','碧波神功','踏浪行']];for(const s of ['ally','enemy'])config.teams[s].forEach((r,i)=>Object.keys(categories).forEach((k,j)=>r.skills[k]=skillByName(k,combos[(i+(s==='enemy'?1:0))%4][j],r.skills[k])));normalizeWeaponSkins(config);for(const side of ['ally','enemy'])for(const role of config.teams[side])role.skillOptions=normalizeUISkillOptions(role);}
function validateConfig(v){if(!v||typeof v!=='object'||!v.teams||!Array.isArray(v.teams.ally)||!Array.isArray(v.teams.enemy))throw Error('配置须包含 teams.ally 与 teams.enemy 阵容。');const n={version:1,sceneId:validateSceneId(v.sceneId),name:String(v.name||'导入阵容').slice(0,40),seed:Math.trunc(Number(v.seed)),maxRounds:Number(v.maxRounds),teams:{ally:[],enemy:[]}};if(!Number.isFinite(n.seed)||n.seed<1||n.seed>4294967295)throw Error('随机种子须为 1～4294967295 的整数。');if(![20,50,100].includes(n.maxRounds))n.maxRounds=50;const ids=new Set();for(const s of ['ally','enemy']){if(v.teams[s].length>4)throw Error('每方最多为 4 人。');const pos=new Set();for(const raw of v.teams[s]){assertManualRoleInput(raw);const id=Number(raw.roleId),p=Number(raw.position);if(!charMap.has(id))throw Error(`未找到角色配置 ${raw.roleId}。`);if(!Number.isInteger(p)||p<0||p>6||pos.has(p))throw Error('原战场只有 7 个阵位，position 须为 0～6，同一方不能重叠。');pos.add(p);const r=makeRole(charMap.get(id),p,s);r.uid=typeof raw.uid==='string'&&/^[\w-]{1,80}$/.test(raw.uid)&&!ids.has(raw.uid)?raw.uid:uid();ids.add(r.uid);r.level=Math.min(100,Math.max(1,Math.trunc(Number(raw.level)||90)));for(const[k,label,min,max]of statDefs){const z=Number(raw.stats?.[k]??defaults[k]);if(!Number.isFinite(z)||z<min||z>max)throw Error(`${r.name}的${label}超出允许范围。`);r.stats[k]=z}for(const k of Object.keys(categories)){const sid=Number(raw.skills?.[k]);if(sid&&!skillMaps[k].has(sid))throw Error(`未找到${categories[k]} ${sid}。`);r.skills[k]=sid||null;r.skillLevels[k]=Math.min(10,Math.max(1,Math.trunc(Number(raw.skillLevels?.[k])||10)))}r.skillOptions=normalizeUISkillOptions(r,raw.skillOptions);r.weaponSkin=weaponSkinFor(r,raw.weaponSkin,true);n.teams[s].push(r)}}return n}
function currentRole(){return selected?config.teams[selected.side].find(r=>r.uid===selected.uid):null}
function setSelection(s,id){selected={side:s,uid:id};renderBoard();renderEditor()}
function getConfig(){return copy(config)}
function afterChange(){engineFailure='';stopPlayback();result=null;resultConfig=null;cursor=0;resetPresentation();storeValue(keys.draft,config);renderBoard();renderResult();updateButtons()}
function renderBoard(){const hp=new Map();for(const s of ['ally','enemy'])for(const r of config.teams[s])hp.set(r.uid,r.stats.hp);if(result&&resultConfig)for(const e of shownEvents()){const id=e.targetId??e.targetUid;if(hp.has(id)){if(e.hpAfter!=null&&Number.isFinite(Number(e.hpAfter)))hp.set(id,Number(e.hpAfter));else if(Number.isFinite(Number(e.damage)))hp.set(id,Math.max(0,hp.get(id)-Number(e.damage)));if(Number(e.healing)>0){const r=[...config.teams.ally,...config.teams.enemy].find(x=>x.uid===id);hp.set(id,Math.min(r.stats.hp,hp.get(id)+Number(e.healing)))}}if(e.snapshot)for(const[id,v]of Object.entries(e.snapshot))if(hp.has(id)&&Number.isFinite(Number(v?.hp??v)))hp.set(id,Number(v?.hp??v))}const last=shownEvents().at(-1);for(const s of ['ally','enemy']){$(s+'Count').textContent=`${config.teams[s].length} / 4`;$(s+'Grid').innerHTML=Array.from({length:7},(_,p)=>{const layout=s==='ally'?[[4,1],[2,1],[5,2],[3,2],[1,2],[4,3],[2,3]]:[[2,1],[4,1],[1,2],[3,2],[5,2],[2,3],[4,3]],[column,row]=layout[p],placement=`grid-column:${column} / span 2;grid-row:${row}`;const r=config.teams[s].find(x=>x.position===p);if(!r)return`<button class="formation-cell empty" style="${placement}" data-cell="${p}" data-side="${s}" aria-label="${s==='ally'?'我方':'对手'}空位 ${p+1}，点击移动或添加"><small class="position-index">${p+1}</small><span>＋</span></button>`;const val=hp.get(r.uid),pct=Math.max(0,Math.min(100,val/r.stats.hp*100)),active=selected?.uid===r.uid,acting=(last?.actorId??last?.actorUid)===r.uid;return`<button class="fighter ${s} ${active?'selected':''} ${val<=0?'dead':''} ${acting?'acting':''}" style="${placement}" data-role="${r.uid}" data-side="${s}" aria-label="${s==='ally'?'我方':'对手'}${esc(r.name)}，位置${p+1}，气血${fmt(val)}" aria-pressed="${active}" title="${esc(r.name)} · ${fmt(val)} / ${fmt(r.stats.hp)}"><span class="fighter-level">LV.${r.level}</span>${portrait(r)}<span class="fighter-name">${esc(r.name)}</span><span class="hp-track"><span style="width:${pct}%"></span></span></button>`}).join('')}$('selectedHint').textContent=currentRole()?`正在配置：${currentRole().name}`:'选择角色，开始配置';$('roundIndicator').textContent=last?.round?`第 ${last.round} 回合`:result?'演武已结算':'静候出招';document.querySelectorAll('[data-add]').forEach(b=>b.disabled=busy||config.teams[b.dataset.add].length>=4||!catalog.characters.length)}
function statField(d,r){const[k,n,min,max,step]=d;return`<div class="stat-field"><label for="stat-${k}">${n}</label><input id="stat-${k}" data-stat="${k}" type="number" min="${min}" max="${max}" step="${step}" value="${r.stats[k]}" ${busy?'disabled':''}></div>`}
function renderEditor(){const r=currentRole();$('editorSide').textContent=selected?.side==='enemy'?'对手':'我方';$('editorSide').className=`editor-side ${selected?.side==='enemy'?'enemy':''}`;if(!r){$('editorContent').innerHTML='<div class="empty-state"><span class="empty-mark">侠</span><h3>待君入阵</h3><p>点击空位或添加角色，<br>组建你的演武阵容。</p></div>';return}const raw=charMap.get(r.roleId),skills=Object.entries(categories).map(([k,t])=>{const x=skillMaps[k].get(r.skills[k]);return`<button class="skill-card" data-pick="${k}" ${busy?'disabled':''}><span class="skill-icon ${k}">${{wai:'招',nei:'气',qing:'步'}[k]}</span><div class="skill-card-info"><div class="skill-name">${esc(x?.name||'未装备'+t)}</div><div class="skill-meta"><span>${t}</span><span class="skill-grade">${esc(grades[x?.grade]||'原始配置')}</span><span>第 ${r.skillLevels[k]} 重</span></div></div><span class="chevron">›</span></button>`}).join('');$('editorContent').innerHTML=`<div class="editor-inner"><div class="character-profile"><div class="profile-avatar">${portrait(r,'profile-image')}</div><div class="profile-details"><h3>${esc(r.name)}</h3><p>${esc(raw?.sl||'江湖中人')} · 配置 ${r.roleId}</p><button class="text-button change-role" data-pick="role" ${busy?'disabled':''}>更换角色 ↗</button></div><button class="icon-button" id="roleInfo" aria-label="查看原始角色资料" title="原始角色资料">ⓘ</button></div><div class="editor-skill-section"><div class="editor-subheading">武学搭配 <small>点击更换</small></div>${skills}<div class="skill-levels">${Object.entries(categories).map(([k,v])=>`<label>${v}<input data-skill-level="${k}" aria-label="${v}重数" type="number" min="1" max="10" value="${r.skillLevels[k]}" ${busy?'disabled':''}>重</label>`).join('')}</div>${innerSkillOptionsControl(r)}<p class="input-note manual-panel-notice">${manualPanelNotice}</p>${weaponAppearanceControl(r)}<p class="input-note">武学名称与配置来自游戏包。效果是否生效，以引擎还原范围为准。</p></div><div class="editor-divider"></div><div class="editor-stat-section"><div class="editor-subheading">战斗面板 <small>输入值 · 不自动推算成长</small></div><div class="stats-inputs"><div class="stat-field"><label for="roleLevel">人物等级</label><input id="roleLevel" type="number" min="1" max="100" value="${r.level}" ${busy?'disabled':''}></div>${statDefs.slice(0,5).map(d=>statField(d,r)).join('')}</div><details class="more-stats"><summary>四维与高级属性 ↓</summary><div class="stats-inputs">${statDefs.slice(5).map(d=>statField(d,r)).join('')}</div></details><p class="input-note">初始数值为统一示例面板，非角色真实满级属性。总攻击填「攻击」；「武器基础攻击」仅供原招式的武器比例效果读取，不再加到总攻击。更换角色保留输入值。</p></div><button class="remove-role" id="removeRole" ${busy?'disabled':''}>移出阵容</button></div>`;$('editorContent').querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>openPicker(b.dataset.pick));$('editorContent').querySelectorAll('[data-stat]').forEach(input=>input.onchange=()=>{const d=statDefs.find(x=>x[0]===input.dataset.stat),n=Number(input.value);if(!Number.isFinite(n)||n<d[2]||n>d[3]){input.classList.add('input-error');toast(`${d[1]}需在 ${d[2]}～${d[3]} 之间`);input.value=r.stats[d[0]];return}input.classList.remove('input-error');r.stats[d[0]]=n;afterChange()});$('roleLevel').onchange=e=>{r.level=Math.min(100,Math.max(1,Math.trunc(Number(e.target.value)||90)));e.target.value=r.level;afterChange()};$('editorContent').querySelectorAll('[data-skill-level]').forEach(input=>input.onchange=()=>{const resetChoice=changeRoleSkillLevel(r,input.dataset.skillLevel,input.value);if(resetChoice)toast(resetChoice);afterChange();renderEditor()});$('removeRole').onclick=()=>{config.teams[selected.side]=config.teams[selected.side].filter(x=>x.uid!==r.uid);selected=config.teams[selected.side][0]?{side:selected.side,uid:config.teams[selected.side][0].uid}:null;afterChange();renderEditor()};$('roleInfo').onclick=()=>showRawDetail(raw,'角色原始配置');$('weaponSkin').onchange=e=>{r.weaponSkin=weaponSkinFor(r,Number(e.target.value),true);void afterAppearanceChange()};bindInnerSkillOptions(r)}
function listFor(k){return k==='role'?catalog.characters:k==='wai'?catalog.taolu:k==='library'?[...catalog.taolu.map(x=>({...x,category:'wai'})),...catalog.nei.map(x=>({...x,category:'nei'})),...catalog.qing.map(x=>({...x,category:'qing'}))]:catalog[k]||[]}
function openPicker(k,extra={}){picker={kind:k,...extra};$('pickerTitle').textContent=k==='role'?'选择入阵侠士':k==='library'?'武学录':`选择${categories[k]}`;$('pickerSearch').value='';$('pickerFilter').innerHTML=k==='role'?'<option value="">全部角色配置</option><option value="portrait">有原始肖像</option>':k==='library'?'<option value="">全部武学</option><option value="wai">外功</option><option value="nei">内功</option><option value="qing">轻功</option>':'<option value="">全部品阶</option>'+Object.entries(grades).map(([id,n])=>`<option value="${id}">${n}</option>`).join('');renderPicker();$('pickerDialog').showModal();$('pickerSearch').focus()}
function cleanDesc(s){return String(s||'').replace(/\[[^\]]*\]/g,'').replace(/<[^>]*>/g,'').replace(/\$|\\n/g,' ')}
function renderPicker(){if(!picker)return;const q=$('pickerSearch').value.trim().toLowerCase(),f=$('pickerFilter').value,list=listFor(picker.kind).filter(x=>(!q||String(x.name).toLowerCase().includes(q)||String(x.id).includes(q))&&(!f||(picker.kind==='role'?Boolean(x.portrait):picker.kind==='library'?x.category===f:Number(x.grade)===Number(f))));$('pickerCount').textContent=`${list.length} 项${picker.kind==='role'?'角色配置（包含变身、特殊定义）':'游戏原始武学配置'}${list.length>120?' · 显示前 120 项，请搜索缩小范围':''}`;$('pickerItems').innerHTML=list.slice(0,120).map(x=>`<button class="picker-item" data-pick-id="${x.id}" data-category="${x.category||picker.kind}">${picker.kind==='role'?portrait(x,'pick-portrait'):`<span class="pick-initial">${esc(categories[x.category||picker.kind]?.[0]||'武')}</span>`}<span class="pick-info"><h3>${esc(x.name)}</h3><p>${esc(picker.kind==='role'?(x.sl||'江湖中人'):(weapons[x.type]||categories[x.category||picker.kind]||'武学'))} · #${x.id} ${picker.kind!=='role'?`<small>${esc(grades[x.grade]||'特殊')}</small>`:''}</p><div class="picker-detail">${esc(cleanDesc(x.desc||x.story).slice(0,45))}${cleanDesc(x.desc||x.story).length>45?'…':''}</div></span></button>`).join('')||'<div class="no-matches">没有找到匹配项，试试其他名称或编号。</div>';$('pickerItems').querySelectorAll('[data-pick-id]').forEach(b=>b.onclick=()=>chooseItem(Number(b.dataset.pickId),b.dataset.category))}
function chooseItem(id,category){if(!picker)return;if(picker.kind==='library'){const raw=skillMaps[category]?.get(id);$('pickerDialog').close();showRawDetail(raw,`${categories[category]}原始配置`);return}if(picker.kind==='role'&&picker.addSide){if(config.teams[picker.addSide].length>=4)return;const s=picker.addSide,used=new Set(config.teams[s].map(r=>r.position)),p=picker.position??[1,3,5,2,4,0,6].find(p=>!used.has(p)),r=makeRole(charMap.get(id),p,s);config.teams[s].push(r);selected={side:s,uid:r.uid}}else{const r=currentRole();if(!r)return;if(picker.kind==='role'){r.roleId=id;r.name=charMap.get(id).name}else{changeRoleSkill(r,picker.kind,id)}}$('pickerDialog').close();afterChange();renderEditor()}
function rawFields(r,exclude=[]){return Object.entries(r||{}).filter(([k,v])=>!exclude.includes(k)&&v!==null&&typeof v!=='object').map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}
function showRawDetail(r,t){$('sourceContent').innerHTML=`<h3>${esc(r?.name||t)}</h3><p>${esc(cleanDesc(r?.desc||r?.story))}</p><div class="source-callout">以下是游戏配置表中的原始字段。配置存在不代表对应全部效果已在战斗引擎中执行。</div><h3>${esc(t)}</h3><dl>${rawFields(r,['desc','story','xx','say','portrait','name'])}</dl>`;$('sourceDialog').showModal()}
function presentationDisclosure(){const state=battleStage?.getState?.(),warnings=state?.warnings||[],diagnostics=state?.timeline?.diagnostics||[];return '<h3>战斗画面还原范围</h3><p>采用游戏原始骨骼、贴图、动作与原 Lua 时间轴；浏览器端使用骨骼兼容实现。尚未与原生游戏逐帧对照，不能视为全部原生表现已验证一致。</p>'+((warnings.length||diagnostics.length)?'<div class="source-callout">当前画面有 '+warnings.length+' 项资源/动作提示，'+diagnostics.length+' 项原消息表现诊断。</div><ul>'+[...warnings,...diagnostics.map(d=>d.reason||JSON.stringify(d))].slice(0,30).map(v=>'<li>'+esc(typeof v==='string'?v:JSON.stringify(v))+'</li>').join('')+'</ul>':'');}
function showSources(){const m=catalog.meta||{},sources=m.sources||{},limitations=engine?.limitations||engine?.metadata?.limitations||[];$('sourceContent').innerHTML=`<h3>当前还原状态</h3><div class="source-callout">${esc(engine?.description||'已读取游戏角色、武学与资源；战斗调度仍在接入。当前页面不把配置提取称为完整战斗复刻。')}</div>${limitations.length?`<ul>${limitations.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}${presentationDisclosure()}<h3>原始数据</h3><p>读取本地游戏包中的角色、武学配置与美术资源。当前收录 ${catalog.characters.length} 项角色定义、${catalog.taolu.length+catalog.nei.length+catalog.qing.length} 项武学配置；包含特殊、变身及占位定义，不能等同于可招募角色数量。</p><dl><dt>数据快照</dt><dd>${esc(m.sourceSnapshot||'2026-10-07 本地快照')}</dd><dt>外功 / 内功 / 轻功</dt><dd>${catalog.taolu.length} / ${catalog.nei.length} / ${catalog.qing.length}</dd><dt>输入面板</dt><dd>初始值为统一示例；不会自动套用装备、经脉或角色成长。</dd><dt>随机种子</dt><dd>仅在相同引擎、相同配置下复验。模拟种子不等同于游戏存档序列。</dd></dl><h3>可追溯来源</h3>${Object.entries(sources).slice(0,12).map(([k,v])=>`<p><strong>${esc(k)}</strong> · ${v.records??''} 条<br><code>${esc(v.file)}</code><br><code>SHA-256 ${esc(v.sha256)}</code></p>`).join('')}<h3>原始阵位</h3><p>原战场仅有 7 个有效阵位，配置 position 0～6 对应原 stand 1～7。双方依原战场坐标镜像显示：上下路前后两位，中路前中后三位；上下路相对中路错开半格。</p><h3>方案保存</h3><p>你的阵容方案保存在当前浏览器。可导出 JSON 备份或在另一设备导入。本工具不读取账号、登录信息或游戏存档。</p>${sourceError?`<p>模块状态：${esc(sourceError)}</p>`:''}`;$('sourceDialog').showModal()}
function updateButtons(){const teams=config.teams.ally.length>0&&config.teams.enemy.length>0,ready=Boolean(engine&&engine.ready!==false&&typeof engine.run==='function'&&engine.capabilities?.battle!==false);$('runBtn').disabled=busy||!teams||!ready;$('batchBtn').disabled=busy||!teams||!ready||engine?.capabilities?.batch===false;$('compareBtn').disabled=busy||!teams||!ready||!baseline||engine?.capabilities?.batch===false;$('baselineBtn').disabled=busy||!teams;$('swapBtn').disabled=busy;if($('sceneSelect'))$('sceneSelect').disabled=busy||!Object.keys(sceneCatalog.backgrounds).length;$('seed').disabled=busy;$('maxRounds').disabled=busy;$('randomSeed').disabled=busy;if($('trialBtn'))$('trialBtn').disabled=busy||!teams||typeof engine?.evaluateAttack!=='function';$('engineBadge').classList.toggle('partial',!ready||Boolean(engine?.partial));$('engineBadge').innerHTML=`<i></i>${esc(({partial:'原公式可用 · 部分还原',ready:'原逻辑内核已接入',experimental:'原逻辑实验版'})[engine?.status]||engine?.status||(ready?'原逻辑内核已接入':'配置已就绪 · 内核待接入'))}`;$('engineNote').classList.toggle('warning',!ready||Boolean(engine?.partial));$('engineNote').textContent=engineFailure?('上次计算未完成：'+engineFailure):(engine?.description||(catalog.characters.length?'角色与武学配置可编辑。完整战斗内核尚未就绪，开始演武暂不可用。':'角色数据尚未加载完成。'));$('runBtn').innerHTML=busy?'<span>◌</span> 计算中…':'<span>▶</span> 开始演武';renderBoard()}
async function setEngine(v){engine=v;if(engine?.init)await engine.init(catalog);if(typeof engine?.evaluateAttack==='function'&&!$('trialBtn')){const b=document.createElement('button');b.id='trialBtn';b.className='button subtle';b.textContent='原公式试招';b.title='选中角色普攻对面首人；非完整武学效果';b.onclick=runTrial;$('runBtn').before(b)}updateButtons();return engine}
function normalizeResult(r){if(!r||typeof r!=='object')throw Error('战斗模块没有返回有效结果。');const entries=r.events||r.log||r.logs||[];return{...r,events:Array.isArray(entries)?entries.map(e=>typeof e==='string'?{text:e}:e):[],stats:Array.isArray(r.stats)?r.stats:Object.values(r.stats||{}),winner:r.winner??r.summary?.winner??null,rounds:r.rounds??r.summary?.rounds??0}}
function validateReady(){if(!config.teams.ally.length||!config.teams.enemy.length)throw Error('请为双方至少配置一名角色。');return validateConfig(config)}
let battleStage=null,stagePromise=null,clockPromise=null,replayClock=null,stageTasks=Promise.resolve(),stageRevision=0,stageConfigTimer=null,stageReady=false,previewHandle=null,stageStatusBase='',soundMuted=Boolean(readStored('yanyu-battle-audio-muted',false));
function refreshAudioControl(){const button=$('soundBtn');if(!button)return;const state=battleStage?.getState?.(),supported=typeof battleStage?.setMuted==='function'&&state?.audioSupported===true;button.hidden=!supported;button.disabled=!stageReady;button.textContent=soundMuted?'🔇':'🔊';button.title=soundMuted?'开启原始音效':'关闭原始音效';button.setAttribute('aria-label',button.title);button.setAttribute('aria-pressed',String(!soundMuted));}
function unlockStageAudio(){if(soundMuted)return;try{const pending=battleStage?.unlockAudio?.();pending?.catch?.(error=>toast('音效暂未启用：'+error.message));}catch(error){toast('音效暂未启用：'+error.message);}}
function stopPreview(){if(previewHandle!=null)cancelAnimationFrame(previewHandle);previewHandle=null;}
function startPreview(){
  stopPreview();if(result||busy||!stageReady||!battleStage)return;let epoch=null;
  const tick=stamp=>{if(result||busy||!stageReady){stopPreview();return;}if(epoch==null)epoch=stamp;
    try{battleStage.seek(stamp-epoch);}catch(error){stopPreview();stageNotice('error',error.message);return;}
    previewHandle=requestAnimationFrame(tick);
  };previewHandle=requestAnimationFrame(tick);
}
function clockLabel(ms){const seconds=Math.floor(Math.max(0,Number(ms)||0)/1000);return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
function stageNotice(state,message){
  const mask=$('stageMask');if(!mask)return;
  const ready=state==='ready';stageReady=ready;if(!ready)stopPreview();else stageStatusBase=message||'原始骨骼与动作已就绪';mask.hidden=ready;mask.classList.toggle('error',state==='error');
  $('stageMessageTitle').textContent=state==='error'?'原始战斗画面尚未就绪':'正在布置演武场';
  $('stageMessage').textContent=message||(state==='error'?'原始骨骼或动作资源未能加载。':'读取原始角色骨骼、动作与战斗资源…');
  if(ready)battleStage?.setMuted?.(soundMuted);refreshAudioControl();$('stageRenderState').textContent=ready?(message||'原始骨骼与动作已就绪'):state==='error'?'画面加载未完成':message||'正在加载原始战斗资源';
}
function shownEvents(){if(!result)return[];if(replayClock?.timeline){const indices=new Set(replayClock.visibleLogIndices);return result.events.filter((_,i)=>indices.has(i));}return result.events.slice(0,cursor);}
function renderPlaybackControls(){refreshAudioControl();
  const duration=replayClock?.durationMs||0,time=replayClock?.timeMs||0,hasTimeline=Boolean(result&&replayClock?.timeline&&duration>0);
  $('timeline').min=0;$('timeline').max=Math.max(1,Math.round(duration));$('timeline').step=1;$('timeline').value=Math.round(time);$('timeline').disabled=!hasTimeline;
  $('eventCounter').textContent=`${clockLabel(time)} / ${clockLabel(duration)}`;
  $('stepBtn').disabled=!hasTimeline||time>=duration;$('rewindBtn').disabled=!hasTimeline;$('playBtn').disabled=!hasTimeline;
  $('playBtn').textContent=replayClock?.playing?'Ⅱ':'▶';$('playBtn').setAttribute('aria-label',replayClock?.playing?'暂停战斗动画':'播放战斗动画');
  if($('stageClock'))$('stageClock').textContent=clockLabel(time);if(stageReady){const state=battleStage?.getState?.(),count=(state?.warnings?.length||0)+(state?.timeline?.diagnostics?.length||0);$('stageRenderState').textContent=stageStatusBase+(count?' · '+count+' 项表现提示':'');}
}
function applyReplayTime(state){
  if(result&&replayClock?.timeline&&battleStage){try{battleStage.seek(state.timeMs,{audio:state.playing});}catch(error){replayClock.pause();stageNotice('error',error.message);}}
  const next=state.visibleLogIndices.length,changed=next!==cursor;cursor=next;
  renderPlaybackControls();
  if(changed){renderResult();renderBoard();}
  const last=shownEvents().at(-1);if($('stageRound'))$('stageRound').textContent=last?.round?`第 ${last.round} 回合`:result?'演武开始':'阵容预览';
}
async function ensureReplayClock(){
  if(replayClock)return replayClock;
  if(!clockPromise)clockPromise=import('./ui/playback.mjs').then(({PlaybackClock})=>{
    replayClock=new PlaybackClock({onTime:applyReplayTime,onPlaying:()=>renderPlaybackControls()});
    replayClock.setSpeed(Number($('playSpeed').value)||1);return replayClock;
  }).catch(error=>{clockPromise=null;throw error;});
  return clockPromise;
}
async function ensureBattleStage(){
  if(battleStage)return battleStage;
  if(!stagePromise)stagePromise=import('./presentation/stage.mjs').then(async module=>{
    if(typeof module.createBattleStage!=='function')throw Error('原始战斗渲染模块尚未提供可用入口。');
    battleStage=await module.createBattleStage($('battleCanvas'),{
      onStatus:status=>stageNotice(typeof status==='string'?status:status?.state||'loading',typeof status==='object'?status.message:undefined),
      onError:error=>{stopPlayback();stageNotice('error',error?.message||String(error));},
      onSelect:id=>{if(busy)return;for(const side of ['ally','enemy'])if(config.teams[side].some(r=>r.uid===id)){setSelection(side,id);break;}}
    });
    return battleStage;
  }).catch(error=>{stagePromise=null;stageNotice('error',error.message);throw error;});
  return stagePromise;
}
function queueStageTask(task){const queued=stageTasks.catch(()=>{}).then(task);stageTasks=queued;return queued;}
function refreshStageConfig(){
  const revision=++stageRevision;clearTimeout(stageConfigTimer);
  stageConfigTimer=setTimeout(()=>{
    queueStageTask(async()=>{
      if(revision!==stageRevision)return;
      stageNotice('loading','正在读取当前阵容的原始角色资源…');
      const stage=await ensureBattleStage();if(revision!==stageRevision)return;
      await stage.setConfig(copy(config));if(revision!==stageRevision)return;
      const info=stage.getState?.()||{};
      if(info.ready===false)stageNotice('loading',info.message||'原始角色资源仍在加载');else stageNotice('ready',info.message||'原始骨骼与动作已就绪');
      $('stageRound').textContent='阵容预览';$('stageClock').textContent='00:00';startPreview();
    }).catch(error=>stageNotice('error',error.message));
  },60);
}
async function initPresentation(){try{await ensureReplayClock();refreshStageConfig();}catch(error){stageNotice('error',error.message);}}
async function prepareBattlePresentation(battle,request){
  const clock=await ensureReplayClock();const revision=++stageRevision;clearTimeout(stageConfigTimer);
  return queueStageTask(async()=>{
    if(revision!==stageRevision)return false;
    stageNotice('loading','正在关联原始动作、技能特效与战斗消息…');
    const stage=await ensureBattleStage(),loaded=await stage.loadBattle(battle,copy(request));
    if(revision!==stageRevision)return false;
    const info=stage.getState?.()||{},timeline=loaded?.timeline||loaded?.durationMs!=null&&loaded||info.timeline;
    if(!timeline||!Array.isArray(timeline.cues||timeline.events))throw Error('原始战斗消息时间轴尚未就绪，未生成替代动画。');
    clock.setTimeline(timeline,battle.events);stage.seek(0);
    if(info.ready===false)throw Error(info.message||'原始Spine资源尚未就绪。');
    stageNotice('ready',info.message||'由原始战斗消息驱动');renderResult();renderBoard();return true;
  });
}
function resetPresentation(){stopPlayback();replayClock?.reset();refreshStageConfig();}

async function runBattle(){
  unlockStageAudio();let start=false;
  try{const request=validateReady();engineFailure='';busy=true;stopPlayback();updateButtons();renderEditor();stageNotice('loading','正在按原始战斗逻辑推演…');await waitFrame();
    result=normalizeResult(await engine.run(copy(request)));resultConfig=request;cursor=0;replayClock?.reset();renderResult();renderBoard();
    try{start=await prepareBattlePresentation(result,request);}catch(error){stageNotice('error',error.message);toast('战斗已计算完成，原始画面加载尚未完成。');}
  }catch(error){engineFailure=error.message;result=null;resultConfig=null;cursor=0;replayClock?.reset();renderResult();stageNotice('error',error.message);toast('演武未完成：'+error.message);}
  finally{busy=false;updateButtons();renderEditor();}
  if(start)play();
}
async function runTrial(){try{validateReady();const r=currentRole()||config.teams.ally[0],s=config.teams.ally.some(x=>x.uid===r.uid)?'ally':'enemy',target=config.teams[s==='ally'?'enemy':'ally'][0];busy=true;updateButtons();renderEditor();await waitFrame();const t=await engine.evaluateAttack({attacker:copy(r),defender:copy(target),seed:config.seed,config:copy(config)});$('sourceContent').innerHTML=`<h3>${esc(r.name)} → ${esc(target.name)}</h3><div class="source-callout">基于已输入最终面板的原公式普攻试算。此结果不是完整武学效果，也不包含未接入的触发链。</div><dl><dt>本次伤害</dt><dd>${fmt(t.damage)}</dd><dt>命中后伤害</dt><dd>${fmt(t.damageOnHit??t.damage)}</dd><dt>当前招架状态区间</dt><dd>${fmt(t.damageMin)} ～ ${fmt(t.damageMax)}</dd><dt>基础命中率</dt><dd>${fmt(t.hitChance)}%</dd><dt>基础招架率</dt><dd>${fmt(t.parryChance)}%</dd><dt>本次命中 / 招架</dt><dd>${esc(t.hitResult)} / ${esc(t.parryResult)}</dd></dl><p>基础概率后仍有原破闪避 / 破招架二次判定。面板暴击不会在此擅自随机触发。</p><h3>原始结算详情</h3><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:10px">${esc(JSON.stringify(t,null,2))}</pre>`;$('sourceDialog').showModal()}catch(e){toast(`试招未完成：${e.message}`)}finally{busy=false;updateButtons();renderEditor()}}
function renderResult(){const events=result?.events||[];renderPlaybackControls();$('downloadLog').disabled=!result;const w=result?.winner,text=w==='ally'?'我方获胜':w==='enemy'?'对手获胜':w==='draw'?'平局':result?'已结算':'尚未开战';$('resultBadge').textContent=text;if(!result){$('logView').innerHTML=engineFailure?`<div class="empty-state"><span class="empty-mark">止</span><h3>此配置暂未完成演武</h3><p>${esc(engineFailure)}</p><p>请调整配置后重试；未生成替代战斗结果。</p></div>`:'<div class="empty-state"><span class="empty-mark">劍</span><h3>胜负，始于推演</h3><p>配置双方阵容后开始演武，<br>在这里逐步查看每一次出招与结算。</p></div>';$('statsView').innerHTML='<div class="empty-state"><h3>尚无伤害统计</h3><p>完成一次演武后查看。</p></div>';$('resultSummary').textContent='固定随机种子，可复验同一配置下的结果';return}$('resultSummary').textContent=`${text} · ${result.rounds} 回合 · 种子 ${resultConfig?.seed??config.seed}`;$('logView').innerHTML=shownEvents().slice(-150).map((e,i)=>{const d=Number(e.damage),h=Number(e.healing),val=h>0?`+${fmt(h)}`:d>0?`−${fmt(d)}`:'',txt=e.text??`${e.actor||e.actorName||'角色'}${e.skill?'施展「'+e.skill+'」':'行动'}${e.target?' → '+e.target:''}${e.type?' · '+e.type:''}`;return`<div class="log-row"><span class="log-round">${e.round?'回合 '+e.round:'行动 '+(Math.max(0,cursor-150)+i+1)}</span><span class="log-text">${esc(txt)}</span><span class="log-value ${h>0?'heal':''}">${val}</span></div>`}).join('')||'<div class="empty-state"><span class="empty-mark">始</span><h3>演武尚未出招</h3><p>点击播放或下一步，查看行动记录。</p></div>';$('logView').scrollTop=$('logView').scrollHeight;const stats=result.stats||[],max=Math.max(1,...stats.map(s=>Number(s.damage)||0));$('statsView').innerHTML=stats.length?`<div class="stats-summary"><span>本场最终累计伤害</span><span>总伤害 ${fmt(stats.reduce((a,s)=>a+(Number(s.damage)||0),0))}</span>${Number(result.metadata?.unattributedDamage)>0?`<span class="unattributed-note">另有 ${fmt(result.metadata.unattributedDamage)} 状态伤害未标注来源，已记入承伤与日志。</span>`:""}</div>`+stats.map(s=>`<div class="stats-row ${s.team==='enemy'?'enemy':''}"><div class="stats-name">${esc(s.name)}<small>${s.team==='enemy'?'对手':'我方'}${Number(s.healing)>0?' · 治疗 '+fmt(s.healing):''}</small></div><div class="stat-bar"><span style="width:${Math.max(0,Math.min(100,(Number(s.damage)||0)/max*100))}%"></span></div><span class="stats-number">${fmt(s.damage)}</span></div>`).join(''):'<div class="empty-state"><h3>该结果没有统计明细</h3><p>可在出招记录中查看原始结算。</p></div>'}
function stopPlayback(){stopPreview();replayClock?.pause();if(timer){clearInterval(timer);timer=null;}$('playBtn').textContent='▶';$('playBtn').setAttribute('aria-label','播放战斗动画');}
function play(){unlockStageAudio();stopPreview();if(replayClock?.playing){stopPlayback();return;}if(!result||!replayClock?.timeline)return;replayClock.setSpeed(Number($('playSpeed').value)||1);replayClock.play();}
function renderPresets(){const all=readStored(keys.presets,[]);$('presetItems').innerHTML=all.length?all.map((p,i)=>`<div class="preset-row"><div><h3>${esc(p.name)}</h3><p>${esc(new Date(p.savedAt).toLocaleString('zh-CN'))} · ${(p.config?.teams?.ally||[]).length} 对 ${(p.config?.teams?.enemy||[]).length}</p></div><div><button class="button subtle small" data-load-preset="${i}">载入</button><button class="icon-button" data-delete-preset="${i}" aria-label="删除${esc(p.name)}" title="删除方案">×</button></div></div>`).join(''):'<div class="empty-state"><span class="empty-mark">录</span><h3>还没有保存的方案</h3><p>配置好阵容后，点击右上角「保存方案」。</p></div>';$('presetItems').querySelectorAll('[data-load-preset]').forEach(b=>b.onclick=()=>{if(busy)return;try{config=validateConfig(all[Number(b.dataset.loadPreset)].config);selectFirst();syncControls();afterChange();renderEditor();$('presetsDialog').close();toast('方案已载入。')}catch(e){toast(e.message)}});$('presetItems').querySelectorAll('[data-delete-preset]').forEach(b=>b.onclick=()=>{all.splice(Number(b.dataset.deletePreset),1);storeValue(keys.presets,all);renderPresets()})}
function savePreset(){const name=$('presetName').value.trim();if(!name){toast('请给方案起个名字。');$('presetName').focus();return}config.name=name;const all=readStored(keys.presets,[]),existing=all.findIndex(p=>p.name===name),entry={name,savedAt:new Date().toISOString(),config:copy(config)};if(existing>=0)all[existing]=entry;else all.unshift(entry);if(storeValue(keys.presets,all.slice(0,50))){$('saveDialog').close();storeValue(keys.draft,config);toast(existing>=0?'同名方案已更新。':'方案已保存。')}}
function downloadJSON(n,v){const b=new Blob([JSON.stringify(v,null,2)],{type:'application/json'}),url=URL.createObjectURL(b),a=document.createElement('a');a.href=url;a.download=n;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function selectFirst(){const r=config.teams.ally[0]||config.teams.enemy[0];selected=r?{side:config.teams.ally[0]?'ally':'enemy',uid:r.uid}:null}
function syncControls(){$('seed').value=config.seed;$('maxRounds').value=config.maxRounds;renderSceneSelect()}
async function runBatch(compare=false){let a,b;try{b=validateReady();if(compare){if(!baseline)throw Error('请先设置方案 A。');a=validateConfig(baseline)}}catch(e){toast(e.message);return}busy=true;cancelled=false;stopPlayback();updateButtons();renderEditor();$('batchResult').hidden=false;const out={A:{wins:0,losses:0,draws:0,rounds:0,count:0},B:{wins:0,losses:0,draws:0,rounds:0,count:0}},process=(r,k)=>{out[k].count++;out[k].rounds+=Number(r.rounds)||0;if(r.winner==='ally')out[k].wins++;else if(r.winner==='enemy')out[k].losses++;else out[k].draws++};try{for(let i=0;i<100;i++){if(cancelled)break;const seed=((b.seed+i-1)%4294967295)+1;if(compare)process(normalizeResult(await engine.run({...copy(a),seed})),'A');process(normalizeResult(await engine.run({...copy(b),seed})),'B');if(i%3===0||i===99){$('batchResult').innerHTML=`<div class="batch-progress"><span>正在推演 ${i+1} / 100 ${compare?'组对照':'场'}…</span><button class="text-button" id="cancelBatch">停止</button></div>`;$('cancelBatch').onclick=()=>cancelled=true;await waitFrame()}}const metric=(label,o)=>`<div class="batch-metric"><b>${o.count?(o.wins/o.count*100).toFixed(1):'0'}<small>%</small></b><span>${label} · 我方胜率</span></div><div class="batch-metric"><b>${o.wins}/${o.losses}/${o.draws}</b><span>${label} · 胜 / 负 / 平</span></div><div class="batch-metric"><b>${o.count?(o.rounds/o.count).toFixed(1):'0'}</b><span>${label} · 平均回合</span></div>`;$('batchResult').innerHTML=(compare?metric('方案 A',out.A):'')+metric(compare?'方案 B':'当前方案',out.B);$('baselineNote').textContent=`${cancelled?'已停止，统计已完成的':'已完成'} ${out.B.count} ${compare?'组同种子对照':'场演武'}，起始种子 ${b.seed}。${compare&&out.B.count?' A/B 胜率差 '+((out.B.wins/out.B.count-out.A.wins/out.A.count)*100).toFixed(1)+' 个百分点。':''}`}catch(e){$('batchResult').innerHTML=`<div class="warning-text">批量运行中止：${esc(e.message)}</div>`;toast('批量运行未完成，请检查引擎支持范围。')}finally{busy=false;updateButtons();renderEditor()}}
function bindEvents(){for(const s of ['ally','enemy'])$(s+'Grid').onclick=e=>{if(busy)return;const c=e.target.closest('[data-role]');if(c){setSelection(s,c.dataset.role);return}const cell=e.target.closest('[data-cell]');if(!cell)return;const p=Number(cell.dataset.cell),r=currentRole();if(r&&selected.side===s){r.position=p;afterChange()}else if(config.teams[s].length<4)openPicker('role',{addSide:s,position:p});else toast('请先选择这一方的角色，再点击空位移动。')};document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>openPicker('role',{addSide:b.dataset.add}));$('swapBtn').onclick=()=>{[config.teams.ally,config.teams.enemy]=[config.teams.enemy,config.teams.ally];for(const s of ['ally','enemy'])config.teams[s].forEach(r=>{r.team=s});if(selected)selected.side=selected.side==='ally'?'enemy':'ally';afterChange();renderEditor()};$('seed').onchange=e=>{const v=Math.trunc(Number(e.target.value));if(!Number.isFinite(v)||v<1||v>4294967295){e.target.value=config.seed;toast('随机种子须为 1～4294967295。');return}config.seed=v;afterChange()};$('randomSeed').onclick=()=>{config.seed=crypto.getRandomValues(new Uint32Array(1))[0]||1;syncControls();afterChange()};$('maxRounds').onchange=e=>{config.maxRounds=Number(e.target.value);afterChange()};$('sceneSelect').onchange=e=>{try{config.sceneId=validateSceneId(e.target.value);void afterAppearanceChange()}catch(error){toast(error.message);renderSceneSelect()}};$('runBtn').onclick=runBattle;$('soundBtn').onclick=()=>{soundMuted=!soundMuted;battleStage?.setMuted?.(soundMuted);storeValue('yanyu-battle-audio-muted',soundMuted);unlockStageAudio();refreshAudioControl()};$('rewindBtn').onclick=()=>{stopPlayback();replayClock?.rewind();renderResult();renderBoard()};$('stepBtn').onclick=()=>{stopPlayback();replayClock?.step()};$('playBtn').onclick=play;$('playSpeed').onchange=()=>replayClock?.setSpeed(Number($('playSpeed').value)||1);$('timeline').oninput=e=>{stopPlayback();replayClock?.seek(Number(e.target.value))};document.querySelectorAll('[data-result-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-result-tab]').forEach(t=>{t.classList.toggle('active',t===b);t.setAttribute('aria-selected',String(t===b))});$('logView').hidden=b.dataset.resultTab!=='log';$('statsView').hidden=b.dataset.resultTab!=='stats'});$('pickerSearch').oninput=renderPicker;$('pickerFilter').onchange=renderPicker;document.querySelectorAll('.close-dialog').forEach(b=>b.onclick=()=>b.closest('dialog').close());document.querySelectorAll('dialog').forEach(d=>d.onclick=e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close()}});$('saveBtn').onclick=()=>{$('presetName').value=config.name;$('saveDialog').showModal();$('presetName').focus();$('presetName').select()};$('confirmSave').onclick=savePreset;$('presetName').onkeydown=e=>{if(e.key==='Enter')savePreset()};$('exportBtn').onclick=()=>downloadJSON('yanyu-battle-config.json',{...getConfig(),dataSnapshot:catalog.meta?.sourceSnapshot});$('downloadLog').onclick=()=>downloadJSON('yanyu-battle-report.json',{config:resultConfig,result,engine:engine?.status,sourceSnapshot:catalog.meta?.sourceSnapshot});$('importBtn').onclick=()=>{if(!busy)$('importFile').click()};$('importFile').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;try{if(f.size>2*1024*1024)throw Error('配置文件超过 2 MB。');const d=JSON.parse(await f.text());config=validateConfig(d.config||d);selectFirst();syncControls();afterChange();renderEditor();toast('配置导入成功。')}catch(err){toast(`无法导入：${err.message}`)}finally{e.target.value=''}};$('sourceBtn').onclick=showSources;$('sourceNav').onclick=showSources;$('stageRenderState').onclick=showSources;document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{if(b.dataset.nav==='library')openPicker('library');else if(b.dataset.nav==='presets'){renderPresets();$('presetsDialog').showModal()}else $('arenaSection').scrollIntoView({behavior:'smooth',block:'start'})});$('baselineBtn').onclick=()=>{baseline=getConfig();storeValue(keys.baseline,baseline);$('baselineNote').textContent=`方案 A 已锁定：${baseline.name} · ${baseline.teams.ally.map(r=>r.name).join('、')}。修改当前配置后点击 A / B 对照。`;toast('已将当前阵容设为方案 A。');updateButtons()};$('batchBtn').onclick=()=>runBatch(false);$('compareBtn').onclick=()=>runBatch(true)}
async function init(){bindEvents();try{const response=await fetch('./data/catalog.json');if(!response.ok)throw Error(`数据读取失败 (${response.status})`);normalizeCatalog(await response.json());await Promise.all([loadWeaponAppearance(),loadSceneCatalog()]);const saved=readStored(keys.draft,null);try{if(saved)config=validateConfig(saved);else createDefault()}catch{createDefault();toast('旧配置与当前数据不兼容，已载入初始阵容。')}try{const stored=readStored(keys.baseline,null);if(stored)baseline=validateConfig(stored)}catch{}selectFirst();syncControls();renderBoard();renderEditor();renderResult();$('dataVersion').textContent=`数据快照 2026.10.07 · ${catalog.taolu.length+catalog.nei.length+catalog.qing.length} 项武学配置`;if(baseline)$('baselineNote').textContent=`已保存方案 A：${baseline.name}。修改当前配置后可进行同种子对照。`;updateButtons()}catch(e){sourceError=e.message;$('engineNote').textContent=`数据加载失败：${e.message}。请刷新或检查部署文件。`;$('engineBadge').innerHTML='<i></i> 数据读取失败';$('dataVersion').textContent='数据尚不可用';return}try{const m=await import('./engine/adapter.js');const a=typeof m.createEngine==='function'?await m.createEngine({catalog}):typeof m.default==='function'?await m.default({catalog}):m.default||m.engine||m;await setEngine(a)}catch(e){sourceError=e.message;updateButtons()}finally{void initPresentation()}}
window.BattleUI={setEngine,setCatalog(d){normalizeCatalog(d);renderBoard();renderEditor();updateButtons()},getConfig,setConfig(v){config=validateConfig(v);selectFirst();syncControls();afterChange();renderEditor()},getResult:()=>result?copy(result):null,getPlaybackState:()=>({timeMs:replayClock?.timeMs||0,durationMs:replayClock?.durationMs||0,playing:Boolean(replayClock?.playing),stage:battleStage?.getState?.()}),showSources,refresh:()=>{renderBoard();renderEditor();renderResult();updateButtons()}};
await init();
