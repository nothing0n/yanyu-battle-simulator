import {LuaTable,multi} from '../runtime/lua-vm.mjs';
/** Original hit/parry feedback, including original full-Spine effect placement. */
export function createImpactEffectPlanner(vm,bundle){
 const methods=Object.fromEntries(['playHitSound','playParrySound','playHitEffect','playSpineEffectFull'].map(name=>[name,vm.closure(bundle.prototypes[bundle.methods[name]])]));
 function plan(presentationCalls=[],actorData={}){
  const owner=actorData.owner||{},point=actorData.point,records=[],sounds=[];
  const previousRequire=vm.globals.require,previousSound=vm.globals.JHPlayEffect,previousCC=vm.globals.cc;
  const numberPoint=(x,y)=>x instanceof LuaTable?{x:vm.get(x,'x'),y:vm.get(x,'y')}:typeof x==='object'?{x:x.x,y:x.y}:{x,y};
  const serial=a=>a?.kind==='sequence'?{kind:'sequence',actions:[...a.actions.entries.values()].map(serial)}:a?.kind==='call'?{kind:'call',callback:a.fn.proto.id}:a;
  const parent={addChild:(_,node)=>{node.record.anchor='world';}};
  function makeEffect(path,wave){
   const record={path,wave,anchor:'actor',anchorBattleId:owner.BattleID??actorData.battleId,point:{x:0,y:0},flippedX:false,timeScale:1,animationName:'animation',beginFrame:0,loop:false,events:[],motions:[],source:{module:'JHBaseRole',method:'playSpineEffectFull',prototype:bundle.methods.playSpineEffectFull}};
   const node={record,RootNode:{addSpineEvent:(_,fn)=>record.events.push({callback:fn.proto.id,kind:'audio',implemented:true})},setTimeScale:(_,v)=>record.timeScale=v,setFlippedX:(_,v)=>record.flippedX=!!v,
    setPosition:(_,x,y)=>record.point=numberPoint(x,y),setLocalZOrder:(_,v)=>record.zOrder=v,
    setCallBack:(_,fn)=>{node.completion=fn;record.completionCallback=fn.proto.id;},
    playAnimation:(_,name,loop)=>{record.animationName=name;record.loop=!!loop;},
    runAction:(_,a)=>{record.completionActions=serial(a);}
   };
   records.push(node);return node;
  }
  const actor={Model:{getBattleJob:()=>{if(owner.Job==null)throw Error('Impact sound requires original owner.Job');return owner.Job;}},m_tEffects:vm.table([]),
   getFlippedX:()=>{if(owner.left==null)throw Error('Impact effect requires original owner.left');return !owner.left;},
   getPosition:()=>{if(!point)throw Error('World effect requires actor point');return multi(point.x,point.y);},
   getLocalZOrder:()=>{if(actorData.zOrder==null)throw Error('World effect requires original local z-order');return actorData.zOrder;},
   getParent:()=>parent,addChild:(_,node)=>{node.record.anchor='actor';},
   playSpineEffectFull:methods.playSpineEffectFull
  };
  vm.globals.require=name=>name==='app/module/spine/JHBaseSpine'?{new:makeEffect}:previousRequire(name);
  vm.globals.JHPlayEffect=name=>{if(name!=null)sounds.push({name,source:'Original JHBaseRole hit/parry sound method'});};
  vm.globals.cc={...(previousCC||{}),DelayTime:{create:(_,seconds)=>({kind:'delay',seconds})},RemoveSelf:{create:()=>({kind:'remove'})},CallFunc:{create:(_,fn)=>({kind:'call',fn})},Sequence:{create:(_,actions)=>({kind:'sequence',actions})}};
  try{
   for(const call of presentationCalls)if(['playHitSound','playParrySound','playHitEffect'].includes(call.method))vm.call(methods[call.method],[actor,...(call.args||[])]);
   for(const node of records)if(node.completion)vm.call(node.completion,[]);
   return{effects:records.map(n=>n.record),sounds,source:{module:'JHBaseRole',methods:['playHitEffect','playHitSound','playParrySound','playSpineEffectFull']}};
  }finally{vm.globals.require=previousRequire;vm.globals.JHPlayEffect=previousSound;vm.globals.cc=previousCC;}
 }
 return{plan};
}