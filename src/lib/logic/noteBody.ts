/**
 * Compass — ノート本文の記法（`sections[].text` → 行 / 表 / 余白）
 *
 * 本文は「教科書の文章」ではなく**まとめノートの紙面**なので、テキストのままでは
 * 足りないものが 3 つある（spec §3.10）。ここはその 3 つだけを読む純ロジック。
 *
 *  1. **ぶら下げ** … 「アニミズム … 事物に霊が宿るとする考え方」の下に
 *     「= anima（ラテン語で霊魂）」がぶら下がる形。行頭の空白 2 つで 1 段下げる（2 段まで）。
 *  2. **表** … 対応・分類・比較。行頭 `|` の Markdown 表 1 種類だけを読む。
 *  3. **余白** … 空行。話題の変わり目に空きが要る。以前は `filter(Boolean)` で
 *     捨てていたので、どれだけ空けても紙面は詰まったままだった。
 *
 * 記法を増やさないこと。ここは**手書きノートの再現**であって Markdown ではない。
 * 太字・リンク・見出し記法は読まない（`#` も `*` もただの文字として出る）。
 *
 * 純ロジック。React / DOM を import しない。
 */

/** 本文 1 行 */
export interface NoteBodyLine {
  /** 行の中身。行頭の字下げは落としてある（記号はそのまま残す） */
  text: string;
  /** ぶら下げの深さ。0 = 親の行、1〜2 = その説明 */
  depth: number;
  /** 行頭に「・」を打つか。すでに記号で始まる行・ぶら下げの行には打たない */
  bullet: boolean;
}

export type NoteBodyBlock =
  /** 連なった行（箇条書き） */
  | { kind: 'lines'; lines: NoteBodyLine[] }
  /** 表。`head` は見出し行（`| --- |` が無ければ null） */
  | { kind: 'table'; head: readonly string[] | null; rows: readonly (readonly string[])[] }
  /** 空行 1 つぶんの余白 */
  | { kind: 'gap' }
  /** 解釈をあきらめて丸ごと描く（複数行にまたがる `$$…$$` があるとき） */
  | { kind: 'raw'; text: string };

/** ぶら下げの最大段。3 段目からは紙面が右へ流れるだけで読めない */
const DEPTH_MAX = 2;

/**
 * 行頭にすでに記号があるか。あるなら「・」を重ねない。
 * ノートの `○` `→` `= ` `① ` `- ` などは、生徒が打った記号そのもの。
 */
const MARKED_RE =
  /^(?:[○◯●◎◇◆■□▪▸▶△▲・･\-–—ー=＝+＋*＊※→⇒⇔↔←↑↓□☆★]|[①-⑳]|[ⅰ-ⅹ]|\(?[0-9０-９]{1,2}[.)．）、]|[a-zａ-ｚ][.)．）])\s*/;

/** 表の行か（`| a | b |`）。区切りは半角 `|` だけ */
function isTableLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith('|') && (t.match(/\|/g) || []).length >= 2;
}

/** `| --- | :--: |` のような区切り行 */
function isDividerRow(cells: readonly string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.trim()));
}

/** 1 行を升目に割る。両端の空セルは落とす */
function splitRow(line: string): string[] {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return t.split('|').map((c) => c.trim());
}

/**
 * 行頭の字下げを測る。全角空白は 2、タブは 4 と数える。
 * 2 で 1 段（`  = anima` で 1 段下がる）。
 */
function depthOf(line: string): number {
  const lead = /^[\s　]*/.exec(line)?.[0] ?? '';
  let w = 0;
  for (const ch of lead) w += ch === '　' ? 2 : ch === '\t' ? 4 : 1;
  return Math.min(DEPTH_MAX, Math.floor(w / 2));
}

/**
 * 複数行にまたがる `$$…$$` があるか。あるときは行に割ると数式が壊れるので、
 * 解釈をあきらめて丸ごと `NoteMath` に渡す（v0.15 までと同じ振る舞い）。
 */
function hasMultilineMath(lines: readonly string[]): boolean {
  return lines.some((l) => ((l.match(/\$\$/g) || []).length) % 2 === 1);
}

/**
 * 本文を紙面の単位（行のかたまり / 表 / 余白）に割る。
 *
 * 空行は `gap` として**残す**（連続した空行は 1 つに畳む）。行が 1 本も無ければ空配列。
 */
export function parseNoteBody(text: string): NoteBodyBlock[] {
  const src = (text || '').replace(/\r\n?/g, '\n');
  if (!src.trim()) return [];
  const raw = src.split('\n');
  if (hasMultilineMath(raw)) return [{ kind: 'raw', text: src }];

  const out: NoteBodyBlock[] = [];
  let i = 0;
  while (i < raw.length) {
    const line = raw[i];

    // 空行 → 余白。連続していても 1 つぶん（何行空けても紙面は 1 行ぶん空く）
    if (!line.trim()) {
      while (i < raw.length && !raw[i].trim()) i++;
      if (out.length) out.push({ kind: 'gap' });
      continue;
    }

    // 表 … `|` で始まる行が 2 行以上続いたとき。1 行だけなら普通の行として出す
    if (isTableLine(line) && i + 1 < raw.length && isTableLine(raw[i + 1])) {
      const rows: string[][] = [];
      let head: string[] | null = null;
      while (i < raw.length && isTableLine(raw[i])) {
        const cells = splitRow(raw[i]);
        if (isDividerRow(cells)) {
          // 区切り行より上が見出し。2 本目以降の区切り行は黙って捨てる
          if (head === null && rows.length) head = rows.shift() as string[];
        } else {
          rows.push(cells);
        }
        i++;
      }
      if (head || rows.length) out.push({ kind: 'table', head, rows });
      continue;
    }

    // それ以外 … 次の空行・表までを 1 かたまりの行として集める
    const lines: NoteBodyLine[] = [];
    while (i < raw.length && raw[i].trim() && !(isTableLine(raw[i]) && isTableLine(raw[i + 1] ?? ''))) {
      const depth = depthOf(raw[i]);
      const body = raw[i].trim();
      lines.push({ text: body, depth, bullet: depth === 0 && !MARKED_RE.test(body) });
      i++;
    }
    if (lines.length) out.push({ kind: 'lines', lines });
  }

  // 末尾の余白は落とす（区画の下は `.nb-cornell` の row-gap が持つ）
  while (out.length && out[out.length - 1].kind === 'gap') out.pop();
  return out;
}
