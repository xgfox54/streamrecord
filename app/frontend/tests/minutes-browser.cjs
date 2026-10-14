'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const fixture=require('./jeju-browser-fixture.cjs'),extra=require('./record-workspace-fixture.cjs');
const root=path.resolve(__dirname,'../out'),out=path.resolve(process.env.STREAM_RECORD_QA_OUTPUT||path.join(__dirname,'../test-results/minutes-browser'));
const rows=[
 '여성가족연구원의 운영 체계와 연구 방향을 검토하겠습니다.',
 '연구비 단가는 연구원 500만원, 여성가족연구원 1000만원입니다.',
 '내부 갈등을 줄이기 위한 외부 관리 필요성을 제안합니다.',
 '노인복지 사각지대와 지역 돌봄 서비스를 논의하겠습니다.',
 '현장 수요를 먼저 조사하고 지원 방안을 검토하겠습니다.',
 '민준이 금요일까지 운영 현황 보고서를 제출하겠습니다.',
].map((text,i)=>({sequence_id:i+1,text,is_partial:false,audio_start_time:i*84,audio_end_time:i*84+12}));
const legacy='# 제주 연구기관 운영과 돌봄 현황 점검\n\n> AI 초안 · 원문 대조 및 담당자 확인 필요\n\n## 주요 논의 사항\n\n**[00:00:00~]**\n\n### 연구기관 운영 체계와 연구 방향\n\n- 연구기관의 운영 체계와 연구비 단가를 점검함\n- 내부 갈등 방지를 위한 외부 관리 필요성을 제안함\n  - 기관별 운영 형태와 지원 현황을 함께 검토함\n\n**[00:04:12~]**\n\n### 노인복지 사각지대와 지역 돌봄\n\n- 현장 수요를 먼저 조사한 뒤 지원 방안을 검토하기로 함\n\n## 후속 조치\n\n| 내용 | 담당자 | 기한 | 근거 구간 | 원문 인용 |\n|---|---|---|---|---|\n| 운영 현황 보고서 제출 | 민준 | 금요일까지 | S000006 · 00:07:00 | 민준이 금요일까지 운영 현황 보고서를 제출하겠습니다. |\n| 지역 돌봄 현장 수요 검토 | [확인 필요] | [확인 필요] | S000004 · 00:04:12 | 노인복지 사각지대와 지역 돌봄 서비스를 논의하겠습니다. |';
const scenario={snapshot:{version:1,recordId:'qa-minutes',title:'제주 연구기관 운영과 돌봄 현황 점검',rows,minutes:legacy,startedAt:null},models:[{id:'qa-model',provider:'chatgpt'}]};
const server=http.createServer((request,res)=>{
 const name=decodeURIComponent(new URL(request.url,'http://localhost').pathname),file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
 if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
 fs.readFile(file,(error,bytes)=>{if(error)return res.writeHead(404).end();res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(bytes);});
});
(async()=>{
 fs.mkdirSync(out,{recursive:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1920,height:1080}});page.setDefaultTimeout(12000);
 const errors=[],checks=[],accessibility=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.addInitScript(fixture,scenario);await page.addInitScript(extra);
  await page.addInitScript(()=>{
   for(const name of ['ai-correction','live-summary','live-diarization'])localStorage.setItem('stream-record.option.'+name,'false');
   localStorage.setItem('stream-record.summary-model','chatgpt:qa-model');
   const original=window.__TAURI_INTERNALS__.invoke;
   window.__TAURI_INTERNALS__.invoke=async(command,args={})=>{
    if(command==='ko_generate'&&args.stage==='structured'){
     window.__qa.calls.push({command,args});if(window.__qa.failMinutes)throw new Error('검증용 연결 실패: HTTP 429');
     if(window.__qa.holdMinutes)await new Promise(resolve=>{window.__qa.releaseMinutes=resolve;});
     const first=args.text.match(/^\[(S\d{6}(?:p\d+)?)\]\[[^\]]+\] (.+)$/m);if(!first)throw new Error('Missing fixture source');
     return JSON.stringify({summary:'### 연구기관 운영 현황\n- 운영 체계와 연구 방향을 검토함\n- 연구비 단가와 외부 관리 필요성을 논의함\n\n### 지역 돌봄과 후속 조치\n- 현장 수요 조사와 운영 현황 보고를 논의함',decisions:[],proposals:[{text:first[2],source_id:first[1],quote:first[2],owner:null,due:null}],actions:[],numbers:[],open_questions:[]});
    }
    if(command==='ko_open_exports_folder'){window.__qa.calls.push({command,args});return;}
    return original(command,args);
   };
  });
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByRole('button',{name:'회의록 정리하기',exact:true}).click();
  const doc=page.getByTestId('minutes-document');await doc.waitFor();
  assert.equal(await doc.locator('table').count(),0);assert.equal(await doc.locator('h4').count(),2);assert.equal(await doc.locator('ul ul').count(),1);
  assert.equal(await doc.locator('details[open]').count(),0);assert.equal(await page.getByRole('textbox',{name:'회의록 본문 (Markdown)',exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>window.__qa.calls.filter(call=>call.command==='ko_generate').length),0);checks.push('Existing minutes open as a document with nested bullets and folded legacy evidence; no inference');
  await doc.locator('h2').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'minutes-desktop.png')});
  assert.equal(await doc.locator('h4').first().evaluate(el=>getComputedStyle(el).fontWeight),'700');
  await doc.getByText('근거 원문 보기',{exact:true}).first().click();assert.ok(await doc.getByText('민준이 금요일까지 운영 현황 보고서를 제출하겠습니다.',{exact:true}).isVisible());await page.screenshot({path:path.join(out,'minutes-quote.png')});await doc.getByText('근거 원문 보기',{exact:true}).first().click();checks.push('Legacy quote expands on demand');
  await doc.getByRole('button',{name:'받아쓰기-6 원문 보기',exact:true}).click();await page.locator('#source-S000006').waitFor();assert.equal(await page.locator('#source-S000006').evaluate(el=>document.activeElement===el),true);checks.push('Inline citation moves to the real transcript row and focuses it');
  await page.getByRole('button',{name:'회의록 정리하기',exact:true}).click();
  await page.getByRole('button',{name:'직접 수정',exact:true}).click();const editor=page.getByRole('textbox',{name:'회의록 본문 (Markdown)',exact:true});assert.equal(await editor.inputValue(),legacy);await editor.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'minutes-editor.png')});
  await page.getByRole('button',{name:'회의록 보기',exact:true}).click();await page.getByRole('button',{name:'직접 수정',exact:true}).click();assert.equal(await editor.inputValue(),legacy);checks.push('Read/edit round trip preserves the exact Markdown');
  const edited=legacy+'\n\n## 사용자 메모\n\n- 직접 추가한 검토 내용\n\n[잘못된 근거](#source-S999999)\n\n<img src="https://example.test/no.png" onerror="window.__injected=true"><script>window.__injected=true</script>\n\n![외부 이미지](https://example.test/no.png)\n\n[외부 링크](https://example.test/no)\n\n'+('긴단어'.repeat(80));
  await editor.fill(edited);await page.getByRole('button',{name:'회의록 보기',exact:true}).click();assert.ok(await doc.getByText('직접 추가한 검토 내용',{exact:true}).isVisible());assert.equal(await doc.locator('img,script,a').count(),0);assert.equal(await page.evaluate(()=>Boolean(window.__injected)),false);checks.push('User edits render without HTML execution or external resources');
  await doc.getByRole('button',{name:'받아쓰기-999999 원문 보기',exact:true}).click();assert.ok((await page.getByRole('alert').allTextContents()).some(text=>text.includes('구간이 없습니다')));checks.push('Invalid citation is reported instead of silently navigating');
  await page.getByRole('button',{name:'회의록 Markdown 저장',exact:true}).click();
  await page.waitForFunction(()=>window.__qa.calls.some(call=>call.command==='ko_export'&&call.args.kind==='minutes'));
  assert.equal(await page.evaluate(()=>window.__qa.calls.filter(call=>call.command==='ko_export'&&call.args.kind==='minutes').at(-1).args.content),edited);checks.push('Export preserves exact edited Markdown');
  await page.addScriptTag({path:require.resolve('axe-core')});
  for(const [width,scale] of [[1920,100],[1280,125],[768,112.5],[375,125]]){
   await page.setViewportSize({width,height:1080});await page.evaluate(scale=>document.documentElement.style.fontSize=scale+'%',scale);await doc.locator('h2').first().scrollIntoViewIfNeeded();
   assert.equal(await page.evaluate(()=>{const main=document.querySelector('main');return document.documentElement.scrollWidth>innerWidth||main.scrollWidth>main.clientWidth+1;}),false);
   assert.equal(await doc.evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
   const violations=await page.evaluate(async()=>{const result=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return result.violations.map(item=>({id:item.id,targets:item.nodes.map(node=>node.target)}));});
   accessibility.push({width,scale,violations});assert.deepEqual(violations,[]);await page.screenshot({path:path.join(out,`minutes-${width}-${scale}.png`)});checks.push(`Document fits ${width}px at ${scale}% and passes automated accessibility`);
  }
  await page.setViewportSize({width:1920,height:1080});await page.evaluate(()=>document.documentElement.style.fontSize='100%');
  await page.getByText('회의록 생성 설정',{exact:true}).click();await page.evaluate(()=>window.__qa.holdMinutes=true);await page.getByRole('button',{name:'회의록 생성',exact:true}).click();
  const countdown=page.getByTestId('minutes-countdown');await countdown.waitFor();
  const firstTime=await countdown.getByRole('timer').textContent();assert.match(firstTime,/약/);
  await page.waitForTimeout(2100);assert.notEqual(await countdown.getByRole('timer').textContent(),firstTime);
  assert.equal(await countdown.getAttribute('aria-live'),'off');assert.equal(await countdown.locator('xpath=ancestor::*[@role="status"]').count(),0);
  for(const width of [375,768,1280]){
   await page.setViewportSize({width,height:1080});await page.evaluate(()=>document.documentElement.style.fontSize='125%');await page.getByTestId('minutes-feedback').evaluate(el=>el.scrollIntoView({block:'center'}));
   assert.equal(await countdown.evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
   const violations=await page.evaluate(async()=>{const result=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return result.violations.map(item=>({id:item.id,targets:item.nodes.map(node=>node.target)}));});
   assert.deepEqual(violations,[]);await page.screenshot({path:path.join(out,`minutes-countdown-${width}.png`)});
  }
  await page.setViewportSize({width:1920,height:1080});await page.evaluate(()=>{document.documentElement.style.fontSize='100%';window.__qa.holdMinutes=false;window.__qa.releaseMinutes();});
  await page.getByTestId('minutes-feedback').filter({hasText:'전체 구간'}).waitFor();assert.equal(await countdown.count(),0);
  checks.push('Real Chrome countdown decreases, fits 375/768/1280px at 125%, passes accessibility, avoids live announcements and disappears on completion');
  const generated=await page.evaluate(()=>window.__qa.currentSnapshot.minutes);assert.ok(generated.includes('### 연구기관 운영 현황'));assert.ok(!generated.includes('| 내용 |'));assert.ok(generated.includes('#source-S000001'));assert.ok(generated.includes(rows[0].text));
  assert.equal(await doc.locator('details[open]').count(),0);await doc.getByText('근거 원문 보기',{exact:true}).first().click();assert.ok(await doc.getByText(rows[0].text,{exact:true}).last().isVisible());await doc.getByText('근거 원문 보기',{exact:true}).first().click();
  checks.push('New structured output has topic headings, bullets and preserved validated evidence');await doc.locator('h2').first().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'minutes-generated-desktop.png')});
  // Clear only the fixture's completed checkpoint through a new isolated reload.
  await page.reload();await page.getByRole('button',{name:'회의록 정리하기',exact:true}).click();await page.getByText('회의록 생성 설정',{exact:true}).click();await page.evaluate(()=>window.__qa.failMinutes=true);
  await page.getByRole('button',{name:'회의록 생성',exact:true}).click();await page.getByTestId('minutes-feedback').filter({hasText:'429'}).waitFor();assert.ok(await doc.isVisible());await page.getByTestId('minutes-feedback').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'minutes-failure.png')});checks.push('Failed generation remains visible alongside the previous readable document');
  await page.getByRole('button',{name:'새 기록',exact:true}).click();await page.getByRole('link',{name:'회의록',exact:true}).click();assert.equal(await doc.count(),0);assert.ok(await page.getByText('받아쓰기를 마친 뒤 회의록을 생성하면 제목과 주제별 내용이 정리됩니다.',{exact:true}).isVisible());assert.ok(await page.getByRole('button',{name:'회의록 생성',exact:true}).isDisabled());await page.screenshot({path:path.join(out,'minutes-empty.png')});checks.push('Empty new record has a clear instruction and cannot generate without a transcript');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:checks.length,checks,errors}));
 }finally{
  fs.writeFileSync(path.join(out,'qa.json'),JSON.stringify({scope:'Production Chrome with isolated synthetic records and simulated native boundary. No user data, capture, external network or actual AI inference.',checks,accessibility,errors},null,2));
  await browser.close();await new Promise(resolve=>server.close(resolve));
 }
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
