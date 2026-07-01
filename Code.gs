// ================================================================
//  276홀딩스 사내 교육 포털 — Google Apps Script 백엔드 v3.0
//  Google Sheets ID 아래 SHEET_ID 에 지정
//  배포: 확장 → Apps Script → 배포 → 새 배포 → 웹 앱
//        실행: 나 / 액세스: "모든 사용자(익명 포함)"
//  ----------------------------------------------------------------
//  v3.0 추가: 계정(login/signup/create_account), 교과서(save/get_textbook),
//            퀴즈(save_quiz/add_questions/deploy_quiz/get_questions),
//            진도/완료 조회(get_progress), 교육완료 집계(get_completions)
//  v3.1 추가: 계정 기반 관리자 인증 — employees.역할 + login 토큰 발급,
//            관리자 API는 adminToken 검증(isAdmin). 하드코딩 공유키 제거.
//            최초 관리자: Apps Script 편집기에서 createAdmin/promoteToAdmin 1회 실행.
// ================================================================

const SHEET_ID        = '1D_Iml7YM2rTDNQprumUCiUtI09aTFEhGARLxWWIk5WI';
// 레거시 공유키: 기본 비활성. 과도기 호환이 필요하면 Script 속성 ADMIN_KEY에만 설정(소스에 저장하지 않음)
const ADMIN_KEY       = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY') || '';

// 시트 이름
const SHEET_QUIZRESULT = '응답데이터';
const SHEET_PROGRESS   = '학습진도';
const SHEET_REQUEST    = '퀴즈신청';
const SHEET_EMPLOYEES  = 'employees';
const SHEET_ACCOUNTREQ = 'account_requests';
const SHEET_TEXTBOOKS  = 'textbooks';
const SHEET_QUIZZES    = 'quizzes';
const SHEET_QUESTIONS  = 'quiz_questions';
const SHEET_REMEDIATION= 'remediation_tasks';
const SHEET_REGKEYS    = 'reg_keys';

