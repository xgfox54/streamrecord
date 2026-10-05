'use strict';
// Production browser QA with synthetic records and simulated native commands.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {pathToFileURL}=require('node:url');
const fixture=require('./jeju-browser-fixture.cjs');
const root=path.resolve(__dirname,'../out');
const evidence=path.resolve(__dirname,'../test-results/correction-override');
const row=(text,candidate,reason,sequence_id)=>({text,sequence_id,is_partial:false,audio_start_time:sequence_id*10,ai_correction_issue:{version:1,source_text:text,model_key:'local:검증용 AI',glossary:'',reason,candidate_text:candidate}});
const scenario={models:[{id:'검증용 AI',provider:'local'}],snapshot:{version:1,title:'보류된 AI 보정 확인',minutes:'',startedAt:null,rows:[row('예산은 10만원입니다.','예산은 11만 원입니다.','numbers',1),row('다음 회의에서 충분히 논의하고 검토한 결과를 함께 공유하겠습니다.','결과를 공유합니다.','length',2)]}};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
 const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
 if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
 fs.readFile(file,(err,bytes)=>{if(err)return res.writeHead(404).end();res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(file.endsWith('index.html')?bytes.toString().replace('<head>','<head><script>('+fixture.toString()+')('+JSON.stringify(scenario)+');</script>'):bytes);});
});
async function waitFor(page,predicate){
 const deadline=Date.now()+10000;
 while(Date.now()<deadline){if(await page.evaluate(predicate))return;await new Promise(resolve=>setTimeout(resolve,50));}
 throw new Error('Browser state did not become ready');
}
(async()=>{
 fs.mkdirSync(evidence,{recursive:true});
 const loaderPath=process.env.STREAM_RECORD_BROWSER_LOADER||'C:/Users/USER/.codex/plugins/cache/sisyphuslabs/omo/5.1.8/skills/browser/scripts/omowright.mjs';
 const {loadOmowright}=await import(pathToFileURL(loaderPath).href);const {omowright}=await loadOmowright();
 const profile=fs.mkdtempSync(path.join(evidence,'profile-'));
 let browser;
 const checks=[];
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();assert.ok(address&&typeof address==='object');
  browser=await omowright.connectPipe({browserPath:'C:/Program Files/Google/Chrome/Application/chrome.exe',browserArgs:['--headless','--no-first-run',`--user-data-dir=${profile}`],storageRoot:profile});
  for(const width of [375,768,1280]){
   const page=await browser.newTab('about:blank');
   await page.goto(`http://127.0.0.1:${address.port}/#dictation`);
   await omowright.emulate(page,{width,height:1000,deviceScaleFactor:1,mobile:false,hasTouch:false});
   await waitFor(page,()=>Boolean(document.querySelector('[class*="correctionNotice"]')));
   await page.evaluate(()=>document.querySelector('[class*="correctionNotice"]').scrollIntoView({block:'center'}));
   const before=await page.evaluate(()=>{
    const notice=document.querySelector('[class*="correctionNotice"]');const p=notice.querySelector('p');const button=notice.querySelector('button');const main=document.querySelector('main');
    return {font:parseFloat(getComputedStyle(p).fontSize),body:parseFloat(getComputedStyle(document.querySelector('[class*="workspace"]')).fontSize),buttonFont:parseFloat(getComputedStyle(button).fontSize),button:button.textContent,breaks:p.querySelectorAll('br').length,overflow:document.documentElement.scrollWidth>innerWidth||main.scrollWidth>main.clientWidth,rect:notice.getBoundingClientRect().toJSON(),width:innerWidth};
   });
   assert.ok(Math.abs(before.body-before.font-8/3)<.01);assert.equal(before.button,'무시하고 보정 처리');assert.equal(before.breaks,2);assert.equal(before.overflow,false);assert.equal(before.width,width);
   fs.writeFileSync(path.join(evidence,`${width}-before.png`),await page.screenshot());
   await page.evaluate(()=>document.querySelector('[class*="correctionNotice"] button').focus());
   fs.writeFileSync(path.join(evidence,`${width}-focus.png`),await page.screenshot());
   await page.click('[class*="correctionNotice"] button');
   await waitFor(page,()=>!document.querySelector('[class*="correctionNotice"]'));
   const after=await page.evaluate(()=>{
    const calls=window.__qa.calls;const saved=calls.filter(call=>call.command==='ko_save_snapshot').at(-1);
    return {modelCalls:calls.filter(call=>call.command==='ko_generate').length,rows:JSON.parse(saved.args.content).rows};
   });
   assert.equal(after.modelCalls,0);assert.equal(after.rows[0].text,scenario.snapshot.rows[0].text);assert.equal(after.rows[0].ai_correction.text,scenario.snapshot.rows[0].ai_correction_issue.candidate_text);assert.equal(after.rows[0].ai_correction.checks_ignored,true);assert.equal(after.rows[1].ai_correction.text,scenario.snapshot.rows[1].ai_correction_issue.candidate_text);
   assert.equal(await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='AI 보정본').getAttribute('aria-pressed')),'true');
   await waitFor(page,()=>Boolean(Array.from(document.querySelectorAll('label')).find(label=>label.textContent==='원문 함께 보기')));
   await page.evaluate(()=>{const input=Array.from(document.querySelectorAll('label')).find(label=>label.textContent==='원문 함께 보기').querySelector('input');if(!input.checked)input.click();});
   await waitFor(page,()=>Boolean(document.querySelector('[class*="original"]')));
   await page.evaluate(()=>document.querySelector('[role="log"]').scrollIntoView({block:'start'}));
   fs.writeFileSync(path.join(evidence,`${width}-applied.png`),await page.screenshot());
   checks.push({width,before,after});await page.close();
  }
  fs.writeFileSync(path.join(evidence,'browser-qa.json'),JSON.stringify({scope:'Real production Chrome with simulated native/AI boundaries; no user records or paid model calls',checks},null,2));
  console.log('PASS override browser: 375/768/1280px; 2pt smaller; preserved original; applied candidates; no new model call');
 }finally{
  if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
  const resolved=path.resolve(profile);assert.ok(resolved.startsWith(evidence+path.sep)&&path.basename(resolved).startsWith('profile-'));
  fs.rmSync(resolved,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
