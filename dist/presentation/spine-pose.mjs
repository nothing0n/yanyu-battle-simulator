const DEG=Math.PI/180;
const wrap=a=>{while(a>180)a-=360;while(a< -180)a+=360;return a;};
export function rgba(c){return [(c>>>24)/255,((c>>>16)&255)/255,((c>>>8)&255)/255,(c&255)/255];}
function lastFrame(frames,time){let low=0,high=frames.length-1;if(!frames.length||time<frames[0].time)return -1;while(low<high){const mid=Math.ceil((low+high)/2);if(frames[mid].time<=time)low=mid;else high=mid-1;}return low;}
export function curvePercent(curve,t){if(curve==='stepped')return 0;if(!curve)return t;const [x1,y1,x2,y2]=curve;let lo=0,hi=1,u=t;for(let i=0;i<16;i++){u=(lo+hi)/2;const v=1-u,x=3*v*v*u*x1+3*v*u*u*x2+u*u*u;if(x<t)lo=u;else hi=u;}const v=1-u;return 3*v*v*u*y1+3*v*u*u*y2+u*u*u;}
function valuesAt(timeline,time,rotation=false){const fs=timeline.frames,i=lastFrame(fs,time);if(i<0)return null;const a=fs[i];if(i===fs.length-1)return a.values;const b=fs[i+1],p=curvePercent(a.curve,(time-a.time)/(b.time-a.time));return a.values.map((v,j)=>v+(rotation?wrap(b.values[j]-v):b.values[j]-v)*p);}
export function createPose(data,animationName,time=0,{loop=true,appearance=null,basePose=null}={}){
 const animation=animationName?data.animations[animationName]:null;
 if(animationName&&!animation)throw new Error(`Spine animation not found: ${animationName}`);
 if(animation&&loop&&animation.duration>0)time%=animation.duration;
 const base=basePose?.local;
 const p={data,bones:(base?.bones||data.bones).map(b=>({...b})),slots:base?base.slots.map(s=>({...s,color:[...s.color],deform:s.deform})):data.slots.map(s=>({...s,color:rgba(s.color),deform:null})),ik:(base?.ik||data.ik).map(c=>({...c})),transform:(base?.transform||data.transform).map(c=>({...c})),path:(base?.path||data.path).map(c=>({...c})),order:base?[...base.order]:data.slots.map((_,i)=>i),time,animation:animationName};
 if(!base&&appearance){for(const raw of appearance.boneScales||[]){const x=Array.isArray(raw)?{name:raw[0],x:raw[1],y:raw[2]??raw[1]}:raw,index=p.bones.findIndex(b=>b.name===(x.bone||x.name));if(index<0)continue;const b=p.bones[index];let px=1,py=1,parent=b.parent;while(parent>=0){px*=p.bones[parent].scaleX;py*=p.bones[parent].scaleY;parent=p.bones[parent].parent;}if(x.x!=null)b.scaleX=x.x/px;if(x.y!=null)b.scaleY=x.y/py;for(const child of p.bones)if(child.parent===index){if(x.x!=null)child.scaleX=1/x.x;if(x.y!=null)child.scaleY=1/x.y;}}}
 for(const t of animation?.timelines||[]){const i=lastFrame(t.frames,time);if(i<0)continue;const f=t.frames[i],v=t.kind==='rotate'?valuesAt(t,time,true):f.values?valuesAt(t,time):null;
  if(t.kind==='rotate')p.bones[t.target].rotation=data.bones[t.target].rotation+v[0];
  else if(t.kind==='translate'){p.bones[t.target].x=data.bones[t.target].x+v[0];p.bones[t.target].y=data.bones[t.target].y+v[1];}
  else if(t.kind==='scale'){p.bones[t.target].scaleX=data.bones[t.target].scaleX*v[0];p.bones[t.target].scaleY=data.bones[t.target].scaleY*v[1];}
  else if(t.kind==='shear'){p.bones[t.target].shearX=data.bones[t.target].shearX+v[0];p.bones[t.target].shearY=data.bones[t.target].shearY+v[1];}
  else if(t.kind==='attachment'){const slot=p.slots[t.target];if(slot.attachment!==f.name)slot.deform=null;slot.attachment=f.name;}
  else if(t.kind==='color'){const a=rgba(f.color);if(i<t.frames.length-1){const next=t.frames[i+1],b=rgba(next.color),k=curvePercent(f.curve,(time-f.time)/(next.time-f.time));p.slots[t.target].color=a.map((x,j)=>x+(b[j]-x)*k);}else p.slots[t.target].color=a;}
  else if(t.kind==='ik'){p.ik[t.target].mix=v[0];p.ik[t.target].bend=f.bend;}
  else if(t.kind==='transform'){for(const [j,k]of ['rotateMix','translateMix','scaleMix','shearMix'].entries())p.transform[t.target][k]=v[j];}
  else if(t.kind==='pathPosition')p.path[t.target].position=v[0];
  else if(t.kind==='pathSpacing')p.path[t.target].spacing=v[0];
  else if(t.kind==='pathMix'){p.path[t.target].rotateMix=v[0];p.path[t.target].translateMix=v[1];}
  else if(t.kind==='deform'){const slot=p.slots[t.target],a=attachmentFor(p,t.target);if(a&&(a.name===t.attachment||a.deformParent===t.attachment))slot.deform=v;}
  else if(t.kind==='drawOrder')p.order=f.order;
 }
 p.local={bones:p.bones.map(b=>({...b})),slots:p.slots.map(s=>({...s,color:[...s.color]})),ik:p.ik.map(c=>({...c})),transform:p.transform.map(c=>({...c})),path:p.path.map(c=>({...c})),order:[...p.order]};
 for(let i=0;i<p.bones.length;i++)updateBone(p,i);
 for(const c of p.ik)applyIK(p,c);
 for(const c of p.transform)applyTransform(p,c);
 for(const c of p.path)applyPath(p,c);
 return p;
}
export function attachmentFor(p,slotIndex){const slot=p.slots[slotIndex];if(!slot?.attachment)return null;return p.data.skins[0].slots[slotIndex]?.[slot.attachment]||null;}
function updateBone(p,index){const b=p.bones[index],r=(b.rotation+b.shearX)*DEG,ry=(b.rotation+90+b.shearY)*DEG,la=Math.cos(r)*b.scaleX,lc=Math.sin(r)*b.scaleX,lb=Math.cos(ry)*b.scaleY,ld=Math.sin(ry)*b.scaleY,par=p.bones[b.parent];if(!par){b.a=la;b.b=lb;b.c=lc;b.d=ld;b.wx=b.x;b.wy=b.y;return;}
 b.wx=par.a*b.x+par.b*b.y+par.wx;b.wy=par.c*b.x+par.d*b.y+par.wy;
 let a=par.a,c=par.c,bb=par.b,d=par.d;
 if(!b.inheritRotation&&!b.inheritScale){a=d=1;c=bb=0;}
 else if(!b.inheritScale){const x=Math.hypot(a,c)||1,y=Math.hypot(bb,d)||1;a/=x;c/=x;bb/=y;d/=y;}
 else if(!b.inheritRotation){const angle=Math.atan2(c,a),co=Math.cos(angle),si=Math.sin(angle),aa=co*a+si*c,ab=co*bb+si*d,ac=-si*a+co*c,ad=-si*bb+co*d;a=aa;bb=ab;c=ac;d=ad;}
 b.a=a*la+bb*lc;b.b=a*lb+bb*ld;b.c=c*la+d*lc;b.d=c*lb+d*ld;
}
const descendantCache=new WeakMap();
function descendants(p,index,except=new Set()){let cache=descendantCache.get(p.data);if(!cache){cache=p.data.bones.map(()=>[]);for(let i=0;i<p.data.bones.length;i++){let a=p.data.bones[i].parent;while(a>=0){cache[a].push(i);a=p.data.bones[a].parent;}}descendantCache.set(p.data,cache);}for(const i of cache[index])if(!except.has(i))updateBone(p,i);}
function rotateWorld(b,r){const co=Math.cos(r),si=Math.sin(r),a=b.a,bb=b.b,c=b.c,d=b.d;b.a=co*a-si*c;b.b=co*bb-si*d;b.c=si*a+co*c;b.d=si*bb+co*d;}
function applyIK(p,c){if(c.mix===0)return;const target=p.bones[c.target];if(c.bones.length===1){const b=p.bones[c.bones[0]],angle=Math.atan2(target.wy-b.wy,target.wx-b.wx),delta=wrap((angle-Math.atan2(b.c,b.a))/DEG)*DEG*c.mix;rotateWorld(b,delta);descendants(p,c.bones[0]);return;}
 if(c.bones.length!==2)throw new Error('Unsupported IK bone count');const [pi,ci]=c.bones,par=p.bones[pi],child=p.bones[ci],dx=child.wx-par.wx,dy=child.wy-par.wy,l1=Math.hypot(dx,dy),l2=Math.abs(child.length)*Math.hypot(child.a,child.c),tx=target.wx-par.wx,ty=target.wy-par.wy,dist=Math.hypot(tx,ty);if(l1<1e-8||l2<1e-8)return;
 const inner=Math.acos(Math.max(-1,Math.min(1,(dist*dist-l1*l1-l2*l2)/(2*l1*l2))))*c.bend;
 const a1=Math.atan2(ty,tx)-Math.atan2(l2*Math.sin(inner),l1+l2*Math.cos(inner)),d1=wrap((a1-Math.atan2(dy,dx))/DEG)*DEG*c.mix;
 rotateWorld(par,d1);descendants(p,pi);const a2=a1+inner,d2=wrap((a2-Math.atan2(child.c,child.a))/DEG)*DEG*c.mix;rotateWorld(child,d2);descendants(p,ci);
}
function applyTransform(p,c){const t=p.bones[c.target],det=t.a*t.d-t.b*t.c,sign=det>0?1:-1;for(const index of c.bones){const b=p.bones[index];if(c.rotateMix){const r=wrap((Math.atan2(t.c,t.a)-Math.atan2(b.c,b.a))/DEG+c.rotation*sign)*DEG*c.rotateMix;rotateWorld(b,r);}if(c.translateMix){b.wx+=(t.a*c.x+t.b*c.y+t.wx-b.wx)*c.translateMix;b.wy+=(t.c*c.x+t.d*c.y+t.wy-b.wy)*c.translateMix;}if(c.scaleMix){let bs=Math.hypot(b.a,b.c),ts=Math.hypot(t.a,t.c),s=bs>1e-8?(bs+(ts-bs+c.scaleX)*c.scaleMix)/bs:0;b.a*=s;b.c*=s;bs=Math.hypot(b.b,b.d);ts=Math.hypot(t.b,t.d);s=bs>1e-8?(bs+(ts-bs+c.scaleY)*c.scaleMix)/bs:0;b.b*=s;b.d*=s;}if(c.shearMix){const by=Math.atan2(b.d,b.b),r=wrap((Math.atan2(t.d,t.b)-Math.atan2(t.c,t.a)-by+Math.atan2(b.c,b.a))/DEG+c.shearY*sign)*DEG*c.shearMix,scale=Math.hypot(b.b,b.d);b.b=Math.cos(by+r)*scale;b.d=Math.sin(by+r)*scale;}descendants(p,index,new Set(c.bones));}}
export function worldVertices(p,a,slotIndex){const deform=p.slots[slotIndex].deform,vertices=[];if(a.weighted){let d=0;for(const weights of a.vertices){let x=0,y=0;for(const w of weights){const b=p.bones[w.bone],vx=w.x+(deform?.[d++]||0),vy=w.y+(deform?.[d++]||0);x+=(vx*b.a+vy*b.b+b.wx)*w.weight;y+=(vx*b.c+vy*b.d+b.wy)*w.weight;}vertices.push(x,y);}}else{const b=p.bones[p.slots[slotIndex].bone];for(let i=0;i<a.vertices.length;i+=2){const x=a.vertices[i]+(deform?.[i]||0),y=a.vertices[i+1]+(deform?.[i+1]||0);vertices.push(x*b.a+y*b.b+b.wx,x*b.c+y*b.d+b.wy);}}return vertices;}
function cubic(points,i,t){const u=1-t,a=points[i],b=points[i+1],c=points[i+2],d=points[i+3];return {x:u*u*u*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t*t*t*d.x,y:u*u*u*a.y+3*u*u*t*b.y+3*u*t*t*c.y+t*t*t*d.y,angle:Math.atan2(3*u*u*(b.y-a.y)+6*u*t*(c.y-b.y)+3*t*t*(d.y-c.y),3*u*u*(b.x-a.x)+6*u*t*(c.x-b.x)+3*t*t*(d.x-c.x))};}
function applyPath(p,c){if(!c.rotateMix&&!c.translateMix)return;const a=attachmentFor(p,c.target);if(!a||a.type!==4)return;const v=worldVertices(p,a,c.target),points=[];for(let i=0;i<v.length;i+=2)points.push({x:v[i],y:v[i+1]});if(a.closed)points.push(...points.slice(0,3));else{points.shift();points.pop();}const samples=[];let distance=0,prev=null;for(let i=0;i+3<points.length;i+=3){for(let j=0;j<=10;j++){if(i&&j===0)continue;const point=cubic(points,i,j/10);if(prev)distance+=Math.hypot(point.x-prev.x,point.y-prev.y);samples.push({...point,distance});prev=point;}}if(!samples.length)return;let cursor=c.positionMode===1?c.position*distance:c.position;
 const pointAt=dist=>{if(a.closed)dist=((dist%distance)+distance)%distance;if(dist<0){const s=samples[0];return {...s,x:s.x+Math.cos(s.angle)*dist,y:s.y+Math.sin(s.angle)*dist};}if(dist>distance){const s=samples.at(-1),delta=dist-distance;return {...s,x:s.x+Math.cos(s.angle)*delta,y:s.y+Math.sin(s.angle)*delta};}let i=0;while(i<samples.length-1&&samples[i+1].distance<dist)i++;const x=samples[i],y=samples[Math.min(i+1,samples.length-1)],t=y.distance===x.distance?0:(dist-x.distance)/(y.distance-x.distance);return{x:x.x+(y.x-x.x)*t,y:x.y+(y.y-x.y)*t,angle:x.angle+wrap((y.angle-x.angle)/DEG)*DEG*t};};
 for(const index of c.bones){const b=p.bones[index],point=pointAt(cursor);b.wx+=(point.x-b.wx)*c.translateMix;b.wy+=(point.y-b.wy)*c.translateMix;const spacing=c.spacingMode===2?c.spacing*distance:c.spacingMode===0?Math.max(0,b.length+c.spacing):c.spacing;const next=pointAt(cursor+spacing),angle=c.rotateMode===0?point.angle:Math.atan2(next.y-point.y,next.x-point.x);if(c.rotateMix)rotateWorld(b,wrap((angle-Math.atan2(b.c,b.a))/DEG+c.rotation)*DEG*c.rotateMix);if(c.rotateMode===2&&b.length>1e-8){const scale=Math.hypot(next.x-point.x,next.y-point.y)/(Math.abs(b.length)*Math.hypot(b.a,b.c));b.a*=1+(scale-1)*c.rotateMix;b.c*=1+(scale-1)*c.rotateMix;}descendants(p,index,new Set(c.bones));cursor+=spacing;}
}
