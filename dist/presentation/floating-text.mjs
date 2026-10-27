import {LuaVM,LuaTable,LuaClosure,multi} from '../runtime/lua-vm.mjs';
import {AndroidIntegerRNG} from '../runtime/android-rng.mjs';

/** Match the LabelAtlas input resource to its decoded runtime font asset. */
export function resolveAtlasFont(assets,inputPath){
 return Object.values(assets.fonts).find(font=>font.inputPath===inputPath);
}

/** Execute original floating-label methods. RNG and per-role hurt index belong
 * to this presentation recorder, separate from battle result generation. */
export async function createFloatingTextRecorder({readJSON,visualSeed=1}={}){
 const read=readJSON||(async url=>{const r=await fetch(url);if(!r.ok)throw Error('Cannot load '+url);return r.json();});
 const [bundle,assets]=await Promise.all([read(new URL('./bundles/JHBaseRole.json',import.meta.url)),read(new URL('../data/presentation-assets.json',import.meta.url))]);
 const spriteFrames=new Map(Object.values(assets.spriteSheets).flatMap(sheet=>Object.entries(sheet.frames)));
 const vm=new LuaVM(),random=new AndroidIntegerRNG(visualSeed),indices=new Map();vm.load(bundle,'presentation/floating/JHBaseRole');
 const data=v=>v instanceof LuaClosure?{callback:v.proto.id}:v instanceof LuaTable?Array.from(v.entries.values(),data):Array.isArray(v)?v.map(data):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([,x])=>typeof x!=='function').map(([k,x])=>[k,data(x)])):v;
 let nodes=[],rng=[];
 function node(kind,info={}){
  const out={id:nodes.length,kind,...info,actions:[],children:[],position:[0,0]},obj={};
  for(const[m,key]of Object.entries({setAnchorPoint:'anchor',setScale:'scale',setOpacity:'opacity',setCascadeOpacityEnabled:'cascadeOpacity',setSpriteFrame:'spriteFrame'}))obj[m]=(_,v)=>{out[key]=data(v);};
  obj.setPosition=(_,x,y)=>{out.position=typeof x==='object'?[vm.get(x,'x'),vm.get(x,'y')]:[x,y];};
  obj.setPositionY=(_,y)=>{out.position[1]=y;};obj.getPositionY=()=>out.position[1];
  obj.addChild=(_,x)=>{out.children.push(x.__output);x.__output.parent=out.id;};
  obj.runAction=(_,x)=>{out.actions.push(data(x));};
  obj.setContentSize=(_,width,height)=>{out.contentSize=typeof width==='object'?{width:vm.get(width,'width'),height:vm.get(width,'height')}:{width,height};};
  obj.getContentSize=()=>out.contentSize||({width:(out.text?.length??0)*(out.cellWidth??0),height:out.cellHeight??0});
  const named=new Map();
  obj.getChildByName=(_,name)=>{if(!named.has(name)){const child=node('NamedChild',{name});named.set(name,child);obj.addChild(obj,child);}return named.get(name);};
  obj.__output=out;nodes.push(out);return obj;
 }
 vm.globals.math.random=(...args)=>{const result=random.random(...args);rng.push({args,result});return result;};
 vm.globals.string.gsub=(s,p,r)=>{if(p!=='-'&&p!=='+')throw Error('Unsupported floating-label Lua pattern '+p);return multi(s.split(p).join(r),s.split(p).length-1);};
 const cc={p:(x,y)=>({x,y})};
 // Cocos LabelAtlas accepts numeric Lua values and renders their string form.
 cc.LabelAtlas={_create:(_,text,path,cellWidth,cellHeight,start)=>node('LabelAtlas',{text:String(text),path,cellWidth,cellHeight,start})};
 cc.Node={create:()=>node('Node')};
 cc.Sprite={createWithSpriteFrameName:(_,name)=>{const frame=spriteFrames.get(name);if(!frame)throw Error('Unmapped original floating sprite '+name);return node('Sprite',{spriteFrame:name,contentSize:{width:frame.sourceSize[0],height:frame.sourceSize[1]}});}};
 for(const kind of ['Sequence','Spawn','FadeIn','FadeOut','FadeTo','ScaleTo','MoveBy','MoveTo','DelayTime','RemoveSelf','CallFunc'])cc[kind]={create:(_,...params)=>({kind,params:params.map(data)})};
 vm.globals.cc=cc;
 const studio={getNodeFromFile:(path)=>{const root=node('CocosStudio',{path}),timeline={kind:'CocosTimeline',path,gotoFrameAndPlay:(_,frame,loop)=>{root.__output.timeline={frame,loop};}};return multi(root,timeline);}};
 function record(method,args=[],{actorKey='default',flip=false,hurtIndex}={}){
  if(!['addHp','addMp','addNJHp','playMiss','playMissPo'].includes(method))throw Error('Unsupported floating-text method '+method);
  nodes=[];rng=[];const actor=node('Actor');
  Object.assign(actor,{m_bIsFlipX:flip,m_nHurtIndex:hurtIndex??indices.get(actorKey)??0});
  const before=actor.m_nHurtIndex;
  vm.run(bundle.prototypes[bundle.methods[method]],[actor,...args],method==='addMp'?[]:[studio]);
  indices.set(actorKey,actor.m_nHurtIndex);
  return{method,args,flip,hurtIndex:before,finalHurtIndex:actor.m_nHurtIndex,nodes,roots:actor.__output.children,rng,source:{...bundle.source,method,prototype:bundle.methods[method]}};
 }
 return{record,reset(seed=visualSeed){random.seed(seed);indices.clear();},source:bundle.source};
}

