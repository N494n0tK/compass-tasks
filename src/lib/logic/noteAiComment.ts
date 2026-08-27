/**
 * Compass — AI の添削を「コードのコメント」に割る（`sections[].ai` → 行 / 調子）
 *
 * 紙面での役目は変わらない（spec §3.8）―― AI の赤入れは自分の手書きの直後に重なる。
 * 変えたのは**見た目の比喩**で、v0.17 から「紫の引用ブロック」をやめ、
 * `// 〜〜〜` の**行コメント**として出す。理由:
 *
 *  - 引用ブロックは面（淡い紫地 + 左罫）を持つので、本文より**強い**。
 *    主役は自分のノート（`text`）なのに、添削のほうが紙面で目立っていた。
 *    コメントは面を持たず、地の墨より一段弱い灰なので、順位が正しくなる。
 *  - `//` は「ここから先は本文ではない」を**1 文字も読ませずに**伝える記号。
 *    書体（等幅）と合わせて、読む前に著者が分かる（NoteView 冒頭の 3 つの約束）。
 *  - 全部が紫だと「どこが大事か」が出せない。地を灰に落とすと、
 *    **色を乗せた行・語だけ**が重要点として立つ。本人の要望はここ。
 *
 * このファイルは**行に割って調子を決めるだけ**の純ロジック。React / DOM / katex を
 * import しない（描画は `components/parts/NoteAiComment.tsx`）。
 *
 * 数式について: `$…$` / `$$…$$` の中は**一切触らない**。中の `**` や `【】` は
 * 記号として読まず、手がかり語の検索対象からも外す。数式は最終的に `NoteMath` が
 * そのまま受け取る前提なので、ここで文字を落とすと TeX が壊れる。
 */

/**
 * 行の調子。**色数を増やさないための 3 段**（ux-refresh.md §1「インクは数色」）。
 *
 *  note … 既定。灰。ふつうの補足。添削の 8 割はここ
 *  term … 手がかり・用語の言い換え。**色は付けず、灰を一段明るくするだけ**
 *  warn … 誤りの訂正・注意・重要。ここだけ AI のインク（`--nb-ai-ink`）が乗る
 *
 * `term` に新しい色を割り当てなかったのは、本文にはすでに重要語の 3 色
 * （red / blue / green。`NOTE_KEY_COLORS`）が乗っているから。そこへ AI の色を
 * 2 つ足すと 1 画面 5 色になり、「色が意味を運ぶ」という前提が崩れる
 * （5 色をやめた経緯は `model/notes.ts` の `NOTE_KEY_COLORS` にある）。
 * 段を作るのに色相ではなく**明るさ**を使えば、色は 1 つで足りる。
 */
export const NOTE_AI_TONES = ['note', 'term', 'warn'] as const;

export type NoteAiTone = (typeof NOTE_AI_TONES)[number];

/** 強さの順。行の調子と行内の印がぶつかったら**強いほうを採る** */
const TONE_RANK: Readonly<Record<NoteAiTone, number>> = { note: 0, term: 1, warn: 2 };

function stronger(a: NoteAiTone, b: NoteAiTone): NoteAiTone {
  return TONE_RANK[a] >= TONE_RANK[b] ? a : b;
}

/** コメント 1 行の中の、ひと続きの断片 */
export interface NoteAiSpan {
  /** 中身。`$…$` は素通し（`NoteMath` がそのまま読む） */
  text: string;
  /** この断片の調子。行の調子と同じか、それより強い */
  tone: NoteAiTone;
}

export type NoteAiBlock =
  /** コメント 1 行（`// …`） */
  | { kind: 'line'; tone: NoteAiTone; spans: NoteAiSpan[] }
  /** 空行 = 段の切れ目。紙面では中身の無い `//` を 1 本置く */
  | { kind: 'gap' };

/**
 * 訂正・注意へ倒す手がかり語。**ここ 1 か所にまとめる**（紙面と揃えるため）。
 *
 * 選び方は「spec が添削に書けと言っている型」から取った。§3.8 の指定は
 * (a) 誤りの訂正「ノートは○○だが**正しくは**××」 (b) ノートに無い重要点、の 2 つだけで、
 * (a) はほぼ必ずこの言い回しで来る。だから `正しくは` を筆頭に置いてある。
 *
 * 逆に、**当たりすぎる語は入れない**。`ではない` `違う` は否定文のたびに当たるし、
 * `ここ` `つまり` は補足の地の文にも出る。warn は 1 画面に 1 色しかない差し色を
 * 使う段なので、誤って倒すと紙面が紫だらけになって「重要」が消える。
 */
