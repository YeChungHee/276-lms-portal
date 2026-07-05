#!/usr/bin/env bash
# 276홀딩스 LMS 포털 — GitHub 자동 배포 스크립트
# 사용법:  ./deploy.sh "커밋 메시지"   (메시지 생략 시 자동 생성)
set -euo pipefail

cd "$(dirname "$0")"

msg="${1:-update: $(date '+%Y-%m-%d %H:%M')}"

# 변경사항 스테이징
git add -A

# 변경 없으면 종료
if git diff --cached --quiet; then
  echo "ℹ️  변경사항이 없습니다. 배포를 건너뜁니다."
  exit 0
fi

# 버전 관리 리마인더 — 코드가 바뀌었는데 releases.js가 그대로면 경고(차단하지 않음)
if ! git diff --cached --name-only | grep -q "releases.js"; then
  ver=$(grep -oE "v[0-9]+\.[0-9]+\.[0-9]+" releases.js | head -1)
  echo "⚠️  releases.js 미갱신 (현재 ${ver:-?}) — 기능/수정 배포라면 버전 항목을 추가하세요."
fi

git commit -m "$msg"
git push origin main

echo ""
echo "✅ 푸시 완료 → GitHub Actions가 자동으로 GitHub Pages에 배포합니다."
echo "   진행 상황:  gh run watch   또는  https://github.com/YeChungHee/276-lms-portal/actions"
