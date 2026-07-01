# 교과서 일반 템플릿 적용 계획서 (AI 미사용)

> 기준: 첨부 **textbook-flowpay-process.html** 레이아웃
> 적용: **textbook-view.html**(등록·PDF·직접작성 교과서 공통 렌더러)
> 기준일: 2026-05-31

---

## 1. 목표

AI 자동 재구성에 의존하지 않고, **등록된 교과서 데이터(chapters/blocks)를 기준 템플릿 레이아웃에 그대로 얹어** 기존 손제작 교과서와 동일한 품질의 화면을 만든다. (AI는 선택 옵션으로 유지, 기본은 템플릿 렌더)

---

## 2. 기준 템플릿 구조 (flowpay-process)

```
top-header(상단바)  ← 이미 통일된 헤더 사용
└ sidebar(좌측 목차)  ← #ch1..#chN, 스크롤 시 active
└ main
   ├ hero(부제 + 제목 + hero-tag 키워드)
   ├ progress-wrap(진도 바)
   └ section.chapter#chN (장마다)
        ├ chapter-header(번호 칩 + 제목 + 부제)
        ├ chapter-border(그라데이션 라인)
        ├ 본문(.section: 카드/표/스텝/콜아웃/문단)
        └ ch-summary(핵심요약 버튼 → 모달)
   └ done-bar(교육완료)
```
핵심 컴포넌트: `table.tbl`(브랜드 헤더 표), `card`, `steps5`(단계 박스), `grid2/3`, `info/note/warning`(콜아웃).

---

## 3. textbook-view 개편 (핵심 작업)

현재 textbook-view는 단순 카드 나열형. 이를 **기준 템플릿 레이아웃으로 교체**한다.

| 영역 | 적용 |
|---|---|
| 상단바 | 기존 통일 헤더 유지(← 대시보드 · 이름 · 로그아웃) |
| 좌측 목차 | `chapters[]`에서 `.sidebar` 자동 생성 + 스크롤스파이 active |
| 히어로 | 제목 + 부제(부서·주차) + hero-tag(각 장 제목 또는 핵심 키워드) |
| 진도 바 | 기존 진도(점/% ) → progress-wrap 스타일로 표시 |
| 챕터 | `section.chapter#chN` + chapter-header(번호·제목) + chapter-border + 본문 + ch-summary |
| 본문 | `blocks[]` → 컴포넌트 매핑(아래) / blocks 없으면 문단·표·리스트 자동 인식 |
| 핵심요약·완료 | 기존 openTip 모달 + done-bar + completeTraining 유지(진도 POST 동일) |
| 반응형/인쇄 | ≤860px 사이드바 숨김, @media print 동일 |

### 블록 → 컴포넌트 매핑
- `para` → `.section p`
- `list` → 불릿 목록
- `table` → `table.tbl`(브랜드 헤더·줄무늬)
- `callout` → info 박스, `warning` → 경고 박스
- `formula` → 공식 박스, `example` → 예시 박스
- (선택) 단계형 데이터 → `steps5` 박스

### 평문 자동 구조화(블록 없는 경우)
PDF 빠른 분할 본문도 최소한의 구조로:
- 빈 줄 → 문단 분리
- "구분 | A | B"·탭/다중공백 정렬 줄 연속 → **표(table.tbl)** 인식
- "1. / · / -" 시작 줄 연속 → **리스트**
- "= 포함 공식 줄" → 공식 박스

---

## 4. 데이터·호환

- 데이터 모델 동일: `book.chapters=[{t, sum[], blocks[]?, body?}]` (직접작성·PDF·AI 공통)
- 진도 키 `tb_<id>_completed/_finished`, 세션·헤더·대시보드 라우팅 **변경 없음**
- 기존 내장 7종 교과서는 각자 파일 유지(이미 동일 계열 디자인) — 영향 없음

---

## 5. 작업 항목

1. textbook-view.html 레이아웃 교체: sidebar + hero + chapter sections + 컴포넌트 CSS(기준 템플릿 이식)
2. 목차 자동 생성 + 스크롤스파이 active
3. renderBlocks 확장: table.tbl·info·warning·formula·example·steps 매핑
4. 평문 자동 구조화 파서(표/리스트/공식 인식) 보강 → admin PDF 분할과 공유
5. 진도/핵심요약/교육완료/반응형/인쇄 회귀 확인
6. JS 검증 + 276_LMS_Portal 동기화

---

## 6. 히어로 문구 사양 (확정 — 관리자 입력칸 방식)

| 요소 | 출처 | 기본값(미입력 시) |
|---|---|---|
| ① 소제목(hero-sub) | 고정 | `276홀딩스 · 신입사원 온보딩 교육` |
| ② 제목(h1) | book.title 자동 | (교과서명) |
| ③ 설명문(p) | **관리자 입력 "한 줄 소개"** | `총 N개 챕터 · 각 장 핵심요약 확인으로 진도가 기록됩니다.` |
| ④ 키워드 태그 ×3 | **관리자 입력 "키워드"(쉼표 구분)** | `핵심요약 클릭` · `장별 진도 기록` · `완독 후 퀴즈` |

- 등록/편집 화면(직접 작성 · PDF · 편집)에 **"한 줄 소개"·"키워드(쉼표)"** 입력칸 추가 → book.intro, book.tags 저장
- textbook-view 히어로는 book.intro/book.tags 있으면 사용, 없으면 위 기본값
- AI 버튼: 보조로 유지

*276홀딩스 영업지원팀 | 교과서 일반 템플릿 적용 계획서 | 2026-05-31*

*276홀딩스 영업지원팀 | 교과서 일반 템플릿 적용 계획서 | 2026-05-31*
