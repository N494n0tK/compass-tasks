# CSS 移植メモ (Phase 2A / TASK F8)

> **2026-08 追記** — デザイン刷新（[design-qa.md](../../design-qa.md)）で
> レガシー由来の視覚レイヤーは `[C-2]` に置き換わった。**このメモが説明する
> 「レガシー 1:1 移植」の対象は、いまは `[C]`（スプラッシュとキーフレーム）だけ。**
> 色・書体・角丸・余白の現行仕様は design-qa.md と `ShellTheme.ts` を見ること。
> §1〜§3 と §6 の内容（`data-theme` の正規化、C-508 のセル明示クラス、`.hv-*`）は
> 刷新後も有効。

`src/app/globals.css` は **レガシー `Compass App.dc.html` L14-783 + support.js が注入する CSS**
を Next.js 版の単一スタイルシートへ 1:1 移植したもの。Phase 2B のコンポーネント実装は
このファイルの**クラス名と DOM 構造の前提**に合わせて書くこと。

正典: [app-spec.md](app-spec.md) §3 / [architecture.md](architecture.md) §4。

## 0. globals.css の構成

| 節 | 内容 | 出所 |
|---|---|---|
| `[A]` | 認証画面（刷新後の配色・書体に追従） | 既存 `globals.css` |
| `[B]` | dc-runtime ベースライン(`@media print` / ルート高さ) | `support.js` BASE_CSS / FULL_PAGE_CSS |
| `[C]` | スプラッシュとキーフレーム（レガシー逐語移植の残り） | `Compass App.dc.html` L17-782 |
| `[C-2]` | **インターフェース本体（2026-08 刷新「校内プリント」）** | design-qa.md |
| `[D]` | `style-hover` / `style-focus` の代替ユーティリティ | `support.js` createPseudoSheet |
| `[E]` | ノート画面（チャートノート v2 = Broadsheet 由来の紙面・KaTeX） | docs/notebook/spec.md §8 |

**節の順序は変えないこと。** レガシーの head 内 CSS 順序(spec §1.6)と同じカスケードで、
`[D]` は同詳細度のアプリ CSS に「後勝ち」する前提で効いている。`[E]` はさらにその後ろ。

`[C-2]` を書くときの前提:

- **色・書体・角丸はトークン経由で書く。** 16 進数や書体名を直に書かない
  （`--bg0..--tx3` / `--view` / `--f-ui` `--f-disp` `--f-num` / `--rad` `--rad-s`）。
  書体は 3 つ。`--f-hand`(Klee One)はノート画面の作り直しで使い手がいなくなり、
  読み込みごと落とした（2026-08）。トークンだけ `--f-ui` へのエイリアスとして残してある。
  テーマ差分は `ShellTheme.ts` の 3 つのトークン表だけで完結させ、
  `[data-theme="…"]` セレクタは紙そのものが変わるところ（スプラッシュ等）にしか書かない。
- コンポーネント側はインライン style が主なので、上書きには `!important` が要る。
  逆に**インラインが持っていない性質（hover / focus / sticky / メディアクエリ）は
  `!important` なしで書く**。詳細度を上げすぎると `[D]` や `[E]` が効かなくなる。

---

## 1. テーマ属性のマッピング(architecture Q19)

レガシーは `themeName: note ? 'dark' : (light ? 'light' : 'neon')`(HTML:3940)という**反転命名**
だった。移植版では `data-theme` の値を `note | neon | light` に正規化し、スキン CSS のセレクタを
書き換えた。**保存値 `state.theme` は変更しない**(既存 Firestore データ互換)。

| `state.theme`(保存値) | UI ラベル | レガシーの `data-theme` | **新 `data-theme`** | 当たる CSS |
|---|---|---|---|---|
| `'note'`(既定) | ✎ ノート | `dark` | **`note`** | `.compass-theme-mode[data-theme="note"]`(63セレクタ) |
| `'light'` | ☀ ライト | `light` | `light` | `.compass-theme-mode[data-theme="light"]`(19セレクタ) |
| `'dark'` | ✦ ダーク | `neon` | **`neon`** | **どのスキンブロックも当たらない**(素の 2026 neon 基底) |

コンポーネント側の実装:

```ts
// state.theme → data-theme 属性値
const THEME_ATTR = { note: 'note', light: 'light', dark: 'neon' } as const;
```

