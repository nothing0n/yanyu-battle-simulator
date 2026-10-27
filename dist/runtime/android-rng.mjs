// Captured 73460 JHCommonUtils PRNG and the wapp startup math overrides.
// Verified by executing ARM64 setWhaleSeed/getWhaleRand directly: 1536 raw
// outputs, including uint32 boundary seeds, match the BigInt recurrence.
// Original Lua override: no args => raw/2147483647; one/two => fmod interval.
import {LuaExecutionError} from './lua-vm.mjs';
const MASK48=(1n<<48n)-1n,A=25214903917n,C=11n;
export class AndroidIntegerRNG {
 constructor(seed=1){this.seed(seed);}
 seed(value){
  if(!Number.isFinite(Number(value)))throw new LuaExecutionError('Invalid randomseed');
  this.state=(BigInt(Number(value)>>>0)<<16n)|0x330en;
 }
 next31(){this.state=(A*this.state+C)&MASK48;return Number(this.state>>17n);}
 random(...args){
  const raw=this.next31();
  if(args.length===0||args[0]==null)return raw/2147483647;
  const a=Number(args[0]);
  if(args.length===1||args[1]==null)return raw%a+1;
  return raw%(Number(args[1])-a+1)+a;
 }
 integer(low,high){return high===undefined?this.random(low):this.random(low,high);}
 snapshot(){return this.state.toString();}
}
export function installAndroidIntegerRNG(vm,{seed=1,time=()=>Math.floor(Date.now()/1000)}={}){
 const rng=new AndroidIntegerRNG(seed);
 vm.globals.math.randomseed=value=>{rng.seed(value);};
 vm.globals.math.random=(...args)=>rng.random(...args);
 vm.globals.os={...(vm.globals.os??{}),time};
 return rng;
}
