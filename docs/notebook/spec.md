# チャートノート統合 仕様書（compass-note@1）

Compass-Tasks に「授業ノート ＋ 想起カードの間隔反復」を統合するための正典。
実装は本書のチェックリスト **N-001〜N-086** を全て満たすこと。

関連: [../rewrite/architecture.md](../rewrite/architecture.md) / [../rewrite/app-spec.md](../rewrite/app-spec.md) §6（復習）・§4.9（時間割）

---

## 1. 目的とワークフロー

`CompassNotebook/` の「チャートノート v2 / v3」（依存欠落で単体動作しない dc-html）を Next.js へ作り直し、
Compass の既存復習エンジンへ接続する。ユーザーが到達したい状態:

| # | 段階 | 担当 |
|---|---|---|
| 1 | 授業を録音し、ノート・スライドを写真に撮る | 自分 |
| 2 | 文字起こしと写真を **1 本のプロンプト**と一緒に AI に渡す → JSON | 外部AI |
| 3 | JSON を Compass に貼る。検証が通れば保存 | 自分（貼るだけ） |
| 4 | 貼ったその日の ToDo に、そのノートの復習が 1 枚積まれる | Compass |
| 5 | 「ノートで復習」→ その授業の問題だけのドリルで想起問題に答える | 自分 |
| 6 | 完了すると次の間隔へ送られる | Compass |
| 7 | 予習が時間割から自動で積まれる | Compass |

## 2. 用語

| 語 | 意味 |
|---|---|
| ノート（Note） | 授業1回分。`users/{uid}/notes/{noteId}` に1ドキュメント |
| カード（NoteCard） | ノート内の想起問題1問。復習の最小単位 |
| 系列（series） | 1カードに対応する復習の連なり。`seriesId` で束ねる |
| ブロック（NoteBlock） | 解説欄の要素。`def`（定義）か `ex`（問の解説） |
| 演習（exercise） | ノート末尾の仕上げ1問。**カードにはしない** |

---

## 3. データモデル

### 3.1 保存形（`src/lib/model/notes.ts`）

```ts
export const NOTE_SCHEMA = 'compass-note@1';

export type NoteCardOrigin = 'self' | 'ai';

export interface NoteCard {
  cardId: string;   // 'c' + base36。取り込み時に採番し、以後不変
  q: string;        // 問題文（$...$ / $$...$$ の LaTeX 可）
  a: string;        // 解答
  guide: string;    // 方針（空文字可）
  src: string;      // 出典（空文字可）
  origin: NoteCardOrigin;  // 'self' = 自分がノートに書いた問い
}

export const NOTE_KEY_COLORS = ['red','blue','green','orange','purple'] as const;
export type NoteKeyColor = (typeof NOTE_KEY_COLORS)[number];

export interface NoteKeyword {
  term: string;        // 本文に出てくる文字列と1文字も違えない
  color: NoteKeyColor;
  note: string;        // キュー欄に添えるひとこと（空文字可）
}

export type NoteBlock =
  | { t: 'def'; title: string; body: string }
  | { t: 'ex'; cardId: string | null; guide: string; solution: string; caution: string };

export interface Note {
  id: string;       // 'n' + base36 + rand。Firestore の doc id
  v: 1;
  date: ISODate;    // 授業日
  subject: string;
  unit: string;
  cards: NoteCard[];
  blocks: NoteBlock[];
  summary: string;         // コーネル式の下段。授業1回のまとめ
  keywords: NoteKeyword[]; // コーネル式の左段（キュー欄）に並ぶ重要語
  exercise: { q: string; a: string };
  doubt: string;           // 自分がノートに書いた疑問だけ。1行1件
  notice: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}
```

`cardId` を持つのが v2/v3 との唯一の本質的な差。旧実装は解説ブロックを `qi`（recall の配列インデックス）で
指しており、想起問題を1つ消すと全ての `qi` がズレる潜在バグがあった。取り込み時に `qi → cardId` へ解決する。

`summary` / `keywords` / `origin` は v0.12 で足した（§3.5 / §3.6）。**旧ノートには無い**ので、
`sanitizeNotes`（`NotebookPersistence.ts`）が既定値（`''` / `[]` / `'ai'`）を埋めて読む。移行スクリプトは要らない。

### 3.2 貼り付け JSON（外部AI が出力する形）

```json
{
  "schema": "compass-note@1",
  "date": "2026-08-06",
  "subject": "数学",
  "unit": "数列 ─ 漸化式と一般項",
  "recall": [{ "q": "…", "a": "…", "guide": "…", "src": "…", "origin": "self" }],
  "keywords": [{ "term": "漸化式", "color": "red", "note": "隣の項の関係式" }],
  "blocks": [
    { "t": "def", "title": "漸化式", "body": "…" },
    { "t": "ex", "qi": 0, "guide": "…", "solution": "…", "caution": "…" }
  ],
  "summary": "…",
  "exercise": { "q": "…", "a": "…" },
  "doubt": "…",
  "notice": "…"
}
```

### 3.3 バリデーション（`src/lib/logic/noteImport.ts`）

`parseNoteJson(text, { today, existing?, newId? })` →
`{ ok: true, note, warnings, diff? } | { ok: false, errors }`。
issue は `{ path: 'recall[2].a', message: '解答が空です' }`。**エラーが1件でもあれば保存しない。**

