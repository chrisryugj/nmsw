#!/usr/bin/env node
'use strict';
/**
 * nmsw 엔진 시험. 규칙이나 사전을 바꾼 뒤 반드시 돌린다: node ~/.claude/nmsw/test/run.js
 * 1) im-not-ai 어휘 사전 111개: 사전에 딸린 맞는 예는 걸리고 틀린 예는 안 걸려야 함
 * 2) 규칙 사례: 걸려야 할 문장(🔴/🟡)과 걸리면 안 될 문장
 */
const { check, loadLexicon, lexiconSource } = require('../engine/engine');

let pass = 0;
let fail = 0;
const ok = (cond, name, detail) => {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.log(`  ❌ ${name}${detail ? ` · ${detail}` : ''}`);
  }
};

// 1) 어휘 사전
const lex = loadLexicon();
ok(lex && lex.length >= 100, '어휘 사전 불러오기', lex ? `${lex.length}개` : '없음');
const raw = JSON.parse(require('fs').readFileSync(lexiconSource(), 'utf8'));
for (const e of raw.entries) {
  const genre = ['일반', '보고서', '논문'].find((g) => !(e.skip_genres || []).includes(g));
  if (!genre) continue; // im-not-ai 가 모든 장르에서 꺼 둔 항목(예: X-01 지형)
  const has = (s) => check(s, { ext: '.txt', genre }).some((h) => h.lexicon === e.id);
  for (const s of e.test_detect_pos || e.test_positive || []) ok(has(s), `사전 ${e.id} 맞는 예`, s);
  for (const s of e.test_detect_neg || e.test_negative || []) ok(!has(s), `사전 ${e.id} 틀린 예`, s);
}

// 2) 규칙 사례 [문장, 기대: 1(🔴)·2(🟡)·0(안 걸림), 규칙 이름 일부, 확장자]
const CASES = [
  ['이 방식은 빠릅니다 — 그리고 정확합니다.', 1, '줄표'],
  ['좋은 질문입니다. 바로 답하겠습니다.', 1, '챗봇'],
  ['예리하십니다. 그 부분이 핵심입니다.', 1, '아첨'],
  ['정말 흥미로운 의견이군요.', 1, '아첨'],
  ['훌륭한 지적이에요. 고치겠습니다.', 1, '아첨'],
  ['이번 시험은 완벽합니다. 33개 모두 통과했습니다.', 0, '아첨'],
  ['결론적으로 이 도구는 쓸 만합니다.', 1, '결산'],
  ['서버 두 대를 하나로 합쳤습니다.', 0, ''],
  ['그는 「결론적으로 망했다」고 말했다.', 0, '결산'],
  ['아울러 다양한 도구를 활용하며, 나아가 체계적인 관리를 이어 갑니다.', 2, 'AI 고빈도'],
  ['혁신적이고 체계적이며 효율적인 방법을 찾았다.', 2, "'~적'"],
  ['체계적인 방법을 찾았다. 효율적이었다. 혁신이었다.', 0, "'~적'"],
  ['첫째, 자료를 모은다. 둘째, 정리한다. 셋째, 검토한다.', 2, '첫째'],
  ['const label = "결론적으로 성공";', 1, '결산', '.ts'],
  ['// 결론적으로 이 함수는 빠르다', 0, '결산', '.ts'],
  ['```\n결론적으로 — 코드 안\n```\n바깥 문장은 깨끗합니다.', 0, ''],
  ['기능은 `—` 로 구분하지 않습니다.', 0, '줄표'],
  ['자료는 다 모았고요. 정리도 끝냈고요.', 2, "'~고요'"],
  ['그건 실패라기보다 실험에 가깝습니다.', 2, '라기보다'],
  ['이 사업의 중심은 주민 참여입니다.', 2, '정의형'],
  ['신청하게 됩니다. 접수하게 됩니다. 처리하게 됩니다.', 2, '하게 됩니다'],
  ['어제 비가 왔고요', 0, "'~고요'"],
];
for (const [text, want, name, ext = '.md'] of CASES) {
  const hits = check(text, { ext });
  const match = hits.filter((h) => !name || h.name.includes(name));
  if (want === 0) ok(match.length === 0, `안 걸려야 함: ${text.slice(0, 30)}`, match.map((h) => h.name).join(','));
  else ok(match.some((h) => h.tier === want), `${want === 1 ? '🔴' : '🟡'} ${name}: ${text.slice(0, 30)}`, hits.map((h) => `${h.tier}:${h.name}`).join(','));
}

console.log(`엔진 시험: ${pass} 통과 / ${fail} 실패`);
process.exitCode = fail ? 1 : 0;
