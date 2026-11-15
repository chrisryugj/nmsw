#!/usr/bin/env node
'use strict';
/**
 * 오탐 실측: 사람 글 묶음과 AI 글 묶음(jsonl, 줄마다 {id, text})에 엔진을 돌려 규칙·어휘 항목별 걸린 문서 수를 센다
 *   node bench.js <사람.jsonl> <AI.jsonl> [--promote]
 * --promote: 사람 글 0건 · AI 글 1건 이상인 im-not-ai restore 항목을 lexicon-s1.json 후보로 출력
 */
const fs = require('fs');
const path = require('path');
const { check, loadLexicon } = require('../engine/engine');

const [humanFile, aiFile] = process.argv.slice(2);
const read = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const H = read(humanFile);
const A = read(aiFile);

function tally(docs) {
  const by = new Map();
  let redDocs = 0;
  for (const d of docs) {
    const hits = check(d.text, { ext: '.md' });
    if (hits.some((h) => h.tier === 1)) redDocs += 1;
    for (const h of hits) {
      const k = h.lexicon ? `lex:${h.lexicon}` : `rule:${h.name}`;
      const row = by.get(k) || { name: h.name, tier: h.tier, docs: 0 };
      row.docs += 1;
      by.set(k, row);
    }
  }
  return { by, redDocs };
}

const th = tally(H);
const ta = tally(A);
console.log(`사람 글 ${H.length}편: 🔴 걸린 글 ${th.redDocs}편 (${((th.redDocs / H.length) * 100).toFixed(1)}%)`);
console.log(`AI 글 ${A.length}편: 🔴 걸린 글 ${ta.redDocs}편 (${((ta.redDocs / A.length) * 100).toFixed(1)}%)`);
const keys = new Set([...th.by.keys(), ...ta.by.keys()]);
const rows = [...keys].map((k) => ({ k, ...(th.by.get(k) || ta.by.get(k)), h: (th.by.get(k) || {}).docs || 0, a: (ta.by.get(k) || {}).docs || 0 }));
rows.sort((x, y) => y.h - x.h || y.a - x.a);
console.log('\n항목별 걸린 문서 수 (사람 / AI) · 🔴 인데 사람 글에서 걸리면 오탐 후보');
for (const r of rows) console.log(`${r.tier === 1 ? '🔴' : '🟡'} ${r.name}  ${r.h} / ${r.a}`);

if (process.argv.includes('--promote')) {
  const lex = loadLexicon() || [];
  const restore = new Set(lex.filter((e) => e.restore).map((e) => e.id));
  const cand = rows.filter((r) => r.k.startsWith('lex:') && restore.has(r.k.slice(4)) && r.h === 0 && r.a > 0).map((r) => r.k.slice(4));
  console.log('\n🔴 승격 후보(restore · 사람 0 · AI 1+):', JSON.stringify(cand));
}
