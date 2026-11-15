'use strict';
/**
 * 훅 입출력 최소 도구. nmsw 가 다른 설정 레포 없이 혼자 돌게 둔다
 */
const fs = require('fs');

function readInput() {
  return JSON.parse(fs.readFileSync(0, 'utf8'));
}

// 훅이 죽어도 작업은 막지 않는다(fail-open). 원인은 기록 파일에 남긴다
function safeRun(fn, logFail) {
  try {
    fn();
  } catch (error) {
    if (logFail) logFail(error);
  }
}

function hookOut(event, fields, top) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: event, ...fields }, ...(top || {}) }));
}

function deny(reason) {
  hookOut('PreToolUse', { permissionDecision: 'deny', permissionDecisionReason: reason });
}

function block(reason) {
  console.log(JSON.stringify({ decision: 'block', reason }));
}

module.exports = { readInput, safeRun, hookOut, deny, block };
