#!/usr/bin/env node
/**
 * nmsw commit gate (PreToolUse:Bash)
 * Claude Code 에서 git commit 을 부를 때, 커밋에 실제로 들어갈 새 줄과 커밋 메시지를 nmsw 엔진으로 검사한다.
 * Write·Edit 를 거치지 않은 글(Bash 로 쓴 파일, 코덱스·제미나이가 쓴 파일)도 여기서 걸린다.
 *
 * - 🔴 가 있으면 커밋을 막는다(deny). 🟡 는 통과
 * - 범위: 스테이징된 것 + 같은 명령의 `git add <경로>`·`add -A`·`add -u`·`commit -a`·`commit <경로>` 가 넣을 것
 * - 병합·체리픽·되돌리기 중이면 커밋 메시지만 본다(남의 글)
 * - 건너뛰기: --no-verify, 명령에 NMSW=off, 파일 안 단독 줄 slop-gate: off
 */

const fs = require('fs');
const path = require('path');
const { readInput, safeRun, deny } = require('../engine/hook-io');
const { check, formatHits, shouldCheckPath, isOff } = require('../engine/engine');
const { toplevel, inProgress, additions, expandHome } = require('../engine/git');
const { logHits, logError } = require('../engine/log');

// heredoc 본문을 떼어 둔다(커밋 메시지로 쓰고, 명령 쪼개기에서는 빈칸으로)
function takeHeredocs(cmd) {
  const bodies = [];
  const text = cmd.replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n([\s\S]*?)\n[ \t]*\2(?=\n|$)/g, (_, q, tag, rest, body) => {
    bodies.push(body);
    return ` __NMSW_HEREDOC_${bodies.length - 1}__${rest}`;
  });
  return { text, bodies };
}

