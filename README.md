# 276홀딩스 사내 교육 포털 — 산출물 모음

> 갱신: 2026-05-30 · 폰트: 맑은 고딕 · 아이콘: SVG · 백엔드: Google Apps Script + Sheets

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
- [ ] A6 관리자 계정 로그인 격상(ADMIN_KEY 대체)

## 배포 절차
1. Google Sheets Apps Script에 Code.gs 반영 → `initAllSheets()` 실행
2. 배포(웹앱, 모든 사용자) → URL을 각 HTML의 APPS_SCRIPT_URL에 반영
3. 관리자 콘솔 접속 키: flowpay2026 (추후 계정 로그인으로 격상 권장)
