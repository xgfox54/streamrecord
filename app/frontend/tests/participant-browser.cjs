'use strict';
// Production browser QA for participant labels, bold AI text beside originals, and the minutes folder button.
// Synthetic record, simulated native commands, no user data or AI calls.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {pathToFileURL}=require('node:url');
const fixture=require('./jeju-browser-fixture.cjs');
const root=path.resolve(__dirname,'../out');
const evidence=path.resolve(__dirname,'../test-results/participant-ui');
const row=(sequence_id,text,corrected,speakers,provisional)=>({text,sequence_id,is_partial:false,audio_start_time:sequence_id*10,audio_end_time:sequence_id*10+8,
 speaker_assignment:{sourceText:text,audioSha256:'a'.repeat(64),modelId:'Nemotron',speakers,...(provisional?{provisional:true}:{})},
 ...(corrected?{ai_correction:{version:1,source_text:text,model_key:'connection:dfc10000-0000-4000-8000-000000000001:gpt-6-luna@b73a6e4a',glossary:'',text:corrected}}:{})});
const scenario={models:[{id:'검증용 AI',provider:'local'}],snapshot:{version:1,title:'참여자 표시 확인',minutes:'# 참여자 표시 확인\n\n회의록 본문',startedAt:null,rows:[
 row(1,'오늘 회의를 시작 하겠습니다','오늘 회의를 시작하겠습니다.',[1]),
 row(2,'관광과 문화 스포츠로 활력을 불러놓을 수 있는 방안','관광과 문화 스포츠로 활력을 불어넣을 수 있는 방안',[2]),
 row(3,'예산은 다음 회의에서 논의합니다.',null,[3]),
 row(4,'네 맞습니다 저도 동의 합니다','네, 맞습니다. 저도 동의합니다.',[1,2],true)]}};
