import {LuaTable,LuaClosure,LuaExecutionError,multi,allResults,firstResult,luaTruthy} from './lua-vm.mjs';
export function installLibrary(vm){
 const g=vm.globals,nil=v=>v==null;g._G=g;
 g.type=v=>nil(v)?'nil':v instanceof LuaClosure||typeof v==='function'?'function':v instanceof LuaTable?'table':typeof v==='object'?'table':typeof v;
 g.tostring=v=>nil(v)?'nil':String(v);
 g.tonumber=(v,base)=>{if(nil(v))return null;const n=base?parseInt(v,base):Number(v);return Number.isNaN(n)?null:n;};
 g.assert=(v,...rest)=>{if(!luaTruthy(v))throw Error(rest[0]??'assertion failed');return multi(v,...rest);};
 g.error=v=>{throw new LuaExecutionError(String(v));};
 g.pcall=(fn,...args)=>{try{return multi(true,...allResults(vm.call(fn,args)));}catch(e){return multi(false,e.message);}};
 g.select=(n,...args)=>n==='#'?args.length:multi(...args.slice(n>0?n-1:args.length+n));
 g.rawget=(t,k)=>vm.rawget(t,k);g.rawset=(t,k,v)=>(vm.rawset(t,k,v),t);g.rawequal=(a,b)=>a===b||nil(a)&&nil(b);
 g.setmetatable=(t,m)=>{if(!(t instanceof LuaTable))throw Error('setmetatable requires table');t.metatable=m;return t;};
 g.getmetatable=t=>t instanceof LuaTable?t.metatable:null;
 g.next=(t,k)=>{
  if(t instanceof LuaTable){const entry=t.nextEntry(k);return entry?multi(...entry):multi(null);}
  const es=Object.entries(t),i=nil(k)?0:es.findIndex(x=>vm.equal(x[0],k))+1;
  if(!nil(k)&&i===0)throw Error('Invalid key to next');return i<es.length?multi(...es[i]):multi(null);
 };
 g.pairs=t=>multi(g.next,t,null);
 g.ipairs=t=>multi((tab,index)=>{const i=index+1,v=vm.rawget(tab,i);return nil(v)?multi(null):multi(i,v);},t,0);
 g.unpack=(t,start=1,end=vm.length(t))=>multi(...Array.from({length:Math.max(0,end-start+1)},(_,i)=>vm.get(t,start+i)));
 g.math={
  abs:Math.abs,acos:Math.acos,asin:Math.asin,atan:Math.atan,atan2:Math.atan2,ceil:Math.ceil,cos:Math.cos,cosh:Math.cosh,deg:x=>x*180/Math.PI,exp:Math.exp,
  floor:Math.floor,fmod:(a,b)=>a%b,huge:Infinity,log:Math.log,log10:Math.log10,max:Math.max,min:Math.min,modf:x=>multi(Math.trunc(x),x-Math.trunc(x)),
  pi:Math.PI,pow:(a,b)=>a**b,rad:x=>x*Math.PI/180,sin:Math.sin,sinh:Math.sinh,sqrt:Math.sqrt,tan:Math.tan,tanh:Math.tanh,
  random:(a,b)=>{const r=vm.random();return nil(a)?r:nil(b)?Math.floor(r*a)+1:Math.floor(r*(b-a+1))+a;}
 };
 g.table={
  insert:(t,...a)=>{const len=vm.length(t),pos=a.length===1?len+1:a[0],v=a.length===1?a[0]:a[1];for(let i=len;i>=pos;i--)vm.set(t,i+1,vm.get(t,i));vm.set(t,pos,v);},
  remove:(t,pos=vm.length(t))=>{const len=vm.length(t),v=vm.get(t,pos);for(let i=pos;i<len;i++)vm.set(t,i,vm.get(t,i+1));vm.set(t,len,null);return v;},
  concat:(t,sep='',start=1,end=vm.length(t))=>Array.from({length:Math.max(0,end-start+1)},(_,i)=>vm.get(t,start+i)).join(sep),
  sort:(t,cmp)=>{
   const a=Array.from({length:vm.length(t)},(_,i)=>vm.get(t,i+1));
   a.sort((x,y)=>cmp?(luaTruthy(firstResult(vm.call(cmp,[x,y])))?-1:luaTruthy(firstResult(vm.call(cmp,[y,x])))?1:0):(x<y?-1:x>y?1:0));
   a.forEach((v,i)=>vm.set(t,i+1,v));
  },
  maxn:t=>Math.max(0,...(t instanceof LuaTable?[...t.entries.keys()]:Object.keys(t)).filter(x=>typeof x==='number')),unpack:g.unpack
 };
 const bytes=s=>new TextEncoder().encode(String(s)),ix=(i,n)=>i<0?n+i+1:i;
 g.string={
  len:s=>bytes(s).length,lower:s=>String(s).toLowerCase(),upper:s=>String(s).toUpperCase(),rep:(s,n,sep='')=>Array.from({length:Math.max(0,n)},()=>s).join(sep),
  reverse:s=>[...String(s)].reverse().join(''),
  sub:(s,i,j=-1)=>{const b=bytes(s);return new TextDecoder().decode(b.slice(Math.max(ix(i,b.length)-1,0),Math.max(ix(j,b.length),0)));},
  byte:(s,i=1,j=i)=>{const b=bytes(s);return multi(...b.slice(Math.max(ix(i,b.length)-1,0),ix(j,b.length)));},
  char:(...n)=>new TextDecoder().decode(new Uint8Array(n)),
  format:(fmt,...args)=>{
   let ai=0;return fmt.replace(/%([+ #0-]*)(\d*)(?:\.(\d+))?([%sdiufegxXq])/g,(m,f,w,p,t)=>{
    if(t==='%')return'%';const v=args[ai++];let o=t==='s'?String(v):t==='q'?JSON.stringify(String(v)):t==='d'||t==='i'?String(Math.trunc(v)):t==='u'?String(v>>>0):
      t==='x'||t==='X'?(v>>>0).toString(16):t==='f'?Number(v).toFixed(p===undefined?6:Number(p)):t==='e'?Number(v).toExponential(p===undefined?6:Number(p)):String(v);
    if(t==='X')o=o.toUpperCase();return f.includes('-')?o.padEnd(Number(w)||0):o.padStart(Number(w)||0,f.includes('0')?'0':' ');
   });
  },
  find:(s,p,start=1,plain=false)=>{
   if(!plain&&/[().%+*?\[\]^$-]/.test(String(p)))throw new LuaExecutionError('Unsupported Lua pattern; no approximation applied',{pattern:p});
   const hay=Array.from(bytes(s),x=>String.fromCharCode(x)).join(''),needle=Array.from(bytes(p),x=>String.fromCharCode(x)).join('');
   start=ix(start,hay.length);if(start>hay.length+1)return multi(null);
   const at=hay.indexOf(needle,Math.max(0,start-1));return at<0?multi(null):multi(at+1,at+needle.length);
  }
 };
 const fold=(vs,f,i)=>vs.reduce(f,i);
 g.bit={tobit:x=>x|0,bnot:x=>~x,band:(...xs)=>fold(xs,(a,b)=>a&b,-1),bor:(...xs)=>fold(xs,(a,b)=>a|b,0),bxor:(...xs)=>fold(xs,(a,b)=>a^b,0),
 lshift:(x,n)=>x<<n,rshift:(x,n)=>x>>>n,arshift:(x,n)=>x>>n,rol:(x,n)=>(x<<n)|(x>>>(32-n)),ror:(x,n)=>(x>>>n)|(x<<(32-n)),
 bswap:x=>((x>>>24)|((x>>>8)&0xff00)|((x<<8)&0xff0000)|(x<<24)),tohex:(x,n=8)=>(x>>>0).toString(16).padStart(Math.abs(n),'0').slice(-Math.abs(n))};
 g.string.split=(s,delimiter)=>{if(typeof s!=='string'||typeof delimiter!=='string'||delimiter==='')return null;return vm.table(s.split(delimiter));};
 g.require=name=>{if(Object.prototype.hasOwnProperty.call(g,name))return g[name];throw new LuaExecutionError('Missing Lua module '+name);};
}
