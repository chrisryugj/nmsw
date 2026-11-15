#!/usr/bin/env node
'use strict';
/**
 * nmsw 설치·갱신. 몇 번 돌려도 같은 결과(멱등)
 *
 *   node scripts/setup.js                 settings.json 에 훅 4개 등록, 옛 윤문 훅 등록 정리
 *   node scripts/setup.js --auto-update   (macOS) 6시간마다 git pull + 다시 등록하는 LaunchAgent 설치
 *   node scripts/setup.js --agents        코덱스·제미나이 전역 지침에 쓰기 전 규칙 블록 넣기(있는 파일만)
 *   node scripts/setup.js --check         상태만 보기
 *   node scripts/setup.js --uninstall     등록·LaunchAgent·지침 블록 지우기
 *   --quiet                               바뀐 게 없으면 아무것도 출력하지 않음
 */
// slop-gate: off
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const HOME = os.homedir();
const SETTINGS = path.join(HOME, '.claude', 'settings.json');
const args = new Set(process.argv.slice(2));
const quiet = args.has('--quiet');
const say = (...m) => {
  if (!quiet) console.log(...m);
};

const hookPath = (f) => path.join(ROOT, 'hooks', f).split(path.sep).join('/');
const HOOKS = [
  { event: 'PostToolUse', matcher: 'Write|Edit', file: 'file-gate.js' },
  { event: 'Stop', matcher: null, file: 'reply-gate.js' },
  { event: 'PreToolUse', matcher: 'Bash', file: 'commit-gate.js' },
  { event: 'UserPromptSubmit', matcher: null, file: 'card.js' },
];
const cmdFor = (f) => `node "${hookPath(f)}"`;
// 예전 자리의 윤문 훅(설정 레포 hooks/korean-slop-gate.js, slopgate 시절 이름)
const OLD = /korean-slop-gate\.js|slop-reply-gate\.js|slop-commit-gate\.js|slop-card\.js/;
const isNmsw = (c) => /nmsw[\\/]+hooks[\\/]/.test(c || '');

function readSettings() {
  if (!fs.existsSync(SETTINGS)) return {};
  return JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
}

function writeSettings(s, before) {
  const after = JSON.stringify(s, null, 2) + '\n';
  if (after === before) return false;
  fs.copyFileSync(SETTINGS, `${SETTINGS}.nmsw-bak`);
  fs.writeFileSync(SETTINGS, after);
  return true;
}

// 등록 정리: 옛 윤문 훅·다른 경로의 nmsw 훅을 지우고 이 설치 경로의 훅 4개만 남긴다
function register(remove) {
  const before = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS, 'utf8') : '';
  const s = before ? JSON.parse(before) : {};
  const hooks = (s.hooks = s.hooks || {});
  let dropped = 0;
  for (const ev of Object.keys(hooks)) {
    hooks[ev] = hooks[ev]
      .map((m) => {
        const kept = (m.hooks || []).filter((x) => {
          const drop = OLD.test(x.command || '') || isNmsw(x.command);
          if (drop) dropped += 1;
          return !drop;
        });
        return { ...m, hooks: kept };
      })
      .filter((m) => m.hooks.length);
    if (!hooks[ev].length) delete hooks[ev];
  }
  if (!remove) {
    for (const h of HOOKS) {
      const entry = { hooks: [{ type: 'command', command: cmdFor(h.file) }] };
      (hooks[h.event] = hooks[h.event] || []).push(h.matcher ? { matcher: h.matcher, ...entry } : entry);
    }
    dropped -= HOOKS.length; // 같은 것을 지웠다 다시 넣은 건 변경으로 세지 않음
  }
  const changed = writeSettings(s, before);
  if (changed) say(remove ? '훅 등록을 지웠음' : `훅 등록을 맞췄음(${SETTINGS})`);
  return changed;
}

function status() {
  const s = readSettings();
  const cmds = Object.values(s.hooks || {}).flatMap((arr) => arr.flatMap((m) => (m.hooks || []).map((x) => x.command || '')));
  for (const h of HOOKS) console.log(`${cmds.includes(cmdFor(h.file)) ? '✅' : '❌'} ${h.event} ${h.file}`);
  const old = cmds.filter((c) => OLD.test(c));
  if (old.length) console.log(`⚠️ 옛 윤문 훅 등록 ${old.length}개 남음(setup.js 를 돌리면 정리)`);
  const { lexiconSource, lexiconBroken } = require('../engine/engine');
  const broken = lexiconBroken();
  console.log(`어휘 사전: ${lexiconSource() || '없음'}${broken ? ` (깨진 항목 ${broken}개 건너뜀)` : ''}`);
  const errs = require('../engine/log').recentErrors(7);
  console.log(`최근 7일 훅 오류: ${errs.length}건${errs.length ? ` (마지막: ${errs[errs.length - 1].hook} ${errs[errs.length - 1].ts})` : ''}`);
  const plist = path.join(HOME, 'Library/LaunchAgents/com.chrisryugj.nmsw-update.plist');
  if (process.platform === 'darwin') console.log(`자동 갱신: ${fs.existsSync(plist) ? '켜짐' : '꺼짐'}`);
}

