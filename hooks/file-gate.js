#!/usr/bin/env node
/**
 * Korean Slop Gate (PostToolUse:Write|Edit)
 * 새로 쓴 한국어 글에서 사람이 매번 고치던 AI 슬롭 말투를 잡아 되돌려 보낸다
 *
 * - 🔴 S1: 확실한 슬롭 → decision:block (Claude가 고쳐서 다시 저장)
 * - 🟡 S2: 문맥 봐야 하는 것 → additionalContext 알림만
 * - 판정 정본은 nmsw engine/engine.js · engine/rules.js (답변 게이트·커밋 게이트와 같은 엔진)
 * - 제외: .claude/·.codex/ 하위, 테스트 파일, 'slop-gate: off' 표시가 있는 파일
 */

const fs = require('fs');
const path = require('path');
const { readInput, safeRun, hookOut } = require('../engine/hook-io');
const { check, formatHits, shouldCheckPath, isOff } = require('../engine/engine');
const { logHits, logError } = require('../engine/log');

function newText(ti) {
  if (typeof ti.content === 'string') return ti.content;
  if (typeof ti.new_string === 'string') return ti.new_string;
  return (ti.edits || []).map((e) => e.new_string || '').join('\n');
}

function fileIsOff(filePath) {
  try {
    return isOff(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return false;
  }
}

safeRun(() => {
  const input = readInput();
  const ti = input.tool_input || {};
  const filePath = ti.file_path || '';
  if (!shouldCheckPath(filePath)) return;

  const text = newText(ti);
  if (isOff(text) || fileIsOff(filePath)) return;

  const hits = check(text, { ext: path.extname(filePath).toLowerCase() });
  if (hits.length === 0) return;
  logHits('file', hits, path.basename(filePath));

  const head = `[윤문게이트] ${path.basename(filePath)}: AI 슬롭 말투 ${hits.length}종. 사용자 문장 인용·고유명사·법령 원문·글자 그대로 쓰는 뜻이면 두고, 아니면 고쳐서 다시 저장`;
  const msg = [head, ...formatHits(hits)].join('\n');

  if (hits.some((h) => h.tier === 1)) {
    console.log(JSON.stringify({ decision: 'block', reason: msg }));
  } else {
    hookOut('PostToolUse', { additionalContext: msg });
  }
}, (e) => logError('file-gate', e));
