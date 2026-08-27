# ノート画面の UX 刷新（2026-08）

ノート画面を「読むための紙面」から「**扱える書類棚**」にする。
本人からの要望を 11 個の改善点に割り、1 つずつ独立した部品として作る。

この文書は**作業の契約書**。各担当はここに書いてある state キー・命名・
デザインの約束にだけ従い、担当外のファイルには触らない（統合は親がやる）。

---

## 0. 前提 — 触ってよいファイル

**自分の担当ファイルだけを新規作成・編集する。** 同じ作業ツリーで他の担当が
同時に動いているので、共有ファイル（`globals.css` / `NotebookSidebar.tsx` /
`NoteView.tsx` / `Notebook.tsx` / `CompassApp.tsx` / `types.ts` / `store.ts` /
`NotebookPersistence.ts`）を書き換えると、他人の作業を壊す。

- state のキーは**すでに親が用意してある**（`src/lib/model/types.ts` / `src/lib/store.ts`）。
  足りないと思ったら勝手に足さず、担当の報告に「こういうキーが要る」と書いて返す。
- 画面への組み込み（サイドバーや `NoteView` の中へ置く配線）も**親がやる**。
  担当は「組み込めば動く部品」と、その使い方（props / 呼び出し例）を書いて渡す。
- `npx tsc --noEmit` は他人の書きかけを拾って赤くなることがある。
  自分のファイルの行だけを見る: `npx tsc --noEmit 2>&1 | grep <自分のファイル名>`
- テストは `npx vitest run <対象パス>` で自分のぶんだけ回す。

---

## 1. デザインの約束（守らないと紙面から浮く）

デザイン言語は「**校内プリント**」（`src/components/parts/ShellTheme.ts` の冒頭に全文）。

1. **紙は方眼**。角丸は面が `var(--rad)`(3px)、セルが `var(--rad-s)`(2px) まで。影は原則使わない。
2. **インクは数色**。1 画面につき地の墨 + 差し色 1 色（`var(--view)` が画面ごとの差し色）。
3. **蛍光オレンジ `var(--pink)` は「いま」専用**。今日のToDo・期限切れ・現在のコマ以外に出さない。
4. 書体は 3 つ + 1。`--f-disp` 見出し / `--f-ui` 本文 / `--f-num` 数字 /
   **`--f-hand` は「自分が書いたもの」専用**（ノート画面の外で使わない）。

よく使うトークン（定義は `ShellTheme.ts`、ダーク/ライト 3 テーマで自動的に入れ替わる）:

| 種類 | トークン |
|---|---|
| 地 | `--bg0`（紙） `--bg1` `--bg2`（面） `--bg3`（ホバー） |
| 罫 | `--line`（細） `--line2`（太） |
| 字 | `--tx0`（強） `--tx1` `--tx2` `--tx3`（弱） |
| 差し色 | `--view` / `--viewBg`（画面ごと）、`--acc` `--grn` `--pink` `--vio` `--blue` `--org` と各 `*Bg` |
| 反転字 | `--onAcc`（差し色の上に載せる字） |
| ノート | `--nb-ink` `--nb-ai-ink`（AIの紫） `--nb-tint` `--nb-k-red/blue/green` |

**色は必ずトークンで書く。生の `#rrggbb` を書かない**（3 テーマで破綻する）。

### 動きの約束（全担当共通）

- **意味のある動きだけ**。「開いた/閉じた」「消えた/戻った」「押した」を伝えるためだけに動かす。
  装飾のための常時アニメーション（ふわふわ浮き続ける等）は入れない。
- 速さ: 開閉 `.24s`–`.32s` / 出現 `.16s`–`.22s` / 押し込み `.09s`。
  イージングは `cubic-bezier(.22,1,.36,1)`（減速）を既定にする。
- **`prefers-reduced-motion: reduce` を必ず書く**。既存の書き方に合わせる:
  ```css
  @media(prefers-reduced-motion:reduce){ .xxx{transition:none;animation:none} }
  ```
