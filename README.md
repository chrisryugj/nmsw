# nmsw: no more slop words

한국어 AI 말투(슬롭)를 Claude Code 안에서 검사하는 훅 묶음. 판정 엔진 하나를 네 시점에서 같이 씀.

| 시점 | 훅 | 동작 |
|---|---|---|
| 요청 직후 | `hooks/card.js` (UserPromptSubmit) | 규칙 요약과 최근 7일 자주 걸린 표현을 Claude 에게 전달 |
| 파일 저장 뒤 | `hooks/file-gate.js` (PostToolUse Write·Edit) | 🔴 가 있으면 고칠 곳을 Claude 에게 돌려보냄. 파일은 저장된 상태이고, Claude 가 같은 턴에 고쳐 다시 저장. 🟡 는 참고로 전달 |
| 답변 끝 | `hooks/reply-gate.js` (Stop) | 마지막 답변에 🔴 가 있으면 턴을 끝내지 않고 고친 답변을 한 번 더 쓰게 함(턴마다 한 번). 중간 진행 글은 기록만 |
| 커밋 직전 | `hooks/commit-gate.js` (PreToolUse Bash) | `git commit` 에 들어갈 새 줄과 커밋 메시지에 🔴 가 있으면 명령 거부. Bash 로 만든 파일, 코덱스·제미나이가 쓴 파일도 여기서 검사 |

Claude 밖에서는 명령줄로 같은 엔진 사용: `node engine/cli.js <파일...>` (🔴 가 있으면 종료 코드 1).

## 설치

```bash
git clone https://github.com/chrisryugj/nmsw.git ~/.claude/nmsw
node ~/.claude/nmsw/scripts/setup.js --auto-update --agents
```

- `setup.js`: `~/.claude/settings.json` 에 훅 4개를 절대 경로로 등록. 옛 윤문 훅(`korean-slop-gate.js` 등) 등록은 정리. 여러 번 실행해도 결과 같음
- `--auto-update` (macOS): LaunchAgent 등록. 로그인 때와 6시간마다 `git pull --ff-only` 뒤 훅 등록을 다시 맞춤. im-not-ai vendor 폴더가 있으면 같이 갱신. 기록은 `.log/update.log`
- `--agents`: `~/.codex/AGENTS.md`·`~/.gemini/GEMINI.md` 가 있으면 규칙 요약과 검사 명령 블록 추가
- `--check` 상태 확인, `--uninstall` 등록 해제
- 윈도우: `node scripts/setup.js` 로 등록. 자동 갱신은 작업 스케줄러에 `git pull` 과 같은 명령을 등록

## 적용 시점

- 규칙·엔진 변경: 훅이 검사마다 새 프로세스로 엔진을 읽으므로 다음 검사부터 적용. 다른 기기는 자동 갱신 주기(최대 6시간) 뒤 적용
- 훅 등록(`settings.json`) 변경: Claude Code 는 세션 시작 때 훅 설정을 읽음. 새 세션부터 적용
- 사람이 보지 않는 실행(`claude -p`, `CLAUDE_CODE_SESSION_ATTENDED=0`): 답변 검사와 규칙 요약은 꺼짐. 파일·커밋 검사는 그대로

## 판정 기준

- 🔴 (고칠 때까지 막음): 줄표, 이중 피동, 챗봇 말투, 아첨, 과장 어휘, AI 관용구, 결산 표현, 결말 공식, 비유 동사 5종, 차별 표현, 공문 날짜·시각의 명백한 오류
- 🟡 (알림): 말줄임표, 번역투, `수 있습니다` 남발, 비유·의인화 동사, 생성형 은유, AI 고빈도 어휘 군집, `~적` 쌓기, 행정 한자어, im-not-ai 어휘 사전 111개 등
- 규칙 파일: `engine/rules.js`(일반), `engine/gongmun.js`(공문서). 형식 `[정규식, 이름, 대신 쓸 말, 단계, 최소 건수, 범위('p' 문단·'s' 문장), 제외 정규식]`
- 어휘 사전: `~/.claude/vendor/im-not-ai/.../lexicon.json` 우선, 없으면 레포 사본 `vendor/im-not-ai-lexicon.json`. 항목마다 바꿀 때·둘 때 설명을 같이 표시. 문서 파일은 보고서 장르, 답변과 코드 속 화면 문구는 일반 장르로 검사
- 검사 제외: md 코드 블록·인라인 코드, 코드 파일 주석, md·txt 의 120자 이하 따옴표 인용과 `>` 인용 줄, 지침·메모리·훅·스킬 경로(`CLAUDE.md`, `~/.claude/memory/`, `~/.claude/skills/` 등), nmsw 판정 코드, 테스트 경로. 사람이 읽는 문서(프로젝트의 `.claude/plans/`, 이 README)는 검사
- 끄기: `NMSW_REPLY=off`, `NMSW_CARD=off`, 커밋은 `--no-verify` 나 명령 앞 `NMSW=off`. 파일 단위 면제는 `slop-gate: off` 한 줄(그 줄에 다른 글이 없을 때만 인정)