```tsx
<div className="compass-theme" style={STATIC_NOTE_TOKENS}>
  <div className="compass-theme-mode" data-theme={THEME_ATTR[state.theme]} style={themeStyle}>
```

注意点:

- `neon` に対応するセレクタは**存在しないのが正しい**(レガシーもそうだった)。書かないこと。
- モバイル FAB の `.compass-theme-mode[data-theme] .app-nav-item[data-nav="add"]`(HTML:762-776)は
  **属性の存在**だけを見て詳細度を稼ぐルール。値に依存しないのでそのまま。
  `data-theme` は 3 テーマとも必ず出力すること(未設定だと FAB が丸くならない)。
- 移行処理(`saved.theme === 'dark' && themeVersion !== 3` → `'note'`、HTML:2056-2059)は
  保存値側の話なので CSS には影響しない。

---

## 2. 移植しなかったルール / 解消した食い違い

### 2.1 死にルール 4 件を不採用(spec Q17)

該当箇所にはレガシー原文をコメントで残してある(`grep '死にルール'` で全件出る)。

| # | レガシー | 行 | 理由 |
|---|---|---|---|
| 1 | `::selection{background:color-mix(in srgb,var(--acc) 30%,transparent);color:var(--tx0)}` | HTML:180 | `--acc`/`--tx0` はルート要素で未定義。`color-mix()` が無効値になりブラウザ既定の選択色になる |
| 2 | `[data-theme="dark"] .compass-shell::before{background:linear-gradient(90deg,…)}`(綴じ線) | HTML:326-328 | 後段 `.compass-shell::before{background:…!important}`(HTML:556-559)に負けて一度も表示されない |
| 3 | `.compass-nav>[style*="position:absolute"]{display:none!important}` | HTML:267 | React は `position: absolute`(スペース付き)で直列化するため一致しない。**モバイルでもナビのリサイズハンドルは残る**のが正しい挙動 |
| 4 | `.app-top-actions sc-if{display:none!important}` | HTML:279 | `<sc-if>` は DOM に出ない |

5件目の死にルール(HTML:1601 の `style-hover="border-color:{{ edPlanActionHover }};…"`)は
スタイルシートではなく**テンプレート属性**。`{{ }}` を含むため CSS として無効 = hover 効果なし。
→ Phase 2B で「計画アクションボタンに hover スタイルを付けない」ことで再現する
(`[D]` のユーティリティクラスを**付けない**)。

### 2.2 68px / 70px の食い違いを 70px に統一(spec Q18)

```css
/* レガシー HTML:229 */ .cockpit-panel{ height:calc(100vh - 68px); }
/* 移植版           */ .cockpit-panel{ height:calc(100vh - 70px); }
```

トップバーの実効 `min-height` は 70px(HTML:628 が HTML:216 の 68px を上書き)。
コックピットのパネルが 2px 分だけ余分に高くなる不具合を解消した。
デスクトップ(>1180px)でのみ効く値。1180px 以下では `height:auto` になるので影響しない。

### 2.3 その他の「癖」は**そのまま移植**した

architecture §4 の指示どおり、Q17 の 5 件以外は死にコードでも残してある。
Phase 2B で「消えている」ように見えても仕様。

- `@keyframes slideIn` は未使用
- `--ink-rad-sm` / `--paper-soft` / `--graphite` は定義のみで未使用
- `.nav-dot{display:none!important}` — テンプレートの `<span class="nav-dot">` は常に不可視
  (span 自体は出力すること。`.app-nav-item span` の mobile ルールの子数に関係する)
- `.compass-theme-mode[data-theme="note"] .cockpit-panel-title>div:first-child` は
  `.cockpit-panel-title` の子が全部 `<span>` なので一致しない(§7 参照)
- `.mini-day-mobile{color-scheme:dark}` はライトテーマでも dark 固定

---

## 3. `>span:nth-child(n)` の置換(C-508 / spec Q41)

レガシーでは support.js の `walkText` が `{{ }}` を `<span class="sc-interp">` に包んでいたため、
モバイルのカード化 CSS が**子要素の並び順**に依存できた。React ネイティブ実装では
テキスト補間が要素を生まないので、**セルへ明示クラスを振る形に書き直した**。
grid-area / grid-column / grid-row / 表示は完全に同一。

