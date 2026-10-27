import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
export const defaultRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../dist');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.wasm':'application/wasm','.atlas':'text/plain; charset=utf-8','.skel':'application/octet-stream','.fnt':'text/plain; charset=utf-8','.plist':'application/xml; charset=utf-8','.tmx':'application/xml; charset=utf-8','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav','.m4a':'audio/mp4','.ttf':'font/ttf','.otf':'font/otf','.woff':'font/woff','.woff2':'font/woff2'};
export function createStaticHandler(root=defaultRoot){
 root=path.resolve(root);
 return async (req,res)=>{
  const end=(status,text,headers={})=>{res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','X-Content-Type-Options':'nosniff',...headers});res.end(req.method==='HEAD'?'':text);};
  if(!['GET','HEAD'].includes(req.method)){end(405,'Method not allowed',{'Allow':'GET, HEAD'});return;}
  let name;try{name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{end(400,'Invalid URL');return;}
  if(name==='/__yanyu_health'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(req.method==='HEAD'?'':JSON.stringify({app:'yanyu-battle-simulator',mode:'original-presentation',version:2}));return;}
  const target=path.resolve(root,'.'+(name==='/'?'/index.html':name));
  if((target!==root&&!target.startsWith(root+path.sep))||name.includes('\0')||name.includes('\\')){end(403,'Forbidden');return;}
  let stat;try{stat=await fs.promises.stat(target);}catch{end(404,'Not found');return;}
  if(!stat.isFile()){end(404,'Not found');return;}
  let start=0,finish=stat.size-1,status=200;
  const headers={'Content-Type':mime[path.extname(target).toLowerCase()]||'application/octet-stream','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes','Cache-Control':name.startsWith('/assets/')?'public, max-age=3600':'no-store'};
  if(req.headers.range){
   const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
   if(!match||(!match[1]&&!match[2])){end(416,'Invalid range',{'Content-Range':`bytes */${stat.size}`});return;}
   if(!match[1]){const suffix=Number(match[2]);if(suffix<=0){end(416,'Invalid range',{'Content-Range':`bytes */${stat.size}`});return;}start=Math.max(0,stat.size-suffix);}else{start=Number(match[1]);if(match[2])finish=Math.min(finish,Number(match[2]));}
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(finish)||start<0||start>finish||start>=stat.size){end(416,'Range not satisfiable',{'Content-Range':`bytes */${stat.size}`});return;}
   status=206;headers['Content-Range']=`bytes ${start}-${finish}/${stat.size}`;
  }
  headers['Content-Length']=String(Math.max(0,finish-start+1));res.writeHead(status,headers);
  if(req.method==='HEAD'||stat.size===0){res.end();return;}
  const stream=fs.createReadStream(target,{start,end:finish});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
 };
}
export async function startServer({root=defaultRoot,port=Number(process.env.PORT||4173)}={}){
 const server=http.createServer(createStaticHandler(root));
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 return {server,url:`http://127.0.0.1:${server.address().port}/`};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 startServer().then(({url})=>console.log(`Local: ${url}`)).catch(error=>{console.error(error.message);process.exitCode=1;});
}
