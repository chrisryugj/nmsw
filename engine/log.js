'use strict';
/**
 * 기록: <nmsw>/.log/hits.jsonl(게이트에 걸린 것), <nmsw>/.log/errors.jsonl(훅 오류). git 에 안 올라감
 * 쓰기 전 규칙 카드(card.js)가 최근 자주 걸린 표현을, setup.js --check 가 최근 오류 수를 여기서 읽는다
 */
const fs = require('fs');
const path = require('path');

const LOG = process.env.NMSW_LOG || path.join(__dirname, '..', '.log', 'hits.jsonl');
const ERR = process.env.NMSW_ERR_LOG || path.join(__dirname, '..', '.log', 'errors.jsonl');
const MAX_BYTES = 512 * 1024;

function append(file, row) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) {
      const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
      fs.writeFileSync(file, lines.slice(-Math.floor(lines.length / 2)).join('\n') + '\n');
    }
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...row }) + '\n');
  } catch {
    // 기록 실패는 게이트 판정에 영향 없음
  }
}

function logHits(where, hits, label) {
  if (!hits || !hits.length) return;
  append(LOG, { where, label: label || '', names: hits.map((h) => h.name), red: hits.filter((h) => h.tier === 1).length });
}

function logError(hook, error) {
  append(ERR, { hook, error: String((error && error.stack) || error).slice(0, 600) });
}

function readRows(file, days) {
  const since = Date.now() - days * 86400000;
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      const row = JSON.parse(line);
      if (Date.parse(row.ts) >= since) rows.push(row);
    } catch {
      // 깨진 줄 하나는 건너뜀
    }
  }
  return rows;
}

function topRecent(days = 7, limit = 5) {
  const counts = new Map();
  for (const row of readRows(LOG, days)) for (const n of row.names || []) counts.set(n, (counts.get(n) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function recentErrors(days = 7) {
  return readRows(ERR, days);
}

module.exports = { logHits, logError, topRecent, recentErrors, LOG, ERR };
