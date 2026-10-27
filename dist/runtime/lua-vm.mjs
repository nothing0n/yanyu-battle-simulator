// Strict interpreter: game formulas come from the original instruction stream.
import {installLibrary} from './lua-library.mjs';
const nil=v=>v==null, norm=v=>nil(v)?null:v, tag=Symbol('lua-multi');
export const luaTruthy=v=>!nil(v)&&v!==false;
export const multi=(...values)=>({[tag]:true,values:values.map(norm)});
export const allResults=v=>v&&v[tag]?v.values:[norm(v)];
export const firstResult=v=>allResults(v)[0]??null;
export class LuaTable {
 constructor(entries=[]){this.entries=new Map(entries);this.metatable=null;this.iteration=null;}
 rawget(k){return norm(this.entries.get(k));}
 iterationSlots(){
  if(!this.iteration){
   const keys=[...this.entries.keys()];
   this.iteration={keys,index:new Map(keys.map((key,index)=>[key,index]))};
  }
  return this.iteration;
 }
 rawset(k,v){
  if(nil(k)||typeof k==='number'&&Number.isNaN(k))throw Error('Invalid table key');
  if(nil(v)){
   // Lua permits clearing the current key during pairs/next traversal. Keep its
   // slot as a cursor tombstone, while removing it from all live table views.
   if(this.entries.has(k)){this.iterationSlots();this.entries.delete(k);}
  }else{
   if(this.iteration&&!this.iteration.index.has(k)){
    this.iteration.index.set(k,this.iteration.keys.length);this.iteration.keys.push(k);
   }
   this.entries.set(k,v);
  }
  return v;
 }
 nextEntry(k=null){
  const {keys,index}=this.iterationSlots();
  // Table keys use raw identity, including table/function keys, never __eq.
  if(!nil(k)&&!index.has(k))throw Error('Invalid key to next');
  for(let i=nil(k)?0:index.get(k)+1;i<keys.length;i++){
   const key=keys[i];if(this.entries.has(key))return [key,this.entries.get(key)];
  }
  return null;
 }
 length(){let n=0;while(this.entries.has(n+1))n++;return n;}
 get size(){return this.entries.size;}
}
export class LuaClosure {constructor(vm,proto,upvalues=[]){this.vm=vm;this.proto=proto;this.upvalues=upvalues;}}
export class LuaExecutionError extends Error {constructor(message,details={}){super(message);this.name='LuaExecutionError';this.details=details;}}
export const PRIVATE_OPCODE_NAMES=Object.fromEntries([
'ISEQV','ISNEV','ISEQS','ISNES','ISEQN','ISNEN','ISEQP','ISNEP',
'ISLT','ISGE','ISLE','ISGT','ISTC','ISFC','IST','ISF','ISTYPE','ISNUM',
'TNEW','TDUP','GGET','GSET','TGETV','TGETS','TGETB','TGETR','TSETV','TSETS','TSETB','TSETM','TSETR',
'KSTR','KCDATA','KSHORT','KNUM','KPRI','KNIL',
'ADDVN','SUBVN','MULVN','DIVVN','MODVN','ADDNV','SUBNV','MULNV','DIVNV','MODNV',
'ADDVV','SUBVV','MULVV','DIVVV','MODVV','POW','CAT','MOV','NOT','UNM','LEN',
'UGET','USETV','USETS','USETN','USETP','UCLO','FNEW',
'CALLM','CALL','CALLMT','CALLT','ITERC','ITERN','VARG','ISNEXT','RETM','RET','RET0','RET1',
'FORI','JFORI','FORL','IFORL','JFORL','ITERL','IITERL','JITERL','LOOP','ILOOP','JLOOP','JMP'
].map((v,i)=>[i,v]));
export class LuaVM {
 constructor({globals={},random,maxInstructions=5000000,trace=null,fr2=true}={}){
  this.globals=Object.create(null);this.prototypes=Object.create(null);this.opcodeNames={...PRIVATE_OPCODE_NAMES};
  this.maxInstructions=maxInstructions;this.steps=0;this.depth=0;this.fr2=fr2;this.trace=trace;
  this.random=random??(()=>{throw new LuaExecutionError('Original game RNG must be supplied');});
  installLibrary(this);Object.assign(this.globals,globals);
 }
 table(v={}){return this.fromJS(v);}
 fromJS(v,seen=new Map()){
  if(nil(v))return null;if(typeof v!=='object'||v instanceof LuaTable||v instanceof LuaClosure)return v;
  if(seen.has(v))return seen.get(v);const t=new LuaTable();seen.set(v,t);
  if(Array.isArray(v))v.forEach((x,i)=>t.rawset(i+1,this.fromJS(x,seen)));
  else for(const[k,x]of Object.entries(v))t.rawset(k,this.fromJS(x,seen));return t;
 }
 unwrap(v,seen=new Map()){
  if(v instanceof LuaClosure)return '[Lua '+(v.proto.id??'?')+']';if(!(v instanceof LuaTable))return v;
  if(seen.has(v))return '[cycle]';const o={};seen.set(v,o);for(const[k,x]of v.entries)o[k]=this.unwrap(x,seen);return o;
 }
 load(bundle,moduleName){
  this.fr2=bundle.fr2??this.fr2;
  // Keep each module's prototypes attached to itself: IDs such as root/1 repeat.
  const ps=bundle.prototypes??{};for(const p of Object.values(ps)){Object.defineProperty(p,'_bundle',{value:ps,configurable:true});Object.defineProperty(p,'_module',{value:moduleName??bundle.name??bundle.module??null,configurable:true});}
  Object.assign(this.prototypes,ps);Object.assign(this.opcodeNames,bundle.opcodeNames??{});return this.closure(ps[bundle.root]??bundle.root);
 }
 closure(proto,upvalues=[]){
  if(typeof proto==='string')proto=this.prototypes[proto];if(!proto?.code)throw new LuaExecutionError('Unknown Lua prototype');
  return new LuaClosure(this,proto,upvalues.map(v=>v?.__cell?v:{__cell:true,value:norm(v)}));
 }
 run(proto,args=[],upvalues=[]){return this.call(this.closure(proto,upvalues),args);}
 runFirst(proto,args=[],upvalues=[]){return firstResult(this.run(proto,args,upvalues));}
 rawget(t,k){if(t instanceof LuaTable)return t.rawget(k);if(t&&(typeof t==='object'||typeof t==='function'))return norm(Object.prototype.hasOwnProperty.call(t,k)?t[k]:null);return null;}
 rawset(t,k,v){if(t instanceof LuaTable)return t.rawset(k,v);if(t&&(typeof t==='object'||typeof t==='function')){if(nil(v))delete t[k];else t[k]=v;return v;}throw new LuaExecutionError('Index of non-table',{key:k});}
 get(t,k,depth=0){
  if(depth>100)throw new LuaExecutionError('Loop in __index');if(typeof t==='string')return norm(this.globals.string[k]);
  const v=this.rawget(t,k);if(!nil(v))return v;const m=this.meta(t,'__index');
  if(!nil(m))return this.isCallable(m)?firstResult(this.call(m,[t,k])):this.get(m,k,depth+1);
  if(nil(t))throw new LuaExecutionError('Attempt to index nil',{key:k});return null;
 }
 set(t,k,v,depth=0){
  if(v instanceof LuaClosure&&typeof k==='string')v.displayName??=k;
  if(depth>100)throw new LuaExecutionError('Loop in __newindex');
  if(nil(this.rawget(t,k))){const m=this.meta(t,'__newindex');if(!nil(m))return this.isCallable(m)?firstResult(this.call(m,[t,k,v])):this.set(m,k,v,depth+1);}
  return this.rawset(t,k,v);
 }
 meta(t,k){return t instanceof LuaTable&&t.metatable?this.rawget(t.metatable,k):null;}
 isCallable(f){return f instanceof LuaClosure||typeof f==='function';}
 call(fn,args=[]){
  if(this.depth===0)this.steps=0;if(this.depth>1000)throw new LuaExecutionError('Lua call depth exceeded');this.depth++;
  try{
   if(fn instanceof LuaClosure)return this.execute(fn,args);
   if(typeof fn==='function')return multi(...allResults(fn(...args)));
   const m=this.meta(fn,'__call');if(!nil(m))return this.call(m,[fn,...args]);
   throw new LuaExecutionError('Attempt to call missing or non-callable function',{value:fn});
  }finally{this.depth--;}
 }
 constant(v,bundle=this.prototypes){
  if(!v||typeof v!=='object')return v;if(v.$proto!==undefined)return bundle[v.$proto];
  const tv=v.$table??(v.type==='table'?v:null);
  if(tv){const t=new LuaTable();for(let i=0;i<(tv.array??[]).length;i++)t.rawset(i,this.constant(tv.array[i],bundle));for(const[k,x]of tv.dictionary??[])t.rawset(this.constant(k,bundle),this.constant(x,bundle));return t;}
  if(v.type==='proto'&&v.code)return v;
  if(v.type==='proto'&&v.value?.code)return v.value;
  throw new LuaExecutionError('Unsupported serialized constant',{constant:v});
 }
 number(v){if(typeof v==='number')return v;if(typeof v==='string'&&v.trim()!==''&&!Number.isNaN(Number(v)))return Number(v);throw new LuaExecutionError('Arithmetic on non-number',{value:v});}
 binary(op,a,b){
  const f={ADD:(x,y)=>x+y,SUB:(x,y)=>x-y,MUL:(x,y)=>x*y,DIV:(x,y)=>x/y,MOD:(x,y)=>x-Math.floor(x/y)*y,POW:(x,y)=>x**y};
  try{return f[op](this.number(a),this.number(b));}catch(e){const m=this.meta(a,'__'+op.toLowerCase())??this.meta(b,'__'+op.toLowerCase());if(!nil(m))return firstResult(this.call(m,[a,b]));throw e;}
 }
 equal(a,b){
  if(nil(a)&&nil(b)||a===b)return true;
  if(a instanceof LuaTable&&b instanceof LuaTable){const m=this.meta(a,'__eq');if(!nil(m)&&m===this.meta(b,'__eq'))return luaTruthy(firstResult(this.call(m,[a,b])));}return false;
 }
 compare(op,a,b){
  if(typeof a===typeof b&&(typeof a==='number'||typeof a==='string'))return op==='LT'?a<b:op==='LE'?a<=b:op==='GE'?a>=b:a>b;
  if(op==='LT'||op==='LE'){
   const m=this.meta(a,op==='LT'?'__lt':'__le')??this.meta(b,op==='LT'?'__lt':'__le');
   if(!nil(m))return luaTruthy(firstResult(this.call(m,[a,b])));throw new LuaExecutionError('Invalid comparison',{a,b,op});
  }return op==='GE'?!this.compare('LT',a,b):!this.compare('LE',a,b);
 }
 length(v){
  if(typeof v==='string')return new TextEncoder().encode(v).length;
  if(v instanceof LuaTable){const m=this.meta(v,'__len');return nil(m)?v.length():firstResult(this.call(m,[v]));}
  if(Array.isArray(v))return v.length;throw new LuaExecutionError('Length of non-string/table');
 }
 execute(closure,args){
  const p=closure.proto,code=p.code,ns=p.numeric??[],cs=p.constants??[];
  const r=Array.from({length:p.frame??256},()=>({__cell:true,value:null}));
  const get=i=>r[i]?.value??null,put=(i,v)=>{if(!r[i])r[i]={__cell:true,value:null};r[i].value=norm(v);};
  args.slice(0,p.a??p.args??0).forEach((v,i)=>put(i,v));
  const va=args.slice(p.a??p.args??0),uv=closure.upvalues,k=i=>this.constant(cs[cs.length-1-i],p._bundle??this.prototypes),pri=i=>[null,false,true][i];
  let pc=0,mc=0;const argOffset=this.fr2?2:1,close=base=>{for(let i=base;i<r.length;i++)r[i]={__cell:true,value:get(i)};};
  while(pc<code.length){
   if(++this.steps>this.maxInstructions)throw new LuaExecutionError('Instruction budget exceeded',{prototype:p.id,pc:pc+1});
   const current=pc,w=code[pc++]>>>0,A=(w>>>8)&255,B=w>>>24,C=(w>>>16)&255,D=w>>>16,op=this.opcodeNames[w&255],j=D-0x8000;
   try{
    if(this.trace)this.trace({prototype:p.id,pc:current+1,op,A,B,C,D,registers:r.map(x=>x.value)});
    const test=ok=>{if(!ok)pc++;};
    switch(op){
     case'ISLT':case'ISGE':case'ISLE':case'ISGT':test(this.compare(op.slice(2),get(A),get(D)));break;
     case'ISEQV':test(this.equal(get(A),get(D)));break;case'ISNEV':test(!this.equal(get(A),get(D)));break;
     case'ISEQS':test(this.equal(get(A),k(D)));break;case'ISNES':test(!this.equal(get(A),k(D)));break;
     case'ISEQN':test(this.equal(get(A),ns[D]));break;case'ISNEN':test(!this.equal(get(A),ns[D]));break;
     case'ISEQP':test(this.equal(get(A),pri(D)));break;case'ISNEP':test(!this.equal(get(A),pri(D)));break;
     case'ISTC':if(luaTruthy(get(D)))put(A,get(D));else pc++;break;case'ISFC':if(!luaTruthy(get(D)))put(A,get(D));else pc++;break;
     case'IST':test(luaTruthy(get(D)));break;case'ISF':test(!luaTruthy(get(D)));break;
     case'MOV':put(A,get(D));break;case'NOT':put(A,!luaTruthy(get(D)));break;case'UNM':put(A,-this.number(get(D)));break;case'LEN':put(A,this.length(get(D)));break;
     case'ADDVN':case'SUBVN':case'MULVN':case'DIVVN':case'MODVN':put(A,this.binary(op.slice(0,3),get(B),ns[C]));break;
     case'ADDNV':case'SUBNV':case'MULNV':case'DIVNV':case'MODNV':put(A,this.binary(op.slice(0,3),ns[C],get(B)));break;
     case'ADDVV':case'SUBVV':case'MULVV':case'DIVVV':case'MODVV':put(A,this.binary(op.slice(0,3),get(B),get(C)));break;
     case'POW':put(A,this.binary('POW',get(B),get(C)));break;
     case'CAT':{let s='';for(let i=B;i<=C;i++){const v=get(i);if(typeof v!=='string'&&typeof v!=='number')throw Error('Invalid concatenation');s+=v;}put(A,s);break;}
     case'KSTR':put(A,k(D));break;case'KSHORT':put(A,D<32768?D:D-65536);break;case'KNUM':put(A,ns[D]);break;case'KPRI':put(A,pri(D));break;
     case'KNIL':for(let i=A;i<=D;i++)put(i,null);break;
     case'UGET':if(!uv[D])throw Error('Missing upvalue '+D);put(A,uv[D].value);break;
     case'USETV':if(!uv[A])throw Error('Missing upvalue '+A);uv[A].value=get(D);break;
     case'USETS':if(!uv[A])throw Error('Missing upvalue '+A);uv[A].value=k(D);break;
     case'USETN':if(!uv[A])throw Error('Missing upvalue '+A);uv[A].value=ns[D];break;
     case'USETP':if(!uv[A])throw Error('Missing upvalue '+A);uv[A].value=pri(D);break;
     case'UCLO':close(A);pc+=j;break;
     case'FNEW':{
      const cp=k(D);if(!cp?.code)throw Error('FNEW needs prototype');
      const refs=(cp.uv??[]).map(ref=>(ref&0x8000)?r[ref&0x3fff]:uv[ref&0x3fff]);
      if(refs.some(x=>!x))throw Error('Unresolved closure upvalue');put(A,new LuaClosure(this,cp,refs));break;
     }
     case'TNEW':put(A,new LuaTable());break;case'TDUP':put(A,k(D));break;
     case'GGET':put(A,norm(this.globals[k(D)]));break;case'GSET':this.globals[k(D)]=get(A);break;
     case'TGETV':case'TGETR':put(A,this.get(get(B),get(C)));break;case'TGETS':put(A,this.get(get(B),k(C)));break;case'TGETB':put(A,this.get(get(B),C));break;
     case'TSETV':this.set(get(B),get(C),get(A));break;case'TSETR':this.rawset(get(B),get(C),get(A));break;case'TSETS':this.set(get(B),k(C),get(A));break;case'TSETB':this.set(get(B),C,get(A));break;
     case'TSETM':{
      const buf=new ArrayBuffer(8),dv=new DataView(buf);dv.setFloat64(0,ns[D],true);const start=dv.getUint32(0,true);
      for(let i=0;i<mc;i++)this.set(get(A-1),start+i,get(A+i));break;
     }
     case'CALL':case'CALLM':case'CALLT':case'CALLMT':{
      const tail=op==='CALLT'||op==='CALLMT',m=op==='CALLM'||op==='CALLMT',count=(tail?D:C)-(m?0:1)+(m?mc:0);
      const ar=Array.from({length:count},(_,i)=>get(A+argOffset+i)),out=allResults(this.call(get(A),ar));
      if(tail)return multi(...out);
      if(B===0){mc=out.length;out.forEach((v,i)=>put(A+i,v));}else for(let i=0;i<B-1;i++)put(A+i,out[i]);break;
     }
     case'ITERC':case'ITERN':{const out=allResults(this.call(get(A-3),[get(A-2),get(A-1)]));for(let i=0;i<B-1;i++)put(A+i,out[i]);break;}
     case'ISNEXT':pc+=j;break;
     case'VARG':if(B===0){mc=va.length;va.forEach((v,i)=>put(A+i,v));}else for(let i=0;i<B-1;i++)put(A+i,va[i]);break;
     case'RETM':return multi(...Array.from({length:D+mc},(_,i)=>get(A+i)));
     case'RET':return multi(...Array.from({length:D-1},(_,i)=>get(A+i)));case'RET0':return multi();case'RET1':return multi(get(A));
     case'FORI':{
      const init=this.number(get(A)),limit=this.number(get(A+1)),step=this.number(get(A+2));put(A,init);put(A+1,limit);put(A+2,step);put(A+3,init);
      if(step>=0?init>limit:init<limit)pc+=j;break;
     }
     case'FORL':case'IFORL':{
      const step=this.number(get(A+2)),v=this.number(get(A))+step;put(A,v);
      if(step>=0?v<=get(A+1):v>=get(A+1)){put(A+3,v);pc+=j;}break;
     }
     case'ITERL':case'IITERL':if(!nil(get(A))){put(A-1,get(A));pc+=j;}break;
     case'LOOP':case'ILOOP':break;case'JMP':pc+=j;break;
     default:throw new LuaExecutionError('Unsupported opcode; execution stopped',{opcode:w&255,op});
    }
   }catch(e){
    const frame={module:p._module,function:closure.displayName??p.name??p.id??'anonymous',prototype:p.id??'anonymous',pc:current+1,opcode:w&255,op,A,B,C,D};
    if(e instanceof LuaExecutionError&&e.details?.prototype){e.details.luaStack??=[];e.details.luaStack.push(frame);throw e;}
    throw new LuaExecutionError(e.message,{...e.details,...frame,luaStack:[frame]});
   }
  }return multi();
 }
}
