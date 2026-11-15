#!/usr/bin/env bash
# nmsw 훅 시험: 합성 stdin JSON → 기대 패턴(grep) 또는 무출력(EMPTY). 훅·규칙을 바꾼 뒤 반드시 돌린다
# 배경: 2026-07-05 입력 필드 이름 오류로 훅 3종이 몇 달 동안 아무 일도 안 한 사고의 재발 방지
# 사용: bash ~/.claude/nmsw/test/hooks.sh
set -u
HOOKS_DIR="$(cd "$(dirname "$0")/../hooks" && pwd)"
PASS=0; FAIL=0
export NMSW_LOG="$(mktemp)"   # 시험 기록은 진짜 기록(.log/hits.jsonl)에 섞지 않는다

run_case() { # $1=이름 $2=훅파일 $3=stdin JSON $4=기대 (EMPTY 또는 grep 패턴)
  local name="$1" hook="$2" json="$3" expect="$4" out
  out=$(printf '%s' "$json" | node "$HOOKS_DIR/$hook" 2>/dev/null)
  if [[ "$expect" == "EMPTY" ]]; then
    if [[ -z "$out" ]]; then echo "  ✅ $name"; PASS=$((PASS+1));
    else echo "  ❌ $name — 무출력 기대인데: ${out:0:120}"; FAIL=$((FAIL+1)); fi
  else
    if grep -q "$expect" <<<"$out"; then echo "  ✅ $name"; PASS=$((PASS+1));
    else echo "  ❌ $name — '$expect' 미검출: ${out:0:120}"; FAIL=$((FAIL+1)); fi
  fi
}

echo "── file-gate (PostToolUse Write|Edit)"
run_case "줄표 → block" file-gate.js \
  '{"tool_name":"Write","tool_input":{"file_path":"/tmp/a.md","content":"우리 마을 — 햇빛으로 돈을 법니다."}}' \
  'decision":"block'
run_case "Edit new_string 챗봇 말투 → block" file-gate.js \
  '{"tool_name":"Edit","tool_input":{"file_path":"/tmp/a.html","old_string":"x","new_string":"<p>좋은 질문입니다. 살펴보겠습니다.</p>"}}' \
  'decision":"block'
run_case "비유 동사만 → 알림(additionalContext)" file-gate.js \
  '{"tool_name":"Write","tool_input":{"file_path":"/tmp/a.md","content":"관계마다 근거가 붙어 있습니다."}}' \
  'additionalContext'
run_case "한 화면 압축 → 알림" file-gate.js \
  '{"tool_name":"Write","tool_input":{"file_path":"/tmp/a.html","content":"<p>목적과 절차가 한 화면에 정리됩니다.</p>"}}' \
  'additionalContext'
run_case "깨끗한 한국어 → 침묵" file-gate.js \
  '{"tool_name":"Write","tool_input":{"file_path":"/tmp/a.md","content":"마을 120세대가 한 해 3억 원을 받습니다."}}' EMPTY
run_case "영어 줄 줄표 → 침묵" file-gate.js \
  '{"tool_name":"Write","tool_input":{"file_path":"/tmp/a.md","content":"Fast path — no tools."}}' EMPTY
run_case "md 코드블록 안 → 침묵" file-gate.js \
  '{"tool_name":"Write","tool_input":{"file_path":"/tmp/a.md","content":"```\n자료 — 원본\n```"}}' EMPTY
run_case "코드 주석 줄 → 침묵" file-gate.js \
  '{"tool_name":"Write","tool_input":{"file_path":"/tmp/a.ts","content":"// 캐시 — 키 고정\nconst a = 1"}}' EMPTY
run_case ".claude/ 파일 → 침묵" file-gate.js \
  '{"tool_name":"Write","tool_input":{"file_path":"/Users/x/.claude/memory/a.md","content":"자료 — 원본"}}' EMPTY
run_case "테스트 파일 → 침묵" file-gate.js \
  '{"tool_name":"Write","tool_input":{"file_path":"/tmp/copy.test.ts","content":"const F = /—|획기적/"}}' EMPTY
run_case "'단순한 X를 넘어'(A-21) → block" file-gate.js \
  '{"tool_name":"Write","tool_input":{"file_path":"/tmp/a.md","content":"단순한 수지타산을 넘어 물가 안정을 고민해야 한다."}}' \
  'decision":"block'
run_case "피동 진행 한 문단 3회(A-20) → 알림" file-gate.js \
  '{"tool_name":"Edit","tool_input":{"file_path":"/tmp/a.md","old_string":"x","new_string":"경쟁은 심화되고 있다. 어려움이 커지고 있다. 격차도 벌어지고 있다."}}' \
  'additionalContext'
