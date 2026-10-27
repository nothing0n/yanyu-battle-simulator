const clone=value=>JSON.parse(JSON.stringify(value));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=value=>Number(value||0).toLocaleString('zh-CN',{maximumFractionDigits:1});
const sideName=side=>side==='ally'?'我方':'对手';
const slotNames={weapon:'武器',belt:'腰带',bracer:'护腕',armor:'衣甲',ring:'戒指',pendant:'挂坠'};
const slotKey=e=>e.slotKey||([1,2,3,4].includes(Number(e.slot))?'weapon':({5:'belt',6:'bracer',7:'armor',8:'ring',9:'pendant'}[Number(e.slot)]||`special-${e.slot}`));
const baseNames={atk:'攻击',def:'防御',hp:'气血',hit:'命中',dodge:'闪避',speed:'速度',parry:'招架',renxing:'韧性',neijin:'内劲',gangqi:'罡气'};
const panelNames={hp:'气血',atk:'攻击',def:'防御',speed:'速度',hit:'命中',dodge:'闪避',parry:'招架',mp:'初始真元',mpBack:'聚气',neijin:'内劲',gangqi:'罡气'};
const forbidden=new Set(['__proto__','prototype','constructor']);
function rejectReserved(value,depth=0){
  if(depth>35)throw Error('配置嵌套过深。');
  if(!value||typeof value!=='object')return;
  for(const [key,child]of Object.entries(value)){if(forbidden.has(key))throw Error('配置含不允许的保留字段。');rejectReserved(child,depth+1);}
}
function finite(value,label,min=-1e7,max=1e7){const n=Number(value);if(!Number.isFinite(n)||n<min||n>max)throw Error(`${label}数值无效。`);return n;}

