import assert from 'node:assert/strict';
import {LuaVM,LuaTable,PRIVATE_OPCODE_NAMES,allResults} from '../dist/runtime/lua-vm.mjs';

// Language contract, not a native hash-order fixture:
// https://www.lua.org/manual/5.1/manual.html#pdf-next
// Existing fields may be cleared while traversing; newly added fields and the
// original game's private LuaJIT hash order are outside this guarantee.
// Upstream retains node keys while skipping nil values:
// https://github.com/LuaJIT/LuaJIT/blob/v2.1/src/lj_tab.c#L534-L594
const vm=new LuaVM(),next=(t,k=null)=>allResults(vm.globals.next(t,k));
const collect=t=>{const out=[];let key=null;for(let n=0;n<100;n++){const row=next(t,key);if(row[0]==null)return out;out.push(row);key=row[0];}throw Error('Traversal did not terminate');};
const checks=[];
const check=(name,fn)=>{fn();checks.push(name);};

check('clearing current keys visits each live entry once',()=>{
 const t=vm.table({a:1,b:2,c:3}),seen=[];let key=null;
 for(let n=0;n<4;n++){const row=next(t,key);if(row[0]==null)break;key=row[0];seen.push(row);vm.rawset(t,key,null);}
 assert.deepEqual(seen,[['a',1],['b',2],['c',3]]);
 assert.deepEqual(next(t,key),[null]);assert.equal(t.size,0);assert.deepEqual([...t.entries],[]);
 assert.equal(vm.rawget(t,'a'),null);assert.deepEqual(collect(t),[]);
});
check('clearing later keys skips them and reads updated existing values',()=>{
 const t=vm.table({a:1,b:2,c:3});const [first]=next(t);
 vm.rawset(t,'b',null);vm.rawset(t,'c',30);vm.rawset(t,first,null);
 assert.deepEqual(next(t,first),['c',30]);assert.deepEqual(next(t,'c'),[null]);
});
check('numeric sparse keys and false cursor remain valid after deletion',()=>{
 const t=new LuaTable([[0,'zero'],[7,'seven'],[-2,'negative'],[false,'false'],[true,'true']]);
 let cursor=null;
 for(const key of [0,7,-2,false,true]){assert.equal(next(t,cursor)[0],key);vm.rawset(t,key,null);cursor=key;}
 assert.deepEqual(next(t,true),[null]);assert.equal(t.length(),0);
});
check('nested iterators on the same table keep independent cursors',()=>{
 const t=vm.table({a:1,b:2,c:3}),[outer]=next(t),[inner]=next(t);
 assert.equal(outer,'a');assert.equal(inner,'a');vm.rawset(t,'a',null);
 const [innerSecond]=next(t,inner);assert.equal(innerSecond,'b');vm.rawset(t,'b',null);
 assert.deepEqual(next(t,outer),['c',3]);assert.deepEqual(next(t,innerSecond),['c',3]);
});
check('reinsertion after traversal reuses one slot without duplicate visits',()=>{
 const t=vm.table({a:1,b:2});collect(t);vm.rawset(t,'a',null);vm.rawset(t,'a',10);
 assert.deepEqual(collect(t),[['a',10],['b',2]]);assert.equal(t.size,2);
 assert.equal(vm.rawget(t,'a'),10);assert.deepEqual(next(t,'a'),['b',2]);
});
check('table and function keys use identity even when __eq says equal',()=>{
 const left=vm.table({}),right=vm.table({}),equal=()=>true;
 left.metatable=right.metatable=vm.table({__eq:equal});assert.equal(vm.equal(left,right),true);
 const fn=()=>{},t=new LuaTable([[left,1],[right,2],[fn,3],['1',4],[1,5]]);
 assert.deepEqual(next(t,left),[right,2]);vm.rawset(t,right,null);assert.deepEqual(next(t,right),[fn,3]);
 assert.deepEqual(next(t,fn),['1',4]);assert.deepEqual(next(t,'1'),[1,5]);
 assert.throws(()=>next(t,vm.table({})),/Invalid key to next/);
});
check('never-present, nil-only and NaN keys still fail closed',()=>{
 const t=vm.table({a:1});vm.rawset(t,'missing',null);
 for(const key of ['missing','other',NaN])assert.throws(()=>next(t,key),/Invalid key to next/);
 assert.throws(()=>vm.rawset(t,null,1),/Invalid table key/);assert.throws(()=>vm.rawset(t,NaN,1),/Invalid table key/);
});
check('delete before first next preserves an existing successor cursor',()=>{
 const t=vm.table({a:1,b:2});vm.rawset(t,'a',null);assert.deepEqual(next(t,'a'),['b',2]);
 assert.deepEqual(collect(t),[['b',2]]);assert.equal(t.size,1);assert.deepEqual(vm.unwrap(t),{b:2});
});

// Execute actual private ITERN/ITERC + ITERL instructions. The callback runs
// between iterator steps, and TSETV clears the current key in the bytecode.
const opcode=Object.fromEntries(Object.entries(PRIVATE_OPCODE_NAMES).map(([id,name])=>[name,Number(id)]));
const AD=(op,a,d)=>((d<<16)|(a<<8)|opcode[op])>>>0;
const ABC=(op,a,b,c)=>((b<<24)|(c<<16)|(a<<8)|opcode[op])>>>0;
for(const iterator of ['ITERN','ITERC'])check(`${iterator} bytecode resumes after TSETV deletion`,()=>{
 const seen=[],t=vm.table({'21751':9,'21753':7,'21759':3});vm.globals.observe=(key,value)=>{seen.push([key,value]);};
 const code=[AD('GGET',1,0),AD('MOV',3,0),ABC('CALL',1,4,2),AD('ISNEXT',4,0x8000+6),
  AD('GGET',6,1),AD('MOV',8,4),AD('MOV',9,5),ABC('CALL',6,1,3),AD('KPRI',6,0),ABC('TSETV',6,0,4),
  ABC(iterator,4,3,3),AD('ITERL',4,0x8000-8),AD('RET1',0,0)];
 const proto={id:'iteration-delete',args:1,frame:12,constants:['observe','pairs'],numeric:[],uv:[],code};
 assert.equal(vm.runFirst(proto,[t]),t);
 assert.deepEqual(seen,[['21751',9],['21753',7],['21759',3]]);assert.equal(t.size,0);
});
console.log(JSON.stringify({ok:true,checks,scope:'Lua 5.1 clearing-existing-fields contract and private VM opcodes; deterministic host order, no game-native hash-order equivalence claim'}));
