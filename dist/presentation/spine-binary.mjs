export class BinaryReader {
 constructor(bytes){this.bytes=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);this.view=new DataView(this.bytes.buffer,this.bytes.byteOffset,this.bytes.byteLength);this.p=0;}
 need(n){if(this.p+n>this.bytes.length)throw new Error(`Spine binary truncated at ${this.p} (+${n})`);}
 byte(){this.need(1);return this.bytes[this.p++];} bool(){return this.byte()!==0;} sbyte(){const v=this.byte();return v>127?v-256:v;}
 float(){this.need(4);const v=this.view.getFloat32(this.p);this.p+=4;return v;} int32(){this.need(4);const v=this.view.getUint32(this.p);this.p+=4;return v;}
 short(){this.need(2);const v=this.view.getUint16(this.p);this.p+=2;return v;}
 int(positive=true){let v=0,shift=0,b;do{b=this.byte();v|=(b&127)<<shift;shift+=7;if(shift>35)throw new Error('Invalid Spine varint');}while(b&128);return positive?v>>>0:(v>>>1)^-(v&1);}
 str(){const n=this.int();if(n===0)return null;if(n===1)return '';this.need(n-1);const v=new TextDecoder().decode(this.bytes.subarray(this.p,this.p+n-1));this.p+=n-1;return v;}
 floats(n){return Array.from({length:n},()=>this.float());} shorts(){return Array.from({length:this.int()},()=>this.short());}
}
export function readSpine34(bytes,{debug=false}={}){
 const r=new BinaryReader(bytes),d={hash:r.str(),version:r.str(),width:r.float(),height:r.float()};
 if(!/^3\.4\./.test(d.version))throw new Error('Unsupported Spine version: '+d.version);
 d.nonessential=r.bool();if(d.nonessential)d.images=r.str();
 d.bones=Array.from({length:r.int()},(_,i)=>({name:r.str(),parent:i?r.int():-1,rotation:r.float(),x:r.float(),y:r.float(),scaleX:r.float(),scaleY:r.float(),shearX:r.float(),shearY:r.float(),length:r.float(),inheritRotation:r.bool(),inheritScale:r.bool(),...(d.nonessential?{color:r.int32()}:{})}));
 d.slots=Array.from({length:r.int()},()=>({name:r.str(),bone:r.int(),color:r.int32(),attachment:r.str(),blend:r.int()}));
 d.ik=Array.from({length:r.int()},()=>({name:r.str(),bones:Array.from({length:r.int()},()=>r.int()),target:r.int(),mix:r.float(),bend:r.sbyte()}));
 d.transform=Array.from({length:r.int()},()=>({name:r.str(),bones:Array.from({length:r.int()},()=>r.int()),target:r.int(),rotation:r.float(),x:r.float(),y:r.float(),scaleX:r.float(),scaleY:r.float(),shearY:r.float(),rotateMix:r.float(),translateMix:r.float(),scaleMix:r.float(),shearMix:r.float()}));
 d.path=Array.from({length:r.int()},()=>({name:r.str(),bones:Array.from({length:r.int()},()=>r.int()),target:r.int(),positionMode:r.int(),spacingMode:r.int(),rotateMode:r.int(),rotation:r.float(),position:r.float(),spacing:r.float(),rotateMix:r.float(),translateMix:r.float()}));
 if(debug)return {d,position:r.p,next:Array.from(r.bytes.slice(r.p,r.p+120))};
 const vertexData=count=>{
  const weighted=r.bool();
  if(!weighted)return {weighted,vertices:r.floats(count*2),vertexCount:count,deformLength:count*2};
  const vertices=Array.from({length:count},()=>Array.from({length:r.int()},()=>({bone:r.int(),x:r.float(),y:r.float(),weight:r.float()})));
  return {weighted,vertices,vertexCount:count,deformLength:vertices.reduce((n,v)=>n+v.length*2,0)};
 };
 const attachment=(key,slot)=>{
  const name=r.str()||key,type=r.byte();let a={key,name,type,slot};
  if(type===0){a.path=r.str()||name;for(const k of ['rotation','x','y','scaleX','scaleY','width','height'])a[k]=r.float();a.color=r.int32();}
  else if(type===1){Object.assign(a,vertexData(r.int()));if(d.nonessential)a.color=r.int32();}
  else if(type===2){a.path=r.str()||name;a.color=r.int32();const count=r.int();a.uvs=r.floats(count*2);a.triangles=r.shorts();Object.assign(a,vertexData(count));a.hull=r.int();if(d.nonessential){a.edges=r.shorts();a.width=r.float();a.height=r.float();}}
  else if(type===3){a.path=r.str()||name;a.color=r.int32();a.skin=r.str();a.parent=r.str();a.inheritDeform=r.bool();if(d.nonessential){a.width=r.float();a.height=r.float();}}
  else if(type===4){a.closed=r.bool();a.constantSpeed=r.bool();const count=r.int();Object.assign(a,vertexData(count));a.lengths=r.floats(count/3);if(d.nonessential)a.color=r.int32();}
  else throw new Error(`Unsupported Spine 3.4 attachment type ${type} at ${r.p}`);
  return a;
 };
 const skin=name=>{const s={name,slots:{}};for(let i=0,n=r.int();i<n;i++){const slot=r.int(),entries={};for(let j=0,n=r.int();j<n;j++){const key=r.str();entries[key]=attachment(key,slot);}s.slots[slot]=entries;}return s;};
 d.skins=[skin('default')];for(let i=0,n=r.int();i<n;i++)d.skins.push(skin(r.str()));
 for(const s of d.skins)for(const entries of Object.values(s.slots))for(const a of Object.values(entries))if(a.type===3){const parentSkin=d.skins.find(s=>s.name===(a.skin||'default'));const p=parentSkin?.slots[a.slot]?.[a.parent];if(!p)throw new Error('Missing linked mesh parent '+a.parent);for(const k of ['vertices','weighted','vertexCount','deformLength','triangles','uvs','hull'])a[k]=p[k];a.deformParent=a.inheritDeform?a.parent:null;}
 d.events=Array.from({length:r.int()},()=>({name:r.str(),int:r.int(false),float:r.float(),string:r.str()}));
 const curve=()=>{const c=r.byte();if(c===0)return null;if(c===1)return 'stepped';if(c===2)return r.floats(4);throw new Error('Invalid curve '+c+' at '+r.p);};
 const frames=(count,readValues)=>Array.from({length:count},(_,i)=>{const f={time:r.float(),...readValues()};if(i<count-1)f.curve=curve();return f;});
 function animation(name){
  const a={name,timelines:[],duration:0};const add=t=>{a.timelines.push(t);for(const f of t.frames)a.duration=Math.max(a.duration,f.time);};
  for(let i=0,n=r.int();i<n;i++){const target=r.int();for(let j=0,n=r.int();j<n;j++){const type=r.byte(),count=r.int();if(type===0)add({kind:'attachment',target,frames:Array.from({length:count},()=>({time:r.float(),name:r.str()}))});else if(type===1)add({kind:'color',target,frames:frames(count,()=>({color:r.int32()}))});else throw new Error('Unknown slot timeline '+type);}}
  for(let i=0,n=r.int();i<n;i++){const target=r.int();for(let j=0,n=r.int();j<n;j++){const type=r.byte(),count=r.int();if(type>3)throw new Error('Unknown bone timeline '+type);add({kind:['rotate','translate','scale','shear'][type],target,frames:frames(count,()=>({values:r.floats(type===0?1:2)}))});}}
  for(let i=0,n=r.int();i<n;i++){const target=r.int();add({kind:'ik',target,frames:frames(r.int(),()=>({values:[r.float()],bend:r.sbyte()}))});}
  for(let i=0,n=r.int();i<n;i++){const target=r.int();add({kind:'transform',target,frames:frames(r.int(),()=>({values:r.floats(4)}))});}
  for(let i=0,n=r.int();i<n;i++){const target=r.int();for(let j=0,n=r.int();j<n;j++){const type=r.byte();if(type>2)throw new Error('Unknown path timeline '+type);add({kind:['pathPosition','pathSpacing','pathMix'][type],target,frames:frames(r.int(),()=>({values:r.floats(type===2?2:1)}))});}}
  for(let i=0,n=r.int();i<n;i++){const skinIndex=r.int();for(let j=0,n=r.int();j<n;j++){const target=r.int();for(let k=0,n=r.int();k<n;k++){const attachmentName=r.str(),att=d.skins[skinIndex]?.slots[target]?.[attachmentName];if(!att)throw new Error('Missing deformation attachment '+attachmentName);const fs=frames(r.int(),()=>{const count=r.int(),values=new Array(att.deformLength).fill(0);if(count){const start=r.int();for(let x=0;x<count;x++)values[start+x]=r.float();}return {values};});add({kind:'deform',target,skinIndex,attachment:attachmentName,frames:fs});}}}
  const drawFrames=[];for(let i=0,n=r.int();i<n;i++){const time=r.float(),count=r.int(),order=new Array(d.slots.length).fill(-1),unchanged=[];let original=0;for(let j=0;j<count;j++){const slot=r.int();while(original<slot)unchanged.push(original++);const offset=r.int()|0;order[original+offset]=original++;}while(original<order.length)unchanged.push(original++);for(let j=order.length-1;j>=0;j--)if(order[j]===-1)order[j]=unchanged.pop();drawFrames.push({time,order});}if(drawFrames.length)add({kind:'drawOrder',frames:drawFrames});
  const events=[];for(let i=0,n=r.int();i<n;i++){const time=r.float(),index=r.int(),int=r.int(false),float=r.float(),string=r.bool()?r.str():d.events[index].string;events.push({time,index,int,float,string});}if(events.length)add({kind:'event',frames:events});return a;
 }
 d.animations={};for(let i=0,n=r.int();i<n;i++){const name=r.str();d.animations[name]=animation(name);}
 if(r.p!==r.bytes.length)throw new Error(`Spine parser left ${r.bytes.length-r.p} bytes unconsumed`);
 return d;

}