const WARN_WORDS: readonly string[] = [
  '正しくは', // spec §3.8 の訂正の定型文。いちばん確実な手がかり
  '誤り',
  '誤字',
  '間違', // 間違い / 間違え / 間違った をまとめて拾う
  '訂正',
  '注意',
  '重要',
  '必ず',
  '要点',
  'ポイント',
  '抜け', // 「ノートから抜けている」= 添削のもう一方の型（ノートに無い重要点）
  '書き落と',
];

/**
 * 手がかり・用語の言い換えへ倒す語。
 *
 * warn と違って**広めに取ってよい**。term は色を持たず灰の明るさが 1 段変わるだけなので、
 * 誤って倒しても紙面は壊れない（読みにくくもならない）。逆に取りこぼすと、
 * 用語の定義が地の補足に埋もれて拾えない。
 */
const TERM_WORDS: readonly string[] = ['とは', 'すなわち', '言い換え', '別名', 'の略', '意味は'];

/**
 * 行頭の印。`!` `※` `⚠` `×` は本人・AI とも「ここを見ろ」の合図として打つ。
 * **印そのものは落とさない** ―― なぜ色が付いたのかが読めなくなるので、記号は残す。
 */
const WARN_HEAD_RE = /^[!！※⚠×✗]/;

/** 行頭の `=` は「= anima（ラテン語で霊魂）」のような言い換え（`noteBody.ts` の記号と同じ流儀） */
const TERM_HEAD_RE = /^[=＝]/;

/**
 * 行内の強調。`**…**` の中だけを warn にする。
 *
 * **行ごと倒さない**のがここの判断。本人の要望は「重要な語の時は色つけて」であって
 * 「重要な行を塗れ」ではないし、2〜3 行しかない添削で 1 行まるごと色が乗ると、
 * 差し色 1 色の原則（ux-refresh.md §1）を紙面の中で使い切ってしまう。
 * 記号 `**` は**落とす**（Markdown の装飾記号で、読む字ではない）。
 */
const BOLD_RE = /\*\*([^*\n]+?)\*\*/g;

/**
 * 行内の見出し語。`【自由電子】金属の中を動ける電子` の `【…】` を term にする。
 * 記号 `【】` は**残す**（本文の記号として意味があり、落とすと語の切れ目が消える）。
 */
const BRACKET_RE = /【[^】\n]*】/g;

/**
 * 数式。`NoteMath.tsx` の `MATH_RE` と**同じ形でなければならない**
 * （描画側と食い違うと、ここで素通しにした範囲が数式として読まれない）。
 * import で共有しないのは、あちらが 'use client' + katex を抱えているため。
 */
const MATH_RE = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;

/** その行の各文字が数式の中かどうか。手がかり語の検索と記号の解釈から外す目印 */
function mathMaskOf(line: string): boolean[] {
  const mask = new Array<boolean>(line.length).fill(false);
  MATH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MATH_RE.exec(line))) {
    for (let i = m.index; i < m.index + m[0].length; i++) mask[i] = true;
  }
  return mask;
}

/** 数式を抜いた素の文字だけ（手がかり語はここでしか探さない） */
function outsideMath(line: string, mask: readonly boolean[]): string {
  let out = '';
  for (let i = 0; i < line.length; i++) if (!mask[i]) out += line[i];
  return out;
}

/**
 * 別行立ての数式が行をまたいでいるぶんを 1 行に畳む。
 *
 * `$$` の数が奇数の行は「開いたまま終わった行」なので、閉じる行までを 1 本にする。
 * `noteBody.ts` は同じ状況で解釈をあきらめて `raw` を返すが、こちらは
 * **1 行 = 1 コメント行**という並びを崩したくないので、畳んで 1 行として扱う。
 */
