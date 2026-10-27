import {firstResult,multi,LuaTable} from '../runtime/lua-vm.mjs';
import {luaToJSON} from '../engine/battle-runner.mjs';
/** Run the original movement bytecode against a recording Cocos host. */
export function createMotionPlanner(runtime,bundle,rules,reactionResolver){
 const{vm}=runtime,noop=()=>{},root=bundle.prototypes.root;
 const proto=name=>bundle.prototypes[root.constants[root.constants.indexOf(name)-1].$proto];
 const cls=vm.table({MoveAction:900,MoveAnimation:901}),moveOn=vm.closure(proto('playMoveOn'),[cls,vm.table({})]),moveBack=vm.closure(proto('playMoveBack'),[cls]);
 const hurtPosition=vm.closure(proto('getHurtPosition')),addPosition=vm.closure(proto('getAddPosition'));
 const center=rules.formation.center;
 function pointFor(owner){const p=rules.formation.positions.find(x=>x.stand===owner.Stand);if(!p)throw Error('Unknown original formation stand '+owner.Stand);return{x:center.x+(owner.left?-p.offsetX:p.offsetX),y:center.y+p.offsetY};}
 function planMotion(message,actorData,targetData,phaseCallback){
  const previousCC=vm.globals.cc,graphs=[],moves=[],animations=[],effects=[],opacity=[];let localTime=0;
  const point={...(actorData.point||pointFor(actorData.owner))},base=pointFor(actorData.owner),originalFrom={...point};
  const numberPoint=(x,y)=>x instanceof LuaTable?{x:vm.get(x,'x'),y:vm.get(x,'y')}:typeof x==='object'?{x:x.x,y:x.y}:{x,y};
  const tagged=(kind,extra={})=>({kind,...extra,setTag:noop});
  const cc={p:(x,y)=>vm.table(numberPoint(x,y)),CallFunc:{create:(_,fn)=>tagged('call',{fn})},DelayTime:{create:(_,seconds)=>tagged('delay',{seconds})},Sequence:{create:(_,actions)=>tagged('sequence',{actions})},Spawn:{create:(_,actions)=>tagged('spawn',{actions})},MoveTo:{create:(_,seconds,to)=>tagged('move',{seconds,to:numberPoint(to)})},MoveBy:{create:(_,seconds,to)=>tagged('moveBy',{seconds,to:numberPoint(to)})},EaseSineOut:{create:(_,action)=>tagged('ease',{easing:'sineOut',action})},EaseSineIn:{create:(_,action)=>tagged('ease',{easing:'sineIn',action})},JumpTo:{create:(_,seconds,to,height,jumps)=>tagged('move',{seconds,to:numberPoint(to),height,jumps})},FadeIn:{create:(_,seconds)=>tagged('fade',{seconds,to:1})},FadeOut:{create:(_,seconds)=>tagged('fade',{seconds,to:0})},Hide:{create:()=>tagged('visibility',{visible:false})},Show:{create:()=>tagged('visibility',{visible:true})}};
  vm.globals.cc=cc;
  const makeNode=(data,current)=>({m_pBasePosition:vm.table(pointFor(data.owner)),m_bIsFlipX:!data.owner.left,m_nMoreWidth:data.moreWidth??0,Model:{getLeft:()=>data.owner.left,getStand:()=>data.owner.Stand,getLookStand:()=>false},getPosition:()=>multi(current.x,current.y),getPositionX:()=>current.x,getPositionY:()=>current.y,getBasePosition:()=>vm.table(pointFor(data.owner)),setPosition:(_self,x,y)=>{const p=numberPoint(x,y);moves.push({offsetMs:localTime*1000,durationMs:0,from:{...current},to:p,teleport:true});Object.assign(current,p);},setOpacity:(_self,value)=>opacity.push({offsetMs:localTime*1000,durationMs:0,to:value/255}),setPositionY:(_self,y)=>{current.y=y;},stopMoveAcion:noop,stopGravity:noop,updateShadow:noop,isVisible:()=>true,setVisible:noop,playAttackOver:noop,setFlippedX:noop,setTimeScale:noop,playAnimationByExcel:(_self,name)=>animations.push({offsetMs:localTime*1000,name}),playSpineEffectFull:(_self,name)=>effects.push({offsetMs:localTime*1000,path:'effect/effect_'+name}),playMove:(_self,kind,seconds,returnIdle)=>{const plan=reactionResolver?.planMoveAnimations({...data.owner,Dute:data.dute??data.owner.Dute},kind,seconds,returnIdle);animations.push({offsetMs:localTime*1000,moveKind:kind,durationMs:seconds*1000,events:plan?.events});},runAction:(_self,graph)=>{graphs.push({at:localTime,graph});return graph;}});
  const node=makeNode(actorData,point);
  let destination;
  try{
   if(message.type==='skill_move'){
    // This prefix is the exact movement block of the original phase callback.
    // Stop before unrelated animation, damage and FX callbacks; no instructions are replaced.
    const prefix={...phaseCallback.proto,id:phaseCallback.proto.id+':movement-prefix',code:[...phaseCallback.proto.code.slice(0,287),0x0001004b]};
    Object.defineProperty(prefix,'_bundle',{value:phaseCallback.proto._bundle});
    vm.call(vm.closure(prefix,phaseCallback.upvalues.map((cell,i)=>i===3?node:cell)),[]);
   }else if(message.type==='move_back'){
    if(message.robot)throw Error('Original robot return path not yet bound');destination=base;vm.call(moveBack,[node,vm.table(destination),true,null]);
   }else if(message.type==='move_on'){
    const type=message.atktype||1;
    if(type===4)destination={...center};
    else{
     if(!targetData)throw Error('Move target was not created');
     const target=makeNode(targetData,targetData.point||pointFor(targetData.owner));
     if(type===9){const p=firstResult(vm.call(hurtPosition,[target,0]));destination={x:center.x,y:vm.get(p,'y')};}
     else if([1,2,3,6,15].includes(type))destination=luaToJSON(firstResult(vm.call(actorData.owner.left===targetData.owner.left?addPosition:hurtPosition,[target,0])));
     else throw Error('Original move target placement not yet bound for attack type '+type);
    }
    vm.call(moveOn,[node,vm.table(destination),false,message.high??0,null,message.robot?7999:type]);
   }else throw Error('Original movement message not yet bound: '+message.type);
   const walk=(action,at,easing)=>{
    localTime=at;
    if(action.kind==='delay')return at+action.seconds;
    if(action.kind==='call'){vm.call(action.fn,[]);return at;}
    if(action.kind==='ease')return walk(action.action,at,action.easing);
    if(action.kind==='move'||action.kind==='moveBy'){
     const to=action.kind==='moveBy'?{x:point.x+action.to.x,y:point.y+action.to.y}:action.to;
     moves.push({offsetMs:at*1000,durationMs:action.seconds*1000,from:{...point},to,easing:easing||'linear',height:action.height,jumps:action.jumps});Object.assign(point,to);return at+action.seconds;
    }
    if(action.kind==='sequence'){for(const[,child]of action.actions.entries)at=walk(child,at,easing);return at;}
    if(action.kind==='spawn'){let end=at;for(const[,child]of action.actions.entries)end=Math.max(end,walk(child,at,easing));return end;}
    if(action.kind==='fade'){opacity.push({offsetMs:at*1000,durationMs:action.seconds*1000,to:action.to});return at+action.seconds;}
    if(action.kind==='visibility')return at;
    throw Error('Unsupported original Cocos motion '+action.kind);
   };
   let duration=0;for(let i=0;i<graphs.length;i++){if(i>100)throw Error('Movement graph exceeded bounded queue');duration=Math.max(duration,walk(graphs[i].graph,graphs[i].at));}
   return{from:originalFrom,to:{...point},durationMs:duration*1000,segments:moves,animations,effects,opacity,source:'Original JHBaseRole.'+(message.type==='skill_move'?'playZhaoShi phase movement block':message.type==='move_back'?'playMoveBack':'playMoveOn')};
  }finally{vm.globals.cc=previousCC;}
 }
 return {planMotion,pointFor,planPhaseMotion:(fn,actor)=>planMotion({type:'skill_move'},actor,null,fn)};
}
