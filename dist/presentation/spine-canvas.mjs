export function readAtlas(text,path=''){
 const pages=[],regions=new Map();let page=null,region=null;
 for(const raw of text.replace(/\r/g,'').split('\n')){const line=raw.trim();if(!line){page=null;region=null;continue;}const colon=line.indexOf(':');if(!page){page={name:line,path:path.slice(0,path.lastIndexOf('/')+1)+line};pages.push(page);continue;}if(colon<0){region={name:line,page,rotate:false,offset:[0,0],orig:null};regions.set(line,region);continue;}const key=line.slice(0,colon),value=line.slice(colon+1).trim(),parts=value.split(',').map(x=>x.trim());const target=region||page;if(['size','xy','orig','offset','split','pad'].includes(key))target[key]=parts.map(Number);else if(key==='rotate')target.rotate=value==='true'||value==='90';else target[key]=value;}
 for(const region of regions.values()){region.orig ||=region.size;if(!region.size||!region.xy)throw new Error('Invalid atlas region '+region.name);}
 return {pages,regions};
}
const canvasFactory=(width,height)=>{if(typeof OffscreenCanvas!=='undefined')return new OffscreenCanvas(width,height);if(typeof document!=='undefined'){const c=document.createElement('canvas');c.width=width;c.height=height;return c;}throw new Error('Canvas image extraction is unavailable');};
export async function loadImage(url){const response=await fetch(url);if(!response.ok)throw new Error(`Image ${response.status}: ${url}`);const blob=await response.blob();if(typeof createImageBitmap==='function')return createImageBitmap(blob);return new Promise((resolve,reject)=>{const image=new Image(),src=URL.createObjectURL(blob);image.onload=()=>{URL.revokeObjectURL(src);resolve(image);};image.onerror=()=>{URL.revokeObjectURL(src);reject(new Error('Cannot decode image '+url));};image.src=src;});}
export class AtlasTextures{
 constructor(atlas,images,{makeCanvas=canvasFactory}={}){this.atlas=atlas;this.images=images;this.makeCanvas=makeCanvas;this.cache=new Map();}
 region(name){const region=this.atlas.regions.get(name);if(!region)return null;if(this.cache.has(name))return this.cache.get(name);const image=this.images.get(region.page.name);if(!image)throw new Error('Missing atlas page '+region.page.name);const[w,h]=region.size,[x,y]=region.xy,canvas=this.makeCanvas(w,h),ctx=canvas.getContext('2d');if(region.rotate){ctx.translate(0,h);ctx.rotate(-Math.PI/2);ctx.drawImage(image,x,y,h,w,0,0,h,w);}else ctx.drawImage(image,x,y,w,h,0,0,w,h);const result={...region,image:canvas,width:w,height:h};this.cache.set(name,result);return result;}
}
function triangle(ctx,image,xy,uv){const [x0,y0,x1,y1,x2,y2]=xy,[u0,v0,u1,v1,u2,v2]=uv,den=u0*(v1-v2)+u1*(v2-v0)+u2*(v0-v1);if(Math.abs(den)<1e-12)return;const a=(x0*(v1-v2)+x1*(v2-v0)+x2*(v0-v1))/den,b=(y0*(v1-v2)+y1*(v2-v0)+y2*(v0-v1))/den,c=(x0*(u2-u1)+x1*(u0-u2)+x2*(u1-u0))/den,d=(y0*(u2-u1)+y1*(u0-u2)+y2*(u1-u0))/den,e=(x0*(u1*v2-u2*v1)+x1*(u2*v0-u0*v2)+x2*(u0*v1-u1*v0))/den,f=(y0*(u1*v2-u2*v1)+y1*(u2*v0-u0*v2)+y2*(u0*v1-u1*v0))/den;ctx.save();const cx=(x0+x1+x2)/3,cy=(y0+y1+y2)/3,expand=(x,y)=>{const dx=x-cx,dy=y-cy,l=Math.hypot(dx,dy)||1;return[x+dx/l*.35,y+dy/l*.35];};const q0=expand(x0,y0),q1=expand(x1,y1),q2=expand(x2,y2);ctx.beginPath();ctx.moveTo(...q0);ctx.lineTo(...q1);ctx.lineTo(...q2);ctx.closePath();ctx.clip();ctx.transform(a,b,c,d,e,f);ctx.drawImage(image,0,0);ctx.restore();}
export function regionGeometry(attachment,region,bone){const a=attachment,w=a.width/region.orig[0]*a.scaleX,h=a.height/region.orig[1]*a.scaleY,x=-a.width/2*a.scaleX+region.offset[0]*w,y=-a.height/2*a.scaleY+region.offset[1]*h,r=a.rotation*Math.PI/180,co=Math.cos(r),si=Math.sin(r),out=[];for(const [lx,ly]of [[x,y],[x,y+region.height*h],[x+region.width*w,y+region.height*h],[x+region.width*w,y]]){const vx=co*lx-si*ly+a.x,vy=si*lx+co*ly+a.y;out.push(bone.a*vx+bone.b*vy+bone.wx,bone.c*vx+bone.d*vy+bone.wy);}return out;}
export function drawMesh(ctx,image,vertices,uvs,triangles){for(let i=0;i<triangles.length;i+=3){const xy=[],uv=[];for(let j=0;j<3;j++){const v=triangles[i+j];xy.push(vertices[v*2],vertices[v*2+1]);uv.push(uvs[v*2]*image.width,uvs[v*2+1]*image.height);}triangle(ctx,image,xy,uv);}}
export function drawSpinePose(ctx,pose,model,{alpha=1,appearance=null}={}){
 for(const index of pose.order){const slot=pose.slots[index];if(!slot?.attachment)continue;const a=pose.data.skins[0].slots[index]?.[slot.attachment];if(!a||![0,2,3].includes(a.type))continue;
  const replacement=model.replacements?.get(slot.name+'\0'+slot.attachment)||model.replacements?.get(slot.name+'\0'+a.name);if(model.hiddenSlots?.has(slot.name))continue;
  const region=replacement?replacement.atlas.region(replacement.region):model.baseAtlas.region(a.path||a.name);if(!region)throw new Error(`Missing visible Spine attachment ${slot.name}/${a.path||a.name}`);
  const color=slot.color,ac=a.color==null?1:(a.color&255)/255,isBsc=model.bscSlots?.has(slot.name);let texture=region.image,opacity;
  if(model.nativeGameRenderer){opacity=isBsc?alpha:color[3]*alpha;if(isBsc)texture=bscTexture(region.image,model.bsc||{b:1,s:1,c:1},model.baseAtlas.makeCanvas);}
  else{const rgb=color.slice(0,3).map((v,i)=>v*(a.color==null?1:((a.color>>>(24-i*8))&255)/255));texture=tintTexture(region.image,rgb,model.baseAtlas.makeCanvas);opacity=color[3]*ac*alpha;}
  if(opacity<=0.001)continue;ctx.save();ctx.globalAlpha*=opacity;ctx.globalCompositeOperation=['source-over','lighter','multiply','screen'][slot.blend]||'source-over';
  if(a.type===0){const xy=regionGeometry(a,region,pose.bones[slot.bone]);ctx.transform((xy[4]-xy[2])/texture.width,(xy[5]-xy[3])/texture.width,(xy[0]-xy[2])/texture.height,(xy[1]-xy[3])/texture.height,xy[2],xy[3]);ctx.drawImage(texture,0,0);}
  else{const vertices=model.worldVertices(pose,a,index);drawMesh(ctx,texture,vertices,a.uvs,a.triangles);}
  ctx.restore();
 }
}

