#!/usr/bin/env node
/**
 * Slop Card (UserPromptSubmit)
 * 쓰기 전에 막는 층: 요청마다 짧은 규칙 카드와 최근 7일 게이트에 자주 걸린 표현을 넣는다.
 * 걸린 기록이 쌓일수록 카드가 실제 버릇을 가리키게 된다(<nmsw>/.log/hits.jsonl).
 * 끄기: 환경 변수 NMSW_CARD=off. 사람이 보지 않는 실행(claude -p, CLAUDE_CODE_SESSION_ATTENDED=0)에서는 꺼짐
 */
// slop-gate: off

const { readInput, safeRun, hookOut } = require('../engine/hook-io');
const { topRecent, logError } = require('../engine/log');

const CARD =
  '[윤문게이트·쓰기 전] 한국어 답변·문서: 줄표(—) 0개, 부제는 쌍점(:)·가운뎃점(·) / ' +
  '챗봇 말투(살펴보겠습니다·다음과 같습니다)·과장 어휘(획기적·혁신적·인사이트)·결산 공식(결론적으로·~할 때입니다) 금지 / ' +
  '비유 동사(꽂다·박다·녹이다·붙다·잇다·드러나다·짚다) 대신 뜻 그대로 / 남의 말·원문은 「」로 인용 / ' +
  '답변도 파일·커밋과 같은 게이트가 검사함';

safeRun(() => {
  if (process.env.NMSW_CARD === 'off' || process.env.CLAUDE_CODE_SESSION_ATTENDED === '0') return;
  readInput();
  const top = topRecent(7, 5);
  const recent = top.length ? `\n최근 7일 자주 걸린 것: ${top.map(([n, c]) => `${n} ${c}회`).join(' · ')}` : '';
  hookOut('UserPromptSubmit', { additionalContext: CARD + recent });
}, (e) => logError('card', e));
