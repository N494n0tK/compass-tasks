'use client';

/**
 * Compass — 外部 AI へ渡すプロンプト（docs/notebook/spec.md §7）
 *
 * ワークフローの手順 2「文字起こし → プロンプトA → プロンプトB → JSON」で使う。
 * **spec §7 と 1 文字も違えないこと**（仕様書が正典。ここはコピー元）。
 */

/** プロンプトA — 文字起こし + 板書写真 → 構造化 Markdown */
export const NOTE_PROMPT_A = `あなたは高校生の学習ノート作成アシスタントです。入力(授業の録音文字起こしと板書・ノートの写真)から、
復習用ノートの下書きを Markdown で作成してください。

出力構成(見出しを厳守):

## 基本情報
- 日付: YYYY-MM-DD
- 教科: 数学|英語|国語|理科|社会|その他
- 単元: (簡潔な単元名)

## 定義・要点
授業で導入された定義・公式・要点。数式は $...$(行内) / $$...$$(別行) の LaTeX で書く。

## 例題
例題ごとに「問題文 / 方針 / 解答 / 注意点(ミスしやすい点)」の4項目を書く。
板書の解答を優先し、論理の飛躍があれば補う。

## 疑問点
生徒が聞き返した点・曖昧なまま進んだ点。無ければ「なし」。

## 連絡事項
提出物・小テスト・試験範囲などの事務連絡。無ければ「なし」。

規則:
1. 事実は入力に忠実に書く。推測で補った箇所は文末に「(推定)」と付ける。
2. 雑談・脱線は書かない。
3. 板書の数式は省略せずすべて LaTeX に起こす。`;

/** プロンプトB — Markdown → `compass-note@1` JSON */
export const NOTE_PROMPT_B = `以下の授業ノート(Markdown)を、学習アプリ取り込み用の JSON に変換してください。
出力は JSON オブジェクトのみ。コードフェンス・前置き・後書きは禁止。

スキーマ compass-note@1:
{
  "schema": "compass-note@1",
  "date": "YYYY-MM-DD",
  "subject": "数学|英語|国語|理科|社会|その他",
  "unit": "単元名",
  "recall": [{"q": "想起問題", "a": "解答", "guide": "方針(任意)", "src": "出典(任意)"}],
  "blocks": [
    {"t": "def", "title": "見出し", "body": "本文"},
    {"t": "ex", "qi": 0, "guide": "方針", "solution": "解答", "caution": "注意"}
  ],
  "exercise": {"q": "演習問題1問", "a": "解答"},
  "doubt": "疑問点",
  "notice": "連絡事項"
}

規則:
1. recall は授業内容の核心を自力で思い出させる想起問題を 3〜5 個つくる
   (「〜とは何か」「〜を導け」型にする。単語の穴埋めにはしない)。最大 8 個。
2. 数式は $...$ / $$...$$ の LaTeX。バックスラッシュは JSON 文字列としてエスケープする
   (例: "\\\\dfrac{a}{b}")。
3. 例題は blocks の {"t":"ex"} にし、対応する recall の番号(0 始まり)を qi に入れる。
   対応する想起問題が無ければ qi は null。
4. exercise は授業の仕上げに解く 1 問。適切な問題が無ければ recall から発展させて作る。
5. 「なし」の項目は空文字 "" にする。

--- ここから下に、プロンプトAの出力(Markdown)を貼る ---
`;

export interface PromptDef {
  id: 'a' | 'b';
  label: string;
  hint: string;
  text: string;
}

/** 取り込みモーダルのステップ 1・2 に並べる */
export const NOTE_PROMPTS: readonly PromptDef[] = [
  {
    id: 'a',
    label: 'プロンプトA をコピー',
    hint: '文字起こし + 板書写真 → 構造化Markdown',
    text: NOTE_PROMPT_A,
  },
  {
    id: 'b',
    label: 'プロンプトB をコピー',
    hint: 'Markdown → 取り込み用JSON',
    text: NOTE_PROMPT_B,
  },
];

/**
 * クリップボードへコピーする。`navigator.clipboard` が使えない環境
 * （非 https・古い WebView）では `execCommand` へ落ちる。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 下のフォールバックへ */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
