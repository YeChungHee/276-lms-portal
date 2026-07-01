// ================================================================
//  276홀딩스 사내 교육 포털 — Google Apps Script 백엔드 v3.0
//  Google Sheets ID 아래 SHEET_ID 에 지정
//  배포: 확장 → Apps Script → 배포 → 새 배포 → 웹 앱
//        실행: 나 / 액세스: "모든 사용자(익명 포함)"
//  ----------------------------------------------------------------
//  v3.0 추가: 계정(login/signup/create_account), 교과서(save/get_textbook),
//            퀴즈(save_quiz/add_questions/deploy_quiz/get_questions),
//            진도/완료 조회(get_progress), 교육완료 집계(get_completions)
// ================================================================

const SHEET_ID        = '1D_Iml7YM2rTDNQprumUCiUtI09aTFEhGARLxWWIk5WI';
const ADMIN_KEY       = 'flowpay2026';

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

// 시트 초기화(최초 1회 수동 실행 권장)
function initAllSheets(){
  sheetWith(SHEET_QUIZRESULT, ['타임스탬프','성명','퀴즈','정답수','점수%','등급','오답태그','상세JSON'], '#4A148C');
  sheetWith(SHEET_PROGRESS,   ['타임스탬프','성명','챕터번호','챕터명'], '#1565C0');
  sheetWith(SHEET_REQUEST,    ['타임스탬프','성명','상태','SlackID'], '#2E7D32');
  sheetWith(SHEET_EMPLOYEES,  ['사원ID','이름','로그인ID','이메일ID','휴대폰','비밀번호해시','salt','입사일','부서','상태'], '#4527A0');
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
      if (data.key !== ADMIN_KEY) return err('unauthorized');
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

    // ── 로그인 ──
    if (action === 'login'){
      const {rows} = getRows(SHEET_EMPLOYEES);
      // employees: [사원ID,이름,로그인ID,이메일ID,휴대폰,비번해시,salt,입사일,부서,상태]
      for (let i=0;i<rows.length;i++){
        if (String(rows[i][2]) === String(data.loginId)){
          // 비밀번호 검증(있을 때만)
          if (data.pw){
            const calc = sha256(data.pw + rows[i][6]);
            if (calc !== rows[i][5]) return err('비밀번호가 일치하지 않습니다');
          }
          return ok({ login:true, sawonId:rows[i][0], name:rows[i][1], dept:rows[i][8], status:rows[i][9] });
        }
      }
      // 미등록 — 인터림: 이름이 있으면 임시 세션 허용
      if (data.name) return ok({ login:true, sawonId:'', name:data.name, dept:'', status:'미등록', interim:true });
      return err('등록되지 않은 로그인 아이디입니다');
    }

    // ── 비밀번호 변경 ──
    if (action === 'change_password'){
      const s = ss().getSheetByName(SHEET_EMPLOYEES); if(!s) return err('no employees');
      const v = s.getDataRange().getValues();
      for (let i=1;i<v.length;i++){
        if (String(v[i][2]) === String(data.loginId)){
          const salt = uid('s');
          s.getRange(i+1,6).setValue(sha256(data.newPw+salt));
          s.getRange(i+1,7).setValue(salt);
          return ok({ changed:true });
        }
      }
      return err('계정 없음');
    }

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
      if (data.key !== ADMIN_KEY) return err('unauthorized');
      const s = ss().getSheetByName(SHEET_REQUEST); if(!s) return err('no sheet');
      const v = s.getDataRange().getValues();
      for (let i=1;i<v.length;i++) if (v[i][1]===data.name){ s.getRange(i+1,3).setValue('승인'); return ok({approved:true}); }
      return err('name not found');
    }

    // ── 계정 생성(관리자) ──
    if (action === 'create_account'){
      if (data.key !== ADMIN_KEY) return err('unauthorized');
      const emp = sheetWith(SHEET_EMPLOYEES, ['사원ID','이름','로그인ID','이메일ID','휴대폰','비밀번호해시','salt','입사일','부서','상태'], '#4527A0');
      const salt = uid('s'); const pw = data.tempPw || tempPw();
      const sawonId = uid('emp');
      emp.appendRow([ sawonId, data.name, data.loginId, data.emailId||(data.loginId+'@276holdings.com'), data.phone||'',
                      sha256(pw+salt), salt, now(), data.dept||'', '활성' ]);
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
      if (data.key !== ADMIN_KEY) return err('unauthorized');
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
    if ((e.parameter.key||'')!==ADMIN_KEY) return err('unauthorized');
    const s=ss().getSheetByName(SHEET_REQUEST); if(!s) return err('no sheet');
    const v=s.getDataRange().getValues();
    for(let i=1;i<v.length;i++) if(v[i][1]===(e.parameter.name||'').trim()){ s.getRange(i+1,3).setValue('승인'); return ok({approved:true}); }
    return err('not found');
  }

  // 관리자: 삭제
  if (action === 'delete_request'){
    if ((e.parameter.key||'')!==ADMIN_KEY) return err('unauthorized');
    const s=ss().getSheetByName(SHEET_REQUEST); if(!s) return err('no sheet');
    const v=s.getDataRange().getValues();
    for(let i=1;i<v.length;i++) if(v[i][1]===(e.parameter.name||'').trim() && String(v[i][0])===(e.parameter.ts||'').trim()){ s.deleteRow(i+1); return ok({deleted:true}); }
    return err('not found');
  }

  // 관리자: 진도 조회
  if (action === 'get_progress'){
    if ((e.parameter.key||'')!==ADMIN_KEY) return err('unauthorized');
    const {rows} = getRows(SHEET_PROGRESS);
    return ok({ progress: rows.map(r=>({ ts:r[0], name:r[1], chapter:r[2], chapterName:r[3] })) });
  }

  // 관리자: 교과서별 교육완료 집계
  if (action === 'get_completions'){
    if ((e.parameter.key||'')!==ADMIN_KEY) return err('unauthorized');
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
    if ((e.parameter.key||'')!==ADMIN_KEY) return err('unauthorized');
    const req=getRows(SHEET_ACCOUNTREQ), emp=getRows(SHEET_EMPLOYEES);
    return ok({
      requests: req.rows.map(r=>({ts:r[0],name:r[1],phone:r[2],emailId:r[3],status:r[4],memo:r[5]})),
      employees: emp.rows.map(r=>({sawonId:r[0],name:r[1],loginId:r[2],emailId:r[3],phone:r[4],joinedAt:r[7],dept:r[8],status:r[9]}))
    });
  }

  // 관리자: 퀴즈 점수(quiz_results) 조회 — 레거시(30문항 OX) + 신규(7컬럼) 호환
  if (action === 'get_scores'){
    if ((e.parameter.key||'')!==ADMIN_KEY) return err('unauthorized');
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
    if ((e.parameter.key||'')!==ADMIN_KEY) return err('unauthorized');
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
  if ((e.parameter.key||'')!==ADMIN_KEY) return err('unauthorized');
  const rqr = getRows(SHEET_QUIZRESULT);
  const rpg = getRows(SHEET_PROGRESS);
  const rrq = getRows(SHEET_REQUEST);
  return ok({ headers:rqr.headers, rows:rqr.rows, progress:rpg.rows, requests:rrq.rows });
}
