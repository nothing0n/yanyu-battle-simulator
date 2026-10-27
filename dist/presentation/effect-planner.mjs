import {multi,LuaTable} from '../runtime/lua-vm.mjs';
/** Executes the original JHBaseRole.playAttackEffect bytecode against a recording
 * Spine/Cocos host. Initial attachment, placement, flip and frame are original
 * branch results. Spine event callbacks are retained as explicit pending work. */
export function createEffectPlanner(runtime,bundle,{pointFor,center={x:1024,y:200}}={}) {
 const {vm}=runtime,noop=()=>{},mod=name=>runtime.require('app/excelutils/'+name),effects=[],diagnostics=[];
 const numberPoint=(x,y)=>x instanceof LuaTable?{x:vm.get(x,'x'),y:vm.get(x,'y')}:typeof x==='object'?{x:x.x,y:x.y}:{x,y};
 let activeActor,activeTargets,lastZBase=null;
 const parent={getParent:()=>parent,getContentSize:()=>vm.table({width:center.x*2,height:854}),addChild:(_self,node,z)=>{node.record.anchor='world';if(z!==undefined)node.record.zOrder=z;},getStandPosition:(_self,stand,left)=>vm.table(pointFor({Stand:stand,left})),addOther:noop,removeOther:noop};
 function role(data){
  const owner=data.owner||{},point=data.point||pointFor(owner),base=data.basePoint||pointFor(owner);
  const node={battleId:owner.BattleID,m_tEffects:vm.table([]),m_pBasePosition:vm.table(base),Model:{getWave:()=>!!(data.wave??owner.Wave),getLeft:()=>!!owner.left,getStand:()=>owner.Stand,getBattleHp:()=>data.hp,getIsDie:()=>false,getStroyRemove:()=>false},
   getParent:()=>parent,getPosition:()=>multi(point.x,point.y),getPositionX:()=>point.x,getPositionY:()=>point.y,getBasePosition:()=>vm.table(base),getFlippedX:()=>!owner.left,getLocalZOrder:()=>{lastZBase={battleId:owner.BattleID,value:data.zOrder??0,known:data.zOrder!==undefined};return lastZBase.value;},getRoleHeight:()=>{if(data.roleHeight===undefined)throw Error('Original target role height unavailable for anqi 3520 FX placement');return data.roleHeight;},addChild:(_self,effect,z)=>{effect.record.anchor='actor';effect.record.anchorBattleId=owner.BattleID;if(z!==undefined)effect.record.zOrder=z;},playAnimationFromTo:noop,stopMoveAcion:noop,setLandY:noop};return node;
 }
 function makeEffect(path,wave){
  const record={path,wave,anchor:'world',point:{x:0,y:0},flippedX:false,timeScale:1,animationName:'animation',beginFrame:0,loop:false,events:[],motions:[]};effects.push(record);
  const node={record,RootNode:{},setTimeScale:(_self,value)=>record.timeScale=value,setFlippedX:(_self,value)=>record.flippedX=!!value,setPosition:(_self,x,y)=>record.point=numberPoint(x,y),setLocalZOrder:(_self,z)=>{if(lastZBase&&!lastZBase.known&&z===lastZBase.value+2){record.relativeZ=2;record.relativeZBattleId=lastZBase.battleId;}else record.zOrder=z;lastZBase=null;},removeFromParent:noop,
   setCallBack:(_self,fn)=>record.completionCallback=fn.proto.id,addSpineEvent:(_self,fn)=>{record.events.push({callback:fn.proto.id,implemented:false});},playAnimationFrom:(_self,frame,name,loop)=>{record.beginFrame=frame;record.animationName=name;record.loop=!!loop;},playAnimation:(_self,name,loop)=>{record.animationName=name;record.loop=!!loop;},runAction:(_self,action)=>{record.motions.push(action);}};
  return node;
 }
 const original=vm.closure(bundle.prototypes['root/42'],[mod('JHAtkDotUtils'),{new:makeEffect},vm.table({}),mod('JHAnQiUtils'),mod('JHWGUtils')]);
 function planEffects(phase,actorData,targetsData=[],skillID){
  effects.length=0;diagnostics.length=0;lastZBase=null;activeActor=role(actorData);activeTargets=targetsData.map(role);if(!activeTargets.length)activeTargets=[activeActor];
  const previousString=vm.globals.string;vm.globals.string={...previousString,gsub:(text,pattern,replacement)=>{if(pattern!=='attack')throw Error('Unsupported original FX gsub pattern '+pattern);const parts=String(text).split(pattern);return multi(parts.join(replacement),parts.length-1);}};
  const previousCC=vm.globals.cc,tagged=(kind,extra={})=>({kind,...extra}),cc={...(previousCC||{}),p:(x,y)=>vm.table(numberPoint(x,y)),Sequence:{create:(_,actions)=>tagged('sequence',{actions})},MoveTo:{create:(_,seconds,to)=>tagged('move',{seconds,to:numberPoint(to)})},CallFunc:{create:(_,fn)=>tagged('call',{fn})},RemoveSelf:{create:()=>tagged('remove')}};vm.globals.cc=cc;
  const dispatch=phase.dispatch;
  const rawName=phase.animation||phase.animationName,special=['effect','effectfen','effectmore','effectcenter','effectsj'].includes(rawName),name=special?String(phase.effectVariant):rawName,variant=special?null:phase.effectVariant,placement=rawName==='effectfen'?666:rawName==='effectmore'?888:rawName==='effectcenter'?999:rawName==='effectsj'?333:phase.attackType;
  try{
   const invoke=targets=>vm.call(original,[activeActor,dispatch?.anqiID??phase.anqiID??null,dispatch?dispatch.name:name,dispatch?dispatch.variant:variant,dispatch?.timeScale??phase.timeScale,vm.table(targets),dispatch?.placement??placement,dispatch?.deltaMp??phase.deltaMp??0,dispatch?.deltaHp??phase.deltaHp??0,dispatch?.sourceHp??actorData.hp??0,dispatch?.skillID??skillID,dispatch?.lane??phase.lane??0,dispatch?.attackType??phase.attackType]);
   if(dispatch){const targetIds=dispatch.targetIds;const selected=targetIds?.length?activeTargets.filter(node=>targetIds.includes(node.battleId)):activeTargets;if(targetIds?.length&&selected.length!==new Set(targetIds).size)throw Error('Original FX target role not bound: '+targetIds.join(','));invoke(selected);}
   else if(rawName==='effectsj')for(const target of activeTargets)invoke([target]);else invoke(activeTargets);
   function actionJSON(action){if(action.kind==='sequence')return {kind:'sequence',actions:[...action.actions.entries].map(([,a])=>actionJSON(a))};if(action.kind==='call')return {kind:'call',callback:action.fn.proto.id};return {...action};}
   for(const effect of effects){effect.motions=effect.motions.map(actionJSON);if(effect.events.some(e=>e.callback==='root/42/3'))diagnostics.push(`Original FX hit/event callback requires Spine events: ${effect.path}`);}
   return {effects:effects.map(e=>({...e,point:{...e.point}})),diagnostics:[...new Set(diagnostics)],source:'Original JHBaseRole.playAttackEffect root/42'};
  }finally{vm.globals.cc=previousCC;vm.globals.string=previousString;}
 }
 return {planEffects};
}
