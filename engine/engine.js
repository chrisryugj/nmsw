'use strict';
/**
 * nmsw 엔진: 한국어 AI 슬롭 말투 판정 하나로 쓰기 전 카드·파일 저장·답변·커밋 게이트가 같이 쓴다
 *
 * - 규칙 정본: ./rules.js (RULES + EXTRA_RULES), ./gongmun.js (공공언어 + 공문·보고서일 때만 날짜·시각 표기)
 * - 어휘 사전: im-not-ai lexicon.json(111개, 정규식·제외 정규식·바꿀 때/둘 때). vendor → 레포 사본 순서
 * - 🔴(1) = 막음, 🟡(2) = 알림
 * - 빼는 것: 코드 울타리·인라인 코드, md·txt 의 따옴표 직접 인용(120자 이하)과 > 인용 줄,
 *   html 의 script·style·주석, 코드 파일은 문자열·JSX 글만 보고 주석·docstring 은 뺀다
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { RULES, EXTRA_RULES } = require('./rules');
const { PUBLIC_RULES, FORM_RULES, isGongmun } = require('./gongmun');

const ALL_RULES = [...RULES, ...EXTRA_RULES, ...PUBLIC_RULES];
const PROSE_EXTS = ['.md', '.mdx', '.txt', '.html', '.htm', '.srt', '.vtt', '.typ'];
const CODE_EXTS = ['.tsx', '.jsx', '.ts', '.js', '.mjs', '.cjs', '.vue', '.svelte', '.astro', '.py'];
const BLANK_SPLIT_EXTS = ['.md', '.mdx', '.txt', '.typ'];
const HTML_EXTS = ['.html', '.htm', '.vue', '.svelte', '.astro'];
// 금지어 목록을 일부러 적는 파일만 뺀다: Claude·코덱스·제미나이 지침과 메모리, 훅·스킬, nmsw 판정 코드.
// 사람이 읽는 문서(.claude/plans/, nmsw README·NOTICE 등)는 검사한다
const SKIP_PATH = new RegExp(
  [
    String.raw`[\\/]\.claude[\\/](?:hooks|lib|agents|commands|skills|vendor|output-styles|templates|prompts|scripts|backups|plugins|projects|memory|shell-snapshots|todos)[\\/]`,
    String.raw`[\\/]nmsw[\\/](?:engine|hooks|test|scripts|vendor)[\\/]`,
    String.raw`[\\/]\.(?:codex|agents|gemini)[\\/]`,
    String.raw`[\\/](?:CLAUDE|AGENTS|GEMINI)\.md$`,
    String.raw`[\\/](?:node_modules|dist|build|\.next|out)[\\/]`,
    String.raw`\.(?:test|spec)\.`,
    String.raw`[\\/]tests?[\\/]`,
  ].join('|'),
);
const HANGUL = /[가-힣]/;
// 직접 인용은 판정에서 뺀다(im-not-ai v2.4.1 과 같은 원칙)
const QUOTES_ALL = /「[^」\n]{0,120}」|『[^』\n]{0,120}』|“[^”\n]{0,120}”|"[^"\n]{0,120}"/g;
const QUOTES_TYPO = /「[^」\n]{0,120}」|『[^』\n]{0,120}』|“[^”\n]{0,120}”/g;
const SENTENCE_SPLIT = /(?<=[.!?。])\s+|\n/;
// 면제 표시는 한 줄을 단독으로 차지할 때만 인정(설명 문장 속 언급으로 우연히 면제되지 않게)
const OFF_LINE = /^[ \t]*(?:<!--|#|\/\/|\/\*|\*)?[ \t]*slop-gate:[ \t]*off\b/m;

const LEXICON_PATHS = [
  process.env.NMSW_LEXICON,
  path.join(os.homedir(), '.claude/vendor/im-not-ai/skills/humanize-korean/references/lexicon.json'),
  path.join(__dirname, '..', 'vendor', 'im-not-ai-lexicon.json'), // vendor 가 없는 기기용 사본
].filter(Boolean);
const LEXICON_WINDOW = 12; // im-not-ai lexical_layer.py EXCLUDE_WINDOW 와 같은 규약
const LEXICON_MAX_LINES = 8;
// 사람 글(저자 스레드 글)에서 0건이고 AI 글에서 걸린 restore 항목만 🔴 로 올린다. 근거: README 「오탐 실측」
const LEXICON_S1 = new Set(require('./lexicon-s1.json'));

let lexCache;
let lexSource = null;
let lexBroken = 0;
function loadLexicon() {
  if (lexCache !== undefined) return lexCache;
  lexCache = null;
  for (const p of LEXICON_PATHS) {
    let lex;
    try {
      lex = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      continue;
    }
    const entries = [];
    for (const e of lex.entries || []) {
      try {
        const detect = e.regex_detect || e.regex;
        const exclude = e.regex_detect ? e.regex_detect_exclude : e.regex_exclude;
        entries.push({
          id: e.id,
          headword: e.headword,
          restore: !!e.restore,
          skip: e.skip_genres || [],
          re: new RegExp(detect, 'gu'),
          ex: exclude ? new RegExp(exclude, 'u') : null,
          how: (e.how && e.how['일반']) || '',
          keep: (e.keep_when && e.keep_when['일반']) || '',
        });
      } catch {
        lexBroken += 1; // 항목 하나가 깨져도 나머지는 쓴다
      }
    }
    if (entries.length) {
      lexCache = entries;
      lexSource = p;
      break;
    }
  }
  return lexCache;
}

function shouldCheckPath(filePath) {
  if (!filePath || SKIP_PATH.test(filePath)) return false;
  const ext = path.extname(filePath).toLowerCase();
  return PROSE_EXTS.includes(ext) || CODE_EXTS.includes(ext);
}

function isOff(text) {
  return typeof text === 'string' && OFF_LINE.test(text);
}

// 코드 울타리: ``` 와 ~~~ 둘 다. 짝이 안 맞으면(Edit 조각) 마지막 울타리부터 끝까지를 코드로 본다
function stripFences(t) {
  const fence = /^[ \t]*(```|~~~)/;
  const lines = t.split('\n');
  const marks = lines.map((l, i) => (fence.test(l) ? i : -1)).filter((i) => i >= 0);
  const drop = new Set();
  for (let k = 0; k + 1 < marks.length; k += 2) for (let i = marks[k]; i <= marks[k + 1]; i += 1) drop.add(i);
  if (marks.length % 2 === 1) for (let i = marks[marks.length - 1]; i < lines.length; i += 1) drop.add(i);
  return lines.filter((_, i) => !drop.has(i)).join('\n');
}

// 한 줄에서 따옴표 밖의 줄 끝 주석(// 또는 #)을 자른다. URL 의 :// 는 주석이 아님
function stripLineComment(line, marker) {
  let q = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (q) {
      if (c === '\\') i += 1;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'" || c === '`') q = c;
    else if (marker === '//' && c === '/' && line[i + 1] === '/' && line[i - 1] !== ':') return line.slice(0, i);
    else if (marker === '#' && c === '#') return line.slice(0, i);
  }
  return line;
}

// 코드 파일: 화면에 나가는 글(문자열·JSX 글)만 뽑는다
function codeText(text, ext) {
  let t = text;
  if (ext === '.py') t = t.replace(/("""|''')[\s\S]*?\1/g, ' ');
  else t = t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');
  if (HTML_EXTS.includes(ext)) t = t.replace(/<!--[\s\S]*?-->/g, ' ');
  const marker = ext === '.py' ? '#' : '//';
  t = t
    .split('\n')
    .map((l) => stripLineComment(l, marker))
    .join('\n');
  const out = [];
  for (const m of t.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    const s = m[1] ?? m[2] ?? m[3];
    if (s && HANGUL.test(s)) out.push(s);
  }
  for (const m of t.matchAll(/>([^<>{}]*[가-힣][^<>{}]*)</g)) out.push(m[1].trim());
  return out.join('\n\n');
}

function prepare(text, ext) {
  let t = text;
  const isCode = CODE_EXTS.includes(ext);
  if (isCode) {
    t = codeText(t, ext);
  } else {
    t = stripFences(t).replace(/`[^`\n]*`/g, '');
    if (HTML_EXTS.includes(ext)) t = t.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
    if (ext === '.typ') t = t.replace(/^\s*\/\/.*$/gm, '');
    if (BLANK_SPLIT_EXTS.includes(ext)) t = t.replace(/^[ \t]*>.*$/gm, '').replace(QUOTES_ALL, ' ');
    else t = t.replace(QUOTES_TYPO, ' ');
  }
  const blank = isCode || BLANK_SPLIT_EXTS.includes(ext);
  const paras = (blank ? t.split(/\n\s*\n/) : t.split('\n'))
    .map((p) => p.split('\n').filter((l) => HANGUL.test(l)).join('\n'))
    .filter(Boolean);
  const sentences = paras.flatMap((p) => p.split(SENTENCE_SPLIT)).filter((s) => HANGUL.test(s));
  // all: 한글 없는 줄도 남긴 글(표지의 「2026.9.22.(화)」 한 줄 같은 날짜 검사용)
  return { paras, sentences, body: paras.join('\n'), all: t };
}

function sampleAt(where, index) {
  return where.slice(Math.max(0, index - 12), index + 18).replace(/\n/g, ' ').trim();
}

// 제외 정규식이 있는 규칙은 매치 앞뒤 12자 창에 제외 낱말이 있으면 세지 않는다(글자 그대로 쓴 말)
function countIn(unit, re, exclude) {
  re.lastIndex = 0;
  if (!exclude) {
    const f = unit.match(re);
    re.lastIndex = 0;
    return f ? { n: f.length, first: unit.search(re) } : { n: 0, first: -1 };
  }
  let n = 0;
  let first = -1;
  for (const m of unit.matchAll(re)) {
    const win = unit.slice(Math.max(0, m.index - LEXICON_WINDOW), m.index + m[0].length + LEXICON_WINDOW);
    if (exclude.test(win)) continue;
    n += 1;
    if (first < 0) first = m.index;
  }
  re.lastIndex = 0;
  return { n, first };
}

function checkRules(prep, tiers, rules = ALL_RULES) {
  const hits = [];
  for (const [re, name, fix, tier, min = 1, scope, exclude] of rules) {
    if (!tiers.includes(tier)) continue;
    let best = { n: 0, first: -1 };
    let where = prep.body;
    if (scope === 'p' || scope === 's') {
      for (const unit of scope === 'p' ? prep.paras : prep.sentences) {
        const c = countIn(unit, re, exclude);
        if (c.n > best.n) [best, where] = [c, unit];
      }
    } else {
      best = countIn(prep.body, re, exclude);
    }
    // '남발' 규칙은 글이 길면 문턱도 올린다(1,500자마다 1건 허용). 문단·문장 규칙은 그대로
    const need = min > 1 && !scope ? Math.max(min, Math.ceil(prep.body.length / 1500)) : min;
    if (best.n < need) continue;
    const unit = scope === 'p' ? '한 문단 ' : scope === 's' ? '한 문장 ' : '';
    hits.push({ tier, name, count: `${unit}${best.n}건`, sample: sampleAt(where, Math.max(0, best.first)), fix });
  }
  return hits;
}

function checkLexicon(prep, tiers, genre) {
  const lex = loadLexicon();
  if (!lex) return [];
  const hits = [];
  for (const e of lex) {
    if (e.skip.includes(genre)) continue;
    const tier = LEXICON_S1.has(e.id) ? 1 : 2;
    if (!tiers.includes(tier)) continue;
    const { n, first } = countIn(prep.body, e.re, e.ex);
    if (!n) continue;
    const keep = e.keep ? ` (둘 때: ${e.keep.slice(0, 50)})` : '';
    hits.push({
      tier,
      name: `어휘 「${e.headword}」`,
      count: `${n}건`,
      sample: sampleAt(prep.body, first),
      fix: `${e.how.slice(0, 70)}${keep}`,
      lexicon: e.id,
    });
  }
  return hits;
}

/**
 * @param {string} text
 * @param {{ext?: string, tiers?: number[], lexicon?: boolean, genre?: string}} [opts]
 * @returns {{tier:number,name:string,count:string,sample:string,fix:string,lexicon?:string}[]}
 */
