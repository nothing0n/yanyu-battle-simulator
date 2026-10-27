import {firstResult,multi,LuaTable} from '../runtime/lua-vm.mjs';
/** Execute the original JHBaseGravity.onUpdate on a fixed 60 Hz host clock.
 * Native node access and action scheduling are sinks; no ballistic formula is used.
 */
export function createGravityPlanner(vm,bundle,{roleBundle}={}){
 vm.load(bundle,'presentation/JHBaseGravity');if(roleBundle)vm.load(roleBundle,'presentation/JHBaseRole.gravity');
 const method=(b,name,up=[])=>{const constants=b.prototypes[b.root||'root'].constants,at=constants.indexOf(name),id=constants[at-1]?.$proto;if(!id)throw Error('Missing original gravity method '+name);return vm.closure(b.prototypes[id],up);};
 const cls=vm.table({super:{ctor:()=>{}}}),ctor=method(bundle,'ctor',[cls]),update=method(bundle,'onUpdate');
 const setters=['setSpeedX','setSpeedY','setGravity','setDrag','setPauseGravity','setLandY','setSceneWidth','setForceZOrder','setState','setLandFunc','setTopHighFunc'];
 return {plan(capture,{point={x:0,y:0},basePoint=point,landY=basePoint.y,owner=null,dt=1/60,maxSeconds=5}={}){
  if(!capture||capture.vm!==vm)throw Error('Gravity requires the original impact runtimeCapture from the same VM');
  const originalEvents=capture.events.slice();if(!originalEvents.some(e=>e.method==='setSpeedY'&&e.args[0]!==0))return null;
  const actor=capture.actor,events=capture.events,initialLength=events.length,position={...point},samples=[],trace=[],queue=[];
  let now=0,landed=false,landAtMs=null,recording=false,cursor=events.length;
  const saved={cc:vm.globals.cc,jh:vm.globals.jh,add:vm.globals.JHAddDrawUpdate,stop:vm.globals.JHStopDrawUpdate};
  const serial=value=>value?.proto?{callback:value.proto.id}:value instanceof LuaTable?vm.unwrap(value):value;
  const emit=(method,args=[])=>{if(recording)trace.push({offsetMs:now*1000,method,args:args.map(serial)});};
  const actionEntries=a=>a instanceof LuaTable?[...a.entries.values()]:Array.isArray(a)?a:[a];
  function schedule(action,at=now){if(!action)return at;if(action.kind==='delay')return at+action.seconds;if(action.kind==='call'){queue.push({at,fn:action.fn});return at;}if(action.kind==='sequence'){for(const item of actionEntries(action.actions))at=schedule(item,at);return at;}if(action.kind==='shake'){emit('shake',action.args);return at;}throw Error('Unsupported original gravity callback action '+action.kind);}
  vm.globals.cc={Director:{getInstance:()=>({getScheduler:()=>({getTimeScale:()=>1})})},p:(x,y)=>vm.table({x,y}),c3b:(r,g,b)=>vm.table({r,g,b}),DelayTime:{create:(_,seconds)=>({kind:'delay',seconds})},CallFunc:{create:(_,fn)=>({kind:'call',fn})},Sequence:{create:(_,actions)=>({kind:'sequence',actions,setTag:()=>{}})}};
  vm.globals.jh={JHShake:{create:(_,...args)=>({kind:'shake',args})}};
  vm.globals.JHAddDrawUpdate=()=>1;vm.globals.JHStopDrawUpdate=()=>{};
  const native=(name)=>actor[name]=(_,...args)=>emit(name,args);
  try{
   vm.call(ctor,[actor,null]);
   actor.m_pBasePosition=vm.table(basePoint);actor.getPosition=()=>multi(position.x,position.y);actor.getPositionX=()=>position.x;actor.getPositionY=()=>position.y;
   actor.setPositionX=(_,x)=>{position.x=x;};actor.setPositionY=(_,y)=>{position.y=y;};actor.updateShadow=()=>{};
   for(const name of setters){const fn=method(bundle,name);actor[name]=(_,...args)=>{vm.call(fn,[actor,...args]);emit(name,args);};}
   for(const name of ['getState','getBasePosition','getLandY','getEnableZOrder','stopGravity','startGravity'])actor[name]=method(bundle,name);
   for(const name of ['clearTracks','stopMoveAcion','playMoveOn','playMoveNear','playBattleIdle','playDie','dieRemove','updateDieHeight','setHitRed','setHitBlue'])native(name);
   actor.runAction=(_,action)=>{schedule(action);return action;};actor.RootNode={runAction:(_,action)=>{schedule(action);return action;}};
   actor.playAnimationFromTo=(_,beginFrame,endFrame,name,loop)=>emit('playAnimationFromTo',[beginFrame,endFrame,name,loop]);
   actor.playAnimation=(_,name,loop)=>emit('playAnimation',[name,loop]);
   actor.setTimeScale=(_,value)=>emit('setTimeScale',[value]);
   if(roleBundle){const roleClass=vm.table({CommonAnimaiton:600});const dot=firstResult(vm.call(vm.globals.require,['app/excelutils/JHAtkDotUtils']));actor.playAnimationByExcel=method(roleBundle,'playAnimationByExcel',[roleClass,dot]);actor.beyondToBack=method(roleBundle,'beyondToBack');actor.tryDie=method(roleBundle,'tryDie');}
   else throw Error('Gravity landing requires the original JHBaseRole bundle');
   if(owner){const dataClass=firstResult(vm.call(vm.globals.require,['app/data/JHBattleData'])),model=firstResult(vm.call(vm.get(dataClass,'new'),[]));vm.call(vm.get(model,'initWithConver'),[model,vm.table(owner)]);for(const name of ['getStroyRemove','getDute'])if(vm.get(model,name))actor.Model[name]=()=>firstResult(vm.call(vm.get(model,name),[model]));}
   if(!actor.Model.getStroyRemove)throw Error('Gravity landing requires original owner/model getStroyRemove');
   vm.call(actor.setLandY,[actor,landY]);
   for(const e of originalEvents)if(setters.includes(e.method)&&!['setLandFunc','setTopHighFunc'].includes(e.method))vm.call(actor[e.method],[actor,...e.args]);
   const originalLand=capture.callbacks.land,originalTop=capture.callbacks.top;
   if(originalLand)vm.call(actor.setLandFunc,[actor,()=>{landed=true;landAtMs=now*1000;emit('land');return vm.call(originalLand,[]);}]);
   if(originalTop)vm.call(actor.setTopHighFunc,[actor,()=>{emit('top');return vm.call(originalTop,[]);}]);
   recording=true;
   // Replay the original initial animation request against the same exact host.
   for(const e of originalEvents)if(e.method==='playAnimationByExcel')vm.call(actor.playAnimationByExcel,[actor,...e.args]);
   const drain=()=>{while(cursor<events.length){const e=events[cursor++];trace.push({...e,offsetMs:now*1000});}};
   const take=()=>samples.push({offsetMs:now*1000,point:{...position},speedX:actor.m_fSpeedX,speedY:actor.m_fSpeedY,state:actor.m_nState,enableZOrder:firstResult(vm.call(actor.getEnableZOrder,[actor]))});take();drain();
   for(let frame=1;frame<=Math.ceil(maxSeconds/dt);frame++){
    now=frame*dt;
    vm.call(update,[actor,dt]);
    queue.sort((a,b)=>a.at-b.at);let budget=0;
    while(queue[0]?.at<=now+1e-10){if(++budget>100)throw Error('Original gravity callback queue did not converge');vm.call(queue.shift().fn,[]);queue.sort((a,b)=>a.at-b.at);}
    drain();take();
    if(landed&&!queue.length&&actor.m_fSpeedY===0)break;
   }
   if(!landed)throw Error('Original gravity did not land within host duration');
   return {samples,events:trace,durationMs:now*1000,landAtMs,landed,finalPoint:{...position},finalState:actor.m_nState,source:{module:'JHBaseGravity',method:'onUpdate',prototype:update.proto.id,dtSeconds:dt,schedulerTimeScale:1,timeSpeed:vm.globals.JH_TIME_SPEED,landingCallback:originalLand?.proto.id}};
  }finally{events.length=initialLength;vm.globals.cc=saved.cc;vm.globals.jh=saved.jh;vm.globals.JHAddDrawUpdate=saved.add;vm.globals.JHStopDrawUpdate=saved.stop;}
 }};
}
