#!/usr/bin/env node
/* 배포 시 자동 버전업 — deploy.sh가 호출.
   releases.js의 APP_VERSION을 올리고 RELEASES 맨 앞에 항목을 추가한다.
   규칙: 커밋 메시지가 feat*  → MINOR+1 / 그 외(fix·chore·update…) → PATCH+1
   제목·상세는 커밋 메시지에서 추출(‘—’, ‘·’, ‘,’ 구분). */
const fs = require('fs');

const msg = (process.argv[2] || 'update').trim();
const FILE = __dirname + '/releases.js';
let src = fs.readFileSync(FILE, 'utf8');

const m = src.match(/APP_VERSION\s*=\s*'v(\d+)\.(\d+)\.(\d+)'/);
if (!m) { console.error('APP_VERSION 파싱 실패'); process.exit(1); }
let [maj, min, pat] = [ +m[1], +m[2], +m[3] ];

const type = /^feat/i.test(msg) ? 'feat' : (/^fix/i.test(msg) ? 'fix' : 'chore');
if (type === 'feat') { min++; pat = 0; } else { pat++; }
const v = `v${maj}.${min}.${pat}`;

// 'feat:' / 'fix(scope):' 프리픽스 제거
const body = msg.replace(/^\w+(\([^)]*\))?:\s*/, '');
const esc = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const parts = body.split(/—|·|,|\n/).map(s => s.trim()).filter(Boolean);
const title = esc((parts[0] || '업데이트').slice(0, 70));
// 상세는 제목 이후 조각만(없으면 제목 1건)
const items = (parts.length > 1 ? parts.slice(1) : [parts[0] || '업데이트']).slice(0, 6).map(esc);

// KST 날짜
const date = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

const entry = `  { v:'${v}', date:'${date}', type:'${type}', title:'${title}',\n    items:[${items.map(i => `'${i}'`).join(',') || `'${title}'`}] },\n`;

src = src.replace(/APP_VERSION\s*=\s*'v[\d.]+'/, `APP_VERSION = '${v}'`);
src = src.replace(/const RELEASES = \[\n/, `const RELEASES = [\n${entry}`);
fs.writeFileSync(FILE, src);
console.log(v);
