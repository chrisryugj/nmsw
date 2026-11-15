#!/usr/bin/env node
/**
 * nmsw reply gate (Stop)
 * 이번 턴 마지막 답변(last_assistant_message)에 🔴 가 있으면 멈추지 못하게 막고 고친 판을 다시 보내게 한다.
 * 한 턴에 한 번만 막는다(stop_hook_active).
 *
 * - 도구 사이 중간 글은 막지 않고 기록만 남긴다(쓰기 전 규칙 카드가 다음 요청에 반영)
 * - 사람이 보지 않는 실행(claude -p 같은 자동화, CLAUDE_CODE_SESSION_ATTENDED=0)에서는 꺼진다
 * - 끄기: 환경 변수 NMSW_REPLY=off
 */

const fs = require('fs');
const { readInput, safeRun, block } = require('../engine/hook-io');
const { check, formatHits } = require('../engine/engine');
const { logHits, logError } = require('../engine/log');

const TAIL_BYTES = 4 * 1024 * 1024;

function readTail(file) {
  const size = fs.statSync(file).size;
  const start = Math.max(0, size - TAIL_BYTES);
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString('utf8');
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
  } finally {
    fs.closeSync(fd);
  }
}

// 턴 경계 = 사람이 보낸 요청. 스킬 본문·메타 줄·작업 알림·도구 결과는 경계가 아니다
function isUserPrompt(d) {
  if (d.type !== 'user' || d.isSidechain || d.isMeta) return false;
  const c = d.message && d.message.content;
  const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x && x.type === 'text').map((x) => x.text).join('') : '';
  if (!text) return false;
  return !/^\s*<task-notification>/.test(text);
}

// 이번 턴의 답변 글 조각(순서대로)
function turnTexts(file) {
  const lines = readTail(file).split('\n');
  const parts = [];
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i]) continue;
    let d;
    try {
      d = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (isUserPrompt(d)) break;
    if (d.type !== 'assistant' || d.isSidechain) continue;
    const c = (d.message && d.message.content) || [];
    for (const x of Array.isArray(c) ? c : []) if (x && x.type === 'text' && x.text) parts.unshift(x.text);
  }
  return parts;
}

function run() {
  if (process.env.NMSW_REPLY === 'off' || process.env.CLAUDE_CODE_SESSION_ATTENDED === '0') return;
  const input = readInput();
  if (input.stop_hook_active) return;

  let parts = [];
  if (input.transcript_path && fs.existsSync(input.transcript_path)) parts = turnTexts(input.transcript_path);
  const final = typeof input.last_assistant_message === 'string' ? input.last_assistant_message : parts[parts.length - 1] || '';
  if (!final && !parts.length) return;

  const interim = parts.filter((p) => p.trim() !== final.trim()).join('\n\n');
  const interimHits = interim ? check(interim, { ext: '.md', genre: '일반' }) : [];
  if (interimHits.length) logHits('reply-interim', interimHits);

  const hits = check(final, { ext: '.md', genre: '일반' });
  if (hits.length) logHits('reply', hits);
  const red = hits.filter((h) => h.tier === 1);
  if (red.length === 0) return;

  block(
    [
      `[윤문게이트·답변] 방금 보낸 마지막 답변에 🔴 AI 슬롭 말투 ${red.length}종`,
      ...formatHits(red),
      '같은 답변을 고쳐서 다시 보내라. 첫 줄은 「(말투 고친 판)」. 내용·숫자·경로·링크는 그대로 두고 표시된 말투만 고친다.',
      '사용자 말·원문을 글자 그대로 인용한 것이면 「」로 감싸면 된다. 도구는 다시 부르지 않는다.',
    ].join('\n'),
  );
}

if (require.main === module) safeRun(run, (e) => logError('reply-gate', e));
module.exports = { isUserPrompt, turnTexts };
