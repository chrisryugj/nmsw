#!/usr/bin/env node
'use strict';
/**
 * nmsw 명령줄. Claude 밖(코덱스·제미나이·git 훅·사람)에서도 같은 엔진으로 검사한다
 *
 *   node cli.js <파일...>                 파일 검사. 🔴 가 있으면 종료 코드 1
 *   node cli.js --stdin [--ext .md]       표준 입력 검사
 *   node cli.js staged [--repo 경로]      스테이징된 새 줄 검사(git pre-commit 훅용)
 *   node cli.js install-hook [레포 경로]   그 레포에 pre-commit 훅 설치(이미 있으면 그대로 둠)
 *   node cli.js mine --human <파일> --ai <파일...>   사람 글보다 AI 글에 훨씬 자주 나오는 표현 후보 찾기
 *   공통 옵션: --red(🔴 만), --json
 */
const fs = require('fs');
const path = require('path');
const { check, formatHits, shouldCheckPath, isOff } = require('./engine');
const { additions } = require('./git');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const tiers = flag('--red') ? [1] : [1, 2];
const asJson = flag('--json');

function report(label, hits) {
  if (!hits.length) return 0;
  if (!asJson) console.log([`[nmsw] ${label}`, ...formatHits(hits)].join('\n'));
  return hits.filter((h) => h.tier === 1).length;
}

function checkFiles(files) {
  let red = 0;
  const out = {};
  for (const f of files) {
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) continue;
    const ext = path.extname(f).toLowerCase();
    const text = fs.readFileSync(f, 'utf8');
    if (isOff(text)) continue;
    const hits = check(text, { ext: ext || '.md', tiers });
    out[f] = hits;
    red += report(f, hits);
  }
  if (asJson) console.log(JSON.stringify(out, null, 1));
  return red;
}

function cmdStaged() {
  const repo = path.resolve(opt('--repo', process.cwd()));
  const files = additions(repo, { filter: shouldCheckPath });
  let red = 0;
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(repo, rel);
    if (!shouldCheckPath(abs) || isOff(text)) continue;
    try {
      if (isOff(fs.readFileSync(abs, 'utf8'))) continue;
    } catch {
      // 지워진 파일
    }
    red += report(rel, check(text, { ext: path.extname(rel).toLowerCase(), tiers }));
  }
  if (red) console.log('[nmsw] 🔴 를 고친 뒤 다시 커밋. 원문을 그대로 옮긴 파일이면 slop-gate: off 한 줄');
  return red;
}

function cmdInstallHook() {
  const repo = path.resolve(args[1] || process.cwd());
  const hooksDir = path.join(repo, '.git', 'hooks');
  if (!fs.existsSync(hooksDir)) {
    console.error(`git 레포가 아님: ${repo}`);
    return 1;
  }
  const target = path.join(hooksDir, 'pre-commit');
  const line = `node "${path.join(__dirname, 'cli.js')}" staged --red --repo "$(git rev-parse --show-toplevel)" || exit 1`;
  if (fs.existsSync(target)) {
    const cur = fs.readFileSync(target, 'utf8');
    if (cur.includes('nmsw')) {
      console.log('이미 설치됨');
      return 0;
    }
    console.log(`pre-commit 훅이 이미 있어 건드리지 않음. 그 파일 끝에 다음 한 줄을 넣으면 됨:\n# nmsw\n${line}`);
    return 0;
  }
  fs.writeFileSync(target, `#!/bin/sh\n# nmsw: 한국어 AI 슬롭 말투 🔴 가 있으면 커밋을 막는다\n${line}\n`, { mode: 0o755 });
  console.log(`설치함: ${target}`);
  return 0;
}

// slop-forensics(Antislop, ICLR 2026) 방식을 단순화: 어절 1~3그램 빈도를 사람 글과 비교
function cmdMine() {
  const humanFile = opt('--human');
  const i = args.indexOf('--ai');
  const aiFiles = i >= 0 ? args.slice(i + 1).filter((a) => !a.startsWith('--')) : [];
  if (!humanFile || !aiFiles.length) {
    console.error('사용: mine --human <사람 글 파일> --ai <AI 글 파일...>');
    return 1;
  }
  const grams = (text) => {
    const counts = new Map();
    const words = text.replace(/[^가-힣\s]/g, ' ').split(/\s+/).filter((w) => w.length > 0);
    for (let n = 1; n <= 3; n += 1) {
      for (let k = 0; k + n <= words.length; k += 1) {
        const g = words.slice(k, k + n).join(' ');
        if (g.replace(/\s/g, '').length < 3) continue;
        counts.set(g, (counts.get(g) || 0) + 1);
      }
    }
    return { counts, total: words.length };
  };
  const H = grams(fs.readFileSync(humanFile, 'utf8'));
  const A = grams(aiFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n'));
  const rows = [];
  for (const [g, a] of A.counts) {
    if (a < 4) continue;
    const h = H.counts.get(g) || 0;
    const ratio = (a / A.total + 1e-7) / (h / H.total + 1e-7);
    if (ratio > 20) rows.push([g, a, h, ratio]);
  }
  rows.sort((x, y) => y[3] * Math.log(y[1]) - x[3] * Math.log(x[1]));
  console.log(`AI 글 ${A.total}어절 · 사람 글 ${H.total}어절. 사람 글보다 훨씬 자주 나온 표현(AI 건수 / 사람 건수):`);
  for (const [g, a, h] of rows.slice(0, Number(opt('--top', 40)))) console.log(`  ${g}  ${a} / ${h}`);
  return 0;
}

function main() {
  if (args[0] === 'staged') return cmdStaged();
  if (args[0] === 'install-hook') return cmdInstallHook();
  if (args[0] === 'mine') return cmdMine();
  if (flag('--stdin')) {
    const text = fs.readFileSync(0, 'utf8');
    const hits = check(text, { ext: opt('--ext', '.md'), tiers });
    if (asJson) console.log(JSON.stringify(hits, null, 1));
    return report('표준 입력', hits);
  }
  const files = args.filter((a) => !a.startsWith('--'));
  if (!files.length) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(3, 12).join('\n'));
    return 0;
  }
  return checkFiles(files);
}

process.exitCode = main() ? 1 : 0;