- 高さの補間は `grid-template-rows: 0fr → 1fr`（既存の `wrapStyle` と同じ手）。
  `height:auto` のアニメーションはしない。
- 動かすのは `transform` と `opacity` を基本にする（レイアウトを揺らさない）。

---

## 2. 使ってよい state（親が用意済み）

`src/lib/model/types.ts` の `EphemeralState` に追加済み。既定値は `src/lib/store.ts`。

| キー | 型 | 意味 |
|---|---|---|
| `nbFolder` | `string \| null` | Finder 風に**潜っている**教科。`null` = 全教科 |
| `nbDay` | `ISODate \| null` | カレンダーで選んだ日。`null` = 月ぜんぶ |
| `nbMenu` | `NoteMenu \| null` | 右クリックメニュー `{noteId, x, y}`（x,y はビューポート座標） |
| `nbRenameId` | `string \| null` | 一覧でその場改名しているノート |
| `nbAsk` | `NoteAsk \| null` | 削除・改名の確認ダイアログ |
| `nbTrashOpen` | `boolean` | ゴミ箱を開いているか |
| `notesTrash` | `Note[]` | ゴミ箱の中身（**`notes` には混ざらない**） |
| `nbUndo` | `NoteUndo[]` | ノート操作の取り消し履歴（新しいものが末尾） |

既存で関係するもの: `notes` / `nbSelNoteId` / `nbSubjFilter`（下のチップの絞り込み）/
`nbTreeOpen`（教科アコーディオンの開閉）/ `nbSide`（`'tree' | 'cal'`）/ `nbMonth` / `nbEdit`。

`NoteMenu` / `NoteAsk` / `NoteUndo` / `NOTE_TRASH_DAYS`(=30) / `NOTE_UNDO_MAX`(=20) の定義も
`types.ts` にある。`Note.trashedAt`（`ISODate | ''`）は `src/lib/model/notes.ts`。

store の使い方（`src/components/useStore.ts`）:

```ts
import { store, useAppStore } from '../useStore';
const { state: S } = useAppStore();          // 購読
store.setState({ nbFolder: '数学' });         // 直接
store.setState((s) => ({ ... }));             // 前の値から
store.showToast('メッセージ');                 // 画面下のトースト
```

---

## 3. 改善点と担当（11 件）

| # | 改善点 | 担当が作る / 触るファイル |
|---|---|---|
| 1 | 教科フォルダの開閉にアニメーション | `parts/NotebookTree.tsx`, `app/nb-tree.css` |
| 2 | 教科をダブルクリックでその教科だけに潜る（Finder 風） | `lib/logic/noteFolder.ts`(+test), `parts/NotebookCrumbs.tsx`, `app/nb-tree.css` |
| 3 | 一覧の行で教科が一目で分かる | `parts/NoteRow.tsx`, `app/nb-row.css` |
| 4 | カレンダーで日を指すとその日だけの一覧に | `parts/NotebookCalendar.tsx`, `app/nb-cal.css` |
| 5 | 右クリック → カーソル脇の小さなメニュー（改名・削除） | `parts/NoteContextMenu.tsx`, `app/nb-menu.css` |
| 6 | 削除・改名のとき「復習も消すか」を聞く | `parts/NoteDangerDialog.tsx`, `app/nb-dialog.css` |
| 7 | ゴミ箱 30 日 ＋ ⌘Z で取り消し | `lib/logic/noteTrash.ts`(+test), `parts/NoteTrashPanel.tsx`, `app/nb-trash.css` |
| 8 | AI の添削を JavaScript のコメント風に | `lib/logic/noteAiComment.ts`(+test), `parts/NoteAiComment.tsx`, `app/nb-aiedit.css` |
| 9 | まとめを編集モードに入らずに書ける | `parts/NoteSummaryEditor.tsx`, `app/nb-summary.css` |
| 10 | アプリ全体の動きを増やす | `app/motion.css`, `parts/ShellNav.tsx`, `parts/ShellTopbar.tsx`, `parts/ShellToast.tsx` |
| 11 | Clawd くん（マスコット）を各所に | `parts/Clawd.tsx`, `app/clawd.css` |

