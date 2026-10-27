import {compileLiteral} from '../integration/lua-literal.mjs';

/** Original JHBaseRole.resetBaseHeight with the original serialized model.
 * Native node geometry and scene z-order are deliberately outside this resolver.
 */
export function createDimensionsResolver(runtime,roleBundle,kidFrames){
 const {vm,callMethod,firstMethod}=runtime;
 runtime.require('app/ai/JHAIConfig');
 vm.globals.loadstring ||=source=>compileLiteral(vm,source);
 vm.load(roleBundle,'presentation/JHBaseRole.dimensions');
 // The convenience method index can conflate identical instruction streams with
 // distinct constants. Resolve the exact original root declaration instead.
 const root=roleBundle.prototypes[roleBundle.root||'root'],constants=root.constants;
 const at=constants.indexOf('resetBaseHeight'),id=constants[at-1]?.$proto;
 if(!id)throw new Error('Original resetBaseHeight declaration is unavailable');
 const ctorId=constants[constants.indexOf('ctor')-1]?.$proto;
 const superClass=vm.table({super:{ctor:(self,model)=>vm.set(self,'Model',model)}});
 const frames=kidFrames?.entries?kidFrames:vm.table(kidFrames);
 const ctor=vm.closure(roleBundle.prototypes[ctorId],[superClass,frames]);
 const reset=vm.closure(roleBundle.prototypes[id],[kidFrames?.entries?kidFrames:vm.table(kidFrames)]);
 return {resolve(owner){
  const model=runtime.instantiate('app/data/JHBattleData');
  callMethod(model,'initWithConver',vm.table(owner));
  const actor=vm.table({Model:model,setState:()=>{},updateColor:()=>{},updateCloth:()=>{}});
  vm.call(ctor,[actor,model]);vm.call(reset,[actor]);
  const result={roleHeight:vm.get(actor,'m_nBaseHeight'),moreWidth:vm.get(actor,'m_nMoreWidth'),shadowScale:vm.get(actor,'m_nShadowScale'),source:{module:'JHBaseRole',method:'resetBaseHeight',prototype:id}};
  if(vm.get(model,'getWave'))result.wave=firstMethod(model,'getWave');
  result.dute=firstMethod(model,'getDute');
  for(const key of ['roleHeight','moreWidth','shadowScale'])if(!Number.isFinite(result[key]))throw new Error(`Original ${key} did not resolve for actor ${owner.ID}`);
  return result;
 }};
}