| path | 条件 | 種別 | メッセージ |
|---|---|---|---|
| `$` | `JSON.parse` 失敗 | error | `JSONとして読み取れません: <理由>` |
| `$` | 配列 / 非オブジェクト | error | `JSONのトップレベルはオブジェクトにしてください` |
| `$` | コードブロック / 前置きが付いている | warning | `コードブロックや前後の文章を取り除いてから読み込みました` |
| `schema` | 欠落・空 | warning | `schema が無いので "compass-note@1" として読み込みました` |
| `schema` | 別の値が入っている | error | `schema は "compass-note@1" にしてください（受信: …）` |
| `date` | `YYYY-MM-DD` でない（空文字を除く） | warning | `date の形式が不正なので今日の日付にしました` |
| `subject` | 空 | error | `教科を入力してください` |
| `subject` | `knownSubjects` に無い | warning | `教科「…」は時間割にありません（…）。ノートの「編集」から選び直せます` |
| `unit` | 空 | error | `単元名を入力してください` |
| `recall` | 配列でない / 0件 | error | `recall を1件以上入れてください` |
| `recall` | 8件超 | error | `recall は8件までです（受信: N件）` |
| `recall[i].q` | 空 | error | `問題文が空です` |
| `recall[i].a` | 空 | error | `解答が空です` |
| `blocks` | 配列でない | warning | `blocks を配列として読み取れないので空にしました` |
| `blocks[i].t` | `def`/`ex` 以外 | warning | `未知のブロック種別 "…" を無視しました` |
| `blocks[i].qi` | 範囲外 | warning | `qi=N は recall の範囲外なので未対応にしました` |
| `exercise` | 非オブジェクト | warning | `exercise を読み取れないので空にしました` |
| `recall[i].origin` | `"self"` 以外 | — | 黙って `'ai'` にする |
| `keywords` | 配列でない | warning | `keywords を配列として読み取れないので空にしました` |
| `keywords` | 24語超 | warning | `重要語は24語までなので、先頭から採用しました` |
| `keywords[i]` | 空 `term` / 重複 / 文字列以外 | — | 黙って落とす（文字列の配列でも読む） |
| `keywords[i].color` | 5色以外 | — | 黙って `'red'` にする |

`date` / `blocks` / `exercise` / `summary` / `keywords` / `doubt` / `notice` は欠落を warning 無しで既定値に落とす（`date` のみ形式不正時に warning）。
生成 AI の出力ゆらぎをどこまで飲むかは §7.3 にまとめてある。

### 3.4 上書き取り込み（`existing` あり）

`id` / `createdAt` を維持し、`cardId` は**インデックスで**既存カードに対応付ける。
差分 `{ keptCardIds, addedCardIds, removedCardIds }` を返し、呼び出し側が復習をカスケードする。

### 3.5 重要語とキュー欄（`src/lib/logic/noteKeywords.ts`）

コーネル式ノートの左段（キュー欄）にあたる。`keywords` を本文（`blocks`）に**部分文字列一致**で当て、

- 本文では色を塗る（`.nb-key--<color>`）
- キュー欄では「その語が**初めて出てくるブロック**」の行に並べる（`assignCues`）
- 確認モードでは本文側だけを付箋で伏せる（`.nb-key.is-hidden`）

の 3 つに使う。ひとつの語をキュー欄に出すのは 1 回だけ（2 回目以降の出現でも並べると左段が埋まる）。
一致は常に**長い語から**当てる（`splitByKeywords`）。日本語には語境界が無く、「革命」が
「産業革命」を食ってしまうため。本文に見つからない語は捨てずに `orphans` に落とし、
キュー欄の末尾にまとめて出す（編集モードでは赤枠で「本文に見当たりません」と告げる）。

色は 5 つだけ。意味を持たせるための制約で、プロンプトにも同じ対応表を書いてある。

| color | 意味 | テーマ変数 |
|---|---|---|
| `red` | 用語・定義 | `--pink` |
| `blue` | 人物・固有名詞 | `--blue` |
| `green` | 年号・数値 | `--grn` |
| `orange` | 因果・変化 | `--org` |
| `purple` | 対比・例外 | `--vio` |

明るい紙（`data-theme="light"`）では 5 色とも `color-mix` で 1 段沈める（[E-2] の注記。実測 6:1 以上）。

### 3.6 「自分のもの」と「AI のもの」

コーネル式は**問いを立てるのが自分**であることに意味がある。だから:

- `recall[i].origin === 'self'` … 生徒がノートに書いた問い。プロンプトは**1問も落とさず**拾い、先に並べる。
  紙面では「自作」の版を張る（AI 作は輪郭だけの「AI」）。編集画面から足した問いは常に `self`。
- `doubt` … 生徒がノートに書いた疑問**だけ**。プロンプトは「あなたが分かりにくいと思った点は書かない」と
  明示的に禁じる。該当が無ければ空文字のまま。紙面では 1 行 1 件の箇条書き（`.nb-doubt`）。
- `summary` … 自分の言葉での要約。AI が書く場合も想起問題の答えの寄せ集めにはしない（地の文 3〜5 行）。

### 3.7 教科は時間割の名前に揃える

`subject` の候補は**時間割（`logic/timetable.ts` の `timetableSubjects()`）から取る**。
固定の一覧（数学・英語・国語・理科・社会…）を持たない。

大分類を候補にしていたときは、AI が「社会」「理科」と答え、時間割の「歴総 / 地総 / 化基 / 生基」と
食い違っていた。教科名は**教科の色（`subjectColorFor`）と予習の突き合わせ（`prepAutogen`）の
つなぎ目**なので、ズレると両方が壊れる。

| どこ | どうする |
|---|---|
| プロンプト | `noteMainPrompt(subjects)` が一覧を埋め込み、「大分類は使わない」と明示。自己チェック 3 番 |
| 取り込み | `parseNoteJson(..., { knownSubjects })`。一覧に無ければ **warning**（エラーにはしない） |
| 紙面 | 一覧に無い教科には「時間割にない教科」の版を出す |
| 編集 | 教科チップが時間割の一覧 ＋ `その他`。いま付いている名前が一覧に無ければそれも残す（直せなくなるため） |

時間割に無い授業（補講・自習など）のノートも取れるべきなので、**エラーにはしない**。

---

## 4. ノート ↔ 復習の連携

**`Review` 型・`reviews.ts`・`dataPatch.ts` は一切変更しない。** リンクは `seriesId` の命名規約だけで表す:

```ts
noteSeriesId(noteId, cardId) === 'nb-' + noteId + '-' + cardId
noteRefOf(seriesId) → { noteId, cardId } | null    // /^nb-(n[0-9a-z]+)-(c[0-9a-z]+)$/
```

`nextReviewOf` は `seriesId: review.seriesId || review.id` を無条件で継承するので、
段階が進んでもリンクは切れない。カスタムフィールドを足す案は段階遷移で落ちるため採らない。

### 4.1 生成（`generateNoteReviews(note, existing, today)`）

カードごとに、同じ `seriesId` を持つ行が **1件も無いときだけ** 1件作る（再取り込みで増えない）。

**授業が終わってノートを貼ったら、その日のうちに復習する。** だから初回は `due` が今日で、
最初から今日の ToDo に積まれる（`added: true`）。段階は `'当日'` から始まる。

| フィールド | 値 |
|---|---|
| `id` / `seriesId` | `noteSeriesId(note.id, card.cardId)`（初回は一致。手動追加と同型） |
| `reviewNo` | `1` |
| `title` | `note.unit + ' 問' + (index + 1)` |
| `subj` | `note.subject` |
| `stage` / `last` / `due` | `'当日'` / `today` / `today` |
| `min` | `5`（XS） |
| `src` | `'ノートから生成'` |
| `timetablePeriod` / `timetableDate` | `null` / `null` |
| `added` / `done` | **`true`** / `false` |

はしごは **当日 → 翌日 → 3日後 → 1週間後 → 2週間後 → 定着** の 5 段。
`'当日'` は `lib/logic/reviews.ts` の `STAGE_NEXT` に 1 行足しただけで、既存の 4 段は不変
（手動追加・時間割からの復習は従来どおり `'翌日'` 始まり）。`'当日'` だけは
**まあまあ でも翌日へ送る**（据え置き = 「今日もう一度」は今日の ToDo と噛み合わないため）。

### 4.2 今日の ToDo では 1 冊 1 枚（`ShellTodayItems.collapseNoteReviews`）

想起問題ごとに独立した系列を持つ設計はそのままに、**今日の ToDo の見た目だけ**ノート単位に束ねる。

- タイトル … ノートの単元名（`note.unit`）
- 分数 … 束ねた行の合計、完了 … **全問終わって初めて完了**
- `src` … `'ノートの復習 · 2/3問'`（残り / 全体）
- カードをクリック or 「ノートで復習」 → **ドリル面**（§8）へ。1 問ずつ理解度モーダルは開かない
- `state.notes` にノートが無い（未読込・削除済み）行は束ねず、従来どおり 1 問 1 枚

束ねるのは `buildTodayItems` の 1 か所だけなので、トップバーのカウンタ・コックピット・
ToDo・集中モードがすべて同じ見え方になる。seg / extra / 手動の復習には一切触れない。

### 4.3 同期・カスケード

- `syncNoteReviews(note, reviews)` — カードを維持したままノートを編集したとき、**未完了行のみ** `title` / `subj` を更新
- `cascadeNoteRemoval(reviews, order, selId, noteId, cardIds?)` — **未完了行のみ削除**、`order` から除外、`selId` を null 化。
  完了行は学習履歴として残す（`studyLog` は既に書かれている）

---

## 5. 予習の自動生成（`src/lib/logic/prepAutogen.ts`）

- `nextSchoolDay(today)` — `today` より後の最小の月〜金。金→月、土→月、日→月
- 対象日の時間割 = `TIMETABLE[dowOf(target)]` に `dayOverrides[target]` を適用（`held === false` は休講で除外、`subj` は差し替え）
- **教科ごとに1件**（同じ教科が2コマあっても予習は1件。`timetablePeriod` は最初のコマ）
- `prepAutoGen.offSubjects` に入っている教科は除外
- `prepGenLog[target]` に記録済みのコマは再生成しない（**ユーザーが消したタスクを翌起動で復活させない**）
- ログは 14 日より古いキーを削除する

生成する `Extra`:

```ts
{ id: 'u'+base36+rand, title: subj + 'の予習', subj, size: 'S', min: 10,
  day: today, done: false, src: '予習 · ' + fmtMD(target) + ' ' + period + '限(自動)',
  timetablePeriod: period, timetableDate: target }
```

設定 `prepAutoGen: { enabled: boolean; offSubjects: string[] }`（既定 `{ enabled: true, offSubjects: [] }`）と
`prepGenLog: Record<ISODate, number[]>` を **`PERSISTENT_KEYS` の末尾に追記**する（並べ替え厳禁）。

トリガーはアプリ起動時、クラウド読込が終わって `cloudStatus` が `'loading'` を抜けた直後の1回だけ。

---

## 6. 永続化

| 置き場 | 内容 |
|---|---|
| `users/{uid}/notes/{noteId}` | ノート1件＝1ドキュメント（1MB 制限回避）。`firestore.rules` は `users/{uid}/{document=**}` なので変更不要 |
| localStorage `compass-notes` | ノート配列のミラー。起動時の即描画とオフライン表示用 |
| `state.notes`（ephemeral） | 実行時の正。`PERSISTENT_KEYS` に**入れない**ので `compass-ui-data` は肥大しない |
| `state.reviews`（既存の永続キー） | ノート由来の復習も既存の復習と同じ場所に入る |

firebase の import は `src/lib/persistence.ts` のみ（architecture §2）。preview / Firebase 未設定では
`createLocalPersistence` のスタブが使われ、localStorage ミラーだけで完結する。

---

## 7. プロンプト

外部 AI に渡すテンプレート。**1 本だけ**（v0.10.1 で 2 段構成をやめた）。
実体は `src/components/parts/NotePrompts.ts` の `NOTE_PROMPT`。**全文はそちらを正とする**
（二重管理すると必ずずれるので、本節には要点だけ置く）。

### 7.1 なぜ 1 本にしたか

当初は プロンプトA（文字起こし＋写真 → 構造化Markdown）→ プロンプトB（Markdown → JSON）の 2 段だった。
実運用で機能しなかったので 1 本に統合した。原因:

