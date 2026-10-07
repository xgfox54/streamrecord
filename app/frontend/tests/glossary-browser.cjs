'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const fixture=require('./jeju-browser-fixture.cjs'),extra=require('./record-workspace-fixture.cjs');
const root=path.resolve(__dirname,'../out'),out=path.resolve(process.env.STREAM_RECORD_QA_OUTPUT||path.join(__dirname,'../test-results/glossary-browser'));
const server=http.createServer((request,res)=>{
 const name=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
 const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
 if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
 fs.readFile(file,(error,bytes)=>{if(error)return res.writeHead(404).end();res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(bytes);});
});
(async()=>{
 fs.mkdirSync(out,{recursive:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:960}});page.setDefaultTimeout(12000);
 const errors=[],checks=[],accessibility=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.addInitScript(fixture,{snapshot:{version:1,title:'단어장 검증',rows:[],minutes:'',startedAt:null},models:[]});
  await page.addInitScript(extra);
  await page.addInitScript(()=>{for(const option of ['ai-correction','live-summary','live-diarization'])localStorage.setItem('stream-record.option.'+option,'false');});
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByRole('button',{name:'추가 녹음 설정',exact:true}).click();
  await page.getByText('회의 주제별 용어 세트',{exact:true}).click();
  const field=page.getByRole('textbox',{name:'AI 보정에 참고할 용어',exact:true});
  assert.equal(await field.getAttribute('maxlength'),'3000');
  await page.locator('input[value="education"]').check();await page.locator('button[data-action="append-glossary"]').click();
  const full=await field.inputValue();assert.ok(full.length>=2990&&full.length<=3000);
  assert.ok(full.includes('청소년상담복지센터'));assert.ok(full.length>500);checks.push({check:'whole education dictionary applies',characters:full.length});
  await field.fill('사용자 고유 용어');await page.locator('input[value="audit"]').check();await page.locator('input[value="budget"]').check();
  assert.equal(await field.inputValue(),'사용자 고유 용어');
  await page.locator('button[data-action="append-glossary"]').click();const mixed=await field.inputValue();
  assert.ok(mixed.startsWith('사용자 고유 용어, '));assert.ok(mixed.includes('행정사무감사'));assert.ok(mixed.includes('예비비'));assert.ok(mixed.length<=3000);
  assert.ok((await page.getByRole('status').allTextContents()).some(text=>text.includes('3,000자 한도')));checks.push({check:'manual words and mixed topics retained, omissions shown',characters:mixed.length});
  await page.addScriptTag({path:require.resolve('axe-core')});
  for(const width of [375,768,1280]){
   await page.setViewportSize({width,height:960});await field.scrollIntoViewIfNeeded();
   assert.equal(await page.evaluate(()=>{const main=document.querySelector('main');return document.documentElement.scrollWidth>innerWidth||main.scrollWidth>main.clientWidth+1;}),false);
   const violations=await page.evaluate(async()=>{const result=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return result.violations.map(item=>({id:item.id,targets:item.nodes.map(node=>node.target)}));});
   accessibility.push({width,violations});assert.deepEqual(violations,[]);
   await page.screenshot({path:path.join(out,'glossary-'+width+'.png')});checks.push({check:'expanded glossary fits viewport and accessibility checks',width});
  }
  await field.fill('가'.repeat(3005));assert.equal((await field.inputValue()).length,3000);checks.push({check:'browser enforces 3000-character manual input limit'});
  assert.equal(await page.evaluate(()=>window.__qa.calls.some(call=>call.command==='ko_update_stt_glossary'||call.command==='ko_generate')),false);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:checks.length,checks,errors}));
 }finally{
  fs.writeFileSync(path.join(out,'qa.json'),JSON.stringify({scope:'Production Chrome with isolated profile and simulated native boundary; no user data, external network, capture or AI inference.',checks,accessibility,errors},null,2));
  await browser.close();await new Promise(resolve=>server.close(resolve));
 }
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
