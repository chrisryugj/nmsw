# NOTICE

nmsw 가 쓰거나 참고한 공개 자료.

| 자료 | 라이선스 | 쓴 곳 |
|---|---|---|
| [epoko77-ai/im-not-ai](https://github.com/epoko77-ai/im-not-ai) `skills/humanize-korean/references/lexicon.json` (v2.4.4, 333b35c) | MIT, `vendor/LICENSE-im-not-ai` | `vendor/im-not-ai-lexicon.json` 사본, 엔진의 어휘 사전 검사. 분류 체계 ai-tell-taxonomy v2.8 은 `engine/rules.js` 기본 규칙의 근거 |
| [devswha/patina](https://github.com/devswha/patina) `patterns/ko-language.md` #7·#8, `artifacts/persona-calibration-2026/sycophancy/korean.jsonl` | MIT | `engine/rules.js` EXTRA_RULES 의 AI 고빈도 어휘 군집·`~적` 쌓기 최소 건수, 아첨 말투 규칙 |
| [dotoridot/korean-humanizer](https://github.com/dotoridot/korean-humanizer) `CHEATSHEET.md` | MIT | `첫째·둘째·셋째` 나열, `~뿐만 아니라`, `~라고 할 수 있습니다` 규칙 |
| [sam-paech/slop-forensics](https://github.com/sam-paech/slop-forensics), Antislop (arXiv 2510.15061, ICLR 2026) | MIT | `engine/cli.js mine` 의 사람 글 대비 과다 출현 표현 찾기 방법(코드는 가져오지 않음) |
| 「행정업무의 운영 및 혁신에 관한 규정」 제7조, 같은 규정 시행규칙 제2조·제4조 | 법령(저작권법 제7조 보호 대상 아님) | `engine/gongmun.js` 날짜·시각 표기, 공문 판단 표지(붙임·「끝」) |
| 문화체육관광부·행정안전부 행정용어 순화어 목록(2012), 국립국어원 다듬은 말 | 정부 자료. 낱말 짝만 골라 씀(자료 파일 사본 없음) | `engine/gongmun.js` 행정 한자어·일본어 투 순화 |