/** Sample the recorded Cocos node action graph; unsupported actions fail closed. */
export function sampleFloatingNode(node,timeMs){
 const initial={x:node.position[0],y:node.position[1],scale:node.scale??1,opacity:node.opacity??255,removed:false};
 const state={...initial},elapsed=Math.max(0,timeMs)/1000;
 function actions(action){return Array.isArray(action.params?.[0])?action.params[0]:action.params||[];}
 function duration(action){
  if(action.kind==='Sequence')return actions(action).reduce((n,a)=>n+duration(a),0);
  if(action.kind==='Spawn')return Math.max(0,...actions(action).map(duration));
  if(['FadeIn','FadeOut','FadeTo','ScaleTo','MoveBy','MoveTo','DelayTime'].includes(action.kind))return action.params[0];
  if(['RemoveSelf','CallFunc','CocosTimeline'].includes(action.kind))return 0;
  throw Error('Unsupported original label action '+action.kind);
 }
 function apply(action,t,target){
  const p=action.params||[],d=duration(action);
  if(action.kind==='Sequence'){let cursor=0;for(const a of actions(action)){if(t<cursor)break;apply(a,Math.min(t-cursor,duration(a)),target);cursor+=duration(a);}return;}
  if(action.kind==='Spawn'){for(const a of actions(action))apply(a,Math.min(t,duration(a)),target);return;}
  const ratio=d?Math.min(1,Math.max(0,t/d)):1;
  switch(action.kind){
   case 'FadeIn':target.opacity=255*ratio;break;
   case 'FadeOut':target.opacity*=1-ratio;break;
   case 'FadeTo':target.opacity+=(p[1]-target.opacity)*ratio;break;
   case 'ScaleTo':target.scale+=(p[1]-target.scale)*ratio;break;
   case 'MoveBy':target.x+=p[1].x*ratio;target.y+=p[1].y*ratio;break;
   case 'MoveTo':target.x+=(p[1].x-target.x)*ratio;target.y+=(p[1].y-target.y)*ratio;break;
   case 'RemoveSelf':target.removed=true;break;
   case 'CallFunc':if(!['root/120/0','root/122/0'].includes(p[0]?.callback))throw Error('Unbound label callback '+p[0]?.callback);target.removed=true;break;
   case 'DelayTime':case 'CocosTimeline':break;
  }
 }
 // Concurrent sequences animate disjoint channels after the fade-in finishes.
 for(const action of node.actions){if(action.kind==='CocosTimeline')continue;apply(action,elapsed,state);}
 return state;
}