### 3.1 `.review-table-row`(HTML:301 → globals.css `[C]` の 820px ブロック)

セルには **`rt-cell` と `rt-cell-<名前>` の両方**を付ける。
`rt-cell` は `data-label` の見出し擬似要素(`::before`)のフックなので省略不可。

| 旧セレクタ | 新クラス | grid-area | `data-label` | 中身(HTML:1541-1553) |
|---|---|---|---|---|
| `>span:nth-child(1)` | `.rt-cell.rt-cell-subj` | `subject` | — | 教科ピル |
| `>span:nth-child(2)` | `.rt-cell.rt-cell-title` | `title` | — | タスク名 + 時間割バッジ |
| `>span:nth-child(3)` | `.rt-cell.rt-cell-last` | `last` | `前回` | 前回日 |
| `>span:nth-child(4)` | `.rt-cell.rt-cell-next` | `next` | `次回` | 次回復習日 |
| `>span:nth-child(5)` | `.rt-cell.rt-cell-round` | `round` | `復習回` | 復習回ピル |
| `>span:nth-child(6)` | `.rt-cell.rt-cell-stage` | `stage` | `間隔` | 間隔ラベル |
| `>span:nth-child(7)` | `.rt-cell.rt-cell-status` | `status` | `状態` | 状態バッジ |
| `>span:nth-child(8)` | `.rt-cell.rt-cell-actions` | `actions` | — | ＋今日へ / 完了 / ⋯ |

```css
.review-table-row>.rt-cell[data-label]::before{content:attr(data-label);…}
```

- **DOM の並び順は上表のまま**にすること(デスクトップは `grid-template-columns` の
  `86px minmax(200px,1fr) 84px 96px 68px 86px 72px 158px` に順番で流し込まれるため)。
- `data-label` 属性は 3〜7 番目にだけ付ける(レガシーどおり)。
- `.review-table-head` はモバイルで `display:none`。クラスは不要だがデスクトップの
  grid-template-columns はセル側と揃えること。
- `.review-divider` は行の**兄弟**として出す(行の中に入れない)。

```tsx
<div className="review-table-row hv-bg3" style={{ /* インライン: grid-template-columns など */ }}>
  <span className="rt-cell rt-cell-subj">…</span>
  <span className="rt-cell rt-cell-title">…</span>
  <span className="rt-cell rt-cell-last" data-label="前回">…</span>
  <span className="rt-cell rt-cell-next" data-label="次回">…</span>
  <span className="rt-cell rt-cell-round" data-label="復習回">…</span>
  <span className="rt-cell rt-cell-stage" data-label="間隔">…</span>
  <span className="rt-cell rt-cell-status" data-label="状態">…</span>
  <span className="rt-cell rt-cell-actions">…</span>
</div>
```

### 3.2 `.score-group-row`(HTML:305 → 同ブロック)

こちらは `data-label` を使わないので `sg-cell-<名前>` 1 個でよい。

| 旧セレクタ | 新クラス | モバイル配置 | 中身(HTML:1300-1305) |
|---|---|---|---|
| `>span:nth-child(1)` | `.sg-cell-subj` | `grid-column:1;grid-row:1/3` | 教科ピル |
| `>span:nth-child(2)` | `.sg-cell-name` | `grid-column:2;grid-row:1` | テスト名 |
| `>span:nth-child(3)` | `.sg-cell-meta` | `grid-column:2;grid-row:2` | `{n}件 · 最新 {lastDay}` |
| `>span:nth-child(4)` | `.sg-cell-delta` | `grid-column:3;grid-row:2` | 前回差 |
| `>span:nth-child(5)` | `.sg-cell-score` | `grid-column:3;grid-row:1` | 最新点 |
| `>span:nth-child(6)` | `.sg-cell-arrow` | `display:none` | `→`(モバイルでは隠す) |

**DOM 順は 1→6 のまま**。デスクトップは `display:flex` で並び順がそのまま見た目になる。

---

## 4. support.js が注入していた CSS の扱い

spec §1.6 の head 内 CSS 5 系統のうち、移植版で意味があるものだけを `[B]` / `[D]` に取り込んだ。