function joinDisplayMath(lines: readonly string[]): string[] {
  const odd = (s: string) => ((s.match(/\$\$/g) || []).length) % 2 === 1;
  const out: string[] = [];
  let buf: string[] | null = null;
  for (const line of lines) {
    if (buf) {
      buf.push(line);
      if (odd(line)) {
        out.push(buf.join('\n'));
        buf = null;
      }
      continue;
    }
    if (odd(line)) buf = [line];
    else out.push(line);
  }
  // 閉じないまま終わったら、そのまま出す（`NoteMath` 側が壊れた TeX として表示する）
  if (buf) out.push(buf.join('\n'));
  return out;
}

/** 行そのものの調子。行内の印（`**` `【】`）はここでは見ない */
function toneOfLine(bare: string): NoteAiTone {
  const head = bare.trimStart();
  if (WARN_HEAD_RE.test(head)) return 'warn';
  if (WARN_WORDS.some((w) => bare.includes(w))) return 'warn';
  if (TERM_HEAD_RE.test(head)) return 'term';
  if (TERM_WORDS.some((w) => bare.includes(w))) return 'term';
  return 'note';
}

/**
 * 1 行を断片に割る。
 *
 * 文字ごとに調子を決めてから、同じ調子が続くところをまとめる ―― こうしておくと
 * `**式は $x^2$ だ**` のように**強調が数式をまたぐ**場合も自然に通る
 * （数式の中の文字は素通しのまま、外側の調子だけが乗る）。
 */
function spansOf(line: string, mask: readonly boolean[], base: NoteAiTone): NoteAiSpan[] {
  const tone = new Array<NoteAiTone>(line.length).fill(base);
  /** 記号として落とす文字（`**` の 4 文字だけ） */
  const drop = new Array<boolean>(line.length).fill(false);

  const paint = (from: number, to: number, t: NoteAiTone) => {
    for (let i = from; i < to; i++) tone[i] = stronger(tone[i], t);
  };
  /** 印の両端が数式の中に食い込んでいたら、記号として読まない（数式を壊さない） */
  const outside = (from: number, to: number) => !mask[from] && !mask[to - 1];

  BOLD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BOLD_RE.exec(line))) {
    const s = m.index;
    const e = s + m[0].length;
    if (!outside(s, e)) continue;
    drop[s] = drop[s + 1] = drop[e - 2] = drop[e - 1] = true;
    paint(s + 2, e - 2, 'warn');
  }

  BRACKET_RE.lastIndex = 0;
  while ((m = BRACKET_RE.exec(line))) {
    const s = m.index;
    const e = s + m[0].length;
    if (!outside(s, e)) continue;
    paint(s, e, 'term');
  }

  const out: NoteAiSpan[] = [];
  for (let i = 0; i < line.length; i++) {
    if (drop[i]) continue;
    const last = out[out.length - 1];
    // 落とした記号をまたいでも、調子が同じなら 1 つの断片に繋げる
    if (last && last.tone === tone[i]) last.text += line[i];
    else out.push({ text: line[i], tone: tone[i] });
  }
  return out;
}

/**
 * AI の添削を 1 行ずつのコメントに割る。
 *
 * 空行は `gap` として**残す**（連続していても 1 つぶん）。前後の空行は落とす。
 * 中身が無ければ空配列 ―― 呼ぶ側は「添削なし」として何も出さない。
 */
export function parseNoteAiComment(src: string | null | undefined): NoteAiBlock[] {
  const text = (src || '').replace(/\r\n?/g, '\n');
  if (!text.trim()) return [];

  const raw = joinDisplayMath(text.split('\n'));
  const out: NoteAiBlock[] = [];
  for (const line of raw) {
    if (!line.trim()) {
      // 先頭の空行は捨てる。連続した空行は 1 つに畳む（何行空けても切れ目は 1 つ）
      if (out.length && out[out.length - 1].kind !== 'gap') out.push({ kind: 'gap' });
      continue;
    }
    const body = line.trim();
    const mask = mathMaskOf(body);
    const tone = toneOfLine(outsideMath(body, mask));
    out.push({ kind: 'line', tone, spans: spansOf(body, mask, tone) });
  }

  // 末尾の空行は落とす（区画の下の余白は `.nb-cornell` の row-gap が持つ）
  while (out.length && out[out.length - 1].kind === 'gap') out.pop();
  return out;
}
