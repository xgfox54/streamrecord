'use strict';
// Automatic word-set selection during a real session: one decision per recording, native hint updated once,
// manual words kept first, never applied to records that are only opened.
const assert=require('node:assert/strict');
const storage=()=>new Map([['stream-record.option.ai-correction','false'],['stream-record.option.live-summary','false'],['stream-record.option.live-diarization','false']]);
const council=['위원장님, 행정사무감사 질의를 시작하겠습니다. 국장님께 질의드리겠습니다.','서귀포시 읍면동 권한 이양과 관련해서 행정시 차원의 애로사항을 듣고 싶습니다.','전년도 행정사무감사 지적사항 처리결과를 자료로 제출해 주십시오.','의원님 말씀하신 부분은 과제 발굴을 계속하고 있고 감사위원회와 협의하고 있습니다.','시정요구 사항에 대해서 조치결과를 정리해서 보고드리겠습니다.','추가질의 있으십니까? 없으면 정회하겠습니다.'];
const speak=async(h,lines,from=1)=>{for(const [i,text] of lines.entries())await h.run(()=>h.emit('transcript-update',{sequence_id:from+i,text,is_partial:false,audio_start_time:(from+i)*10}));};
module.exports=async({test,using,deferred})=>{
 await test('Recording a council audit adds the matching word sets once and updates the live recognition hint',()=>using({storage:storage(),overrides:{ko_update_stt_glossary:async()=>true}},async h=>{
  await h.run(()=>h.session.setGlossary('김희찬 서귀포시장'));await h.start();assert.equal(h.session.mode,'recording');
  await speak(h,council.slice(0,2));assert.equal(h.count('ko_update_stt_glossary'),0,'waits for about a minute of speech');
  await speak(h,[...council,...council],3);
  assert.ok(h.session.glossary.startsWith('김희찬 서귀포시장, '),'manual words stay first');assert.ok(h.session.glossary.includes('행정사무감사'));assert.ok(h.session.glossary.length<=500);
  assert.equal(h.count('ko_update_stt_glossary'),1);assert.match(h.session.autoGlossary.message,/행정사무감사·질문/);assert.ok(h.session.autoGlossary.labels.includes('행정사무감사·질문'));
  const chosen=h.session.glossary;await speak(h,['예산안 세입 세출 일반회계 특별회계 결산 승인 예비비 추경 이월 불용액을 검토합니다.'],30);
  assert.equal(h.session.glossary,chosen,'one decision per recording');assert.equal(h.count('ko_update_stt_glossary'),1);
 }));
 await test('The next recording starts from the user\'s own words instead of the previous meeting\'s automatic words',()=>using({storage:storage(),overrides:{ko_update_stt_glossary:async()=>true}},async h=>{
  await h.run(()=>h.session.setGlossary('김희찬 서귀포시장'));await h.start();await speak(h,[...council,...council]);
  const first=h.session.glossary;assert.ok(first.includes('행정사무감사'));assert.ok(first.length>200);
  await h.run(()=>h.session.stop());assert.equal(h.session.mode,'idle');
  const welfare=['기초생활수급자 지원과 통합돌봄, 노인일자리 사업을 보고드리겠습니다.','장애인복지관 운영과 치매안심센터 예산, 경로당 지원을 점검하겠습니다.','아동학대 예방과 어린이집 보육, 저출생 대책도 질의하겠습니다.','보건소 공공의료와 응급의료, 감염병 대응도 확인하겠습니다.'];
  await h.start();assert.equal(h.session.mode,'recording');assert.equal(h.session.glossary,'김희찬 서귀포시장','previous automatic words are cleared at the next recording');
  await speak(h,[...welfare,...welfare,...welfare],50);
  assert.ok(h.session.glossary.startsWith('김희찬 서귀포시장, '));assert.ok(h.session.glossary.includes('기초생활수급자'));assert.ok(h.session.autoGlossary.labels.includes('복지·보건·안전'));
  assert.equal(h.session.glossary.includes('행정사무감사'),false);assert.equal(h.session.glossary.split('김희찬 서귀포시장').length,2);
 }));
 await test('Switching automatic selection off leaves the word list unchanged',()=>using({storage:storage(),overrides:{ko_update_stt_glossary:async()=>true}},async h=>{
 await test('A meeting that turns out differently is reviewed once at about five minutes and then left alone',()=>using({storage:storage(),overrides:{ko_update_stt_glossary:async()=>true}},async h=>{
  await h.run(()=>h.session.setGlossary('김희찬 서귀포시장'));await h.start();await speak(h,[...council,...council]);
  assert.equal(h.count('ko_update_stt_glossary'),1);assert.ok(h.session.glossary.includes('행정사무감사'));
  const budget=Array.from({length:60},()=> '예산안 세입 세출 일반회계 특별회계 결산 승인 예비비 추경 이월 불용액 체납률을 검토합니다.');
  await speak(h,budget,20);
  assert.equal(h.count('ko_update_stt_glossary'),2);assert.ok(h.session.autoGlossary.labels.includes('예산·결산'));assert.match(h.session.autoGlossary.message,/더 듣고/);
  assert.ok(h.session.glossary.startsWith('김희찬 서귀포시장, '),'rebuilt from the words that were there before');assert.ok(h.session.glossary.includes('체납률'));assert.ok(h.session.glossary.length<=500);
  assert.equal(h.session.glossary.split('김희찬 서귀포시장').length,2);
  const final=h.session.glossary;await speak(h,[...council,...council],100);assert.equal(h.session.glossary,final);assert.equal(h.count('ko_update_stt_glossary'),2);
 }));
  await h.run(()=>h.session.autoGlossary.setEnabled(false));await h.start();await speak(h,[...council,...council]);
  assert.equal(h.session.glossary,'');assert.equal(h.count('ko_update_stt_glossary'),0);assert.equal(h.session.autoGlossary.message,'');
  await h.run(()=>h.session.autoGlossary.setEnabled(true));
 }));
 await test('Opening a saved record never changes its word list',()=>using({storage:storage(),snapshot:{version:1,title:'저장된 감사 기록',glossary:'',minutes:'',startedAt:null,rows:[...council,...council].map((text,i)=>({sequence_id:i+1,text,is_partial:false}))}},async h=>{
  await h.run(async()=>{});assert.equal(h.session.rows.length,12);assert.equal(h.session.glossary,'');assert.equal(h.count('ko_update_stt_glossary'),0);
 }));
 await test('A YouTube council broadcast is matched from its video title, even when the title arrives after recording starts',()=>using({storage:storage(),overrides:{ko_update_stt_glossary:async()=>true,ko_validate_video:async()=>'https://www.youtube.com/watch?v=abc12345678'}},async h=>{
  const title=deferred();h.overrides.set('ko_video_title',()=>title.promise);
  await h.run(()=>h.session.setConsent(true));await h.run(()=>h.session.setVideoUrl('https://youtu.be/abc12345678'));await h.run(()=>h.session.startVideo());
  assert.equal(h.session.mode,'recording');assert.equal(h.session.glossary,'');assert.equal(h.count('ko_update_stt_glossary'),0);
  await h.run(async()=>{title.resolve('제454회 제주특별자치도의회 임시회 제2차 행정자치위원회 행정사무감사');await title.promise;});
  assert.ok(h.session.glossary.includes('행정사무감사'));assert.ok(h.session.glossary.includes('행정자치위원회'));assert.match(h.session.autoGlossary.message,/영상 제목을 보고/);assert.equal(h.count('ko_update_stt_glossary'),1);
  assert.equal(h.calls.find(call=>call.command==='ko_video_title').args.url,'https://www.youtube.com/watch?v=abc12345678');
 }));
 await test('A microphone recording ignores the title of a video loaded earlier',()=>using({storage:storage(),overrides:{ko_update_stt_glossary:async()=>true,ko_validate_video:async()=>'https://www.youtube.com/watch?v=abc12345678',ko_video_title:async()=>'제2차 행정자치위원회 행정사무감사'}},async h=>{
  await h.run(()=>h.session.setVideoUrl('https://youtu.be/abc12345678'));await h.run(()=>h.session.prepareVideo());assert.equal(h.count('ko_video_title'),1);
  await h.start();assert.equal(h.session.mode,'recording');assert.equal(h.session.glossary,'');assert.equal(h.count('ko_update_stt_glossary'),0);
 }));
};