/** UI-only coordinator. All native gameplay calculations remain in editor-model. */
export async function createWorkbench(deps){
  const model=await import('../integration/editor-model.mjs');
  const formation=await import('../integration/formations.mjs');
  const [assets,formations]=await Promise.all([model.loadEditorAssets(deps.readJSON?{readJSON:deps.readJSON}:{}),formation.loadFormationCatalog(deps.readJSON)]);
  const panelCache=new Map(),panelErrors=new Map();
  let revision=0,pending=false,timer=null,disposed=false,inspectionQueue=Promise.resolve();
  const native=r=>Boolean(r?.build);
  const isNativeConfig=c=>['ally','enemy'].some(s=>c.teams?.[s]?.some(native));
  const fingerprint=r=>{const value=clone(r);delete value.weaponSkin;return JSON.stringify(value);};
  const rolePanel=r=>panelCache.get(r.uid)?.key===fingerprint(r)?panelCache.get(r.uid).panel:null;
  const fallback={hp:1,atk:0,def:0,speed:0,hit:0,dodge:0,parry:0,mp:0,mpBack:0,neijin:0,gangqi:0};
  const presets=Array.isArray(assets.presets)?assets.presets:[];
  const reference=Array.isArray(assets.defaultTeam)&&assets.defaultTeam.length?{id:'reference',label:'研究基准 · 夺天地',description:'主角、于小雪、央蛮与桃花；沿用已验证研究基准，隐藏培养为条件模型。',team:assets.defaultTeam,formations:[{...(assets.defaultFormation||{id:508,level:3}),positions:assets.defaultTeam.map(r=>r.position)}]}:null;
  const choices=reference?[reference,...presets]:presets;
  const equipment=Array.isArray(assets.equipment)?assets.equipment:[];
  const secrets=Array.isArray(assets.secrets)?assets.secrets:[];
  const affixes=Array.isArray(assets.affixCatalog||assets.affixes)?(assets.affixCatalog||assets.affixes):Object.values(assets.affixCatalog||assets.affixes||{});
  const presetById=id=>choices.find(p=>String(p.id)===String(id));
  const secretById=id=>secrets.find(s=>Number(s.id)===Number(id));
  const affixById=id=>affixes.find(a=>String(a.id)===String(id));
  const freeFormation={id:0,name:'无阵法',allowedSlots:[1,2,3,4,5,6,7],eyeSlots:[],slots:formation.FORMATION_GRID.map(s=>({...s,allowed:true,geometryLabel:s.label})),notes:[]};
  const getFormation=id=>Number(id)===0?freeFormation:formation.getFormation(formations,Number(id));
  const selectedFormation=(c,side)=>c.formations?.[side]||c.teams[side]?.[0]?.formation||{id:0,level:1};
  const validation=(c,side)=>{
    const f=selectedFormation(c,side);
    if(!Number(f.id))return {valid:true,errors:[],warnings:[],slots:freeFormation.slots};
    return formation.validateFormationTeam(formations,f,c.teams[side],{requireFour:false});
  };
  const choosePresetLayout=(preset,id)=>preset.formations?.find(f=>Number(f.id)===Number(id))||preset.formations?.[0];
  function placeTeam(c,side,f,reset=true){
    const proposed={id:Number(f.id),level:Number(f.level)};
    if(!Number.isInteger(proposed.level)||proposed.level<1||proposed.level>3)throw Error('当前阵法等级覆盖1～3级。');
    let rows=c.teams[side];
    if(proposed.id&&reset){const style=rows.some(r=>r.skills?.wai===21850)?'yijian':'general';rows=formation.reflowFormationTeam(formations,proposed,rows,{preset:style,keepExisting:false}).roles;}
    for(const row of rows)row.formation=clone(proposed);
    c.teams[side]=rows;c.formations={...(c.formations||{}),[side]:proposed};
    const check=validation(c,side);if(!check.valid)throw Error(check.errors.join('；'));
  }
  function normalize(raw){
    rejectReserved(raw);
    if(!raw||typeof raw!=='object'||!raw.teams)throw Error('配置须包含双方阵容。');
    if(raw.version!=null&&![1,2].includes(raw.version))throw Error('不支持这个配置版本，请使用版本1或2。');
    if(raw.fightType!=null&&Number(raw.fightType)!==2)throw Error('此编辑器只支持竞技规则。');
    for(const key of Object.keys(raw.teams))if(!['ally','enemy'].includes(key))throw Error('阵容包含未知队伍字段。');
    if(raw.formations)for(const [side,f]of Object.entries(raw.formations)){if(!['ally','enemy'].includes(side)||!f||typeof f!=='object'||Array.isArray(f))throw Error('阵法配置无效。');for(const key of Object.keys(f))if(!['id','level'].includes(key))throw Error('阵法包含未知字段。');}
    if(raw.presetIds)for(const key of Object.keys(raw.presetIds))if(!['ally','enemy'].includes(key))throw Error('预设包含未知队伍字段。');
    const allowed=new Set(['version','sceneId','name','seed','maxRounds','fightType','teams','formations','presetIds','dataSnapshot']);
    for(const key of Object.keys(raw))if(!allowed.has(key))throw Error(`未识别的配置字段 ${key}。`);
    const c={version:2,sceneId:deps.validateSceneId(raw.sceneId),name:String(raw.name||'演武配置').slice(0,40),seed:finite(raw.seed,'随机种子',1,4294967295),maxRounds:Number(raw.maxRounds??100),fightType:2,teams:{ally:[],enemy:[]},formations:{},presetIds:{}};
    if(!Number.isInteger(c.seed))throw Error('随机种子须为整数。');
    if(![20,50,100].includes(c.maxRounds))throw Error('回合安全上限须为20、50或100。');
    const seen=new Set();
    for(const side of ['ally','enemy']){
      if(!Array.isArray(raw.teams[side])||raw.teams[side].length>4)throw Error('每方须为至多4个角色的数组。');
      c.teams[side]=raw.teams[side].map(row=>{
        if(!row||typeof row!=='object'||Array.isArray(row))throw Error('角色须为对象。');
        if(typeof row.uid!=='string'||!/^[-\w]{1,80}$/.test(row.uid)||seen.has(row.uid))throw Error('角色uid须为双方唯一的不重复标识。');
        if(native(row)&&row.stats!=null)throw Error('原模型角色不接受手工面板，请编辑装备、武学或秘技。');
        const r=native(row)?clone(model.validateEditorRole(clone(row),assets)):deps.normalizeManualRole(row,side,c);
        if(typeof r.uid!=='string'||!/^[-\w]{1,80}$/.test(r.uid)||seen.has(r.uid))throw Error('角色uid须为双方均不重复的字母、数字或短横线。');
        seen.add(r.uid);
        if(!Number.isInteger(Number(r.position))||r.position<0||r.position>6)throw Error('角色站位须在1～7号格。');
        return r;
      });
      const f=raw.formations?.[side]||c.teams[side][0]?.formation||{id:0,level:1};
      placeTeam(c,side,f,false);
      if(raw.presetIds?.[side]!=null){if(!presetById(raw.presetIds[side]))throw Error('配置引用了未知预设。');c.presetIds[side]=String(raw.presetIds[side]);}
      const positions=c.teams[side].map(r=>r.position);if(new Set(positions).size!==positions.length)throw Error(`${sideName(side)}角色站位重叠。`);
    }
    return c;
  }
  function createDefault(){
    if(presets.length<1)throw Error('五队预设尚未加载。');
    const c={version:2,sceneId:10,name:'五队条件演武',seed:20261027,maxRounds:100,fightType:2,teams:{ally:[],enemy:[]},formations:{},presetIds:{}};
    loadInto(c,'ally',reference||presets[0]);loadInto(c,'enemy',presets[Math.min(4,presets.length-1)]);
    return normalize(c);
  }
  function loadInto(c,side,preset){
    const loaded=model.clonePresetTeam(preset,side);
    c.teams[side]=loaded.rows.map((r,i)=>({...r,uid:`${side}-${String(preset.id).replace(/[^\w-]/g,'')}-${i}`}));
    c.presetIds={...(c.presetIds||{}),[side]:String(preset.id)};
    const preferred=loaded.formation||choosePresetLayout(preset)?.formation||choosePresetLayout(preset)||{id:508,level:3};
    placeTeam(c,side,{id:preferred.id,level:preferred.level??3},false);
  }
  function loadTeam(side,id){
    if(deps.busy())return;
    const p=presetById(id);if(!p)throw Error('请选择预设队伍。');
    const c=clone(deps.getConfig());loadInto(c,side,p);deps.replaceConfig(normalize(c));
    deps.selectRole(side,c.teams[side][0]?.uid);deps.toast(`${sideName(side)}已载入${p.label}。`);
  }
  function editRole(role,mutate){
    if(deps.busy())return;
    try{
      const candidate=clone(role);mutate(candidate);const normalized=model.validateEditorRole(candidate,assets);
      Object.keys(role).forEach(k=>delete role[k]);Object.assign(role,normalized);panelErrors.delete(role.uid);deps.changed();
    }catch(error){deps.toast(error.message);deps.renderEditor();}
  }
  function renderControls(){
    const c=deps.getConfig(),target=document.getElementById('teamConfiguration');if(!target)return;
    target.innerHTML=['ally','enemy'].map(side=>{
      const f=selectedFormation(c,side),form=getFormation(f.id),check=validation(c,side),p=c.presetIds?.[side],busy=deps.busy()?'disabled':'';
      return `<section class="team-config-card ${side}" aria-label="${sideName(side)}阵容配置"><h3>${sideName(side)}阵容</h3><div class="team-preset-line"><label class="sr-only" for="${side}TeamPreset">${sideName(side)}队伍预设</label><select id="${side}TeamPreset" ${busy}><option value="">选择队伍预设</option>${choices.map(x=>`<option value="${esc(x.id)}" ${String(x.id)===String(p)?'selected':''}>${esc(x.label)}</option>`).join('')}</select><button class="button subtle small" id="${side}LoadPreset" ${busy}>载入</button><button class="text-button" id="${side}ResetPreset" ${busy||!p?'disabled':''}>重置预设</button></div><div class="team-formation-line"><label>阵法<select id="${side}Formation" ${busy}><option value="0" ${!Number(f.id)?'selected':''}>无阵法</option>${formations.formations.map(x=>`<option value="${x.id}" ${Number(x.id)===Number(f.id)?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label><label>阵法等级<select id="${side}FormationLevel" ${busy}>${[1,2,3].map(level=>`<option value="${level}" ${level===Number(f.level)?'selected':''}>${level}级</option>`).join('')}</select></label></div><p class="formation-hint">合法格：${form.allowedSlots.join('、')}${form.eyeSlots.length?'；阵眼：'+form.eyeSlots.join('、'):''}。${esc((check.warnings||[]).join('；'))}</p>${p?`<p class="preset-origin">${esc(presetById(p)?.description||presetById(p)?.source||'榜单武学装备观察＋隐藏满培养估计')}</p>`:''}</section>`;
    }).join('');
    for(const side of ['ally','enemy']){
      document.getElementById(side+'LoadPreset').onclick=()=>{try{loadTeam(side,document.getElementById(side+'TeamPreset').value);}catch(e){deps.toast(e.message);}};
      document.getElementById(side+'ResetPreset').onclick=()=>{try{loadTeam(side,c.presetIds?.[side]);}catch(e){deps.toast(e.message);}};
      for(const [suffix,key]of [['Formation','id'],['FormationLevel','level']])document.getElementById(side+suffix).onchange=e=>{
        try{const candidate=clone(deps.getConfig()),f={...selectedFormation(candidate,side),[key]:Number(e.target.value)};placeTeam(candidate,side,f,key==='id');deps.replaceConfig(normalize(candidate));deps.toast(key==='id'?'已按阵法推荐位置调整，可在合法空格中移动。':'阵法等级已更新。');}catch(error){deps.toast(error.message);renderControls();}
      };
    }
  }
  function decorateBoard(){
    const c=deps.getConfig();
    for(const side of ['ally','enemy']){
      const f=getFormation(selectedFormation(c,side).id);
      const grid=document.getElementById(side+'Grid');
      grid?.querySelectorAll('[data-cell],[data-role]').forEach(button=>{
        const r=button.dataset.role?c.teams[side].find(x=>x.uid===button.dataset.role):null;
        const stand=(r?r.position:Number(button.dataset.cell))+1,slot=f.slots.find(s=>Number(s.stand)===stand),allowed=f.allowedSlots.includes(stand);
        button.classList.toggle('illegal-slot',!allowed);button.classList.toggle('formation-eye',f.eyeSlots.includes(stand));
        const description=`${stand}号${slot?.geometryLabel||slot?.label||''}${f.eyeSlots.includes(stand)?' · 阵眼':''}`;
        button.title=(r?`${r.name} · `:'')+description+(!allowed?' · 此阵法不可站立':'');
        if(!r){button.disabled=!allowed||deps.busy();button.setAttribute('aria-label',`${sideName(side)}${description}${allowed?'，点击移动':'，此阵法不可站立'}`);if(!allowed)button.innerHTML=`<small class="position-index">${stand}</small><span>—</span>`;}
        if(r&&!button.querySelector('.slot-caption'))button.insertAdjacentHTML('beforeend',`<small class="slot-caption">${esc(description)}</small>`);
      });
    }
    renderControls();
  }
  function canMove(side,position){
    const c=deps.getConfig(),f=getFormation(selectedFormation(c,side).id);
    if(!f.allowedSlots.includes(Number(position)+1)){deps.toast('这个格位不属于当前阵法。');return false;}
    if(c.teams[side].some(r=>r.position===Number(position))){deps.toast('这个格位已有角色。');return false;}return true;
  }
  const ratio=a=>['ratio','percent','fraction'].includes(a?.unit);
  const attrOptions=id=>`<option value="">选择词条</option>`+affixes.map(a=>`<option value="${esc(a.id)}" ${String(a.id)===String(id)?'selected':''}>${esc(a.name||a.id)}${ratio(a)?' (%)':''}</option>`).join('');
  function equipmentControl(role,e,index){
    const current=equipment.find(x=>Number(x.id)===Number(e.templateId));
    const choices=equipment.filter(x=>slotKey({slot:x.type})===slotKey(e));
    const aliases=e.affixes||[],disabled=deps.busy()?'disabled':'';
    return `<details class="equipment-item" ${index===0?'open':''}><summary>${esc(slotNames[slotKey(e)]||'特殊装备 '+e.slot)} · ${esc(current?.name||'模板 #'+e.templateId)}${current?.level?' · 需求'+current.level+'级':''}</summary><div class="equipment-fields"><label>装备模板<select data-equipment-template="${index}" ${disabled}>${choices.length?choices.map(x=>`<option value="${x.id}" ${Number(x.id)===Number(e.templateId)?'selected':''}>${esc(x.name)} · ${x.id}</option>`).join(''):`<option value="${e.templateId}">模板 #${e.templateId}</option>`}</select></label><div class="equipment-number-row"><label>强化层级<input data-equipment-level="${index}" type="number" min="0" max="100" value="${Number(e.level)||0}" ${disabled}></label><label>品质<input data-equipment-color="${index}" type="number" min="0" max="6" value="${Number(e.color)||0}" ${disabled}></label></div><div class="equipment-base-grid">${Object.entries(baseNames).map(([key,label])=>`<label>${label}<input data-equipment-base="${index}" data-key="${key}" type="number" step="any" value="${Number(e.base?.[key])||0}" ${disabled}></label>`).join('')}</div><div class="affix-list">${aliases.map((a,i)=>{const info=affixById(a.id);return `<div class="affix-row"><select data-affix-id="${index}:${i}" ${disabled} aria-label="装备词条">${attrOptions(a.id)}</select><label><input data-affix-value="${index}:${i}" type="number" step="any" value="${Number(a.value)*(ratio(info)?100:1)}" ${disabled} aria-label="词条数值"><span>${ratio(info)?'%':''}</span></label><select data-affix-source="${index}:${i}" ${disabled} aria-label="词条来源">${[['extra','附加'],['special','特殊'],['full','完整']].map(([v,n])=>`<option value="${v}" ${String(a.source||'extra')===v?'selected':''}>${n}</option>`).join('')}</select><button class="icon-button" data-remove-affix="${index}:${i}" ${disabled} aria-label="删除词条">×</button></div>`;}).join('')}</div><button class="text-button" data-add-affix="${index}" ${disabled||!affixes.length?'disabled':''}>＋添加词条</button><details class="equipment-advanced"><summary>触发效果与符石</summary><label>触发效果 JSON<textarea data-equipment-effects="${index}" rows="3" ${disabled}>${esc(JSON.stringify(e.effects||[],null,2))}</textarea></label><label>符石物品编号（逗号分隔）<input data-equipment-fragments="${index}" value="${esc((e.fragments||[]).join(','))}" ${disabled}></label><button class="text-button" data-apply-equipment-advanced="${index}" ${disabled}>应用高级配置</button></details><button class="text-button remove-equipment" data-remove-equipment="${index}" ${disabled}>卸下装备</button></div></details>`;
  }
  function renderRoleEditor(role,container){
    if(!native(role))return false;
    const c=deps.getConfig(),side=deps.selected()?.side||'ally',f=getFormation(selectedFormation(c,side).id),panel=rolePanel(role),err=panelErrors.get(role.uid),busy=deps.busy()?'disabled':'';
    const activeSecrets=role.build.secrets||[],slots=Number(role.build.secretSlots??5);
    container.innerHTML=`<div class="editor-inner native-editor"><div class="native-character-heading"><h3>${esc(role.name)}</h3><span>原模型配置</span></div><p class="input-note">战前面板由培养、武学、阵法、装备与秘技计算。战斗中的触发增益另行结算。</p><div class="native-position-row"><label>等级<input id="nativeRoleLevel" type="number" min="1" max="100" value="${role.level}" ${busy}></label><label>站位<select id="nativePosition" ${busy}>${f.allowedSlots.map(stand=>{const occupied=c.teams[side].find(r=>r.uid!==role.uid&&r.position===stand-1),slot=f.slots.find(s=>s.stand===stand);return `<option value="${stand-1}" ${role.position===stand-1?'selected':''} ${occupied?'disabled':''}>${stand} · ${esc(slot?.geometryLabel||slot?.label||'')}${f.eyeSlots.includes(stand)?' · 阵眼':''}${occupied?' · '+esc(occupied.name):''}</option>`;}).join('')}</select></label></div><div class="editor-skill-section">${deps.skillFields(role)}</div><section class="native-panel-preview" aria-live="polite"><div class="editor-subheading">原模型战前面板 <small>${panel?'已重算':err?'配置待修正':'重算中…'}</small></div>${err?`<p class="model-error">${esc(err)}</p>`:panel?`<dl class="native-panel-grid">${Object.entries(panelNames).map(([k,n])=>`<div><dt>${n}</dt><dd>${fmt(panel.stats[k])}</dd></div>`).join('')}</dl>`:'<p class="input-note">正在读取原模型计算结果…</p>'}</section><section class="native-equipment-section"><div class="editor-subheading">装备与词条 <small>数值进入原模型</small></div>${(role.build.equipment||[]).map((e,i)=>equipmentControl(role,e,i)).join('')}<div class="add-equipment-row"><select id="newEquipmentSlot" ${busy} aria-label="新装备槽"><option value="1">武器</option><option value="5">腰带</option><option value="6">护腕</option><option value="7">衣甲</option><option value="8">戒指</option><option value="9">挂坠</option></select><button class="text-button" id="addEquipment" ${busy}>＋装备</button></div><p class="input-note">百分比词条按百分数填写，例如6表示6%。触发效果和符石可在高级项中配置。</p></section><section class="native-secrets-section"><div class="editor-subheading">秘技 <small>检查角色、武器及互斥</small></div><label class="secret-slots-label">已解锁槽位<input id="nativeSecretSlots" type="number" min="1" max="5" value="${slots}" ${busy}></label>${Array.from({length:Math.max(slots,activeSecrets.length)},(_,i)=>{const current=activeSecrets[i]||{};return `<div class="secret-row"><label class="sr-only" for="secret-${i}">第${i+1}槽秘技</label><span>${i+1}</span><select id="secret-${i}" data-secret-id="${i}" ${busy}><option value="">空槽</option>${secrets.map(s=>`<option value="${s.id}" ${Number(s.id)===Number(current.id)?'selected':''}>${esc(s.name)} · ${s.id}</option>`).join('')}</select><input data-secret-level="${i}" aria-label="第${i+1}槽秘技等级" type="number" min="1" max="${secretById(current.id)?.maxLevel||300}" value="${current.level||300}" ${busy||!current.id?'disabled':''}></div>`;}).join('')}${panel?`<p class="input-note active-secret-note">当前有效秘技：${(panel.activeSecretIds||[]).map(id=>esc(secretById(id)?.name||id)).join('、')||'无'}。条件触发效果仍以战斗为准。</p>`:''}<p class="input-note">预设按满培养假设配置；装备或武学改变后，不合法秘技会提示，不能静默计入面板。</p></section><button class="remove-role" id="nativeRemoveRole" ${busy}>移出阵容</button></div>`;
    deps.bindSkillFields(role,container);
    container.querySelector('#nativeRoleLevel').onchange=e=>editRole(role,r=>r.level=finite(e.target.value,'角色等级',1,100));
    container.querySelector('#nativePosition').onchange=e=>{const p=Number(e.target.value);if(canMove(side,p))editRole(role,r=>r.position=p);};
    container.querySelector('#nativeSecretSlots').onchange=e=>editRole(role,r=>r.build.secretSlots=finite(e.target.value,'槽位',1,5));
    container.querySelectorAll('[data-secret-id]').forEach(el=>el.onchange=()=>editRole(role,r=>{const i=Number(el.dataset.secretId),id=Number(el.value);if(!id)r.build.secrets.splice(i,1);else r.build.secrets[i]={id,level:r.build.secrets[i]?.level||300};r.build.secrets=r.build.secrets.filter(Boolean);}));
    container.querySelectorAll('[data-secret-level]').forEach(el=>el.onchange=()=>editRole(role,r=>r.build.secrets[Number(el.dataset.secretLevel)].level=finite(el.value,'秘技等级',1,300)));
    container.querySelectorAll('[data-equipment-template]').forEach(el=>el.onchange=async()=>{try{const index=Number(el.dataset.equipmentTemplate),item=await model.createEquipmentFromTemplate(Number(el.value));editRole(role,r=>r.build.equipment[index]=item);}catch(error){deps.toast(error.message);renderRoleEditor(role,container);}});
    for(const [attr,field]of [['equipmentLevel','level'],['equipmentColor','color']])container.querySelectorAll(`[data-${attr.replace(/[A-Z]/g,m=>'-'+m.toLowerCase())}]`).forEach(el=>el.onchange=()=>editRole(role,r=>r.build.equipment[Number(el.dataset[attr])][field]=finite(el.value,field,0,100)));
    container.querySelectorAll('[data-equipment-base]').forEach(el=>el.onchange=()=>editRole(role,r=>r.build.equipment[Number(el.dataset.equipmentBase)].base[el.dataset.key]=finite(el.value,baseNames[el.dataset.key])));
    container.querySelectorAll('[data-affix-id]').forEach(el=>el.onchange=()=>editRole(role,r=>{const [i,j]=el.dataset.affixId.split(':').map(Number);r.build.equipment[i].affixes[j]={id:el.value,value:0,source:r.build.equipment[i].affixes[j].source||'extra'};}));
    container.querySelectorAll('[data-affix-value]').forEach(el=>el.onchange=()=>editRole(role,r=>{const [i,j]=el.dataset.affixValue.split(':').map(Number),a=r.build.equipment[i].affixes[j];a.value=finite(el.value,'词条')/(ratio(affixById(a.id))?100:1);}));
    container.querySelectorAll('[data-affix-source]').forEach(el=>el.onchange=()=>editRole(role,r=>{const [i,j]=el.dataset.affixSource.split(':').map(Number);r.build.equipment[i].affixes[j].source=el.value;}));
    container.querySelectorAll('[data-remove-affix]').forEach(el=>el.onclick=()=>editRole(role,r=>{const [i,j]=el.dataset.removeAffix.split(':').map(Number);r.build.equipment[i].affixes.splice(j,1);}));
    container.querySelectorAll('[data-add-affix]').forEach(el=>el.onclick=()=>editRole(role,r=>{const e=r.build.equipment[Number(el.dataset.addAffix)];e.affixes=[...(e.affixes||[]),{id:affixes[0].id,value:0,source:'extra'}];}));
    container.querySelectorAll('[data-remove-equipment]').forEach(el=>el.onclick=()=>editRole(role,r=>r.build.equipment.splice(Number(el.dataset.removeEquipment),1)));
    container.querySelectorAll('[data-apply-equipment-advanced]').forEach(el=>el.onclick=()=>editRole(role,r=>{const i=Number(el.dataset.applyEquipmentAdvanced),effects=JSON.parse(container.querySelector(`[data-equipment-effects="${i}"]`).value),fragments=container.querySelector(`[data-equipment-fragments="${i}"]`).value.trim();rejectReserved(effects);r.build.equipment[i].effects=effects;r.build.equipment[i].fragments=fragments?fragments.split(',').map(v=>finite(v.trim(),'符石编号',1,1e9)):[];}));
    container.querySelector('#addEquipment').onclick=async()=>{try{const chosen=Number(container.querySelector('#newEquipmentSlot').value),type=chosen===1?(deps.weaponType?.(role)||1):chosen,candidate=equipment.find(e=>Number(e.type)===type);if(!candidate)throw Error('此装备槽没有可用模板。');const item=await model.createEquipmentFromTemplate(Number(candidate.id));editRole(role,r=>r.build.equipment.push(item));}catch(error){deps.toast(error.message);}};
    container.querySelector('#nativeRemoveRole').onclick=()=>{deps.removeRole(side,role.uid);};
    return true;
  }
  async function ensurePanels(c=deps.getConfig()){
    const token=++revision;pending=true;deps.updateButtons();
    try{
      const errors=[];
      for(const side of ['ally','enemy'])for(const row of c.teams[side]){
        if(!native(row))continue;
        const key=fingerprint(row);if(panelCache.get(row.uid)?.key===key){panelErrors.delete(row.uid);continue;}
        try{const task=inspectionQueue.then(()=>model.inspectEditorRole(clone(row)));inspectionQueue=task.catch(()=>{});const panel=await task;if(token!==revision||disposed)return false;panelCache.set(row.uid,{key,panel});panelErrors.delete(row.uid);}
        catch(error){if(token!==revision||disposed)return false;panelErrors.set(row.uid,error.message);errors.push(`${sideName(side)}${row.name}：${error.message}`);}
      }
      if(errors.length)throw Error(errors.join('；'));
      return true;
    }finally{if(token===revision&&!disposed){pending=false;deps.panelsChanged();}}
  }
  function changed(){clearTimeout(timer);++revision;pending=true;const ids=new Set(['ally','enemy'].flatMap(s=>deps.getConfig().teams[s].map(r=>r.uid)));for(const id of panelErrors.keys())if(!ids.has(id))panelErrors.delete(id);renderControls();timer=setTimeout(()=>void ensurePanels().catch(e=>deps.toast('面板重算未完成：'+e.message)),180);}
  function presentationConfig(c){const out=clone(c);for(const side of ['ally','enemy'])for(const row of out.teams[side])if(native(row))row.stats=clone(rolePanel(row)?.stats||fallback);return out;}
  const api={assets,formations,presets,isNativeRole:native,isNativeConfig,validateConfig:normalize,createDefault,loadTeam,renderControls,decorateBoard,canMove,renderRoleEditor,changed,ensurePanels,presentationConfig,getStats:r=>native(r)?(rolePanel(r)?.stats||fallback):r.stats,getPanel:rolePanel,getState:()=>({ready:true,pending,errors:[...panelErrors.entries()],presetCount:presets.length}),get pending(){return pending;},get hasErrors(){return panelErrors.size>0;},dispose(){disposed=true;clearTimeout(timer);++revision;}};
  renderControls();return api;
}
