import {createRuntime} from '../engine/runtime.mjs';
import {createBattleRole} from '../integration/actors.mjs';
import {compileLiteral} from '../integration/lua-literal.mjs';
import {firstResult} from '../runtime/lua-vm.mjs';

/** Execute the shipped JHSpineRole appearance code. The only JS substitutions
 * below are native rendering calls, captured as a command list for Spine WebGL.
 */
export async function createAppearancePlanner(options={}) {
  const read=options.readJSON|| (async url=>{const response=await fetch(url);if(!response.ok)throw new Error(`外观资源读取失败 ${response.status}: ${url}`);return response.json();});
  const [runtime,bundle,slots,baseBundle]=await Promise.all([
    options.runtime||createRuntime({readJSON:read,seed:1}),
    read(new URL('./bundles/JHSpineRole.json',import.meta.url)),
    read(new URL('../data/spine-slots-typed.json',import.meta.url)),
    read(new URL('./bundles/JHBaseSpine.json',import.meta.url))
  ]);
  const {vm,callMethod,firstMethod}=runtime;
  vm.globals.loadstring=source=>compileLiteral(vm,source);
  runtime.require('app/ai/JHAIConfig');
  for(const [name,value] of Object.entries(slots))runtime.modules.set(name,vm.constant(value));
  let current=null;
  const capture=(op,args)=>{if(!current)throw new Error('Appearance recorder has no active actor');current.push({op,args:args.map(value=>vm.unwrap(value))});};
  // The superclass constructor creates the native scene node. No appearance
  // decisions are substituted: original getSpineFile/updateAlls choose them.
  runtime.modules.set('app/module/base/JHBaseNode',vm.table({ctor:()=>{}}));
  const baseClass=firstResult(vm.call(vm.load(baseBundle,'app/module/spine/JHBaseSpine'),[]));
  runtime.modules.set('app/module/spine/JHBaseGravity',vm.table({ctor:(self,path)=>{
    capture('baseModel',[path]);vm.call(vm.get(baseClass,'ctor'),[self,path]);
  }}));
  const createNativeNode=()=>vm.table({
    addSpineEvent:()=>{},registerSpineEventHandler:()=>{},setForce60:()=>{},setLocalZOrder:()=>{},removeFromParent:()=>{},
    setBoneScale:(_self,...args)=>capture('setBoneScale',args),setScale:(_self,...args)=>capture('rootScale',args)
  });
  vm.globals.jh=vm.table({JHSpineNode:{createBinaryOnce:createNativeNode,create:createNativeNode}});
  vm.globals.sp=vm.table({EventType:{ANIMATION_END:'ANIMATION_END'}});
  const cls=firstResult(vm.call(vm.load(bundle,'app/module/spine/JHSpineRole'),[]));
  vm.globals.s_jhData=vm.table({getIsHideQuan:()=>!!options.hideGauntlets});
  const nativeMethods=['addSlot','removeSlot','replaceParts','setBscColor','setBoneScale','removeBoneNode','setTimeScale','playAnimation','addNodeToBone','setVisible','setSlotBsc','setCascadeColorEnabled','setCascadeOpacityEnabled','addChild','updateRootScale'];
  const modelFromOwner=owner=>{
    const model=runtime.instantiate('app/data/JHBattleData');
    callMethod(model,'initWithConver',vm.table(owner));
    return model;
  };
  function selectWeapon(model,requested) {
    const active=[...(vm.get(model,'m_tTaolus')?.entries?.values()||[])].find(skill=>firstMethod(skill,'getActive'));
    const type=active?firstMethod(active,'getType'):null;
    let selected=requested,source=requested!=null?'user':'original-owner';
    if(selected==null&&type!=null){
      const candidates=[...runtime.configFor('play_equipment').entries.values()]
        .filter(cfg=>vm.get(cfg,'type')===type&&vm.get(cfg,'xx')&&!vm.get(cfg,'fitter'))
        .sort((a,b)=>vm.get(a,'id')-vm.get(b,'id'));
      const first=candidates[0];
      if(first){selected=vm.get(vm.get(first,'xx'),1);source='original-tournament-default';}
    }
    if(selected==null)selected=firstMethod(model,'getWeapon');
    const id=Number(selected),cfg=vm.get(runtime.configFor('xx_weapon'),String(id));
    if(requested==null&&!cfg)return {id:selected,type:null,source:'original-owner'};
    if(!Number.isInteger(id)||!cfg)throw new Error(`Unknown original weapon appearance: ${selected}`);
    if(requested!=null&&type!=null&&vm.get(cfg,'type')!==type)throw new Error(`Weapon appearance ${id} does not match active taolu type ${type}`);
    callMethod(model,'setWeapon',id);
    return {id,type:vm.get(cfg,'type'),source};
  }
  function record(model,appearance={}) {
    if(current)throw new Error('Concurrent appearance recording is not supported');
    const weapon=selectWeapon(model,appearance.weaponSkin);
    current=[];
    try {
      const actor=vm.table({class:cls});
      vm.call(vm.globals.setmetatable,[actor,vm.table({__index:cls})]);
      for(const name of nativeMethods)vm.set(actor,name,(_self,...args)=>capture(name,args));
      callMethod(actor,'ctor',model);
      const commands=current;
      const baseModel=commands.find(c=>c.op==='baseModel')?.args[0]||firstMethod(actor,'getSpineFile');
      const hidden=new Set(),added=new Set(),replacements=[],colors=[],boneScales=[];
      for(const c of commands){
        if(c.op==='removeSlot'){hidden.add(c.args[0]);added.delete(c.args[0]);}
        if(c.op==='addSlot'){hidden.delete(c.args[0]);added.add(c.args[0]);}
        if(c.op==='replaceParts')replacements.push({atlas:c.args[0],slot:c.args[1],sourceAttachment:c.args[2],targetRegion:c.args[3]});
        if(c.op==='setBscColor'||c.op==='setSlotBsc')colors.push({op:c.op,args:c.args});
        if(c.op==='setBoneScale')boneScales.push(c.args);
      }
      const modelRules={};
      for(const name of ['getBattleIdle','getBattleHited','getJob','getDute','getBattleStage'])if(vm.get(model,name))modelRules[name]=vm.unwrap(firstMethod(model,name));
      return {rootScale:vm.get(actor,'m_fRootScale'),modelRules,roleId:firstMethod(model,'getID'),weaponSkin:weapon.id,weaponType:weapon.type,weaponSkinSource:weapon.source,baseModel,skeleton:`assets/spine/${baseModel}.skel`,atlas:`assets/spine/${baseModel}.atlas`,replacements,hiddenSlots:[...hidden],addedSlots:[...added],colors,boneScales,commands,source:{module:'app/module/spine/JHSpineRole',sha256:bundle.source?.sha256,slotSource:'data/spine-slots-typed.json',nativeRenderingRecorded:true}};
    } finally {current=null;}
  }
  return {
    plan(ownerSnapshot,appearance={}){return record(modelFromOwner(ownerSnapshot),appearance);},
    async planConfig(input){const model=await createBattleRole(runtime,input,true,0);return record(model,{weaponSkin:input.weaponSkin});},
    planRoleId(id,appearance={}){const model=runtime.instantiate('app/data/JHBattleData');callMethod(model,'initWithID',Number(id));return record(model,appearance);},
    runtime
  };
}