CSS ファイルはすでに空の状態で置いてあり、`src/app/layout.tsx` から読み込み済み。
**自分の CSS ファイルにだけ書く**（`globals.css` には書かない）。

---

## 4. 部品どうしの取り決め

### 一覧の行（#3）が受け取る props

```ts
interface NoteRowProps {
  note: Note;
  on: boolean;                                    // いま開いているノートか
  onClick: (n: Note) => void;
  onContextMenu?: (e: React.MouseEvent, n: Note) => void;  // #5 が使う
  showSubject?: boolean;                          // 教科が混ざる並びでは true
}
```

`onContextMenu` は #5 の担当が親から渡す。#3 は「渡されたら呼ぶ」だけでよい。

### 危険な操作は必ず #6 のダイアログを通す

削除・改名を**その場で実行しない**。`store.setState({ nbAsk: {...} })` を立てて、
実際の破壊は #6 のダイアログの「はい」が呼ぶ。`window.confirm` は使わない（紙面から浮く）。

### 破壊と復元は #7 の純ロジックを通す

`lib/logic/noteTrash.ts` が唯一の入口。他の担当はそこに生える関数を呼ぶだけで、
自前で `notes` を書き換えない。#7 が公開する関数（署名は #7 が決めてよい）:

- ノートをゴミ箱へ入れる（復習を消すかは引数で受ける）
- ゴミ箱から戻す
- 30 日を過ぎたぶんを本当に消す
- 直前の操作を取り消す（`nbUndo` の末尾を戻す）

---

## 5. 検収の観点（レビューはここを見る）

1. **要望を満たしているか**（下の原文と突き合わせる）
2. **デザインの約束**（§1）を破っていないか。生の色、無意味な動き、`--f-hand` の誤用
3. **`prefers-reduced-motion`** を書いたか
4. **キーボードと支援技術**。メニュー・ダイアログは Esc で閉じ、`role` / `aria-*` が付いているか
5. **担当外のファイルを触っていないか**
6. 純ロジックには vitest のテストがあるか（`src/lib/logic/__tests__/` の書き方に倣う）
7. コメントの密度と口調が周りのファイルと揃っているか（**なぜそうしたか**を日本語で書く）

---

## 6. 要望の原文（2026-08-27）

> ノートモードで、左側のタブ？の数学とかのフォルダみたいなのがあると思うんですけど、
> そこを開く時と閉じるときでアニメーションを入れて欲しくて、あと、教科をダブルクリックすると
> その教科だけのものになるみたいなFinder風の仕様にして！
> ノートは右クリック→小さいポップアップがカーソルの近くに表示される→削除や名称変更 をできるようにして！
> 名称を変更したり、削除したりしたときには復習の方も消すか聞いて、消すならそっちも消して！
> command + zで戻せるようにしておいて、1ヶ月はゴミ箱に入れとくみたいな感じにしとこう。
> 全体的にもっとアニメーションを増やしてわかりやすくしてください！
> あと、カレンダーについて、日付まで指定されたら、その日だけを左側のリストに表示するようにしてください！
> あと、左側のリストを見ただけだと、どのノートが何の教科なのかがわかりづらすぎるので、そこを改善してください。
> 後本文について、AIの添削はJavascriptのメモふうにしようって言ったじゃん！// 〜〜〜にして、
> 文字は基本は灰色にしてさ！重要な後の時は色つけてもらって、って感じで。
> まとめは編集からじゃなくてもかけるようにしておいてもいいかもね！
> あと、Claude信者なので、Clawdくんを色んなところで動かして欲しいなできれば！
> このClaude Codeみたいに、タッチしたら短いアニメーションが流れたりとかしたらめっちゃやる気出るし！
