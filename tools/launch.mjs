import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {startServer,defaultRoot} from './serve.mjs';
const required=['index.html','app.js','presentation/stage.mjs','data/catalog.json','data/presentation-assets.json'];
const missing=required.filter(p=>!fs.existsSync(defaultRoot+'/'+p));
if(missing.length){console.error('缺少应用文件：'+missing.join('、')+'。请保留整个项目目录。');process.exitCode=1;}
else if(process.argv.includes('--check'))console.log('启动文件检查通过；本机 Node '+process.version+'。');
else {
 let active;
 try {active=await startServer({port:4173});}catch(error){if(error.code==='EADDRINUSE')active=await startServer({port:0});else throw error;}
 console.log('\n烟雨江湖 · 演武台（原版战斗表现）\n'+active.url+'\n\n请保留此窗口；关闭窗口即可停止本地服务。无需联网或下载。\n');
 if(!process.argv.includes('--no-browser')){
  const url=active.url;
  if(process.platform==='win32')spawn('cmd.exe',['/d','/s','/c',`start "" "${url}"`],{windowsHide:true,stdio:'ignore'}).on('error',()=>console.log('请手动打开上方地址。'));
  else console.log('请在浏览器打开上方地址。');
 }
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>active.server.close(()=>process.exit(0)));
}