| 出所 | 内容 | 扱い |
|---|---|---|
| `SUP:1578-1581` | `x-dc{display:none!important}` | **不採用** — `<x-dc>` は存在しない |
| `SUP:86-118` BASE_CSS | `.sc-placeholder` / `.sc-interp` / `.sc-logic-error` / `@keyframes sc-shine` / `html.sc-dc-streaming` | **不採用** — dc-runtime 内部クラス。対象要素が生成されない |
| `SUP:119-131` BASE_CSS | `@media print` ベースライン | **移植**(`[B]`)。印刷時の実効値なので落とせない |
| `SUP:132` FULL_PAGE_CSS | `html,body{height:100%;margin:0}` / `#dc-root,#dc-root>.sc-host{height:100%}` | **移植**(`[B]`)。`html,body` は HTML:17 と重複、ルートは `.compass-root` に読み替え |
| `SUP:1237-1240` ATOMIC_CSS | `.fx .col .grid …` | **不採用** — テンプレートで 1 個も使っていないことを grep で確認済み |
| `SUP:1357-1375` createPseudoSheet | `style-hover` / `style-focus` の動的ルール | **移植**(`[D]`。§6 参照) |

### `.compass-root`

`#dc-root`(dc-runtime が作っていた React マウント先)に相当する**アプリ最上位ラッパー**の
クラス名。`height:100%` と印刷時の `height:auto` を持つ。

```tsx
// CompassApp.tsx のルート
<div className="compass-root">
  <div className="compass-theme" …>
```

`html,body{height:100%}` は `[C]`(HTML:17)にあるので、間に高さを渡す要素があれば
そこにも `height:100%` が要る。Next.js App Router は `<body>` 直下に children を置くため、
`.compass-root` が 1 枚あれば足りる。

---

## 5. layout.tsx に必要な `<link>`(**未実装 / TASK F8 の範囲外**)

architecture Q26 の決定どおり `next/font` は使わず、レガシーと同じ Google Fonts の
`<link>` を維持する。**現状の `src/app/layout.tsx` L33-36 のフォント URL は
Space Grotesk と Noto Sans JP 900 を読んでいないので、下記に差し替えが必要。**

```tsx
{/* レガシー HTML:14-15 と同一のウェイト構成 */}
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
<link
  href="https://fonts.googleapis.com/css2?family=Klee+One:wght@400;600&family=Noto+Sans+JP:wght@400;500;700;900&family=Space+Grotesk:wght@500;700&display=swap"
  rel="stylesheet"
/>
```

- ウェイトは **Klee One 400/600 / Noto Sans JP 400/500/700/900 / Space Grotesk 500/700**、`display=swap`。
- **Space Grotesk 600 は絶対に追加しないこと。** レガシーは 500/700 しか読み込んでおらず、
  `font:600 … var(--font-num)` を指定した箇所(`.app-nav-item__key` / `.app-nav-item__badge` /
  `.panel-heading__meta` / `.nav-shortcuts kbd` / `.nav-cloud` / `.mini-day-mobile` ほか)は
  ブラウザの合成/丸めになる。600 を読むと**その部分だけ字面が変わる**(spec §3.12-10 / C 項目)。
- `preconnect` はレガシーが googleapis のみ、現行ホストが googleapis + gstatic。
  描画には影響しないので**現行の 2 本のまま**でよい。
- `<meta name="theme-color" content="#100f0c">` と favicon
  `/compass-icon.svg?v=20260728-ink` は既に `layout.tsx` の `metadata` / `viewport` にある。
- `:root{color-scheme:dark}`(HTML:176)は `[C]` に移植済みで**テーマに関わらず常に dark**。
  ライトテーマの `<input type="date">` はレガシー同様、要素ごとに
  `style={{ colorScheme: light ? 'light' : 'dark' }}` を当てて上書きすること(HTML:4198)。

---

## 6. `style-hover` / `style-focus` の代替ユーティリティ(`[D]`)

レガシーでは `style-hover="…"` 属性を support.js が `.scpN:hover{…}` として
実行時に `insertRule` していた(head の最後、`!important` なし・詳細度 1 クラス)。
移植版では**同じ宣言・同じ詳細度・同じカスケード位置**の静的クラスに置き換えた。

行番号は **v0.9 適用後の現在の `Compass App.dc.html`**(4445行)基準。