run_case "'~를 통해' 문단마다 1회 → 침묵" file-gate.js \
  '{"tool_name":"Write","tool_input":{"file_path":"/tmp/a.md","content":"분석을 통해 원인을 찾는다.\n\n점검을 통해 확인한다."}}' EMPTY
run_case "공문 개조식 명사형 종결 → 침묵" file-gate.js \
  '{"tool_name":"Write","tool_input":{"file_path":"/tmp/a.md","content":"○ 효과 검증 자료 부재\n‣ 다발 구역 우선 관리 필요\n‣ 지원 대상 확대 및 점검 강화 추진\n‣ 더 이상 투기가 발생하지 않도록 관리, 기반 마련"}}' EMPTY
run_case "slop-gate: off 표시 → 침묵" file-gate.js \
  '{"tool_name":"Write","tool_input":{"file_path":"/tmp/a.md","content":"<!-- slop-gate: off -->\n획기적 — 예시"}}' EMPTY

echo "── reply-gate (Stop)"
TR_DIR=$(mktemp -d)
mk_tr() { # $1=파일 $2=직전 턴 답변 $3=이번 턴 답변
  printf '%s\n' \
    '{"type":"user","message":{"role":"user","content":"첫 질문"}}' \
    "{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"$2\"}]}}" \
    '{"type":"user","message":{"role":"user","content":"다음 질문"}}' \
    "{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"tool_use\",\"name\":\"Bash\",\"input\":{}}]}}" \
    '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"ok"}]}}' \
    "{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"$3\"}]}}" > "$1"
}
mk_tr "$TR_DIR/a.jsonl" "깨끗합니다." "결론적으로 이 방법이 빠릅니다 — 정말로."
run_case "답변 줄표·결산 → block" reply-gate.js '{"transcript_path":"'"$TR_DIR/a.jsonl"'"}' 'decision":"block'
run_case "이미 한 번 막았으면(stop_hook_active) → 침묵" reply-gate.js '{"transcript_path":"'"$TR_DIR/a.jsonl"'","stop_hook_active":true}' EMPTY
mk_tr "$TR_DIR/b.jsonl" "결론적으로 — 지난 턴 슬롭" "서버 두 대를 하나로 합쳤습니다."
run_case "지난 턴 슬롭은 안 봄 → 침묵" reply-gate.js '{"transcript_path":"'"$TR_DIR/b.jsonl"'"}' EMPTY
mk_tr "$TR_DIR/c.jsonl" "깨끗합니다." "네가 쓴 「결론적으로 망했다」는 그대로 둡니다."
run_case "따옴표 인용 → 침묵" reply-gate.js '{"transcript_path":"'"$TR_DIR/c.jsonl"'"}' EMPTY
mk_tr "$TR_DIR/d.jsonl" "깨끗합니다." "예리하십니다. 바로 고치겠습니다."
run_case "아첨 말투 → block" reply-gate.js '{"transcript_path":"'"$TR_DIR/d.jsonl"'"}' 'decision":"block'
rm -rf "$TR_DIR"

echo "── commit-gate (PreToolUse Bash)"
CG=$(mktemp -d); git init -q "$CG"; git -C "$CG" config user.email t@t; git -C "$CG" config user.name t
printf '첫 줄\n' > "$CG/a.md"; git -C "$CG" add a.md; git -C "$CG" commit -qm init
printf '첫 줄\n\n결론적으로 이 도구는 쓸 만합니다.\n' > "$CG/a.md"; git -C "$CG" add a.md
run_case "스테이징된 새 줄 결산 → deny" commit-gate.js \
  '{"tool_name":"Bash","tool_input":{"command":"git commit -m \"docs: 정리\""},"cwd":"'"$CG"'"}' 'permissionDecision":"deny'
run_case "--no-verify → 침묵" commit-gate.js \
  '{"tool_name":"Bash","tool_input":{"command":"git commit --no-verify -m \"docs\""},"cwd":"'"$CG"'"}' EMPTY
git -C "$CG" checkout -q -- a.md 2>/dev/null; git -C "$CG" reset -q; git -C "$CG" checkout -q -- a.md
printf '메모\n' > "$CG/b.md"
run_case "깨끗한 커밋 → 침묵" commit-gate.js \
  '{"tool_name":"Bash","tool_input":{"command":"git add b.md && git commit -m \"docs: 메모 추가\""},"cwd":"'"$CG"'"}' EMPTY
run_case "커밋 메시지 줄표 → deny" commit-gate.js \
  '{"tool_name":"Bash","tool_input":{"command":"git commit -m \"docs: 정리 — 마무리\""},"cwd":"'"$CG"'"}' 'permissionDecision":"deny'
