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

# 자동 버전업 — releases.js를 직접 갱신하지 않았다면 커밋 메시지로 버전 항목 자동 생성
# (feat* → MINOR+1, 그 외 → PATCH+1. 직접 갱신했다면 그대로 존중)
if ! git diff --cached --name-only | grep -q "releases.js"; then
  newver=$(node bump-version.js "$msg" 2>/dev/null || true)
  if [ -n "${newver:-}" ]; then
    git add releases.js
    echo "🔖 자동 버전업: ${newver} (releases.js에 업데이트 내역 추가됨)"
  else
    echo "⚠️  자동 버전업 실패 — releases.js를 수동으로 갱신하세요."
  fi
fi

git commit -m "$msg"
git push origin main

echo ""
echo "✅ 푸시 완료 → GitHub Actions가 자동으로 GitHub Pages에 배포합니다."
echo "   진행 상황:  gh run watch   또는  https://github.com/YeChungHee/276-lms-portal/actions"