| クラス | 宣言 | 使う場所(HTML 行) |
|---|---|---|
| `.hv-pink-text` | `color:var(--pink);background:var(--pinkBg)` | 削除ボタン 5箇所: カウントダウン 897 / Add のミニ行 1452 / エディタのミニ 1621 / 点数行 1683 / Review 完全削除 1728 |
| `.hv-acc-outline` | `border-color:var(--acc);color:var(--acc)` | 「ToDo画面で実行する →」989 / データ画面のエクスポート 1325, 1326 |
| `.hv-bg3` | `background:var(--bg3)` | `.plan-sticky-cell` 1097 / `.review-table-row` 1540 |
| `.hv-bright` | `filter:brightness(1.3)` | タイムラインのセグメント 1109 |
| `.hv-pink-outline` | `border-color:var(--pink);color:var(--pink);background:var(--pinkBg)` | 選択タスク削除 1201 |
| `.hv-bg3-line2` | `background:var(--bg3);border-color:var(--line2)` | `.score-group-row` 1299 |
| `.hv-acc-border` | `border-color:var(--acc);color:var(--tx0)` | Review 行末の `⋯` 1552 |
| `.hv-pink-border` | `border-color:var(--pink);color:var(--pink)` | 今日のToDoから外す 1674 |
| `.hv-grn-border` | `border-color:var(--grn);color:var(--grn)` | 復習完了にする 1676 |
| `.fc-acc` | `border-color:var(--acc)` | 入力・選択の既定 16箇所: 901, 903, 1223, 1312, 1314, 1316, 1317, 1381, 1390, 1445, 1461, 1598, 1599, 1601, 1603, 1636 |
| `.fc-acc-glow` | `border-color:var(--acc);box-shadow:var(--gAcc)` | タスク名 1361 / 教科 1366 / 時間割の教科 input 1490 |
| `.fc-acc-underline` | `border-bottom:1px dashed var(--acc)` | ミニタスク名のインライン編集 1616 |

**再現しておくべき性質**:

- `!important` を持たず詳細度も 1 クラス。→ note テーマの入力欄
  `.compass-theme-mode[data-theme="note"] input{border-color:…!important}`(HTML:383-397)には**負ける**。
  つまり note テーマでは `.fc-acc` 系の focus 枠色は出ない。これが正しい挙動。
- HTML:1601(計画アクションボタン)は `{{ }}` 入りで CSS として無効だったため、
  **どのユーティリティも付けない**。

---

## 7. コンポーネントが守るべき DOM 構造(構造セレクタ一覧)

`>span:nth-child(n)` 以外にも、**要素の型と位置に依存するルール**が残っている。
Phase 2B で構造を変えると静かに壊れるので、下表の前提を守ること。

| セレクタ(globals.css の行) | 前提 |
|---|---|
| `.app-view-title>div:first-child`(479) / `>div:last-child`(540) | `.app-view-title` の子は `<div class="app-view-title__name">` → `<div class="app-view-title__sub">` の 2 個ちょうど。**両方 `<div>`**。⚠ 詳細度 (0,2,1) の `>div:first-child{font-size:16px!important}` が (0,1,0) の `.app-view-title__name{font-size:18px!important}` に**勝つ**ので実効 16px。レガシーどおり |
| `.app-nav-item span`(537, mobile) | ナビ項目の子は全部 `<span>`(`.nav-dot` / `__label` / `__badge` / `__key`)。⚠ (0,1,1) の `font-size:9px!important` が (0,1,0) の `.app-nav-item__label{font-size:9.5px!important}` に勝ち、`flex:none!important` はインライン `flex:1` にも勝つ。実効 9px / flex:none |
| `.compass-theme-mode[data-theme="note"] .compass-brand>div:first-child`(615) | `.compass-brand` の最初の `<div>` は `.compass-brand__mark`(`.compass-brand__chevron` は `<span>`) |
| `.cockpit-panel-title>div:first-child`(649) | `.cockpit-panel-title` の子は全部 `<span>` なので**一致しない**(死にルール相当。Q17 の 5 件外なのでそのまま移植) |
| `.theme-switch>span`(889-890) | テーマ切替の 3 項目は `<span>` 直下 |
| `.app-progress>span`(921) | 進捗バーの中身は `<span>` 1 個(`--done` を style で渡す) |
| `.empty-note b` / `.empty-note span`(947-948) | 空状態は `<b>`(見出し)+ `<span>`(補足) |
| `.todo-summary>div:nth-child(2)`(556, mobile) | ドーナツ `<div>` → テキスト列 `<div>` → `.focus-launch` `<button>` の順 |
| `.plan-sticky-cell>div:nth-child(2)`(563, mobile) | 1行目(計画名)`<div>` → 2行目(メタ)`<div>` |
| `.plan-controls>div`(557) / `.plan-overdue>button`(558) | 直下の子の型 |
| `[data-screen-label="ToDo"]>div` / `="Data"]>div` / `="Add"]>div>div`(553-555) | 画面直下のブロックは `<div>` |
| `.todo-summary linearGradient stop:first-child` / `:last-child`(956-957) | ToDo ドーナツの `<linearGradient id="cmpGrad">` は stop 2 個。`--view` 連動はこの CSS が担当するので、stop-color のインライン指定(`#4fd8e8` / `#8a6cf5`)はレガシーどおり残してよい(CSS が上書きする) |
| `.compass-splash__word span`(415) | ロゴタイプは 1 文字 1 `<span>`(`--li` を style で渡す) |
| `[data-screen-label="…"]`(画面ルート) | `Cockpit` / `Tests` / `ToDo` / `Review` / `Data` / `Add` の 6 値。`inkIn` アニメと mobile padding のフック |
| `.compass-shell[data-screen-label="Compass"]` | シェル自身も `data-screen-label` を持つ(`[data-screen-label]{animation:none!important}` の reduced-motion ルールに関係) |

