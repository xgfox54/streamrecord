'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const nativeFixture=require('./jeju-browser-fixture.cjs');
const root=path.resolve(__dirname,'../out');
const evidence=path.resolve(__dirname,'../test-results/jeju');fs.mkdirSync(evidence,{recursive:true});
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}fs.readFile(file,(err,bytes)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(bytes);});});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[],captures=[],checks=[],accessibility=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(nativeFixture);
 await page.route('https://www.youtube-nocookie.com/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html lang="ko"><body style="background:white;color:black"><p>영상 프레임 유지 테스트용 경계 대역</p></body></html>'}));
 try{
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByRole('heading',{name:'어떤 소리를 기록할까요?'}).waitFor();
  await page.addScriptTag({path:require.resolve('axe-core')});
  const start=page.getByRole('button',{name:'녹음 시작',exact:true});assert.equal(await start.isDisabled(),true);
  for(const width of [375,768,1280]){
   await page.setViewportSize({width,height:900});
   for(const [id,label] of [['recording','회의 녹음'],['dictation','받아쓰기'],['youtube','YouTube 받아쓰기'],['transcript','전체 받아쓰기'],['minutes','회의록'],['ai','AI 연결'],['settings','설정']]){
    await page.getByRole('link',{name:label,exact:true}).click();await page.getByRole('heading',{name:label,exact:true,level:1}).waitFor();
    await page.waitForFunction(()=>document.querySelector('header').getBoundingClientRect().top>=-1);
    const overflow=await page.evaluate(()=>({body:document.documentElement.scrollWidth>innerWidth,main:document.querySelector('main').scrollWidth>document.querySelector('main').clientWidth+1}));
    assert.equal(overflow.body||overflow.main,false,`${id} horizontal overflow at ${width}`);
    const file=`${id}-${width}.png`;await page.screenshot({path:path.join(evidence,file),fullPage:true});captures.push(file);
    const violations=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}));});accessibility.push({id,width,violations});
    const scrollMetrics=await page.evaluate(()=>{const result=[];for(let m=document.querySelector('main');m;m=m.parentElement){m.scrollTop=m.scrollHeight;result.push({tag:m.tagName,className:m.className,top:m.scrollTop,height:m.clientHeight,total:m.scrollHeight,overflow:getComputedStyle(m).overflowY});}return result;});if(id==='recording'&&width===375)console.log(JSON.stringify(scrollMetrics));
    await page.screenshot({path:path.join(evidence,`${id}-${width}-bottom.png`),fullPage:false});
    await page.evaluate(()=>{for(let m=document.querySelector('main');m;m=m.parentElement)m.scrollTop=0;window.scrollTo(0,0);});
   }
  }
  await page.setViewportSize({width:1280,height:900});
  await page.getByRole('link',{name:'설정',exact:true}).click();
  await page.getByRole('combobox',{name:/표시 크기/}).selectOption('125');
  await page.getByRole('link',{name:'회의 녹음',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.querySelector('main').scrollWidth>document.querySelector('main').clientWidth+1),false);
  await page.screenshot({path:path.join(evidence,'recording-125percent.png')});checks.push('125 percent text scale has no horizontal overflow');
  await page.emulateMedia({forcedColors:'active',reducedMotion:'reduce'});
  await page.getByRole('radio',{name:/마이크/}).focus();await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.tagName!=='BODY'),true);
  await page.screenshot({path:path.join(evidence,'recording-forced-colors.png')});checks.push('keyboard focus and forced colors rendered');
  await page.emulateMedia({forcedColors:'none',reducedMotion:'no-preference'});
  await page.getByRole('link',{name:'설정',exact:true}).click();await page.getByRole('combobox',{name:/표시 크기/}).selectOption('100');
  await page.getByRole('link',{name:'회의 녹음',exact:true}).click();
  await page.getByRole('checkbox',{name:/참여자에게/}).check();await start.click();
  await page.getByRole('button',{name:'녹음을 중지하고 저장',exact:true}).waitFor();
  await page.evaluate(()=>{for(const row of [{sequence_id:1,text:'회의 내용을 검토하고 내일 결과를 공유하겠습니다.',audio_start_time:1,is_partial:false},{sequence_id:2,text:'회의 내용을 검토하고 내일 결과를 공유하겠습니다.',audio_start_time:9,is_partial:false}])window.__qa.emit('transcript-update',row);});
  await page.screenshot({path:path.join(evidence,'recording-active.png'),fullPage:true});
  await page.getByRole('button',{name:'녹음을 중지하고 저장',exact:true}).click();
  await page.getByRole('link',{name:'전체 받아쓰기',exact:true}).click();
  await page.getByRole('checkbox',{name:/반복 확인 대상/}).check();assert.equal(await page.locator('article[id^="source-"]').count(),1);
  await page.getByRole('checkbox',{name:/반복 확인 대상/}).uncheck();assert.equal(await page.locator('article[id^="source-"]').count(),2);checks.push('repeat filter preserves both original rows');
  await page.screenshot({path:path.join(evidence,'transcript-review.png'),fullPage:true});
  await page.getByRole('link',{name:'YouTube 받아쓰기',exact:true}).click();await page.getByRole('textbox',{name:'YouTube 링크'}).fill('https://www.youtube.com/watch?v=LjwQhxDYsP8');
  await page.getByRole('button',{name:'영상 불러오기',exact:true}).click();await page.locator('iframe').waitFor();
  await page.locator('iframe').evaluate(frame=>frame.dataset.qaIdentity='original');
  await page.getByRole('link',{name:'AI 연결',exact:true}).click();await page.getByRole('link',{name:'YouTube 받아쓰기',exact:true}).click();assert.equal(await page.locator('iframe').getAttribute('data-qa-identity'),'original');checks.push('same YouTube iframe survives navigation');
  await page.screenshot({path:path.join(evidence,'youtube-prepared.png'),fullPage:true});
  await page.addScriptTag({path:require.resolve('axe-core')});
  const axe=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}));});
  fs.writeFileSync(path.join(evidence,'qa.json'),JSON.stringify({scope:'Production browser rendering; native calls and embed content simulated, no real capture or model inference',captures,checks,errors,axe,accessibility},null,2));
  assert.deepEqual(errors,[]);assert.deepEqual(accessibility.filter(item=>item.violations.length),[]);console.log(JSON.stringify({captures:captures.length,checks,errors,axe}));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