function check(text, opts = {}) {
  const ext = (opts.ext || '.md').toLowerCase();
  const tiers = opts.tiers || [1, 2];
  if (typeof text !== 'string' || !HANGUL.test(text) || isOff(text)) return [];
  const prep = prepare(text, ext);
  if (!prep.paras.length) return [];
  const hits = checkRules(prep, tiers);
  if (isGongmun(text)) hits.push(...checkRules({ ...prep, body: prep.all }, tiers, FORM_RULES));
  // 사전 장르: 문서 파일은 보고서(비유 낱말 23개는 보고서·논문에서만 검사), 답변·코드 화면 문구는 일반
  const genre = opts.genre || (PROSE_EXTS.includes(ext) ? '보고서' : '일반');
  if (opts.lexicon !== false) hits.push(...checkLexicon(prep, tiers, genre));
  return hits.sort((a, b) => a.tier - b.tier);
}

function formatHits(hits) {
  const rules = hits.filter((h) => !h.lexicon);
  const lex = hits.filter((h) => h.lexicon);
  const shown = [...rules, ...lex.slice(0, LEXICON_MAX_LINES)];
  const lines = shown.map((h) => `${h.tier === 1 ? '🔴' : '🟡'} ${h.name} ${h.count} · "${h.sample}" → ${h.fix}`);
  if (lex.length > LEXICON_MAX_LINES) lines.push(`🟡 어휘 사전 항목 ${lex.length - LEXICON_MAX_LINES}종 더`);
  return lines;
}

module.exports = {
  check,
  formatHits,
  shouldCheckPath,
  isOff,
  loadLexicon,
  lexiconSource: () => (loadLexicon(), lexSource),
  lexiconBroken: () => (loadLexicon(), lexBroken),
  PROSE_EXTS,
  CODE_EXTS,
  SKIP_PATH,
  LEXICON_S1,
};
