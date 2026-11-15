#!/usr/bin/env node
'use strict';
/**
 * README 전후 비교 그림 만들기: docs/before-after.json → docs/before-after.png
 * 색칠·건수는 엔진 결과 그대로. 고친 글에 하나라도 걸리면 그림을 만들지 않고 종료 코드 1
 *   node scripts/before-after.js            (Chrome 필요, 다른 경로면 CHROME=...)
 */
// slop-gate: off
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { check, loadLexicon } = require('../engine/engine');
const { RULES, EXTRA_RULES } = require('../engine/rules');
const { PUBLIC_RULES, FORM_RULES } = require('../engine/gongmun');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'before-after.png');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 1280;
const H = 1376;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const RULE_BY_NAME = new Map([...RULES, ...EXTRA_RULES, ...PUBLIC_RULES, ...FORM_RULES].map((r) => [r[1], r]));
const LEX_BY_ID = new Map((loadLexicon() || []).map((e) => [e.id, e]));

// 엔진이 보고한 규칙만, 그 규칙의 정규식이 글에서 맞는 자리를 칠한다
function spans(text, hits) {
  const out = [];
  for (const h of hits) {
    const r = h.lexicon ? LEX_BY_ID.get(h.lexicon) : RULE_BY_NAME.get(h.name);
    if (!r) continue;
    const re = new RegExp(h.lexicon ? r.re.source : r[0].source, h.lexicon ? 'gu' : r[0].flags);
    const ex = h.lexicon ? r.ex : r[6];
    for (const m of text.matchAll(re)) {
      if (!m[0].trim()) continue;
      const win = text.slice(Math.max(0, m.index - 12), m.index + m[0].length + 12);
      if (ex && ex.test(win)) continue;
      const lead = m[0].length - m[0].trimStart().length; // (?:^|\s) 로 시작하는 규칙의 앞 공백은 칠하지 않음
      let e = m.index + m[0].length;
      if (/[가-힣]$/.test(m[0])) while (/[가-힣]/.test(text[e] || '')) e += 1; // 「만전을 기|하겠습니다」처럼 낱말 중간에서 끊기지 않게
      while (e > m.index && /\s/.test(text[e - 1])) e -= 1; // 「상기 」처럼 끝 빈칸은 칠하지 않음
      out.push({ s: m.index + lead, e, tier: h.tier, name: h.name });
    }
  }
  out.sort((a, b) => a.s - b.s || a.tier - b.tier);
  const merged = [];
  for (const x of out) {
    const last = merged[merged.length - 1];
    if (last && x.s < last.e) {
      last.e = Math.max(last.e, x.e);
      last.tier = Math.min(last.tier, x.tier);
    } else merged.push({ ...x });
  }
  return merged;
}

function marked(text, sp) {
  let html = '';
  let i = 0;
  for (const x of sp) {
    const short = x.e - x.s <= 14 ? ' nw' : ''; // 짧은 표시는 줄 끝에서 갈라지지 않게(2026-11-|20)
    html += esc(text.slice(i, x.s)) + `<mark class="t${x.tier}${short}">${esc(text.slice(x.s, x.e))}</mark>`;
    i = x.e;
  }
  return html + esc(text.slice(i));
}

const count = (hits, t) => hits.filter((h) => h.tier === t).length;
const chars = (s) => s.replace(/\s/g, '').length;