const wrap=()=>{try{localStorage.setItem('stream-record.option.ai-correction','false');localStorage.setItem('stream-record.option.live-summary','false');}catch{}const original=window.__TAURI_INTERNALS__.invoke;window.__TAURI_INTERNALS__.invoke=async(command,args)=>{if(command==='ko_open_exports_folder'){window.__qa.calls.push({command,args});return null;}return original(command,args);};};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
 const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
 if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
 fs.readFile(file,(err,bytes)=>{if(err)return res.writeHead(404).end();res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(file.endsWith('index.html')?bytes.toString().replace('<head>','<head><script>('+fixture.toString()+')('+JSON.stringify(scenario)+');('+wrap.toString()+')();</script>'):bytes);});
});
async function waitFor(page,predicate,label){
 const deadline=Date.now()+10000;
 while(Date.now()<deadline){if(await page.evaluate(predicate))return;await new Promise(resolve=>setTimeout(resolve,50));}
 throw new Error('Browser state did not become ready: '+label);
}
(async()=>{
 fs.mkdirSync(evidence,{recursive:true});
 const loaderPath=process.env.STREAM_RECORD_BROWSER_LOADER||'C:/Users/USER/.codex/plugins/cache/sisyphuslabs/omo/5.1.8/skills/browser/scripts/omowright.mjs';
 const {loadOmowright}=await import(pathToFileURL(loaderPath).href);const {omowright}=await loadOmowright();
 const profile=fs.mkdtempSync(path.join(evidence,'profile-'));
 let browser;const checks=[];
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();assert.ok(address&&typeof address==='object');
  browser=await omowright.connectPipe({browserPath:'C:/Program Files/Google/Chrome/Application/chrome.exe',browserArgs:['--headless','--no-first-run',`--user-data-dir=${profile}`],storageRoot:profile});
  for(const width of [375,768,1280]){
   const page=await browser.newTab('about:blank');
   await page.goto(`http://127.0.0.1:${address.port}/#dictation`);
   await omowright.emulate(page,{width,height:1000,deviceScaleFactor:1,mobile:false,hasTouch:false});
   await waitFor(page,()=>document.querySelectorAll('[data-testid="dictation-conversation"] article').length===4,'rows');
   const labels=await page.evaluate(()=>Array.from(document.querySelectorAll('[data-testid="dictation-conversation"] article')).map(article=>({speakers:Array.from(article.querySelectorAll('[data-speaker]')).map(node=>{const dot=node.querySelector('span');const style=getComputedStyle(dot);return {id:node.dataset.speaker,text:node.textContent,color:style.backgroundColor,width:parseFloat(style.width),height:parseFloat(style.height),round:style.borderRadius,hidden:dot.getAttribute('aria-hidden')};}),meta:article.querySelector('div').textContent})));
   assert.deepEqual(labels.map(item=>item.speakers.map(s=>s.text)),[['참여자1'],['참여자2'],['참여자3'],['참여자1','참여자2']]);
   const colors=new Map(labels.flatMap(item=>item.speakers.map(s=>[s.id,s.color])));assert.equal(new Set(colors.values()).size,3,'each participant has its own dot color');
   assert.equal(labels[3].speakers[0].color,labels[0].speakers[0].color,'the same participant keeps the same color');
   for(const s of labels.flatMap(item=>item.speakers)){assert.ok(s.width>=10&&s.width===s.height);assert.equal(s.round,'50%');assert.equal(s.hidden,'true');}
   assert.ok(labels[3].meta.includes('(구간 내 복수 참여자)')&&labels[3].meta.includes('(실시간 임시)'));
   const leftover=await page.evaluate(()=>document.body.innerText.match(/.{0,12}화자.{0,12}/g));assert.equal(leftover,null,'no "화자" wording remains: '+JSON.stringify(leftover));
   fs.writeFileSync(path.join(evidence,`${width}-participants.png`),await page.screenshot());
   await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='AI 보정본').click());
   await waitFor(page,()=>Boolean(Array.from(document.querySelectorAll('label')).find(label=>label.textContent==='원문 함께 보기')),'compare option');
   await page.evaluate(()=>{const input=Array.from(document.querySelectorAll('label')).find(label=>label.textContent==='원문 함께 보기').querySelector('input');if(!input.checked)input.click();});
   await waitFor(page,()=>document.querySelectorAll('[data-testid="dictation-conversation"] article [class*="original"]').length===3,'originals');
   const weights=await page.evaluate(()=>Array.from(document.querySelectorAll('[data-testid="dictation-conversation"] article')).map(article=>({text:article.querySelector(':scope > p').textContent,main:getComputedStyle(article.querySelector(':scope > p')).fontWeight,original:article.querySelector('[class*="original"] p')?getComputedStyle(article.querySelector('[class*="original"] p')).fontWeight:null,originalBackground:article.querySelector('[class*="original"] p')?getComputedStyle(article.querySelector('[class*="original"] p')).backgroundColor:null,model:article.querySelector('[class*="original"] small')?.textContent??null})));
   assert.deepEqual(weights.map(w=>w.main),['700','700','400','700'],'AI text is bold only where a correction is shown beside its original');
   for(const w of weights.filter(w=>w.original)){assert.equal(w.original,'400');assert.equal(w.originalBackground,'rgb(255, 249, 219)');assert.ok(w.model.includes('gpt-6-luna')&&!w.model.includes('connection:')&&!w.model.includes('@'),w.model);}
   await page.evaluate(()=>document.querySelector('[role="log"]').scrollIntoView({block:'start'}));
   fs.writeFileSync(path.join(evidence,`${width}-compare-bold.png`),await page.screenshot());
   await page.evaluate(()=>{location.hash='#minutes';});
   await waitFor(page,()=>Boolean(Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='회의록 Markdown 저장')),'minutes');
   const order=await page.evaluate(()=>{const save=Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='회의록 Markdown 저장');const row=save.parentElement;save.scrollIntoView({block:'center'});const buttons=Array.from(row.querySelectorAll(':scope > button'));const folder=buttons[buttons.indexOf(save)+1];const a=save.getBoundingClientRect(),b=folder.getBoundingClientRect();return {labels:buttons.map(button=>button.textContent),icon:Boolean(folder.querySelector('svg')),sameRowOrWrapped:Math.abs(a.top-b.top)<2||b.top>=a.bottom-1,overflow:document.documentElement.scrollWidth>innerWidth};});
   assert.deepEqual(order.labels,['회의록 Markdown 저장','저장 폴더 열기','원문·검토본·회의록 JSON 저장']);assert.equal(order.icon,true);assert.equal(order.overflow,false);
   fs.writeFileSync(path.join(evidence,`${width}-minutes-folder.png`),await page.screenshot());
   await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='저장 폴더 열기').click());
   await waitFor(page,()=>window.__qa.calls.some(call=>call.command==='ko_open_exports_folder'),'folder command');
   checks.push({width,labels,weights,order});await page.close();
  }
  fs.writeFileSync(path.join(evidence,'browser-qa.json'),JSON.stringify({scope:'Real production Chrome with simulated native commands; synthetic record; no AI calls',checks},null,2));
  console.log('PASS participant browser: 375/768/1280px; colored participant dots; no 화자 wording; bold AI text beside originals; minutes folder button opens exports');
 }finally{
  if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
  const resolved=path.resolve(profile);assert.ok(resolved.startsWith(evidence+path.sep)&&path.basename(resolved).startsWith('profile-'));
  fs.rmSync(resolved,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});

