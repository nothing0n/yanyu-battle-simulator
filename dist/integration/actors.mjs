import {attachPanelWeapon} from './weapon.mjs';
import {compileLiteral} from './lua-literal.mjs';
import {resolveSkillSelection,applySkillSelection} from './skill-selection.mjs';
/** Web input adapter. Combat methods, skills, buffs and AI remain original bytecode.
 * The entered statistics are an effective out-of-combat panel, not an equipment builder.
 */
export async function createBattleRole(runtime, input, left, index) {
  const {vm, instantiate, callMethod, firstMethod} = runtime;
  if(!vm.globals.loadstring)vm.globals.loadstring=source=>compileLiteral(vm,source);
  const number=(key,fallback,min=0,max=1e9)=>{
    const raw=input.stats?.[key]??fallback;
    const n=Number(raw);if(!Number.isFinite(n)||n<min||n>max)throw new Error(`角色 ${input.name||input.roleId} 的 ${key} 数值无效`);
    return n;
  };
  const roleId=Number(input.roleId),level=Number(input.level??90),position=Number(input.position??index);
  if(!Number.isInteger(position)||position<0||position>6)throw new Error('原始战斗仅支持 7 个阵位（配置 position 为 0–6）。');
  if(!Number.isInteger(roleId))throw new Error('必须选择原始配置中的角色。');
  if(!Number.isInteger(level)||level<1||level>100)throw new Error('角色等级必须为 1–100。');
  const cls=runtime.require('app/data/JHBattleData');
  const actor=vm.table({class:cls});
  vm.call(vm.globals.setmetatable,[actor,vm.table({__index:cls})]);
  // Panels already include their chosen equipment/passive numeric bonuses. Dynamic
  // combat modifiers still run in JHBattleData.getBattle* and getBattleAttackSkill.
  const bindings={getHp:['hp',18000],getAttack:['atk',4500],getDefence:['def',2500],getSpeed:['speed',700],getHit:['hit',1000],getDodge:['dodge',500],getParry:['parry',650],getMpFirst:['mp',30],getMpBack:['mpBack',10],getNeijin:['neijin',0],getGangqi:['gangqi',0],getBaseStr:['str',200],getBaseDex:['dex',200],getBaseCon:['con',200],getBaseInt:['int',200]};
  for(const [method,[field,fallback]] of Object.entries(bindings)){
    const value=number(field,fallback,field==='hp'?1:0);
    vm.set(actor,method,()=>value);
  }
  callMethod(actor,'ctor');
  callMethod(actor,'initWithID',roleId);
  callMethod(actor,'setLevel',level);
  callMethod(actor,'setType',roleId===10010?1:2);
  callMethod(actor,'setName',input.name||firstMethod(actor,'getName'));
  callMethod(actor,'clearWG');
  if(input.skillOptions!==undefined){
    if(!input.skillOptions||typeof input.skillOptions!=='object'||Array.isArray(input.skillOptions))throw new Error('skillOptions 须为对象。');
    for(const key of Object.keys(input.skillOptions)){
      if(!['wai','nei','qing'].includes(key))throw new Error(`未知武学选项栏：${key}`);
      if(!Number(input.skills?.[key]))throw new Error(`${key} 未选择武学，不能指定武学选项。`);
    }
  }
  for(const key of ['wai','nei','qing']){
    const id=Number(input.skills?.[key]);if(!id)continue;
    const selection=resolveSkillSelection(runtime,{key,id,options:input.skillOptions?.[key]});
    const skill=firstMethod(actor,'addWG',id);
    if(!skill)throw new Error(`原始角色模型无法装配武学 ${id}`);
    const chong=Number(input.skillLevels?.[key]??10);
    if(!Number.isInteger(chong)||chong<1||chong>10)throw new Error('当前配置器支持武学 1–10 重。');
    callMethod(skill,'setChong',chong);callMethod(skill,'setLevel',3);
    callMethod(actor,'setWGActive',skill,true);
    applySkillSelection(runtime,skill,selection,{actor,replaceZhaos:true});
  }
  attachPanelWeapon(runtime,actor,{weaponAtk:input.stats?.weaponAtk??0});
  // Role seed uses the original model's Random implementation after construction.
  vm.set(actor,'__RandSeed',Math.max(1,Math.trunc(Number(runtime.seed)||1)+index+(left?0:4)));
  callMethod(actor,'resetBattle');
  callMethod(actor,'setLeft',left);
  callMethod(actor,'setStand',position+1);
  callMethod(actor,'setAIOpen',true);
  vm.set(actor,'__webUid',String(input.uid||`${left?'ally':'enemy'}-${index}`));
  return actor;
}