const tintCaches=new WeakMap();
export function tintTexture(image,rgb,makeCanvas=canvasFactory){
 const channels=rgb.map(v=>Math.round(Math.max(0,Math.min(1,v))*255));if(channels.every(v=>v===255))return image;
 let cache=tintCaches.get(image);if(!cache){cache=new Map();tintCaches.set(image,cache);}const key=channels.join(',');if(cache.has(key))return cache.get(key);
 const target=makeCanvas(image.width,image.height),context=target.getContext('2d');context.drawImage(image,0,0);const pixels=context.getImageData(0,0,target.width,target.height);for(let i=0;i<pixels.data.length;i+=4){pixels.data[i]=pixels.data[i]*channels[0]/255;pixels.data[i+1]=pixels.data[i+1]*channels[1]/255;pixels.data[i+2]=pixels.data[i+2]*channels[2]/255;}context.putImageData(pixels,0,0);if(cache.size>=64)cache.delete(cache.keys().next().value);cache.set(key,target);return target;
}

const bscCaches=new WeakMap();
/** Exact original native-bsc.frag transform, with the Lua cc.c3b quantization. */
export function bscTexture(image,bsc,makeCanvas=canvasFactory){
 const [b,s,c]=[bsc.b,bsc.s,bsc.c].map(v=>Math.floor((v??1)*255/2)*2/255),key=[b,s,c].join(',');let cache=bscCaches.get(image);if(!cache){cache=new Map();bscCaches.set(image,cache);}if(cache.has(key))return cache.get(key);
 const target=makeCanvas(image.width,image.height),context=target.getContext('2d');context.drawImage(image,0,0);const pixels=context.getImageData(0,0,target.width,target.height),d=pixels.data;
 for(let i=0;i<d.length;i+=4){if(!d[i+3])continue;const r=d[i]/255*b,g=d[i+1]/255*b,blue=d[i+2]/255*b,intensity=r*.2125+g*.7154+blue*.0721;d[i]=255*(.5+(intensity+(r-intensity)*s-.5)*c);d[i+1]=255*(.5+(intensity+(g-intensity)*s-.5)*c);d[i+2]=255*(.5+(intensity+(blue-intensity)*s-.5)*c);}context.putImageData(pixels,0,0);cache.set(key,target);return target;
}