- 1 段目の要約で板書の数式や細部が落ち、2 段目が「無い情報から JSON を作る」ことになっていた
- 画像を見られるのは 1 段目だけ。2 段目は元資料を参照できない
- 手数が倍で、途中の Markdown を貼り忘れる事故が起きやすい

### 7.2 プロンプト本体（文字起こし＋ノート/スライド画像 → compass-note@1 JSON）

要点:

1. 出力は JSON オブジェクト 1 個だけ。最初が `{`、最後が `}`
2. **LaTeX のバックスラッシュは JSON 文字列として 2 個重ねる**（`\\dfrac`）。最頻出の失敗
3. 完全な記入例を丸ごと載せる（few-shot）。形式の遵守率が体感で一番変わる
4. **生徒のものと AI のものを分ける**（§3.6）。冒頭で 3 行にまとめて宣言してから、各項目で繰り返す
   - ノートに自分で書いた問いは 1 問も落とさず `origin:"self"` で、self を先に並べる
   - `doubt` は生徒が書いた疑問だけ。「あなたが分かりにくいと思った点は書かない」と明示的に禁じる
   - 足りないぶんだけ `origin:"ai"` で補って合計 5 問
5. `keywords` は 8〜15 語。**`term` は本文に出てくる文字列と 1 文字も違えない**（一致検索で色を塗るため）。
   色は §3.5 の対応表そのままを指示する
6. `summary` は地の文 3〜5 行。想起問題の答えの寄せ集めにしない
7. 出力前の自己チェックリスト 10 項目（うち 3 つが上の「自分のもの / 重要語の一致」の確認）

全文は `NotePrompts.ts` を正とする（ここに二重管理しない）。編集したら本節の要点も更新すること。

### 7.3 アプリ側で吸収するゆらぎ（`extractJsonObject`）

「JSON だけ出せ」と書いても、生成 AI は次をやる。前 2 つは機械的に落とせるので **warning で通す**:

| ゆらぎ | 扱い |
|---|---|
| コードブロック（```json … ```）で囲む | 剥がして読む（warning） |
| 「以下がJSONです」などの前置き・後書き | 最初の `{` 〜 最後の `}` を切り出す（warning） |
| `schema` 行を忘れる | `compass-note@1` とみなす（warning） |
| `schema` に別の値（`chartnote-v2` 等） | **エラー**（別アプリ・別バージョンの JSON） |
| LaTeX のバックスラッシュを 1 個で書く（`\circ` など） | `repairJsonEscapes` で補って読む（warning）。**実際に踏んだ最頻出の失敗** |
| `qi: 0` と文字列で書く | 数値に寄せる |
| `date` を空文字にする | 今日の日付（warning なし。「読めなかった」の合図として指示済み） |
| 全角の引用符・末尾カンマ | **エラー**（直しようがない。行番号つきで表示） |

## 8. 画面

### 8.0 タブ 7・8

ノートは 2 つのタブとして左ナビの後ろに並ぶ（`ViewId` に `'notebook'` と `'extract'` を追加）。

| # | ViewId | ナビ | ヘッダ |
|---|---|---|---|
| 7 | `notebook` | ノート | ノート / 授業ノートを読み、想起問題で引き出す |
| 8 | `extract` | 問題抽出 | 問題抽出 / 全ノートの問題を、理解度の低い順に解き直す |

- 署名カラーは**どちらも `--ink`**。ほかの 6 画面は 1 画面 1 色だが、この 2 つは
  同じ紙の表裏（読む面と解く面）なので対で 1 色にしてある。
- 画面本体はどちらも `screens/Notebook.tsx` が受け、`view` で紙面を切り替える。
  サイドバー（教科ツリー / カレンダー / 教科の絞り込み）は両方で共通。
- キーボードは `1`–`8`（画面が 8 つに増えた）。並びは `navOrder` のドラッグで変えられる。
- ノートを選ぶ動作（サイドバー・取り込み後・問題抽出の出典リンク・復習詳細の「ノートを開く」）は
  いずれも `view:'notebook'` を伴う。問題抽出のタブにいてもノートのタブへ移る。
- 今日の ToDo の「ノートで復習」は `openNoteDrill`（`view:'notebook'` + `nbMode:'drill'`）。
  ドリルの「← 今日のToDo」は `closeNoteDrill`。

| ファイル | 役割 |
|---|---|
| `screens/Notebook.tsx` | サイドバー ＋ ノートビュー / 問題抽出ビュー / ドリル面（どれを出すかは `nbMode`） |
| `parts/NotebookSidebar.tsx` | 教科ツリー、月カレンダー、教科の絞り込み、取り込みボタン、予習自動生成の設定 |
| `parts/NoteView.tsx` | コーネル式の紙面（§8.2）。想起 / 本文＋キュー欄 / まとめ / 演習 / 疑問・連絡。確認モード。編集モード |
| `parts/NoteDrill.tsx` | **その授業の今日ぶんの問題だけ**を解く面。答えを見る → 理解度 → 次の間隔。下に「ノート全体を見る」 |
| `parts/NoteExtract.tsx` | 全ノート横断の問題抽出ドリル。理解度の記録・並べ替え・絞り込み（§8.5 / §8.6） |
| `logic/noteExtract.ts` | 抽出項目の組み立てと並べ替え（純ロジック） |
| `parts/NoteImportModal.tsx` | プロンプトA/Bコピー → JSON貼付 → 検証 → 保存＋復習生成 |
| `parts/NoteMath.tsx` | v3 の `mhtml()` 移植（escape → KaTeX）。数式の外側にだけ重要語の色を塗る |
| `logic/noteKeywords.ts` | 重要語の一致とキュー欄の割り当て（§3.5。純ロジック） |
| `parts/NotePrompts.ts` | §7 のテンプレート文字列 |
| `parts/NotebookPersistence.ts` | localStorage ミラーとクラウド同期の制御 |

