'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright-core');
const fixture=require('./jeju-browser-fixture.cjs');
const root=path.resolve(__dirname,'../out');
const evidence=path.resolve(__dirname,'../test-results/correction-override');
const texts=['예산은 10만원입니다.','다음 회의에서 충분히 논의하고 검토한 결과를 함께 공유하겠습니다.','회의을 시작합니다.','회의을 계속합니다.','다음 안건 다섯 번째입니다.','다음 안건 여섯 번째입니다.'];
const rows=texts.map((text,i)=>({sequence_id:i+1,text,is_partial:false}));
rows.push({sequence_id:7,text:'입력 중',is_partial:true});
const scenario={models:[{id:'검증용 AI',provider:'local'}],snapshot:{version:1,title:'AI 보정 진행 상태 확인',minutes:'',startedAt:null,rows}};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
 const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
 if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
 fs.readFile(file,(err,bytes)=>{if(err)return res.writeHead(404).end();res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(bytes);});
});
(async()=>{
 fs.mkdirSync(evidence,{recursive:true});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const checks=[];
 try{
  for(const width of [375,768,1280]){
   const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];
   await page.emulateMedia({reducedMotion:'no-preference'});
   page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(fixture,scenario);
   await page.addInitScript(()=>{
    const invoke=window.__TAURI_INTERNALS__.invoke;
    window.__qa.pending=[];
    const interval=window.setInterval.bind(window),clearInterval=window.clearInterval.bind(window),timers=new Map();let timerId=0;
    window.setInterval=(callback,delay,...args)=>{if(delay!==3000)return interval(callback,delay,...args);const id=--timerId;timers.set(id,()=>callback(...args));return id;};
    window.clearInterval=id=>{timers.delete(id);clearInterval(id);};
    window.__qa.tickCorrections=()=>{for(const callback of timers.values())callback();};
    window.__TAURI_INTERNALS__.invoke=(command,args={})=>{
     if(command==='ko_generate'&&args.stage==='correction'){
      window.__qa.calls.push({command,args});
      return new Promise(resolve=>window.__qa.pending.push({args,resolve}));
     }
     return invoke(command,args);
    };
    window.__qa.release=()=>{
     const pending=window.__qa.pending.shift();
     pending.resolve(JSON.stringify({corrections:JSON.parse(pending.args.text).segments.map(part=>({id:part.id,text:part.id==='S000001'?'예산은 11만 원입니다.':part.id==='S000002'?'공유.':part.text.replaceAll('회의을','회의를')}))}));
    };
   });
   await page.goto('http://127.0.0.1:'+server.address().port+'/#dictation');
   await page.waitForFunction(()=>window.__qa.pending.length===1);
   const progress=page.locator('[data-testid="correcting-indicator"]');
   assert.equal(await progress.count(),4);
   assert.equal(await page.locator('#dictation-row-4 [data-testid="correcting-indicator"]').count(),0);
   assert.equal(await page.locator('#dictation-row-6 [data-testid="correcting-indicator"]').count(),0);
   const motion=await progress.first().evaluate(node=>{
    const animation=node.getAnimations()[0];animation.pause();animation.currentTime=0;const before=parseFloat(getComputedStyle(node).opacity);animation.currentTime=700;const after=parseFloat(getComputedStyle(node).opacity);animation.play();
    return {before,after,duration:getComputedStyle(node).animationDuration,parent:node.parentElement.textContent,overflow:document.documentElement.scrollWidth>innerWidth};
   });
   assert.ok(motion.before>motion.after);assert.equal(motion.duration,'1.4s');assert.equal(motion.parent,'보정 전 원문보정중...');assert.equal(motion.overflow,false);
   await page.getByRole('button',{name:'AI 보정본',exact:true}).click();
   const search=page.getByRole('searchbox',{name:'대화 내용 검색'});
   await search.fill('여섯 번째');assert.equal(await progress.count(),0);
   await search.fill('');assert.equal(await progress.count(),4);
   await page.locator('#dictation-row-0').scrollIntoViewIfNeeded();
   await page.screenshot({path:path.join(evidence,width+'-progress.png')});
   await page.emulateMedia({reducedMotion:'reduce'});
   assert.equal(await progress.first().evaluate(node=>getComputedStyle(node).animationName),'none');
   await page.emulateMedia({reducedMotion:'no-preference'});
   await page.evaluate(()=>window.__qa.release());
   await page.locator('#dictation-row-0').getByText('예산은 11만 원입니다.',{exact:true}).waitFor();
   assert.equal(await progress.count(),0);
   assert.equal(await page.getByText('숫자가 변경되었을 수 있으니 원본 녹음을 확인하세요',{exact:true}).count(),1);
   await page.evaluate(()=>window.__qa.tickCorrections());
   await page.waitForFunction(()=>window.__qa.pending.length===1);
   assert.equal(await progress.count(),2);
   await page.evaluate(()=>window.__qa.release());
   await page.waitForFunction(()=>window.__qa.calls.filter(call=>call.command==='ko_save_snapshot').some(call=>JSON.parse(call.args.content).rows.filter(row=>row.ai_correction).length===6));
   assert.equal(await progress.count(),0);
   await page.getByRole('checkbox',{name:'원문 함께 보기',exact:true}).check();
   await page.locator('#dictation-row-0').getByText(texts[0],{exact:true}).waitFor();
   await page.locator('#dictation-row-0').scrollIntoViewIfNeeded();
   await page.screenshot({path:path.join(evidence,width+'-applied.png')});
   const saved=await page.evaluate(()=>JSON.parse(window.__qa.calls.filter(call=>call.command==='ko_save_snapshot').at(-1).args.content));
   assert.equal(saved.rows[0].text,texts[0]);assert.equal(saved.rows[0].ai_correction.text,'예산은 11만 원입니다.');assert.equal(saved.rows[1].ai_correction.text,'공유.');
   assert.equal(await page.getByRole('button',{name:'무시하고 보정 처리',exact:true}).count(),0);assert.deepEqual(errors,[]);
   checks.push({width,motion,completed:6,errors});await page.close();
  }
  fs.writeFileSync(path.join(evidence,'browser-qa.json'),JSON.stringify({scope:'Production Chrome; synthetic transcripts and simulated native/AI commands',checks},null,2));
  console.log('PASS automatic correction and progress: 375/768/1280px, motion, reduced motion, batches, warnings, original comparison');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