## 공문서 규칙

`engine/gongmun.js`. 공문·보고서를 쓰는 공무원 기준.

- 모든 글에서 검사
  - 차별 표현(🔴): `장애우`, `결손 가정`, `미망인`, `학부형`, `살색` 등과 장애 비하 비유. 직함 속 글자(`구청장님`)는 제외
  - 행정 한자어·일본어 투(🟡): `익일`은 다음 날, `상기`는 위, `만전을 기하다`는 빈틈없이 하다, `취합`은 모음, `제고`는 높임, `시건장치`는 잠금장치. 문화체육관광부·행정안전부 행정용어 순화어 목록(2012)과 국립국어원 다듬은 말 기준
  - 공문 관례(🟡): `귀 기관의 무궁한 발전을 기원합니다` 같은 인사말, `하오니`·`사료됩니다` 같은 예스러운 말투
- 공문·보고서로 판단할 때만 검사: 수신·제목·(경유)·붙임·「끝.」·시행·결재 칸 가운데 둘 이상, 또는 □·○ 로 시작하는 줄 셋 이상
  - 날짜·시각(「행정업무의 운영 및 혁신에 관한 규정」 제7조 ⑤): `2026-11-15`·`오후 2시` 는 🔴, `2026.11.15.`(붙여 씀)·`2026. 11. 15`(끝 온점 빠짐)·`2026년 11월 15일`·`14시 30분` 은 🟡. 바른 꼴은 `2026. 11. 15.(일) 14:30`
- 실측(2026-11-15, 실제 공문 5건·보고서 4건): `제고` 14건, `취합` 6건, 붙여 쓴 날짜 4건, `무궁한 발전` 인사 2건, `하오니` 1건, `기 발표대회` 1건. 사람 글 379편에서는 `학부형` 1건, `취합` 1건

## 커밋 검사 범위

- 스테이징된 것과 같은 명령의 `git add <경로>`·`add -A`·`add -u`·`commit -a`·`commit <경로>` 가 넣을 것. 스테이징하지 않은 초안은 검사 안 함
- 명령을 따옴표 밖 `&&`·`;`·`|`·줄바꿈으로 나눠 git 으로 시작하는 조각만 검사(`grep 'git commit'` 은 커밋 아님). 커밋 바로 앞의 `cd`·`git -C` 로 레포 결정
- 커밋 메시지: `-m`·`-m"…"`·`-am`·`--message=`·`-F 파일`·`-F -` heredoc
- 병합·체리픽·되돌리기 중이면 커밋 메시지만 검사(새 줄 대부분이 남의 글)
- 한계: 같은 명령 안에서 새로 만드는 파일(`printf … > y.md && git add y.md && git commit`)은 명령 실행 전이라 읽을 수 없음. 그런 레포는 `node engine/cli.js install-hook` 으로 git pre-commit 훅을 설치하면 커밋 때 검사

## 시험

```bash
npm test   # 엔진 시험 + 훅 시험 + README·NOTICE 🔴 검사
node test/bench.js <사람.jsonl> <AI.jsonl> --promote   # 오탐 실측
```

엔진 803개(어휘 사전 맞는 예·틀린 예, 규칙 사례), 훅 58개(합성 입력으로 막음·알림·무응답 확인). 규칙을 바꾸면 `npm test` 통과 뒤 커밋.

## 오탐 실측 (2026-11-15)

- 사람 글: 저자 스레드 글 379편(셀프 답글 포함) 중 🔴 28편(7.4%). 줄표 22편, `꽂다`·`박다` 각 3편. 저자가 나중에 금지한 표현이 옛 글에 남은 경우
- 아첨 규칙: 사람 글 0건. patina 아첨 예문의 `예리하십니다`·`정확한 통찰입니다`·`좋은 질문이에요` 적발
- 어휘 사전 🔴 승격 0개. 사람 글 0건이고 AI 글 1건 이상인 restore 항목 8개를 확인한 결과, AI 쪽도 영상 글의 카메라 `이음매`, 「복지나침반」 같은 실제 사물·고유명사였음. 사전은 문맥 판단용이라 🟡 유지
- 새 표현 후보 찾기: `node engine/cli.js mine --human <사람 글> --ai <AI 글...>` (slop-forensics 방식, 어절 1~3그램 빈도 비교)

## 출처

`NOTICE.md` 참고. im-not-ai(MIT) 어휘 사전, devswha/patina(MIT) 한국어 패턴 최소 건수·아첨 예문, dotoridot/korean-humanizer(MIT) 표현 목록, sam-paech slop-forensics·Antislop(ICLR 2026) 빈도 비교 방법, 공문서 규칙은 법령과 정부 순화어 목록.