// 따옴표 밖의 && || ; | 줄바꿈으로 쪼갠다
function splitSegments(text) {
  const segs = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (q) {
      cur += c;
      if (c === '\\' && q === '"') cur += text[(i += 1)] || '';
      else if (c === q) q = null;
      continue;
    }
    if (c === "'" || c === '"') {
      q = c;
      cur += c;
    } else if (c === '\\') {
      cur += c + (text[(i += 1)] || '');
    } else if (c === ';' || c === '\n' || c === '|' || (c === '&' && text[i + 1] === '&')) {
      if (c === '&' || (c === '|' && text[i + 1] === '|')) i += 1;
      segs.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  segs.push(cur);
  return segs.map((s) => s.trim()).filter(Boolean);
}

function tokenize(seg) {
  const out = [];
  let cur = '';
  let q = null;
  let has = false;
  for (let i = 0; i < seg.length; i += 1) {
    const c = seg[i];
    if (q) {
      if (c === q) q = null;
      else if (c === '\\' && q === '"' && i + 1 < seg.length) cur += seg[(i += 1)];
      else cur += c;
    } else if (c === "'" || c === '"') {
      q = c;
      has = true;
    } else if (c === '\\' && i + 1 < seg.length) {
      cur += seg[(i += 1)];
      has = true;
    } else if (/\s/.test(c)) {
      if (has || cur) out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (has || cur) out.push(cur);
  return out;
}

const VALUE_OPTS = new Set(['-m', '--message', '-F', '--file', '-C', '-c', '--reuse-message', '--reedit-message', '--author', '--date', '--fixup', '--squash', '-t', '--template', '--cleanup', '--trailer']);

// 명령 전체를 읽어 커밋마다 { dir, message, scope } 를 만든다
function parseCommits(command, baseCwd) {
  const { text, bodies } = takeHeredocs(command);
  let cwd = baseCwd;
  const pending = { paths: [], trackedAll: false, untrackedAll: false };
  const commits = [];
  for (const seg of splitSegments(text)) {
    const t = tokenize(seg);
    while (t.length && /^\w+=/.test(t[0])) t.shift(); // FOO=bar 앞붙이기
    if (!t.length) continue;
    if (t[0] === 'cd') {
      cwd = path.resolve(cwd, expandHome(t[1] || require('os').homedir()));
      continue;
    }
    if (t[0] !== 'git') continue;
    let i = 1;
    let dir = cwd;
    while (i < t.length && t[i].startsWith('-')) {
      if (t[i] === '-C') {
        dir = path.resolve(dir, expandHome(t[i + 1] || '.'));
        i += 2;
      } else if (t[i] === '-c') i += 2;
      else i += 1;
    }
    const sub = t[i];
    const rest = t.slice(i + 1);
    if (sub === 'add') {
      const specs = [];
      for (const a of rest) {
        if (a === '-A' || a === '--all') pending.untrackedAll = pending.trackedAll = true;
        else if (a === '-u' || a === '--update') pending.trackedAll = true;
        else if (!a.startsWith('-')) specs.push(a);
      }
      if (specs.length) pending.paths.push({ dir, specs });
    } else if (sub === 'commit') {
      const msg = [];
      const specs = [];
      let all = false;
      for (let k = 0; k < rest.length; k += 1) {
        const a = rest[k];
        const nextVal = () => rest[(k += 1)] || '';
        if (a === '--') {
          specs.push(...rest.slice(k + 1));
          break;
        }
        if (a === '--no-verify' || a === '-n') return { skip: true };
        if (/^--message=/.test(a)) msg.push(a.slice(10));
        else if (/^--file=/.test(a)) msg.push({ file: a.slice(7) });
        else if (a === '-a' || a === '--all') all = true;
        else if (/^-[a-zA-Z]+$/.test(a) && a.length > 2) {
          // 묶인 짧은 옵션: -am "msg", -anm ...
          if (a.includes('a')) all = true;
          if (a.endsWith('m')) msg.push(nextVal());
          else if (a.endsWith('F')) msg.push({ file: nextVal() });
        } else if (/^-m./.test(a)) msg.push(a.slice(2));
        else if (a === '-m' || a === '--message') msg.push(nextVal());
        else if (a === '-F' || a === '--file') msg.push({ file: nextVal() });
        else if (VALUE_OPTS.has(a)) nextVal();
        else if (!a.startsWith('-')) specs.push(a);
      }
      const message = msg
        .map((m) => {
          if (typeof m === 'string') return m;
          const h = m.file === '-' && seg.match(/__NMSW_HEREDOC_(\d+)__/);
          if (h) return bodies[Number(h[1])];
          try {
            return fs.readFileSync(path.resolve(dir, expandHome(m.file)), 'utf8');
          } catch {
            return '';
          }
        })
        .join('\n\n');
      const paths = [...pending.paths];
      if (specs.length) paths.push({ dir, specs });
      commits.push({ dir, message, scope: { paths, trackedAll: pending.trackedAll || all, untrackedAll: pending.untrackedAll } });
    }
  }
  return { commits };
}

function run() {
  const input = readInput();
  const command = (input.tool_input && input.tool_input.command) || '';
  if (!/\bcommit\b/.test(command) || /\bNMSW=off\b/.test(command)) return;
  const parsed = parseCommits(command, input.cwd || process.cwd());
  if (parsed.skip || !parsed.commits.length) return;

  const report = [];
  const allHits = [];
  for (const c of parsed.commits) {
    const repo = toplevel(c.dir);
    if (!repo) continue;
    const msgRed = check(c.message, { ext: '.txt', tiers: [1] });
    if (msgRed.length) {
      report.push('· 커밋 메시지', ...formatHits(msgRed));
      allHits.push(...msgRed);
    }
    if (inProgress(repo)) continue;
    const files = additions(repo, { ...c.scope, filter: shouldCheckPath });
    for (const [rel, text] of Object.entries(files)) {
      const abs = path.join(repo, rel);
      if (!shouldCheckPath(abs) || isOff(text)) continue;
      try {
        if (isOff(fs.readFileSync(abs, 'utf8'))) continue;
      } catch {
        // 지워진 파일 등
      }
      const red = check(text, { ext: path.extname(rel).toLowerCase(), tiers: [1] });
      if (!red.length) continue;
      report.push(`· ${rel}`, ...formatHits(red));
      allHits.push(...red);
    }
  }
  if (!report.length) return;

  logHits('commit', allHits);
  deny(
    [
      '[윤문게이트·커밋] 커밋에 들어갈 한국어 글에 🔴 AI 슬롭 말투가 있음',
      ...report,
      '고쳐서 다시 커밋한다. 원문을 글자 그대로 옮긴 파일이면 파일 안에 slop-gate: off 를 한 줄로 넣는다.',
    ].join('\n'),
  );
}

if (require.main === module) safeRun(run, (e) => logError('commit-gate', e));
module.exports = { parseCommits, splitSegments, tokenize, takeHeredocs };
