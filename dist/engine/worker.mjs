import {evaluateAttack} from './evaluate-attack.mjs';
import {runOriginalBattle} from './battle-runner.mjs';
let queue=Promise.resolve();
self.onmessage=event=>{
 const {id,method,input}=event.data;
 queue=queue.then(async()=>{
  try{const value=await (method==='evaluateAttack'?evaluateAttack(input):runOriginalBattle(input));self.postMessage({id,ok:true,value});}
  catch(error){self.postMessage({id,ok:false,error:{name:error.name,message:error.message,details:error.details||null}});}
 });
};
