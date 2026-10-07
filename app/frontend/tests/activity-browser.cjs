'use strict';
// Real Chromium QA of start loading, live transcription dots, inline transcript options and Stereo Mix enabling. Native commands are simulated.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core'),fixture=require('./jeju-browser-fixture.cjs');
const root=path.resolve(__dirname,'../out'),out=path.resolve(process.env.STREAM_RECORD_QA_OUTPUT||path.join(__dirname,'../test-results/activity-browser'));fs.mkdirSync(out,{recursive:true});
const mix='스테레오 믹스(Realtek(R) Audio)';
function activityFixture(deviceName){
 const old=window.__TAURI_INTERNALS__.invoke;let stereo='disabled';
 window.__qa.holdStart=()=>{window.__qa.startPending=new Promise(resolve=>{window.__qa.releaseStart=()=>{window.__qa.startPending=null;resolve();};});};
 window.__TAURI_INTERNALS__.invoke=async(command,args={})=>{
  if(command==='ko_stereo_mix_status'){window.__qa.calls.push({command,args});return {state:stereo,id:'{id}',name:deviceName};}
  if(command==='ko_enable_stereo_mix'){window.__qa.calls.push({command,args});await new Promise(resolve=>setTimeout(resolve,500));stereo='active';return {state:'active',id:'{id}',name:deviceName};}
  if(command==='get_audio_devices'){const list=await old(command,args);return stereo==='active'?[...list,{name:deviceName,device_type:'Input'}]:list;}
  if(command==='ko_start_recording'&&window.__qa.startPending)await window.__qa.startPending;
  return old(command,args);
 };
}
const server=http.createServer((request,res)=>{const name=decodeURIComponent(new URL(request.url,'http://localhost').pathname),file=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(file,(error,bytes)=>{if(error)return res.writeHead(404).end();res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(bytes);});});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:960}});page.setDefaultTimeout(12000);
 const errors=[],checks=[],captures=[];page.on('pageerror',error=>errors.push(error.message));
 const rows=[{sequence_id:1,text:'첫 번째 문장입니다.',audio_start_time:0,is_partial:false}];
 await page.addInitScript(fixture,{snapshot:{version:1,recordId:'qa-activity',title:'활동 표시 검증',rows:[],minutes:'',startedAt:null},records:[],models:[]});
 await page.addInitScript(activityFixture,mix);
 await page.route('https://www.youtube-nocookie.com/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html lang="ko"><body><p>영상 대역</p></body></html>'}));
 const capture=async name=>{await page.screenshot({path:path.join(out,name+'.png')});captures.push(name+'.png');};
 const axeCheck=async state=>{const violations=await page.evaluate(async()=>{const result=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return result.violations.map(item=>({id:item.id,targets:item.nodes.map(node=>node.target)}));});assert.deepEqual(violations,[],state);checks.push('axe '+state);};
 try{
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByRole('textbox',{name:'기록 제목',exact:true}).waitFor();await page.addScriptTag({path:require.resolve('axe-core')});
  await page.getByRole('radio',{name:/^YouTube/}).check();
  await page.getByRole('textbox',{name:'YouTube 링크',exact:true}).fill('https://www.youtube.com/watch?v=LjwQhxDYsP8');await page.getByRole('button',{name:'영상 불러오기',exact:true}).click();
  await page.getByTitle('받아쓰기할 YouTube 영상').waitFor();await page.getByRole('checkbox',{name:/녹음·처리 권한/}).check();

  // Stereo Mix: off -> one click -> on and selected.
  const panel=page.getByTestId('stereo-mix-panel');await panel.waitFor();assert.match(await panel.innerText(),/꺼져 있습니다/);
  const enable=page.getByRole('button',{name:'스테레오 믹스 켜기',exact:true});await capture('stereo-mix-off');await axeCheck('stereo-mix-off');
  await enable.click();await page.getByRole('button',{name:/켜는 중/}).waitFor();assert.equal(await page.getByRole('button',{name:/켜는 중/}).isDisabled(),true);
  await page.getByText('스테레오 믹스를 켰습니다. 녹음 장치로 선택했습니다.').first().waitFor();
  assert.match(await panel.innerText(),/켜져 있습니다/);assert.equal(await page.getByRole('button',{name:'스테레오 믹스 켜기',exact:true}).count(),0);
  assert.equal(await page.locator('#record-device').inputValue(),'Input:'+mix);
  assert.deepEqual(await page.locator('#record-device option').allInnerTexts(),['소리 장치를 선택하세요','테스트 스피커',mix]);
  await capture('stereo-mix-on');checks.push('Stereo Mix off -> enabled -> selected beside speakers');

  // Start gets a loading animation while native start is pending.
  await page.evaluate(()=>window.__qa.holdStart());
  await page.getByRole('button',{name:'영상 소리 녹음 시작',exact:true}).click();
  const loading=page.getByTestId('start-loading');await loading.waitFor();
  const spinnerName=await loading.locator('> span').first().evaluate(node=>getComputedStyle(node).animationName);assert.notEqual(spinnerName,'none');
  const barName=await loading.locator('> span').last().evaluate(node=>getComputedStyle(node,'::after').animationName);assert.notEqual(barName,'none');
  const buttonSpinner=await page.getByRole('button',{name:/모델 준비 중/}).locator('span').first().evaluate(node=>getComputedStyle(node).animationName);assert.notEqual(buttonSpinner,'none');
  await loading.scrollIntoViewIfNeeded();await capture('start-loading');await axeCheck('start-loading');
  await page.evaluate(()=>window.__qa.releaseStart());
  await page.getByRole('button',{name:'중지 및 저장',exact:true}).waitFor();assert.equal(await loading.count(),0);
  checks.push('start shows animated spinner and indeterminate bar until native start resolves');

  // Recording with no sentence yet, then live dots under the last sentence.
  const waiting=page.getByTestId('transcribing-waiting');await waiting.waitFor();await capture('listening');
  await page.evaluate(row=>window.__qa.emit('transcript-update',row),rows[0]);
  const indicator=page.getByTestId('transcribing-indicator');await indicator.waitFor();assert.match(await indicator.innerText(),/실시간 받아쓰기 중/);
  const place=await page.evaluate(()=>{const article=[...document.querySelectorAll('[role=log] article')].at(-1).getBoundingClientRect(),dots=document.querySelector('[data-testid=transcribing-indicator]').getBoundingClientRect();return {articleBottom:article.bottom,dotsTop:dots.top};});
  assert.ok(place.dotsTop>=place.articleBottom-1,'dots sit below the last transcribed sentence');
  const dot=indicator.locator('span[aria-hidden=true] > span');assert.equal(await dot.count(),3);
  const timing=await dot.evaluateAll(nodes=>nodes.map(node=>({name:getComputedStyle(node).animationName,delay:getComputedStyle(node).animationDelay})));
  assert.ok(timing.every(item=>item.name!=='none'));assert.deepEqual(timing.map(item=>item.delay),['0s','0.15s','0.3s']);
  const samples=new Set();for(let i=0;i<8;i++){samples.add(await dot.first().evaluate(node=>getComputedStyle(node).transform));await page.waitForTimeout(140);}
  assert.ok(samples.size>2,'dots visibly move up and down');
  await indicator.scrollIntoViewIfNeeded();await capture('live-dots');await axeCheck('live-dots');
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await dot.first().evaluate(node=>getComputedStyle(node).animationName),'none');assert.match(await indicator.innerText(),/실시간 받아쓰기 중/);
  const reduced=new Set();for(let i=0;i<5;i++){reduced.add(await dot.first().evaluate(node=>getComputedStyle(node).transform));await page.waitForTimeout(150);}assert.equal(reduced.size,1,'reduced motion removes vertical movement');
  await page.emulateMedia({reducedMotion:'no-preference'});
  checks.push('three dots below the last sentence move up and down in sequence; with reduced motion they stay still and keep the text label');

  // Transcript options sit on the view switcher line, default on; conversation search is always visible.
  for(const width of [1280,768,375]){
   await page.setViewportSize({width,height:960});
   const search=page.getByRole('searchbox',{name:'대화 내용 검색',exact:true});await search.scrollIntoViewIfNeeded();assert.equal(await search.isVisible(),true,'search visible at '+width);
   assert.equal(await page.getByText('대화 검색',{exact:true}).count(),0);
   assert.equal(await page.getByRole('button',{name:'받아쓰기 설정',exact:true}).count(),0);
   const ai=page.getByRole('checkbox',{name:'AI 보정',exact:true}),speaker=page.getByRole('checkbox',{name:'참여자 구분',exact:true});
   assert.equal(await ai.isChecked(),true);assert.equal(await speaker.isChecked(),true);
   assert.equal(await page.getByRole('group',{name:'받아쓰기 설정',exact:true}).evaluate(node=>node.parentElement===document.querySelector('[aria-label="대화 표시 방식"]').parentElement),true);
   if(width===1280){const switcher=await page.getByRole('group',{name:'대화 표시 방식',exact:true}).boundingBox(),box=await ai.boundingBox();assert.ok(Math.abs((box.y+box.height/2)-(switcher.y+switcher.height/2))<16,'options share the switcher line at 1280');}
   await page.getByText('AI 후보정 모델이 지정되지 않아',{exact:false}).waitFor();await page.getByTestId('option-speed-note').waitFor();
   await speaker.scrollIntoViewIfNeeded();await capture('options-'+width);await axeCheck('options-'+width);
  }
  checks.push('AI 보정 and 참여자 구분 are on by default beside 실시간 원문/AI 보정본, with no-model and speaker guidance, at 1280, 768 and 375 px');
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'activity-browser.json'),JSON.stringify({passed:true,checks,captures,scope:'Production Chromium; native commands simulated.'},null,2));
  console.log('PASS activity browser: '+checks.length+' groups');
 }catch(error){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});console.error(error.stack);process.exitCode=1;}
 finally{await browser.close();server.close();}
})();