// ── 공통 헬퍼 ──────────────────────────────────────────────────
function ss(){ return SpreadsheetApp.openById(SHEET_ID); }
function ok(extra){ return ContentService.createTextOutput(JSON.stringify(Object.assign({status:'ok'},extra))).setMimeType(ContentService.MimeType.JSON); }
function err(msg){ return ContentService.createTextOutput(JSON.stringify({status:'error',message:msg})).setMimeType(ContentService.MimeType.JSON); }
function now(){ return Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm:ss'); }
function uid(p){ return (p||'id')+'_'+Date.now()+'_'+Math.floor(Math.random()*9999); }

// 시트 보장(없으면 헤더와 함께 생성)
function sheetWith(name, headers, bg){
  const s = ss().getSheetByName(name) || ss().insertSheet(name);
  if (s.getLastRow() === 0){
    s.appendRow(headers);
    const r = s.getRange(1,1,1,headers.length);
    r.setBackground(bg||'#4527A0'); r.setFontColor('#FFFFFF'); r.setFontWeight('bold');
    s.setFrozenRows(1);
  }
  return s;
}
function getRows(name){
  const s = ss().getSheetByName(name);
  if (!s || s.getLastRow() < 2) return {headers:(s?s.getDataRange().getValues()[0]:[]), rows:[]};
  const v = s.getDataRange().getValues();
  return { headers:v[0], rows:v.slice(1) };
}
function sha256(str){
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  return raw.map(function(b){ return ('0'+(b&0xFF).toString(16)).slice(-2); }).join('');
}
function tempPw(){ return 'Tmp#'+Math.floor(1000+Math.random()*9000); }

// ── 3단계 역할 인증(계정 기반) ──────────────────────────────
// employees 컬럼: ...9 상태, 10 역할, 11 비번변경필요
const ROLE_COL = 10; // 0-based index in employees row
const PWFLAG_COL = 11; // 비번변경필요(Y/N)
// 원시 역할 문자열 → 'super'(최고관리자) | 'operator'(운영자) | 'user'(사원)
function roleOf(raw){
  raw = String(raw||'');
  if (raw==='최고관리자'||raw==='관리자'||raw==='admin'||raw==='superadmin') return 'super';
  if (raw==='운영자'||raw==='operator') return 'operator';
  return 'user';
}
function isAdminLevel(role){ return role==='super'||role==='operator'; } // 어드민 콘솔 접근 가능
function adminSecret(){ return PropertiesService.getScriptProperties().getProperty('ADMIN_SECRET') || 'lms-276-default-secret-change-me'; }
// 세션 토큰: 사원ID·비번해시·서버시크릿으로 파생(상태 저장 불필요, 비번 변경 시 자동 무효화)
function makeAdminToken(sawonId, pwHash){ return sha256(String(sawonId)+'|'+String(pwHash)+'|'+adminSecret()); }
// 토큰이 속한 역할 반환: 'super'|'operator'|null
function tokenRole(p){
  p = p || {};
  if (ADMIN_KEY && (p.key||'') === ADMIN_KEY) return 'super';   // 레거시(설정 시에만) = 최고관리자
  const token = p.token || '';
  if (!token) return null;
  const {rows} = getRows(SHEET_EMPLOYEES);
  for (let i=0;i<rows.length;i++){
    const r = roleOf(rows[i][ROLE_COL]);
    if (isAdminLevel(r) && makeAdminToken(rows[i][0], rows[i][5]) === token) return r;
  }
  return null;
}
function isAdmin(p){ return tokenRole(p) !== null; }   // 최고관리자 또는 운영자
function isSuper(p){ return tokenRole(p) === 'super'; } // 최고관리자만(운영자 등록키 발급 등)
// 등록키 생성: OP-XXXXXXXX-XXXXXXXX
function genRegKey(){ const u=Utilities.getUuid().replace(/-/g,'').toUpperCase(); return 'OP-'+u.slice(0,8)+'-'+u.slice(8,16); }
// 로그인 처리(GET/POST 공용). pw 없으면 인터림(사원) 허용, pw 검증+관리자면 토큰 발급
function loginLogic(loginId, pw, name){
  const {rows} = getRows(SHEET_EMPLOYEES);
  for (let i=0;i<rows.length;i++){
    if (String(rows[i][2]) === String(loginId)){
      if (pw){
        if (sha256(pw + rows[i][6]) !== rows[i][5]) return err('비밀번호가 일치하지 않습니다');
      }
      if (String(rows[i][9])==='정지') return err('정지된 계정입니다. 관리자에게 문의하세요.');
      const role = roleOf(rows[i][ROLE_COL]);
      const res = { login:true, sawonId:rows[i][0], name:rows[i][1], dept:rows[i][8], status:rows[i][9],
                    role: role, mustChange: (String(rows[i][PWFLAG_COL])==='Y') };
      if (isAdminLevel(role) && pw) res.adminToken = makeAdminToken(rows[i][0], rows[i][5]); // 관리자 토큰은 비번 검증 시에만
      return ok(res);
    }
  }
  if (name) return ok({ login:true, sawonId:'', name:name, dept:'', status:'미등록', interim:true, role:'user' });
  return err('등록되지 않은 로그인 아이디입니다');
}

// ── 역할·등록키·계정관리 공용 핸들러(GET·POST 공통, p=params) ──
function h_create_regkey(p){
  if (!isSuper(p)) return err('unauthorized');
  const s = sheetWith(SHEET_REGKEYS, ['등록키','메모','발급자','발급일시','상태','사용자','대상역할','사용일시'], '#37474F');
  const key = genRegKey();
  s.appendRow([ key, p.memo||'', p.issuer||'', now(), '미사용', '', p.targetRole||'운영자', '' ]);
  return ok({ created:true, key:key });
}
function h_delete_regkey(p){
  if (!isSuper(p)) return err('unauthorized');
  const s = ss().getSheetByName(SHEET_REGKEYS); if(!s) return err('no sheet');
  const v = s.getDataRange().getValues();
  for (let i=1;i<v.length;i++) if (String(v[i][0])===String(p.key)){ s.deleteRow(i+1); return ok({deleted:true}); }
  return err('등록키를 찾을 수 없습니다');
}
function h_register_with_key(p){
  const key = String(p.regkey||'').trim();
  const loginId = String(p.loginId||'').trim();
  const pw = String(p.pw||'');
  if (!key || !loginId || pw.length < 4) return err('등록키·로그인ID·비밀번호(4자+)를 확인하세요');
  const ks = ss().getSheetByName(SHEET_REGKEYS); if(!ks) return err('등록키 시스템이 초기화되지 않았습니다');
  const kv = ks.getDataRange().getValues(); let ki=-1;
  for (let i=1;i<kv.length;i++) if (String(kv[i][0])===key){ ki=i; break; }
  if (ki<0) return err('유효하지 않은 등록키입니다');
  if (String(kv[ki][4])!=='미사용') return err('이미 사용된 등록키입니다');
  const emp = sheetWith(SHEET_EMPLOYEES, ['사원ID','이름','로그인ID','이메일ID','휴대폰','비밀번호해시','salt','입사일','부서','상태','역할','비번변경필요'], '#4527A0');
  const ev = emp.getDataRange().getValues();
  for (let i=1;i<ev.length;i++) if (String(ev[i][2])===loginId) return err('이미 사용 중인 로그인ID입니다');
  const salt = uid('s'); const sawonId = uid('emp'); const targetRole = String(kv[ki][6]||'운영자');
  emp.appendRow([ sawonId, p.name||loginId, loginId, (loginId+'@276holdings.com'), p.phone||'',
                  sha256(pw+salt), salt, now(), p.dept||'', '활성', targetRole, 'N' ]);
  ks.getRange(ki+1,5).setValue('사용됨'); ks.getRange(ki+1,6).setValue(loginId); ks.getRange(ki+1,8).setValue(now());
  return ok({ registered:true, loginId:loginId, role: roleOf(targetRole) });
}
// 대상 계정 행 찾기 + 권한 검사. 반환 {sheet,rowIdx1,targetRole} 또는 {error}
function _findManageable(p){
  const acting = tokenRole(p); // 'super'|'operator'
  const s = ss().getSheetByName(SHEET_EMPLOYEES); if(!s) return {error:'no emp'};
  const v = s.getDataRange().getValues();
  for (let i=1;i<v.length;i++) if (String(v[i][2])===String(p.loginId)){
    const tr = roleOf(v[i][ROLE_COL]);
    if (tr==='super') return {error:'최고관리자 계정은 대상이 아닙니다'};
    if (tr==='operator' && acting!=='super') return {error:'운영자 계정은 최고관리자만 관리할 수 있습니다'};
    return { sheet:s, rowIdx1:i+1, targetRole:tr };
  }
  return {error:'계정을 찾을 수 없습니다'};
}
function h_set_account_status(p){
  if (!isAdmin(p)) return err('unauthorized');
  const f = _findManageable(p); if (f.error) return err(f.error);
  f.sheet.getRange(f.rowIdx1,10).setValue(p.status==='정지'?'정지':'활성');
  return ok({ updated:true, status:(p.status==='정지'?'정지':'활성') });
}
function h_reset_password(p){
  if (!isAdmin(p)) return err('unauthorized');
  const f = _findManageable(p); if (f.error) return err(f.error);
  const salt = uid('s'); const pw = p.tempPw || tempPw();
  f.sheet.getRange(f.rowIdx1,6).setValue(sha256(pw+salt)); f.sheet.getRange(f.rowIdx1,7).setValue(salt);
  f.sheet.getRange(f.rowIdx1,PWFLAG_COL+1).setValue('Y');
  return ok({ reset:true, loginId:p.loginId, tempPw:pw });
}
function h_delete_account(p){
  if (!isAdmin(p)) return err('unauthorized');
  const f = _findManageable(p); if (f.error) return err(f.error);
  f.sheet.deleteRow(f.rowIdx1);
  return ok({ deleted:true });
}

// 시트 초기화(최초 1회 수동 실행 권장)
function initAllSheets(){
  sheetWith(SHEET_QUIZRESULT, ['타임스탬프','성명','퀴즈','정답수','점수%','등급','오답태그','상세JSON'], '#4A148C');
  sheetWith(SHEET_PROGRESS,   ['타임스탬프','성명','챕터번호','챕터명'], '#1565C0');
  sheetWith(SHEET_REQUEST,    ['타임스탬프','성명','상태','SlackID'], '#2E7D32');
  sheetWith(SHEET_EMPLOYEES,  ['사원ID','이름','로그인ID','이메일ID','휴대폰','비밀번호해시','salt','입사일','부서','상태','역할','비번변경필요'], '#4527A0');
  sheetWith(SHEET_REGKEYS,    ['등록키','메모','발급자','발급일시','상태','사용자','대상역할','사용일시'], '#37474F');
  sheetWith(SHEET_ACCOUNTREQ, ['요청일시','이름','휴대폰','이메일용아이디','상태','관리자메모'], '#673AB7');
  sheetWith(SHEET_TEXTBOOKS,  ['교재ID','제목','방식','URL','주차','챕터수','부서','노출','등록일시'], '#00838F');
  sheetWith(SHEET_QUIZZES,    ['퀴즈ID','퀴즈명','연결교재','합격기준','노출','등록일시'], '#E65100');
  sheetWith(SHEET_QUESTIONS,  ['문항ID','퀴즈ID','유형','질문','보기','정답','진단태그','난이도','해설','활성','등록일시'], '#C62828');
  sheetWith(SHEET_REMEDIATION, ['생성일시','사원','취약태그','보강제목','상태'], '#00695C');
  return '초기화 완료';
}


// ════════════════════════════════════════════════════════════════
//  POST
// ════════════════════════════════════════════════════════════════
function doPost(e){
  try{
    const data = JSON.parse(e.postData.contents);
    const action = data.action || 'quiz';

    // ── 계정 요청(Sign-Up) ──
    if (action === 'signup'){
      const s = sheetWith(SHEET_ACCOUNTREQ, ['요청일시','이름','휴대폰','이메일용아이디','상태','관리자메모'], '#673AB7');
      s.appendRow([ now(), data.name, data.phone, data.emailId, '관리자확인대기', '' ]);
      return ok({ requested:true });
    }

    // ── AI 교과서 재구성 (Anthropic) ──
    if (action === 'ai_textbook'){
      if (!isAdmin(data)) return err('unauthorized');
      const props = PropertiesService.getScriptProperties();
      const apiKey = props.getProperty('ANTHROPIC_API_KEY');
      if (!apiKey) return err('no_api_key');
      const model = props.getProperty('AI_MODEL') || 'claude-3-5-sonnet-20241022';
      const src = String(data.text||'').slice(0, 18000);
      const titleHint = data.title || '';
      const prompt =
        '너는 한국어 기업 교육 콘텐츠 편집자다. 아래 원문(PDF 추출 텍스트)을 신입사원용 교과서로 재구성하라.\n' +
        '반드시 JSON 객체 하나만 출력하라(설명·코드펜스 금지).\n' +
        '스키마: {"title":"교재명","chapters":[{"t":"장 제목","sum":["핵심요약 2~4개"],"blocks":[블록들]}]}\n' +
        '블록 종류: {"type":"para","text":"문단"} | {"type":"list","items":["항목"]} | {"type":"table","headers":["열"],"rows":[["셀"]]} | {"type":"callout","title":"제목","text":"강조"} | {"type":"formula","text":"공식"} | {"type":"example","text":"예시"}\n' +
        '원문의 표는 table 블록, 나열은 list, 공식/계산식은 formula로 살려라. 장은 5~12개, 각 장 blocks 3~8개. 군더더기 제거하고 신입사원이 이해하기 쉽게 다듬어라.\n' +
        (titleHint ? ('교재명 힌트: ' + titleHint + '\n') : '') +
        '---원문---\n' + src;
      const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
        method:'post', contentType:'application/json', muteHttpExceptions:true,
        headers:{ 'x-api-key':apiKey, 'anthropic-version':'2023-06-01' },
        payload: JSON.stringify({ model:model, max_tokens:8000, messages:[{role:'user', content:prompt}] })
      });
      const code = res.getResponseCode(); const raw = res.getContentText();
      if (code !== 200) return err('ai_http_' + code + ': ' + raw.slice(0,300));
      let txt=''; try{ txt = JSON.parse(raw).content[0].text; }catch(e2){ return err('ai_parse'); }
      txt = txt.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```$/,'').trim();
      let obj=null; try{ obj=JSON.parse(txt); }catch(e3){ const m=txt.match(/\{[\s\S]*\}/); if(m){ try{obj=JSON.parse(m[0]);}catch(e4){} } }
      if (!obj || !obj.chapters) return err('ai_json');
      return ok({ book: obj });
    }

    // ── 로그인(POST) ── ※ 브라우저에서 응답을 읽으려면 GET 사용 권장(CORS)
    if (action === 'login'){
      return loginLogic(data.loginId, data.pw, data.name);
    }

    // ── 비밀번호 변경 ──
    if (action === 'change_password'){
      const s = ss().getSheetByName(SHEET_EMPLOYEES); if(!s) return err('no employees');
      const v = s.getDataRange().getValues();
      for (let i=1;i<v.length;i++){
        if (String(v[i][2]) === String(data.loginId)){
          // 현재 비번 검증(제공된 경우) — 강제변경 흐름에서 임시비번 확인
          if (data.curPw && sha256(data.curPw + v[i][6]) !== v[i][5]) return err('현재 비밀번호가 일치하지 않습니다');
          if (!data.newPw || String(data.newPw).length < 4) return err('새 비밀번호는 4자 이상이어야 합니다');
          const salt = uid('s');
          s.getRange(i+1,6).setValue(sha256(data.newPw+salt));
          s.getRange(i+1,7).setValue(salt);
          s.getRange(i+1,PWFLAG_COL+1).setValue('N'); // 비번변경필요 해제
          return ok({ changed:true });
        }
      }
      return err('계정 없음');
    }

    // ── 역할·등록키·계정관리 (GET/POST 공용 핸들러) ──
    if (action === 'create_regkey')      return h_create_regkey(data);
    if (action === 'delete_regkey')      return h_delete_regkey(data);
    if (action === 'register_with_key')  return h_register_with_key(data);
    if (action === 'set_account_status') return h_set_account_status(data);
    if (action === 'reset_password')     return h_reset_password(data);
    if (action === 'delete_account')     return h_delete_account(data);

    // ── 학습 진도 저장(교과서 핵심요약/교육완료 공통) ──
    if (action === 'progress'){
      const s = sheetWith(SHEET_PROGRESS, ['타임스탬프','성명','챕터번호','챕터명'], '#1565C0');
      s.appendRow([ now(), data.name, data.chapter, data.chapterName ]);
      return ok({ saved:true });
    }

    // ── 퀴즈 응시 신청 ──
    if (action === 'quiz_request'){
      const s = sheetWith(SHEET_REQUEST, ['타임스탬프','성명','상태','SlackID'], '#2E7D32');
      const v = s.getDataRange().getValues();
      for (let i=1;i<v.length;i++) if (v[i][1]===data.name && v[i][2]==='대기중') return ok({duplicate:true});
      s.appendRow([ now(), data.name, '대기중', data.slackId||'' ]);
      return ok({ saved:true });
    }

    // ── 퀴즈 결과 제출 ──
    if (action === 'quiz_submit'){
      const s = sheetWith(SHEET_QUIZRESULT, ['타임스탬프','성명','퀴즈','정답수','점수%','등급','오답태그','상세JSON'], '#4A148C');
      let detailStr=''; try{ detailStr = data.detail ? JSON.stringify(data.detail) : ''; }catch(e){ detailStr=''; }
      s.appendRow([ now(), data.name, data.quiz||'', data.correct, (data.pct||0)+'%', data.grade||'', (data.weakTags||[]).join(','), detailStr ]);
      return ok({ saved:true });
    }

    // ── 승인(관리자) ──
    if (action === 'approve'){
      if (!isAdmin(data)) return err('unauthorized');
      const s = ss().getSheetByName(SHEET_REQUEST); if(!s) return err('no sheet');
      const v = s.getDataRange().getValues();
      for (let i=1;i<v.length;i++) if (v[i][1]===data.name){ s.getRange(i+1,3).setValue('승인'); return ok({approved:true}); }
      return err('name not found');
    }

    // ── 계정 생성(관리자) ──
    if (action === 'create_account'){
      if (!isAdmin(data)) return err('unauthorized');
      const emp = sheetWith(SHEET_EMPLOYEES, ['사원ID','이름','로그인ID','이메일ID','휴대폰','비밀번호해시','salt','입사일','부서','상태','역할','비번변경필요'], '#4527A0');
      const salt = uid('s'); const pw = data.tempPw || tempPw();
      const sawonId = uid('emp');
      // 계정요청 승낙으로 생성되는 계정은 항상 '사원'(운영자는 등록키로만 생성). 임시비번 → 최초 로그인 변경 강제
      emp.appendRow([ sawonId, data.name, data.loginId, data.emailId||(data.loginId+'@276holdings.com'), data.phone||'',
                      sha256(pw+salt), salt, now(), data.dept||'', '활성', '사원', 'Y' ]);
      // 요청 상태 업데이트
      const req = ss().getSheetByName(SHEET_ACCOUNTREQ);
      if (req){ const v=req.getDataRange().getValues(); for(let i=1;i<v.length;i++) if(v[i][1]===data.name && v[i][4]==='관리자확인대기'){ req.getRange(i+1,5).setValue('승인'); break; } }
      return ok({ created:true, sawonId:sawonId, loginId:data.loginId, tempPw:pw });
    }

    // ── 교과서 저장(관리자) ──
    if (action === 'save_textbook'){
      const s = sheetWith(SHEET_TEXTBOOKS, ['교재ID','제목','방식','URL','주차','챕터수','부서','노출','등록일시'], '#00838F');
      s.appendRow([ data.id||uid('tb'), data.title, data.method||'link', data.url||'', data.week||1, data.chap||1, data.dept||'공통', data.active===false?'비노출':'노출', now() ]);
      return ok({ saved:true });
    }

    // ── 퀴즈 저장(관리자) ──
    if (action === 'save_quiz'){
      const s = sheetWith(SHEET_QUIZZES, ['퀴즈ID','퀴즈명','연결교재','합격기준','노출','등록일시'], '#E65100');
      s.appendRow([ data.id||uid('qz'), data.name, data.book||'', data.pass||80, '노출', now() ]);
      return ok({ saved:true });
    }

    // ── 문항 추가(관리자) ──
    if (action === 'add_questions'){
      const s = sheetWith(SHEET_QUESTIONS, ['문항ID','퀴즈ID','유형','질문','보기','정답','진단태그','난이도','해설','활성','등록일시'], '#C62828');
      const q = data.question || data;
      s.appendRow([ q.id||uid('q'), q.quiz||data.quiz||'', q.type||'ox', q.text||'',
                    JSON.stringify(q.opts||[]), String(q.ans), q.tag||'미분류', q.diff||'중', q.exp||'', q.active===false?'N':'Y', now() ]);
      return ok({ added:true });
    }

    // ── 보강 과제 생성(관리자) ──
    if (action === 'add_remediation'){
      if (!isAdmin(data)) return err('unauthorized');
      const s = sheetWith(SHEET_REMEDIATION, ['생성일시','사원','취약태그','보강제목','상태'], '#00695C');
      s.appendRow([ now(), data.name, (data.tags||[]).join(','), data.title||'', '생성' ]);
      return ok({ created:true });
    }

    // ── 퀴즈 배포(관리자) ──
    if (action === 'deploy_quiz'){
      // 배포 로그만 기록(문항은 add_questions로 이미 저장됨)
      const s = sheetWith(SHEET_QUIZZES, ['퀴즈ID','퀴즈명','연결교재','합격기준','노출','등록일시'], '#E65100');
      const v = s.getDataRange().getValues(); let found=false;
      const qz = data.quiz||{};
      for (let i=1;i<v.length;i++) if (String(v[i][0])===String(qz.id)){ s.getRange(i+1,5).setValue('배포'); found=true; break; }
      if (!found && qz.name) s.appendRow([ qz.id||uid('qz'), qz.name, qz.book||'', qz.pass||80, '배포', now() ]);
      return ok({ deployed:true, count:(data.questions||[]).length });
    }

    // ── 기본: 레거시 퀴즈 응답(30문항 OX) ──
    const s = sheetWith(SHEET_QUIZRESULT, ['타임스탬프','성명','퀴즈','정답수','점수%','등급','오답태그','상세JSON'], '#4A148C');
    s.appendRow([ now(), data.name, data.quiz||'', data.correct, (data.pct||0)+'%', data.grade||'', '' ]);
    return ok({ saved:true });

  } catch(ex){ return err(ex.toString()); }
}


// ════════════════════════════════════════════════════════════════
//  GET
// ════════════════════════════════════════════════════════════════
function doGet(e){
  const action = (e.parameter.action||'').trim();

  // 로그인(GET) — 브라우저가 응답(role/adminToken)을 읽을 수 있도록 GET로 처리
  if (action === 'login'){
    return loginLogic(e.parameter.loginId, e.parameter.pw, e.parameter.name);
  }

  // 응답을 읽어야 하는 변이 액션(GET 경유, CORS) — 등록키·셀프가입·계정관리
  if (action === 'create_regkey')      return h_create_regkey(e.parameter);
  if (action === 'delete_regkey')      return h_delete_regkey(e.parameter);
  if (action === 'register_with_key')  return h_register_with_key(e.parameter);
  if (action === 'set_account_status') return h_set_account_status(e.parameter);
  if (action === 'reset_password')     return h_reset_password(e.parameter);
  if (action === 'delete_account')     return h_delete_account(e.parameter);
  if (action === 'change_password'){
    const s = ss().getSheetByName(SHEET_EMPLOYEES); if(!s) return err('no employees');
    const v = s.getDataRange().getValues();
    for (let i=1;i<v.length;i++) if (String(v[i][2])===String(e.parameter.loginId)){
      if (e.parameter.curPw && sha256(e.parameter.curPw + v[i][6]) !== v[i][5]) return err('현재 비밀번호가 일치하지 않습니다');
      if (!e.parameter.newPw || String(e.parameter.newPw).length < 4) return err('새 비밀번호는 4자 이상이어야 합니다');
      const salt = uid('s'); s.getRange(i+1,6).setValue(sha256(e.parameter.newPw+salt));
      s.getRange(i+1,7).setValue(salt); s.getRange(i+1,PWFLAG_COL+1).setValue('N');
      return ok({ changed:true });
    }
    return err('계정 없음');
  }

  // 최고관리자: 등록키 목록
  if (action === 'list_regkeys'){
    if (!isSuper(e.parameter)) return err('unauthorized');
    const {rows} = getRows(SHEET_REGKEYS);
    return ok({ regkeys: rows.map(r=>({ key:r[0], memo:r[1], issuer:r[2], issuedAt:r[3], status:r[4], usedBy:r[5], targetRole:r[6], usedAt:r[7] })) });
  }

  // 공개: 교과서 목록(노출만)
  if (action === 'get_textbooks'){
    const {rows} = getRows(SHEET_TEXTBOOKS);
    const list = rows.filter(r=>r[7]!=='비노출').map(r=>({ id:r[0],title:r[1],method:r[2],url:r[3],week:r[4],chap:r[5],dept:r[6],active:r[7]==='노출' }));
    return ok({ textbooks:list });
  }

  // 공개: 특정 퀴즈 문항(활성만)
  if (action === 'get_questions'){
    const quiz = (e.parameter.quiz||'').trim();
    const {rows} = getRows(SHEET_QUESTIONS);
    const list = rows.filter(r=>(!quiz||String(r[1])===quiz) && r[9]!=='N').map(r=>{
      let opts=[]; try{opts=JSON.parse(r[4]);}catch(_){}
      return { id:r[0],quiz:r[1],type:r[2],text:r[3],opts:opts,ans:r[5],tag:r[6],diff:r[7],exp:r[8] };
    });
    return ok({ questions:list });
  }

  // 공개: 승인 확인(학생)
  if (action === 'check_approval'){
    const name=(e.parameter.name||'').trim();
    const s=ss().getSheetByName(SHEET_REQUEST); if(!s) return ok({approved:false});
    const v=s.getDataRange().getValues();
    for(let i=1;i<v.length;i++) if(v[i][1]===name && v[i][2]==='승인') return ok({approved:true});
    return ok({approved:false});
  }

  // 관리자: 승인(GET, CORS 우회)
  if (action === 'approve'){
    if (!isAdmin(e.parameter)) return err('unauthorized');
    const s=ss().getSheetByName(SHEET_REQUEST); if(!s) return err('no sheet');
    const v=s.getDataRange().getValues();
    for(let i=1;i<v.length;i++) if(v[i][1]===(e.parameter.name||'').trim()){ s.getRange(i+1,3).setValue('승인'); return ok({approved:true}); }
    return err('not found');
  }

  // 관리자: 삭제
  if (action === 'delete_request'){
    if (!isAdmin(e.parameter)) return err('unauthorized');
    const s=ss().getSheetByName(SHEET_REQUEST); if(!s) return err('no sheet');
    const v=s.getDataRange().getValues();
    for(let i=1;i<v.length;i++) if(v[i][1]===(e.parameter.name||'').trim() && String(v[i][0])===(e.parameter.ts||'').trim()){ s.deleteRow(i+1); return ok({deleted:true}); }
    return err('not found');
  }

  // 관리자: 진도 조회
  if (action === 'get_progress'){
    if (!isAdmin(e.parameter)) return err('unauthorized');
    const {rows} = getRows(SHEET_PROGRESS);
    return ok({ progress: rows.map(r=>({ ts:r[0], name:r[1], chapter:r[2], chapterName:r[3] })) });
  }

  // 관리자: 교과서별 교육완료 집계
  if (action === 'get_completions'){
    if (!isAdmin(e.parameter)) return err('unauthorized');
    const {rows} = getRows(SHEET_PROGRESS);
    // chapterName 형식: "[교과서명] ..." / 교육완료는 "✓ 교육완료" 포함
    const map = {}; // name -> { book -> {progress:n, done:bool} }
    rows.forEach(r=>{
      const name=r[1], cn=String(r[3]||'');
      const m = cn.match(/^\[([^\]]+)\]\s*(.*)$/);
      if(!m) return;
      const book=m[1], rest=m[2];
      map[name]=map[name]||{};
      map[name][book]=map[name][book]||{progress:0,done:false};
      if (rest.indexOf('교육완료')>=0) map[name][book].done=true;
      else map[name][book].progress++;
    });
    return ok({ completions: map });
  }

  // 관리자: 계정 요청 + 사원 목록
  if (action === 'get_account_requests'){
    if (!isAdmin(e.parameter)) return err('unauthorized');
    const req=getRows(SHEET_ACCOUNTREQ), emp=getRows(SHEET_EMPLOYEES);
    return ok({
      viewerRole: tokenRole(e.parameter),   // 'super'|'operator' — 프론트 UI 게이팅용
      requests: req.rows.map(r=>({ts:r[0],name:r[1],phone:r[2],emailId:r[3],status:r[4],memo:r[5]})),
      employees: emp.rows.map(r=>({sawonId:r[0],name:r[1],loginId:r[2],emailId:r[3],phone:r[4],joinedAt:r[7],dept:r[8],status:r[9],role:roleOf(r[ROLE_COL]),roleLabel:(r[ROLE_COL]||'사원'),mustChange:(String(r[PWFLAG_COL])==='Y')}))
    });
  }

  // 관리자: 퀴즈 점수(quiz_results) 조회 — 레거시(30문항 OX) + 신규(7컬럼) 호환
  if (action === 'get_scores'){
    if (!isAdmin(e.parameter)) return err('unauthorized');
    const qr=getRows(SHEET_QUIZRESULT);
    const out=qr.rows.map(r=>{
      // 레거시 핀테크 OX 포맷: [ts,성명,Q1..Q30,정답수(32),점수%(33),등급(34)]
      if (r.length>=33){
        return {ts:r[0], name:r[1], quiz:'핀테크 도메인 OX 퀴즈', correct:r[32], pct:r[33], grade:r[34]||'', weakTags:'', legacy:true};
      }
      // 신규 포맷: [ts,성명,퀴즈,정답수,점수%,등급,오답태그,상세JSON]
      return {ts:r[0], name:r[1], quiz:r[2], correct:r[3], pct:r[4], grade:r[5], weakTags:r[6], hasDetail: !!(r[7]&&String(r[7]).length>2)};
    });
    return ok({ results: out });
  }

  // 관리자: 단건 응시 상세(문항별) 조회 — get_attempt
  if (action === 'get_attempt'){
    if (!isAdmin(e.parameter)) return err('unauthorized');
    const tgtName=(e.parameter.name||''), tgtTs=(e.parameter.ts||''), tgtQuiz=(e.parameter.quiz||'');
    const qr=getRows(SHEET_QUIZRESULT);
    for (const r of qr.rows){
      if (r.length>=33) continue; // 레거시는 상세 미보관
      const tsMatch = !tgtTs || String(r[0])===tgtTs || String(r[0]).indexOf(tgtTs)===0;
      if (String(r[1])===tgtName && (!tgtQuiz || String(r[2])===tgtQuiz) && tsMatch){
        let detail=[]; try{ detail = r[7]?JSON.parse(r[7]):[]; }catch(e2){ detail=[]; }
        return ok({ ts:r[0], name:r[1], quiz:r[2], correct:r[3], pct:r[4], grade:r[5], weakTags:r[6], detail: detail });
      }
    }
    return ok({ detail: [], notFound:true });
  }

  // 관리자: 통합 데이터(레거시 admin.html)
  if (!isAdmin(e.parameter)) return err('unauthorized');
  const rqr = getRows(SHEET_QUIZRESULT);
  const rpg = getRows(SHEET_PROGRESS);
  const rrq = getRows(SHEET_REQUEST);
  return ok({ headers:rqr.headers, rows:rqr.rows, progress:rpg.rows, requests:rrq.rows });
}


// ════════════════════════════════════════════════════════════════
//  최초 관리자 부트스트랩 — Apps Script 편집기에서 1회 직접 실행
//  (HTTP 미노출: 웹앱으로는 호출 불가, 편집기 실행 전용)
// ════════════════════════════════════════════════════════════════

// employees 시트에 역할·비번변경필요 컬럼(헤더) 보장
function ensureRoleColumn(){
  const s = ss().getSheetByName(SHEET_EMPLOYEES); if(!s) return 'employees 시트 없음 — initAllSheets 먼저';
  if (s.getRange(1, ROLE_COL+1).getValue()   !== '역할')       s.getRange(1, ROLE_COL+1).setValue('역할');
  if (s.getRange(1, PWFLAG_COL+1).getValue() !== '비번변경필요') s.getRange(1, PWFLAG_COL+1).setValue('비번변경필요');
  return 'ok';
}

// 기존 계정을 최고관리자로 승격:  promoteToAdmin('appler')
function promoteToAdmin(loginId){
  ensureRoleColumn();
  const s = ss().getSheetByName(SHEET_EMPLOYEES); if(!s) return 'employees 시트 없음';
  const v = s.getDataRange().getValues();
  for (let i=1;i<v.length;i++){
    if (String(v[i][2]) === String(loginId)){ s.getRange(i+1, ROLE_COL+1).setValue('최고관리자'); return loginId+' → 최고관리자 승격 완료'; }
  }
  return '계정을 찾을 수 없습니다: '+loginId;
}
// 기존 계정을 운영자로 승격:  promoteToOperator('doyeon')
function promoteToOperator(loginId){
  ensureRoleColumn();
  const s = ss().getSheetByName(SHEET_EMPLOYEES); if(!s) return 'employees 시트 없음';
  const v = s.getDataRange().getValues();
  for (let i=1;i<v.length;i++){
    if (String(v[i][2]) === String(loginId)){ s.getRange(i+1, ROLE_COL+1).setValue('운영자'); return loginId+' → 운영자 승격 완료'; }
  }
  return '계정을 찾을 수 없습니다: '+loginId;
}

// 신규 최고관리자 계정 생성:  createAdmin('appler','안애경','원하는비번')
function createAdmin(loginId, name, pw){
  if (!loginId || !pw) return 'loginId·pw 필수';
  ensureRoleColumn();
  const emp = sheetWith(SHEET_EMPLOYEES, ['사원ID','이름','로그인ID','이메일ID','휴대폰','비밀번호해시','salt','입사일','부서','상태','역할','비번변경필요'], '#4527A0');
  const v = emp.getDataRange().getValues();
  for (let i=1;i<v.length;i++) if (String(v[i][2])===String(loginId)) return '이미 존재하는 로그인ID: '+loginId+' (promoteToAdmin 사용)';
  const salt = uid('s'); const sawonId = uid('emp');
  emp.appendRow([ sawonId, name||loginId, loginId, loginId+'@276holdings.com', '', sha256(pw+salt), salt, now(), '', '활성', '최고관리자', 'N' ]);
  return '최고관리자 계정 생성 완료: '+loginId;
}
