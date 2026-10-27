import {LuaVM,LuaTable,LuaClosure} from '../runtime/lua-vm.mjs';
import {AndroidIntegerRNG} from '../runtime/android-rng.mjs';
import {createReactionResolver} from './reactions.mjs';

/** Original JHBaseRole skill announcements and end-of-battle idle callback.
 * This presentation-only VM never reads or mutates the battle RNG.
 */
export async function createRoleAnnouncementRecorder({readJSON,visualSeed=1,reactionResolver}={}) {
 const read=readJSON||(async url=>{const response=await fetch(url);if(!response.ok)throw Error('Cannot load '+url);return response.json();});
 const bundle=await read(new URL('./bundles/JHBaseRole.json',import.meta.url));
 const vm=new LuaVM(),random=new AndroidIntegerRNG(visualSeed);vm.load(bundle,'presentation/announcements/JHBaseRole');
 let nodes=[],rng=[];
 const data=value=>value instanceof LuaClosure?{callback:value.proto.id}:value instanceof LuaTable?Array.from(value.entries.values(),data):Array.isArray(value)?value.map(data):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,item])=>typeof item!=='function').map(([key,item])=>[key,data(item)])):value;
 function node(kind,info={}){
  const output={id:nodes.length,kind,...info,position:[0,0],actions:[],children:[]};
  const object={__output:output};
  for(const [method,key]of Object.entries({setAnchorPoint:'anchor',setScale:'scale',setOpacity:'opacity',setCascadeOpacityEnabled:'cascadeOpacity',setTextColor:'color'}))object[method]=(_,value)=>{output[key]=data(value);};
  object.enableOutline=(_,color,width)=>{output.outline={color:data(color),width};};
  object.setPosition=(_,x,y)=>{output.position=typeof x==='object'?[vm.get(x,'x'),vm.get(x,'y')]:[x,y];};
  object.addChild=(_,child,zOrder)=>{output.children.push(child.__output);child.__output.parent=output.id;if(zOrder!=null)child.__output.zOrder=zOrder;};
  object.runAction=(_,action)=>{output.actions.push(data(action));};nodes.push(output);return object;
 }
 vm.globals.math.random=(...args)=>{const result=random.random(...args);rng.push({args,result});return result;};
 const cc={p:(x,y)=>({x,y}),c3b:(r,g,b)=>({r,g,b})};
 cc.Label={createWithTTF:(_,text,fontPath,fontSize)=>node('LabelTTF',{text,fontPath,fontSize})};
 for(const kind of ['Sequence','Spawn','FadeIn','FadeOut','FadeTo','ScaleTo','MoveBy','MoveTo','DelayTime','RemoveSelf'])cc[kind]={create:(_,...params)=>({kind,params:params.map(data)})};
 vm.globals.cc=cc;
 function recordSkillName(args=[],{flip=false,noBattleUI=false}={}){
  if(!Array.isArray(args))throw TypeError('Original addZSName arguments must be an array');
  nodes=[];rng=[];vm.globals.JH_NO_BATTLEUI=noBattleUI;const actor=node('Actor');actor.m_bIsFlipX=flip;
  const prototype=bundle.methods.addZSName;vm.run(bundle.prototypes[prototype],[actor,...args]);
  return{method:'addZSName',args:[...args],flip,nodes,roots:actor.__output.children,rng,source:{...bundle.source,method:'addZSName',prototype}};
 }
 let resolver=reactionResolver;
 async function recordVictory(owner={}){
  resolver ||=await createReactionResolver({readJSON:read,visualSeed});
  const calls=[];let reaction=null;
  const actor={playBattleIdle:()=>{reaction=resolver.resolveReactionAnimation(owner,'idle');calls.push({method:'playBattleIdle',reaction});}};
  const prototype=bundle.methods.playHappy;vm.run(bundle.prototypes[prototype],[actor]);
  return{method:'playHappy',calls,reaction,source:{...bundle.source,method:'playHappy',prototype}};
 }
 return{recordSkillName,recordVictory,reset(seed=visualSeed){random.seed(seed);},source:bundle.source};
}
