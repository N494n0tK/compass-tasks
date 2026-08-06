# チャートノート統合 仕様書（compass-note@1）

Compass-Tasks に「授業ノート ＋ 想起カードの間隔反復」を統合するための正典。
実装は本書のチェックリスト **N-001〜N-070** を全て満たすこと。

関連: [../rewrite/architecture.md](../rewrite/architecture.md) / [../rewrite/app-spec.md](../rewrite/app-spec.md) §6（復習）・§4.9（時間割）

---

## 1. 目的とワークフロー

`CompassNotebook/` の「チャートノート v2 / v3」（依存欠落で単体動作しない dc-html）を Next.js へ作り直し、
Compass の既存復習エンジンへ接続する。ユーザーが到達したい状態:

| # | 段階 | 担当 |
|---|---|---|
| 1 | 授業を録音し、ノートを写真に撮る | 自分 |
| 2 | 文字起こし → プロンプトA → プロンプトB → JSON | 外部AI |
| 3 | JSON を Compass に貼る。検証が通れば保存 | 自分（貼るだけ） |
| 4 | カード単位で復習タスクが自動生成される | Compass |
| 5 | 「今日の復習」に出る。想起問題に答える | 自分 |
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

export interface NoteCard {
  cardId: string;   // 'c' + base36。取り込み時に採番し、以後不変
  q: string;        // 問題文（$...$ / $$...$$ の LaTeX 可）
  a: string;        // 解答
  guide: string;    // 方針（空文字可）
  src: string;      // 出典（空文字可）
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
  exercise: { q: string; a: string };
  doubt: string;
  notice: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}