### 8.2 コーネル式の紙割り

```
┌ マストヘッド ────────────────────────────┐
│ 想起問題（自作を先に。「自作」「AI」の版）      │
├─ キュー欄 ─┬─ 本文 ─────────────────────┤
│ 重要語     │ 定義・例題の解説               │  ← 縦罫 1 本（面の背景で引く）
│（初出の高さ）│                             │
├───────────┴────────────────────────────┤
│ まとめ（授業 1 回を自分の言葉で数行）         │  ← 紙面いっぱいの上罫
├────────────────────────────────────────┤
│ 演習 / 疑問 / 連絡                          │
└────────────────────────────────────────┘
```

Broadsheet の「枠で仕切らない」に対する**唯一の例外**。コーネル式は罫で紙を割ることが方式そのものなので、
縦罫（キュー欄と本文の境）と横罫（まとめの上）の 2 本だけ足す（`globals.css` の `[E-2]`）。
縦罫は行ごとの `border` ではなく `.nb-cornell` の背景グラデーションで引く ―― 段の切れ目で途切れさせないため。
狭い画面（700px 以下）ではキュー欄を各ブロックの上へ回し、縦罫はやめる。

**確認モード**（`state.nbCheck`）。本文の重要語だけが付箋で伏せられ、キュー欄（左）を見て思い出してから
クリックで 1 枚ずつめくる。操作卓に「3 / 13」「全部めくる」「伏せ直す」。

- 伏せるのは `.nb-cornell` の中だけ。想起問題・まとめ・演習では色を塗るにとどめる
- **めくった状態は DOM のクラスだけで持つ**（`is-hidden` を外す）。React state に置くと
  1 枚めくるたび `dangerouslySetInnerHTML` が貼り直され、剥がした付箋が戻る（実際に踏んだ）。
  枚数の表示も `ref` 経由で直接書き換え、確認モード中は再レンダーを一切起こさない
- 編集モード中は伏せない（伏せた語を書き換えられないため、`nbCheck && !nbEdit` で判定）

紙面スキン（ユーザー決定）:

| `data-theme` | 見た目 |
|---|---|
| `note` | v3 の紙ノート風（罫線・パンチ穴・付箋・Klee One） |
| `light` | v3 の紙ノート風（明るい紙） |
| `neon`（保存値 `dark`） | v2 のフラット活字風をダーク配色で |

復習の入口は 2 つあるが、間隔の計算はどちらも `ReviewShared.completeReview`
→ `lib/logic/reviews.ts` の 1 本道（フォーク禁止）:

1. **ドリル面**（既定）… 今日の ToDo のノートカード →「ノートで復習」。その授業の問題を続けて解く
2. **理解度モーダル**（従来）… 復習画面の行から 1 問だけ消化するとき。
   `noteRefOf(askR.seriesId)` でカードを引き、問題文と「答えを見る」を理解度ボタンの上に足す。
   ノートが見つからないときは従来表示のまま（フォールバック）

### 8.5 想起問題の記録（`NoteCard.attempts`）

想起問題は**解くたびに 1 行残る**。

```ts
interface NoteAttempt { day: ISODate; grade: 'high' | 'mid' | 'low' }
```

復習行（`Review`）は完了すると次の行に置き換わっていくので、「この問題を何回やって、
そのときどう感じたか」は**ノート側に書かないと辿れない**。予定（次はいつ）と実績（何回・どうだった）
を別々に持つ、という切り分け。

書き込む場所は 2 つだけ:

| 経路 | 誰が呼ぶ | 復習の予定 |
|---|---|---|
| 予定どおりの復習 | `ReviewShared.completeReview`（理解度モーダル / ドリル面の共通路） | **動く**（次の間隔へ） |
| 予定の外の解き直し | 問題抽出の ◎○△（`recordNoteAttempt`） | **動かない** |

問題抽出で予定まで動かさないのは、「ちょっと解き直しただけ」で次回が飛んでしまうため。

記録の見え方:

- ノート（読む面）… 各問の脇に「3回 · 前回 8/9 ◎」。ホバーで全履歴
- ドリル面 … 「これまで3回 △ △ ◎」（直近 4 件を記号で）
- 問題抽出 … 同じ 1 行 + それを使った並べ替え・絞り込み

### 8.6 問題抽出の並べ替え（`lib/logic/noteExtract.ts`）

| 並び | 規則 |
|---|---|
| `weak`（既定）「苦手な順」 | **不安 → 未着手 → まあまあ → ばっちり**。同じなら久しく解いていない方が先 |
| `stale`「久しぶり順」 | 最後に解いた日が古い順（未着手が先頭） |
| `note`「ノート順」 | 取り込んだ形のまま（授業日の新しい順 → ノート内の並び） |

- 見るのは**直近の 1 件だけ**。過去に不安でも、最後がばっちりなら後ろへ回る。
- 未着手より「1 度やって不安と答えた問題」を先に出す。取りこぼしがはっきりしている方を先に。
- 演習（`note.exercise`）はカードではないので記録を持たない。`weak` / `stale` では
  **常に想起問題のうしろ**に回す（そうしないと「未着手」として毎回上位に居座り続ける）。
- 理解度チップ（すべて / 未着手 / △ / ○ / ◎）で絞れる。件数はチップに出す。
- 記録を付けると解答は伏せ直される。並べ替えが即座に効くので、次の 1 問がそのまま上に来る。

---

## 9. 受け入れチェックリスト

### N-0xx 取り込み（バリデータ）

