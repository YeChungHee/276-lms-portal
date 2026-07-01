# 276홀딩스 사내 교육 포털 — 산출물 모음

> 갱신: 2026-07-01 · 폰트: 맑은 고딕 · 아이콘: SVG · 백엔드: Google Apps Script(v3.1) + Sheets

## 🌐 배포 (GitHub Pages 자동)
- **라이브 URL:** https://yechunghee.github.io/276-lms-portal/
- **저장소:** https://github.com/YeChungHee/276-lms-portal
- **자동 배포:** `main` 브랜치에 push하면 GitHub Actions(`.github/workflows/deploy.yml`)가 자동으로 Pages에 배포합니다.
- **업데이트 방법:** 파일 수정 후 아래 한 줄만 실행하면 커밋·푸시·배포가 이어집니다.
  ```bash
  ./deploy.sh "변경 내용 메모"    # 메시지 생략 시 날짜로 자동 생성
  ```
  진행 상황: `gh run watch` 또는 저장소 Actions 탭

## 사원용 (네이비 테마)
- `index.html` 로그인 / 계정 요청 (세션 lms_session)
- `dashboard.html` 학습 허브(교과서·퀴즈·진도/교육완료)
- 교과서 7: company-intro(8) · textbook-economy(7) · textbook-fintech(5) · textbook-enote-discount 매출채권(7) · textbook-flowpay-platform(5) · textbook-flowpay-process(8) · textbook-review-collection 심사·채권추심(8)
- 퀴즈 6(계정 귀속·자가채점): quiz-fintech-ox(30) · quiz-economy(10) · quiz-enote-discount(10) · quiz-flowpay-platform(15) · quiz-flowpay-process(15) · quiz-review-collection(20)

## 어드민 (보라 테마)
- `admin.html` **관리자 콘솔**(7메뉴 네비 + 운영 KPI, ADMIN_KEY 게이트)
- `admin-accounts.html` 계정 관리(요청 승인·계정 생성·임시PW·Slack 전달)
- `admin-content.html` 교과서·질문지 생성/관리
- `admin-progress.html` 교과서별 교육완료 현황표
- `admin-scores.html` 퀴즈 점수 집계·취약 태그 분석·보강 과제 생성

## 백엔드·계획서
- `Code.gs` Apps Script v3.0 — 21개 엔드포인트, 9개 시트
  (계정·콘텐츠·진도/완료·퀴즈점수·보강 / initAllSheets() 1회 실행 후 웹앱 배포)
- `00_LMS_Portal_Master_Plan.md` 포털 마스터 계획서
- `01_Admin_Portal_Plan.md` 어드민 구성 계획서(로드맵 A1~A6)

## 어드민 로드맵 진행
- [x] A1 통합 어드민 셸(admin.html)
- [x] A2 계정 관리(admin-accounts.html)
- [x] A3 퀴즈 점수 서버저장(quiz_submit) + 점수 대시보드(admin-scores.html)
- [x] A4 취약점 분석·보강 과제 생성(add_remediation)
- [ ] A5 Apps Script 실배포·실데이터 연결·회귀 테스트
- [x] A6 관리자 계정 로그인 격상 — **공유키(ADMIN_KEY) 폐기 → 계정 역할(role) + 토큰 인증** (v3.1)

## 관리자 로그인 (v3.1 — 계정 기반)
- 관리자도 **`index.html` 통합 로그인**을 사용: 로그인ID + 이름 + **비밀번호**
- 백엔드가 `employees.역할`이 `관리자`인 계정에만 **adminToken** 발급 → 세션(`lms_session.role='admin'`, `adminToken`)에 저장
- 어드민 페이지는 세션 role로 접근 판정, 관리자 API는 `token`으로 인증 (하드코딩 공유키 제거)
- 대시보드 상단에 관리자에게만 **🛠 관리자 콘솔** 진입 노출

## 배포 절차
1. Google Sheets Apps Script에 **최신 `Code.gs`(v3.1)** 반영 → `initAllSheets()` 실행(역할 컬럼 포함)
2. (권장) Apps Script → 프로젝트 설정 → **스크립트 속성**에 `ADMIN_SECRET`(임의 난수 문자열) 등록 — 토큰 서명용
3. **최초 관리자 만들기** — Apps Script 편집기에서 1회 실행:
   - 기존 계정 승격: `promoteToAdmin('로그인ID')`
   - 신규 관리자 생성: `createAdmin('로그인ID','이름','비밀번호')`
4. 배포(웹앱, 모든 사용자) → `/exec` URL을 각 HTML의 `APPS_SCRIPT_URL`에 반영(변경 없으면 유지)
5. `index.html`에서 관리자 계정(ID+이름+비밀번호)으로 로그인 → 대시보드 → 관리자 콘솔 진입 확인

> 과도기 호환이 필요하면 스크립트 속성 `ADMIN_KEY`를 설정할 때에만 레거시 키 인증이 동작합니다(기본은 비활성, 소스에는 저장하지 않음).