printf '좋은 질문입니다. 시작하겠습니다.\n' > "$CG/c.md"
run_case "add -A 새 파일 챗봇 말투 → deny" commit-gate.js \
  '{"tool_name":"Bash","tool_input":{"command":"git add -A && git commit -m \"docs\""},"cwd":"'"$CG"'"}' 'permissionDecision":"deny'
run_case "commit 아닌 명령 → 침묵" commit-gate.js \
  '{"tool_name":"Bash","tool_input":{"command":"git status"},"cwd":"'"$CG"'"}' EMPTY
rm -rf "$CG"

echo "── card (UserPromptSubmit)"
run_case "쓰기 전 규칙 카드 주입" card.js '{"prompt":"안녕"}' '윤문게이트·쓰기 전'
rm -f "$NMSW_LOG"


echo "── 리뷰 재현 사례 (2026-11-15)"
R=$(mktemp -d); git init -q "$R"; git -C "$R" config user.email t@t; git -C "$R" config user.name t
printf 'a\n' > "$R/a.ts"; printf '메모\n' > "$R/notes.md"; git -C "$R" add -A; git -C "$R" commit -qm init
printf '메모\n\n결론적으로 초안입니다.\n' > "$R/notes.md"; printf 'b\n' > "$R/a.ts"
run_case "[1] 커밋 안 할 초안(스테이징 안 함) → 침묵" commit-gate.js \
  '{"tool_name":"Bash","tool_input":{"command":"git add a.ts && git commit -m \"fix\""},"cwd":"'"$R"'"}' EMPTY
run_case "[1] commit -a 면 그 초안도 검사 → deny" commit-gate.js \
  '{"tool_name":"Bash","tool_input":{"command":"git commit -a -m \"fix\""},"cwd":"'"$R"'"}' 'permissionDecision":"deny'
git -C "$R" checkout -q -- notes.md a.ts
printf '병합\n\n결론적으로 — 팀원 글\n' > "$R/team.md"; git -C "$R" add team.md; touch "$R/.git/MERGE_HEAD"
run_case "[2] 병합 중이면 새 줄은 안 봄 → 침묵" commit-gate.js \
  '{"tool_name":"Bash","tool_input":{"command":"git commit --no-edit"},"cwd":"'"$R"'"}' EMPTY
rm -f "$R/.git/MERGE_HEAD"
run_case "[3] grep 'git commit' 은 커밋 아님 → 침묵" commit-gate.js \
  '{"tool_name":"Bash","tool_input":{"command":"grep -rn \"git commit\" ."},"cwd":"'"$R"'"}' EMPTY
git -C "$R" reset -q; rm -f "$R/team.md"
printf '결론적으로 정리 — 끝\n' > "$R/한글 이름.md"; git -C "$R" add "한글 이름.md"
run_case "[4] 한글·띄어쓰기 파일 이름 → deny" commit-gate.js \
  '{"tool_name":"Bash","tool_input":{"command":"git commit -m \"docs\""},"cwd":"'"$R"'"}' 'permissionDecision":"deny'
git -C "$R" reset -q; rm -f "$R/한글 이름.md"
mkdir -p "$R/sub"; printf '좋은 질문입니다.\n' > "$R/sub/y.md"; printf '좋은 질문입니다.\n' > "$R/root-draft.md"
run_case "[13] 하위 폴더 git add y.md 새 파일 → deny" commit-gate.js \
  '{"tool_name":"Bash","tool_input":{"command":"git add y.md && git commit -m \"docs\""},"cwd":"'"$R/sub"'"}' 'permissionDecision":"deny'
rm -f "$R/sub/y.md"; printf '메모\n' > "$R/sub/z.md"
run_case "[13] 하위 폴더 git add . 은 루트 새 파일 안 봄 → 침묵" commit-gate.js \
  '{"tool_name":"Bash","tool_input":{"command":"git add . && git commit -m \"docs\""},"cwd":"'"$R/sub"'"}' EMPTY
rm -f "$R/root-draft.md"
run_case "[14] -am 메시지 줄표 → deny" commit-gate.js \
  '{"tool_name":"Bash","tool_input":{"command":"git commit -am \"정리 — 끝\""},"cwd":"'"$R"'"}' 'permissionDecision":"deny'
run_case "[14] --message= 줄표 → deny" commit-gate.js \
  '{"tool_name":"Bash","tool_input":{"command":"git commit --message=\"정리 — 끝\""},"cwd":"'"$R"'"}' 'permissionDecision":"deny'
SP="$(mktemp -d)/띄어 쓴 레포"; mkdir -p "$SP"; git init -q "$SP"; printf '결론적으로 좋다.\n' > "$SP/a.md"; git -C "$SP" add a.md
run_case "[13] git -C \"띄어쓰기 경로\" commit → deny" commit-gate.js \
  '{"tool_name":"Bash","tool_input":{"command":"git -C \"'"$SP"'\" commit -m x"},"cwd":"/tmp"}' 'permissionDecision":"deny'