- **N-001** 正しい JSON を貼ると `ok:true` になり、`note.cards` の件数が `recall` と一致する
- **N-002** `schema` に別の値が入っている JSON はエラーになり、note を返さない
- **N-003** JSON として壊れている文字列は `$` パスのエラー1件になる
- **N-004** トップレベルが配列のときエラーになる
- **N-005** `recall` が 0 件のときエラーになる
- **N-006** `recall` が 9 件のときエラーになる（8 件は通る）
- **N-007** `recall[i].q` / `.a` が空のとき、その添字を含む path でエラーになる
- **N-008** `subject` / `unit` が空のときエラーになる
- **N-009** `date` が不正形式のとき warning になり、`today` が入る
- **N-010** `blocks[i].qi` が範囲外のとき warning になり、`cardId: null` として保存される
- **N-011** `blocks[i].t` が未知のときそのブロックは捨てられ warning になる
- **N-012** `blocks` の `ex` の `qi` が正しいとき、対応する `cards[qi].cardId` に解決される
- **N-013** `exercise` / `doubt` / `notice` を省略しても既定値で通る
- **N-014** 未知のトップレベルキーは無視される（エラーにしない）
- **N-015** `cardId` はノート内で一意
- **N-016** エラーが1件でもあるとき `note` は返らない（部分保存しない）
- **N-017** 上書き取り込みで `id` と `createdAt` が維持される
- **N-018** 上書き取り込みで既存カードの `cardId` がインデックス一致で維持される
- **N-019** 上書きでカードが減ったとき `removedCardIds` に出る
- **N-020** 上書きでカードが増えたとき `addedCardIds` に出る

### N-1xx カード→復習生成

- **N-021** 取り込み時にカード数と同じ件数の復習が作られる
- **N-022** 同じノートを2回取り込んでも復習カードは増えない（冪等）
- **N-023** 生成された復習は `stage:'当日'` / `due` が今日 / `added:true`（貼ったその日にやる）
- **N-024** 生成された復習の `id === seriesId === 'nb-<noteId>-<cardId>'`
- **N-025** `noteRefOf` が生成した `seriesId` を `{noteId, cardId}` に戻せる
- **N-026** `noteRefOf` は手動追加の id（`u…`）に対して null を返す
- **N-027** `nextReviewOf` を通した次世代の行でも `noteRefOf` が解決する（リンク不変条件）
- **N-028** `title` が `単元 問N`（1 始まり）になる
- **N-029** 一部のカードだけ復習が消えている状態で再生成すると、欠けている分だけ作られる
- **N-030** ノート削除で**未完了**の復習だけが消え、完了済みは残る
- **N-031** ノート削除で `order` から未完了復習の id が外れる
- **N-032** ノート削除で `selId` が対象なら null になる
- **N-033** カード単位の削除では、そのカードの系列だけが消える
- **N-034** `syncNoteReviews` は未完了行の `title`/`subj` だけ更新し、完了行に触れない
- **N-035** `dueCardsOfNote` は期限が来ている未完了カードを問番号順に集める
- **N-036** 今日完了した行は残り、前回までの完了履歴（`due < 今日`）は含めない
- **N-037** 先の予定（`due > 今日`）は含めず、遅れている未完了は含める
- **N-038** 他ノート・手動追加の復習は混ざらない

### N-07x 今日の ToDo での束ね

- **N-071** 想起問題が何問でも、今日の ToDo に出るのはノート 1 冊につき 1 枚
- **N-072** その 1 枚のタイトルはノートの単元名、分数は合計、説明は `ノートの復習 · N/M問`
- **N-073** 全問終わって初めて完了になる（1 問終わっただけでは消えない）
- **N-074** ノートが違えば別の枚数になる
- **N-075** 手動の復習・単発タスク・計画ミニタスクは束ねない（レガシーどおり 1 件 1 枚）
- **N-076** ノートが未読込 / 削除済みなら束ねず、従来どおり 1 問 1 枚で出る
- **N-077** カードをクリック / 「ノートで復習」でドリル面へ飛ぶ（理解度モーダルは開かない）
- **N-078** ドリルで問題を出し、「答えを見る」で方針・解答・解説が開く
- **N-079** ドリルで理解度を選ぶと、その問だけ次の間隔へ送られる
- **N-080** ドリル下部の「ノート全体を見る」で定義・解説・演習・疑問が開く

### N-08x 生成 AI の出力ゆらぎ（§7.3）

- **N-081** コードブロック（言語指定あり / なし）で囲まれていても取り込める
- **N-082** 前置き・後書きが付いていても取り込める。素の JSON なら warning は出ない
- **N-083** `schema` 行が無ければ warning で通し、別の値なら従来どおりエラー
- **N-084** `schema` の前後の空白は無視する
- **N-085** `date` が空文字なら warning 無しで今日の日付にする
- **N-086** `qi` が文字列（`"0"`）でも数値として解決する
- **N-087** LaTeX のバックスラッシュが 1 個（`$36^\circ30'$`）でも補って取り込み、
  復元後の本文は正しい LaTeX（`\circ`）になる。正しく書かれていれば触らない。
  直しても JSON にならないもの（全角引用符など）は従来どおりエラー

### N-09x / N-1xx コーネル式（§3.5 / §3.6 / §8.2）

重要語とキュー欄（`noteKeywords.ts`）:

- **N-088** 知らない色・欠落は `red` に寄せて取り込みを止めない
- **N-089** 本文が重要語のところで切れ、`.nb-key--<color>` が付く
- **N-090** 長い語が先に当たる（「革命」が「産業革命」を食わない）
- **N-091** 重要語は「初めて出てくるブロック」のキュー欄に付く。2 回目以降は並べない
- **N-092** 本文に無い語は `orphans` に落ちる（黙って消さない）
- **N-093** `ex` ブロックは方針・解答・注意のどこに出ても拾う

取り込み（`noteImport.ts`）:

- **N-094** `origin:"self"` は自作として保たれる
- **N-095** `origin` が無い / 変な値なら AI 作として読む（エラーにしない）
- **N-096** `keywords` の `term` / `color` / `note` をそのまま取り込む
- **N-097** ただの文字列の配列（`["産業革命", …]`）でも読める
- **N-098** 空文字・重複・知らない色は落として整える（`term` は trim のみ）
- **N-099** `keywords` / `summary` が無い旧プロンプトの出力も通る
- **N-100** `summary` は前後の空白だけ落として保つ。`doubt` は書かれたまま（空でもエラーにしない）

