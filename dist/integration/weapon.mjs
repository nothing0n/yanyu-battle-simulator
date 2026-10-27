/** Web equipment input adapter. Uses the game's original equipment model and
 * type-only tournament weapon configuration; it does not replace combat methods.
 * The user's attack panel is already effective attack. weaponAtk is the weapon's
 * separately used base attack for original skill branches and defaults to zero.
 */
export function attachPanelWeapon(runtime, actor, {weaponAtk=0}={}) {
  const {vm,firstMethod,callMethod}=runtime;
  const attack=Number(weaponAtk);
  if(!Number.isFinite(attack)||attack<0||attack>1e9)throw new Error('武器基础攻击必须为 0–1000000000 的数值。');
  const taolus=vm.get(actor,'m_tTaolus');
  const active=[...(taolus?.entries?.values()||[])].find(skill=>firstMethod(skill,'getActive'));
  if(!active)return null;
  const weaponType=firstMethod(active,'getType');
  const candidates=[...runtime.configFor('play_equipment').entries.values()]
    .filter(cfg=>vm.get(cfg,'type')===weaponType && vm.get(cfg,'xx') && !vm.get(cfg,'fitter'))
    .sort((a,b)=>vm.get(a,'id')-vm.get(b,'id'));
  const cfg=candidates[0];
  if(!cfg)throw new Error(`原始赛制武器表缺少与武学类型 ${weaponType} 匹配的无附加属性武器。`);
  if(firstMethod(actor,'getEquipWeapon'))throw new Error('角色已装配武器，请先移除后再绑定面板武器。');
  // JHEquipData ctor initializes every equipment stat/extension container. Its
  // initWithID would pull the ordinary equipment table and add real item stats;
  // use the original play_equipment row instead, as the panel supplies numbers.
  const weapon=runtime.instantiate('app/data/JHEquipData');
  callMethod(weapon,'setID',vm.get(cfg,'id'));
  vm.set(weapon,'RootConfig',runtime.clone(cfg));
  vm.set(weapon,'EncryptConfig',runtime.clone(cfg));
  vm.set(weapon,'m_nAtk',attack);
  callMethod(actor,'addEquip',weapon);
  vm.set(weapon,'__webPanelWeapon',true);
  vm.set(actor,'__webWeaponAtk',attack);
  return weapon;
}
