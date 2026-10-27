import assert from 'node:assert/strict';
import {LuaVM,firstResult,allResults,multi,LuaTable} from '../dist/runtime/lua-vm.mjs';
const AD=(op,a,d)=>((d<<16)|(a<<8)|op)>>>0,ABC=(op,a,b,c)=>((b<<24)|(c<<16)|(a<<8)|op)>>>0,J=(a,d)=>AD(0x58,a,d+0x8000);
const vm=new LuaVM();
const proto=(code,{args=0,frame=16,constants=[],numeric=[],uv=[]}={})=>({args,frame,code,constants,numeric,uv});
assert.equal(vm.runFirst(proto([AD(0x21,0,4),AD(0x21,1,5),ABC(0x31,2,0,1),AD(0x4c,2,2)])),20);
assert.equal(vm.runFirst(proto([AD(0x21,0,0),AD(0x21,1,1),AD(0x21,2,5),AD(0x21,3,1),AD(0x4d,1,32770),ABC(0x2f,0,0,4),AD(0x4f,1,32766),AD(0x4c,0,2)])),15);
vm.globals.producer=()=>multi('left','right');
vm.globals.consumer=(...xs)=>JSON.stringify(xs);
const cm=proto([
 AD(0x14,0,0),AD(0x1f,2,1),AD(0x14,3,2),ABC(0x42,3,0,1),ABC(0x41,0,2,1),AD(0x4c,0,2)
],{constants:['producer','self','consumer']});
assert.equal(vm.runFirst(cm),'["self","left","right"]','CALLM must include C fixed arguments');
const iter=proto([
 AD(0x14,1,0),AD(0x36,3,0),ABC(0x42,1,4,2),AD(0x21,0,0),J(4,1),
 ABC(0x2f,0,0,5),ABC(0x45,4,3,3),AD(0x52,4,32765),AD(0x4c,0,2)
],{args:1,constants:['ipairs']});
assert.equal(vm.runFirst(iter,[vm.table([10,20,30])]),60);
const root={id:'root',a:0,frame:3,uv:[],numeric:[],constants:[{$proto:'child'}],code:[
 AD(0x21,0,10),AD(0x40,1,0),AD(0x21,0,20),AD(0x3f,0,32768),AD(0x21,0,30),AD(0x4c,1,2)
]};
const child={id:'child',a:0,frame:1,uv:[0x8000],numeric:[],constants:[],code:[AD(0x3a,0,0),AD(0x4c,0,2)]};
const f=firstResult(vm.call(vm.load({root:'root',prototypes:{root,child},fr2:true}),[]));
assert.equal(firstResult(vm.call(f,[])),20,'UCLO must preserve closed captured cells');
const base=vm.table({a:7}),object=vm.table({});
object.metatable=vm.table({__index:base});assert.equal(vm.get(object,'a'),7);
assert.throws(()=>vm.runFirst(proto([255])),/Unsupported opcode/);
assert.throws(()=>vm.runFirst(proto([AD(0x14,0,0),ABC(0x42,0,1,1)],{constants:['missing']})),/missing or non-callable/);
console.log('VM semantic tests: arithmetic, numerical/generic loops, FR2 multi-return calls, closures, UCLO, metatables, fail-closed guards passed');

// Game addHp uses private 0x1d AD with numeric K=2^52+5 for a final multireturn
// table constructor; 0x1e is the following ABC raw-store opcode.
vm.globals.tailValues=()=>multi('fifth','sixth');
const multiTable=proto([
 AD(0x12,0,0),AD(0x1f,1,1),ABC(0x1c,1,0,1),
 AD(0x14,1,0),ABC(0x42,1,0,1),AD(0x1d,1,0),AD(0x4c,0,2)
],{constants:['first','tailValues'],numeric:[4503599627370501]});
const appended=vm.runFirst(multiTable);
assert.equal(vm.get(appended,1),'first');
assert.equal(vm.get(appended,5),'fifth');
assert.equal(vm.get(appended,6),'sixth');
assert.equal(vm.get(appended,2),null);
const indexedTable=proto([ABC(0x1e,2,0,1),AD(0x4c,0,2)],{args:3});
const indexed=vm.table({});let writes=0;
indexed.metatable=vm.table({__newindex:()=>{writes++;}});
assert.equal(vm.runFirst(indexedTable,[indexed,7,'raw']),indexed);
assert.equal(vm.rawget(indexed,7),'raw','TSETR is ABC and performs raw indexed assignment');
assert.equal(writes,0,'TSETR does not invoke __newindex');
console.log('Private 0x1d TSETM and 0x1e TSETR operand/semantic distinction passed');