その他、クラス名は**レガシーと完全に同一**なので、テンプレート(HTML:786-1880)の
`class="…"` をそのまま `className` に移せばよい。インラインスタイルもレガシーの
`style="…"` をそのまま移すことでカスケードが一致する(多くのルールが
`!important` でインラインに勝つ/負ける前提で書かれている)。

---

## 8. `[A]` ホスト UI 側の差分(移行期のみ)

iframe を廃止して**同一ドキュメント**になったため、ホスト側の CSS がアプリへ漏れないよう
3 点だけ手を入れた(いずれもアプリの見た目には影響しない)。

| 旧 `globals.css` | 変更 | 理由 |
|---|---|---|
| `*{ -webkit-tap-highlight-color:transparent }` | `.auth-screen *` に限定 | レガシーの iframe 内にはこの指定が無く、アプリ側のタップハイライト挙動が変わってしまうため |
| `button{font-family:inherit;cursor:pointer}` / `input{font-family:inherit}` | `.auth-screen button` に限定 | 同上。アプリ側は `[C]` の `button,input,select,textarea{font:inherit}`(HTML:178)が担当 |
| `html,body` の `background-image`(罫線)と `--rule` トークン | 削除 | `.auth-screen` が同じ罫線背景を自前で持っており重複。`--rule` は note テーマがアプリ側で再定義するため紛らわしい |

削除したもの: 旧 `globals.css` L219-889 の `.app` / `.tab-bar` / `.task-card` / `.period-row` /
`.sheet-*` / `.settings-*` などは、コミット `36ab1de`「chore: remove unused React implementation」で
消えた旧 React 実装の残骸で、現在どこからも参照されていない(`grep className src/` で確認済み)。
`.screen-loading` も同様に未使用のため削除。

残した移行用クラス: `.auth-screen` `.auth-panel` `.auth-brand` `.auth-button` `.auth-footnote`
`.auth-error` `.auth-loading` `.legacy-shell` `.legacy-frame`。
`AppShell.tsx` を `components/auth/AuthScreen.tsx` へ移植し iframe を落としたら、
`.legacy-shell` / `.legacy-frame` は削除してよい。

---

## 9. 検証済みの項目

- `postcss.parse()` で構文エラーなし(497 ルール / 1521 宣言)。
- `[C]` 節 と レガシー L17-782 の `diff`: §1〜§3 の 4 件以外の差分 **0 行**。
- `data-theme` セレクタ: `note` 63 / `light` 19(レガシーの `dark` 64 のうち 1 件は §2.1-2 で削除、
  残り 63 を `note` にリネーム)。
- `>span:nth-child(n)` の残存 **0 件**。残る `nth-child` は `div` 対象の 2 件のみ(§7)。
- ATOMIC_CSS のクラス(`.fx` `.col` …)がテンプレートで未使用であることを grep で再確認。
