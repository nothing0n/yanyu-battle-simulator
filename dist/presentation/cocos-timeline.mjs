const types={Position:{X:'x',Y:'y'},Scale:{ScaleX:'scaleX',ScaleY:'scaleY'},Alpha:{Alpha:'opacity'},RotationSkew:{SkewX:'rotationX',SkewY:'rotationY'},FileData:{TextureName:'spriteFrame'},BlendFunc:{}};
/** Pure evaluation of the original Cocos Studio keyframes. Frame indexes are
 * integer native ActionTimeline ticks; no easing approximation is substituted. */
export function sampleCocosFrame(asset,frame){
 const nodes=Object.fromEntries(asset.nodes.map(n=>{
  const p=n.initial||{};
  return[n.id,{id:n.id,parent:n.parent,type:n.type,spriteFrame:n.spriteFrame,x:p.Position?.[0]??0,y:p.Position?.[1]??0,scaleX:p.ScaleX??1,scaleY:p.ScaleY??1,rotationX:p.RotationSkewX??0,rotationY:p.RotationSkewY??0,opacity:p.Opacity??255,visible:p.Visible??true}];
 }));
 for(const timeline of asset.timelines){
  const mapping=types[timeline.type];if(!mapping)throw Error('Unsupported Cocos timeline '+timeline.type);
  const keys=timeline.frames;if(!keys.length)continue;
  let i=0;while(i+1<keys.length&&keys[i+1].FrameIndex<=frame)i++;
  const a=keys[i],b=keys[i+1],node=nodes[timeline.node];
  if(!node)throw Error('Missing timeline target '+timeline.node);
  const ratio=a.Tween&&b?Math.max(0,Math.min(1,(frame-a.FrameIndex)/(b.FrameIndex-a.FrameIndex))):0;
  if(ratio&&a.TweenType!=null&&a.TweenType!==0)throw Error('Unsupported original Cocos tween '+a.TweenType);
  for(const[from,to]of Object.entries(mapping)){
   const value=a[from];if(value==null)continue;
   node[to]=ratio&&typeof value==='number'&&typeof b?.[from]==='number'?value+(b[from]-value)*ratio:value;
  }
 }
 return Object.values(nodes);
}
export function sampleCocosTimeline(asset,timeMs,{animationName=null,loop=false,frameIntervalSeconds=0.01666666753590107,frame=null}={}){
 const clip=animationName?asset.animations.find(a=>a.name===animationName):null;
 if(animationName&&!clip)throw Error('Unknown original Cocos clip '+animationName);
 const start=clip?.startFrame??0,end=clip?.endFrame??asset.durationFrames,durationMs=(end-start)*frameIntervalSeconds/asset.timeSpeed*1000;
 const elapsed=Math.max(0,timeMs),localTime=loop&&durationMs?elapsed%durationMs:Math.min(elapsed,durationMs);
 const currentFrame=frame==null?(!loop&&elapsed>=durationMs?end:Math.min(end,start+Math.floor(localTime/1000*asset.timeSpeed/frameIntervalSeconds))):frame;
 return{frame:currentFrame,startFrame:start,endFrame:end,durationMs,finished:!loop&&elapsed>=durationMs,nodes:sampleCocosFrame(asset,currentFrame)};
}
export async function loadCocosTimelines({readJSON}={}){
 const read=readJSON||(async url=>{const r=await fetch(url);if(!r.ok)throw Error('Cannot load '+url);return r.json();});
 const data=await read(new URL('../data/cocos-timelines.json',import.meta.url));
 return{data,sample:(path,timeMs,options={})=>{
  const asset=data.assets[path];if(!asset)throw Error('Missing original Cocos asset '+path);
  return sampleCocosTimeline(asset,timeMs,{frameIntervalSeconds:data.frameIntervalSeconds,...options});
 }};
}
