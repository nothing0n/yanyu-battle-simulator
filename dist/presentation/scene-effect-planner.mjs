import {LuaTable} from '../runtime/lua-vm.mjs';
/** Run the original Camera scene callback and playCenterSpine for the default
 * centerspine_down path. It keeps its independent Spine event and completion routes. */
export function createSceneEffectPlanner(runtime,bundle,rules){
 const {vm}=runtime,noop=()=>{},center=rules.formation.center;
 vm.load(bundle,'app/module/battle/JHBattleCamera');
 const centerSpine=vm.closure(bundle.prototypes['root/92']);let output=[];
 const point=(x,y)=>x instanceof LuaTable?{x:vm.get(x,'x'),y:vm.get(x,'y')}:typeof x==='object'?{x:x.x,y:x.y}:{x,y};
 const createSpine=(path)=>{const record={path,point:{x:0,y:0},anchor:'world',layer:'belowActors',scaleX:1,scaleY:1,timeScale:1,beginFrame:0,animationName:null,loop:false,zOrder:0,events:[],removeDelayMs:10};output.push(record);
  const node={record,RootNode:{addSpineEvent:(_s,callback)=>record.events.push({callback:callback.proto.id,implemented:true,route:'audio_'})},setPosition:(_s,x,y)=>record.point=point(x,y),getPositionY:()=>record.point.y,setScaleX:(_s,x)=>record.scaleX=x,getLocalZOrder:()=>record.zOrder,setLocalZOrder:(_s,z)=>record.zOrder=z,setName:(_s,name)=>record.name=name,setCallBack:(_s,fn)=>record.completionCallback=fn.proto.id,playAnimation:(_s,name,loop)=>{record.animationName=name;record.loop=!!loop;},removeFromParent:noop};return node;
 };
 const camera={m_bIsOpenBalck:false,m_tCenterCache:vm.table([]),m_ManRoad:{addChild:(_s,node,z)=>{if(z!==undefined)node.record.zOrder=z;}},getStandPosition:(_s,stand,left)=>{const p=rules.formation.positions.find(p=>p.stand===stand);if(!p)throw Error('Original center effect stand is not bound: '+stand);return vm.table({x:center.x+(left?-1:1)*p.offsetX,y:center.y+p.offsetY});},getContentSize:()=>vm.table({width:center.x*2,height:854}),removeCenterSpine:noop,playCenterSpine:(_s,...args)=>vm.call(centerSpine,[camera,...args])};
 const event=vm.closure(bundle.prototypes['root/136/8'],[camera]);
 return {plan(scene){if(scene.tag!=='centerspine_down')throw Error('Scene effect not bound: '+scene.tag);output=[];const previous=runtime.modules.get('app/module/spine/JHBaseSpine');runtime.modules.set('app/module/spine/JHBaseSpine',vm.table({new:createSpine}));
  try{vm.call(event,[vm.table({msg:scene})]);return output.map(item=>({...item,point:{...item.point},source:'Original JHBattleCamera root/136/8 → root/92'}));}
  finally{if(previous===undefined)runtime.modules.delete('app/module/spine/JHBaseSpine');else runtime.modules.set('app/module/spine/JHBaseSpine',previous);}
 }};
}
