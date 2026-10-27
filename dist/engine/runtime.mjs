import {LuaVM,LuaTable,firstResult,multi} from '../runtime/lua-vm.mjs';
import {installAndroidIntegerRNG} from '../runtime/android-rng.mjs';

const fileCache=new Map();
async function cachedJSON(url){const key=String(url);if(!fileCache.has(key))fileCache.set(key,fetch(url).then(async r=>{if(!r.ok)throw new Error('无法读取 '+url+': '+r.status);return r.json();}).catch(error=>{fileCache.delete(key);throw error;}));return fileCache.get(key);}

export class MissingRuntimeDependency extends Error {
  constructor(path){super(`原始战斗运行库尚未接入：${path}`);this.name='MissingRuntimeDependency';this.path=path;}
}

/** Load original bytecode modules. Only I/O, cleartext config and class glue live here. */
export async function createRuntime(options={}){
  const read=options.readJSON || cachedJSON;
  const readOptional=async url=>{try{return await read(url);}catch(e){if(options.requireIntegration)throw e;return {};}};
  const [engineIndex,actorIndex,tablesRaw]=await Promise.all([
    read(new URL('./module-index.json',import.meta.url)),
    readOptional(new URL('../integration/manifest.json',import.meta.url)),
    read(new URL('../data/runtime-tables-typed.json',import.meta.url))
  ]);
  const registry=new Map();
  for(const [base,index] of [[new URL('./',import.meta.url),engineIndex],[new URL('../integration/',import.meta.url),actorIndex]])
    for(const [name,item] of Object.entries(index.modules||index)){
      if(typeof item==='string')registry.set(name,{url:new URL(item,base)});
      else if(item&&item.file)registry.set(name,{url:new URL(item.file,base)});
    }
  await Promise.all([...registry.values()].map(async item=>{item.bundle=await read(item.url);}));
  const instructionBudget=Number(options.instructionBudget??5000000);
  if(!Number.isSafeInteger(instructionBudget)||instructionBudget<1)throw new Error('instructionBudget must be a positive safe integer.');
  const vm=new LuaVM({maxInstructions:instructionBudget});
  // A replay uses one frozen host clock for original timed buffs and RNG wrappers.
  const nowSeconds=Number(options.nowSeconds??1792800000);
  if(!Number.isFinite(nowSeconds)||nowSeconds<0)throw new Error('nowSeconds must be a non-negative Unix timestamp in seconds.');
  const nativeRng=installAndroidIntegerRNG(vm,{seed:options.seed||1,time:()=>nowSeconds});
  const modules=new Map(), loading=new Set(), missing=new Set();
  const g=vm.globals;
  const call=(fn,args=[])=>vm.call(fn,args);
  const first=(fn,args=[])=>firstResult(call(fn,args));
  const setmeta=(object,mt)=>first(g.setmetatable,[object,mt]);
  const getmeta=object=>first(g.getmetatable,[object]);
  const clone=(v,seen=new Map())=>{
    if(!(v instanceof LuaTable))return v;
    if(seen.has(v))return seen.get(v);
    const result=vm.table({});seen.set(v,result);
    const entries=v.map||v.entries||v.data;
    if(!(entries instanceof Map))throw new Error('LuaTable iteration API unavailable');
    for(const [k,value] of entries)vm.set(result,clone(k,seen),clone(value,seen));
    const mt=getmeta(v);if(mt)setmeta(result,mt);
    return result;
  };
  g.class=(name,parent)=>{
    const cls=vm.table({__cname:name,super:parent});
    if(parent)setmeta(cls,vm.table({__index:parent}));
    vm.set(cls,'new',(...args)=>{
      const instance=vm.table({class:cls});setmeta(instance,vm.table({__index:cls}));
      const ctor=vm.get(instance,'ctor');if(ctor)call(ctor,[instance,...args]);
      return instance;
    });
    vm.set(cls,'create',vm.get(cls,'new'));
    return cls;
  };
  g.table.nums=value=>value instanceof LuaTable?value.entries.size:Object.keys(value).length;
  g.clone=v=>clone(v);
  g.encrytTable=v=>v;
  g.decryptTable=v=>v;
  g.ngx=vm.table({var:{}});
  g.JH_CHANNEL_ID='mi_android';g.JH_IS_CHINESE=true;g.JH_IN_CHINA=true;g.JH_PARTNER_MORE_LEVEL=2;
  g.JH_ALL_MISS=false;g.JH_ALL_PARRY=false;g.JH_ALL_KILL=false;g.JH_ALL_SUB1=false;
  g.JHOSTimeSec=()=>nowSeconds;
  g.print=(...args)=>options.onPrint?.(...args);
  g.dump=()=>{};
  g.handler=(object,fn)=>(...args)=>call(fn,[object,...args]);
  const tables=new LuaTable();
  for(const [name,value] of Object.entries(tablesRaw.tables||tablesRaw))tables.rawset(name,vm.constant(value));
  const configFor=name=>{
    const t=vm.get(tables,name);
    if(t==null)throw new MissingRuntimeDependency(`config/${name}`);
    return t;
  };
  function requireModule(name){
    if(modules.has(name))return modules.get(name);
    if(name==='config'||name==='cocos.cocos2d.functions'){const t=vm.table({});modules.set(name,t);return t;}
    if(name.startsWith('app/excel/'))return configFor(name.slice('app/excel/'.length));
    const item=registry.get(name);
    if(!item){
      // An unneeded import may load; touching its members fails explicitly.
      missing.add(name);
      const unsupported=vm.table({});
      setmeta(unsupported,vm.table({__index:(_self,key)=>{throw new MissingRuntimeDependency(name+'.'+key);},__call:()=>{throw new MissingRuntimeDependency(name);}}));
      modules.set(name,unsupported);return unsupported;
    }
    if(loading.has(name))throw new Error(`循环模块依赖: ${name}`);
    loading.add(name);
    try{
      const value=first(vm.load(item.bundle,name),[]);
      modules.set(name,value??true);
      if(name==='app/excelutils/JHExcelUtils'){
        vm.set(value,'getConfig',configFor);
      }
      return value??true;
    }catch(e){e.message=`${name}: ${e.message}`;throw e;}
    finally{loading.delete(name);}
  }
  g.require=requireModule;
  for(const [name,module] of Object.entries(options.modules||{}))modules.set(name,module);
  const callMethod=(object,name,...args)=>{
    const fn=vm.get(object,name);if(!fn)throw new MissingRuntimeDependency(`method/${name}`);
    return call(fn,[object,...args]);
  };
  const firstMethod=(object,name,...args)=>firstResult(callMethod(object,name,...args));
  const instantiate=(name,...args)=>{
    const cls=requireModule(name),ctor=vm.get(cls,'new');
    if(!ctor)throw new MissingRuntimeDependency(name+'.new');
    return first(ctor,args);
  };
  return {vm,require:requireModule,instantiate,callMethod,firstMethod,tables,modules,registry,missing,clone,seed:options.seed||1,nowSeconds,instructionBudget,configFor,nativeRng,finishBootstrap(){}};
}