run_case "heredoc 커밋 메시지 줄표 → deny" commit-gate.js \
  '{"tool_name":"Bash","tool_input":{"command":"git commit -F - <<'"'"'EOF'"'"'\ndocs: 정리 — 끝\nEOF"},"cwd":"'"$R"'"}' 'permissionDecision":"deny'
rm -rf "$R" "$(dirname "$SP")"

TR=$(mktemp -d)
printf '%s\n' '{"type":"user","message":{"role":"user","content":"질문"}}' \
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"파일을 살펴보겠습니다."}]}}' \
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"서버 두 대를 하나로 합쳤습니다."}]}}' > "$TR/t.jsonl"
run_case "[6] 중간 글만 슬롭·마지막 글 깨끗 → 침묵" reply-gate.js \
  '{"transcript_path":"'"$TR/t.jsonl"'","last_assistant_message":"서버 두 대를 하나로 합쳤습니다."}' EMPTY
run_case "[6] last_assistant_message 줄표 → block" reply-gate.js \
  '{"transcript_path":"'"$TR/t.jsonl"'","last_assistant_message":"결론적으로 끝났습니다 — 정말로."}' 'decision":"block'
CLAUDE_CODE_SESSION_ATTENDED=0 run_case "[5] 사람이 안 보는 실행(claude -p) → 침묵" reply-gate.js \
  '{"transcript_path":"'"$TR/t.jsonl"'","last_assistant_message":"결론적으로 끝났습니다 — 정말로."}' EMPTY
CLAUDE_CODE_SESSION_ATTENDED=0 run_case "[5] 사람이 안 보는 실행이면 카드도 침묵" card.js '{"prompt":"x"}' EMPTY
rm -rf "$TR"

run_case "[9] 코드 줄 끝 주석 줄표 → 침묵" file-gate.js \
  '{"tool_name":"Write","tool_input":{"file_path":"/tmp/a.ts","content":"const a = 1; // 캐시 — 고정"}}' EMPTY
run_case "[9] 파이썬 docstring → 침묵" file-gate.js \
  '{"tool_name":"Write","tool_input":{"file_path":"/tmp/a.py","content":"def f():\n    \"\"\"결론적으로 — 계산\"\"\"\n    return 1"}}' EMPTY
run_case "[9] JSX 화면 글 결산 → block" file-gate.js \
  '{"tool_name":"Write","tool_input":{"file_path":"/tmp/a.tsx","content":"export const A = () => <p>결론적으로 좋습니다</p>;"}}' 'decision":"block'
run_case "[9] html script 안 주석 → 침묵" file-gate.js \
  '{"tool_name":"Write","tool_input":{"file_path":"/tmp/a.html","content":"<p>안내</p><script>// 결론적으로 — 초기화\n</script>"}}' EMPTY
run_case "[8] USB 케이블을 꽂으면 → 침묵" file-gate.js \
  '{"tool_name":"Write","tool_input":{"file_path":"/tmp/a.md","content":"USB 케이블을 꽂으면 켜집니다."}}' EMPTY
run_case "[8] 글자 그대로 「저장할 때입니다」 → 막지 않고 알림" file-gate.js \
  '{"tool_name":"Write","tool_input":{"file_path":"/tmp/a.md","content":"두 번째로 저장할 때입니다."}}' 'additionalContext'
run_case "[8] 결론 꼴 「이제 행동할 때입니다」 → block" file-gate.js \
  '{"tool_name":"Write","tool_input":{"file_path":"/tmp/a.md","content":"이제 우리가 행동할 때입니다."}}' 'decision":"block'
run_case "[16] > 인용 줄 → 침묵" file-gate.js \
  '{"tool_name":"Write","tool_input":{"file_path":"/tmp/a.md","content":"유저가 이렇게 썼다.\n\n> 결론적으로 망했다 — 진짜로"}}' EMPTY
run_case "[16] 짝 안 맞는 울타리 뒤 코드 → 침묵" file-gate.js \
  '{"tool_name":"Edit","tool_input":{"file_path":"/tmp/a.md","new_string":"본문입니다.\n```js\n// 결론적으로 — 코드"}}' EMPTY
run_case "[15] 문장 속 slop-gate: off 언급은 면제 아님 → block" file-gate.js \
  '{"tool_name":"Write","tool_input":{"file_path":"/tmp/a.md","content":"표시는 slop-gate: off 처럼 씁니다. 결론적으로 쉽습니다."}}' 'decision":"block'

echo ""
echo "결과: $PASS 통과 / $FAIL 실패"
[[ $FAIL -eq 0 ]] || exit 1
