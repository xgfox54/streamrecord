'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright-core');
const fixture=require('./jeju-browser-fixture.cjs');
const root=path.resolve(__dirname,'../out'),evidence=path.resolve(__dirname,'../test-results/transcript-playback-browser');
const wav=Buffer.alloc(44+8000*8*2);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);for(let i=0;i<8000*8;i++)wav.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/8000)*1000),44+i*2);
const rows=[{sequence_id:1,text:'첫 번째 발언입니다.',audio_start_time:0,audio_end_time:2,is_partial:false},{sequence_id:2,text:'둘째 발언을 확인합니다.',audio_start_time:2,is_partial:false,ai_correction:{version:1,source_text:'둘째 발언을 확인합니다.',text:'둘째 보정 발언입니다.',model_key:'fixture',glossary:''}},{sequence_id:3,text:'셋째 발언입니다.',audio_start_time:4,audio_end_time:5,is_partial:false,reviewed_text:'직접 수정한 셋째 발언입니다.'},{sequence_id:4,text:'시간정보 없는 발언',is_partial:false},{sequence_id:5,text:'입력 중인 발언',audio_start_time:6,is_partial:true}];
const scenario={models:[],snapshot:{version:1,recordId:'playback-test',title:'문장별 원음 재생 확인',rows,minutes:'',startedAt:null,audioPath:'/qa.wav',audioSha256:'a'.repeat(64)}};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
 const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(name==='/qa.wav'){res.setHeader('Content-Type','audio/wav');return res.end(wav);}
 const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(file,(err,bytes)=>{if(err)return res.writeHead(404).end();res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(bytes);});
});
async function init(page){
 await page.addInitScript(fixture,scenario);
 await page.addInitScript(()=>{
  const invoke=window.__TAURI_INTERNALS__.invoke;
  window.__TAURI_INTERNALS__.invoke=async(command,args={})=>{
   if(command==='ko_open_review_audio'){window.__qa.calls.push({command,args});return {path:'/qa.wav',filename:'검증용 음성.wav',duration_seconds:8,sha256:'a'.repeat(64)};}
   return invoke(command,args);
  };
 });
}
(async()=>{
 fs.mkdirSync(evidence,{recursive:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({channel:'chrome',headless:true});const checks=[];
 try{
  for(const width of [375,768,1280]){
   const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));await init(page);
   let release;const gate=new Promise(resolve=>release=resolve);await page.route('**/qa.wav',async route=>{await gate;await route.fulfill({contentType:'audio/wav',body:wav});});
   await page.goto('http://127.0.0.1:'+server.address().port+'/#dictation');
   const row=page.locator('#dictation-row-0'),text=row.getByRole('button',{name:'받아쓰기-1 원음 재생: 첫 번째 발언입니다.',exact:true});await text.click();
   await page.waitForFunction(()=>window.__qa.calls.some(call=>call.command==='ko_open_review_audio'));assert.equal(await page.locator('audio').count(),1);assert.equal(await page.locator('audio').evaluate(node=>node.paused),true);
   release();await row.getByRole('button',{name:'받아쓰기-1 원음 일시정지',exact:true}).waitFor();
   const first=await page.locator('audio').evaluate(node=>({time:node.currentTime,duration:node.duration,paused:node.paused}));assert.ok(first.time>=0&&first.time<2);assert.equal(first.duration,8);assert.equal(first.paused,false);
   await row.getByRole('button',{name:'받아쓰기-1 원음 일시정지',exact:true}).click();assert.equal(await page.locator('audio').evaluate(node=>node.paused),true);
   await page.getByRole('button',{name:'AI 보정본',exact:true}).click();const search=page.getByRole('searchbox',{name:'대화 내용 검색'});await search.fill('둘째 보정');
   await page.locator('#dictation-row-1').getByRole('button',{name:'받아쓰기-2 원음 재생: 둘째 보정 발언입니다.',exact:true}).click();
   await page.waitForFunction(()=>{const audio=document.querySelector('audio');return audio&&!audio.paused&&audio.currentTime>=2;});
   const second=await page.locator('audio').evaluate(node=>node.currentTime);assert.ok(second>=2&&second<4);
   await page.waitForFunction(()=>{const audio=document.querySelector('audio');return audio&&audio.paused&&audio.currentTime>=4;});
   const end=await page.locator('audio').evaluate(node=>node.currentTime);assert.ok(end>=4&&end<4.6);
   await search.fill('');await page.locator('#dictation-row-2').getByRole('button',{name:'받아쓰기-3 원음 재생: 직접 수정한 셋째 발언입니다.',exact:true}).focus();await page.keyboard.press('Enter');
   await page.waitForFunction(()=>{const audio=document.querySelector('audio');return audio&&!audio.paused&&audio.currentTime>=4;});
   await page.locator('#dictation-row-2').getByRole('button',{name:'받아쓰기-3 원음 일시정지',exact:true}).click();
   assert.equal(await page.locator('#dictation-row-3').getByRole('button',{name:'받아쓰기-4 원음 재생',exact:true}).isDisabled(),true);assert.equal(await page.locator('#dictation-row-4').getByRole('button',{name:'받아쓰기-5 원음 재생: 입력 중인 발언',exact:true}).isDisabled(),true);
   await row.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(evidence,width+'-playback.png')});
   const layout=await text.evaluate(node=>({font:getComputedStyle(node).fontSize,parentFont:getComputedStyle(node.parentElement).fontSize,targetHeight:node.getBoundingClientRect().height,overflow:document.documentElement.scrollWidth>innerWidth}));assert.equal(layout.font,layout.parentFont);assert.ok(layout.targetHeight>=44);assert.equal(layout.overflow,false);
   await page.getByRole('link',{name:'원음 듣기·직접 수정',exact:true}).click();assert.equal(await page.locator('audio').count(),1);assert.equal(await page.locator('audio').evaluate(node=>node.paused),true);
   await page.getByRole('button',{name:'받아쓰기로 돌아가기',exact:true}).click();assert.equal(await page.locator('audio').count(),1);
   await row.getByRole('button',{name:'받아쓰기-1 원음 재생',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('audio').paused);
   const newRecord=page.getByRole('button',{name:'새 기록',exact:true});if(!await newRecord.isVisible())await page.getByRole('button',{name:'기록 목록',exact:true}).click();await newRecord.click();await page.waitForFunction(()=>document.querySelectorAll('[id^="dictation-row-"]').length===0);assert.equal(await page.locator('audio').count(),0);
   assert.deepEqual(errors,[]);checks.push({width,metadataWait:true,first,second,stoppedAt:end,layout,keyboard:true,singlePlayer:true,recordReset:true,errors});await page.close();
  }
  fs.writeFileSync(path.join(evidence,'browser-qa.json'),JSON.stringify({scope:'Production Chrome with actual generated WAV playback; simulated native file validation, no microphone or real speech recording',checks},null,2));console.log('PASS Chrome sentence playback: 375/768/1280px, text/button/keyboard, metadata wait, seek, pause, automatic segment end, search, original timing, single player and record reset');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
