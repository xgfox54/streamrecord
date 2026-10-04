'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');const fixture=require('./jeju-browser-fixture.cjs');
const root=path.resolve(__dirname,'../out'),out=path.resolve(__dirname,'../test-results/correction');fs.mkdirSync(out,{recursive:true});
const rows=Array.from({length:205},(_,i)=>({sequence_id:i+1,text:i===0?'첫 번째 회의을 시작합니다.':`오늘 회의을 이어서 진행합니다. ${i+1}번째 안건의 진행 상황을 검토 하겠습니다.`,audio_start_time:i*8,is_partial:false}));
rows.push({sequence_id:206,text:'다음 회의을',audio_start_time:1640,is_partial:true});
const scenario={fastCorrectionClock:true,models:[{id:'검증용 AI',provider:'local'}],snapshot:{version:1,title:'전체 대화 읽기 검증',rows,minutes:'',startedAt:null}};
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+(name==='/'?'/index.html':decodeURIComponent(name)));if(!file.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(file,(err,bytes)=>{if(err)return res.writeHead(404).end();res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(bytes);});});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();const errors=[],captures=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(fixture,scenario);
 try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/#dictation');await page.getByRole('heading',{name:'받아쓰기',exact:true,level:1}).waitFor();
  await page.getByRole('checkbox',{name:'확정 문장 자동 보정',exact:true}).check();await page.getByRole('status').filter({hasText:'전체 보정 완료'}).waitFor();
  for(const width of [375,768,1280,1440]){
   await page.setViewportSize({width,height:960});await page.addScriptTag({path:require.resolve('axe-core')});
   const overflow=await page.evaluate(()=>({body:document.documentElement.scrollWidth>innerWidth,main:document.querySelector('main').scrollWidth>document.querySelector('main').clientWidth+1}));assert.equal(overflow.body||overflow.main,false);
   await page.locator('[data-testid="dictation-conversation"]').scrollIntoViewIfNeeded();
   const reader=page.getByRole('log',{name:'AI 보정 대화 내용'});await reader.evaluate(node=>node.scrollTop=0);
   const file=`conversation-${width}.png`;await page.screenshot({path:path.join(out,file)});captures.push(file);
   const axe=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}));});assert.deepEqual(axe,[]);checks.push({width,overflow,axe});
  }
  await page.setViewportSize({width:1440,height:960});await page.getByRole('button',{name:'앞선 대화',exact:true}).click();await page.getByRole('log').getByText('첫 번째 회의를 시작합니다.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'실시간 원문',exact:true}).click();await page.getByRole('log').getByText('첫 번째 회의을 시작합니다.',{exact:true}).waitFor();await page.screenshot({path:path.join(out,'raw-original.png')});
  await page.getByRole('button',{name:'AI 보정본',exact:true}).click();await page.getByRole('checkbox',{name:'원문 함께 보기',exact:true}).check();await page.getByRole('log').getByText('첫 번째 회의을 시작합니다.',{exact:true}).waitFor();await page.screenshot({path:path.join(out,'original-comparison.png')});
  await page.getByRole('searchbox',{name:'대화 내용 검색'}).fill('첫 번째');assert.equal(await page.getByRole('log').locator('article').count(),1);
  await page.getByRole('button',{name:'최신 문장',exact:true}).click();await page.getByRole('log').getByText('다음 회의을',{exact:true}).waitFor();
  await page.evaluate(()=>{window.__qa.failCorrections=true;window.__qa.emit('transcript-update',{sequence_id:207,text:'새 회의을 시작합니다.',is_partial:false});});
  await page.getByText('녹음 옵션',{exact:true}).click();await page.getByRole('textbox',{name:'인식에 참고할 용어'}).fill('검토 용어');await page.getByRole('alert').filter({hasText:'AI 보정을 멈췄습니다'}).waitFor();await page.screenshot({path:path.join(out,'correction-error.png')});
  for(const width of [375,768]){
   await page.setViewportSize({width,height:960});await page.getByText('녹음 옵션',{exact:true}).scrollIntoViewIfNeeded();
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);
   const axe=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return r.violations.map(v=>v.id);});assert.deepEqual(axe,[]);
   const file='expanded-options-'+width+'.png';await page.screenshot({path:path.join(out,file)});captures.push(file);checks.push({width,state:'expanded-options-and-correction-error',overflow,axe});
  }
  await page.evaluate(()=>{window.__qa.failCorrections=false;});await page.getByRole('button',{name:'보정 다시 시도',exact:true}).click();await page.getByRole('status').filter({hasText:'전체 보정 완료'}).waitFor();
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'browser-qa.json'),JSON.stringify({scope:'Real production Chromium; synthetic transcript, native and AI boundaries simulated',checks,captures,errors,flows:['all206segments accessible','AI and raw toggle','raw comparison','all-conversation search','partial retained','failure and retry']},null,2));console.log('PASS correction browser: responsive, original comparison, history, error/retry');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
