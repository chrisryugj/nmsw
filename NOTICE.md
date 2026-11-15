# NOTICE

<!-- slop-gate: off -->

nmsw 는 다음 공개 자료를 쓰거나 참고했다.

| 자료 | 라이선스 | 쓴 곳 |
|---|---|---|
| [epoko77-ai/im-not-ai](https://github.com/epoko77-ai/im-not-ai) `skills/humanize-korean/references/lexicon.json` (v2.4.4, 333b35c) | MIT, `vendor/LICENSE-im-not-ai` | `vendor/im-not-ai-lexicon.json` 사본, 엔진 어휘 레이어. 분류 체계 ai-tell-taxonomy v2.8 은 `engine/rules.js` 기본 규칙의 근거 |
| [devswha/patina](https://github.com/devswha/patina) `patterns/ko-language.md` #7·#8, `artifacts/persona-calibration-2026/sycophancy/korean.jsonl` | MIT | `engine/rules.js` EXTRA_RULES 의 AI 고빈도 어휘 군집·'~적' 쌓기 문턱, 아첨 말투 규칙 |
| [dotoridot/korean-humanizer](https://github.com/dotoridot/korean-humanizer) `CHEATSHEET.md` | MIT | '첫째·둘째·셋째' 나열, '~뿐만 아니라', '~라고 할 수 있습니다' 규칙 |
| [sam-paech/slop-forensics](https://github.com/sam-paech/slop-forensics), Antislop (arXiv 2510.15061, ICLR 2026) | MIT | `engine/cli.js mine` 의 사람 글 대비 과다 출현 표현 찾기 방법(코드는 가져오지 않음) |
