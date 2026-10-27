/** Literal JHBaseRole.addShadow/updateShadow placement. The caller supplies the
 * original getRootX result and whether updateShadow's ground-lock argument is on.
 * The bitmap itself supplies its opacity; no procedural oval/fade is substituted.
 */
export function originalShadowPlacement({position,rootX=0,flippedX=false,useLandY=false,landY=position.y,dute=null},kidFrames={}){
 return {x:position.x+(flippedX?-rootX:rootX),y:useLandY?landY:position.y,scale:kidFrames.shadow?.[dute]??1,localZ:-10};
}
export async function createShadowRenderer(assets,options={}){
 const base=new URL('../',import.meta.url),sheet=assets.spriteSheets['common/common.plist'],frame=sheet?.frames['common/pic_shadow.png'];
 if(!frame)throw Error('Original common/pic_shadow.png sprite is missing');
 if(frame.rotated)throw Error('Unexpected rotated original shadow sprite');
 const readJSON=options.readJSON||(async url=>{const r=await fetch(url);if(!r.ok)throw Error('Cannot load original shadow rules');return r.json();});
 const loadImage=options.loadImage||(async url=>{const image=new Image();image.src=String(url);await image.decode();return image;});
 const [image,kidFrames]=await Promise.all([loadImage(new URL(sheet.image,base)),options.kidFrames||readJSON(new URL('presentation/kid-frames.json',base))]);
 return {source:'common/pic_shadow.png',frame,kidFrames,
  placement:state=>originalShadowPlacement(state,kidFrames),
  draw(ctx,state,view){const p=originalShadowPlacement(state,kidFrames),s=view.scale*p.scale,[sx,sy,sw,sh]=frame.rect,[ow,oh]=frame.sourceSize,[ox,oy]=frame.offset,originX=view.originX??view.x??0,originY=view.originY??view.y??view.height;
   const x=originX+p.x*view.scale+(ox-ow/2)*s,y=originY-p.y*view.scale+(-oy-oh/2)*s;
   ctx.drawImage(image,sx,sy,sw,sh,x,y,sw*s,sh*s);
  }
 };
}
