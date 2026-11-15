# nmsw: no more slop words

<!-- slop-gate: off (금지어 예시를 일부러 적은 문서) -->

한국어 AI 슬롭 말투를 쓰기 전에 막고, 쓴 뒤에 잡는 Claude Code 하네스. 판정 엔진 하나를 네 자리가 같이 씀.

| 자리 | 훅 | 하는 일 |
|---|---|---|
| 쓰기 전 | `hooks/card.js` (UserPromptSubmit) | 요청마다 짧은 규칙 카드 + 최근 7일 자주 걸린 표현 주입 |
| 파일 저장 | `hooks/file-gate.js` (PostToolUse Write·Edit) | 🔴 면 저장을 되돌려 고치게 함, 🟡 는 알림 |
| 답변 | `hooks/reply-gate.js` (Stop) | 마지막 답변 글에 🔴 가 있으면 고친 판을 다시 보내게 함(한 턴 한 번). 중간 진행 글은 기록만 |
| 커밋 | `hooks/commit-gate.js` (PreToolUse Bash) | `git commit` 직전, 커밋에 실제로 들어갈 새 줄과 커밋 메시지에 🔴 가 있으면 막음. Bash 로 쓴 파일, 코덱스·제미나이가 쓴 파일도 여기서 걸림 |

Claude 밖에서는 명령줄로 같은 엔진을 씀: `node engine/cli.js <파일...>` (🔴 면 종료 코드 1).

## 설치

```bash
git clone git@github.com:chrisryugj/nmsw.git ~/.claude/nmsw
node ~/.claude/nmsw/scripts/setup.js --auto-update --agents
```

- `setup.js`: `~/.claude/settings.json` 에 훅 4개 등록, 옛 윤문 훅(`korean-slop-gate.js`) 등록 정리. 몇 번 돌려도 같은 결과
- `--auto-update`(macOS): 6시간마다 `git pull` 뒤 등록을 다시 맞춤. im-not-ai vendor 가 있으면 같이 받음. 기록 `.log/update.log`
- `--agents`: `~/.codex/AGENTS.md`·`~/.gemini/GEMINI.md` 에 쓰기 전 규칙과 검사 명령 블록을 넣음(있는 파일만)
- `--check` 상태, `--uninstall` 되돌리기
- 윈도우: `node scripts/setup.js` 로 등록. 자동 갱신은 작업 스케줄러에 `git pull` + 같은 명령을 걸면 됨

## 판정

- 🔴(막음): 줄표, 이중 피동, 챗봇 말투, 아첨, 과장 어휘, AI 관용구, 결산 피벗, 결말 공식, 비유 동사 다섯(꽂다·박다·녹이다·겨냥·걷어내다)
- 🟡(알림): 말줄임표, 번역투, '수 있습니다' 남발, 비유·의인화 동사, 생성형 은유, AI 고빈도 어휘 군집, '~적' 쌓기, im-not-ai 어휘 사전 111개 등
- 규칙 정본: `engine/rules.js`. 형식 `[정규식, 이름, 대신 쓸 말, 단계, 최소 건수, 범위('p' 문단·'s' 문장)]`
- 어휘 사전: `~/.claude/vendor/im-not-ai/.../lexicon.json` 이 있으면 그걸, 없으면 `vendor/im-not-ai-lexicon.json` 사본. 항목마다 「바꿀 때·둘 때」를 메시지에 같이 보여 줌. 문서 파일은 보고서 장르, 답변·코드 화면 문구는 일반 장르
- 빼는 것: md 코드 블록·인라인 코드, 코드 파일 주석 줄, md·txt 의 따옴표 직접 인용(120자 이하), `.claude`·`.codex`·테스트 경로, `slop-gate: off` 가 든 파일
- 끄기: `NMSW_REPLY=off`, `NMSW_CARD=off`, 커밋은 `--no-verify` 또는 명령에 `NMSW=off`. 사람이 보지 않는 실행(`claude -p` 자동화, `CLAUDE_CODE_SESSION_ATTENDED=0`)에서는 답변 게이트와 카드가 꺼짐
- 면제 표시 `slop-gate: off` 는 한 줄을 단독으로 차지할 때만 인정

## 커밋 게이트 범위

- 스테이징된 것 + 같은 명령의 `git add <경로>`·`add -A`·`add -u`·`commit -a`·`commit <경로>` 가 넣을 것. 스테이징 안 한 초안은 안 봄
- 명령을 따옴표 밖 `&&`·`;`·`|`·줄바꿈으로 나눠 git 으로 시작하는 조각만 봄(`grep 'git commit'` 은 커밋 아님). 커밋 바로 앞의 `cd`·`git -C` 로 레포를 정함
- 커밋 메시지: `-m`·`-m"…"`·`-am`·`--message=`·`-F 파일`·`-F -` heredoc
- 병합·체리픽·되돌리기 중이면 커밋 메시지만 봄(새 줄 대부분이 남의 글)
- 한계: 같은 명령 안에서 새로 만드는 파일(`printf … > y.md && git add y.md && git commit`)은 명령이 돌기 전이라 못 읽음. 그런 레포는 `node engine/cli.js install-hook` 으로 git pre-commit 훅을 깔면 커밋 순간에 잡힘

## 시험

```bash
node test/run.js      # 엔진: 어휘 사전 맞는 예·틀린 예 + 규칙 사례 (766개)
bash test/hooks.sh    # 훅: 합성 입력으로 막음·알림·침묵 확인 (52개, 2026-11-15 리뷰 재현 사례 포함)
node test/bench.js <사람.jsonl> <AI.jsonl> --promote   # 오탐 실측
```

규칙·사전을 바꾸면 두 시험을 다시 돌린 뒤 커밋.

## 오탐 실측 (2026-11-15)

- 사람 글: 저자 스레드 글 379편(셀프답글 포함). 🔴 걸린 글 28편(7.4%). 대부분 줄표 22편, 꽂다·박다 각 3편으로, 저자가 나중에 금지로 정한 표현이 옛 글에 남은 것
- 아첨 규칙: 사람 글 0건, patina 아첨 예문 중 「예리하십니다」「정확한 통찰입니다」「좋은 질문이에요」 적발
- 어휘 사전 🔴 승격: 0개. 사람 글 0건·AI 글 1건 이상인 restore 항목 8개는 AI 쪽 걸린 곳이 영상 글의 카메라 이음매·렌즈, 「복지나침반」 같은 실물 용법이었음. 사전은 문맥 판단용이라 🟡 로 둠
- 새 슬롭 후보 찾기: `node engine/cli.js mine --human <사람 글> --ai <AI 글...>` (slop-forensics 방식, 어절 1~3그램 빈도 비교)

## 출처

`NOTICE.md` 참고. im-not-ai(MIT) 어휘 사전, devswha/patina(MIT) 한국어 패턴 문턱·아첨 예문, dotoridot/korean-humanizer(MIT) 흔한 표현 목록, sam-paech slop-forensics·Antislop(ICLR 2026) 빈도 비교 방법.
