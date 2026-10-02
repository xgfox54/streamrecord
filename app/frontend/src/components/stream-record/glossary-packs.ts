export const glossaryPackSource = {
 title: '제454회 제7차 본회의 (2026-09-22)',
 url: 'https://record.council.jeju.kr/CLRecords/Retrieval2/index.php?daesu=13&hfile=13A0110454071.html',
 reviewedAt: '2026-10-01',
 method: 'curated-agenda-topics',
} as const;

type GlossaryPack = {
 readonly id: string;
 readonly label: string;
 readonly scope: string;
 readonly agendaItems: readonly number[];
 readonly terms: readonly string[];
};

export const glossaryPacks = [
 {id:'budget',label:'예산·결산',scope:'재정 심사와 결산 승인',agendaItems:[38,70,71,72,73,74,75],terms:[
  '예산결산특별위원회','국비예산','지방교육재정교부금','회계연도','결산','예비비','기금운용결산','기금결산',
 ]},
 {id:'welfare',label:'복지·보건',scope:'가족 지원, 건강 관리, 장애인 지원',agendaItems:[32,33,47,60,61,62,63],terms:[
  '보건복지안전위원회','가족친화','사회환경','고혈압','당뇨병','등록교육센터','장애인오케스트라','장애학생','가족 지원 프로그램','장애공감',
 ]},
 {id:'environment',label:'환경·에너지',scope:'기후 대응, 재생에너지, 물 관리',agendaItems:[34,35,36,38,39,54],terms:[
  '환경도시위원회','기후위기','탄소중립','녹색성장','풍력발전사업','가파도','RE100','전기자동차','지하수 관리 조례','환경교육',
 ]},
 {id:'economy',label:'경제·산업',scope:'시장 운영, 산업 전환, 창업',agendaItems:[3,35,36,37,38,51,52,57],terms:[
  '미래경제산업위원회','공공기관 제주 이전','제주시민속오일시장','민간위탁','풍력발전사업','전기자동차','4차 산업혁명','인공지능 인재 양성','제주창업체험교육지원센터',
 ]},
 {id:'urban',label:'도시·주거',scope:'도시재생과 주택 정비',agendaItems:[4,36,40,41],terms:[
  '환경도시위원회','공유재산관리계획안','애월복합지원센터','영구시설물','도시재생혁신지구','국가시범지구계획안','주택재건축정비사업','정비계획','정비구역',
 ]},
 {id:'culture',label:'문화·유산',scope:'문화유산 관리와 문화예술 교육',agendaItems:[42,43,44,45,58],terms:[
  '문화관광체육위원회','제주칠머리당영등굿','전수관','문화유산 돌봄사업','제주 고산리 유적','안내센터','문화유산 지킴이사업','문화예술 진로캠프',
 ]},
 {id:'education',label:'교육·청소년',scope:'학교 교육, 학생 지원, 교육재정',agendaItems:[46,50,51,52,55,56,57,59,66,67,68,70],terms:[
  '제주특별자치도교육청','교육위원회','공학아카데미','드론 아카데미','마을키움터','제주청소년 로스쿨','의무교육단계','학업중단학생','학교폭력 피해학생','교통안전','지방교육재정교부금',
 ]},
 {id:'administration',label:'행정·자치',scope:'의회 운영, 재산 관리, 위탁과 조례',agendaItems:[1,2,3,4,32,33,48,49],terms:[
  '제주특별자치도의회','행정자치위원회','4·3특별위원회','규제개혁특별위원회','공유재산관리계획안','민간위탁','재위탁','일부개정조례안','적극행정','직장 내 괴롭힘',
 ]},
] as const satisfies readonly GlossaryPack[];
