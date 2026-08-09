'use client';

/**
 * Compass — 外部 AI へ渡すプロンプト（docs/notebook/spec.md §7）
 *
 * ワークフローの手順 2。**1 本のプロンプトで完結する**（v0.10.1 で 2 段構成をやめた）。
 * 文字起こしとノート / スライドの画像をまとめて渡し、`compass-note@1` の JSON を直接受け取る。
 *
 * 2 段（Markdown 下書き → JSON 変換）をやめた理由:
 *  - 1 段目の要約で板書の数式や細部が落ち、2 段目が「無い情報から JSON を作る」ことになっていた
 *  - 画像を見られるのは 1 段目だけなので、2 段目は元資料を参照できない
 *  - ユーザーの手数が倍で、途中の Markdown を貼り忘れる事故が起きやすい
 *
 * **spec §7 と 1 文字も違えないこと**（仕様書が正典。ここはコピー元）。
 *
 * `String.raw` を使っているのは、JSON の記入例に出てくる `\\dfrac` のような
 * **バックスラッシュ 2 個をそのまま**プロンプトに載せるため（LaTeX の JSON エスケープの見本）。
 * この文字列にバックティックを入れないこと（String.raw では素直にエスケープできない）。
 */

/** GPT に渡す唯一のプロンプト（文字起こし + 画像 → compass-note@1 JSON） */
export const NOTE_PROMPT = String.raw`あなたは高校生の学習ノート作成アシスタントです。
これから渡す「授業の録音の文字起こし」と「その授業のノート／板書／授業スライドの画像」を読み、
復習アプリ取り込み用の JSON を 1 個だけ出力してください。

# 出力の形式（厳守）
- 出力は JSON オブジェクトそのものだけ。前置き・後書き・見出し・コードブロックは書かない。
- 最初の文字は { で、最後の文字は } にする。
- 全体を 1 個のオブジェクトにする（配列で包まない）。

# スキーマ
{
  "schema": "compass-note@1",
  "date": "YYYY-MM-DD",
  "subject": "数学|英語|国語|理科|社会|その他",
  "unit": "単元名",
  "recall": [
    { "q": "想起問題", "a": "解答", "guide": "方針(任意)", "src": "出典(任意)" }
  ],
  "blocks": [
    { "t": "def", "title": "見出し", "body": "本文" },
    { "t": "ex", "qi": 0, "guide": "方針", "solution": "解答", "caution": "注意" }
  ],
  "exercise": { "q": "演習問題1問", "a": "解答" },
  "doubt": "疑問点",
  "notice": "連絡事項"
}

# 各項目の作り方
- date … 授業の日付。資料から読めなければ空文字 "" にする（アプリ側で今日の日付になる）。
- subject … 6 つの候補から 1 つ選ぶ。
- unit … その授業 1 回分を一言で表す単元名。長い説明にしない。
- recall … **この JSON の主役**。授業の核心を自力で思い出すための問題を 3〜5 個（最大 8 個）。
  - 「〜とは何か」「〜を導け」「〜の条件は何か」「なぜ〜になるか」型にする。
  - 単語の穴埋め・○×問題にしない。答えが 1 行で言い切れる粒度にする。
  - q は問題文だけ。a に解答、guide に「どう考えるか」を 1〜2 文で書く。
  - src は出典（スライド p.4 / 教科書 p.72 / 板書 など）。分からなければ空文字 ""。
- blocks … 解説欄。
  - 定義・公式・要点は { "t": "def" } に。授業で出た定義は省略せず全部入れる。
  - 例題は { "t": "ex" } に。qi は対応する recall の番号（**0 から数える**）。
    対応する想起問題が無い例題は qi を null にする。
  - solution は板書の解答を優先し、論理の飛躍があれば補う。caution はミスしやすい点。
- exercise … 授業の仕上げに解く 1 問。適切な問題が無ければ recall を発展させて作る。
- doubt … 生徒が聞き返した点・曖昧なまま進んだ点。無ければ空文字 ""。
- notice … 提出物・小テスト・試験範囲などの事務連絡。無ければ空文字 ""。

# 数式の書き方（重要）
- 行内の数式は $...$、独立した行の数式は $$...$$ で囲む（LaTeX）。
- **JSON の文字列なので、LaTeX のバックスラッシュは 2 個重ねる。**
  - 正しい: "a": "$S_n=\\dfrac{a(r^n-1)}{r-1}$"
  - 誤り:   "a": "$S_n=\dfrac{a(r^n-1)}{r-1}$"
- 改行は \n と書く（実際の改行を文字列の中に入れない）。
- 板書の数式は省略せずすべて LaTeX に起こす。画像が読めない部分は推測で書かず、
  読めた範囲だけを書く。

# 内容の規則
- 文字起こしと画像に書いてあることに忠実に。推測で補った箇所は文末に「(推定)」と付ける。
- 雑談・脱線・出席確認は書かない。
- 画像に写っている図やグラフは、言葉で説明できる範囲で本文に書く。

# 記入例（形式の見本。この内容は真似しない）
{
  "schema": "compass-note@1",
  "date": "2026-05-14",
  "subject": "数学",
  "unit": "数列 ─ 漸化式と一般項",
  "recall": [
    {
      "q": "等差数列(初項 $a$、公差 $d$)の一般項 $a_n$ は？",
      "a": "$a_n=a+(n-1)d$",
      "guide": "初項に公差 $d$ を $(n-1)$ 回加える。",
      "src": "スライド p.4"
    },
    {
      "q": "等比数列の和 $S_n$($r\\ne 1$)の公式は？",
      "a": "$S_n=\\dfrac{a(r^n-1)}{r-1}$",
      "guide": "$S_n-rS_n$ を作って項を打ち消す。",
      "src": "教科書 p.78"
    },
    {
      "q": "数列 $\\{a_n\\}$ の階差数列を $\\{b_n\\}$ とするとき、$n\\ge 2$ で $a_n$ を表す式は？",
      "a": "$a_n=a_1+\\displaystyle\\sum_{k=1}^{n-1}b_k$($n=1$ は別に確認する)",
      "guide": "$a_1$ に階差を $n-1$ 個積み上げる。",
      "src": ""
    }
  ],
  "blocks": [
    {
      "t": "def",
      "title": "漸化式",
      "body": "数列の隣り合う項の間に成り立つ関係式。基本 3 型に帰着させる。\n・$a_{n+1}=a_n+d$ → 公差 $d$ の等差数列\n・$a_{n+1}=ra_n$ → 公比 $r$ の等比数列\n・$a_{n+1}=a_n+f(n)$ → 階差数列が $f(n)$"
    },
    {
      "t": "ex",
      "qi": 0,
      "guide": "第 $n$ 項までに公差が加わる回数を数える。",
      "solution": "初項 $a$ から第 $n$ 項までに $d$ は $(n-1)$ 回加わるから\n$$a_n=a+(n-1)d$$",
      "caution": "$n$ 回ではなく $(n-1)$ 回。$a_n=a+nd$ と書くミスが多い。"
    }
  ],
  "exercise": {
    "q": "$a_1=2,\\ a_{n+1}=a_n+3^n$ で定まる数列の一般項を求めよ。",
    "a": "$n\\ge 2$ のとき $a_n=2+\\displaystyle\\sum_{k=1}^{n-1}3^k=\\dfrac{3^n+1}{2}$。$n=1$ でも成立。"
  },
  "doubt": "特性方程式を使う型との見分け方が曖昧だった。",
  "notice": "・問題集 p.84〜86 を金曜提出\n・来週火曜に小テスト"
}

# 出力する前の自己チェック
1. 最初が { で最後が } になっているか。コードブロックや説明文を付けていないか。
2. "schema" は "compass-note@1" になっているか。
3. recall は 3 個以上あり、どの q・a も空でないか。
4. LaTeX のバックスラッシュを 2 個重ねたか。
5. blocks の qi が recall の範囲内（0 から数えて）か。対応が無ければ null にしたか。
6. JSON.parse できる形か（末尾のカンマ・全角の引用符・コメントが無いか）。

--- ここから下に、文字起こしとノート／スライドの画像を貼ってください ---
`;

export interface PromptDef {
  id: 'main';
  label: string;
  hint: string;
  text: string;
}

/** 取り込みモーダルのステップ 1 に置く（プロンプトは 1 本だけ） */
export const NOTE_PROMPTS: readonly PromptDef[] = [
  {
    id: 'main',
    label: 'プロンプト',
    hint: '文字起こし + ノート/スライド画像 → 取り込み用JSON',
    text: NOTE_PROMPT,
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
