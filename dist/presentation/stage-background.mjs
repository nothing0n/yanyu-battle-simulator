/** Original decoded TMX layers and objects in the stage's Cocos y-up world.
 * Camera layer placement follows JHBattleCamera initBackground (pc110-198),
 * initFrontground (pc12-66), and updateBackground (pc63-83).
 */
const BASE=new URL('../',import.meta.url);
const number=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const pair=(value,fallback)=>value?[number(value[1]),number(value[2])]:fallback;
const FLAGS=0xe0000000,ID_MASK=0x1fffffff;

export function visibleAtTime(type='',timeOfDay='day') {
 const values=String(type).split('|'),head=values[0];
 if(!['all','day','night','qianye','houye','work'].includes(head))return true;
 if(head==='all')return true;
 if(head==='night')return timeOfDay!=='day';
 return head===timeOfDay;
}
export function cameraLayerOffset(mapSize,contentSize,parallaxSize,{x=0.5,y=0}={}) {
 return {x:Math.floor(parallaxSize[0]/2+(mapSize[0]-parallaxSize[0])*x)-contentSize[0]/2,
         y:Math.floor((mapSize[1]-parallaxSize[1])*y)};
}

export async function loadStageBackground(assets,options={}) {
 const readJSON=options.readJSON||(async url=>{const r=await fetch(url);if(!r.ok)throw Error(`Background resource ${r.status}: ${url}`);return r.json();});
 const loadImage=options.loadImage||(async url=>{const image=new Image();image.src=String(url);await image.decode();return image;});
 const configs=options.configs||await readJSON(new URL('data/presentation-backgrounds.json',BASE));
 const location=String(options.location??options.backgroundKey??10).replace(/^battleground_/,''),cfg=configs.backgrounds[location];
 if(!cfg)throw new Error(`Original background configuration missing: ${location}`);
 const key=`battleground_${location}`,map=assets.backgrounds[key];if(!map?.decoded)throw new Error(`Decoded original TMX missing: ${key}`);
 const mapSize=pair(cfg.back1,[number(map.attributes.width)*number(map.attributes.tilewidth),number(map.attributes.height)*number(map.attributes.tileheight)]);
 const images=new Map(),tilesets=[...map.tilesets].sort((a,b)=>number(a.attributes.firstgid)-number(b.attributes.firstgid));
 function tile(gid){gid=(number(gid)>>>0)&ID_MASK;return [...tilesets].reverse().find(t=>number(t.attributes.firstgid)<=gid);}
 const usedIds=new Set(map.layers.flatMap(layer=>layer.gids).filter(Boolean));
 for(const group of map.objects)if(group.attributes.name!=='ani')for(const object of group.objects)if(object.attributes.gid)usedIds.add(number(object.attributes.gid));
 await Promise.all([...new Set([...usedIds].map(id=>tile(id)?.image?.path).filter(Boolean))].map(async path=>images.set(path,await loadImage(new URL(path,BASE)))));
 const warnings=[];
 const animationObjects=(map.objects.find(g=>g.attributes.name==='ani')?.objects||[]).filter(o=>o.attributes.name&&visibleAtTime(o.attributes.type,options.timeOfDay||'day'));
 if(animationObjects.length)warnings.push(`${animationObjects.length} original ambient animation nodes require the Cocos/Spine ambient player.`);
 function geometry(gid,width,height){const raw=number(gid)>>>0,t=tile(raw),image=t&&images.get(t.image.path);if(!image)return null;
  const a=t.attributes,iw=number(t.image.attributes.width,image.width),tw=number(a.tilewidth,iw),th=number(a.tileheight,image.height),spacing=number(a.spacing),margin=number(a.margin),columns=number(a.columns,Math.floor((iw-margin*2+spacing)/(tw+spacing))),index=(raw&ID_MASK)-number(a.firstgid);
  return {image,sx:margin+(index%columns)*(tw+spacing),sy:margin+Math.floor(index/columns)*(th+spacing),sw:tw,sh:th,w:width||tw,h:height||th,flags:raw&FLAGS};
 }
 function drawTile(ctx,gid,x,y,width,height,view){const g=geometry(gid,width,height);if(!g)return;
  const s=view.scale,px=view.originX+(view.centerX-mapSize[0]/2+x)*s,py=view.originY-(y+g.h)*s;
  if(!g.flags){ctx.drawImage(g.image,g.sx,g.sy,g.sw,g.sh,px,py,g.w*s,g.h*s);return;}
  // Tiled orthogonal diagonal flip is an x/y swap before horizontal/vertical flips.
  const horizontal=!!(g.flags&0x80000000),vertical=!!(g.flags&0x40000000),diagonal=!!(g.flags&0x20000000);
  ctx.save();ctx.translate(px+g.w*s/2,py+g.h*s/2);ctx.scale(horizontal?-1:1,vertical?-1:1);if(diagonal)ctx.transform(0,1,1,0,0,0);
  ctx.drawImage(g.image,g.sx,g.sy,g.sw,g.sh,-(diagonal?g.h:g.w)*s/2,-(diagonal?g.w:g.h)*s/2,(diagonal?g.h:g.w)*s,(diagonal?g.w:g.h)*s);ctx.restore();
 }
 function viewOf(view){return {scale:view.scale??1,originX:view.originX??view.x??0,originY:view.originY??view.y??view.height,centerX:view.centerX??1024,width:view.width,height:view.height};}
 function offsetFor(name,view,camera){
  const content=pair(cfg[name],mapSize),screenWidth=camera.battleWidth??Math.min(view.width/view.scale,mapSize[0]),screenHeight=camera.battleHeight??Math.min(view.height/view.scale,mapSize[1]);
  let parallax=content;
  if(name==='sky')parallax=[screenWidth,screenHeight];
  else if(/^back[123]$/.test(name)){const depth=4-number(name.slice(4));parallax=[screenWidth+(mapSize[0]-screenWidth)*depth/3,screenHeight+(mapSize[1]-screenHeight)*depth/3];}
  return cameraLayerOffset(mapSize,content,parallax,{x:camera.ratioX??0.5,y:camera.ratioY??0});
 }
 function drawLayer(ctx,layer,view,camera){if(layer.attributes.visible==='0')return;const name=layer.attributes.name;if(!cfg[name])return;const offset=offsetFor(name,view,camera),cols=number(layer.attributes.width,1),rows=number(layer.attributes.height,1),tw=number(map.attributes.tilewidth),th=number(map.attributes.tileheight);ctx.save();ctx.globalAlpha*=number(layer.attributes.opacity,1);
  for(let i=0;i<layer.gids.length;i++)if(layer.gids[i])drawTile(ctx,layer.gids[i],offset.x+(i%cols)*tw,offset.y+(rows-Math.floor(i/cols)-1)*th,0,0,view);ctx.restore();
 }
 function drawObjects(ctx,name,view,camera){const group=map.objects.find(g=>g.attributes.name===name);if(!group||group.attributes.visible==='0')return;const offset=name==='front'?offsetFor(name,view,camera):{x:0,y:0},mapHeight=number(map.attributes.height)*number(map.attributes.tileheight);
  for(const object of group.objects){const a=object.attributes;if(!a.gid||a.visible==='0'||!visibleAtTime(a.type,camera.timeOfDay||'day'))continue;drawTile(ctx,a.gid,offset.x+number(a.x),offset.y+mapHeight-number(a.y),number(a.width),number(a.height),view);}
 }
 return {key,location:cfg.id,mapSize,center:{x:mapSize[0]/2,y:200},config:cfg,map,images,warnings,
  drawBack(ctx,view,camera={}){view=viewOf(view);const names=['sky','back3','back2','back1'];for(const name of names)for(const layer of map.layers)if(layer.attributes.name===name)drawLayer(ctx,layer,view,camera);drawObjects(ctx,'pic',view,camera);},
  drawFront(ctx,view,camera={}){drawObjects(ctx,'front',viewOf(view),camera);},
  draw(ctx,view,camera={}){this.drawBack(ctx,view,camera);this.drawFront(ctx,view,camera);},
  metadata:{sourceDerived:true,nativeVisualParityValidated:false,defaultTimeOfDay:'day',unsupported:['night mask/light shader','ambient Spine/Cocos animation playback']}
 };
}