// macOS LaunchAgent: 6시간마다 + 로그인 때 git pull → setup.js --quiet
function autoUpdate(remove) {
  if (process.platform !== 'darwin') {
    say('자동 갱신은 macOS 만 지원. 윈도우는 작업 스케줄러에 같은 명령을 걸면 됨');
    return;
  }
  const label = 'com.chrisryugj.nmsw-update';
  const plist = path.join(HOME, 'Library/LaunchAgents', `${label}.plist`);
  const uid = process.getuid();
  try {
    execFileSync('launchctl', ['bootout', `gui/${uid}/${label}`], { stdio: 'ignore' });
  } catch {
    // 안 떠 있었음
  }
  if (remove) {
    if (fs.existsSync(plist)) fs.unlinkSync(plist);
    say('자동 갱신을 껐음');
    return;
  }
  const node = process.execPath;
  const logDir = path.join(ROOT, '.log');
  fs.mkdirSync(logDir, { recursive: true });
  const vendor = path.join(HOME, '.claude/vendor/im-not-ai');
  const script = [
    `cd "${ROOT}" && git pull --ff-only -q && "${node}" scripts/setup.js --quiet`,
    `if [ -d "${vendor}/.git" ]; then git -C "${vendor}" pull --ff-only -q; fi`,
    'date',
  ].join('; ');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>-c</string><string>${script.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${path.dirname(node)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string><key>HOME</key><string>${HOME}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>21600</integer>
  <key>StandardOutPath</key><string>${logDir}/update.log</string>
  <key>StandardErrorPath</key><string>${logDir}/update.log</string>
</dict></plist>
`;
  fs.mkdirSync(path.dirname(plist), { recursive: true });
  fs.writeFileSync(plist, xml);
  execFileSync('launchctl', ['bootstrap', `gui/${uid}`, plist]);
  say(`자동 갱신을 켰음(6시간마다, 기록 ${logDir}/update.log)`);
}

const START = '<!-- nmsw:start -->';
const END = '<!-- nmsw:end -->';
function agentBlock() {
  const cli = path.join(ROOT, 'engine', 'cli.js').split(path.sep).join('/');
  return [
    START,
    '## 한국어 글 윤문게이트 (nmsw)',
    '- 쓰기 전: 줄표 문자(U+2014) 0개, 부제는 쌍점(:)·가운뎃점(·). 챗봇 말투(살펴보겠습니다·다음과 같습니다), 과장 어휘(획기적·혁신적·인사이트), 결산 공식(결론적으로·~할 때입니다), 아첨(좋은 질문·예리하십니다)은 쓰지 않는다',
    '- 비유 동사(꽂다·박다·녹이다·붙다·잇다·드러나다·짚다) 대신 뜻 그대로(연결·기록·확인·표시) 쓴다. 남의 말·원문은 「」로 인용한다',
    '- 공문·보고서: 날짜 2026. 11. 15., 시각 14:30(24시각제). 익일·상기·만전을 기하다 같은 한자어 대신 쉬운 말, 장애우·학부형 같은 차별 표현은 쓰지 않는다',
    `- 한국어 문서 파일을 쓰거나 고친 뒤: \`node "${cli}" <파일...>\` 로 검사하고 🔴 가 0건이 될 때까지 고친다. 🟡 는 문맥을 보고 판단한다`,
    END,
  ].join('\n');
}

function agents(remove) {
  for (const f of [path.join(HOME, '.codex/AGENTS.md'), path.join(HOME, '.gemini/GEMINI.md')]) {
    if (!fs.existsSync(f)) continue;
    const cur = fs.readFileSync(f, 'utf8');
    const re = new RegExp(`\\n*${START}[\\s\\S]*?${END}\\n?`);
    const base = cur.replace(re, '\n').replace(/\n+$/, '\n');
    const next = remove ? base : `${base}\n${agentBlock()}\n`;
    if (next !== cur) {
      fs.writeFileSync(f, next);
      say(`${remove ? '지침 블록을 지웠음' : '지침 블록을 맞췄음'}: ${f}`);
    }
  }
}

if (args.has('--check')) {
  status();
} else if (args.has('--uninstall')) {
  register(true);
  autoUpdate(true);
  agents(true);
} else {
  register(false);
  if (args.has('--auto-update')) autoUpdate(false);
  if (args.has('--agents')) agents(false);
}