紙面（手で確認する）:

- **N-101** 本文が「キュー欄 + 本文」の 2 段になり、縦罫が段の切れ目で途切れない
- **N-102** まとめが紙面いっぱいの上罫で本文と切れて出る
- **N-103** 想起問題に「自作」「AI」の版が出て、自作が先に並ぶ
- **N-104** 確認モードで本文の重要語だけが付箋になり、想起問題・まとめは色のまま
- **N-105** 付箋をクリックすると 1 枚ずつめくれ、**すでにめくった付箋は戻らない**
- **N-106** 「全部めくる」「伏せ直す」で枚数の表示（`3 / 13`）が追従する
- **N-107** 編集モードでは伏せず、重要語の一覧を足す / 消す / 色を変えられる
- **N-108** 本文に無い重要語は編集画面で赤枠になり「本文に見当たりません」と出る
- **N-109** 3 テーマとも重要語 5 色が本文級数で読める（light は実測 6:1 以上）
- **N-110** 700px 以下ではキュー欄が本文の上に回り、縦罫が消える
- **N-111** 時間割にある教科（歴総 など）なら警告を出さない
- **N-112** 「社会」のような大分類は保存はするが warning を出し、候補を並べる。
  `knownSubjects` を渡さなければ何も言わない（`lib/logic/*` は時間割を知らない純ロジックのまま）

### N-2xx 予習の自動生成

- **N-041** 木曜に起動すると対象日は金曜
- **N-042** 金曜に起動すると対象日は月曜
- **N-043** 土曜・日曜に起動すると対象日は月曜
- **N-044** `held:false` の上書きがあるコマは生成されない
- **N-045** `subj` の上書きがあるコマは上書き後の教科で生成される
- **N-046** 同じ教科が2コマある日は1件だけ生成される
- **N-047** `offSubjects` の教科は生成されない
- **N-048** `prepGenLog` に記録済みの対象日・コマは再生成されない（リロードで重複しない）
- **N-049** 生成後にユーザーがタスクを削除しても、同じ日に再生成されない
- **N-050** `enabled:false` のとき何も生成しない
- **N-051** 14 日より古い `prepGenLog` のキーが削除される
- **N-052** 生成される `Extra` の `day` は今日、`timetableDate` は対象日
- **N-053** 空きコマ（`null`）からは生成されない

### N-3xx 画面・結線

- **N-061** ナビに「ノート」が出て、キーボード `7` で切り替わる
- **N-062** 取り込みモーダルでプロンプトA/Bをコピーできる
- **N-063** 不正な JSON を貼ると赤いエラーリストが出て、ノートは保存されない
- **N-064** 保存したノートが数式付きで描画される（KaTeX）
- **N-065** リロードしてもノートが残る（localStorage ミラー）
- **N-066** 理解度モーダルにカードの問題文と「答えを見る」が出る
- **N-067** ノートが無い復習では理解度モーダルが従来どおり開く（フォールバック）
- **N-068** 理解度を選んで完了すると、既存の間隔反復どおり次の段階へ進む
- **N-069** 3テーマとも紙面が読める（note/light=紙、neon=フラット）
- **N-070** ブラウザコンソールにエラーが出ない

---

## 10. マイルストーンとゲート

| MS | 成果物 | ゲート |
|---|---|---|
| M0 | ブランチ・本仕様書・フィクスチャ | `npx tsc --noEmit` / `npm test`（既存 305 件） |
| M1 | `model/notes.ts`・`logic/noteImport.ts` + テスト | tsc / test |
| M2 | `logic/noteCards.ts`・`logic/prepAutogen.ts`・`logic/timetable.ts`・state キー | tsc / test / PERSISTENT_KEYS が純追記であることを diff で確認 |
| M3 | `persistence.ts` の notes CRUD・`NotebookPersistence.ts` | tsc / test / `npm run build` |
| M4 | ノート画面一式・KaTeX・`globals.css [E]` | tsc / test / build / スモーク① |
| M5 | `ReviewAskModal` 拡張・予習 autogen 結線 | tsc / test / build / スモーク② |
| M6 | テーマ仕上げ・docs 更新・N-nnn 自己監査 | tsc / test / build / スモーク③ |

スモーク（dev サーバ `?preview=1`）:

- ① ノートタブ → フィクスチャ貼付 → KaTeX 描画 → 復習に N 件（due 明日）→ 再貼付で増えない → 不正 JSON でエラー → リロードで残存
- ② 復習完了フロー（問題表示 → 答えを見る → 理解度 → 次段階）／予習 autogen（起動でトースト、リロードで重複なし）
- ③ 3テーマ切替、console エラー 0

## 11. ガードレール

1. 作業は `feat/notebook-integration` のみ。マイルストーンごとに `feat: 日本語` でコミット
2. `PERSISTENT_KEYS` は**末尾追記のみ**（並べ替えは保存トリガを壊す。app-spec §4.14）
3. firebase の import は `src/lib/persistence.ts` だけ。`lib/logic/*` は React / firebase フリーの純関数
4. `reviews.ts` / `dataPatch.ts` のロジックは**変更しない**。リンクは `seriesId` にのみ載せる
5. 既存 305 テストを常にグリーンに保つ
6. 新規ロジックは `lib/logic/*` に置き、vitest を書く。画面側で日付計算・生成ロジックを再実装しない

## 12. 既知のリスク

1. **dataPatch M3 のシングルトン系列**: 完了履歴を手動削除して系列が1行だけになると `seriesId` が
   自分の id へ書き換わり、リンクが切れる。→ 理解度モーダルはフォールバック表示になるだけで壊れない。
   `title` を `単元 問N` としてカードごとに一意にし、レガシーの意味キー結合で別カードが混ざるのを防ぐ