```

`cardId` を持つのが v2/v3 との唯一の本質的な差。旧実装は解説ブロックを `qi`（recall の配列インデックス）で
指しており、想起問題を1つ消すと全ての `qi` がズレる潜在バグがあった。取り込み時に `qi → cardId` へ解決する。

### 3.2 貼り付け JSON（外部AI が出力する形）

```json
{
  "schema": "compass-note@1",
  "date": "2026-08-06",
  "subject": "数学",
  "unit": "数列 ─ 漸化式と一般項",
  "recall": [{ "q": "…", "a": "…", "guide": "…", "src": "…" }],
  "blocks": [
    { "t": "def", "title": "漸化式", "body": "…" },
    { "t": "ex", "qi": 0, "guide": "…", "solution": "…", "caution": "…" }
  ],
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
| `schema` | 欠落・不一致 | error | `schema は "compass-note@1" にしてください（受信: …）` |
| `date` | `YYYY-MM-DD` でない | warning | `date の形式が不正なので今日の日付にしました` |
| `subject` | 空 | error | `教科を入力してください` |
| `unit` | 空 | error | `単元名を入力してください` |
| `recall` | 配列でない / 0件 | error | `recall を1件以上入れてください` |
| `recall` | 8件超 | error | `recall は8件までです（受信: N件）` |
| `recall[i].q` | 空 | error | `問題文が空です` |
| `recall[i].a` | 空 | error | `解答が空です` |
| `blocks` | 配列でない | warning | `blocks を配列として読み取れないので空にしました` |
| `blocks[i].t` | `def`/`ex` 以外 | warning | `未知のブロック種別 "…" を無視しました` |
| `blocks[i].qi` | 範囲外 | warning | `qi=N は recall の範囲外なので未対応にしました` |
| `exercise` | 非オブジェクト | warning | `exercise を読み取れないので空にしました` |

`date` / `blocks` / `exercise` / `doubt` / `notice` は欠落を warning 無しで既定値に落とす（`date` のみ形式不正時に warning）。

### 3.4 上書き取り込み（`existing` あり）

`id` / `createdAt` を維持し、`cardId` は**インデックスで**既存カードに対応付ける。
差分 `{ keptCardIds, addedCardIds, removedCardIds }` を返し、呼び出し側が復習をカスケードする。

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

| フィールド | 値 |
|---|---|
| `id` / `seriesId` | `noteSeriesId(note.id, card.cardId)`（初回は一致。手動追加と同型） |
| `reviewNo` | `1` |
| `title` | `note.unit + ' 問' + (index + 1)` |
| `subj` | `note.subject` |
| `stage` / `last` / `due` | `'翌日'` / `today` / `isoShift(today, 1)` |
| `min` | `5`（XS） |
| `src` | `'ノートから生成'` |
| `timetablePeriod` / `timetableDate` | `null` / `null` |
| `added` / `done` | `false` / `false` |

### 4.2 同期・カスケード

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

外部AI に渡すテンプレート。実体は `src/components/parts/NotePrompts.ts`（本書と同一文字列）。

### 7.1 プロンプトA — 文字起こし＋板書写真 → 構造化Markdown

```
あなたは高校生の学習ノート作成アシスタントです。入力(授業の録音文字起こしと板書・ノートの写真)から、
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
3. 板書の数式は省略せずすべて LaTeX に起こす。
```

### 7.2 プロンプトB — Markdown → compass-note@1 JSON

```
以下の授業ノート(Markdown)を、学習アプリ取り込み用の JSON に変換してください。
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
   (例: "\\dfrac{a}{b}")。
3. 例題は blocks の {"t":"ex"} にし、対応する recall の番号(0 始まり)を qi に入れる。
   対応する想起問題が無ければ qi は null。
4. exercise は授業の仕上げに解く 1 問。適切な問題が無ければ recall から発展させて作る。
5. 「なし」の項目は空文字 "" にする。
```

---

## 8. 画面

新 ViewId `'notebook'`（ナビ「ノート」、キーボード `7`、署名カラー `--ink`）。

| ファイル | 役割 |
|---|---|
| `screens/Notebook.tsx` | サイドバー ＋ ノートビュー / 問題抽出ビューの切替 |
| `parts/NotebookSidebar.tsx` | 教科ツリー、月カレンダー、取り込みボタン、予習自動生成の設定 |
| `parts/NoteView.tsx` | 想起 / 解説 / 演習 / 疑問・連絡。カードごとの復習ステータス。編集モード |
| `parts/NoteExtract.tsx` | 全ノート横断の問題抽出ドリル |
| `parts/NoteImportModal.tsx` | プロンプトA/Bコピー → JSON貼付 → 検証 → 保存＋復習生成 |
| `parts/NoteMath.tsx` | v3 の `mhtml()` 移植（escape → KaTeX） |
| `parts/NotePrompts.ts` | §7 のテンプレート文字列 |
| `parts/NotebookPersistence.ts` | localStorage ミラーとクラウド同期の制御 |

紙面スキン（ユーザー決定）:

| `data-theme` | 見た目 |
|---|---|
| `note` | v3 の紙ノート風（罫線・パンチ穴・付箋・Klee One） |
| `light` | v3 の紙ノート風（明るい紙） |
| `neon`（保存値 `dark`） | v2 のフラット活字風をダーク配色で |

復習体験は `ReviewAskModal` を**拡張**する（フォーク禁止）。`noteRefOf(askR.seriesId)` でカードを引き、
問題文と「答えを見る」パネルを理解度ボタンの上に足すだけ。ノートが見つからないときは従来表示。

---

## 9. 受け入れチェックリスト

### N-0xx 取り込み（バリデータ）

- **N-001** 正しい JSON を貼ると `ok:true` になり、`note.cards` の件数が `recall` と一致する
- **N-002** `schema` が違う JSON はエラーになり、note を返さない
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
- **N-023** 生成された復習は `stage:'翌日'` / `due` が今日の翌日
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
実施日 2026-08-07 / ブランチ `feat/notebook-integration` / 全 70 項目 **PASS**。

自動ゲート:

| コマンド | 結果 |
|---|---|
| `npx tsc --noEmit` | エラー 0 |
| `npm test` | 12 ファイル / 402 テスト PASS（着手前のベースラインは 305 件） |

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
| N-041〜N-053（予習の自動生成） | `src/lib/logic/__tests__/prepAutogen.test.ts` | PASS |
| N-061 ナビ・キー7 | ブラウザ: ナビに「ノート」、フッタの表示が `1–7 画面` | PASS |
| N-062 プロンプトのコピー | ブラウザ: 「プロンプトBをコピーしました」トースト | PASS |
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
