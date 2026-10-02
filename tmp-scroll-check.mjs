import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = normalize(dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p)=>{try{return statSync(p).isFile();}catch(e){return false;}});
const types = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.json':'application/json','.svg':'image/svg+xml','.ico':'image/x-icon' };
const server = createServer((req,res)=>{try{let p=normalize(join(root,decodeURIComponent(req.url.split('?')[0])));if(!p.startsWith(root)){res.writeHead(403);res.end();return;}if(statSync(p).isDirectory())p=join(p,'index.html');res.writeHead(200,{'Content-Type':types[extname(p)]||'application/octet-stream'});res.end(readFileSync(p));}catch(e){res.writeHead(404);res.end('nf');}});
await new Promise((r)=>server.listen(0,'127.0.0.1',r));
const baseUrl='http://127.0.0.1:'+server.address().port;
const cdpPort=9821;
const chrome=spawn(chromePath,['--headless=new','--disable-gpu','--no-first-run','--user-data-dir='+join(process.env.TEMP||'/tmp','mochi-sc-'+Date.now()),'--remote-debugging-port='+cdpPort,'about:blank'],{stdio:'ignore'});
let ws=null,msgId=0;const pend=new Map();
for(let i=0;i<60;i++){try{const l=await(await fetch('http://127.0.0.1:'+cdpPort+'/json')).json();const pg=l.find(t=>t.type==='page');if(pg){ws=new WebSocket(pg.webSocketDebuggerUrl);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m.result);pend.delete(m.id);}};break;}}catch(e){}await sleep(150);}
const cdp=(method,params={})=>{const id=++msgId;return new Promise(res=>{pend.set(id,res);ws.send(JSON.stringify({id,method,params}));});};
const ev=async(expr)=>{try{const r=await cdp('Runtime.evaluate',{expression:expr,returnByValue:true});return r&&r.result?r.result.value:null;}catch(e){return null;}};
await cdp('Page.enable');await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
await cdp('Page.navigate',{url:baseUrl+'/index.html'});
await sleep(2500);
for(let i=0;i<40;i++){if(await ev('!!window.__mochiDataReady'))break;await sleep(300);}
await ev("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(600);
await ev("(function(){var b=document.getElementById('splash-confirm-ok');if(b)b.click();return true;})()");
await sleep(600);
// 多档视口：各页 scrollTop=0 时，三页第一行图标的屏幕位置 + 溢出量
for (const [vw, vh] of [[390, 844], [390, 800], [360, 640], [412, 768], [412, 915]]) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  const r = await ev(`(function(){
    document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-phone');});
    var slides=[].slice.call(document.querySelectorAll('#desktop-pages .page-slide'));
    slides.forEach(function(sl){sl.scrollTop=0;});
    var out=slides.map(function(sl,pi){var sr=sl.getBoundingClientRect();var g=sl.querySelector('.app-grid');var r=g.getBoundingClientRect();return {pi:pi,gridTop:+((r.top-sr.top).toFixed(1)),gridBottom:+((r.bottom-sr.top).toFixed(1)),ovf:Math.max(0,sl.scrollHeight-sl.clientHeight)};});
    return JSON.stringify(out);
  })()`);
  console.log(vw + '×' + vh + ' => ' + r);
}
try{ws.close();}catch(e){}try{chrome.kill();}catch(e){}try{server.close();}catch(e){}