2. **KaTeX の CSS/フォント**: 初回ロードに ~100KB gz 増。バージョンを固定して許容する
3. **復習の孤児**: ノートが消えても未完了行はカスケード削除。完了行は履歴として残り、タイトルだけで意味が通る
4. **予習 autogen の初回発火**: 既定 ON なので初回起動でいきなり生成される。トーストで告知し、
   サイドバーの設定から1クリックで止められるようにする
5. **時間割の教科名（英コ等）とノートの教科名（英語等）の不一致**: 統一しない。どちらも自由文字列で、
   色は `ShellSubjects` が自動採番する

---

## 13. 自己監査

<!-- AUDIT:BEGIN -->
実施日 2026-08-07 / ブランチ `feat/notebook-integration` / 全 86 項目 **PASS**。

> **プロンプト 1 本化（2026-08-08）**: 2 段構成が実運用で機能しなかったため §7 のとおり統合し、
> 生成 AI の出力ゆらぎ（コードブロック・前置き・`schema` 忘れ・`qi` の文字列化）を
> アプリ側で吸収するようにした（N-081〜N-086）。取り込みモーダルは 3 ステップ → 2 ステップ。

> **要件追加ぶんの追試（同日）**: 「当日の ToDo に 1 枚出す」「そこからノートの問題だけの面へ飛ぶ」
> の 3 点（N-023 改訂 / N-035〜N-038 / N-071〜N-080）を反映し、ブラウザで通しを再実行した。
> ノートを貼る → 今日の ToDo に「数列 ─ 漸化式と一般項 · ノートの復習 · 3/3問」が **1 枚だけ**出る
> →「ノートで復習」→ ドリルで 3 問（答えを見る → 理解度）→ 全問終わって ToDo が完了表示・進捗 20%
> → 各問は「次回 明日」。console エラー 0。

自動ゲート:

| コマンド | 結果 |
|---|---|
| `npx tsc --noEmit` | エラー 0 |
| `npm test` | 13 ファイル / 434 テスト PASS（着手前のベースラインは 305 件） |

既存テストのうち 2 件だけ、キー数が設計どおり増えたため主張を書き換えた（弱めてはいない）:

- `store.test.ts` … `PERSISTENT_KEYS.toHaveLength(23)` を廃し、
  **レガシー 23 キーが先頭 23 個のまま**であること + 追加分が末尾 2 件であることの検証に置換
  （末尾追記の規約そのものをテストで固定した）
- `store.test.ts` … `UNDO_KEYS.toHaveLength(14)` → 15（`prepGenLog` を追加）
- `export.test.ts` … `SAMPLE_EXPORT.state` に新キー 2 件を追加（型が要求するため）
| `npm run build` | 成功（KaTeX の SSR も問題なし） |

手動スモーク: `npx next start -p 3006` + `?preview=1` を Chrome で操作。console エラー 0。

| 範囲 | 検証手段 | 結果 |
|---|---|---|
| N-001〜N-020（取り込み・検証） | `src/lib/logic/__tests__/noteImport.test.ts`（`docs/notebook/fixtures/*.json` を実ファイルとして読む） | PASS |
| N-021〜N-034（カード→復習） | `src/lib/logic/__tests__/noteCards.test.ts` / `src/components/parts/__tests__/NotebookPersistence.test.ts` | PASS |
| N-035〜N-038（今日ぶんの束ね） | `src/lib/logic/__tests__/noteCards.test.ts` | PASS |
| N-041〜N-053（予習の自動生成） | `src/lib/logic/__tests__/prepAutogen.test.ts` | PASS |
| N-071〜N-076（ToDo での束ね） | `src/components/parts/__tests__/ShellTodayItems.test.ts` | PASS |
| N-077〜N-080（ドリル面） | ブラウザ: ToDo 1 枚 → ドリル 3 問 → 全問完了 → ノート全体を展開 | PASS |
| N-061 ナビ・キー7/8 | ブラウザ: ナビに「ノート」(7) と「問題抽出」(8)、フッタの表示が `1–8 画面` | PASS |
| N-062 プロンプトのコピー | ブラウザ: 「プロンプトをコピーしました」トースト | PASS |
| N-081〜N-086（出力ゆらぎ） | `src/lib/logic/__tests__/noteImport.test.ts` | PASS |
| N-063 不正JSONのエラー表示 | ブラウザ: `unit` / `recall[0].a` / `recall[1].q` の 3 件が赤リストに出て保存されない | PASS |
| N-064 KaTeX 描画 | ブラウザ: フィクスチャ取り込み後に `.katex` ノード 85 個 | PASS |
| N-065 リロード後も残る | ブラウザ: リロード → `compass-notes` から復元、見出しと数式が再描画 | PASS |
| N-066 モーダルのカード面 | ブラウザ: 問題文 →「答えを見る」→ 方針・解答（すべて KaTeX） | PASS |
| N-067 ノート無しのフォールバック | ブラウザ: 手動追加の復習ではカード面が出ず従来レイアウト | PASS |
| N-068 完了で次の段階へ | ブラウザ: ばっちり → 第2回・3日後・8/10、`seriesId` を継承、`studyLog` に 5 分 | PASS |
| N-069 3テーマ | ブラウザ: note/light は罫線・パンチ穴・付箋・Klee One、neon はフラット | PASS |
| N-070 console エラー | ブラウザ: `read_console_messages(onlyErrors)` が 0 件 | PASS |

実装中に見つけて直した不具合（テストで固定済み）:

- **起動時のクラウド読み込みが 0 件のときローカルのノートを全消ししていた。**
  preview / Firebase 未設定では `loadNotes()` が常に `[]` を返すため、リロードのたびに
  ノートが消えていた。`persistence.kind === 'local'` のときはローカルを唯一の正とし、
  実 Firebase でも「クラウド 0 件 かつ ローカルあり」は未同期とみなしてローカルを残し、
  クラウドへ押し上げるよう変更（`NotebookController.boot`）。
<!-- AUDIT:END -->
