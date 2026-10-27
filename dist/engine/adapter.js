import {evaluateAttack} from './evaluate-attack.mjs';
import {runOriginalBattle} from './battle-runner.mjs';
export function createEngine(options={}){
  let worker=null,sequence=0;const waiting=new Map();
  const invoke=(method,input)=>{
    if(typeof Worker==='undefined'||options.readJSON||options.worker===false)return method==='evaluateAttack'?evaluateAttack(input,options):runOriginalBattle(input,options);
    if(!worker){
      worker=new Worker(new URL('./worker.mjs',import.meta.url),{type:'module'});
      worker.onmessage=event=>{const msg=event.data,p=waiting.get(msg.id);if(!p)return;waiting.delete(msg.id);if(msg.ok)p.resolve(msg.value);else{const e=new Error(msg.error.message);e.name=msg.error.name;e.details=msg.error.details;p.reject(e);}};
      worker.onerror=event=>{for(const p of waiting.values())p.reject(new Error(event.message||'战斗计算线程加载失败'));waiting.clear();worker.terminate();worker=null;};
    }
    return new Promise((resolve,reject)=>{const id=++sequence;waiting.set(id,{resolve,reject});worker.postMessage({id,method,input});});
  };
  return {ready:true,status:'experimental',partial:true,description:'运行已提取的原始战斗代码与武学配置；输入已结算面板。尚未完成与游戏实战逐帧对照，结果用于研究与对比。',
    capabilities:{battle:true,batch:true,formula:true},
    evaluateAttack:input=>invoke('evaluateAttack',input),run:config=>invoke('run',config),
    dispose(){worker?.terminate();worker=null;for(const p of waiting.values())p.reject(new Error('计算已结束'));waiting.clear();}};
}
export default createEngine();
