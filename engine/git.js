'use strict';
/**
 * 커밋에 들어갈 새 줄 뽑기. 셸을 거치지 않게 execFileSync 만 쓴다
 * - 한글·띄어쓰기 파일 이름: core.quotePath=false + 따옴표·끝 탭 풀기
 * - 다른 폴더의 git 설정이 명령을 실행하지 않게 fsmonitor 끄고 textconv·외부 diff 안 씀
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SAFE = ['-c', 'core.quotePath=false', '-c', 'core.fsmonitor=false'];
const MAX_NEW_FILE = 2 * 1024 * 1024;

function git(args, cwd) {
  return execFileSync('git', [...SAFE, ...args], { cwd, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).toString();
}

function expandHome(p) {
  const home = os.homedir();
  return p.replace(/^~(?=$|[\\/])/, home).replace(/^\$\{?HOME\}?(?=$|[\\/])/, home);
}

function toplevel(dir) {
  try {
    return git(['rev-parse', '--show-toplevel'], dir).trim();
  } catch {
    return null;
  }
}

function gitPathExists(repo, name) {
  try {
    return fs.existsSync(path.resolve(repo, git(['rev-parse', '--git-path', name], repo).trim()));
  } catch {
    return false;
  }
}

// 병합·체리픽·되돌리기 중이면 새 줄 대부분이 남의 글이다
function inProgress(repo) {
  return ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'].some((n) => gitPathExists(repo, n));
}

// git 의 C 스타일 따옴표 이름 풀기. \ooo 는 UTF-8 바이트, 날 글자는 그대로 UTF-8 로 모은다
function unquotePath(p) {
  let s = p.replace(/\t$/, '');
  if (s.startsWith('"') && s.endsWith('"')) {
    const bytes = [];
    const body = s.slice(1, -1);
    for (let i = 0; i < body.length; i += 1) {
      const c = body[i];
      if (c === '\\' && /[0-7]{3}/.test(body.slice(i + 1, i + 4))) {
        bytes.push(parseInt(body.slice(i + 1, i + 4), 8));
        i += 3;
      } else if (c === '\\' && i + 1 < body.length) {
        const n = body[(i += 1)];
        bytes.push(...Buffer.from({ t: '\t', n: '\n' }[n] || n, 'utf8'));
      } else {
        bytes.push(...Buffer.from(c, 'utf8'));
      }
    }
    s = Buffer.from(bytes).toString('utf8');
  }
  return s.replace(/^b\//, '');
}

// diff -U0 출력 → { 레포 기준 경로: 새 줄 묶음(덩어리 사이는 빈 줄) }
function parseAdditions(diff, into = {}) {
  let cur = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const p = line.slice(4);
      cur = p === '/dev/null' ? null : unquotePath(p);
      if (cur) into[cur] = into[cur] ? `${into[cur]}\n` : '';
    } else if (cur && line.startsWith('@@')) {
      into[cur] += '\n';
    } else if (cur && line.startsWith('+')) {
      into[cur] += `${line.slice(1)}\n`;
    }
  }
  return into;
}

const DIFF = ['diff', '-U0', '--no-color', '--no-ext-diff', '--no-textconv', '--diff-filter=ACMR'];

/**
 * 커밋에 들어갈 새 줄
 * @param {string} repo 레포 최상위
 * @param {{trackedAll?: boolean, paths?: {dir:string, specs:string[]}[], untrackedAll?: boolean, filter?: (abs:string)=>boolean}} scope
 *   기본: 스테이징된 것. trackedAll: 추적 파일의 스테이징 안 된 변경도(commit -a, add -u·-A)
 *   paths: 같은 명령의 `git add <경로>`·`git commit <경로>` (dir 기준으로 풀어 그 경로의 변경·새 파일)
 *   untrackedAll: 새 파일 전부(add -A)
 */
function additions(repo, scope = {}) {
  const files = {};
  parseAdditions(git([...DIFF, '--cached'], repo), files);
  if (scope.trackedAll) parseAdditions(git(DIFF, repo), files);
  for (const { dir, specs } of scope.paths || []) {
    if (!specs.length) continue;
    try {
      parseAdditions(git([...DIFF, '--', ...specs], dir), files);
    } catch {
      // 없는 경로
    }
  }
  const newFiles = new Set();
  if (scope.untrackedAll) for (const f of git(['ls-files', '--others', '--exclude-standard', '-z'], repo).split('\0')) if (f) newFiles.add(f);
  for (const { dir, specs } of scope.paths || []) {
    if (!specs.length) continue;
    try {
      for (const f of git(['ls-files', '--others', '--exclude-standard', '--full-name', '-z', '--', ...specs], dir).split('\0')) if (f) newFiles.add(f);
    } catch {
      // 없는 경로
    }
  }
  for (const f of newFiles) {
    const abs = path.join(repo, f);
    if (scope.filter && !scope.filter(abs)) continue;
    try {
      if (fs.statSync(abs).size > MAX_NEW_FILE) continue;
      files[f] = (files[f] ? `${files[f]}\n` : '') + fs.readFileSync(abs, 'utf8');
    } catch {
      // 읽을 수 없는 파일
    }
  }
  return files;
}

module.exports = { git, toplevel, inProgress, additions, parseAdditions, expandHome, unquotePath };