const examples = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'before-after.json'), 'utf8'));
let fail = false;
let total = 0;
const rows = examples.map((ex) => {
  const before = check(ex.before, { ext: '.md' });
  const after = check(ex.after, { ext: '.md' });
  total += before.length;
  if (after.length) {
    fail = true;
    console.error(`[${ex.label}] 고친 글에 걸린 것: ${after.map((h) => h.name).join(', ')}`);
  }
  const chips = before.map((h) => `<span class="chip t${h.tier}">${h.tier === 1 ? '🔴' : '🟡'} ${esc(h.name)}</span>`).join('');
  return `
  <section class="row">
    <div class="label">${esc(ex.label)}</div>
    <div class="pair">
      <article class="card before">
        <header><b>AI가 쓴 글</b><span class="n">${chars(ex.before)}자</span><span class="badge bad">🔴 ${count(before, 1)}종 · 🟡 ${count(before, 2)}종</span></header>
        <p>${marked(ex.before, spans(ex.before, before))}</p>
        <footer>${chips}</footer>
      </article>
      <div class="arrow">→</div>
      <article class="card after">
        <header><b>고친 글</b><span class="n">${chars(ex.after)}자</span><span class="badge ok">🔴 0 · 🟡 0</span></header>
        <p>${esc(ex.after)}</p>
        <footer><span class="chip pass">✓ 다시 검사해 0건</span></footer>
      </article>
    </div>
  </section>`;
});
if (fail) process.exit(1);

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
html,body{width:${W}px;height:${H}px;background:#f3f1ec;font-family:Pretendard,'Apple SD Gothic Neo',sans-serif;color:#1c1c1e;-webkit-font-smoothing:antialiased}
body{padding:48px 56px}
.top{display:flex;align-items:baseline;gap:16px;margin-bottom:6px}
.top .mark{font-weight:800;font-size:20px;letter-spacing:.02em;background:#1c1c1e;color:#f3f1ec;padding:4px 10px;border-radius:6px}
.top h1{font-size:38px;font-weight:800;letter-spacing:-.02em}
.total{margin-left:auto;font-size:18px;font-weight:700;color:#5b5b60}
.total b{font-size:40px;font-weight:900;color:#b42318;margin:0 4px}
.total b.g{color:#157f3b}
.sub{font-size:17px;color:#5b5b60;margin-bottom:30px}
.row{margin-bottom:30px}
.label{font-size:15px;font-weight:700;color:#5b5b60;margin:0 0 10px 4px;letter-spacing:.04em}
.pair{display:grid;grid-template-columns:1fr 44px 1fr;align-items:stretch}
.arrow{display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;color:#8a8a8f}
.card{background:#fff;border-radius:16px;padding:22px 24px 18px;display:flex;flex-direction:column;box-shadow:0 1px 0 rgba(0,0,0,.04),0 6px 20px rgba(0,0,0,.05)}
.card.before{border:1.5px solid #f0c9c9}
.card.after{border:1.5px solid #bfe3c9;align-self:start}
.card header{display:flex;align-items:center;gap:10px;margin-bottom:14px}
.card header b{font-size:18px;font-weight:800}
.card header .n{font-size:14px;color:#8a8a8f}
.badge{margin-left:auto;font-size:14px;font-weight:700;padding:4px 10px;border-radius:999px}
.badge.bad{background:#fde8e8;color:#b42318}
.badge.ok{background:#e3f6e8;color:#157f3b}
.card p{font-size:19px;line-height:1.72;white-space:pre-wrap;word-break:keep-all;flex:1}
.after p{color:#1c1c1e}
.before p{color:#3a3a3c}
mark{border-radius:3px;padding:1px 1px;color:inherit}
mark.nw{white-space:nowrap}
mark.t1{background:rgba(229,72,77,.18);box-shadow:inset 0 -2px 0 #e5484d}
mark.t2{background:rgba(245,176,0,.22);box-shadow:inset 0 -2px 0 #d49b00}
.card footer{display:flex;flex-wrap:wrap;gap:6px;margin-top:16px;padding-top:14px;border-top:1px dashed #e6e3dc}
.chip{font-size:13px;padding:3px 9px;border-radius:999px;background:#f5f4f0;color:#3a3a3c}
.chip.t1{background:#fdecec;color:#9f1d1d}
.chip.t2{background:#fdf3d8;color:#7a5600}
.chip.pass{background:#e3f6e8;color:#157f3b;font-weight:700}
.foot{font-size:13px;color:#8a8a8f;margin-top:4px}
</style></head><body>
<div class="top"><span class="mark">nmsw</span><h1>AI가 쓴 글 → 고친 글</h1><div class="total">걸린 표현<b>${total}종</b>→<b class="g">0</b></div></div>
<div class="sub">왼쪽 색칠은 nmsw 엔진이 실제로 찾은 곳(🔴 고칠 때까지 막음 · 🟡 알림). 오른쪽은 같은 내용을 고친 글이고, 다시 검사하면 0건.</div>
${rows.join('')}
<div class="foot">예문 docs/before-after.json · 그림 scripts/before-after.js · 날짜·시각 규칙은 「행정업무의 운영 및 혁신에 관한 규정」 제7조 ⑤</div>
</body></html>`;

const tmp = path.join(os.tmpdir(), 'nmsw-before-after.html');
fs.writeFileSync(tmp, html);
execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2', `--window-size=${W},${H}`, `--screenshot=${OUT}`, `file://${tmp}`], { stdio: 'ignore' });
console.log(`그림: ${OUT}`);
