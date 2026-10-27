import{LuaTable,multi,firstResult}from'../runtime/lua-vm.mjs';
/** Original updateBuffs/addBuffs/setDun against a persistent graphic recorder. */
export function createBuffPlanner(runtime,bundle,{otherBundle,assets,spines,pointFor}){
 const{vm}=runtime,roots=new Map();let now=0,serial=0;
 vm.globals.JH_SHOW_BUFF=true; // Explicit browser display preference; original addBuffs applies it.
 vm.load(otherBundle,'presentation/JHOtherUtils');
 const method=(b,n,uv=[])=>{const k=b.prototypes[b.root||'root'].constants,i=k.indexOf(n);return vm.closure(b.prototypes[k[i-1].$proto],uv);};
 const other={getBuffIcon:method(otherBundle,'getBuffIcon'),getNeijinBuffIcon:method(otherBundle,'getNeijinBuffIcon')};
 const update=method(bundle,'updateBuffs',[runtime.require('app/excelutils/JHNG_JUtils'),other,runtime.require('app/excelutils/JHBuffUtils')]),add=method(bundle,'addBuffs'),dun=method(bundle,'setDun'),loop=method(bundle,'playSpineEffectLoop'),centerLoop=method(bundle,'playSpineEffectLoopCenter');
 const frames=Object.assign({},...Object.values(assets.spriteSheets).map(s=>s.frames)),p=(x,y)=>x instanceof LuaTable?{x:vm.get(x,'x'),y:vm.get(x,'y')}:typeof x==='object'?x:{x,y};
 const clean=x=>JSON.parse(JSON.stringify(x));
 function node(kind,extra={}){
  const record={kind,position:{x:0,y:0},scale:1,visible:true,children:[],...extra},n={record};
  n.setPosition=(_,x,y)=>{record.position=p(x,y);};n.setScale=(_,value)=>{record.scale=value;};n.setVisible=(_,v)=>{record.visible=v;};n.isVisible=()=>record.visible;
  n.addChild=(_,child,z)=>{record.children.push(child.record);if(z!==undefined)child.record.zOrder=z;};n.removeAllChildren=()=>{record.children=[];};
  n.getContentSize=()=>{const f=frames[record.spriteFrame];if(!f)throw Error('Original sprite size unavailable: '+record.spriteFrame);return vm.table({width:f.sourceSize[0],height:f.sourceSize[1]});};n.enableOutline=(_,color,width)=>{record.outline={color:color instanceof LuaTable?Object.fromEntries(color.entries):color,width};};
  n.setColor=(_,color)=>{record.color=color instanceof LuaTable?Object.fromEntries(color.entries):color;};n.getPosition=()=>multi(record.position.x,record.position.y);
  n.setType=(_,value)=>record.type=value;n.setMidpoint=(_,value)=>record.midpoint=p(value);n.setBarChangeRate=(_,value)=>record.barChangeRate=p(value);n.setPercentage=(_,value)=>record.percentage=value;n.stopAllActions=()=>{record.actions=[];};n.runAction=(_,action)=>{record.actions=[action];};
  return n;
 }
 let current;
 function spine(path){
  const meta=spines.spines[path];if(!meta)throw Error('Original Buff Spine metadata unavailable: '+path);
  const n=node('Spine',{id:'buff-'+current._data.battleId+'-'+serial++,path,anchor:'actor',anchorBattleId:current._data.battleId,startedAtMs:now,animations:[],loop:true,flippedX:false});
  n.isHaveAnimation=(_,name)=>!!meta.animations[name];n.setFlippedX=(_,value)=>n.record.flippedX=!!value;n.setLocalZOrder=(_,value)=>n.record.zOrder=value;
  n.playAnimation=(_,name,loop)=>{n.record.animations=[{atMs:now,name,loop:!!loop,queued:false}];};n.addAnimation=(_,name,loop)=>n.record.animations.push({atMs:now,name,loop:!!loop,queued:true});n.removeFromParent=()=>{n.record.removedAtMs=now;};n.runAction=(_,action)=>{n.record.actions=[action];let duration=0;for(const child of action.actions||[]){if(child.kind==='delay')duration+=child.seconds*1000;if(child.kind==='remove')n.record.removedAtMs=now+duration;}};
  current._effects.push(n);return n;
 }
 function planBuffState(data,atMs,{buffs=[],innerBuffs=[],shield}={}){
  now=atMs;const previous={cc:vm.globals.cc,require:vm.globals.require},frameCache={addSpriteFrames:()=>{},getSpriteFrame:(_,name)=>frames[name]?{name}:null};
  vm.globals.cc={Node:{create:()=>node('Node')},Sprite:{createWithSpriteFrameName:(_,name)=>{if(!frames[name])throw Error('Original Buff sprite missing: '+name);return node('Sprite',{spriteFrame:name});}},Label:{createWithTTF:(_,text,font,size)=>node('Label',{text,font,size})},SpriteFrameCache:{getInstance:()=>frameCache},ProgressTimer:{create:(_,sprite)=>node('ProgressTimer',{spriteFrame:sprite.record.spriteFrame})},PROGRESS_TIMER_TYPE_BAR:1,p:(x,y)=>vm.table({x,y}),c3b:(r,g,b)=>vm.table({r,g,b}),ProgressTo:{create:(_,seconds,percentage)=>({kind:'progress',seconds,percentage})},Sequence:{create:(_,actions)=>({kind:'sequence',actions:[...actions.entries.values()]})},Hide:{create:()=>({kind:'hide'})},DelayTime:{create:(_,seconds)=>({kind:'delay',seconds})},RemoveSelf:{create:()=>({kind:'remove'})}};
  vm.globals.require=name=>name==='app/module/spine/JHBaseSpine'?{new:spine}:previous.require(name);
  try{
   let actor=roots.get(data.battleId);
   if(!actor){actor={_data:data,_effects:[],m_nBaseHeight:data.roleHeight,m_bIsBattleIdle:true,Model:{}};actor.Model={getIsDie:()=>actor._data.hp<=0,getDute:()=>actor._data.dute,getNoName:()=>!!actor._data.owner.NoName,getLeft:()=>!!actor._data.owner.left,getStand:()=>actor._data.owner.Stand};
    actor.addChild=(_,child)=>{child.record.anchor='actor';};actor.addNodeToBone=(_,bone,child)=>{child.record.anchor='bone';child.record.bone=bone;};actor.getFlippedX=()=>!actor._data.owner.left;
    const parent={getParent:()=>parent,getStandPosition:(_,stand,left)=>vm.table(pointFor({Stand:stand,left})),m_ManRoad:{addChild:(_,child)=>{child.record.anchor='world';}}};actor.getParent=()=>parent;
    actor.playSpineEffectLoop=loop;actor.playSpineEffectLoopCenter=centerLoop;actor.toast=(_,delay,text)=>{actor._toasts.push({delay,text});};actor.playBattleIdle=()=>{actor._idle=true;};
    actor.setSpecialHpBar=(_,value)=>{actor._specialHpBar=value;};actor.setYinNi=(_,hidden,opacity)=>{actor._hidden={hidden,opacity};};actor.setDropWeapon=(_,value)=>{actor._drop=value;};actor.updateBlueState=()=>{};actor.isHaveBuff=(_,id)=>[...actor.m_Buffs.entries.values()].some(b=>vm.get(b,'id')===id);actor.m_HpBg=node('Node',{position:{x:0,y:data.roleHeight}});
    actor._toasts=[];current=actor;vm.call(add,[actor]);roots.set(data.battleId,actor);
   }
   current=actor;actor._data=data;actor._toasts=[];actor.m_Buffs=vm.table(buffs);actor.m_njBuffs=vm.table(innerBuffs);vm.call(update,[actor]);if(shield)vm.call(dun,[actor,shield.total||0,shield.dun||0]);
   const effectRows=actor._effects.filter(x=>x.record.removedAtMs===undefined||x.record.removedAtMs>now).map(n=>n.record);
   return clean({container:actor.m_BuffsNode.record,icons:actor.m_BuffsNode.record.children,effects:effectRows,shield:actor.m_DunBar?.record,flags:{blue:actor.m_bIsBlue,blueColor:actor.m_SpBlueColor,weaponDropped:actor.m_bIsDrop,hidden:actor._hidden,specialHpBar:actor._specialHpBar},toasts:actor._toasts,source:'Original JHBaseRole.addBuffs/updateBuffs/setDun'});
  }finally{vm.globals.cc=previous.cc;vm.globals.require=previous.require;}
 }
 return{planBuffState,reset:()=>{roots.clear();serial=0;}};
}
