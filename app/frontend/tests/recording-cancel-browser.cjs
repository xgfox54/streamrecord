'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright-core');
const nativeFixture=require('./jeju-browser-fixture.cjs');
const root=path.resolve(__dirname,'../out');
const evidence=process.env.STREAM_RECORD_CANCEL_EVIDENCE||path.resolve(__dirname,'../test-results/recording-cancel');
fs.mkdirSync(evidence,{recursive:true});
const server=http.createServer((req,res)=>{
 const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(bytes);});
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'chrome',headless:true});const checks=[],errors=[];
 try{
  for(const width of [375,768,1280]){
   const page=await browser.newPage({viewport:{width,height:960}});page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(nativeFixture);
   await page.addInitScript(()=>{
    for(const option of ['ai-correction','live-summary','live-diarization'])localStorage.setItem('stream-record.option.'+option,'false');
    const old=window.__TAURI_INTERNALS__.invoke;let cancelled=false;
    window.__TAURI_INTERNALS__.invoke=async(command,args)=>{
     if(command==='ko_cancel_recording'){window.__qa.calls.push({command,args});cancelled=true;return;}
     if(command==='ko_exit_app'){window.__qa.calls.push({command,args});return;}
     if(command==='ko_app_info')return {name:'Stream-Record',version:'0.7.10 · 기능 검증',platform:'windows',arch:'x64'};
     if(command==='is_recording'&&cancelled)return false;
     if(command==='ko_start_recording')cancelled=false;
     if(command==='ko_stop_recording'&&window.__qa.pendingStop){window.__qa.calls.push({command,args});return new Promise(resolve=>{window.__qa.finishStop=resolve;});}
     return old(command,args);
    };
   });
   await page.goto('http://127.0.0.1:'+server.address().port);
   const start=()=>page.getByRole('button',{name:'마이크 녹음 시작',exact:true});
   await start().waitFor();await page.getByRole('checkbox',{name:/녹음·처리 권한을 확인했습니다/}).check();await start().click();
   await page.getByRole('button',{name:'녹음 취소',exact:true}).first().waitFor();
   await page.evaluate(()=>window.__qa.emit('transcript-update',{sequence_id:1,text:'취소 기능 확인용 문장입니다.',is_partial:false,audio_start_time:0}));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:path.join(evidence,`recording-${width}.png`)});
   await page.getByRole('button',{name:'녹음 취소',exact:true}).first().click();
   await page.getByText('녹음과 남은 처리를 취소했습니다. 이미 저장한 음성과 받아쓰기는 유지합니다.',{exact:true}).first().waitFor();
   assert.equal(await page.evaluate(()=>window.__qa.calls.filter(call=>call.command==='ko_stop_recording').length),0);
   checks.push({width,scenario:'live-cancel',passed:true});
   await start().click();
   await page.evaluate(()=>{window.__qa.pendingStop=true;});await page.getByRole('button',{name:'녹음 중지',exact:true}).click();
   await page.getByRole('button',{name:'저장 취소',exact:true}).first().waitFor();
   await page.screenshot({path:path.join(evidence,`stopping-${width}.png`)});
   await page.getByRole('link',{name:'설정',exact:true}).click();assert.ok(await page.getByRole('button',{name:'저장 취소',exact:true}).isVisible());
   await page.evaluate(()=>window.__qa.emit('ko-exit-requested',null));
   await page.getByRole('button',{name:'녹음 취소 후 종료',exact:true}).click();
   await page.waitForFunction(()=>window.__qa.calls.some(call=>call.command==='ko_exit_app'));
   await page.evaluate(()=>window.__qa.finishStop());
   assert.equal(await page.getByRole('button',{name:'녹음 취소 후 종료',exact:true}).count(),0);
   checks.push({width,scenario:'stop-cancel-from-exit-dialog',passed:true});await page.close();
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(evidence,'browser-results.json'),JSON.stringify({scope:'Production frontend in Chrome; native command boundaries simulated',checks,errors},null,2));
  console.log(JSON.stringify({passed:checks.length,errors}));
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
