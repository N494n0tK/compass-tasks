# Compass アプリ完全仕様（レガシー版の記録）

> 対象: `/Users/nagano/Documents/_01_Claude_Code/00_Compass_v2/Compass App.dc.html`（全 4262 行）、
> `/Users/nagano/Documents/_01_Claude_Code/00_Compass_v2/support.js`（1664 行）、
> `/Users/nagano/Documents/_01_Claude_Code/00_Compass_v2/src/app/AppShell.tsx`（639 行）。
>
> 行番号表記: `HTML:1234` = `Compass App.dc.html`、`SUP:123` = `support.js`、`SHELL:123` = `AppShell.tsx`。
> 行番号のみの記述はすべて `Compass App.dc.html`。
> 本書は Next.js/React での 1:1 再実装（アプリは完全再現）のための唯一の参照仕様である。
>
> **`(v0.9 追加)` / `(v0.9 変更)` / `(v0.9 修正)` タグ**: 初版（v0.8 時点のコード）を書いたあとに
> `feat/app-enhancements` で入った差分（`f4799ce` 不具合修正6件 / `be2f44e` 復習UX / `4796eeb` データ画面 / `217fc9d` エクスポート）。
> **書き換え版はタグ付きの側（＝現在のコード）を再現する。** 旧挙動は経緯として併記してあるだけで、再現対象ではない。
> パリティ項目は §10.18（C-517〜C-563）にまとめてある。なお `f4799ce` 以降も**行番号は初版のまま**なので、
> タグ付き箇所の再検索キーには行番号ではなく識別子（例 `const shiftDue =`）を使うこと。
> ナビ最下部のバージョン表記は `Compass v0.8` のまま変更していない（C-43）。

---

## 1. 概要とアーキテクチャ

### 1.1 現状の構成

```
Next.js (src/app/AppShell.tsx)
 ├ Firebase Auth（Google サインイン）→ AuthScreen
 ├ Firestore ブリッジ（window.COMPASS_CLOUD_GET / COMPASS_CLOUD_PUT / COMPASS_MIGRATE_REVIEWS）
 └ <iframe class="legacy-frame" srcDoc={framedDoc}>          … SHELL:571, 574-578
      framedDoc = srcDoc.replace("<head>", "<head>" + injectedSessionScript(email))
        ├ injectedSessionScript  … window.COMPASS_USER_EMAIL 定義 + window.fetch パッチ  SHELL:183-236
        ├ <script src="./support.js">  … dc-runtime（HTML:9）
        └ <x-dc> テンプレート（HTML:786-1880） + <script type="text/x-dc" data-dc-script>（HTML:1882-4260）
```

**置き換え対象の明確化**

| 層 | 実体 | 書き換え後 |
|---|---|---|
| dc-runtime（`support.js`） | `<sc-for>` / `<sc-if>` / `{{ }}` を React 要素へコンパイルする独自ランタイム。React 18.3.1 UMD を unpkg から SRI 付きでロード | **完全に廃棄**。ネイティブ React に置換。ただし §9 の「副作用として再現が必要な挙動」だけは保つ |
| `<x-dc>` テンプレート | HTML:786-1880 | React コンポーネント群へ |
| `<script data-dc-script>` | `class Component extends DCLogic`（HTML:1953-4260） | React state / hooks へ（`this.PLANS` の扱いに注意、§4.2） |
| iframe + fetch パッチ | `SHELL:183-236, 571` | **不要**。`/api/app-state` を実 API か Firestore 直叩きに |
| AuthScreen / Firestore | `SHELL` 全般 | 維持 |

### 1.2 起動シーケンス（完全）

1. `support.js` が `<style>x-dc{display:none!important}</style>` を head に append（`SUP:1578-1581` `hideRawTemplate`）。
2. `loadReactUmd()`（`SUP:1596`）→ 既に `window.React && window.ReactDOM` があれば即 resolve。無ければ unpkg から並列ロード:
   - `https://unpkg.com/react@18.3.1/umd/react.production.min.js` SRI `sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z`
   - `https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js` SRI `sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1`
   - `crossOrigin="anonymous"`, `async=false`（`SUP:1583`）→ **旧アプリはオフラインでは起動しない**。
3. `init()`（`SUP:1604`）→ `createRuntime(document)` / `BASE_CSS` を `head.prepend` / `window` に API を生やす / `__dcBoot()`。
4. `boot()`（`SUP:150`）:
   - `parseDcDocument` で `<x-dc>` の innerHTML と `data-props` を取得。
   - `<x-dc>` を `<div id="dc-root">` に **replaceWith**。
   - `data-props` に `$preview` があるため（HTML:1882）**`FULL_PAGE_CSS` は注入されない**（`SUP:167`）。高さは helmet 内の `html,body{margin:0;padding:0;height:100%}`（HTML:17）と `.compass-shell{height:100vh}`（HTML:788）が担う。
   - `StandaloneRoot` が props の既定値 `glow=3` / `radius=12` / `accent='#3d3629'` を注入（`SUP:183-192`）。
5. `Component.constructor`（HTML:1954-2049）: `Asia/Tokyo` の `en-CA` で today を確定 → `this._base` / `this.TODAY` / `this.YESTERDAY` / `this.DAYS`（13日分）/ `this.DIDX` / `this.SUBJ` / `this.SIZE_MIN` / `this.APP_CATALOG` / `this.TIMETABLE` / `this._palette` / `this.state`。
6. 初回 render → スプラッシュ表示開始（CSS アニメーション）。
7. `componentDidMount`（HTML:2051-2109）:
   - `this._splashStart = Date.now()`（HTML:2052）
   - `localStorage['compass-ui']` から `theme` / `themeVersion` / `panelW` を復元（HTML:2054-2070）
   - `localStorage['compass-ui-data']` を `dataPatch()` に通して初期 state に `Object.assign`（HTML:2071-2074）
   - `window.addEventListener('keydown', this._key)`（HTML:2100）
   - `ready()` コールバックで `_saveReady = true` → `resetUndoBaseline()` → `loadCloudState()`（HTML:2101-2108）
8. `loadCloudState()`（HTML:2248-2275）→ `fetch('/api/app-state', {cache:'no-store'})`。全経路の末尾で `notifyReady()`。
9. `notifyReady()`（HTML:2277-2285）: 経過時間に関わらず **componentDidMount から最低 2900ms** 待ってから `.compass-splash` に `compass-splash--ready` を付与、加えて `window.parent.postMessage({type:'compass-ready'}, '*')`。

```js
notifyReady() {
  const elapsed = Date.now() - (this._splashStart || Date.now());
  clearTimeout(this._splashReadyTimer);
  this._splashReadyTimer = setTimeout(() => {
    const splash = document.querySelector('.compass-splash');
    if (splash) splash.classList.add('compass-splash--ready');
  }, Math.max(0, 2900 - elapsed));
  try { window.parent.postMessage({ type:'compass-ready' }, '*'); } catch (e) {}
}
```

### 1.3 iframe ブリッジ（`/api/app-state` の実体）

`injectedSessionScript(email)`（`SHELL:183-236`）が `<head>` 直後に注入され、**`support.js` より先に**実行される。

- `window.COMPASS_USER_EMAIL = <email>` を定義 → アプリ側 HTML:2044 が `cloudUser` の初期値に使う。
- `window.fetch` を差し替え、`new URL(rawUrl||'/', parent.location.href).pathname === '/api/app-state'` のときだけ横取り。
- `waitForBridge(name)`: `parent[name]` が関数になるまで **50ms × 最大60回（≒3秒）** ポーリング。超過で `Error(name + '_unavailable')`。
- `PUT` → `JSON.parse(init.body).data` を `COMPASS_CLOUD_PUT` へ渡し、戻り値を **status 200** で返す。
- `GET` → `COMPASS_CLOUD_GET()` の戻り `{data, email}` を **status 200** で返す。
- 例外時 → `{error: code||message||'firebase_bridge_failed'}` を **status 500** で返す。

> **重要**: このブリッジは 200 か 500 しか返さない。したがってアプリ側 `loadCloudState` の
> `401|403 → cloudStatus:'login'` と `503 → cloudStatus:'local'` の分岐は、
> **AppShell 経由では到達しない**（500 は `!res.ok` → catch → `'local'`）。
> 書き換え後に実 API を作る場合、この2分岐を活かすかどうかは設計判断。

**Firestore 側のドキュメント構造**

- メイン: `users/{uid}/settings/compass-ui-data`
  - `data`: `exportData()` の戻り（`{version, plans, state}`）
  - `email`: `user.email ?? ""`
  - `updatedAt`: `new Date().toISOString()`
  - 任意: `reviewsMigratedAt`（ISO 文字列。付いていれば移行済み）
- サブコレクション: `users/{uid}/reviewTasks/{review.id}` — review 本体 + `_seq: number`（配列内の位置）
- `firestoreSafeData = JSON.parse(JSON.stringify(data))` → `undefined` フィールドは落ちる。
- `invalidDocIdReason(id)`（`SHELL:113-123`）: 文字列でない / 空 / 半角スペースのみ / `/` を含む / `.` `..` / `__…__` / UTF-8 が `DOC_ID_MAX_BYTES` 超 → 不正。1件でも不正なら **1件も書かずに中断**。
- 移行済みなら GET 時に `state.reviews` をコレクションの内容で**丸ごと差し替え**（`SHELL:344-352`）。読めなければ埋め込み側にフォールバックし、baseline は無効化。
- PUT は `merge` を使わない**全置換**（`SHELL:385-393` のコメント: merge はネストしたマップを再帰マージするため `plans` / `dayOverrides` / `scores` / `studyLog` / `countdowns` / `planQuota` からキーを消せなくなる）。
- `COMPASS_MIGRATE_REVIEWS()` は**自動実行されない**。コンソールから `await COMPASS_MIGRATE_REVIEWS()` を1回だけ手動実行する運用（`SHELL:513-554`）。`reviewsMigratedAt` があればスキップ、`reviews` が0件でも中断（フラグを立てない）。

### 1.4 ランタイム前提（React 移植で効く挙動）

| 挙動 | 実装 | 移植時の意味 |
|---|---|---|
| `<sc-if value="{{x}}">` は truthy のときだけ子を**マウント** | `SUP:557-571` `walkIf` | 画面切替は「非表示」ではなく**アンマウント**。**スクロール位置は必ず先頭へ戻る** |
| `<sc-for list as>` の React key は**配列 index** | `SUP:522-556` | 並び替え時の DOM 再利用挙動 |
| `hint-placeholder-count` / `hint-placeholder-val` はストリーミング専用 | `SUP:540, 564` | 通常描画では無視。移植不要 |
| `{{ }}` テキストは `<span class="sc-interp">` に包まれる | `SUP:518` | `:nth-child` / flex レイアウトに影響（§9.3） |
| 改行だけのテキストノードは削除、スペース入り空白は残る | `SUP:483` | 微妙な余白差 |
| `value` / `checked` が `undefined` → `''` / `false` | `SUP:709-711` | 常に controlled input |
| `style-hover` / `style-focus` → `.scpN:hover{…}` を `insertRule` | `SUP:403-406, 1357-1375` | `!important` なし・詳細度は1クラス（§3.9） |
| `setState` が **同期的に** `logic.state` を書き換える | `SUP:872-877` | `setState` 直後に `this.state` を読むと新値。アプリはこれに依存 |
| updater が `null` を返すと無変更 | 同上（`{...prev, ...null}`） | `addToOrder`（HTML:2546-2548）が利用 |
| `componentDidUpdate` が**毎レンダー**呼ばれる | `SUP:906-923` | Undo スナップショット判定 + `scheduleSave()` のトリガ |
| `<helmet>` の中身が `document.head` へ移送 | `SUP:1301-1352` | Google Fonts link + 巨大な `<style>` |

```js
// SUP:872-877 — 移植で最重要
__setLogicState(update, cb) {
  const prev = this.logic.state;
  const patch = typeof update === "function" ? update(prev) : update;
  this.logic.state = { ...prev, ...patch };          // 同期的に即反映
  this.setState((s) => ({ __v: s.__v + 1 }), cb);    // React には tick だけ通知
}
```

### 1.5 props（`data-props`, HTML:1882）

| prop | editor | default | 範囲 | 用途 |
|---|---|---|---|---|
| `glow` | range | `3` | 0–10 | `glow = clamp(0,10,v)/3` → 既定 1。`gl()` の発光量 |
| `radius` | range | `12` | 6–24 | `--rad`（JS 側フォールバックは 14, HTML:2581） |
| `accent` | color | `#3d3629` | options `#3d3629,#1f4f63,#6a4ac2,#a56717` | **light テーマの `--acc`/`--grad` のみ** |

`gl(col, base)`（HTML:2583）:
```js
glow === 0 ? 'none'
  : '0 0 ' + Math.round(base*glow) + 'px color-mix(in srgb, ' + col + ' ' + Math.round(30*Math.min(glow,2)) + '%, transparent)'
```
UI からは変更できない。`$preview:{width:1440,height:900}` は `$` 始まりなので props から除外される（`SUP:56-74`）。

### 1.6 head に入る CSS の順序

| # | 出所 | 内容 |
|---|---|---|
| 1 | `SUP:1578-1581` | `x-dc{display:none!important}` |
| 2 | `SUP:86-131` `BASE_CSS`（**prepend**） | `.sc-placeholder` / `.sc-interp` / `@keyframes sc-shine` / `.sc-logic-error` / `@media print` ベースライン |
| 3 | `SUP:1237-1240` `ATOMIC_CSS` → `<style id="__dc-atomics">` | `.fx .col .grid …` — **アプリは1つも使用していない** |
| 4 | helmet 内の `<link>`（HTML:14-15）と `<style>`（HTML:16-783） | Google Fonts + アプリ本体 CSS |
| 5 | `SUP:1357-1375` `createPseudoSheet` | `style-hover` / `style-focus` の動的ルール |

### 1.7 その他の head 要素

- `<meta name="theme-color" content="#100f0c">`（HTML:6）
- `<title>Compass</title>`（HTML:7）
- favicon `/compass-icon.svg?v=20260728-ink`（HTML:8）
- `:root{color-scheme:dark}`（HTML:176）— テーマに関わらず常に dark

---

## 2. 画面構成とナビゲーション

### 2.1 DOM 骨格（最上位）

```
<div class="compass-theme" style="--bg0…--sj-steel; font-family:'Noto Sans JP',system-ui,sans-serif">   HTML:786
  <div class="compass-theme-mode" data-theme="{{themeName}}" style="{{themeStyle}}">                     HTML:787
    <div class="compass-shell" data-screen-label="Compass" data-view="{{viewId}}"
         style="display:flex;height:100vh;background:var(--bg0);color:var(--tx1);overflow:hidden">        HTML:788
      <div class="compass-splash" aria-hidden="true">…</div>                                             HTML:789-860
      <div class="compass-nav" …>…</div>                                                                 HTML:863-918
      <div class="compass-main" style="flex:1;display:flex;flex-direction:column;min-width:0">           HTML:921
        <div class="compass-topbar">…</div>                                                              HTML:922-965
        <sc-if isCockpit> .cockpit-grid[data-screen-label="Cockpit"]                                     HTML:968-1039
        <sc-if isTests>   div[data-screen-label="Tests"]                                                 HTML:1042-1121
        <sc-if isTodo>    div[data-screen-label="ToDo"]                                                  HTML:1124-1233
        <sc-if isData>    div[data-screen-label="Data"]                                                  HTML:1236-1292
        <sc-if isAdd>     div[data-screen-label="Add"]                                                   HTML:1295-1463
        <sc-if isReview>  div[data-screen-label="Review"]                                                HTML:1466-1520
      </div>
    </div>
    <!-- ↓ overlay 群は .compass-shell の「外」・.compass-theme-mode の直下 -->
    <sc-if editorOpen>      ミニタスク編集ドロワー          HTML:1525-1605
    <sc-if revDetailOpen>   復習詳細ドロワー                HTML:1608-1647
    <sc-if scOpen>          点数推移ドロワー                HTML:1650-1694
    <sc-if redistOpen>      再配分モーダル                  HTML:1697-1775
    <sc-if askOpen>         理解度モーダル                  HTML:1778-1812
    <sc-if focusOpen>       集中モード                      HTML:1815-1825
    <sc-if appSwitcherOpen> アプリスイッチャー              HTML:1828-1863
    <sc-if tooltip>         ツールチップ                    HTML:1866-1871
    <sc-if toast>           トースト                        HTML:1874-1876
  </div>
</div>
```

overlay 群は `.compass-shell`（`overflow:hidden` / `isolation:isolate`, HTML:181）の**外側**にあるため、`position:fixed` が shell のスタッキングコンテキストに閉じ込められない。

**テンプレート上の画面 DOM 順**は `Cockpit → Tests → ToDo → Data → Add → Review`。ナビの既定順（`cockpit,tests,todo,review,add,data`）とは異なるが、同時に1画面しか描画されないため実害はない。

### 2.2 スプラッシュ（起動アニメーション）

`div.compass-splash[aria-hidden="true"]`（HTML:789）> `div.compass-splash__stage`（HTML:790）の中に:

1. `div.compass-splash__glow`（HTML:791）— conic-gradient + blur(30px)、`spBloom 2.1s ease-out both`。**note / light テーマでは `display:none`**（HTML:505, 730）。
2. `svg.compass-splash__build[viewBox="0 0 512 512"]`（HTML:792-829）— 製図レイヤー、`z-index:1`、`spBuildOut 2.35s ease both`
   - `defs`: `clipPath#spDialClip`（circle r=196）、`linearGradient#spSweepGrad`（`stop.sp-sweep-a` / `stop.sp-sweep-b`）
   - `line.sp-guide.sp-guide--h`（8,256→504,256）、`line.sp-guide.sp-guide--v`（256,8→256,504）
   - `circle.sp-guide-ring`（r=231）、`circle.sp-ticks`（r=212, `stroke-width:13`, `stroke-dasharray:3.6 33.4` = 36本）
   - `circle.sp-rim.sp-rim--under`（r=190, sw=34, opacity .9）、`circle.sp-rim.sp-rim--ink`（r=190, sw=23, `stroke-dasharray:1194`）
   - `circle.sp-face`（r=137, sw=4）
   - `g[clip-path=url(#spDialClip)] > g.sp-sweep > path.sp-sweep-wedge`（`M256 256 452 256A196 196 0 0 0 368.4 95.4Z`）+ `line.sp-sweep-edge`
   - `circle.sp-ring`（r=113, `--ring-len:710`, sw=3）/ `.sp-ring--mid`（r=82, 516, sw=7）/ `.sp-ring--in`（r=54, 340, sw=7）
   - `text.sp-card` × 4: **N**(256,100 `--ci:0`) / **E**(412,256 `--ci:1`) / **S**(256,412 `--ci:2`) / **W**(100,256 `--ci:3`)、`font:700 23px 'Space Grotesk'`, `letter-spacing:.04em`
   - `g.sp-needle > path.sp-needle-n`（`M280 233 333 120 226 286Z`, fill `--sp-accent`, stroke `--sp-pin-ring` 8）+ `path.sp-needle-s`（`M228 280 175 393 282 227Z`, fill `--sp-warm`, stroke `color-mix(in srgb,var(--sp-warm) 42%,var(--sp-pin))` 6）
   - `circle.sp-pin-pulse`（r=26, sw=3）、`g.sp-pin > circle.sp-pin-body`（r=25, sw=9）+ `circle.sp-pin-dot`（r=8）
3. `svg.compass-splash__mark`（HTML:830-856）— 完成マーク、`z-index:2`、`spMarkSet 2.35s cubic-bezier(.2,.8,.2,1) both`。`radialGradient#mkFace`（`translate(210 196) rotate(48) scale(210)`、stop `--sp-face`→`--sp-pin`）、`.mk-ticks` / `.mk-rim--under` / `.mk-rim--ink` / `.mk-face` / `.mk-ring`×3 / `.mk-cards`(N,E,S,W) / `.mk-needle` / `.mk-pin-body` / `.mk-pin-dot`
4. `div.compass-splash__word`（HTML:857）— `<span style="--li:0">C</span>` … `S` の **C O M P A S S** 7文字
5. `div.compass-splash__todo`（HTML:858）— テキスト **`ToDo`**

#### タイムライン（全 keyframes と delay）

| 要素 | animation |
|---|---|
| `.compass-splash__glow` | `spBloom 2.1s ease-out both` |
| `.compass-splash__mark` | `spMarkSet 2.35s cubic-bezier(.2,.8,.2,1) both`（74%→84% で opacity 0→1） |
| `.compass-splash__build` | `spBuildOut 2.35s ease both`（76%→88% で opacity 1→0） |
| `.sp-guide--h` | `spGuideH 1.55s cubic-bezier(.2,.85,.2,1) .04s both` |
| `.sp-guide--v` | `spGuideV 1.55s cubic-bezier(.2,.85,.2,1) .12s both` |
| `.sp-guide-ring` | `spGuideRing 1.6s cubic-bezier(.2,.85,.2,1) .1s both` |
| `.sp-rim--under` | `spRimDraw .8s cubic-bezier(.2,.82,.18,1) .16s both` |
| `.sp-rim--ink` | `spRimDraw .86s cubic-bezier(.2,.82,.18,1) .24s both` |
| `.sp-ticks` | `spTicks .82s cubic-bezier(.14,.86,.18,1) .4s both`（-42° から回り込む） |
| `.sp-face` | `spFaceSet .62s cubic-bezier(.18,.88,.24,1.16) .62s both`（scale .48→1.04→1） |
| `.sp-ring` | `spRingDraw .6s cubic-bezier(.2,.82,.18,1) .8s both` |
| `.sp-ring--mid` | 同 `.88s` |
| `.sp-ring--in` | 同 `.96s` |
| `.sp-needle` | `spNeedleSet 1.16s cubic-bezier(.16,.86,.14,1.1) .72s both`（-428°→26°→-12°→5.5°→-2°→0°） |
| `.sp-sweep` | `spSweep .88s cubic-bezier(.36,0,.3,1) .95s both`（-92°→268°） |
| `.sp-card` | `spCardIn .42s cubic-bezier(.2,.9,.2,1.2) calc(.98s + var(--ci)*60ms) both` |
| `.sp-pin` | `spPinIn .4s cubic-bezier(.2,.9,.2,1.3) 1.18s both`（scale 0→1.14→1） |
| `.sp-pin-pulse` | `spPinPulse .62s cubic-bezier(.2,.7,.2,1) 1.3s both`（scale .9→3.5） |
| `.compass-splash__word span` | `spLetterIn .42s cubic-bezier(.2,.85,.2,1.1) calc(1.98s + var(--li)*34ms) both`（blur 3px→0） |
| `.compass-splash__todo` | `spTodoWipe .52s cubic-bezier(.25,.85,.2,1) 2.06s both` |
| `.compass-splash__todo::after` | `spTodoLine .46s cubic-bezier(.2,.8,.2,1) 2.24s both` |
| `.mk-ticks` | `mkBezel 90s linear 2.1s infinite`（360°回転） |
| `.mk-needle` | `mkDrift 7s ease-in-out 2.15s infinite`（0→1.7°→-1.3°→.5°→0） |
| `.mk-pin-dot` | `mkBreathe 3.4s ease-in-out 2.15s infinite`（scale 1↔1.22, opacity 1↔.72） |
| 退場 `.compass-splash--ready` | `spReadyOut .46s cubic-bezier(.4,0,.2,1) forwards`（72% で opacity 0、100% で `visibility:hidden`） |
| 退場 stage | `spStageOut .46s cubic-bezier(.4,0,.2,1) forwards`（`scale(1.09) blur(7px)`） |

全体設計は **2.75秒**（CSS コメント HTML:25-27「製図 → 計器起動」）。

**退場**: `.compass-splash--ready` は `document.querySelector('.compass-splash').classList.add(...)` の DOM 直接操作（HTML:2281-2282）。**DOM からは削除されず `visibility:hidden` で残る**。

**`prefers-reduced-motion:reduce`**（HTML:166-170）: `.compass-splash *{animation:none!important;clip-path:none!important;opacity:1!important}`、`.compass-splash__build, .compass-splash__glow, .sp-guide, .sp-guide-ring, .sp-sweep, .sp-pin-pulse{display:none!important}`、退場は `spReadyOut .2s ease forwards`。

### 2.3 ナビゲーション（左レール / モバイル下部バー）

#### DOM

```
div.compass-nav[style="--nav-width:{{navW}};position:relative;width:{{navW}};flex:none;
                       display:flex;flex-direction:column;gap:6px;padding:16px 12px;
                       border-right:1px solid var(--line);background:var(--bg2)"]        HTML:863
 ├ div[onMouseDown={{navResize}}][style="position:absolute;right:-3px;top:0;bottom:0;
 │      width:7px;cursor:ew-resize;z-index:20"]                                          HTML:864
 ├ button.compass-brand[type=button][onClick={{openAppSwitcher}}]
 │      [aria-label="Compassアプリ一覧を開く"][aria-haspopup="dialog"]                    HTML:865
 │   ├ div.compass-brand__mark[aria-label="Compass"]
 │   │   > img[src="/compass-icon.svg?v=20260728-ink" alt="" width=34 height=34]          HTML:866-868
 │   ├ div.compass-brand__text
 │   │   ├ div.compass-brand__name  → "Compass"
 │   │   └ div.compass-brand__tag   → "学習コックピット"                                  HTML:869
 │   └ span.compass-brand__chevron[aria-hidden=true] → "↗"                                HTML:870
 ├ sc-for navItems as n                                                                   HTML:872-879
 │   └ button.app-nav-item.{{n.activeClass}}.{{n.dragClass}}[type=button][draggable=true]
 │          [data-nav="{{n.id}}"][onDragStart/onDragOver/onDrop/onDragEnd][onClick={{n.go}}]
 │          [style="--nav-hue:{{n.hue}};background:{{n.bg}};border:1px solid {{n.bd}}"]
 │       ├ span.nav-dot[style="width:7px;height:7px;border-radius:99px;
 │       │                     background:{{n.dot}};box-shadow:{{n.glow}}"]  ← CSS で display:none!important (HTML:213)
 │       ├ span.app-nav-item__label[style="flex:1;color:{{n.c}}"] → {{n.label}}
 │       ├ sc-if n.badge → span.app-nav-item__badge → {{n.badge}}
 │       └ span.app-nav-item__key[aria-hidden=true] → {{n.hint}}
 └ div.compass-nav-footer[style="margin-top:auto;display:flex;flex-direction:column;gap:10px"] HTML:880-917
```

#### `views` 定義（HTML:2624-2631）

| index | id | label | dot | g（glow） | `VIEW_TOKEN` |
|---|---|---|---|---|---|
| 0 | `cockpit` | **コックピット** | `var(--acc)` | `var(--gAcc)` | `acc` |
| 1 | `tests` | **試験計画** | `var(--vio)` | `var(--gVio)` | `vio` |
| 2 | `todo` | **今日のToDo** | `var(--pink)` | `none` | `pink` |
| 3 | `review` | **復習** | `var(--grn)` | `var(--gGrn)` | `grn` |
| 4 | `add` | **タスク追加** | `var(--org)` | `none` | `org` |
| 5 | `data` | **データ** | `var(--blue)` | `none` | `blue` |

#### `navItems` の生成（HTML:2632-2651）

```js
// (v0.9 変更) manualDay を除外しない。計画行の p.odCount と同じ数え方に揃えた
const overdue = S.segs.filter(s => !s.done && s.day < T && P[s.plan] && P[s.plan].due > T);
const validNavIds = views.map(v => v.id);
const navOrder = (Array.isArray(S.navOrder) ? S.navOrder : [])
  .filter(id => validNavIds.indexOf(id) >= 0)
  .concat(validNavIds.filter(id => !Array.isArray(S.navOrder) || S.navOrder.indexOf(id) < 0));
const orderedViews = navOrder.map(id => views.find(v => v.id === id)).filter(Boolean);
```
各アイテム: `glow = S.view===v.id ? v.g : 'none'`、`hue = v.dot`、`hint = String(vi+1)`、
`activeClass = S.view===v.id ? 'is-active' : ''`、
`dragClass = (S.dragNav===v.id?'is-dragging ':'') + (S.navDragOver===v.id?'is-dragover':'')`、
`bg = 'transparent'`、`bd = 'transparent'`、`c = S.view===v.id ? v.dot : 'var(--tx2)'`、
`badge = v.id==='tests' && overdue.length ? '⚠'+overdue.length : false`、
`go = () => this.setState({ view: v.id })`（**`savePrefs()` は呼ばない**）。

D&D 並び替え: `onDragStart` → `dragNav` + `dataTransfer.setData('text/plain', v.id)` + `effectAllowed='move'`、`onDragOver` → `preventDefault()` + `navDragOver`、`onDrop` → `navOrder` を splice、`onDragEnd` → 両方 null。

`navViewOrder()`（HTML:2408-2412）が同じロジックでキーボード 1–6 用の順序を返す。

#### ナビフッター（デスクトップのみ, HTML:880-917）

1. **カウントダウンボックス**（HTML:881-906）
   - ヘッダ「**カウントダウン**」+ 右に `{{countdownCount}}件`
   - `countdownEmpty` → 「**下で自由に追加できます**」
   - リスト（`max-height:118px;overflow:auto`）: grid `minmax(0,1fr) auto 20px` — `c.title` / `c.dateLabel`（`fmtMD`）/ `c.days` / 削除 `✕`
     - `days` = `diff===0 ? '今日' : (diff>0 ? diff+'日' : Math.abs(diff)+'日前')`（HTML:3909）
     - 色 = `diff<0 ? var(--tx3) : (diff<=3 ? var(--pink) : var(--acc))`
     - **`date` 昇順**（HTML:3913）
   - `input[placeholder="テスト名"]`（`onCountdownTitle` / `onCountdownKey`）+ `input[type=date]` + `button`「**＋**」（`addCountdown`）。Enter でも追加。
   - 検証（HTML:3917）: `title` 非空 かつ `date` が `/^\d{4}-\d{2}-\d{2}$/`。失敗トースト「**名前と日付を入力してください**」、成功「**カウントダウンを追加しました**」。追加後 `countdownTitle` のみクリア、`countdownDate` は保持。
2. **テーマスイッチ** `div.theme-switch[role=group][aria-label="テーマ"]`（HTML:907-911）
   - 「**✎ ノート**」→ `setNote`、「**✦ ダーク**」→ `setDark`、「**☀ ライト**」→ `setLight`
   - いずれも `{theme, themeVersion:3}` をセットし、コールバックで `savePrefs()`（HTML:3962-3964）
   - 選択中 `color:var(--onAcc);background:var(--acc)`、非選択 `color:var(--tx3);background:transparent`
3. **ショートカット凡例** `div.nav-shortcuts[aria-hidden=true]`（HTML:912-914）:
   `<kbd>1</kbd>–<kbd>6</kbd> 画面` / `<kbd>/</kbd> 検索` / `<kbd>N</kbd> 追加` / `<kbd>F</kbd> 集中`
4. `div.nav-cloud` → `{{cloudStatusLabel}} · {{cloudUserLabel}}`
   - `cloudStatusMap = {loading:'同期中', saving:'保存中', saved:'保存済み', local:'端末保存', login:'未ログイン'}`、既定 `'保存待ち'`
   - `cloudUserLabel = S.cloudUser || 'gmail.com'`
5. `div.nav-version` → **`Compass v0.8`**（HTML:916）

#### モバイル用ランチャー

`button.mobile-app-launcher[type=button][onClick={{openAppSwitcher}}][aria-label="Compassアプリ一覧を開く"][aria-haspopup="dialog"]`（HTML:923）— `img[src="/compass-icon.svg?v=20260728-ink" width=25 height=25]`。デスクトップは `display:none`（HTML:189）、`≤820px` で `display:flex`（HTML:268）。

#### FAB（モバイルの「タスク追加」）

**デスクトップに FAB は存在しない。** `≤820px` で `data-nav="add"` のナビ項目が丸ボタンとして浮き上がる（HTML:760-776、セレクタは `.compass-theme-mode[data-theme] .app-nav-item[data-nav="add"]` で詳細度を上げている）。詳細は §3.8。

### 2.4 トップバー

```
div.compass-topbar[style="display:flex;align-items:center;gap:14px;padding:12px 20px;
                          border-bottom:1px solid var(--line);flex:none"]        HTML:922
 ├ button.mobile-app-launcher …                                    (DOM順1 / order:0 / desktop 非表示)
 ├ div.app-search                                                  (DOM順2 / CSS order:2)
 │   ├ svg 14×14 viewBox"0 0 20 20" (circle cx9 cy9 r6 sw2 + line 13.5,13.5→18,18 round cap)
 │   ├ input#app-search-input.app-search-input
 │   │      [value={{query}}][onChange={{onQuery}}][onFocus={{openSearch}}]
 │   │      [placeholder="タスク名・教科で検索…"][aria-label="タスク名・教科で検索"]
 │   ├ sc-if queryHasText → button.app-search-clear[aria-label="検索語を消去"] "✕"
 │   ├ span.app-search-shortcut → "⌘K"
 │   └ sc-if searchOpen → div.app-search-popover  …                 (§2.5)
 ├ div.app-view-title                                              (DOM順3 / CSS order:1)
 │   ├ div.app-view-title__name → {{viewTitle}}
 │   └ div.app-view-title__sub  → {{viewSub}}
 ├ div.app-top-actions[style="margin-left:auto;display:flex;align-items:center;gap:10px"]  (order:3)
 │   ├ sc-if hasOverdue → button.app-alert-pill[onClick={{openRedist}}]
 │   │        → "⚠ 未完了 {{overdueCount}}件 → 再配分"
 │   └ div.app-day-meter[role=group][aria-label="今日の進捗"]
 │       ├ span.app-day-meter__date  → {{todayHeader}}
 │       └ span.app-day-meter__count → {{doneCount}}<i>/</i>{{totalCount}}
 └ div.app-progress[role=progressbar][aria-label="今日の完了率"][aria-valuemin=0]
        [aria-valuemax=100][aria-valuenow={{donutPct}}][style="--done:{{donutPct}}%"] > span
```

**CSS order による視覚順**（デスクトップ）: ランチャー(0) → `app-view-title`(1) → `app-search`(2) → `app-top-actions`(3)。DOM 順とは異なるので、React でも `order` を保つか DOM 順を並べ替える。

| バインド | 生成 | 例 |
|---|---|---|
| `viewTitle` / `viewSub` | `titles[S.view][0]` / `[1]`（HTML:2652, 3957） | 下表 |
| `todayHeader` | `parseInt(T.slice(5,7),10)+'月'+parseInt(T.slice(8,10),10)+'日('+this.DAYS[0].dow+')'`（HTML:3956） | `8月5日(水)` |
| `doneCount` | `todayItems.filter(i=>i.done).length`（HTML:4072） | |
| `totalCount` | `todayItems.length` | |
| `donutPct` | `totalMin ? Math.round(doneMin/totalMin*100) : 0`（HTML:4057） | |
| `hasOverdue` / `overdueCount` | `overdue.length > 0` / `overdue.length`（HTML:3978） | **(v0.9 変更)** `overdue` は `manualDay` を除外しないので、計画行の `⚠M`（`p.odCount`）と常に一致する。§7.8 |

`titles`（HTML:2652）:

| view | viewTitle | viewSub |
|---|---|---|
| `cockpit` | **コックピット** | **今日やることを選ぶ・調整する** |
| `tests` | **試験計画** | **予習・テスト計画と負荷を見る** |
| `todo` | **今日のToDo** | **今日のタスクを実行する** |
| `review` | **復習** | **復習予定を一覧表でチェックする** |
| `add` | **タスク追加** | **タスク・復習・予習・テストを自由に追加** |
| `data` | **学習データ** | **勉強時間とテスト結果をふり返る** |

> ナビラベルは「データ」、ヘッダー題名は「**学習データ**」で**異なる**。

### 2.5 検索バーとポップオーバー

#### 開閉 API（HTML:4021-4031, 2413-2418, 3944, 2098）

| 名前 | 動作 |
|---|---|
| `openSearch` | `setState({searchOpen:true})`（input の `onFocus`） |
| `closeSearch` | `setState({searchOpen:false, query:''})` |
| `clearSearch` | `setState({query:'', searchOpen:true})` |
| `onQuery` | `setState({query:e.target.value})` — **1キーストロークごとに発火（ライブ絞り込み）** |
| `focusSearch()` | `searchOpen:true` → `document.getElementById('app-search-input').focus(); .select()` |
| `openAppSwitcher` | `appSwitcherOpen:true, searchOpen:false, query:''` |
| `Escape` | `searchOpen:false, query:''` ほか一括クローズ |

**ポップオーバー外クリックで閉じる仕組みは存在しない**（backdrop なし）。閉じるのは ✕ / Escape / アプリスイッチャー起動のみ。

#### ポップオーバーの中身（HTML:930-951）

1. ヘッダ行 — 「**検索**」（700 12px）+ 「**入力と同時に絞り込みます**」（10.5px, tx3）+ 右端 `button.app-search-clear[aria-label="検索を閉じる"]`「✕」→ `closeSearch`
2. 「**教科で絞り込み**」（10.5px, tx3）
3. `sc-for subjChips as s` — 教科チップ（丸ピル, `padding:4px 10px`）。`onPick`（HTML:3597）は
   `{ query: canonicalSubject(this.state.query) === name ? '' : name, searchOpen:true }`
4. `searchIdle`（`q.length===0`）→ 「**上のバーにタスク名または教科を入力してください**」（`padding:18px 10px;text-align:center;border-top:1px solid var(--line)`）
5. `searchHasQuery`（`q.length>0`）→ 「**結果 {{resultCount}}件 — 今日のToDoへ追加できます**」
6. `div.app-search-results{max-height:370px;overflow:auto;gap:6px}` — `sc-for searchResults as r`:
   教科色ドット（6×6）/ `r.title`（12px, ellipsis）/ `r.where`（10px, tx3）/ `sc-if r.canAdd` → button「**＋ 今日へ**」/ `sc-if r.tag` → 小ラベル
7. `searchNoResults` → 「**一致するタスクがありません**」

#### マッチ判定（HTML:2565-2577）

```js
const q = (S.query || '').trim();
const filtering = S.searchOpen && q.length > 0;
const hit = (txt) => (txt||'').toLowerCase().indexOf(q.toLowerCase()) >= 0;   // 部分一致・大小無視
const subjectAliases = { '英語':'英コミ', '英コ':'英コミ', '歴総':'歴史', '地総':'地理', '化基':'化学', '生基':'生物' };
const canonicalSubject = (n) => subjectAliases[n] || n || '';
const hitSubject = (name) => name.toLowerCase().includes(q.toLowerCase())
  || canonicalSubject(name).toLowerCase().includes(canonicalSubject(q).toLowerCase());
```

#### 結果リスト（HTML:3600-3619。`q` が空なら空配列）

| 対象 | マッチ条件 | `where` | `canAdd` | `tag` | `onAdd` のトースト |
|---|---|---|---|---|---|
| `segs` | `hit(s.title) \|\| hit(pl.name) \|\| hitSubject(pl.subj)` | `pl.name + ' · ' + dayLabel(s.day)` | `!s.done && s.day !== T` | `done→'✓済'` / `day===T→'今日'` / else `false` | 「**「{title}」を今日に移動しました**」 |
| `reviews` | `hit(r.title) \|\| hitSubject(r.subj)` | `r.stage + 'の復習 · ' + dayLabel(r.due)` | `!r.added && !r.done`（**`due<=T` の条件がない**） | `added→'追加済'` / `done→'✓済'` / else `false` | 「**「{title}」を今日のToDoに追加しました**」 |
| `extras` | `hit(x.title) \|\| hitSubject(x.subj)` | `x.src` | **常に `false`** | **常に `'今日'`** | — |

順番は segs → reviews → extras（各々 state 配列順）。

#### 検索の副作用（裏の画面も絞り込む）

`filtering === true` のあいだ:
- Cockpit「今日のタスク」`ckToday`: `hit(it.title) || hitSubject(it.subj) || hit(it.src)`（HTML:2878）
- Cockpit「復習」`ckReviews`: `hit(r.title) || hitSubject(r.subj)`（HTML:3151）
- Tests タイムラインのセグメント: `hit(s.title) || hit(pl.name) || hitSubject(pl.subj)`（HTML:2811）
- **計画行そのもの・ToDo 画面・Data 画面は絞り込まれない。**

### 2.6 画面切り替えのロジック

唯一のソースは `this.state.view`（HTML:2024、初期値 `'cockpit'`）。`persistentKeys()` に含まれるためクラウド/localStorage に保存され、次回起動時に復元される。

派生（HTML:3960-3961）: `isCockpit` / `isTests` / `isTodo` / `isReview` / `isAdd` / `isData` / `viewId`（`.compass-shell[data-view]` へ）。

| 経路 | 実装 | 行 |
|---|---|---|
| ナビ項目クリック | `n.go = () => setState({view: v.id})` | 2650 |
| キーボード `1`–`6` | `navViewOrder()[key-1]` → `setState({view}, savePrefs)` | 2089-2094 |
| キーボード `n` | `setState({view:'add'}, savePrefs)` | 2095 |
| キーボード `f` | `setState({view:'todo', focusOpen:true})` | 2096 |
| Cockpit「ToDo画面で実行する →」 | `goTodo` | 989, 3968 |
| Cockpit「計画を見る →」 | `goTests` | 1016, 3968 |
| Cockpit 週次消化率カード | `goReview` | 1010, 3968 |
| Cockpit 計画カードクリック | `p.goTests` | 1019, 2765 |
| ヘッダー「⚠ 未完了 N件 → 再配分」 | `openRedist` → `{view:'tests', redistOpen:true, redistPlan:'all', redistPickMode:false, redistMode:'even'}` | 957, 3980-3982 |
| Cockpit「未完了タスクを再配分」 | 同上 | 1036 |
| Tests「全体を再配分」 | `openAllRedist`（同じ内容） | 1061, 1075, 3983 |
| Tests「計画ごとに設定」 | `choosePlanRedist` → `{view:'tests', redistOpen:false, redistPlan:null, redistPickMode:true}` | 1062, 3984-3988 |
| Add 完了バナー「… →」 | `addGoView` → `setState({view: addDone.view})` | 1304, 4238 |
| Review 詳細「テスト計画に変更」 | `reviewToTest` → `view:'tests'` + editor 起動 | 1642, 3271-3295 |

Undo（`undoLastAction`, HTML:2136-2154）は `view` を変えない（`undoKeys()` に無い）。

**画面切替に伴う視覚変化**: `themeStyle['--view'] = 'var(--' + VIEW_TOKEN[S.view] + ')'`、`--viewBg`、`--grad = var(--view)`（HTML:2617-2621）。画面ルートに `animation:inkIn .3s cubic-bezier(.2,.85,.2,1)!important`（HTML:651-655、インラインの `fadeUp .22s` を上書き）。

### 2.7 キーボードショートカット（`_key`, HTML:2075-2099）

```js
const editingText = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
```

| キー | 条件 | 動作 |
|---|---|---|
| `Cmd/Ctrl + Z`（Shift なし） | `!editingText` | `undoLastAction()` — 成功「**1つ前の操作に戻しました**」/ 不可「**戻せる操作はありません**」 |
| `Cmd/Ctrl + S` | 常時 | `forceSaveNow()` — 「**Firebaseに保存しました**」/「**Firebase保存に失敗: …**」/ 未準備「**保存準備中です**」 |
| `Cmd/Ctrl + K` | 常時 | `focusSearch()` |
| `/` | `!editingText` かつ `!metaKey && !ctrlKey && !altKey` | `focusSearch()` |
| `1`–`6` | 同上 | `navViewOrder()[n-1]` へ切替 + `savePrefs()` |
| `n` | 同上 | `view:'add'` + `savePrefs()` |
| `f` | 同上 | `view:'todo'` かつ `focusOpen:true` |
| `Escape` | 常時（`editingText` でも発火） | `clearInterval(this._focusTimer); this._focusTimer=null;` + `setState({searchOpen:false, redistOpen:false, redistPlan:null, redistPickMode:false, query:'', appSwitcherOpen:false, revSel:null, revAsk:null, scoreSel:null, focusOpen:false, focusRunning:false})` |

> **Escape は `editorPlan`（ミニタスク編集ドロワー）を閉じない。**

### 2.8 パネル幅のドラッグ変更（`resizer`, HTML:2419-2438）

| key | 既定値 | 範囲 | ハンドル | dir |
|---|---|---|---|---|
| `nav` | 196 | `[150, 340]` | HTML:864（右端） | `'right'` |
| `search` | 308 | — | **未使用**（`searchW`/`searchResize` はテンプレート未参照） | — |
| `editor` | 410 | `[320, min(520, max(360, innerWidth*0.62))]` | HTML:1536（左端） | `'left'` |
| `review` | 380 | `[260, max(320, innerWidth*0.92)]` | HTML:1611（左端） | `'left'` |
| `score` | 400 | 同上 | HTML:1653（左端） | `'left'` |

ドラッグ中 `document.body.style.cursor='ew-resize'; userSelect='none'`、mouseup で `savePrefs()`。
`edW` は表示時にさらに `Math.min(520, Math.max(320, panelW.editor||410))` でクランプ（HTML:3948）。

### 2.9 モーダル / ドロワー / シート 一覧

| # | 名前 | 表示条件 | 種別 | z-index | 閉じ方 | 行 |
|---|---|---|---|---|---|---|
| 1 | ミニタスク編集ドロワー | `editorOpen`（`S.editorPlan`） | 右ドロワー（折りたたみレール付き） | 45 | 背景クリック `closeEditor` / ✕ /「しまう ›」で折りたたみ。**Escape では閉じない** | 1525-1605 |
| 2 | 復習詳細ドロワー | `revDetailOpen`（`S.revSel`） | 右ドロワー | 45 | 背景 / ✕ / Escape | 1608-1647 |
| 3 | 点数推移ドロワー | `scOpen`（`scArr.length > 0`） | 右ドロワー | 45 | 背景 / ✕ / Escape / 最後の1件削除で自動 | 1650-1694 |
| 4 | 再配分モーダル | `redistOpen` | 中央モーダル | 50 | 背景 / キャンセル / Escape | 1697-1775 |
| 5 | 理解度モーダル | `askOpen`（`S.revAsk`） | 中央モーダル | 55 | 背景 / キャンセル / Escape | 1778-1812 |
| 6 | 集中モード | `focusOpen` | 全画面オーバーレイ | 65 | ✕ / Escape。**背景クリックでは閉じない**（onClick なし） | 1815-1825 |
| 7 | アプリスイッチャー | `appSwitcherOpen` | backdrop + dialog | 110 | backdrop / ✕ / 現在アプリタイル / Escape | 1828-1863 |
| 8 | ツールチップ | `tooltip` | fixed, `pointer-events:none` | 60 | ホバー解除 | 1866-1871 |
| 9 | トースト | `toast` | fixed bottom | 130 | 2400ms 自動消滅 | 1874-1876 |

**トースト**: `showToast(msg)`（HTML:2439-2443）は前回のタイマーを `clearTimeout` し 2400ms 後に `toast:null`。常に最新の1件だけ。

### 2.10 空状態（`.empty-note`）— 完全な文言

| 場所 | 条件 | `<b>` | `<span>` | 行 |
|---|---|---|---|---|
| Cockpit 今日 | `ckTodayEmpty` | **今日のタスクはまだ空です** | **右の復習や計画から「＋ 今日へ」で積みましょう。ドラッグでもここに置けます。** | 984-986 |
| Cockpit 復習 | `ckReviewsEmpty` | **復習の予定はありません** | **(v0.9 変更)** **復習タスクを完了して理解度を記録すると、翌日→3日後→1週間後→2週間後の間隔で次の復習が自動で積まれます。** | 1006-1008 |
| Cockpit 計画 | `ckPlansEmpty`（`plans.length===0`） | **計画がありません** | **「タスク追加」からテストや予習の計画を作ると、ここに残り日数と進捗が並びます。** | 1032-1034 |

> **(v0.9 変更)** Cockpit 復習の文言は、旧「タスクを完了すると、1日後・1週間後・1ヶ月後の復習が自動で積まれます。」から実装どおりの文言（発火条件＝**復習**の完了、間隔＝翌日/3日後/1週間後/2週間後）へ書き換えられた。§11-Q1 は解消済。書き換え版は**新しい文言をそのまま出す**。

`.empty-note` 以外の空/プレースホルダ文言:

| 場所 | 条件 | 文言 | 行 |
|---|---|---|---|
| ナビ カウントダウン | `countdownEmpty` | **下で自由に追加できます** | 886-888 |
| 検索（未入力） | `searchIdle` | **上のバーにタスク名または教科を入力してください** | 938 |
| 検索（0件） | `searchNoResults` | **一致するタスクがありません** | 949 |
| ToDo 計画詳細 | `todoPlanNoRows` | **計画を選ぶとミニタスクを表示します** | 1182 |
| ToDo タスク詳細 | `selNoSubs` | **細分化はまだありません** | 1215 |
| Data テスト結果 | `scoreGroupsNone` | **まだ記録がありません。返却されたテストの点数を下から記録しましょう** | 1279 |
| 再配分モーダル | `redistEmpty` | **再配分できる未完了タスクはありません。** | 1744-1746 |
| 集中モード | `focusItem` なし | **今日のタスクはありません** / **先にToDoへタスクを追加してください** | 4063-4064 |
| ToDo 詳細（sel なし） | — | `selTitle`=**タスクを選択** / `selMeta`=`''` / `selSubj`=**–** | 4075, 4088 |
| ToDo 計画詳細（plan なし） | — | `todoPlanName`=**計画を選択** / `todoPlanType`=**計画** / `todoPlanRemainDays`=**–** | 4076-4086 |
| Review 消化率（対象なし） | — | `weekRateLabel`=**–** / `weekRateSuffix`=`''` / `weekRateMeta`=**今週は対象なし** | 4158-4160 |

**明示的な空状態を持たない画面**: Tests（タイムライン head + 説明行のみ残る）、Review（テーブル head + foot のみ残る）、Data の教科別勉強時間（土台円 + `0h` のみ）。

### 2.11 スクロールコンテナ一覧

| セレクタ | 設定 | 行 |
|---|---|---|
| `html, body` | `margin:0;padding:0;height:100%` / モバイル `overflow-x:hidden;overscroll-behavior-x:none` | 17, 263 |
| `.compass-shell` | `height:100vh;overflow:hidden`（モバイル `display:block;height:100dvh`） | 788, 265, 746 |
| `.compass-main` | `flex:1;display:flex;flex-direction:column;min-width:0`（モバイル `height:calc(100dvh - var(--mobile-nav-h));overflow:hidden`） | 921, 273 |
| `.compass-topbar` | `flex:none` | 922 |
| `.cockpit-grid` | ≥1181px `overflow:hidden!important` / ≤1180px `overflow:auto!important` / ≤820px `display:block;overflow:auto` | 228, 255, 281 |
| `.cockpit-panel` ×3 | `height:calc(100vh - 68px);overflow:auto`（各パネル独立） / ≤1180px `height:auto` | 229, 256 |
| Cockpit パネル内リスト ×3 | `overflow:auto` | 975, 994, 1017 |
| `div[data-screen-label="Tests"/"ToDo"/"Data"/"Add"/"Review"]` | `flex:1;overflow:auto` | 1043, 1125, 1237, 1296, 1467 |
| `.plan-timeline-table` | `overflow-x:auto`（モバイル `-webkit-overflow-scrolling:touch;scrollbar-width:thin;overscroll-behavior-x:contain`） | 1083, 293 |
| `.review-table` | `overflow-x:auto`（モバイル `overflow:visible!important`） | 1487, 297 |
| ToDo 計画詳細 body | `max-height:490px;overflow:auto` | 1169 |
| ナビ カウントダウンリスト | `max-height:118px;overflow:auto` | 889 |
| `.app-search-results` | `max-height:370px;overflow:auto` | 226 |
| `.app-search-popover` | `max-height:min(620px,calc(100vh - 90px))`（モバイル `calc(100dvh - 128px)`） | 225, 279 |
| editor ドロワーのリスト | `flex:1;overflow:auto` | 1567 |
| score ドロワーの履歴 | `flex:1;overflow:auto` | 1682 |
| 再配分モーダル本体 | `max-height:86vh;overflow:auto` | 1699 |
| `.app-switcher-panel` | `max-height:min(720px,90vh);overflow:auto`（モバイル `90dvh`） | 191, 307 |
| スクロールバー | `::-webkit-scrollbar{width:8px;height:8px}` / thumb `rgba(128,150,190,.25)`（note は `rgba(238,233,222,.22)`）/ track transparent | 171-173, 523-526 |

---

## 3. ビジュアルデザイン

### 3.1 フォント

HTML:14-15（helmet 経由で head へ）:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Klee+One:wght@400;600&family=Noto+Sans+JP:wght@400;500;700;900&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet">
```
- `preconnect` は **googleapis のみ**（gstatic への preconnect は無い。`layout.tsx` L31-36 のホスト側だけ両方張っている）
- ウェイト: **Klee One 400/600** / **Noto Sans JP 400/500/700/900** / **Space Grotesk 500/700**、`display=swap`

トークン（HTML:542-549 `.compass-theme`）:
```css
--font-hand:'Klee One','Noto Sans JP',serif;
--font-num:'Space Grotesk','Noto Sans JP',sans-serif;
--ink-rad:13px;
--ink-rad-sm:10px;                                    /* 未使用 */
--ink-lift:0 1px 0 rgba(0,0,0,.05),0 8px 22px -16px rgba(0,0,0,.55);
--ink-lift-hi:0 2px 0 rgba(0,0,0,.05),0 16px 34px -18px rgba(0,0,0,.6);
```
ルート font-family はインライン（HTML:786 末尾）: `font-family:'Noto Sans JP',system-ui,sans-serif`

**Space Grotesk の 600 は未ロードウェイト**（`.app-search-shortcut` L223 / `.nav-shortcuts kbd` L622 / `.panel-heading__meta` L566 / `.nav-cloud`・`.nav-version` L624-625 / カウントダウン日付 input L903 / `.mini-day-mobile` L306 などで `font:600 … var(--font-num)` を指定）。合成/丸めになる。

本文レンダリング（HTML:177）: `body{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}`
`.compass-shell{font-variant-numeric:tabular-nums;letter-spacing:.005em}`（HTML:550）

見出しタイポグラフィ（HTML:562-569）:
```css
.panel-heading,.app-view-title__name,.compass-brand__name,.empty-note b{
  font-family:var(--font-hand);font-weight:600;letter-spacing:.035em;
}
.panel-heading{font-size:16px;color:var(--tx0);line-height:1.3}
.panel-heading__meta{margin-left:auto;font:600 12px var(--font-num);color:var(--tx2);white-space:nowrap}
.panel-heading__link{margin-left:auto;font:500 11px 'Noto Sans JP';color:var(--tx3);cursor:pointer;white-space:nowrap;transition:color .16s ease}
.panel-heading__link:hover{color:var(--view)}
.panel-dot{width:9px;height:9px;flex:none;border-radius:99px;background:var(--dot,var(--view));box-shadow:0 0 0 3px color-mix(in srgb,var(--dot,var(--view)) 16%,transparent)}
```
note テーマではさらに（HTML:375-382）`.app-view-title>div:first-child`, `.cockpit-panel-title>div:first-child`, `[data-screen-label] h1/h2` に `font-family:'Klee One','Noto Sans JP',sans-serif!important;font-weight:600!important;letter-spacing:.035em!important`。

主要サイズ抜粋: `.compass-brand__name` 20px / `.compass-brand__tag` 500 9px LS .13em / `.app-view-title__name` 18px（mobile 16px）/ `.app-view-title__sub` 11px / `.app-nav-item__label` 500 13.5px LS .01em（mobile 9.5px）/ `.app-nav-item__key` 600 10px `var(--font-num)` / `.app-nav-item__badge` 700 10px `var(--font-num)` / `.app-search-input` 500 13px / `.app-search-shortcut` 600 10px / `.app-day-meter__date` 600 12.5px（mobile 11px）/ `.app-day-meter__count` 700 13px `var(--font-num)`（mobile 12px）/ `.app-alert-pill` 700 11px / `.theme-switch>span` 700 10px / `.nav-shortcuts` 500 9.5px, `kbd` 600 9px / `.nav-cloud` 600 10px / `.nav-version` 500 9.5px LS .14em / `.empty-note b` 13.5px, `span` 11px LH 1.75 / `.mobile-scroll-hint` 600 10.5px / `.review-table-row>span[data-label]::before` 500 8.5px / `.app-switcher-tile__icon` 700 23px 'Space Grotesk' / `.app-switcher-tile__status` 700 9.5px / 集中モードのタイマー 700 48px 'Space Grotesk' LS .03em。

### 3.2 テーマシステム — 3層構造

**層A: 静的フォールバック** — `<div class="compass-theme" style="…">`（HTML:786）にノートテーマのトークンがハードコード（`--bg0:#100f0c` … `--sj-steel:#8fb0cd`）。ハイドレート前の見た目。

**層B: `themeStyle` オブジェクト** — `<div class="compass-theme-mode" data-theme="{{themeName}}" style="{{themeStyle}}">`（HTML:787）。HTML:2584-2621 で生成。

**層C: `data-theme` セレクタ CSS** — `.compass-theme-mode[data-theme="dark"]`（HTML:311-534）と `[data-theme="light"]`（HTML:690-740）。

#### `themeName` のマッピング（**極めて重要な罠**、HTML:3940）

```js
themeName: note ? 'dark' : (light ? 'light' : 'neon')
```

| `state.theme` | UI ラベル | `data-theme` 値 | 適用される CSS |
|---|---|---|---|
| `'note'`（**既定**, HTML:2024） | ✎ ノート | **`dark`** | HTML:311-534（Ink & Paper Night = 焼けた黒紙） |
| `'light'` | ☀ ライト | `light` | HTML:690-740（生成り紙） |
| `'dark'` | ✦ ダーク | **`neon`** | **どのブロックも当たらない** → 素の 2026 neon スキン |

移行処理（HTML:2056-2059, 2167-2168）: `saved.theme === 'dark' && themeVersion !== 3` なら `'note'` に書き換え。`themeVersion` は無条件で 3。

#### トークン一覧（3テーマ）

ベース = neon（HTML:2585-2593）。light（2596-2603）/ note（2606-2613）で上書き。

| token | neon | light | note |
|---|---|---|---|
| `--bg0` | `#071421` | `#f3f0e6` | `#100f0c` |
| `--bg1` | `#0b1b2b` | `#fffdf6` | `#1a1814` |
| `--bg2` | `#081725` | `#faf6ea` | `#151310` |
| `--bg3` | `#10273a` | `#ebe5d4` | `#26231c` |
| `--line` | `#193147` | `#ded7c4` | `#37332b` |
| `--line2` | `#29465f` | `#c4bba4` | `#4e4940` |
| `--tx0` | `#f1f6fb` | `#1f1c16` | `#f2ede1` |
| `--tx1` | `#d4e0eb` | `#3a352c` | `#dbd4c7` |
| `--tx2` | `#8fa5b9` | `#6b6458` | `#a9a296` |
| `--tx3` | `#5d768c` | `#958d7d` | `#867f76` |
| `--acc` | `#42d7f2` | `props.accent`（既定 `#3d3629`） | `#f2ede1` |
| `--accBg` | `#0b3343` | `#e9e3d2` | `#2b2822` |
| `--vio` / `--vioBg` | `#9a79f6` / `#282044` | `#6a4ac2` / `#ece5fa` | `#bda7e6` / `#2b2438` |
| `--grn` / `--grnBg` | `#4cda91` / `#153829` | `#2b7d52` / `#dcefe2` | `#96c49c` / `#1d2c21` |
| `--pink` / `--pinkBg` | `#ff6e5b` / `#3b2427` | `#c04832` / `#fae3dc` | `#dd9184` / `#36231f` |
| `--blue` / `--blueBg` | `#58a6ff` / `#142c48` | `#2a68a6` / `#e1ecf7` | `#93b3cf` / `#1e2933` |
| `--org` / `--orgBg` | `#efa960` / `#3a2b1d` | `#a56717` / `#f6e9d4` | `#ddb277` / `#33281c` |
| `--onAcc` | `#04131d` | `#fffdf6` | `#141310` |
| `--rad` | `${props.radius}px`（12px） | 同左 | **`12px` 固定** |
| `--grad` | `linear-gradient(90deg,#42d7f2,#58a6ff)` → 最終的に `var(--view)` に上書き（HTML:2621） | `acc` → `var(--view)` | `#f2ede1` → `var(--view)` |
| `--gAcc` | `gl('#42d7f2',14)` | `none` | `none` |
| `--gVio` | `gl('#9a79f6',14)` | `none` | `none` |
| `--gGrn` | `gl('#4cda91',12)` | `none` | `none` |

教科カラー（色鉛筆トークン）:

| token | neon | light | note |
|---|---|---|---|
| `--sj-terra` | `#ef5350` | `#b04b39` | `#d98a78` |
| `--sj-rose` | `#f277a8` | `#a34866` | `#d894ac` |
| `--sj-indigo` | `#5b7bf0` | `#3a55a8` | `#8ba3dd` |
| `--sj-ochre` | `#f3c74f` | `#8f6c11` | `#dcb765` |
| `--sj-forest` | `#2aa578` | `#2e6d46` | `#7fb08b` |
| `--sj-teal` | `#35cfe8` | `#1f7484` | `#6fb6c4` |
| `--sj-olive` | `#9bd63b` | `#57731d` | `#a8bf6e` |
| `--sj-amber` | `#f59e42` | `#a5661a` | `#e0a76a` |
| `--sj-plum` | `#9a6bde` | `#6f4aa8` | `#b795dc` |
| `--sj-graphite` | `#7f8a99` | `#655f55` | `#a09a8e` |
| `--sj-steel` | `#4f9cf6` | `#37678d` | `#8fb0cd` |

note 専用トークン（HTML:311-321）:
```css
--paper:#100f0c; --paper-raised:#1a1814; --paper-soft:#151310; --paper-mark:#26231c;
--pencil:#f2ede1; --pencil-soft:#cdc6b9; --graphite:#918b81; --graphite-faint:#867f76;
--rule:rgba(242,237,225,.075);
```
`--paper-soft` と `--graphite` は定義のみで**未使用**。

#### 教科 → トークン + 混色率（HTML:1973-1996）

`sj(token, mix)` = `{c:'var(--sj-<token>)', bg:'color-mix(in srgb,var(--sj-<token>) <mix>%,var(--bg2))'}`

| 教科 | token / mix% | 教科 | token / mix% |
|---|---|---|---|
| `古文` | terra 16 | `英コミ` | amber 17 |
| `現国` | rose 16 | `論表` | plum 18 |
| `言語` | rose 16 | `LHR` | graphite 18 |
| `数学` | indigo 18 | `物理` | steel 17 |
| `歴史` | ochre 16 | `体育` | graphite 16 |
| `地理` | forest 20 | `保健` | graphite 16 |
| `化学` | teal 16 | `芸術` | plum 16 |
| `生物` | olive 16 | `英語` | amber 17 |
| `英コ` | amber 17 | `歴総` | ochre 16 |
| `地総` | forest 20 | `化基` | teal 16 |
| `生基` | olive 16 | | |

未登録教科は `subjOf(name)`（HTML:2013-2019）が `_palette`（HTML:2012）を `Object.keys(this.SUBJ).length % 6` で巡回割当:
```js
this._palette = [['var(--vio)','var(--vioBg)'],['var(--blue)','var(--blueBg)'],['var(--acc)','var(--accBg)'],
                 ['var(--pink)','var(--pinkBg)'],['var(--grn)','var(--grnBg)'],['var(--org)','var(--orgBg)']];
```
constructor の末尾で `TIMETABLE` の全教科を `subjOf` に通して登録済みにする（HTML:2020）。

#### 画面ごとの署名カラー `--view`（HTML:2616-2621）

```js
const VIEW_TOKEN = { cockpit:'acc', tests:'vio', todo:'pink', review:'grn', add:'org', data:'blue' };
themeStyle['--view'] = 'var(--' + viewToken + ')';
themeStyle['--viewBg'] = 'var(--' + viewToken + 'Bg)';
themeStyle['--grad'] = 'var(--view)';
```
連動先: `.compass-shell::before`（HTML:556-559）、`.app-view-title::before`（630-633）、`.app-progress>span`（648）、`.load-bar__fill`（657）、`.compass-brand__mark` の枠（573-578）、`.focus-launch`（677-682）、`.empty-note` 背景（669-673）、`.panel-heading__link:hover`（568）、`.panel-dot`（569）、フォーカスリング（551-554）、`.theme-switch>span:hover`（617）、`--grad` を使う全ボタン、ToDo サマリのドーナツ gradient stop（683-684）。

### 3.3 紙・罫線テクスチャ

| テーマ | セレクタ | 背景 |
|---|---|---|
| note | `[data-theme="dark"] .compass-shell`（322-325） | `var(--paper)!important` + `repeating-linear-gradient(180deg,transparent 0,transparent 31px,var(--rule) 31px,var(--rule) 32px)!important` → **32px ピッチ / 1px 罫線 `rgba(242,237,225,.075)`** |
| note | パネル群（462-470） | `rgba(16,15,12,.965)` + 罫線 `rgba(238,233,222,.045)`（32px ピッチ） |
| note | `.cockpit-panel--today`（471-473） | `rgba(21,19,16,.985)` |
| note | popover / switcher panel（434-441） | `var(--paper-raised)` + 罫線 `rgba(238,233,222,.045)`、`border-radius:16px`、`box-shadow:0 18px 46px rgba(0,0,0,.46)` |
| light | `.compass-shell`（690-693） | `var(--bg0)` + 罫線 `rgba(80,68,48,.09)` |
| light | パネル群（694-702） | `var(--bg0)` + 罫線 `rgba(80,68,48,.07)` |
| neon | — | 罫線なし。`.compass-shell{background:var(--bg0)!important}`（181）のみ |

**綴じ線の罠**: `[data-theme="dark"] .compass-shell::before`（326-328）は中央 1px の縦線 `rgba(238,233,222,.022)` を描こうとするが、HTML:556-559 の `.compass-shell::before{background:radial-gradient(…)!important}` に負けて**表示されない**。1:1 再現では「見えない」が正。

`.compass-shell::before` の実効値（181 + 556-559）:
```css
content:"";position:fixed;inset:0;pointer-events:none;z-index:-1;
background:radial-gradient(circle at 50% -14%,color-mix(in srgb,var(--view) 7%,transparent),transparent 42%)!important;
transition:background .5s ease;
```
`.compass-shell{isolation:isolate}`（181）があるので `z-index:-1` はシェル内に閉じる。

**時間割スロットの鉛筆ハッチ**（note 専用、398-433）: 2重の `repeating-linear-gradient(8deg,…3px/4px/7px)` + `(-5deg,…8px/9px)`、`inset 3px 0 0` の左芯、`border-radius:12px`。`.is-active` で左芯 4px + `0 0 0 1px rgba(238,233,222,.28)`。`.timetable-slot__subject` は `repeating-linear-gradient(4deg,…5px/6px)` + `border-radius:9px` + `inset 0 -1px 0`。

### 3.4 スプラッシュの色トークン（`--sp-*`）

| token | neon（56-69） | note（490-503） | light（716-728） |
|---|---|---|---|
| `--sp-guide` | `rgba(150,230,255,.3)` | `rgba(242,237,225,.17)` | `rgba(60,52,38,.2)` |
| `--sp-graphite` | `#0a2c46` | `rgba(242,237,225,.13)` | `rgba(60,52,38,.15)` |
| `--sp-ink` | `#5eebff` | `#f2ede1` | `#332d24` |
| `--sp-tick` | `rgba(200,245,255,.62)` | `rgba(242,237,225,.48)` | `rgba(60,52,38,.5)` |
| `--sp-face` | `#0b3a55` | `#17150f` | `#fffdf6` |
| `--sp-face-line` | `rgba(185,245,255,.5)` | `rgba(242,237,225,.42)` | `rgba(60,52,38,.38)` |
| `--sp-accent` | `#eafbff` | `#f2ede1` | `#332d24` |
| `--sp-warm` | `#ffb066` | `#ddb277` | `#a56717` |
| `--sp-ring` | `rgba(221,251,255,.3)` | `rgba(242,237,225,.22)` | `rgba(60,52,38,.22)` |
| `--sp-ring-mid` | `#70e6ee` | `#96c49c` | `#2b7d52` |
| `--sp-ring-in` | `#ffd166` | `#ddb277` | `#a56717` |
| `--sp-pin` | `#071d31` | `#100f0c` | `#fffdf6` |
| `--sp-pin-ring` | `#f4fcff` | `#f2ede1` | `#332d24` |
| `--sp-text` | `#f0fbff` | `#f2ede1` | `#2a251d` |

コンテナ（49-70）:
```css
.compass-splash{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;pointer-events:none;
  background:radial-gradient(circle at 42% 35%,rgba(54,205,235,.24),transparent 29%),
             radial-gradient(circle at 60% 62%,rgba(255,209,102,.16),transparent 30%),
             linear-gradient(135deg,#061827 0%,#0a2540 56%,#071525 100%);}
.compass-splash__stage{width:min(292px,56vw);aspect-ratio:1;position:relative;display:grid;place-items:center}
.compass-splash__mark,.compass-splash__build{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;
  overflow:visible;filter:drop-shadow(0 18px 34px rgba(2,14,30,.42))}
```
note の背景（486-488）: `#100f0c` + 罫線 `rgba(242,237,225,.06)` 32px。light（713-714）: `#f3f0e6` + `rgba(80,68,48,.1)`。両テーマとも `.compass-splash__glow{display:none}`。drop-shadow は note `0 14px 24px rgba(0,0,0,.48)`（508）/ light `0 12px 22px rgba(80,68,48,.22)`（733）。

ロゴタイプ:
```css
.compass-splash__word{position:absolute;bottom:-12px;display:flex;gap:.1em;
  font:700 15px 'Space Grotesk',system-ui,sans-serif;letter-spacing:.12em;color:var(--sp-text)}
.compass-splash__todo{position:absolute;bottom:-58px;
  font:700 clamp(28px,7vw,44px) 'Space Grotesk',system-ui,sans-serif;line-height:1;letter-spacing:.06em;
  background:linear-gradient(90deg,#5eebff 0%,#f0fbff 30%,#43e6b1 66%,#ffd166 100%);
  -webkit-background-clip:text;background-clip:text;color:transparent}
.compass-splash__todo::after{content:"";left:4%;right:4%;bottom:-9px;height:2px;border-radius:99px;
  background:linear-gradient(90deg,transparent,#5eebff,#43e6b1,#ffd166,transparent);transform-origin:left center}
```
note / light ではグラデ文字をやめ `color:var(--sp-text)` + `font-family:'Klee One',…`（note は `sans-serif` フォールバック L517、light は `serif` L738）。下線は note `#cdc6b9`、light `#6b6458` の単色。

### 3.5 コンポーネント CSS インベントリ（カスケード込みの実効値）

#### シェル / ナビ
- `.compass-shell`（181, 550, 788 inline）: `display:flex;height:100vh;background:var(--bg0);color:var(--tx1);overflow:hidden;isolation:isolate;font-variant-numeric:tabular-nums;letter-spacing:.005em`
- `.compass-nav`: HTML:183 で `width:clamp(196px,var(--nav-width,220px),252px)!important;padding:18px 12px 14px!important;gap:5px!important;background:color-mix(in srgb,var(--bg2) 94%,black)!important;box-shadow:8px 0 28px rgba(0,0,0,.14)` → HTML:586 が `padding:20px 14px 16px!important;gap:3px!important` で**後勝ち**。
  → **インラインの `width:{{navW}}` は `!important` に負ける。ドラッグで 150–340px に変えても実効幅は 196–252px にしか動かない。**
  note: `background:rgba(21,19,16,.97)!important;border-right-color:rgba(238,233,222,.16)!important;box-shadow:none!important`（329-333）。light: `background:color-mix(in srgb,var(--bg1) 92%,var(--bg3))!important;box-shadow:1px 0 0 var(--line)`（704）。
- リサイズハンドル（864）: `position:absolute;right:-3px;top:0;bottom:0;width:7px;cursor:ew-resize;z-index:20`
- `.compass-brand`: 184 → 572 後勝ち → `gap:11px!important;padding:2px 6px 18px!important`、`border-radius:11px;transition:background .16s ease,transform .16s ease`。hover `translateY(-1px)` + `color-mix(in srgb,var(--acc) 7%,transparent)`（note は `rgba(238,233,222,.05)`、transform は残る）
- `.compass-brand__mark`: `38×38;border-radius:13px;border:1px solid color-mix(in srgb,var(--view) 26%,var(--line));background:color-mix(in srgb,var(--view) 9%,transparent);transition:border-color .3s ease,background .3s ease`。hover で `border-color:var(--view);background:color-mix(… 15% …)`。中の `<img>` は属性 34×34 だが **CSS で 26×26**。
- `.compass-brand__chevron`（"↗"）: `margin-left:auto;color:var(--tx3);font-size:12px`、hover `transform:translate(2px,-1px);color:var(--acc)`
- `.app-nav-item`: 200 → 587 後勝ち。`--nav-hue:var(--acc)`（インラインで `n.hue` を注入）、`min-height:46px;padding:10px 12px!important;border-radius:12px!important;gap:12px!important;position:relative;border:1px solid transparent!important;background:transparent;color:var(--tx2);transition:background/color/border-color/transform .16s ease`。note では `border-radius:11px!important`（345-347）。
  - `::before` = `19×19;background:currentColor;opacity:.85;mask:var(--nav-icon) center/contain no-repeat`
  - hover: `background:color-mix(in srgb,var(--nav-hue) 9%,transparent)!important;transform:none!important`、`::before opacity:1`、label `color:var(--tx0)`
  - `.is-active`: `background:color-mix(in srgb,var(--nav-hue) 14%,transparent)!important;border-color:color-mix(… 28% …)!important;color:var(--nav-hue)!important`、`::after` = `left:-15px;top:11px;bottom:11px;width:3px;border-radius:0 3px 3px 0;background:var(--nav-hue);box-shadow:none!important`
  - `.is-dragging{opacity:.45;transform:scale(.98)}` / `.is-dragover{border-color:var(--acc)!important;box-shadow:inset 0 2px 0 var(--acc)}`（202-203）
  - `.app-nav-item__key`: `position:absolute;right:10px;top:50%;transform:translateY(-50%);19×19;display:grid;place-items:center;border-radius:6px;pointer-events:none;border:1px solid var(--line);color:var(--tx3);font:600 10px var(--font-num);opacity:0;transition:opacity/color/border-color .16s ease`。`.compass-nav:hover .app-nav-item__key{opacity:1}` / `.compass-nav:hover .app-nav-item__badge{margin-right:22px}`（597-598）
  - `.app-nav-item__badge`: `flex:none;padding:1px 7px;border-radius:99px;background:var(--pinkBg);color:var(--pink);font:700 10px var(--font-num)`
  - `.nav-dot{display:none!important}`（213）— テンプレート HTML:874 の span は**常に不可視**
- `.theme-switch`（615-617）: `display:grid;grid-template-columns:repeat(3,1fr);gap:2px;padding:3px;background:var(--bg1);border:1px solid var(--line);border-radius:12px`。子 `span{padding:7px 2px;border-radius:9px}`、hover `color-mix(in srgb,var(--view) 12%,transparent)`
- `.nav-shortcuts kbd`（619-623）: `display:inline-grid;place-items:center;min-width:15px;padding:1px 3px;margin:0 1px;border:1px solid var(--line2);border-radius:4px;background:var(--bg2);color:var(--tx2)`

#### トップバー
- `.compass-topbar`: 216 → **628（`position:relative;min-height:70px`）が後勝ち**。`padding:11px 20px!important;background:color-mix(in srgb,var(--bg0) 82%,transparent);backdrop-filter:blur(18px);border-color:var(--line2)!important;z-index:12`。note: `background:rgba(16,15,12,.94);backdrop-filter:none`（365-370）。light: `color-mix(in srgb,var(--bg1) 88%,transparent)`（705）。モバイル `min-height:52px`（747）
- `.app-view-title{display:flex;flex-direction:column;justify-content:center;gap:2px;padding-left:13px;position:relative}` + `::before{content:"";position:absolute;left:0;top:3px;bottom:3px;width:3px;border-radius:99px;background:var(--view);transition:background .35s ease}`（629-633）
- `.app-search`（219-224）: `position:relative;order:2;margin-left:auto;display:flex;align-items:center;gap:9px;min-width:min(34vw,440px);padding:0 12px;background:var(--bg2);border:1px solid var(--line2);border-radius:10px;color:var(--tx2);box-shadow:inset 0 1px 0 rgba(255,255,255,.025)`。hover/focus-within → `border-color:color-mix(in srgb,var(--acc) 64%,var(--line2));box-shadow:0 0 0 3px color-mix(in srgb,var(--acc) 9%,transparent)`
- `.app-search-input{flex:1;min-width:0;height:38px;padding:0;border:0;outline:0;background:transparent;color:var(--tx0);font:500 13px 'Noto Sans JP'}`、`::placeholder{color:var(--tx3)}`（mobile 34px）
- `.app-search-shortcut{padding:2px 6px;border:1px solid var(--line);border-radius:5px;color:var(--tx3);font:600 10px 'Space Grotesk'}` → `⌘K`。モバイル `display:none`（278）
- `.app-search-clear{22×22;border-radius:6px;background:transparent;color:var(--tx3)}` hover→`background:var(--bg3);color:var(--tx0)`
- `.app-search-popover`（225）: `position:absolute;left:0;right:0;top:calc(100% + 8px);z-index:80;max-height:min(620px,calc(100vh - 90px));padding:13px;background:var(--bg1);border:1px solid var(--line2);border-radius:12px;box-shadow:0 22px 60px rgba(3,9,20,.48);display:flex;flex-direction:column;gap:10px;animation:fadeUp .16s ease`
- `.app-alert-pill`（636-642）: `display:flex;gap:6px;padding:8px 13px;border:1px solid var(--pink);border-radius:99px;background:var(--pinkBg);color:var(--pink);font:700 11px 'Noto Sans JP'` + hover `translateY(-1px) brightness(1.08)`。モバイル `display:none!important`（751）
- `.app-day-meter{flex-direction:column;align-items:flex-end;gap:1px;line-height:1.2}`、`__date{font:600 12.5px 'Noto Sans JP';color:var(--tx1)}`、`__count{font:700 13px var(--font-num);color:var(--view)}`、`__count i{margin:0 1px;font-style:normal;color:var(--tx3)}`
- `.app-progress`（647-648）: `position:absolute;left:0;right:0;bottom:-1px;height:2px;background:var(--line);overflow:hidden` / `>span{display:block;height:100%;width:var(--done,0%);background:var(--view);transition:width .55s cubic-bezier(.2,.8,.2,1),background .35s ease}`
- note テーマの入力系（383-397）: すべて `background:rgba(18,17,14,.84)!important;border-color:rgba(238,233,222,.19)!important;box-shadow:none!important`、hover は `rgba(238,233,222,.42)`。→ **`style-focus="border-color:var(--acc)"` は `!important` に負けて効かない**

#### コックピット
- `.cockpit-grid`（228）: `grid-template-columns:minmax(360px,1.18fr) minmax(290px,.9fr) minmax(330px,1fr)!important;gap:1px!important;padding:0!important;background:var(--line)!important;align-content:stretch!important;overflow:hidden!important`（gap がヘアラインの罫になる）。note では `background:rgba(238,233,222,.12)!important`
- `.cockpit-panel`（229）: `min-height:0!important;height:calc(100vh - 68px);overflow:auto;background:var(--bg0)!important;border:0!important;border-radius:0!important;padding:22px 18px 24px!important;gap:11px!important` — **topbar は 70px なので 2px ずれる**
- `.cockpit-panel--today`（230）: `background:color-mix(in srgb,var(--bg1) 65%,var(--bg0))!important`
- `.cockpit-panel-title`（231-232）: `position:sticky;top:-22px;z-index:4;padding:15px 2px 12px!important;margin:-15px -2px 0;background:linear-gradient(180deg,var(--bg0) 72%,transparent)`。`--today` 版は `linear-gradient(180deg,color-mix(in srgb,var(--bg1) 65%,var(--bg0)) 72%,transparent)`
- `.cockpit-task,.cockpit-review,.cockpit-plan,.todo-plan-card,.todo-other-card`（658-664）: `border-radius:var(--ink-rad)!important;box-shadow:var(--ink-lift)`、hover `transform:translateY(-2px)!important;box-shadow:var(--ink-lift-hi)!important` + `border-color:color-mix(in srgb,var(--acc) 28%,var(--line2))!important`（233-234 の `translateY(-1px)` を上書き）
- `.cockpit-primary-action`（238）: `border-radius:9px!important;background:var(--acc)!important;box-shadow:0 8px 24px color-mix(in srgb,var(--acc) 17%,transparent)!important`、hover `translateY(-1px) brightness(1.07)`。note では `border-radius:11px!important`（478-481、`.focus-launch` も同）
- `.cockpit-week-rate`（665-666）: `border:1px solid var(--line)`、hover `border-color:color-mix(in srgb,var(--grn) 45%,var(--line2));background:var(--bg3)!important`
- `.load-bar`（656-657）: `height:7px;border-radius:99px;background:var(--line);overflow:hidden`、fill `background:var(--view);transition:width .5s cubic-bezier(.2,.8,.2,1),background .35s ease`
- `.empty-note`（669-675）: `display:flex;flex-direction:column;gap:6px;padding:20px 16px;text-align:center;border:1px dashed var(--line2);border-radius:15px;background:color-mix(in srgb,var(--view) 4%,transparent)`、`b{font-size:13.5px;color:var(--tx1)}`（+ 562 の `font-family:var(--font-hand)`）、`span{font-size:11px;line-height:1.75;color:var(--tx3)}`。モバイル `padding:16px 13px`（777）

#### Tests
- `.plan-timeline-table`: `box-shadow:0 18px 50px rgba(0,0,0,.14)`（243）+ `border-radius:16px!important`（668）、`overflow-x:auto`
- head/row grid: `270px repeat(dayCount, minmax(104px,1fr))`、`min-width:{{timelineMinW}}`
- `.plan-sticky-cell`: `position:sticky;left:0;z-index:3;transition:background .16s ease`、`style-hover="background:var(--bg3)"`、行 hover でも `.plan-timeline-row:hover .plan-sticky-cell{background:var(--bg3)!important}`（244）
- `.plan-timeline-row`: `transition:opacity .14s ease,box-shadow .14s ease`
- セグメント（1109）: `width:{{s.w}}`（XS 32% / S 46% / M 68% / L 92%）、`height:22px;border-radius:7px;border:1.5px solid;box-shadow:0 0 0 2px var(--bg1);transition:background .25s ease,opacity .25s ease`、`style-hover="filter:brightness(1.3)"`
- GOAL ピル（1111）: `padding:4px 10px;border:2px solid {{cell.lineC}};border-radius:99px;background:var(--bg1);font:700 10px 'Space Grotesk';box-shadow:0 0 12px color-mix(in srgb,{{cell.lineC}} 35%,transparent)`
- 日付ヘッダのバー: `width:14px;border-radius:3px 3px 0 0;min-height:2px;transition:height .4s ease,background .3s ease`
- `.quota-line`（247-248）: `cursor:ns-resize;user-select:none;filter:drop-shadow(0 0 8px color-mix(in srgb,var(--acc) 38%,transparent))`、`:active` で `13px / 65%`。note では `filter:none`（482-485）

#### Review テーブル
- `.review-table`: `background:var(--bg1);border:1px solid var(--line);border-radius:var(--rad);overflow-x:auto`、`.review-table-inner{min-width:960px}`
- head / row grid: `86px minmax(200px,1fr) 84px 96px 68px 86px 72px 158px; gap:0 10px; padding:10px 14px`
- `.review-table-row{transition:background .14s ease}`（667）+ `style-hover="background:var(--bg3)"`、`border-left:3px solid {{r.subjC}}`
- `.review-divider`: `padding:16px 14px 6px;background:var(--bg2)`、両端に `1px dashed var(--line2)`

#### ドロワー / モーダル（インラインスタイル）
- 共通ドロワー（editor 1535 / review detail 1610 / score 1652）: `position:absolute;right:0;top:0;bottom:0;width:{{edW|rdW|scW}};max-width:94vw;background:var(--bg1);border-left:1px solid var(--line2);display:flex;flex-direction:column;gap:14px;padding:18px;animation:slideInR .2s ease;box-shadow:-12px 0 40px rgba(5,10,25,.45)`。左端に `left:-3px;width:7px;cursor:ew-resize;z-index:5` のリサイズハンドル
- オーバーレイ: editor は `background:{{edOverlayBg}}`（展開時 `rgba(5,9,20,.45)` / 折りたたみ時 `transparent` + `pointer-events:none`）、他は `rgba(5,9,20,.45)`。いずれも `z-index:45;animation:fadeIn .15s ease`
- 折りたたみタブ（1528）: `right:0;top:88px;width:54px;padding:10px 7px;border-radius:12px 0 0 12px;border-right:0;box-shadow:-8px 8px 28px rgba(0,0,0,.28)`、`writing-mode:vertical-rl` のラベル（`max-height:150px;overflow:hidden`）
- 再配分モーダル（1698-1699）: backdrop `rgba(5,9,20,.66);backdrop-filter:blur(3px);z-index:50;animation:fadeIn .15s ease`、パネル `width:620px;max-width:92vw;max-height:86vh;overflow:auto;border-radius:16px;padding:22px;animation:popIn .18s ease;box-shadow:0 24px 80px rgba(0,0,0,.5)`
- 理解度モーダル（1779-1780）: `z-index:55`、パネル `width:460px;max-width:92vw`、他は同上
- 集中モード（1816-1820）: `position:fixed;inset:0;z-index:65;background:color-mix(in srgb,var(--bg0) 92%,black);backdrop-filter:blur(16px);display:grid;place-items:center;animation:fadeIn .18s ease`。カード `width:min(560px,92vw);padding:28px;border-radius:20px;box-shadow:0 30px 100px rgba(0,0,0,.55)`。タイマー円 `210×210;border:10px solid var(--line);border-top-color:var(--acc);border-radius:50%;box-shadow:var(--gAcc)`
- アプリスイッチャー（190-199）: backdrop `position:fixed;inset:0;z-index:110;display:grid;place-items:center;padding:24px;background:rgba(3,12,24,.72);backdrop-filter:blur(16px);animation:fadeIn .16s ease`（note は `rgba(8,8,7,.82)` + blur なし）。panel `width:min(680px,94vw);max-height:min(720px,90vh);overflow:auto;padding:22px;background:linear-gradient(145deg,color-mix(in srgb,var(--bg1) 96%,#0f3551),var(--bg1));border-radius:22px;box-shadow:0 34px 110px rgba(0,0,0,.58);animation:popIn .2s ease`。current カード `width:min(360px,100%);margin:22px auto 28px;padding:22px;border-radius:18px;background:radial-gradient(circle at 18% 12%,color-mix(in srgb,var(--acc) 14%,transparent),transparent 58%),var(--bg2);box-shadow:0 18px 48px rgba(0,0,0,.22),var(--gAcc)`、icon `72×72;border-radius:18px`。grid `repeat(3,minmax(0,1fr));gap:12px`、tile `min-height:138px;padding:15px;border-radius:15px`、tile icon `44×44;border-radius:13px;border:1px solid color-mix(in srgb,var(--app-accent) 48%,var(--line2));background:color-mix(in srgb,var(--app-accent) 12%,var(--bg3))`、status バッジ `border-radius:99px;background:color-mix(in srgb,var(--app-accent) 10%,var(--bg3))`
- ツールチップ（1867）: `position:fixed;left:{{tooltipX}};top:{{tooltipY}};transform:translate(-50%,-110%);z-index:60;background:var(--bg3);border:1px solid var(--line2);border-radius:9px;padding:8px 11px;pointer-events:none;box-shadow:0 8px 28px rgba(0,0,0,.45)`
- トースト（1875）: `position:fixed;bottom:26px;left:50%;transform:translateX(-50%);z-index:130;background:var(--bg3);border:1px solid var(--acc);border-radius:99px;padding:10px 20px;font:700 12.5px 'Noto Sans JP';color:var(--tx0);box-shadow:var(--gAcc);animation:toastIn .2s ease`

#### z-index 全一覧
`9999` splash / `130` toast / `110` app-switcher backdrop / `100` mobile nav / `80` search popover / `65` focus / `60` tooltip / `55` ask modal / `50` redist modal / `45` 3ドロワー / `20` nav resize handle / `12` topbar / `5` drawer resize handle / `4` cockpit-panel-title / `3` sticky セル・タイムラインヘッダ / `2` セグメント・GOAL / `1` セルグリッド / `-1` `.compass-shell::before`

### 3.6 アニメーション / トランジション

`@keyframes` 一覧（19-24, 28-47, 149-151, 655）:
`slideIn`(**未使用**) `popIn` `fadeIn` `toastIn` `fadeUp` `slideInR` `inkIn` /
`spReadyOut` `spStageOut` `spMarkSet` `spBuildOut` `spBloom` `spGuideH` `spGuideV` `spGuideRing` `spRimDraw` `spTicks` `spFaceSet` `spRingDraw` `spCardIn` `spSweep` `spNeedleSet` `spPinIn` `spPinPulse` `spLetterIn` `spTodoWipe` `spTodoLine` /
`mkDrift` `mkBezel` `mkBreathe` / `sc-shine`（ランタイム側）

| セレクタ | 内容 |
|---|---|
| `.compass-brand` | `background .16s ease,transform .16s ease` |
| `.compass-brand__chevron` | `transform .16s ease,color .16s ease` |
| `.compass-brand__mark` | `border-color .3s ease,background .3s ease` |
| `.app-nav-item` | `background/color/border-color/transform .16s ease` |
| `.app-nav-item__key` | `opacity/color/border-color .16s ease` |
| `.app-search` | `border-color .16s ease,box-shadow .16s ease` |
| `.app-search-popover` | `animation:fadeUp .16s ease` |
| `.app-view-title::before` | `background .35s ease` |
| `.app-progress>span` | `width .55s cubic-bezier(.2,.8,.2,1),background .35s ease` |
| `.load-bar__fill` | `width .5s cubic-bezier(.2,.8,.2,1),background .35s ease` |
| `.compass-shell::before` | `background .5s ease` |
| `.app-alert-pill` / `.focus-launch` / `.cockpit-primary-action` / `button[style*="var(--grad)"]` | `transform .16s ease,filter .16s ease`（hover `translateY(-1px)` + `brightness(1.07\|1.08)`） |
| `.cockpit-task,.cockpit-review,.cockpit-plan` | `transform/border-color/background/box-shadow .16s ease` |
| `.todo-plan-card,.todo-other-card` | `border-color/background/transform .16s ease`（245-246 の hover は `translateY(-1px)`、658-664 で `-2px` に上書き） |
| `.cockpit-week-rate` | `border-color .16s ease,background .16s ease` |
| `.review-table-row` | `background .14s ease` |
| `.plan-timeline-row` | `opacity .14s ease,box-shadow .14s ease` |
| `.plan-sticky-cell` | `background .16s ease` |
| タイムラインセル | `background .14s ease,border-color .14s ease` |
| セグメント | `background .25s ease,opacity .25s ease` |
| `.timetable-week-strip button` | `border-color/background/color/transform .15s ease`（hover `translateY(-1px)`） |
| `.timetable-slot`（note） | `border-color/background-color/box-shadow .16s ease` |
| `[data-screen-label] input,select` | `border-color/box-shadow/background .16s ease`、hover `border-color:color-mix(in srgb,var(--acc) 38%,var(--line2))!important` |
| `.app-switcher-current/-tile` | `transform .16s ease,border-color .16s ease(,background)`、hover `translateY(-2px)`（note では `transform:none`） |
| `.panel-heading__link` | `color .16s ease`、hover `var(--view)` |
| `.theme-switch>span` | `background .16s ease,color .16s ease` |
| `.mini-editor-row` | `box-shadow .12s ease,opacity .12s ease` |
| 画面切替 | `animation:inkIn .3s cubic-bezier(.2,.85,.2,1)!important`（651-655） |
| ドーナツ SVG | `stroke-dasharray .5s ease`（62/64px）、`.55s ease`（110px）、計画バー `width .45s ease` |
| 再配分トグル | `transition:.16s ease`、つまみ `transform:translateX(0→15px)` |

**FLIP 並べ替え**（`snapFlip` HTML:2363-2367 + `componentDidUpdate` 2368-2391）: `[data-flipid]` を持つ要素の top 差分が **3px 以上**なら `translateY(dy)` → `transition:transform .18s ease` → `''`、**220ms 後にクリア**。ドラッグ中の要素はスキップ。`data-flipid` を持つのは**ミニタスク編集ドロワーの行だけ**（HTML:1569、`flipId = 'ed-' + m.id`、HTML:3763）。

#### `prefers-reduced-motion:reduce`（3ブロック）
1. 166-170: スプラッシュ（§2.2 参照）
2. 535: `.app-nav-item,.cockpit-task,.cockpit-review,.cockpit-plan,.cockpit-primary-action{transition:none!important}`
3. 779-782: `[data-screen-label]{animation:none!important}`、`.compass-shell *,::before,::after{transition-duration:.01ms!important}`

### 3.7 グローバル / リセット

```css
html,body{margin:0;padding:0;height:100%}          /* 17 */
*{box-sizing:border-box}                            /* 18 */
::-webkit-scrollbar{width:8px;height:8px}           /* 171-173 */
::-webkit-scrollbar-thumb{background:rgba(128,150,190,.25);border-radius:99px}
::-webkit-scrollbar-track{background:transparent}
:root{color-scheme:dark}                            /* 176 — テーマに関わらず常に dark */
body{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
button,input,select,textarea{font:inherit}          /* 178 */
button:focus-visible,…,[tabindex]:focus-visible{outline:2px solid var(--acc);outline-offset:2px}  /* 179 */
::selection{background:color-mix(in srgb,var(--acc) 30%,transparent);color:var(--tx0)}            /* 180 */
```
- `.compass-shell` 内は `outline:2px solid var(--view)!important;outline-offset:2px`（551-554）
- **`::selection` は死にルール**: `--acc` / `--tx0` はルート要素で未定義（`.compass-theme` 上でのみ定義）なので `color-mix` が無効値になり、ブラウザ既定の選択色になる
- `:root{color-scheme:dark}` があるため、light テーマでも `<input type=date>` は各要素のインライン `color-scheme:{{schemeVal}}`（`light ? 'light' : 'dark'`, HTML:4198）で個別に上書きしている

### 3.8 レスポンシブ

ブレークポイント: **1180px** と **820px**（820px のブロックは 2 つ、261-308 と 743-778。後者が後勝ち）。

#### `@media(max-width:1180px)`（254-260）
```css
.cockpit-grid{grid-template-columns:minmax(350px,1.15fr) minmax(300px,.85fr)!important;overflow:auto!important}
.cockpit-panel{height:auto;min-height:520px!important}
.cockpit-panel--plans{grid-column:1/-1;display:grid!important;grid-template-columns:1fr 1fr;align-content:start}
.cockpit-panel--plans>.cockpit-panel-title,.cockpit-panel--plans>.cockpit-primary-action{grid-column:1/-1}
.app-search{min-width:260px}
```

#### `@media(max-width:820px)` — 実効値
- `:root{--mobile-nav-h:calc(68px + env(safe-area-inset-bottom))}`（744 が 262 の 64px を上書き）
- `html,body{width:100%;height:100%;overflow-x:hidden;overscroll-behavior-x:none}`、`button,[role=button],input,select{touch-action:manipulation}`
- `.compass-shell{display:block!important;height:100dvh!important;padding-bottom:calc(var(--mobile-nav-h) + 20px)!important}`
- `.compass-nav` → 下部固定バー: `position:fixed;left:0;right:0;bottom:0;z-index:100;width:100%!important;height:var(--mobile-nav-h);padding:6px max(6px,env(safe-area-inset-left)) calc(6px + env(safe-area-inset-bottom)) max(6px,env(safe-area-inset-right))!important;display:flex!important;flex-direction:row!important;gap:2px!important;border:0!important;border-top:1px solid var(--line2)!important;background:color-mix(in srgb,var(--bg2) 93%,transparent)!important;backdrop-filter:blur(20px)`。note では `rgba(21,19,16,.985)!important;border-top-color:rgba(242,237,225,.18)!important;backdrop-filter:none`（527-534）
- `.compass-brand,.compass-nav-footer,.compass-nav>[style*="position:absolute"]{display:none!important}`（267）
  → **3番目のセレクタは効かない**（React は `position: absolute` とスペース付きで直列化する）。**ナビのリサイズハンドルはモバイルでも残る**
- `.mobile-app-launcher{display:flex}`: `36×36;border:1px solid var(--line2);border-radius:10px;background:var(--bg2);box-shadow:0 8px 22px rgba(0,0,0,.12)`
- `.app-nav-item{min-height:52px!important;flex:1;flex-direction:column!important;gap:3px!important;padding:4px 2px!important;border:0!important;border-radius:14px!important;text-align:center}`、`::before{18×18}`、`::after{display:none}`、`__label{font-size:9.5px!important;text-align:center}`、`__key{display:none}`、`.is-active{background:color-mix(in srgb,var(--nav-hue) 16%,transparent)!important}`、`__badge{position:absolute;top:2px;right:calc(50% - 20px);padding:0 5px;font-size:8.5px}`
- **FAB**（762-776、`.compass-theme-mode[data-theme] .app-nav-item[data-nav="add"]`）:
  ```
  --nav-icon: 素のプラス SVG（M12 5v14M5 12h14, stroke-width 2.4, stroke-linecap round）
  flex:0 0 58px!important; max-width:58px; height:58px; min-height:58px!important;
  align-self:center; position:relative; top:-15px; margin:0 6px; padding:0!important;
  border-radius:50%!important; background:var(--org)!important; color:var(--onAcc)!important;
  border:1px solid color-mix(in srgb,var(--org) 72%,black)!important;
  box-shadow:0 14px 28px -10px rgba(0,0,0,.66); transition:transform .14s ease;
  ::before{28×28;opacity:1}   .app-nav-item__label{display:none}
  .is-active / :hover → background:var(--org); color:var(--onAcc)（変化しない）
  :active{transform:scale(.93)}
  ```
- `.compass-main{height:calc(100dvh - var(--mobile-nav-h));width:100%;min-width:0;overflow:hidden}`
- `.compass-topbar{min-height:52px;padding:8px 13px 9px!important;gap:6px!important;flex-wrap:wrap}`
- `.app-view-title{flex:1;min-width:0;padding-left:10px}`、`__name{font-size:16px!important;white-space:nowrap;ellipsis}`、`>div:last-child{display:none}`（**サブタイトル非表示**）
- `.app-alert-pill{display:none!important}`（751、コメント「未完了の再配分はナビの⚠バッジと重複するので」）
- `.app-search{order:4;min-width:0!important;width:100%;margin-left:0!important;flex-basis:100%}`、`.app-search-shortcut{display:none}`、popover `max-height:calc(100dvh - 128px)`、input `height:34px`
- `.app-top-actions{margin-left:0!important}`、`>span{font-size:11px!important}`、`sc-if{display:none!important}`（**`sc-if` は DOM に出ないので死にルール**）
- `.cockpit-grid{display:block!important;overflow:auto!important;background:var(--bg0)!important}`、`.cockpit-panel{height:auto;min-height:0!important;border-bottom:1px solid var(--line)!important;padding:18px 14px 22px!important}`、`.cockpit-panel--plans{display:flex!important}`
- 各画面 `[data-screen-label="Tests"|"ToDo"|"Review"|"Data"|"Add"]{padding:14px!important;width:100%;min-width:0;overflow-x:hidden!important}`、ToDo/Data は `display:flex!important;flex-direction:column!important;grid-template-columns:none!important`、Add は `>div{width:100%!important;grid-template-columns:minmax(0,1fr)!important}`
- `.mobile-scroll-hint{display:block!important;margin:-2px 2px 8px;color:var(--tx3);font:600 10.5px 'Noto Sans JP';text-align:right}`（デスクトップは 252 で `display:none`）
- タイムライン: `.plan-timeline-head,.plan-timeline-row{grid-template-columns:156px repeat(var(--timeline-days),92px)!important;min-width:var(--timeline-mobile-min-width)!important}`、`.plan-timeline-table{max-width:100%;-webkit-overflow-scrolling:touch;scrollbar-width:thin;overscroll-behavior-x:contain}`、`.plan-sticky-cell{padding:11px 10px!important}` + 2段目 `gap:4px;flex-wrap:wrap`
- `.plan-controls{gap:8px!important}` `>div{min-height:54px}`、`.plan-legend{flex-basis:100%!important;justify-content:flex-start!important;gap:8px 12px!important;flex-wrap:wrap}`、`.plan-overdue{align-items:flex-start;flex-wrap:wrap}` + `>button{width:100%;margin-left:0!important;min-height:42px}`
- **Review テーブルのカード化**（297-303）:
  ```css
  .review-table{overflow:visible!important;background:transparent!important;border:0!important}
  .review-table-inner{min-width:0}
  .review-table-head{display:none!important}
  .review-table-row{display:grid!important;
    grid-template-columns:auto minmax(0,1fr) auto!important;
    grid-template-areas:"subject title actions" "round next actions" "last stage status";
    gap:8px 9px!important;margin-bottom:8px;padding:11px 10px!important;border-radius:11px;
    background:var(--bg1)!important}   /* 上/右/下のみ 1px border、左は subjC の 3px を維持 */
  .review-table-row>span:nth-child(1..8) → subject/title/last/next/round/stage/status/actions
  .review-table-row span[data-label]::before{content:attr(data-label);display:block;margin-bottom:2px;
    color:var(--tx3);font:500 8.5px 'Noto Sans JP'}
  .review-divider{margin:10px 0 8px;border-radius:10px}
  .review-table-foot{padding:10px 4px!important;line-height:1.7}
  ```
- `.timetable-week-strip{width:100%!important;grid-template-columns:28px repeat(5,minmax(0,1fr)) 28px!important}`（デスクトップは `32px repeat(5,minmax(48px,1fr)) 32px`）
- `.score-group-row{display:grid!important;grid-template-columns:auto minmax(0,1fr) auto;gap:6px 8px!important}` + `>span:nth-child(1){grid-column:1;grid-row:1/3}` `(2){2/1}` `(3){2/2}` `(4){3/2}` `(5){3/1}` `(6){display:none}`（**「→」を隠す**）
- ミニタスク編集行（306）: `.mini-editor-row{flex-wrap:wrap}`、`.mini-drag-handle,.mini-day-label{display:none!important}`、`.mini-title{order:2;flex:1!important}` `.mini-size{order:3}` `.mini-delete{order:4}`、`.mini-day-mobile{display:block!important;order:5;flex:1 1 150px;min-height:36px;padding:6px 8px;border-radius:8px;background:var(--bg1);font:600 11px 'Space Grotesk';color-scheme:dark}`（**ライトテーマでも `color-scheme:dark` 固定**）、`.mini-mobile-actions{display:flex!important;order:6;gap:5px}` + button `width:38px;min-height:36px;border-radius:8px;background:var(--bg3);font-weight:700`
- `.todo-summary{flex-wrap:wrap}`、`.todo-summary .focus-launch{width:100%;min-height:44px}`、`.todo-summary>div:nth-child(2){min-width:150px}`
- アプリスイッチャー（307）: backdrop `padding:12px`、panel `max-height:90dvh;padding:18px;border-radius:18px`、current `margin:18px auto 22px;padding:16px`、icon `58×58`、grid 1列、tile `min-height:98px;grid-template-columns:44px minmax(0,1fr) auto;grid-template-rows:auto auto`
- `.empty-note{padding:16px 13px}`

### 3.9 `style-hover` / `style-focus`（ランタイム生成の疑似クラス）

`SUP:403-405` が `style-*` 属性を `host.pseudoClass(pseudo, value)` に渡し、`.scpN:hover{…}` / `.scpN:focus{…}` を `insertRule`（`before`/`after` は `::`）。**値は生の属性文字列でコンパイル時に一度だけ登録され、`{{ }}` は解決されない。**

全 35 箇所（HTML 行番号 → 内容）:
- `:hover` → `color:var(--pink);background:var(--pinkBg)`: 897（カウントダウン削除）, 1413（Add のミニ行削除）, 1581（エディタのミニ削除）, 1643（Review 完全削除）, 1688（点数行削除）
- `:hover` → `border-color:var(--acc);color:var(--acc)`: 989（「ToDo画面で実行する →」）
- `:hover` → `background:var(--bg3)`: 1097（`.plan-sticky-cell`）, 1500（`.review-table-row`）
- `:hover` → `background:var(--bg3);border-color:var(--line2)`: 1268（`.score-group-row`）
- `:hover` → `filter:brightness(1.3)`: 1109（セグメント）
- `:hover` → `border-color:var(--pink);color:var(--pink);background:var(--pinkBg)`: 1201（選択タスク削除）
- `:hover` → `border-color:var(--acc);color:var(--tx0)`: 1512（`⋯`）
- `:hover` → `border-color:var(--pink);color:var(--pink)`: 1634（今日のToDoから外す）
- `:hover` → `border-color:var(--grn);color:var(--grn)`: 1636（復習完了にする）
- **1601 だけ `style-hover="border-color:{{ edPlanActionHover }};color:{{ edPlanActionHover }};background:{{ edPlanActionHoverBg }}"` と `{{ }}` を含むため CSS として無効 → hover 効果なし**（死にルール）
- `:focus` → `border-color:var(--acc)`: 901, 903, 1223, 1281, 1283, 1285, 1286, 1342, 1351, 1406, 1422, 1558, 1559, 1561, 1563, 1596
- `:focus` → `border-color:var(--acc);box-shadow:var(--gAcc)`: 1322（タスク名）, 1327（教科）, 1451（時間割の教科 input）
- `:focus` → `border-bottom:1px dashed var(--acc)`: 1576（ミニタスク名編集）

**生成ルールは `!important` を持たず詳細度も 1 クラス**。note テーマの入力欄 `!important`（383-397）には負ける。

### 3.10 アイコンシステム

#### (a) ナビのマスクアイコン（CSS data-URI、`--nav-icon`）
すべて `viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.8'`、`mask:var(--nav-icon) center/contain no-repeat` で `currentColor` 着色。

| data-nav | 行 | 図形 |
|---|---|---|
| `cockpit` | 207 | 4つの `rect` 7×7 rx=1（`3,3` `14,3` `3,14` `14,14`）＝ 2×2 グリッド |
| `tests` | 208 | カレンダー `M6 3v3M18 3v3M4 9h16M5 5h14a2 2 0 0 1 2 2v13H3V7a2 2 0 0 1 2-2Z` |
| `todo` | 209 | クリップボード `rect 4,3 16×18 rx=2` + `m8 9 2 2 4-4M8 16h8` |
| `review` | 210 | 巡回矢印＋時計 `M4 12a8 8 0 1 0 2-5.3L4 9` / `M4 4v5h5M12 8v5l3 2` |
| `add` | 211 | 角丸四角＋プラス `rect 3,3 18×18 rx=3` + `M12 7v10M7 12h10` |
| `data` | 212 | 棒グラフ `M5 20v-7h4v7M10 20V8h4v12M15 20V4h4v16M3 20h18` |
| `add`（モバイル FAB） | 763 | 素のプラス `M12 5v14M5 12h14`、`stroke-width='2.4' stroke-linecap='round'` |

#### (b) インライン SVG

| 用途 | 場所 | 仕様 |
|---|---|---|
| 検索アイコン | 925 | `14×14 viewBox 0 0 20 20`、`circle(9,9,6) stroke-width 2` + `line(13.5,13.5→18,18) stroke-linecap:round`、`currentColor` |
| スプラッシュ build / mark | 792-856 | §2.2 |
| 計画カードのドーナツ | 1021 | `62×62 viewBox 0 0 68 68`、`r=29 stroke-width 6`、`stroke-dasharray:{{p.dash}} 182`、`transform="rotate(-90 34 34)"`、`stroke-linecap:round`、`transition:.5s` |
| ToDo サマリのドーナツ | 1153 | `110×110 viewBox 0 0 120 120`、`r=52 stroke-width 10`、`stroke-dasharray:{{donutDash}} 327`、`rotate(-90 60 60)`、stroke `url(#cmpGrad)` = `linearGradient(x1 0,y1 0,x2 1,y2 1)` `#4fd8e8`→`#8a6cf5`。**683-684 で `.todo-summary linearGradient stop:first-child{stop-color:var(--view)}` / `:last-child{stop-color:color-mix(in srgb,var(--view) 55%,var(--vio))}` に上書き** |
| エディタのドーナツ | 1545 | `64×64 viewBox 0 0 68 68`、`stroke:{{edC}}`、`{{edDash}} 182` |
| Data の円グラフ | 1242-1247 | `172×172 viewBox 0 0 42 42`、`cx=21 cy=21 r=15.9 stroke-width 7`、各弧 `stroke-dasharray:"{pct} {100-pct}"` `stroke-dashoffset:{25 - 累積}` |
| 点数推移の折れ線 | 1666-1679 | `viewBox 0 0 360 200;width:100%;height:auto`（§8.3） |
| Compass アイコン | `public/compass-icon.svg` | `512×512`。台紙 `circle r=240 #17150f`（**スプラッシュの mark にはない**）、目盛 `r=212 #f2ede1 op .42 sw 13 dash 3.6 33.4`、リム `r=190`（`op .12 sw 34` + `sw 23`）、文字盤 `r=137 fill url(#ip-face)` stroke `#f2ede1 op .42 sw 4`、リング `r=113 op .22 sw 3` / `r=82 #96c49c op .85 sw 7` / `r=54 #ddb277 sw 7`、N/E/S/W `Space Grotesk 700 23px fill #f2ede1 op .42`、北針 `url(#ip-needle-n)`（`#fffdf6`→`#e6dfd0`）stroke `#f2ede1` sw 8、南針 `url(#ip-needle-s)`（`#c8944f`→`#ddb277`）stroke `#8a6a3c` sw 6、ピン `r=25 #100f0c stroke #f2ede1 sw 9` + `r=8 #f2ede1` |

参照 URL はすべて `/compass-icon.svg?v=20260728-ink`（favicon 8、brand 867 = 34×34、mobile launcher 923 = 25×25、app-switcher 1841 = 62×62）。

#### (c) 文字グリフとして使われている「アイコン」
`↗`（brand chevron 870）/ `✕`（削除・閉じる 多数）/ `＋`（全角プラス: 904, 945, 1001, 1224, 1428, 1509, 1597, 1631）/ `－`（1049, 1056）/ `✓` / `⚠`（957, 1073, 1100, ナビバッジ 2645）/ `▶`（1160）/ `⋯`（1512）/ `≡`（1098, 1118, 1570）/ `⠿`（1179、両端2個）/ `↕`（1179）/ `☷`（1212）/ `›` `‹`（1133, 1530, 1540）/ `→` `←` / `↑` `↓`（1583-1584）/ `▾` `▸`（4214）/ `✎`（908, 1099）/ `✦`（909）/ `☀`（910）/ `◎` `○` `△`（3082-3084）/ `↻`（1702）/ `▲` `▼` `±`（3324, 4140）/ `📚` `☑`（2913-2914、**テンプレート未使用**）/ `♡` `＋`（2000-2002）/ `🎉`（"定着 🎉" 3071）

### 3.11 JS が計算するスタイル値

- 教科チップ: `c/bg/bd` = `SUBJ[name].c` / `.bg` / 選択時反転（`c:'var(--onAcc)'`, `bg:SUBJ[name].c`）— 3210-3212, 3379-3381
- タスク行の淡いティント: `tintBg = color-mix(in srgb, <subjC> 7%, var(--bg2))`（2870）、ToDo 行は非選択 7%/`--bg2`・選択 14%/`--bg3`（2910-2911, 3001, 3015）
- 選択中カードの発光: `'0 0 0 1px color-mix(in srgb,<subjC> 35%,transparent), ' + gl(subjC, 8)`（3003）、単発は 30% + `gl(c,7)`（3017）
- ミニタスク行ティント: `color-mix(in srgb,<planSubjC> {12|10|5}%,var(--bg2))`（今日12 / 遅れ10 / その他5、3035, 3042）
- 日付ヘッダ: 今日 `color-mix(in srgb, var(--acc) 8%, transparent)` / 休日 `color-mix(in srgb, var(--grn) 5%, transparent)`（2661）。タイムラインセルは 6% / 4%（2770）
- ドロップ先ハイライト: `color-mix(in srgb,<subjC> 18%,var(--bg2))` + `border-color:<subjC>`（2778-2779）
- 計画行の線: `lineStyle` = テスト `solid` / 予習 `dashed`（2781）。`cell.lineC` は §7.4
- 計画カード背景: テストのみ `color-mix(in srgb, ' + (light ? '#6d4de0' : '#a78bfa') + ' 6%, var(--bg2))`（2727）— **トークン化されていない唯一のハードコード色**
- 再配分ピック中の sticky セル: `color-mix(in srgb,<subjC> 10%,var(--bg1))`（2703）
- 負荷バー色: 超過 `var(--pink)` / 休日 `var(--grn)` / それ以外 `var(--acc)`（2665, 3639）
- 時間割スロット: `--slot-pencil:{{slot.pencil}}` = 教科色（3440）。bg は active `color-mix(in srgb, var(--acc) 11%, var(--bg2))` / 追加済み `…var(--grn) 7%…` / 通常 `var(--bg2)` / 未開講 `color-mix(in srgb, var(--tx3) 6%, var(--bg2))`、`op` は未開講 0.58（3444-3447）
- ドラッグ中: `rowBg:'var(--bg3)'`, `rowBd:'var(--acc)'`, `lift:'scale(1.02)'`, `shadow:'0 10px 26px rgba(0,0,0,.45)'`, `op:.85`（3771-3775, 2918-2920）。挿入線 `inset 0 ±3px 0 var(--acc)`（3774）
- 完了時の共通: `op` = セグメント 0.4（2684）/ 復習行 0.45（3248）/ 今日タスク 0.5（2871）/ 復習カード 0.5（3132）/ ミニ行 0.52（3044）/ 選択詳細 0.55（4096）/ エディタ行 0.6（3775）、`deco:'line-through'`、チェック箱 `boxBd/boxBg:'var(--acc)'`

### 3.12 既知の癖・死にルール（1:1 再現時に「そのまま」再現すべきもの）

1. `themeName` の `note→"dark"` / `dark→"neon"` 反転（§3.2）
2. `[data-theme="dark"] .compass-shell::before` の綴じ線は `!important` に負けて表示されない
3. `::selection` は `--acc` 未定義で無効
4. `.compass-nav>[style*="position:absolute"]{display:none!important}` は React のスタイル直列化と一致せず効かない → モバイルでもナビのリサイズハンドルが残る
5. `.app-top-actions sc-if{display:none!important}` は `sc-if` が DOM に出ないため無効
6. HTML:1601 の `style-hover` は `{{ }}` を含むため無効
7. `.cockpit-panel{height:calc(100vh - 68px)}` vs `.compass-topbar{min-height:70px}` の **2px 差**
8. `@keyframes slideIn` は未使用。`--ink-rad-sm` / `--paper-soft` / `--graphite` も未使用
9. `--rad` は note では 12px 固定、他は `props.radius`（既定 12px）だが JS フォールバックは 14px
10. Space Grotesk の 600 は未ロードウェイト
11. `.mini-day-mobile` は `color-scheme:dark` 固定（ライトテーマでも日付ピッカーが暗い）
12. note/light では `--gAcc/--gVio/--gGrn` が `none` だが、`gl()` を直接呼ぶ箇所（計画カードの `glow`/`barGlow`、選択中カード）は `props.glow` に従って発光する
13. `x-dc{display:none!important}`、`#__dc-atomics`（未使用）、`BASE_CSS` の `@media print` ベースライン（`@page{margin:.5cm}` / `#dc-root,#dc-root>.sc-host{height:auto}` / 全要素 `animation-duration:.001s!important;transition-duration:0s!important;print-color-adjust:exact`）が head に残る
14. `.nav-dot` は常に `display:none!important`
15. Data の円グラフは `r=15.9`（円周 99.9）に対して 100 単位の dasharray を使っており約 0.1% ずれる

---

## 4. データモデルと永続化

### 4.1 状態の置き場所は3つ

| 置き場所 | 実体 | 永続化 |
|---|---|---|
| `this.state`（HTML:2023-2045） | フラット state。UI 一時状態と永続データが混在 | `persistentKeys()` に列挙されたキーだけ |
| `this.PLANS`（HTML:1971 で `{}` 初期化） | 計画マスタ。**state ではない**インスタンスフィールド。直接 mutate される | `exportData()` が `plans` として保存 |
| `this.SUBJ`（HTML:1974-1996） | 教科→色トークン。`subjOf()` が未知教科をパレットで追記 | **保存されない**（起動ごとに再構築、`renderVals` 冒頭 HTML:2553-2562） |

### 4.2 `exportData()` と保存ペイロード（HTML:2242-2246）

```js
exportData() {
  const st = {};
  this.persistentKeys().forEach(k => { st[k] = this.state[k]; });
  return { version: 1, plans: Object.assign({}, this.PLANS), state: st };
}
```
`version` は **1 固定で読み込み側は一切参照しない**（デッドフィールド）。

PUT ボディは `JSON.stringify({ data: exportData() })`。**毎回フル置換。差分 API はない。**

### 4.3 `persistentKeys()`（HTML:2117-2119）— 23キー（この配列順で代入される）

```js
['theme','themeVersion','view','navOrder','planOrder','wkMax','weMax','selId','panelW',
 'studyLog','scores','countdowns','addSubj','addType','addSize','recentSubjs',
 'dayOverrides','timetableFocusDate','planQuota','segs','extras','reviews','order']
```

> `settings` という名前のキーは**存在しない**。設定に相当するのは `wkMax` / `weMax` / `panelW` / `theme` / `themeVersion`。

| キー | 型 | 初期値 | 備考 |
|---|---|---|---|
| `theme` | `'light'\|'dark'\|'note'` | `'note'` | `setLight/setDark/setNote`（3962-3964） |
| `themeVersion` | number | `3` | 常に 3 に強制（2059, 2168） |
| `view` | `'cockpit'\|'tests'\|'todo'\|'review'\|'add'\|'data'` | `'cockpit'` | |
| `navOrder` | `string[]` | `['cockpit','tests','todo','review','add','data']` | ナビ D&D |
| `planOrder` | `string[]`（plan id） | `[]` | Tests 行 D&D（2709-2721） |
| `wkMax` | number（分） | `240` | ±30、60–720（4033-4034） |
| `weMax` | number（分） | `360` | ±30、60–720（4035-4036） |
| `selId` | `string\|null` | `null` | ToDo 選択中 |
| `panelW` | `{nav,search,editor,review,score}` | `{nav:196, search:308, editor:410, review:380, score:400}` | §2.8 |
| `studyLog` | `StudyLogEntry[]` | `[]` | §4.6 |
| `scores` | `Score[]` | `[]` | §4.7 |
| `countdowns` | `Countdown[]` | `[]` | §4.8 |
| `addSubj` | string | `'数学'` | |
| `addType` | `'single'\|'review'\|'prep'\|'test'` | `'single'` | |
| `addSize` | `'XS'\|'S'\|'M'\|'L'` | `'M'` | |
| `recentSubjs` | `string[]`（最大4） | `[]` | `submitAdd` 成功時に先頭追加（3578） |
| `dayOverrides` | `Record<iso, Record<period, {subj?,held?}>>` | `{}` | §4.9 |
| `timetableFocusDate` | iso | `this.TODAY` | |
| `planQuota` | `Record<planId, number>` | `{}` | §4.10 |
| `segs` | `Seg[]` | `[]` | §4.4 |
| `extras` | `Extra[]` | `[]` | §4.4 |
| `reviews` | `Review[]` | `[]` | §6.1 |
| `order` | `string[]`（task id） | `[]` | §4.11 |

**保存されない state（全リスト、HTML:2023-2045）**:
`searchOpen, query, appSwitcherOpen, dragNav, navDragOver, dragPlanRow, dragPlanOver, dragId, dragCkItem, dragCkPlan, dragTestSeg, dragTestTarget, dragGoalPlan, tooltip, toast, redistOpen, redistMode('even'), redistPlan, redistPickMode, redistIncludeManual(false), redistLateDays(7), editorPlan, editorCollapsed, edPlanName, edPlanSubj, edPlanDue, edPlanRange, edPlanType('test'), edNewTitle, edNewSize('M'), dragMini, dragMiniOver, dragMiniPos('before'), editMiniName, todoNewSub, todoNewSize('S'), revSel, revFilter, revSort('due'), revAsk, revAskGrade, revAskSize, dragRev, revEditName, scoreName, scoreSubj, scoreVal, scoreDay(=TODAY), scoreSel, countdownTitle, countdownDate(=TODAY), addTitle, addDay(=TODAY), addDay2(''), addMemo, addMinis([]), addMiniTitle, addMiniSize('S'), addDetailOpen(false), addGenerator('manual'), duoStart('1'), duoEnd('400'), duoChunk('10'), chartStart('1'), chartEnd('4'), addErr({}), addDone(null), addSlotSel, addSlotDate, dragQuota, focusOpen(false), focusRunning(false), focusRemaining(1500), focusPreset(25), cloudStatus('loading'), cloudUser(window.COMPASS_USER_EMAIL || '')`

### 4.4 永続エンティティのフィールド一覧

#### `Plan`（`this.PLANS[planId]`）— **id フィールドを持たない**（キーが id）

| field | type | 生成値 |
|---|---|---|
| `name` | string | `subj + ' ' + t`（**教科 + 半角空白 + タスク名**、HTML:3556）/ `rSel.title \|\| 'テスト'`（3280） |
| `type` | `'test'\|'prep'` | `S.addType==='test' ? 'test' : 'prep'` |
| `due` | iso | GOAL 日 / 期限日 |
| `subj` | string | |
| `range` | string | `memo \|\| '範囲は未設定'` |
| `timetablePeriod` | `number\|null` | 1..7 |
| `timetableDate` | `iso\|null` | |

`savePlanEdit`（3692-3696）は `name/subj/due/range/type` の **5つだけ** を `Object.assign` で上書き（`timetablePeriod`/`timetableDate` は温存）。削除は `delete this.PLANS[edPid]`（3710, 3728）。

#### `Seg`（計画ミニタスク、`state.segs`）

| field | type | 備考 |
|---|---|---|
| `id` | string | 計画作成時は `uid + '-' + i`（i は 0 始まり、3564）、単発追加は `'u'+base36+rand999`（2397, 3062）、`reviewToTest` は `'s'+…`（3274） |
| `plan` | string | planId |
| `title` | string | |
| `size` | `'XS'\|'S'\|'M'\|'L'` | |
| `min` | number | `SIZE_MIN[size]` |
| `day` | `iso \| ''` | `''` = 未配分（`dayLabel('')` → `'未配分'`） |
| `done` | boolean | |
| `manualDay?` | `true` | **true にしかならない**。設定箇所はタイムライン D&D（2805）と編集ドロワーの日付 input（3794）のみ。**false に戻す UI 経路は存在しない** |
| `subs?` | `string[]` | ToDo 詳細から細分化を追加したとき（`addTodoSub` 2959-2976） |
| `subsDone?` | `boolean[]` | |
| `subSizes?` | `(''\|'XS'\|'S'\|'M'\|'L')[]` | 既存分を `''` で埋めて長さを揃える（2968-2971） |

`this.SIZE_MIN = { XS:5, S:10, M:20, L:30 }`（HTML:1997）。
`onCycleSize`（3789）は `{XS:'S', S:'M', M:'L', L:'XS'}` で巡回し `min` を追従。

#### `Extra`（単発タスク、`state.extras`）

```js
{ id, title, subj, size, min, day, done,
  src: '単発タスク' + (memo ? ' · ' + memo : ''),
  timetablePeriod, timetableDate,
  subs?, subsDone?, subSizes? }
```
生成は `submitAdd` の `addType==='single'` 分岐（3545-3546）のみ。

### 4.5 ID 生成規則（すべてローカル生成・衝突検査なし）

| 対象 | 生成式 | 場所 |
|---|---|---|
| 単発タスク / 復習 / 計画（Add） | `'u' + Date.now().toString(36) + Math.floor(Math.random()*999)` | 3538 |
| ミニタスク（エディタ / ToDo） | 同上 | 2397, 3062 |
| 次回の復習 | 同上 | 3100 |
| 計画作成時の seg 群 | `uid + '-' + i` | 3564 |
| `reviewToTest` の plan | `'p' + Date.now().toString(36) + Math.floor(Math.random()*999)` | 3273 |
| `reviewToTest` の seg | `'s' + …*999` | 3274 |
| スコア | `'sc' + Date.now().toString(36) + Math.floor(Math.random()*99)` | 3365 |
| カウントダウン | `'cd' + …*99` | 3918 |

`Math.floor(Math.random()*999)` はゼロ埋めしないので長さは可変（`u1t2h3k47` / `u1t2h3k4917`）。
**review の `id` は Firestore の doc id になる**ため、`invalidDocIdReason`（`SHELL:113-123`）を通る形式である必要がある。

### 4.6 `studyLog` — `{ day: iso, subj: string, min: number }`

**id を持たない。削除・編集 UI も上限も重複排除もない（無限に伸びる）。** 書き込みは**2箇所のみ**:

1. **復習完了**（`confirmAsk`, HTML:3116）: `{ day: T, subj: askR.subj, min: askR.min }`
   - `day` は**今日**（復習の `due` ではない）
   - `min` は**完了した回の元の `min`**。モーダルで選び直したサイズ（`nmin`）ではない
2. **完了済み計画の「完了として非表示」**（`deletePlan`, HTML:3713-3717）: 完了 seg ごとに `{ day: seg.day || T, subj: current.subj, min: seg.min }`
   - **未完了を含む計画を通常削除した場合は移送されない**（その完了分は円グラフから消える）

### 4.7 `scores` — `{ id, name, subj, day, score }`

```js
// addScore HTML:3359-3367
const n = (S.scoreName||'').trim(), sj = (S.scoreSubj||'').trim();
const v = parseInt(S.scoreVal, 10);
if (!n || !sj || isNaN(v)) { this.showToast('テスト名・教科・点数を入力してください'); return; }
const scv = Math.max(0, Math.min(100, v));      // 0–100 クランプ
this.subjOf(sj);
this.setState(s => ({ scores: s.scores.concat([{ id:'sc'+…, name:n, subj:sj, day: s.scoreDay || T, score: scv }]),
                      scoreName:'', scoreVal:'' }));   // 教科・日付は残す
this.showToast('「' + n + '」' + scv + '点を記録しました');
```
削除: `scores.filter(x => x.id !== sc.id)`（3353）。Enter キーのハンドラは**無い**（ボタンのみ）。

### 4.8 `countdowns` — `{ id, title, date }`

検証（3917）: `title` 非空 かつ `date` が `/^\d{4}-\d{2}-\d{2}$/`。削除は `countdowns.filter(x => x.id !== c.id)`（3911）。**計画（PLANS）とは完全に独立**。

### 4.9 `dayOverrides` — 時間割の日別上書き

形状: `{ [iso]: { [period: '1'..'7']: { subj?: string, held?: boolean } } }`（JSON では period キーは文字列）。

書き込みは `setSlotOverride(period, patch)`（`const setSlotOverride =` で再検索）のみ:
```js
// (v0.9 変更) 書き込みキーを timetableFocusDate から addScheduleDate（＝いま表示している日）へ変更
const all = Object.assign({}, s.dayOverrides || {});
const day = Object.assign({}, all[addScheduleDate] || {});
day[period] = Object.assign({}, day[period] || {}, patch);
all[addScheduleDate] = day;
```
実際に渡される patch は `onSubjChange` の `{ subj: next, held: next.trim() ? true : held }` のみ。

読み出し: `addDayOverrides = (S.dayOverrides && S.dayOverrides[addScheduleDate]) || {}`。

> **(v0.9 修正)** 旧実装は書き込みが `timetableFocusDate`、読み出しが `addScheduleDate` でキーがずれており、`timetableFocusDate` が土日のとき（`addScheduleDate` はその週の月曜になる）**週末に編集した上書きが読み戻せなかった**。読み書きとも `addScheduleDate` に統一済み。§11-Q3 は解消済。
> **保存構造は変更していない**ため、旧実装が土日キーで書いた既存の `dayOverrides[土]` / `[日]` エントリはそのまま残るが、どこからも読まれない死にデータになる（マイグレーションは行わない）。

基本時間割 `this.TIMETABLE`（HTML:2004-2010）は**コードにハードコードされ、保存されない**:
```js
'月': ['言語','英コ','体育','数学','歴総','論表',null],
'火': ['化基','英コ','芸術','芸術','生基','地総','数学'],
'水': ['数学','数学','体育','言語','英コ','現国',null],
'木': ['生基','歴総','化基','論表','数学','言語','保健'],
'金': ['現国','体育','地総','英コ','数学','LHR',null]
```

### 4.10 `planQuota` — `{ [planId]: number }`

`todoPlanSegs` 内の 0 始まりインデックス。書き込みは `onQuotaOver`（3053）と `onQuotaDrop`（3054）の `Object.assign({}, st.planQuota||{}, { [selectedPid]: i })`。
読み出し（3025-3026）: `Number.isInteger(...)` のときのみ採用し `Math.max(0, Math.min(len-1, saved))` でクランプ。未設定なら `autoQuotaIdx`。**負荷計算・再配分・完了判定には一切使われない（表示専用）。**

### 4.11 `order`

`string[]`。seg / extra / review の id が混在。`addToOrder(id)`（2546-2548）が重複を弾く（**updater が `null` を返す→無変更**）。削除・移動時に大量の `order.filter(...)` が走る（2797, 2806, 3117, 3185, 3289, 3719, 3731, 3795, 3801, 4181, 4185, 2951-2955）。
**日付をまたいでも一切クリアされない**。`itemOf` が `null` を返すことでフィルタされるだけ。

### 4.12 日付・時刻フォーマット

すべて `'YYYY-MM-DD'` 文字列。**時刻・タイムスタンプはデータに一切保存しない**（`completedAt` も日付文字列）。

```js
// HTML:1958-1970
const todayStr = new Intl.DateTimeFormat('en-CA',
  { timeZone:'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
this._base = new Date(todayStr + 'T00:00:00Z');
this.isoAt = (n) => new Date(this._base.getTime() + n*86400000).toISOString().slice(0,10);
this.fmtMD = (iso) => parseInt(iso.slice(5,7),10) + '/' + parseInt(iso.slice(8,10),10);   // "8/5"
this.dowOf = (iso) => ['日','月','火','水','木','金','土'][new Date(iso+'T00:00:00Z').getUTCDay()];
this.DAYS  = 13日分の { iso, dow, label, weekend, idx }
this.DIDX  = iso → index（0..12）
this.TODAY = this.DAYS[0].iso;  this.YESTERDAY = this.isoAt(-1);
// HTML:2021-2022
this.isoShift = (iso, n) => new Date(new Date(iso+'T00:00:00Z').getTime() + n*86400000).toISOString().slice(0,10);
this.daysUntil = (iso) => Math.round((new Date(iso+'T00:00:00Z').getTime() - this._base.getTime()) / 86400000);
```

`dayLabel(iso)`（2448-2455、Cockpit / Tests / Add / トースト用）:
`''`→`'未配分'` / `T`→`'今日'` / `DIDX===1`→`'明日'` / `DIDX` に無い→`fmtMD + (iso<T ? '(期限切れ)' : '')` / それ以外→`fmtMD + '(' + dow + ')'`

`fmtD(iso)`（3191-3197、**Review 表・復習詳細ドロワー専用の別関数**）:
`!iso`→`'–'` / `T`→`'今日'` / `TOMORROW`→`'明日'` / `YESTERDAY`→`'昨日'` / else `fmtMD`

`toH(m)`（2854）= `(Math.round(m/6)/10) + 'h'` → 20分→`0.3h`、25分→`0.4h`、100分→`1.7h`、0→`0h`

**日付の前後比較はすべて文字列の辞書順比較**（`seg.day < plan.due` 等）。

### 4.13 localStorage（キーは2つだけ。sessionStorage / indexedDB は未使用）

#### `'compass-ui'`（`savePrefs()`, HTML:2404-2406）
```js
localStorage.setItem('compass-ui', JSON.stringify({
  theme: this.state.theme, themeVersion: 3, panelW: this.state.panelW
}));
```
呼び出し元: テーマ切替（3962-3964）、キー 1–6 / `n` での画面切替（2092, 2095）、パネルリサイズの mouseup（2433）。

復元（2054-2070）:
```js
if (saved.theme === 'light' || saved.theme === 'dark' || saved.theme === 'note') {
  initial.theme = saved.theme === 'dark' && saved.themeVersion !== 3 ? 'note' : saved.theme;
  initial.themeVersion = 3;
}
if (saved.panelW) { /* typeof v === 'number' && v >= 120 && v <= (k==='editor' ? 520 : 2000) のときだけ採用 */ }
```

#### `'compass-ui-data'`
書き込みは3箇所、いずれも `JSON.stringify(exportData())` **そのもの**（`{data:...}` でラップしない）:
`scheduleSave` L2297（デバウンス**前**に即時）/ `saveNow` L2312 / `forceSaveNow` L2357。
読み込みは `componentDidMount`（2071-2074）内で**クラウド取得より先**、`dataPatch()` 経由。
すべて `try{}catch(e){}` で握りつぶす。

### 4.14 保存フロー

#### GET — `loadCloudState()`（HTML:2248-2275）
**起動時に1回だけ**。再取得・ポーリング・フォーカス時再読込は**ない**。

```js
const res = await fetch('/api/app-state', { cache: 'no-store' });
```
| 条件 | 動作 |
|---|---|
| 401 / 403 | `cloudStatus:'login'` → `notifyReady()` |
| 503 | `cloudStatus:'local'` → `notifyReady()` |
| その他 `!res.ok` | `throw new Error('load failed')` → catch → `cloudStatus:'local'` |
| ok | 下記 |

```js
const json = await res.json();
const saved = json.data && json.data.data ? json.data.data : json.data;
const user  = json.email || (json.data && json.data.email) || this.state.cloudUser;
```
- `saved` truthy: `_saveReady=false` → `dataPatch(saved)` + `cloudStatus:'saved'` + `cloudUser:user||''` → コールバックで `_lastSaveJson = JSON.stringify(exportData())`, `_saveReady=true`, `resetUndoBaseline()`, **`_dataRepaired` なら `saveNow()`**, `notifyReady()`
- `saved` falsy（新規ユーザー）: `{cloudStatus:'saved', cloudUser:user||''}` → コールバックで **即 `saveNow()`**（初期状態を PUT）→ `notifyReady()`

#### PUT — `saveNow(payload, queuedJson)`（HTML:2309-2346）
```js
const res = await fetch('/api/app-state', {
  method:'PUT', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ data: data })
});
```
- `res.ok` → `_lastSaveJson = dataJson`、キュー消去、`cloudStatus:'saved'`
- `!res.ok` → レスポンス JSON の `error` を `_lastCloudError` へ、キュー消去、`cloudStatus:'local'`
- 例外 → `_lastCloudError = e.message || 'network_error'`、`cloudStatus:'local'`

#### デバウンス — `scheduleSave()`（HTML:2287-2307）
`componentDidUpdate`（2375）から**毎レンダー**呼ばれる。

```js
if (!this._saveReady) return;                            // クラウド読込中は無効
const payload = this.exportData();
const json = JSON.stringify(payload);
if (json === this._lastSaveJson) return;                 // 変化なし（UI 一時状態のみの変更はここで止まる）
const now = Date.now();
if (json === this._saveQueuedJson) return;               // 同一内容がキュー済み → タイマーを延長しない
if (json === this._lastAttemptJson && now - (this._lastAttemptAt || 0) < 1200) return;  // 1.2秒 再試行スロットル
this._saveQueuedJson = json; this._saveQueuedPayload = payload;
try { localStorage.setItem('compass-ui-data', json); } catch (e) {}    // localStorage は同期・即時
clearTimeout(this._saveTimer);
if (this.state.cloudStatus !== 'saving') this.setState({ cloudStatus:'saving' });
this._saveTimer = setTimeout(() => { …; this.saveNow(queuedPayload, queued); }, 280);
```
→ **トレーリング 280ms デバウンス**。
**`beforeunload` / `visibilitychange` / `pagehide` / `sendBeacon` によるフラッシュは存在しない**（280ms 以内に閉じるとクラウド保存は落ちる。localStorage には残る）。

#### 即時保存 — `forceSaveNow()`（HTML:2348-2361）
`Cmd/Ctrl+S`。`_saveReady` が false → トースト「**保存準備中です**」で終了。それ以外は `clearTimeout(_saveTimer)` → キュー破棄 → localStorage 書き込み → `cloudStatus:'saving'` → `await saveNow(...)` → 「**Firebaseに保存しました**」/「**Firebase保存に失敗: ** + (`_lastCloudError` \|\| `'未接続'`)」。

#### 保存判定の注意
保存トリガは `JSON.stringify` の**文字列一致**。`persistentKeys()` の**配列順で `st[k]` を代入している**点まで再現しないと、オブジェクトのキー順が変わって無駄な PUT が飛ぶ。

### 4.15 読み込み時の補完・マイグレーション — `dataPatch(raw)`（HTML:2156-2240）

```js
const payload = raw && raw.data ? raw.data : raw;      // {data:{...}} ラッパーも素の {version,plans,state} も受ける
if (!payload || typeof payload !== 'object') return {};
if (payload.plans && typeof payload.plans === 'object' && !Array.isArray(payload.plans)) {
  this.PLANS = Object.assign({}, payload.plans);       // ★ plans が無ければ既存の PLANS が残る
}
const src = payload.state && typeof payload.state === 'object' ? payload.state : {};
const patch = {};
this.persistentKeys().forEach(k => { if (src[k] !== undefined) patch[k] = src[k]; });
```
→ **知らないキーは無視され、次の PUT で消える**（前方互換なし）。型検査は一切ない。

**M1. テーマ移行**（2167-2168）
```js
if (patch.theme === 'dark' && patch.themeVersion !== 3) patch.theme = 'note';
patch.themeVersion = 3;
```

**M2. GOAL 当日以降の seg を前日へ**（2169-2176）
```js
patch.segs = patch.segs.map(seg => {
  const plan = this.PLANS[seg.plan];
  if (!plan || !seg.day || !/^\d{4}-\d{2}-\d{2}$/.test(plan.due || '') || seg.day < plan.due) return seg;
  return Object.assign({}, seg, { day: this.isoShift(plan.due, -1) });
});
```
`day:''`（未配分）と孤児 seg は触らない。**`_dataRepaired` は立てない**ので即時保存は起きない。

**M3. 復習の `reviewNo` / `seriesId` 補完**（2177-2211）
1. 各 review に一時 `_legacyIndex: index` を付与（`Object.assign({}, review, ...)` で複製）
2. `seriesCounts[seriesId]` を数え、`seriesId` があって2件以上なら `'series:'+seriesId`、そうでなければ `'legacy:' + [subj, title, timetableDate, timetablePeriod].join('|')` をグループキーに
3. グループ内ソート: `(last || due)` 昇順 → `due` 昇順 → **完了が先**（`a.done ? -1 : 1`）→ `_legacyIndex` 昇順
4. `firstSavedNo = Math.floor(Number(group[0].reviewNo))`、`startNo = firstSavedNo >= 1 ? firstSavedNo : (legacyReviewNo[group[0].stage] || 1)`
5. `rootId = isLinkedSeries ? group[0].seriesId : group[0].id`
6. 各要素に `reviewNo = (isLinkedSeries && savedNo >= 1) ? savedNo : startNo + index`、`seriesId = rootId`
7. `_legacyIndex` 昇順に戻して `delete review._legacyIndex`（**永続化されない**。元の配列順は保持）

**M4. 未完了より先の回を削除**（2212-2229）
系列（`seriesId || id`）ごとに `reviewNo` 昇順に並べ、最初の未完了 `pending` より大きい `reviewNo` を無効として `reviews` / `order` から削除、`selId` が該当なら null。`this._dataRepaired = true`。

**M5. 期限切れ完了済み復習を今日の ToDo から外す**（2230-2237）
`r.done && r.added && r.due < this.TODAY` を `added:false` にし、`order` から除去、`selId` が該当なら null。`this._dataRepaired = true`。

`_dataRepaired` が立つと `loadCloudState` のコールバック（2266）で**即 `saveNow()`**。フラグはその場で false に戻す。

**未実装の防御**: `segs[].plan` が `PLANS` に無い孤児 seg の掃除がない。`renderVals` の `P[s.plan].subj`（2680, 3300）等で `TypeError` になりうる。

### 4.16 Undo（1段階のみ）

`undoKeys()`（HTML:2121-2123）— 14キー:
```js
['navOrder','planOrder','wkMax','weMax','studyLog','scores','countdowns',
 'dayOverrides','timetableFocusDate','planQuota','segs','extras','reviews','order']
```
`undoPayload()`（2125-2129）→ `{ plans: this.PLANS, state: {<undoKeys>} }`（**PLANS 全体が対象**）。

`componentDidUpdate`（2368-2374）:
```js
const undoJson = JSON.stringify(this.undoPayload());
if (this._lastUndoJson == null) this._lastUndoJson = undoJson;
else if (undoJson !== this._lastUndoJson) {
  if (!this._undoApplying) this._undoSnapshot = JSON.parse(this._lastUndoJson);
  this._lastUndoJson = undoJson;
}
```
`undoLastAction()`（2136-2154）: スナップショットが無ければトースト「**戻せる操作はありません**」。適用時は `this.PLANS = Object.assign({}, snapshot.plans || {})` に加え、選択・ドラッグ・モーダル系20キーを強制的に null/false へリセット（2142-2147）。成功トースト「**1つ前の操作に戻しました**」。
`resetUndoBaseline()`（2131-2134）は起動時とクラウド読込直後に呼ばれる。Undo の結果も `scheduleSave` を通って保存される。

### 4.17 `mut*` ヘルパ（HTML:2444-2446）

`mutSeg` / `mutExtra` / `mutReview` は `{...x}` の**浅いコピー**。`subs`/`subsDone`/`subSizes` の配列参照は共有されるが、書き換え側は必ず `.slice()`/`.concat()` で新配列を作っている。

---

## 5. タスクと今日のToDo

### 5.1 タスク3種と「今日」の判定

#### `itemOf(id)`（HTML:2819-2827）
```js
seg   … segs.find(id) かつ s.day === TODAY
        → { kind:'seg', id, title, subj: P[plan].subj, min, size, done,
            src: P[plan].name, due: P[plan].due, subs, subsDone, subSizes,
            timetablePeriod: plan側, timetableDate: plan側, ref }
extra … extras.find(id) かつ (!ex.day || ex.day === TODAY)
        → { kind:'extra', …, src: ex.src }
rev   … reviews.find(id) かつ r.added && !(r.done && r.due < TODAY)
        → { kind:'rev', …, min: rv.min, size:'S'(固定), src: r.stage + 'の復習' }
それ以外 null
```

#### `todayIds` の構築（`const todayIds = S.order.slice();` で再検索）
```js
todayIds = state.order.slice()
        + segs で day===TODAY かつ order 未収録のもの
        + extras で day===TODAY かつ order 未収録のもの     // ★ (v0.9 追加)
        + reviews で added && !(done && due<TODAY) かつ order 未収録のもの
seqItems   = todayIds.map(itemOf).filter(Boolean)
planItems  = kind==='seg'
otherItems = kind!=='seg'
todayItems = planItems.concat(otherItems)      // 計画タスクが常に上
```

> **(v0.9 修正)** 旧実装は `segs` と `reviews` しか自動収集せず、`extras` は `order` 経由でしか today に入らなかった。`submitAdd` は `addDay===TODAY` のときしか `addToOrder` しないため、**未来日で作った単発タスクはその日が来ても「今日のタスク」に一切現れなかった**。`segs` と同じ要領で `day === TODAY` の extra も拾うようにした。§11-Q4 は解消済。
> - 重複は `todayIds.indexOf(x.id) < 0` で除外するので、**`order` にある extra は従来どおり `order` の位置に出る**（手動の並び順は不変）。自動収集ぶんは `order` より後ろに積まれる。
> - `itemOf` の判定（`!ex.day || ex.day === TODAY`）は変更していないので、**日付なしの extra は従来どおり `order` 経由でしか出ない**。明日以降の日付の extra は引き続き出ない。

### 5.2 進捗計算

```js
progMin(it)                                   // HTML:2839-2851
  it.done                                     → it.min（満額）
  subs が無い                                  → 0
  subSizes が全件で SIZE_MIN 解決可             → it.min * (完了サブの重み和 / 全重み和)
  それ以外                                     → it.min * (完了サブ件数 / 全サブ件数)
totalMin  = todayItems 全部の min 合計（完了済みも含む）   // 2836
doneMin   = Σ progMin                                    // 2852
remainMin = totalMin - doneMin                           // 2853
donutPct  = totalMin ? round(doneMin/totalMin*100) : 0    // 4057
donutDash = totalMin ? round(doneMin/totalMin*327) : 0    // 4058
donutDashSmall = totalMin ? round(doneMin/totalMin*119) : 0   // 4059 ← テンプレート未使用
```

### 5.3 コックピット「今日のタスク」パネル（HTML:971-990）

- パネル: `.cockpit-panel.cockpit-panel--today`、`onDragOver={{ckDragOver}}` `onDrop={{ckDrop}}`、`border:1px solid {{ckDropBd}}`
- 見出し（972-974）: `<span class="panel-dot" style="--dot:var(--acc)">` + 「**今日のタスク**」 + `{{todayCountLabel}}`
  - `todayCountLabel` = `todayItems.length + '件 · ' + toH(totalMin)`（4045）
- 負荷バー + 「**負荷 {{todayLoadH}} / 平日Max {{wkMaxH}}**」
  - `todayLoadPct` = `Math.min(100, Math.round((totalMin - doneMin === 0 ? totalMin : totalMin) / S.wkMax * 100)) + '%'`（4046）
    → **三項演算は両枝とも `totalMin` の実質デッドコード**。結果は常に `totalMin / wkMax`。§11-Q5
  - `todayLoadH = toH(totalMin)`、`wkMaxH = (S.wkMax/60) + 'h'`（4032）
  - **ラベルは常に「平日Max」固定で、休日 (`weMax`) に切り替わらない。** §11-Q6
- カード `.cockpit-task`（977, 常に `draggable="true"`, `cursor:grab`）:
  - `border-left:3px solid {{it.c}}`、`background:{{it.tintBg}}`、`opacity:{{it.op}}`
  - 左のチェックボックス `div`（17×17, border 1.5px, radius 6px）に `onClick="{{it.onToggle}}"`。**カード全体には onClick が無い** → チェックボックスだけがトグル
  - タイトル `text-decoration:{{it.deco}}`、`white-space:nowrap;overflow:hidden;text-overflow:ellipsis`
  - メタ `{{it.meta}}` = `` `${min}分 · ${src}` ``、時間割由来なら `{{it.ttLabel}}` = 「**時間割 {N}限**」（org バッジ）
  - 右: 教科ピル `{{it.subj}}`、サイズ `{{it.size}}`（radius 5px, Space Grotesk）
- 末尾ボタン（989）: 「**ToDo画面で実行する →**」→ `goTodo`

### 5.4 ドラッグ&ドロップ（すべて素の HTML5 DnD、ライブラリ不使用）

#### 「今日のタスク」へのドロップ
- `ckDragOver`（4127）: `state.dragRev || state.dragCkPlan` のときだけ `preventDefault()`
- ドラッグ元1 — **復習カード**（996）: `draggable="{{r.drag}}"`（`(!r.added && !r.done) ? 'true' : 'false'`, 3152）。`onDragStart` → `dragRev = r.id`, `setData('text/plain', r.id)`, `effectAllowed='copy'`
- ドラッグ元2 — **計画カード**（1019）: `draggable="{{p.canDrag}}"`（未完了 seg があれば `'true'`, 2766）。`onCkPlanDragStart`（2767）: 未完了が無ければ `e.preventDefault()`、あれば `dragCkPlan = pid`, `'plan:'+pid`, `effectAllowed='copy'`
- `ckDrop`（3156-3176）:
  - `dragRev` → `mutReview(added=true)` + `addToOrder` + `dragRev:null` + トースト「**「{subj} {title}」を今日のToDoに追加しました**」
  - `dragCkPlan` → `segs.find(x => x.plan===planId && !x.done)`（**配列順で最初の未完了**）を `day = TODAY` にして `addToOrder`、`{dragCkPlan:null, selId:seg.id}`、トースト「**「{title}」を今日のToDoに追加しました**」
- 可視化: `ckDropBd`（4125）= `(dragRev||dragCkPlan) ? 'var(--grn)' : 'var(--line)'`、`ckDropHint`（4126）で破線ボックス「**ここにドロップで今日のToDoに追加**」（988、`--grn`/`--grnBg`）

#### 「今日のタスク」から外す
- ドラッグ元: `.cockpit-task` → `onCkDragStart`（2879）: `dragCkItem = {id, kind}`, `'today:'+id`, `effectAllowed='move'`
- ドロップ先: **復習パネル**（992）と**試験・予習計画パネル**（1015）の両方に `onDragOver={{ckReturnDragOver}}` `onDrop={{ckReturnDrop}}`。枠色 `ckReturnBd`（4129）= `dragCkItem ? 'var(--acc)' : 'var(--line)'`
- `ckReturnDrop`（3178-3187）: `kind==='rev'` → `added=false` / `'seg'` → `day=''` / `'extra'` → `day=''`。加えて `order` から除去、`dragCkItem:null`、`selId` が一致していれば null。トースト「**今日のToDoから戻しました**」

> **コックピットの今日のタスク同士は並べ替えできない**（並べ替えハンドラは未接続）。

### 5.5 「今日のToDo」画面（`view === 'todo'`, HTML:1124-1233）

2カラム grid `minmax(360px,2fr) minmax(480px,3fr)`。**実行専用リストは無く「計画カード → ミニタスク一覧」型**。タイマーは集中モードのみ。

#### 左カラム
- ヘッダ: ●(`var(--acc)`) 「**今日のToDo**」/ 右に「**計画名でまとめて表示**」
- 区切り1（1128）: 「**テスト・予習計画 · {{todoPlanCount}}件**」
- `todoPlanCards`（2984-3010）: `todoPlanIds = planIds.filter(pid => segs.some(s => s.plan===pid && s.day===T))`（2979）
  - `.todo-plan-card`: 左端 4px の教科色帯、種別チップ `{{p.typeLabel}}`（`テスト`/`予習`、border は test=solid / prep=dashed）、計画名、`{{p.badge}}`、`›`
  - `badge` = `todayRemain ? 'あと{n}個' : '今日分OK'`
  - `meta` = `` `${subj} / ${dayLabel(due)}まで / 今日 ${todayDone}/${todaySegs.length} / 全体 ${doneN}/${segs.length}` ``
  - `progPct` = `round(doneN/segs.length*100)%`
  - 選択中は `rowBg = color-mix(教科色 14%, var(--bg3))`、枠が教科色、`glow` あり。非選択は `color-mix(教科色 7%, var(--bg2))`
  - `onSelect`（3005）: `selId = (todaySegs[0] || segs[0]).id`
- 区切り2（1139）: 「**復習・単発タスク · {{todoOtherCount}}件**」
- `todoOtherItems`（3011-3020）: `.todo-other-card` — **カード全体に `onClick="{{it.onSelect}}"`、内側のチェックボックスに `onClick="{{it.onToggle}}"`。stopPropagation が無いのでチェックボックスを押すと「トグル＋選択」が同時に起きる。** §11-Q7

#### 右カラム上部 `.todo-summary`（1151-1161）
- ドーナツ 110×110（§3.10）、中央に `{{donutPct}}%` + 「**完了**」
- 「**今日のノルマ**」`{{normaText}}` = `` `${todayItems.length}件 · ${toH(totalMin)} をやり切る` ``（4071）
- 「完了 **{{doneCount}}** / {{totalCount}}件」/「残り **{{remainH}}**」
- `.focus-launch`「**▶ 集中モード**」（`openFocus`, 4060）

#### 右カラム下部 — 2種類の詳細パネル（排他）
```js
sel = todayItems.find(i => i.id === S.selId) || todayItems[0] || null   // 2928
todoShowTaskDetail = !!sel && (sel.kind === 'rev' || sel.kind === 'extra')   // 2929
todoShowPlanDetail = !todoShowTaskDetail                                    // 2930
```

**(A) 計画詳細**（`todoShowPlanDetail`, 1162-1185）— §7.7
**(B) タスク詳細**（`todoShowTaskDetail`, 1186-1230、rev/extra のみ）
- ヘッダ: `{{selTypeLabel}}`（`復習`/`単発タスク`/`計画`, 4090）、`{{selSubj}}`、右に「**選択中のタスク**」
- `{{selTitle}}` / `{{selMeta}}` = `` `見積 ${min}分 · サイズ ${size}` `` + seg なら ` · 期限 {dayLabel(due)}`（4089）
- 「**タスク**」/「**この1件だけを表示しています**」
- 単一行（1195）: **行全体が `onClick="{{selOnToggle}}"`**（= `toggleItem(sel)`）
- 「**削除**」ボタン（`selCanDelete = !!sel`, 4099、1200-1202）→ `deleteSelected`
- 「**細分化タスク**」: `selSubs`（2931-2944）。各行クリックで `subsDone[i]` トグル（seg なら `mutSeg`、それ以外 `mutExtra`, 2941）。`sizeLabel` は `subSizes[i]` があるとき `{Z}·{n}分`
  - `quotaAfter`（2937）= `sel.kind==='seg' && i===最後` → 破線区切り「**☷ 今日のノルマここまで**」（1211-1213）。**このパネルは rev/extra のときしか出ないので事実上デッド**
  - 空なら「**細分化はまだありません**」（`selNoSubs`）
- 追加 UI（`selCanAddSub = sel.kind==='seg'||'extra'`, 2946）: `todoSizeChips`（`todoNewSize` 既定 `'S'`）+ input placeholder「**ミニタスクを追加… (Enter)**」+「**＋ 追加**」→ `addTodoSub`（2959-2976）
  - `subs.concat([t])`, `subsDone.concat([false])`, `subSizes` は既存不足分を `''` で埋めてから `z` を push。`todoNewSub` をクリア。**トーストは出ない**
  - 復習では `selCanAddSub` が false になり入力欄自体が出ない

### 5.6 集中モード（唯一のタイマー）

HTML:1815-1825。state: `focusOpen:false, focusRunning:false, focusRemaining:1500, focusPreset:25`（2038）。**いずれも `persistentKeys()` に無く保存されない。**

- 起動: ToDo の「▶ 集中モード」/ キー `f`（`{view:'todo', focusOpen:true}`）
- 対象 `focusItem`（3874）= `todayItems.find(it => it.id===S.selId && !it.done)` → 無ければ `todayItems.find(!done)` → 無ければ null
  - `{{focusTaskTitle}}`（無い場合「**今日のタスクはありません**」）、`{{focusTaskMeta}}` = `` `${subj} · ${min}分 · ${src}` ``（無い場合「**先にToDoへタスクを追加してください**」）
- 表示: 「**FOCUS MODE**」（LS .08em）+ ✕、210×210 の円、中央に `{{focusTime}}` = `MM:SS`（`padStart(2,'0')`, 3875）
- プリセット `focusPresets`（3899-3901）= **15分 / 25分 / 45分**。`setFocusPreset(min)`（3890）: タイマー停止 + `{focusPreset:min, focusRemaining:min*60, focusRunning:false}`
- `toggleFocus`（3878-3889）: 動作中なら停止。停止中なら `setInterval(…, 1000)` で `focusRemaining` を1ずつ減算。`<=1` で 0 にして停止し、トースト「**集中時間が終了しました。おつかれさま！**」
- `{{focusToggleLabel}}`（4067）= 実行中「**一時停止**」/ 残0「**もう一度**」/ else「**▶ 集中開始**」。
  実ハンドラ（4069）は `if (S.focusRemaining===0) { setFocusPreset(S.focusPreset||25); return; } toggleFocus();`
- 「**✓ タスク完了**」（`focusHasTask` のときだけ表示、`completeFocusTask` 3891-3898）:
  - seg → `mutSeg done=true` / extra → `mutExtra done=true` → `closeFocus()` + トースト「**「{title}」を完了しました**」
  - **rev の場合は `closeFocus()` してから `openAsk(id)`**（トーストは出ない）
- 閉じる: ✕（`closeFocus` 3877 = タイマー停止 + `{focusOpen:false, focusRunning:false}`）/ Escape。**背景クリックでは閉じない**

### 5.7 完了（done）の全経路

```js
toggleItem(it)                                   // HTML:2858-2863
  kind==='seg'   → mutSeg(id, x => x.done = !x.done)
  kind==='extra' → mutExtra(id, x => x.done = !x.done)
  kind==='rev' && !done → openAsk(id)            // 理解度モーダルへ（この時点では done にしない）
  kind==='rev' &&  done → mutReview(id, x => x.done = false)   // モーダルなしで未完了へ戻る
openAsk(id)                                      // 2857
  = { revAsk:id, revAskGrade:null, revAskSize:null, revSel:null }
```

| UI | 行 | 経路 |
|---|---|---|
| Cockpit 今日カードのチェックボックス | 978 | `decorate.onToggle` = `toggleItem` |
| ToDo 復習・単発カードのチェックボックス | 1143 | 同上（カードの `onSelect` も同時発火） |
| ToDo タスク詳細の行全体 | 1195 | `selOnToggle` |
| ToDo 計画詳細のミニタスク行チェック | 1173 | `mutSeg` 直（3055） |
| ミニタスク編集ドロワーのチェック | 1571 | `mutSeg` 直（3776） |
| Tests タイムラインの seg チップ | 1109 | `enrichSeg.onToggle`（2685）。`this._suppressSegClick` が立っている間は無視 |
| 集中モード「✓ タスク完了」 | 1822 | `completeFocusTask` |
| Review 表「完了」/ 詳細「✓ 復習完了にする」 | 1511 / 1636 | `openAsk` |

**副作用**:
- **完了した seg / extra は「今日のタスク」から消えない**（`op:0.5` + `line-through` で残る）
- 完了 seg / extra は `loadsMap`（2477-2478）から除外される＝ Tests の日別負荷は減るが、**Cockpit の「負荷」は `totalMin` ベースなので減らない**
- Data の円グラフ（3300-3301）は `done` の seg/extra の `min` を教科別に加算
- 全 seg 完了 かつ `due < TODAY` の計画は `activePlanIds`（2673-2676）から外れ、Tests / Cockpit / ToDo から自動的に消える

### 5.8 削除の全経路

| 対象 | UI | 実装 | トースト |
|---|---|---|---|
| 今日の選択タスク（rev/extra のみ到達可） | ToDo タスク詳細「削除」1201 | `deleteSelected` 2947-2958 | 「**「{title}」を削除しました**」 |
| ミニタスク（seg）1件 | 編集ドロワー ✕ 1581 | 3801: `segs` filter + `order` filter | 「**「{title}」を削除しました**」 |
| Add 画面の未確定ミニタスク | ✕ 1413 | `addMiniRows[i].onRemove`（3480、index filter） | なし |
| 計画まるごと | 編集ドロワー最下部 1601 | `deletePlan` 3704-3736 | §7.6 |
| 復習1件 | 復習詳細「Reviewから完全に削除」1643 | 4185 | 「**復習アイテムを削除しました**」 |
| カウントダウン | ナビ ✕ 897 | 3911 | なし |
| テスト点数 | 推移ドロワー ✕ 1688 | 3353 | なし（確認ダイアログもなし） |

### 5.9 テンプレート未参照の renderVals（デッドコード）

`renderVals` は返すが `<x-dc>` テンプレート（HTML:786-1880）から一切参照されない値:
`todoItems`（4050、および要素側の `sec` / `subLabel` / `subDash` / `rowGlow` / `lift` / `hasSubs` / `doneLabel` / `todayProg` / `quotaLabel`）、`dragProps`（2883-2905）、`addPlanMini`（3058, 4104）、`donutDashSmall`（4059）、`searchW` / `searchResize`（3947）、`weekRateAvailable`、`todoPlanRange`（4078）、`redistUnplacedCount`、`todoPlanCards.todayProg`、`todoPlanRows.quotaLabel`、plan 側の `lineC`（2816）、`revDecorate.doneLabel`。

> 特に `todoItems` / `dragProps` は「今日の ToDo リストを D&D で並べ替える」旧 UI の残骸。**移植時に「並べ替えられる」と誤解しないこと。**

---

## 6. 復習（間隔反復）

### 6.1 `Review` の全フィールド

| field | type | 説明 / 生成値 |
|---|---|---|
| `id` | string | `'u' + Date.now().toString(36) + Math.floor(Math.random()*999)` |
| `seriesId` | string | 系列ルート ID。手動追加時は自分の `id`。次回生成時は `askR.seriesId \|\| askR.id` |
| `reviewNo` | number | 1始まり。手動追加 = `1`、次回生成 = `reviewNoOf(askR)+1` |
| `title` | string | |
| `subj` | string | |
| `stage` | string | `'翌日'` / `'3日後'` / `'1週間後'` / `'2週間後'` / `'定着 🎉'` |
| `last` | iso | 前回学習日。両生成経路とも `T`（今日） |
| `due` | iso | 次回復習日 |
| `min` | number | `SIZE_MIN` 由来 |
| `src` | string | 手動追加: `'手動追加'` / `'時間割から追加'`（+ メモがあれば `' · ' + memo`）。次回生成: `this.fmtMD(T) + 'に学習'`（例 `8/5に学習`） |
| `timetablePeriod` | `number\|null` | 継承される |
| `timetableDate` | `iso\|null` | 継承される |
| `added` | boolean | 今日の ToDo に積んであるか |
| `done` | boolean | |
| `completedAt` | iso（optional） | `confirmAsk` で完了時に `T` が付く。**表示には一切使われない** |

定数（`renderVals` 内、HTML:3071-3078）:
```js
const stageNext = { '翌日':'3日後', '3日後':'1週間後', '1週間後':'2週間後', '2週間後':'定着 🎉' };
const stageDays = { '翌日':1, '3日後':3, '1週間後':7, '2週間後':14 };
const legacyReviewNo = { '翌日':1, '3日後':2, '1週間後':3, '2週間後':4, '定着 🎉':5 };
const reviewNoOf = (review) => {
  const savedNo = Math.floor(Number(review && review.reviewNo));
  return savedNo >= 1 ? savedNo : (review && legacyReviewNo[review.stage]) || 1;
};
const sizeOfMin = (min) => (min <= 5 ? 'XS' : (min <= 10 ? 'S' : (min <= 20 ? 'M' : 'L')));
```

> **実装上の間隔は 翌日(1日) → 3日後(3日) → 1週間後(7日) → 2週間後(14日) → 定着 🎉（終了）。**
> **(v0.9 変更)** Cockpit の空状態コピー（HTML:1007）にあった「1日後・1週間後・1ヶ月後」という古い文言はこの実装に合わせて書き換え済み（§2.10）。§11-Q1 は解消済。

### 6.2 復習が生まれる経路は2つだけ

**通常タスク（seg / extra）を完了しても復習は自動生成されない。** コード全体に `segs`/`extras` の `done` 化をフックして `reviews` に push する処理は存在しない。

#### (A) Add 画面 `addType === 'review'`（HTML:3550-3552）
```js
reviews: s.reviews.concat([{
  id: uid, seriesId: uid, reviewNo: 1, title: t, subj: subj,
  stage: '翌日', last: T, due: S.addDay, min: this.SIZE_MIN[S.addSize],
  src: timetablePeriod ? '時間割から追加'+(memo?' · '+memo:'') : '手動追加'+(memo?' · '+memo:''),
  timetablePeriod, timetableDate, added: false, done: false
}])
```
- `due` はユーザーが選んだ `addDay`（input の `min={{addDayMin}}` = 今日）。**`stage` は日付に関わらず必ず `'翌日'`**
- 完了バナー/トースト: `'復習「' + subj + ' ' + t + '」を追加しました(次回 ' + this.dayLabel(S.addDay) + ')'`、遷移ボタン「**Reviewで見る**」

#### (B) 復習完了 `confirmAsk()`（HTML:3087-3123）— 間隔反復の本体

```js
if (!askR) return;
if (!S.revAskGrade) { this.showToast('理解度を選んでください'); return; }
const grade = S.revAskGrade;
const nmin = this.SIZE_MIN[askSizeCur];
const removeFromTodo = askR.due < T;
const ns = grade === 'high' ? stageNext[askR.stage] : (grade === 'mid' ? askR.stage : '翌日');
let nextReview = null;
// (v0.9 変更) 旧: if (grade === 'high' && !stageDays[ns])
// 次の間隔が無い(= ns が '定着 🎉' 等で stageDays に無い)なら high / mid いずれでもシリーズ終了。
// low だけは stage に関係なく必ず翌日から組み直す。
if (grade !== 'low' && !stageDays[ns]) {
  msg = '定着！「' + askR.title + '」の復習は完了です 🎉';
} else {
  const due = this.isoShift(T, stageDays[ns] || 1);     // ★ 起点は「今日」。askR.due でも askR.last でもない
  nextReview = { id: uid, seriesId: askR.seriesId || askR.id, reviewNo: reviewNoOf(askR) + 1,
                 title: askR.title, subj: askR.subj, stage: ns, last: T, due: due, min: nmin,
                 src: this.fmtMD(T) + 'に学習',
                 timetablePeriod: askR.timetablePeriod, timetableDate: askR.timetableDate,
                 added: false, done: false };
  msg = grade === 'low'
    ? '明日、追加の復習を入れました(' + this.dayLabel(due) + ' · ' + askSizeCur + ')'
    : '次は' + ns + 'に復習します(' + this.dayLabel(due) + ' · ' + askSizeCur + ')';
}
```

**規則の要点**
1. **オフセットの起点は常に `T`（今日）**。遅れて消化しても次回が過去に戻らず、遅延が累積しない。
2. `high` → `stageNext[stage]`、`mid` → **同じ stage を維持**、`low` → **`'翌日'` に巻き戻し**。
3. `'2週間後'` を `high` で完了 → `ns='定着 🎉'` → `stageDays` に無いので次回を作らず系列終了。
   **(v0.9 修正)** `'定着 🎉'`（レガシー移行分に存在しうる stage）を `mid` で完了した場合も
   `ns='定着 🎉'` で `stageDays` に無いため**同じく系列終了**する。旧実装は `grade==='high'` 分岐に
   入らず `stageDays[ns] || 1` が効いて **+1日で stage `'定着 🎉'` の復習が無限に再生成されていた**。§11-Q8 は解消済。
   `stageDays` に無い未知の stage 文字列（データ破損・将来の legacy）でも同様に、high / mid では系列終了になる。
4. `reviewNo` は必ず +1（stage が据え置き/巻き戻しでもカウントは進む）。`seriesId` は初回 ID を引き継ぐ。
5. `timetablePeriod` / `timetableDate` / `title` / `subj` を継承。`min` は**モーダルで選んだサイズ**（`nmin`）で上書き。

**dedup（先行回の掃除、HTML:3110-3113）**
```js
let reviews = s.reviews
  .filter(review => (review.seriesId || review.id) !== seriesId
                 || (Number(review.reviewNo) || 1) <= currentNo)
  .map(review => review.id === askR.id
     ? Object.assign({}, review, { done:true, completedAt:T, added: removeFromTodo ? false : review.added })
     : review);
if (nextReview) reviews = reviews.concat([nextReview]);
```
同一系列の `reviewNo > currentNo` を**全部削除してから**次の1回だけを末尾に追加。**同じ系列に未来回が複数並ぶことは絶対に起きない。**

**副作用（同じ `setState`、HTML:3114-3121）**
- `studyLog: s.studyLog.concat([{ day:T, subj:askR.subj, min:askR.min }])`
  → **記録される分数は `askR.min`（完了した回の分数）**。`nmin` ではない
- `order: removeFromTodo ? s.order.filter(id => id !== askR.id) : s.order`
- `selId: removeFromTodo && s.selId === askR.id ? null : s.selId`
- `revAsk: null` → 直後に `this.showToast(msg)`

### 6.3 理解度モーダル（`askOpen`, HTML:1778-1812 / 値 4106-4124）

- 開閉: `openAsk(id)`（2857）= `{revAsk:id, revAskGrade:null, revAskSize:null, revSel:null}`。**開くと同時に詳細ドロワーが閉じる**
- 呼び出し元: `toggleItem`（2861）/ Review 表の「完了」（`r.onDone`, 3256）/ Cockpit カードの `onDone`（3139）/ 詳細の「✓ 復習完了にする」（`rdOnDone`, 4182）/ 集中モードの `completeFocusTask`（3895）
- `askOpen: !!askR`、`askR = S.reviews.find(r => r.id === S.revAsk) || null`（3080）
- 閉じる: 背景クリック `closeAsk`（`revAsk:null`）/ キャンセル / `Escape`。内側は `stopProp`

見た目: z-index **55**、パネル `width:460px;max-width:92vw`、`animation:popIn .18s ease`。

- 見出し: 「**復習おつかれさま！理解度はどうでしたか？**」（700 15px 'Noto Sans JP', `var(--tx0)`）
- サブ行: 教科ピル `{{askSubj}}`（`askSubjC`/`askSubjBg`）、`{{askTitle}}`、`{{askStage}}の復習`
- グレード3枚（`askGrades` 3081-3085、grid 1fr×3、gap 8px、border-radius 12px、padding 12px 8px）:

| id | icon | label | desc | c | bg |
|---|---|---|---|---|---|
| `high` | `◎` | **ばっちり** | **次の間隔へ進む** | `var(--grn)` | `var(--grnBg)` |
| `mid` | `○` | **まあまあ** | **同じ間隔でもう一度** | `var(--acc)` | `var(--accBg)` |
| `low` | `△` | **不安…** | **明日 追加の復習** | `var(--pink)` | `var(--pinkBg)` |

選択時 `c:'var(--onAcc)'`, `bg: g.c`。未選択 `c: g.c`, `bg: g.bg`。`bd` は常に `g.c`。
- 「**次回復習の予想時間**」+ `askSizeChips`（4117-4123）: `XS·5分 / S·10分 / M·20分 / L·30分`。既定選択は `askSizeCur = S.revAskSize || (askR ? sizeOfMin(askR.min) : 'S')`（3086）。選択時 `c:var(--onAcc)/bg:var(--acc)/bd:var(--acc)`、未選択 `c:var(--tx2)/bg:var(--bg2)/bd:var(--line2)`
- フッター: 「**キャンセル**」/「**✓ 復習を完了する**」（`var(--grad)` 背景）
- グレード未選択で確定 → トースト「**理解度を選んでください**」、何も起きない

### 6.4 復習画面（`isReview`, HTML:1466-1520）

コンテナ: `flex:1;overflow:auto;padding:18px 20px;display:flex;flex-direction:column;gap:14px`。

#### 統計カード3枚（1469-1471）
1. 「**今日やる復習**」/ `{{revTodayCount}}件` — `revToday = S.reviews.filter(r => r.due === T && !r.done)`（3141）。色 `var(--pink)`、幅 130px
2. 「**遅れている復習**」/ `{{revLateCount}}件` — `revLate = S.reviews.filter(r => r.due < T && !r.done)`（3142）。色 `revLateC = revLate.length ? 'var(--pink)' : 'var(--tx0)'`（4156）、幅 130px
3. 「**今週の消化率 · {{weekRateMeta}}**」/ `{{weekRateLabel}}{{weekRateSuffix}}` — 色 `var(--grn)`、幅 150px

#### 一括ToDo追加ボタン **(v0.9 追加)**（統計カード3枚のすぐ右、`並び替え` ブロックの `margin-left:auto` の前）

```html
<sc-if value="{{ revBulkShow }}" hint-placeholder-val="{{ false }}">
  <button onClick="{{ revBulkAdd }}"
    style="display:flex;align-items:center;gap:7px;padding:9px 16px;border:none;border-radius:99px;
           background:var(--grn);color:var(--onAcc);font:700 11.5px 'Noto Sans JP';cursor:pointer;
           white-space:nowrap;flex:none;box-shadow:var(--gGrn)">今日の復習をまとめてToDoへ<span
    style="font:700 10.5px 'Space Grotesk';background:color-mix(in srgb,var(--onAcc) 22%,transparent);
           border-radius:99px;padding:1px 7px">{{ revBulkCount }}</span></button>
</sc-if>
```

ロジック（`const revBulkTargets =` で再検索）:
```js
const revBulkTargets = S.reviews.filter(r => !r.added && !r.done && r.due <= T);   // 行の canAdd と完全同条件
const revBulkAdd = () => {
  const ids = this.state.reviews.filter(r => !r.added && !r.done && r.due <= T).map(r => r.id);
  if (!ids.length) return;
  this.setState(s => ({
    reviews: s.reviews.map(x => ids.indexOf(x.id) >= 0 ? Object.assign({}, x, { added: true }) : x),
    order: s.order.concat(ids.filter(id => s.order.indexOf(id) < 0))     // addToOrder と同じ重複ガード
  }));
  this.showToast(ids.length + '件の復習を今日のToDoに追加しました');
};
// renderVals: revBulkShow: revBulkTargets.length > 0, revBulkCount: revBulkTargets.length, revBulkAdd
```

- 対象は **`!added && !done && due <= 今日`**（＝遅れている復習も含む）で、行の `r.canAdd` と完全に同じ述語
- **`revFilter`（教科の絞り込み）も `revSort` も見ない**。絞り込みで隠れている行も対象に入り、件数バッジも変わらない。したがって「期限順」「教科ごと」どちらの並び替えでもボタンは同じ条件で出る
- 対象0件のときは `sc-if` ごと出ない（押した直後は0件になるのでボタンが消える）
- `setState` は1回だけ・トーストも1回だけ。追加順は `S.reviews` の配列順で `order` 末尾に積まれる
- 新しい永続キーは増やさない（`revBulkShow` / `revBulkCount` / `revBulkAdd` はすべて render 導出値）

#### 消化率の計算（HTML:3143-3149, 4157-4160）
```js
const todayDow  = new Date(T + 'T00:00:00Z').getUTCDay();        // 0=日 … 6=土
const weekStart = this.isoShift(T, -((todayDow + 6) % 7));        // その週の月曜（日曜は前の月曜に属する）
const weekReviews = S.reviews.filter(r => r.due >= weekStart && r.due <= T);   // 分母
const weekDone    = weekReviews.filter(r => r.done).length;                    // 分子
const weekRateAvailable = weekReviews.length > 0;                              // ← テンプレート未使用
const weekRate = weekRateAvailable ? Math.round(weekDone / weekReviews.length * 100) : null;
```
- **分母 = 「今週の月曜〜今日」に `due` が入る復習の全件**（完了/未完了、added の有無を問わない）。未来分は含めない
- **分子 = そのうち `done === true` の件数**。`completedAt` は判定に使わない
- `weekRateLabel = available ? String(weekRate) : '–'`、`weekRateSuffix = available ? '%' : ''`、`weekRateMeta = available ? (weekDone + '/' + weekReviews.length + '件') : '今週は対象なし'`
- 表示は Review カード3（1471）と Cockpit フッター（1011）の2箇所

#### 並び替え / 絞り込み（1472-1485）
- 「**並び替え**」+ `revSortChips`（3229-3234）: `{id:'due',label:'期限順'}` / `{id:'subj',label:'教科ごと'}`。選択中 `c:var(--onAcc)/bg:var(--acc)`、非選択 `c:var(--tx2)/bg:transparent`
- 「**教科で絞り込み**」+ `revSubjChips`（3205-3215）: `Object.keys(SUBJ)` を走査し `count = S.reviews.filter(r => r.subj===name && !r.done).length`、**`count > 0` のものだけ表示**。チップは `{{s.name}}` + `{{s.count}}`。選択中 `c:var(--onAcc)/bg:SUBJ[name].c`、非選択 `c:SUBJ[name].c/bg:SUBJ[name].bg`、`bd` 常に `SUBJ[name].c`。クリックでトグル（同じものを再押下で `revFilter:null`）

#### 並び順（`revSorted`, HTML:3218-3228）
```js
if (S.revSort === 'subj') {
  const sa = subjIdx[a.subj] ?? 99, sb = subjIdx[b.subj] ?? 99;   // subjIdx は Object.keys(SUBJ) の index
  if (sa !== sb) return sa - sb;
  if (a.done !== b.done) return a.done ? 1 : -1;
  return a.due < b.due ? -1 : 1;
}
const ka = a.done ? 2 : (a.due <= T ? 0 : 1), kb = …;   // 遅れ+今日=0 / 今後=1 / 完了=2
if (ka !== kb) return ka - kb;
return a.due < b.due ? -1 : 1;
```
その後 `revFiltered = revSorted.filter(r => !S.revFilter || r.subj === S.revFilter)`（3235）。
> **コンパレータは等値のとき 0 を返さず必ず 1 を返す非対称比較子。** 同一 `due` の相対順序は実装依存。§11-Q2

#### 仕切り（divider）
`revFutIdx = S.revSort === 'due' ? revFiltered.findIndex(r => !r.done && r.due > T) : -1`（3237）。
行の `divider: idx === revFutIdx && idx > 0`（3241）。true のとき行の**上**に「**▼ 明日から先の復習**」（1494-1498、700 10.5px 'Noto Sans JP', `var(--tx3)`, LS .06em、左右に `1px dashed var(--line2)`、背景 `var(--bg2)`、`padding:16px 14px 6px`）。
教科ごとモードでは `-1` なので出ない。先頭行が既に未来なら `idx > 0` で抑止。

#### 表ヘッダ（1489-1491）
grid `86px minmax(200px,1fr) 84px 96px 68px 86px 72px 158px; gap:0 10px; padding:10px 14px`。
ラベル: **教科** / **タスク名** / **前回** / **次回復習** / **復習回** / **間隔** / **状態** / **操作**（右寄せ）

#### 行（`.review-table-row`, 1500-1514 / 値 3238-3258）
- 全体クリック → `r.onOpen` → `revSel = r.id`
- `border-left:3px solid {{r.subjC}}`、`background:{{r.rowBg}}`、`opacity:{{r.op}}`
  - `rowBg = !r.done && r.due <= T ? 'color-mix(in srgb, ' + SUBJ[r.subj].c + ' 5%, transparent)' : 'transparent'`
  - `op = r.done ? 0.45 : 1`、`deco = r.done ? 'line-through' : 'none'`
- 列1 教科: ピル（700 10px 'Noto Sans JP', `color:subjC`, `background:subjBg`, radius 99px, padding 2px 8px）
- 列2 タスク名: `{{r.title}}`（500 12.5px, ellipsis）+ 任意 `{{r.ttLabel}}` = `'時間割 ' + r.timetablePeriod + '限'`（org バッジ）
- 列3 `data-label="前回"`: `lastLabel = fmtD(r.last)`
- 列4 `data-label="次回"`: `nextLabel = fmtD(r.due)`、色 `nextC = r.done ? 'var(--tx3)' : (r.due <= T ? 'var(--pink)' : 'var(--tx1)')`
- 列5 `data-label="復習回"`: ピル `第N回`（`roundLabel = '第' + reviewNoOf(r) + '回'`）、`title` 属性 `roundTitle = r.title + 'の第N回復習'`、`min-width:48px`、`border:1px solid subjC`
- 列6 `data-label="間隔"`: `{{r.stage}}`（生の stage 文字列）
- 列7 `data-label="状態"`: `statusOf(r)`（3198-3204）

  | 条件 | label | c | bg |
  |---|---|---|---|
  | `r.done` | **完了** | `var(--tx3)` | `transparent` |
  | `r.due < T` | **{N}日遅れ**（`Math.max(1, -daysUntil(r.due))`） | `var(--pink)` | `var(--pinkBg)` |
  | `r.due === T` | **今日** | `var(--grn)` | `var(--grnBg)` |
  | `r.due === TOMORROW` | **明日** | `var(--acc)` | `var(--accBg)` |
  | else | **今後** | `var(--tx2)` | `var(--bg3)` |

- 列8 操作（右寄せ, gap 6px）:
  - `r.canAdd = !r.added && !r.done && r.due <= T` → 「**＋ 今日へ**」（`background:var(--grn)`, `color:var(--onAcc)`, radius 99px）。`onAdd`: `e.stopPropagation()` → `mutReview(added=true)` → `addToOrder(id)` → トースト「**「{subj} {title}」を今日のToDoに追加しました**」
  - `r.isAdded = r.added && !r.done` → テキスト「**✓ 追加済み**」（`var(--grn)`）
  - `r.canDone = !r.done && r.due <= T` → 「**完了**」（枠線のみ）→ `stopPropagation` + `openAsk(r.id)`
  - 常に「**⋯**」（24×24, `border:1px solid var(--line2)`, hover `border-color:var(--acc);color:var(--tx0)`）→ `stopPropagation` + `revSel = r.id`

#### フッター（1516）
「**行クリック / ⋯ で詳細パネル(日付変更・削除) · 期限順: 遅れ → 今日 → 今後 → 完了 / 教科ごと: 教科でまとめて表示 · 完了時に理解度を記録すると次の復習が自動で組まれます**」

### 6.5 復習詳細ドロワー（`revDetailOpen`, HTML:1607-1647 / 値 4161-4185）

- `revDetailOpen: !!rSel`、`rSel = S.reviews.find(r => r.id === S.revSel) || null`（3261）
- 幅 `rdW = S.panelW.review + 'px'`（既定 380、`max-width:94vw`）、`rdResize = this.resizer('review','left')`
- ヘッダ: 教科チップ `{{rdSubj}}` / 「第N回」チップ `{{rdRoundLabel}}`（`border:1px solid rdSubjC`）/ `{{rdStage}}の復習`（grn）/ 任意 `{{rdTtLabel}}` / ✕
- タイトル: `rdTitleViewing = !!rSel && S.revEditName !== rSel.id` のとき 700 17px、`border-bottom:1px dashed color-mix(in srgb,var(--acc) 42%,transparent)`、`onDoubleClick = rdEditTitle` / `onTouchEnd = rdTouchTitle`（**420ms 以内の連続タップでダブルタップ判定**、4169）。編集中は `<input id="review-title-editor">`。`rdOnTitle` が入力のたびに `mutReview(title=v)`（即時反映）。`rdTitleKey`: Enter → `preventDefault` + `blur()`、Escape → `revEditName:null`。`onBlur = rdFinishTitle`。直下に「**名称はダブルタップで編集できます**」（`margin-top:-9px`）
- 情報カード5枚（`grid-template-columns:1fr 1fr;gap:9px`、各 `background:var(--bg2);border-radius:10px;padding:10px 12px`）:
  1. 「**前回学習日**」→ `{{rdLast}}` = `fmtD(rSel.last)`（Space Grotesk 14px）
  2. 「**次回復習日**」→ `{{rdNext}}` = `fmtD(rSel.due)`、色 `rdNextC = !rSel.done && rSel.due <= T ? 'var(--pink)' : 'var(--tx0)'`
  3. 「**今回の復習**」→ `{{rdRoundLabel}}`（色 `rdSubjC`）
  4. 「**復習タイミング**」→ `{{rdStage}}`
  5. 「**目安時間**」→ `{{rdMin}}分`
- 状態行: `{{rdSrc}} · 状態: {{rdStLabel}}`（`statusOf(rSel)`）
- アクション（`border-top:1px solid var(--line);padding-top:14px`）:
  - `rdCanAdd = !rSel.added && !rSel.done && rSel.due <= T` → 「**＋ 今日のToDoに追加**」（`background:var(--grn)`, `box-shadow:var(--gGrn)`）→ トースト「**「{subj} {title}」を今日のToDoに追加しました**」
  - `rdIsAdded = rSel.added && !rSel.done` → 「**✓ 今日のToDoに追加済み**」（grnBg）+ 「**今日のToDoから外す**」→ `added=false` + `order` から除去 + トースト「**今日のToDoから外しました**」
  - `rdCanDone = !rSel.done && rSel.due <= T` → 「**✓ 復習完了にする**」→ `openAsk(rSel.id)`
  - 「**次回復習日を変更**」+ 「**− 1日**」「**＋ 1日**」→ `shiftDue(delta)` **(v0.9 変更)**（`const shiftDue =` で再検索）:
    ```js
    // (v0.9) due 自身を起点に相対シフトする。13日カレンダー(DIDX/DAYS)は経由しない
    const base = /^\d{4}-\d{2}-\d{2}$/.test(rSel.due || '') ? rSel.due : T;
    const floor = base < T ? base : T;          // 下限は「今日」。すでに期限切れならその日が下限
    const shifted = this.isoShift(base, delta);
    const iso = shifted < floor ? floor : shifted;
    if (iso === rSel.due) { this.showToast('次回復習日はこれ以上前にできません'); return; }
    this.mutReview(rSel.id, x => (x.due = iso, x));
    this.showToast('次回復習日を ' + this.dayLabel(iso) + ' に変更しました');
    ```
    **(v0.9 修正)** 旧実装は `this.DIDX[rSel.due]` で 13日ウィンドウ（今日〜+12日）の index を引いてから ±1 していたため、**枠外の due（期限切れ or 13日以上先）は `ni=0` に落ちて一気に「今日」へ飛んでいた**。§11-Q9 は解消済。
    - 例: `due=8/1`（5日遅れ）に「＋ 1日」→ `8/2`（4日遅れ）。20日先の due に「＋ 1日」→ 21日先
    - 下限に張り付いて日付が動かないとき（今日の復習に「− 1日」/ 期限切れの復習に「− 1日」）は `mutReview` せず、トーストが「**次回復習日はこれ以上前にできません**」になる（旧実装は動いていないのに「変更しました」を出していた）
    - `due` が壊れている（`YYYY-MM-DD` でない）場合の起点は `T`
  - 「**テスト計画に変更**」（vio 系）→ `reviewToTest()`（§7.9）
  - 「**Reviewから完全に削除**」（テキストのみ、hover で pink）→ reviews から除去 + `revSel:null` + `order` から除去 + トースト「**復習アイテムを削除しました**」

### 6.6 Cockpit の復習セクション（HTML:992-1013）

- パネル `.cockpit-panel.cockpit-panel--review`、`onDragOver={{ckReturnDragOver}}` `onDrop={{ckReturnDrop}}`、`border:1px solid {{ckReturnBd}}`
- タイトル: `panel-dot(--dot:var(--grn))` + 「**復習**」 + `panel-heading__meta`（`color:var(--pink)`）「**今日 {{revTodayCount}}件**」
- リスト `ckReviews`（3151-3155）: **`S.reviews` 全件**（`due` によるフィルタなし。完了済み・未来分も並ぶ）。検索中のみ `hit(r.title) || hitSubject(r.subj)` で絞る。各要素は `revDecorate(r)`（3124-3140）+ `drag`/`onDragStart`/`onDragEnd`
- カード `.cockpit-review`:
  - `cardBg = r.due === T && !r.done ? 'color-mix(in srgb, var(--grn) 6%, var(--bg2))' : 'var(--bg2)'`
  - `cardBd = r.due === T && !r.done ? 'color-mix(in srgb, var(--grn) 35%, var(--line))' : 'var(--line)'`
  - `op = r.done ? 0.5 : 1`、`cursor:grab`
  - 1行目: 教科チップ / `{{r.stage}}の復習`（grn/grnBg）/ 任意「時間割 N限」（org）/ `{{r.dueLabel}}` = `this.dayLabel(r.due)`、色 `dueC = r.due === T ? 'var(--pink)' : 'var(--tx3)'`
  - 2行目: `{{r.title}}`（500 13px, `var(--tx0)`, `margin-top:5px`）
  - 3行目: `{{r.src}} · {{r.min}}分` と、`r.canAdd`（`!added && !done && due <= T`）なら「**＋ 今日へ**」、`r.isAdded`（`added && !done`）なら「**✓ 今日のToDoに追加済み**」
- 空状態 `ckReviewsEmpty` → §2.10
- フッター `.cockpit-week-rate`（`margin-top:auto`）→ `onClick={{goReview}}`:
  `{{weekRateLabel}}{{weekRateSuffix}}`（700 18px 'Space Grotesk' `var(--grn)`）+ 「**今週の復習消化率 · {{weekRateMeta}}**」`<br>`「**Review画面へ →**」

### 6.7 今日の ToDo 内での復習

- `itemOf` は **`size` を `'S'` 固定**にする（2825）。`min:20` の復習でも Cockpit のサイズバッジは `S`、詳細の `selSizeLabel` は `'S · 20分'`。§11-Q10
- `meta = it.min + '分 · ' + it.src` → 例 `20分 · 翌日の復習`
- 詳細パネル: `selTypeLabel` は「**復習**」。`selSubs` は空 → 「**細分化はまだありません**」。`selCanAddSub` が false なので**細分化追加 UI が出ない**。`selCanDelete` は true → 「削除」で reviews から丸ごと削除
- 負荷計算 `loadsMap`（2479）: `S.reviews.forEach(r => { if (r.added && !r.done) L[this.TODAY] += r.min; })` — **追加済み未完了の復習だけが今日の負荷に加算される**（他日には一切乗らない）
- 完了済み復習のチェックをもう一度押すと `mutReview(done=false)` で**モーダルなしに未完了へ戻る**（studyLog も生成済みの次回復習も戻らない）
- Data の円グラフは `reviews` を直接集計しない（`studyLog` 経由）

### 6.8 時間割「追加済み」判定との連動（HTML:3432-3433）

```js
S.reviews.some(row => String(row.timetablePeriod||'') === String(period) && row.timetableDate === addScheduleDate)
```
復習も判定対象なので、その日その限から作られた復習があると Add 画面の時間割スロットに「**✓ 追加済み**」バッジが出る。
`timetablePeriod` は number と string が混在しうるため `String()` で比較している。

---

## 7. 試験・予習計画

### 7.1 配置エンジン `scheduleItems(items, room, spread)`（HTML:1898-1951、クラス外のトップレベル関数）

コメント（1883-1897）に「このアプリの心臓部」と明記。**初期配置も再配分も必ずここを通す**。

```
items  … 配置するタスク [{min}] を表示順で渡す
room   … 候補日ごとの「まだ入れられる分数」。days と同じ長さ
spread … 'even'（既定）… 空き容量に比例して散らす
          'early'      … 入る日から前詰め
          'flow'       … 上限を無視して期間全体へ等間隔
返り値 … items と同じ長さ。各要素は候補日 index、置けなければ -1
```

1. `out = new Array(itemCount).fill(-1)`。`dayCount===0 || itemCount===0` なら即 return
2. `left = room.map(v => Math.max(0, Number(v)||0))`
3. `need = items.map(it => Math.max(1, Number(it && it.min)||1))` ← **min が 0/undefined でも最低 1 分**
4. `unlimited = (spread === 'flow')`
5. **`early`**: `cursor=0`。各 i について `d=cursor` から `left[d] < need[i]` の間 `d++`。`d>=dayCount` なら `continue`（-1、cursor 据え置き）。置けたら `out[i]=d; left[d]-=need[i]; cursor=d;`（cursor は d に戻る＝同じ日に複数入る）
6. **`even`/`flow`**:
   - `weight = unlimited ? left.map(()=>1) : left.slice()`、`totalWeight = Σweight`。`totalWeight<=0` なら全部 -1
   - `cumBefore[0]=0; cumBefore[d+1]=cumBefore[d]+weight[d]`
   - `centers[i] = run + need[i]/2`（run は累積）。`first=centers[0]`、`span=centers[n-1]-first`
   - 各 i: `ratio = span>0 ? (centers[i]-first)/span : 0`、`mark = ratio*totalWeight`、`while(day<dayCount-1 && cumBefore[day+1] <= mark+1e-6) day++;`
   - `d=day`。`!unlimited` なら `while(d<dayCount && left[d]<need[i]) d++`。`d>=dayCount` → -1（day 据え置き）
   - `out[i]=d`。`!unlimited` なら `left[d]-=need[i]`。`day=d`
   - 帰結: **1件目は必ず初日（ratio=0）**、最後は最終日側。平日/休日の上限差も既存予定も weight に自動反映される

### 7.2 日付軸・負荷計算

#### `planTimelineDays(plans, segs)`（HTML:2457-2472）
- `lastIso = this.isoAt(12)`（＝今日から13日ぶんが最低長）
- `include(iso)`: `/^\d{4}-\d{2}-\d{2}$/` かつ `iso >= TODAY` かつ `iso > lastIso` なら lastIso 更新。全 plan の `due` と全 seg の `day` に対して実行
- `lastIndex = Math.max(12, floor((lastTime - base)/86400000))`、`count = Math.min(731, lastIndex+1)` ← **最大 731 日（約2年）に制限**
- 返り値要素: `{ iso, dow, label: String(日), weekend: (dow==='土'||dow==='日'), idx }`

#### `loadsMap(days)`（HTML:2474-2481）
```js
segs   : !s.done && L[s.day] != null   → L[s.day] += s.min
extras : !x.done, d = x.day || TODAY   → L[d] += x.min
reviews: r.added && !r.done            → L[TODAY] += r.min      // 常に今日へ
```
#### `maxOf(d)`（HTML:2482）= `d.weekend ? this.state.weMax : this.state.wkMax`

### 7.3 計画作成（Add 画面の test / prep）

#### 種類チップ `addTypes`（HTML:3370, 3384-3390）
```js
[{id:'single',label:'今日のタスク'},{id:'review',label:'復習'},{id:'prep',label:'予習'},{id:'test',label:'テスト'}]
```
active `c:'var(--tx0)' bg:'var(--bg3)' bd:'var(--acc)'` / inactive `c:'var(--tx2)' bg:'var(--bg2)' bd:'var(--line2)'`、`border-radius:10px;padding:7px 14px`。
`onPick`（3389）: `addType` を切替え、**`test`/`prep` のときだけ `addDetailOpen:true` を強制**、`addErr:{}`, `addDone:null`。

#### 見出しの切り替え
- `dayHeads`（3371）= `{single:'予定日', review:'復習日', prep:'期限日', test:'テスト日'}`
- `day2Heads`（3372）= `{prep:'開始予定日', test:'計画開始日'}`（single/review は `''`）
- `addHasStart`（4196）= `addType==='prep'||'test'`
- `addShowSize`（4216）= `single||review` → **test/prep ではトップレベルのサイズチップが出ない**
- `addSizeHead`（4217）= `addType==='review' ? '目安時間(復習1回ぶん)' : 'サイズ(目安時間)'`
- `addDetailArrow`（4214）= `'▾'` / `'▸'`、`addDetailHint`（4215）= `addType==='review' ? '(メモ)' : '(細分化・メモ)'`
- `addHasMini`（4218）= `addType!=='review'`、`addShowGenerator`（4219）= `test||prep`、`addMiniHasSize`（4230）= `addType!=='review'`

#### 自動細分化ジェネレータ（HTML:3489-3528、テンプレ 1377-1398）
チップ `addGeneratorChips`: 「**1件ずつ**」(`manual`) / 「**DUO 範囲分割**」(`duo`) / 「**青チャート用**」(`chart`)。`onPick` は `addGenerator` を設定しつつ `addDetailOpen:true`。見出し「**自動で細分化**」。

- **duo**: 入力「**開始**」(`duoStart` 既定 `'1'`) / 「**終了**」(`duoEnd` `'400'`) / 「**何例文ずつ**」(`duoChunk` `'10'`)
  - `duoPreviewCount` = `(start>=1 && end>=start && chunk>=1) ? Math.ceil((end-start+1)/chunk) : 0`、ボタン「**{{duoPreviewCount}}件を生成**」
  - 生成: `for(n=start; n<=end; n+=chunk) titles.push(n + '–' + Math.min(end, n+chunk-1))` ← 区切りは **en-dash `–`**
  - 注記（1387）「**例: 1〜400を10ずつ → 1–10、11–20 … 391–400**」
  - 不正時トースト「**DUOの開始・終了・区切り数を正しく入力してください**」
- **chart**: 入力「**プリント開始**」(`chartStart` `'1'`) / 「**プリント終了**」(`chartEnd` `'4'`)
  - `chartPreviewCount` = `(start>=1 && end>=start) ? (end-start+1)*4 : 0`
  - 生成順（3518-3519）: 先に全プリントの `n+'fe'`, `n+'be'` を並べ、**そのあとに**全プリントの `n+'fp'`, `n+'bp'`。
    例 start=1,end=2 → `1fe, 1be, 2fe, 2be, 1fp, 1bp, 2fp, 2bp`
  - 注記（1395）「**例題を全プリント分 → 練習の順で、1fe・1be … 1fp・1bp と生成します。**」
  - 不正時トースト「**プリントの開始番号と終了番号を正しく入力してください**」
- **manual**: `focusEl('add-mini')` して return（何も生成しない）
- 共通ガード: `titles.length > 500` → 「**一度に生成できるのは500件までです**」。既存 `addMinis` とタイトル重複するものは除外、全滅なら「**同じ名前のミニタスクはすでに追加済みです**」。成功 → 「**{n}件のミニタスクを生成しました**」。生成サイズは `addMiniSize`

#### 手動ミニ追加 `pushMini`（HTML:3482-3488）
`addMiniTitle` を trim、空なら無視。`addMinis` に `{title, size: addMiniSize, min}` を push、入力クリア、`focusEl('add-mini')`。Enter で発火（4235）。行は `{{m.title}}` + `{{m.sizeLabel}}`（`size·N分`）+ `✕`。
ミニサイズチップを選ぶと `#add-mini` に自動フォーカス（3477）。

#### `submitAdd` の test/prep 分岐（HTML:3529-3582、else 節 3553-3575）
```
1. 検証: errs.title='タスク名を入力してください' / errs.subj='教科を入力してください'
        / errs.day = dayHeads[addType] + 'を選んでください'
   → 1つでもあれば setState({addErr:errs, addDone:null}) して return
2. this.subjOf(subj)
3. uid = 'u' + Date.now().toString(36) + Math.floor(Math.random()*999)
4. memo = addMemo.trim(); minis = addMinis.slice()
   timetablePeriod = S.addSlotSel || null
   timetableDate   = timetablePeriod ? (S.addSlotDate || addScheduleDate) : null
5. due   = S.addDay
   start = (S.addDay2 && S.addDay2 <= due && S.addDay2 >= T) ? S.addDay2 : T
6. PLANS[uid] = { name: subj+' '+t, type: addType==='test'?'test':'prep', due, subj,
                  range: memo || '範囲は未設定', timetablePeriod, timetableDate }
7. list = minis.length ? minis : [{title:'内容を細分化する', size:'M', min:SIZE_MIN.M}]
8. scheduleDays  = planTimelineDays(PLANS, segs).filter(d => d.iso >= start && d.iso < due)  // GOAL当日は除外
   scheduleLoads = loadsMap(planTimelineDays(PLANS, segs))
   scheduleRoom  = scheduleDays.map(d => Math.max(0, maxOf(d) - (scheduleLoads[d.iso]||0)))
   scheduleSlots = minis.length ? scheduleItems(list, scheduleRoom, 'even') : []   // ★ ミニ未入力なら空配列
9. newSegs = list.map((m,i) => ({ id: uid+'-'+i, plan: uid, title: m.title, size: m.size, min: m.min,
       day: (slot==null||slot<0) ? '' : scheduleDays[slot].iso, done:false }))
10. setState(segs concat newSegs); newSegs で day===T のものを addToOrder
11. done = { label: (test?'テスト計画':'予習計画')+'「'+subj+' '+t+'」を作成しました(細分化 '+newSegs.length+'件)',
             view:'tests', go:'Testsで見る' }
12. reset: addTitle:'', addMemo:'', addMinis:[], addMiniTitle:'', addErr:{}, addDone:done,
           addSlotSel:null, addSlotDate:null,
           recentSubjs: [subj, ...others].slice(0,4)
13. showToast(done.label); focusEl('add-title')
```

**帰結**
- ミニタスクを1つも入れずに計画を作ると `list` はダミー1件だが `scheduleSlots` は `[]` なので `day:''`。
  **つまり「内容を細分化する」は常に未配分**。§11-Q11
- `addSubj` / `addType` / `addDay` / `addSize` はリセットされない
- **初期配置は `manualDay` を付けない**ので、直後の再配分の対象になる
- `start` は `addDay2` が「due 以下 かつ 今日以降」のときだけ採用

#### 追加成功バナー（1300-1306）
`✓ {{addDoneLabel}}` / 「**続けて追加**」（`addContinue`: `addDone:null` + `focusEl('add-title')`）/ 「**{{addGoLabel}} →**」（`addGoView`: `view = done.view`, `addDone:null`）。背景 `var(--grnBg)`、枠 `var(--grn)`、`animation:popIn .18s ease`。

#### 時間割から入力（Add 右カラム、1432-1460）
`pickScheduleSlot(period, subj)`（3408-3424）→ `{addSlotSel:period, addSlotDate:addScheduleDate, addType:'review', addTitle:'{period}限の復習', addSubj:clean, addSize: 現状||'S', addErr:{}, addDone:null}` + `focusEl('add-title')` + トースト「**{period}限「{subj}」をAddに入力しました**」。`held`（コマあり）でないとクリック無効。
バナー: 「**時間割から入力 · {{addTimetableLabel}}**」+「**解除**」（`clearTimetableSource`, 4192）。
`addScheduleDate` は `timetableFocusDate` が土日ならその週の月曜（3391-3394）。
週ストリップ `scheduleWeekControls`: `‹` / 月〜金の5日（`曜 M/D`）/ `›`。
スロット: `{{slot.no}}` + 「限」 + `input.timetable-slot__subject[placeholder="教科を入力"]` + `{{slot.meta}}` + `sc-if slot.hasAdded` → 「**✓ 追加済み**」
- `slot.slotClass`（3441）= `(active?'is-active ':'') + (hasAdded?'is-added ':'') + (!held?'is-empty':'')`
- `slot.meta`（3449）= `held ? (baseSubj ? '基本: '+baseSubj : '臨時コマ') : '基本なし'`

### 7.4 試験計画スクリーン（`view='tests'`, HTML:1042-1121）

ルート: `flex:1;overflow:auto;padding:18px 20px;display:flex;flex-direction:column;gap:14px`。

#### コントロール行 `.plan-controls`（1044-1069）
1. 「**平日 最大負荷**」/ `{{wkMaxH}}`（`font:700 18px 'Space Grotesk'`, `var(--tx0)`）+ `＋`(`wkPlus`, `Math.min(720, wkMax+30)`) / `－`(`wkMinus`, `Math.max(60, wkMax-30)`)。ボタン 22×18px
2. 「**休日 最大負荷**」/ `{{weMaxH}}`（色 `var(--grn)`）+ `wePlus` / `weMinus`（同じく 30分刻み・60–720）
3. 「**再配分**」/「**未完了 {{redistTargetCount}}件**」+ 「**全体を再配分**」(`openAllRedist`) + `{{redistPickLabel}}`(`choosePlanRedist`, `aria-pressed={{redistPickPressed}}`)
4. `.plan-legend`（1064-1068）: 「**テスト(実線)**」（2px solid）/「**予習(点線)**」（2px dashed）/ サイズ凡例「**XS 5分**」(swatch 8px)「**S 10分**」(13px)「**M 20分**」(20px)「**L 30分**」(28px)、swatch は `height:10px;background:var(--accBg);border-radius:3px`

#### 未完了警告バー `.plan-overdue`（`hasOverdue`, 1071-1077）
「**⚠ 期限前に終わらなかったタスクが {{overdueCount}}件**」/「**今日以降〜期限日に、最大負荷を守って自動で組み直せます**」/ 右端「**全体を再配分**」。背景 `var(--pinkBg)`、枠 `var(--pink)`。

#### 計画選択モードのバー（`redistPickMode`, 1079-1081）
「**↓ 再配分したい計画を選択してください**」（`var(--accBg)`/`var(--acc)`）

#### モバイル用ヒント（1082）
「**← 横にスワイプして日付を確認 →**」（`.mobile-scroll-hint`、820px 以下のみ）

#### タイムライン表 `.plan-timeline-table`（1083-1119）
- `role="region" aria-label="試験計画の日付カレンダー" tabindex="0"`、`--timeline-days:{{dayCount}}`、`--timeline-mobile-min-width:{{timelineMobileMinW}}`、`overflow-x:auto`
- `dayCount = planDays.length`（4038）、`timelineMinW = (270 + dayCount*104)+'px'`（4039）、`timelineMobileMinW = (156 + dayCount*92)+'px'`（4040）
- ヘッダ grid `270px repeat(dayCount, minmax(104px,1fr))`。左端セルは `position:sticky;left:0;z-index:3` で「**計画 ＼ 日付**」
- 日カラム（`days`, 2657-2669）:
  - `bg`: 今日 → `color-mix(in srgb, var(--acc) 8%, transparent)` / 週末 → `color-mix(in srgb, var(--grn) 5%, transparent)` / else transparent
  - `dow` 表示、色は週末 `var(--grn)` / else `var(--tx3)`
  - `label = fmtMD(iso)`、色は今日 `var(--acc)` / else `var(--tx1)`
  - 負荷バー: 枠 26px、`width:14px`、高さ `pct = Math.min(100, Math.round(ld/mx*100))+'%'`、`min-height:2px`、色 `over ? 'var(--pink)' : (weekend ? 'var(--grn)' : 'var(--acc)')`
  - `loadH = ld ? (Math.round(ld/6)/10)+'h' : '–'`、色 over なら pink
- **計画行の並び**（2673-2678）:
  ```js
  activePlanIds = Object.keys(P).filter(pid => {
    const segs = S.segs.filter(s => s.plan===pid);
    return !(P[pid].due < T && segs.length > 0 && segs.every(s => s.done));   // 期限切れ&全完了は非表示
  });
  planIds = savedPlanOrder(active のみ) ++ 残り
  ```
- 各行 `.plan-timeline-row {{p.rowDragClass}}`: `is-dragging`（`rowOpacity:0.45`）/ `is-dragover`（`rowShadow:'inset 0 2px 0 ' + sub.c`）
- **左スティッキーセル** `.plan-sticky-cell`（1097-1102）: `position:sticky;left:0;z-index:3`、`background:{{p.pickBg}}`（`redistPickMode` のとき `color-mix(in srgb, {subjColor} 10%, var(--bg1))`、通常 `var(--bg1)`）。`title={{p.planClickTitle}}` = 「**この計画の再配分を設定**」(pickMode) / 「**この計画の詳細を開く**」
  - 1段目: ハンドル「**≡**」（draggable, `title="ドラッグして計画の順番を変更"`, `onClick=stopProp`）+ 教科色ドット(7px) + `{{p.name}}`（ellipsis）
  - 2段目: `{{p.typeLabel}}` バッジ（`border:1px {{p.bStyle}} {{p.c}}`）/ 任意「時間割 {N}限」/ 「**あと`{{p.daysLeft}}`日**」/ `{{p.progText}}` / 「**✎ 編集**」(`openEditor`, `var(--acc)`) / `odCount>0` のとき「**⚠{{p.odCount}}**」(pink, `openRedist`)
- **右側セル領域**: `grid-column: 2 / span {{dayCount}}`、`min-height:{{p.rowH}}`
  - `rowH = Math.max(76, maxSegsInDay*25+36)+'px'`（2700）
  - 内側に `position:absolute;inset:0;display:grid;grid-template-columns:repeat(dayCount,1fr);z-index:1`
- 各セル（`p.cells`, 2769-2813）:
  - 横線: `position:absolute;left:0;right:{{cell.lineRight}};top:50%;border-top:2px {{cell.lineStyle}} {{cell.lineC}};opacity:.78`
    - `lineC = (pl.due < T || d.iso > pl.due) ? 'transparent' : sub.c`
    - `lineStyle = isTest ? 'solid' : 'dashed'`
    - `lineRight = (d.iso === pl.due) ? '50%' : '0'`
    - ※ HTML:2816 の `plans.forEach(p => p.lineC = 'color-mix(… 55% …)')` は**テンプレートが `cell.lineC` しか使わないためデッドコード**
  - セグメントチップ（`enrichSeg`, 2679-2691）: 幅 `w` = XS `32%` / S `46%` / M `68%` / L `92%`、`height:22px;border-radius:7px;border:1.5px solid {sub.c};box-shadow:0 0 0 2px var(--bg1)`、`bg = done ? 'transparent' : sub.bg`、`op = done ? 0.4 : 1`、ラベル `short = done ? '✓' : size`
    - `onToggle`: `_suppressSegClick` が立っていなければ `done` トグル（D&D 直後のクリック誤爆防止。`setTimeout(...,0)` で解除、2687）
    - `onEnter` → tooltip `{title: s.title + (done?' ✓済':''), sub: planName + ' · ' + min + '分 · ' + size + ' · ' + dayLabel(day) + (manualDay ? ' · 手動固定(再配分対象外)' : '')}`。位置は `clientX / clientY-8`、`onLeave` → tooltip null
    - **検索フィルタ**: `segs.filter(s => s.day===d.iso && (!filtering || hit(s.title) || hit(pl.name) || hitSubject(pl.subj)))`（2811）
  - **GOAL ピル**（`cell.goal = pl.due >= T && d.iso === pl.due`, 1111）: 「**GOAL {{cell.goalLabel}}**」（`goalLabel = fmtMD(pl.due)`）。draggable、`title="ドラッグしてテスト日を変更"`、`border:2px solid {lineC}`, `border-radius:99px`, `box-shadow:0 0 12px color-mix(in srgb,{lineC} 35%,transparent)`。**期限切れ計画には出ない**
- 表フッタ（1118）: 「**≡ 計画は左のハンドルで並び替え · セグメントはドラッグで日付固定 · GOALもドラッグしてテスト日を変更 · クリックで完了 · GOAL当日以降には配置できません**」

#### 計画ごとの派生値（HTML:2701-2814）
```js
daysLeft = this.daysUntil(pl.due)                 // 負にもなる →「あと-3日」と出る
dueText  = this.dayLabel(pl.due)
dash     = Math.round(doneN/segs.length*182)      // segs.length===0 → NaN
progPct  = Math.round(doneN/segs.length*100)+'%'  // 同上 → 'NaN%'
progText = doneN + '/' + segs.length + ' 完了'
next     = segs.filter(!done).sort((a,b)=> a.day<b.day ? -1:1)[0]   // '' が最小 → 未配分が先頭
nextTitle= next ? next.title : '完了！'
typeLabel= isTest ? 'テスト' : '予習'
bStyle   = isTest ? 'solid' : 'dashed'
bColor   = od ? 'var(--pink)' : 'var(--line2)'
cardBg   = isTest ? `color-mix(in srgb, ${light?'#6d4de0':'#a78bfa'} 6%, var(--bg2))` : 'var(--bg2)'
cardGlow = 'none'
od       = segs.filter(s => !s.done && s.day < T).length   // ★ manualDay も数える
odCount  = od ? od : false
ttLabel  = pl.timetablePeriod ? ('時間割 '+pl.timetablePeriod+'限') : false
```

#### D&D 3種
1. **計画行の並べ替え**（2707-2722）: `dragPlanRow` / `dragPlanOver`。dataTransfer `'plan-row:'+pid`。drop で `planOrder` を splice。同じ行なら何もしない
2. **セグメントの日付固定**（2771-2809）: `validDrop = dragged && dragged.plan === pid && d.iso < pl.due`（**同一計画かつ GOAL より前のみ**）。`targetKey = pid+':'+d.iso`、ハイライト時 `dropBg = color-mix(in srgb, {sub.c} 18%, var(--bg2))`、`cellBd = sub.c`。drop 時 `mutSeg(day=d.iso, manualDay=true)`、旧 day が今日で新 day が今日でなければ `order` から除去、新 day が今日なら `addToOrder`。トースト「**「{title}」を{dayLabel}へ移動しました**」。dataTransfer `'segment:'+id`
3. **GOAL のドラッグ**（2773, 2785-2800）: `validGoalDrop = dragGoalPlan === pid && d.iso >= T`（**今日以降のみ**）。drop 時:
   ```js
   this.PLANS[pid] = {...this.PLANS[pid], due: d.iso};
   segs: 同計画で day && day >= d.iso のものを isoShift(d.iso,-1) へ
   order: その計画の id を全部除去 → day===T のものを再追加
   edPlanDue: 編集ドロワーが同じ計画を開いていれば d.iso に同期
   ```
   トースト「**「{planName}」のGOALを{dayLabel}へ変更しました**」。dataTransfer `'goal:'+pid`

### 7.5 コックピットの計画パネル（HTML:1014-1037）

- 見出し: dot `--dot:var(--vio)` + 「**試験・予習計画**」（`white-space:nowrap`）+ 右リンク「**計画を見る →**」(`goTests`)
- カード `.cockpit-plan`（`ckPlans = plans.map(p => p)`, 4049 — **Tests 行と同一オブジェクト**）:
  - `draggable="{{p.canDrag}}"`（`next ? 'true' : 'false'`）、`onClick={{p.goTests}}`、`cursor:grab`、`border:1px {{p.bStyle}} {{p.bColor}}`、`background:{{p.cardBg}}`
  - 左: 62×62 SVG（§3.10）、中央に小さく「あと」+ `{{p.daysLeft}}` + 「日」(11px)
  - 右: `{{p.name}}` + typeLabel バッジ + 任意 ttLabel / `{{p.dueText}} · {{p.range}}` / 6px 進捗バー(`width:{{p.progPct}}`) / `{{p.progText}} · 次: <b>{{p.nextTitle}}</b>`
- 空表示（1032-1034）→ §2.10
- 下部 `.cockpit-primary-action`: 「**未完了タスクを再配分**」(`openRedist`)

### 7.6 計画編集ドロワー（`editorOpen`, HTML:1525-1605 / ロジック 3677-3871）

開き方: Tests の「✎ 編集」(`openEditor` 2737-2745) / スティッキーセルのクリック(`openPlan` 2750-2763) / `reviewToTest`（3290-3292）。いずれも `edPlanName/edPlanSubj/edPlanDue/edPlanRange/edPlanType` を現在値でプリロードし `editorCollapsed:false`。
**`redistPickMode` 中に `openPlan` を押すと編集ではなく再配分モーダルが開く**（2751-2755）。

- 幅 `edW = Math.min(520, Math.max(320, S.panelW.editor || 410)) + 'px'`（3948）
- **たたむ**: `collapseEditor` → 右端 54px の縦ラベル（`writing-mode:vertical-rl`, `max-height:150px;overflow:hidden`）、「**‹**」ボタン（`aria-label`/`title="計画編集パネルを開く"`）。折りたたみ中はオーバーレイが `transparent` + `pointer-events:none` → **背後の画面を操作できる**
- ヘッダ: 8px ドット（`edC` = 教科色, `box-shadow:0 0 8px`）/ `{{edName}}` / `{{edMeta}}` = `` `${type==='test'?'テスト':'予習'} · 期限 ${dayLabel(due)} · ${range}` `` / 「**しまう ›**」（`title="横にしまう"`）/ 「**✕**」
- 進捗ブロック: 64px ドーナツ（`edDash = round(doneN/list.length*182)`、0件なら 0）、`{{edPct}}%`、「**ミニタスク {{edDone}} / {{edTotal}} 完了**」+「**未完了ぶん 約{{edRemainMin}}分**」
- **計画を編集**ブロック（1550-1565）: 見出し「**計画を編集**」
  - `edTypeChips` = 「**テスト**」/「**予習**」（active `bg:var(--vio)` `c:var(--onAcc)`）
  - `placeholder="テスト・予習名"` / `type=date`(`edPlanDue`) / `教科`（`list="ed-subjects"` = `Object.keys(SUBJ)`）/ `placeholder="範囲・メモ"`
  - 「**変更を保存**」→ `savePlanEdit`（3683-3702）:
    - 検証 `name && subj && /^\d{4}-\d{2}-\d{2}$/.test(due)`、失敗トースト「**名前・教科・日付を入力してください**」
    - `subjOf(subj)`、`PLANS[edPid] = {...prev, name, subj, due, range: trimmed || '範囲は未設定', type: edPlanType==='prep'?'prep':'test'}`
    - **`day >= due` のセグを `isoShift(due,-1)` へ引き戻す**
    - トースト「**計画を更新しました**」
- 操作ヒント（1566）: 「**≡ ハンドルを持って移動し、挿入線でドロップ位置を確認できます(日付の枠は保持) · サイズはクリックで切替 · 名前はダブルタップで編集**」
- **ミニタスク行** `.mini-editor-row`（`edItems`, 3741-3838）:
  - `data-flipid="ed-{id}"`（FLIP、§3.6）
  - `.mini-drag-handle` 「≡」（draggable, `title="ドラッグして並び替え"`, `touch-action:none`）
  - チェックボックス（`mutSeg` 直, 3776）
  - タイトル（`onDoubleClick` / `onTouchEnd` 二度押し **360ms 以内**で inline 編集、input id `mini-name-{segId}`、Enter/Escape/blur で確定、3777）
  - `.mini-day-label` = `dayLabel(m.day)`（デスクトップ）/ `.mini-day-mobile` `<input type="date" min="{T}" max="{isoShift(pl.due,-1)}" aria-label="{title}の日付">`（820px 以下のみ）
  - `onDayChange`（3790-3798）: 空 or `>= pl.due` は拒否しトースト「**タスクはGOALの前日までに設定してください**」。通れば `manualDay=true`、`order` 同期、トースト「**「{title}」を{dayLabel}へ移動しました**」
  - `.mini-size` ボタン: ラベル `{size}·{min}分`、クリックで `{XS:'S', S:'M', M:'L', L:'XS'}` を巡回し `min` も更新（3789）
  - `.mini-delete` 「✕」→ seg と order から除去、トースト「**「{title}」を削除しました**」
  - `.mini-mobile-actions` 「↑」「↓」（`moveMiniBy(∓1)`, 3745-3761）
  - **並べ替えは日付枠を保持**: `daysList = mine0.map(x => x.day)` を取り、並べ替え後に index 順で `day` を差し戻す（3753-3759, 3825-3831）。「1日目のタスク・2日目のタスク…」という枠は動かず中身だけ入れ替わる
  - 挿入位置: `dragMiniPos`（`'before'`/`'after'`）により `inset 0 3px 0 var(--acc)` / `inset 0 -3px 0 var(--acc)`。ドラッグ中は `rowBg:var(--bg3)`, `lift:scale(1.02)`, `shadow:0 10px 26px rgba(0,0,0,.45)`, `op:0.85`。drop トースト「**ミニタスクの順番を変更しました**」
- **ミニ追加**（1589-1600）: `edSizeChips`（`edNewSize` 既定 `'M'`）、input `#ed-new` placeholder「**ミニタスクを追加… (Enterで連続追加)**」、「**＋ 追加**」→ `addMiniTask()`（2392-2402）:
  - `{id:'u'+…, plan: S.editorPlan, title, size, min, day:'', done:false}` を追加。**サイズはリセットしない**
  - トースト「**ミニタスクを追加しました({size}·{min}分 · 未配分)**」、`setTimeout(()=>focusEl('ed-new'), 0)`
  - 注記（1600）: 「**選んだサイズ(XS/S/M/L)のまま連続で追加できます。新しいミニタスクは「未配分」になります。日付の割り振りは再配分でできます。**」
- **削除 / 完了非表示ボタン**（1601、`deletePlan` 3704-3736）
  - `completedPlan = list.length > 0 && list.every(seg => seg.done)`（3703）
  - `edPlanActionLabel` = 「**完了として非表示にする**」(completed) / 「**この計画を削除**」
  - `edPlanActionC` = `var(--grn)` / `var(--tx3)`、`edPlanActionBd` = `color-mix(in srgb,var(--grn) 55%,var(--line2))` / `var(--line2)`
  - `edPlanActionHover` / `edPlanActionHoverBg` は定義されているが **`style-hover` に `{{ }}` が入るため CSS として無効 → hover 効果なし**（§3.9）
  - **completed 経路**: 確認ダイアログ**なし**。完了 seg を `studyLog` に `{day: seg.day || T, subj: current.subj, min: seg.min}` として移してから `delete PLANS[edPid]`、`segs`/`order`/`selId` を掃除、`editorPlan:null`。トースト「**「{name}」を完了として非表示にしました（勉強時間は保持）**」
  - **通常経路 (v0.9 変更)**: `window.confirm('「{name}」と、そのミニタスクをすべて削除しますか？\n完了済みミニタスクの勉強時間は、データ画面の記録に残ります。')`（**2行**。改行は `\n`）。OK なら、**完了経路と同じく完了 seg を `studyLog` に `{day: seg.day || T, subj: current.subj, min: seg.min}` として転記してから** PLANS/segs/order/selId を掃除。トースト「**計画を削除しました**」
    ```js
    const mineSegs = this.state.segs.filter(x => x.plan === edPid);
    const ids = mineSegs.map(x => x.id);
    const doneSegs = mineSegs.filter(x => x.done);
    delete this.PLANS[edPid];
    this.setState(s => ({
      studyLog: s.studyLog.concat(doneSegs.map(seg => ({ day: seg.day || T, subj: current.subj, min: seg.min }))),
      segs: …, order: …, selId: …
    }));
    ```
    **(v0.9 修正)** 旧実装は通常経路だけ `studyLog` へ転記せず、未完了ミニタスクが混在する計画を削除すると**完了ぶんの勉強時間がデータ画面の円グラフから黙って消えていた**。§11-Q30 は解消済。`min` は seg の `min`、教科は削除時点の**計画の教科**（`current.subj`）を使う

### 7.7 ToDo の計画詳細パネル（`todoShowPlanDetail`, HTML:1162-1185）

- `selectedPid`（2980-2983）: `S.segs.find(s => s.id === S.selId)` の `plan` → 無ければ `todoPlanIds[0] || planIds[0] || null`。さらに `todoPlanIds` が非空でその中に無ければ `todoPlanIds[0]` に矯正
- ヘッダ: 種別チップ `{{todoPlanType}}`（テスト/予習/**計画**）、`{{todoPlanName}}`（未選択時「**計画を選択**」）、右に `{{todoPlanRemainDays}}`（`あと{Math.max(0, daysUntil(due))}日` / `–`）
- サブ行: `{{todoPlanSubj}} · {{todoPlanMeta}}`（`期限 {dayLabel(due)} · {done}/{total} 完了`）
- 3タイル: 「**全体進捗**」`{{todoPlanDone}} / {{todoPlanTotal}}` / 「**今日の進捗**」`{{todoPlanTodayProgress}}`（`{d} / {n}（あと{r}こ）` / 「**今日分なし**」, 4085）/ 「**今日のノルマ**」`{{todoPlanQuotaText}}`（`{title}まで` / 「**今日のノルマなし**」, 4084）
- 「**ミニタスク一覧**」/ 右「**ノルマ線を上下にドラッグして変更**」、body は `max-height:490px;overflow:auto`
- `todoPlanRows`（3031-3057、`todoPlanSegs` = その計画の**全 seg**、今日ぶんに限らない）:
  - チェック / タイトル / 日付チップ `{{s.dateLabel}}`（`dayLabel`）/ サイズ `{{s.sizeLabel}}`（`{size}·{min}分`）
  - 日付チップ色: `overdue`（`day && day<T && !done`）→ `var(--pink)`/`var(--pinkBg)` / `today` → `var(--acc)`/`var(--accBg)` / `future` → `var(--tx2)`/`var(--bg3)` / 未配分 → `var(--tx3)`
  - 行背景 `rowBg = color-mix(in srgb, {planColor} {12|10|5}%, var(--bg2))`（today 12 / overdue 10 / その他 5）、`rowBd` = overdue `--pink` / today 教科色 / else `--line`
  - `op: done ? 0.52 : 1`、`deco: line-through`
  - `onToggle`（3055）: `mutSeg(s.id, x => x.done = !x.done)`
- 空: 「**計画を選ぶとミニタスクを表示します**」

#### 「今日のノルマ」線 = `planQuota`（3024-3027, 3049-3054）
```js
autoQuotaIdx = todoPlanSegs.reduce((last,s,i) => (s.day && s.day <= T ? i : last), -1)
savedQuotaIdx= Number.isInteger(S.planQuota[selectedPid]) ? S.planQuota[selectedPid] : null
quotaIdx     = savedQuotaIdx == null ? autoQuotaIdx : Math.max(0, Math.min(len-1, savedQuotaIdx))
quotaSegs    = quotaIdx >= 0 ? todoPlanSegs.slice(0, quotaIdx+1) : []
quotaAfter   = (i === quotaIdx)   // その行の直後に線を描く
```
線 UI `.quota-line`（1179）: draggable、`title="ドラッグして今日のノルマを変更"`、見た目「**⠿ ──── ↕ 今日のノルマ ここまで ──── ⠿**」（ピル `background:var(--acc); color:var(--onAcc)`）。
`onQuotaStart` → `dragQuota = selectedPid`, `'quota:'+pid`, `effectAllowed='move'`。
各行の `onDragOver="{{s.onQuotaOver}}"` が**ドラッグ中にライブで `planQuota[pid] = i` を更新（プレビュー）**、`onQuotaDrop` で確定 + `dragQuota:null` + トースト「**今日のノルマを「{title}」までに変更しました**」。

### 7.8 再配分（rescheduling）

#### 入口

| 起点 | 実装 | 設定される state |
|---|---|---|
| トップバー「⚠ 未完了 {n}件 → 再配分」（957） | `openRedist` 3980-3982 | `{view:'tests', redistOpen:true, redistPlan:'all', redistPickMode:false, redistMode:'even'}` |
| Cockpit「未完了タスクを再配分」（1036） | 同上 | 同上 |
| Tests「全体を再配分」（1061, 1075） | `openAllRedist` 3983 | 同上 |
| Tests「計画ごとに設定」（1062） | `choosePlanRedist` 3984-3988 | トグル。ON で `{view:'tests', redistOpen:false, redistPlan:null, redistPickMode:true}` + トースト「**再配分したい計画を選択してください**」 |
| 行の「⚠{n}」（1100） | `p.openRedist` 2746-2749 | `{redistOpen:true, redistPlan:pid, editorPlan:null}` |
| pickMode 中の行クリック | `p.openPlan` 2751-2755 | 同上 |

`redistPickLabel` = 「**計画を選択中…**」/「**計画ごとに設定**」。押下時 `bg:var(--acc) c:var(--onAcc) shadow:var(--gAcc)`。

#### `computePreview(mode, planId, includeManual)`（HTML:2484-2544）
```js
redistMode = mode || S.redistMode || 'even'
redistPlan = planId || S.redistPlan || null
ignoreLimit    = (redistMode === 'evenUnlimited')
redistLateDays = clamp(parseInt(S.redistLateDays)||7, 1, 90)
days  = this.planTimelineDays(PLANS, segs)      // days[0] === TODAY
loads = this.loadsMap(days)

targets = segs.filter(seg => {
  const plan = P[seg.plan];
  const inScope = (redistPlan === 'all' || seg.plan === redistPlan);
  return !seg.done && (!seg.manualDay || includeManual) && plan && plan.due > TODAY && inScope;
})
targets の分を loads から差し引く

lockedOverDays = days.filter(d => loads[d.iso] > maxOf(d)).map(d => ({iso, load, max}))

byPlan にグルーピング → orderedPlans = due 昇順、同 due なら planOrder の index 順
各 plan について:
  dueIndex      = dayIndex[plan.due] ?? days.length
  allCandidates = days.slice(0, Math.max(0, dueIndex))          // GOAL当日は必ず除外
  candidates    = (mode==='late') ? allCandidates.slice(-redistLateDays) : allCandidates
  planSegs      = 元の segs 配列内の順序でソート
  candidates.length===0 → 全件 unplaced（reason:'GOAL前に作業日がありません'）
  room   = candidates.map(d => Math.max(0, maxOf(d) - loads[d.iso]))
  spread = ignoreLimit ? 'flow' : (mode==='early' ? 'early' : 'even')
  slots  = scheduleItems(planSegs, room, spread)
  slot<0 → unplaced（reason: ignoreLimit ? 'GOAL前に作業日がありません' : '上限内に入る日がありません'）
  else   → loads[day.iso] += seg.min; moves.push({seg, toIso, warn: loads>max})
return {moves, unplaced, loads, days, mode, plan, includeManual, ignoreLimit, lateDays, lockedOverDays, targets}
```
**計画は due 昇順で順に処理され、先に処理した計画の配置が後続計画の `room` を減らす。**

#### モーダル UI（HTML:1697-1775）
- 見出し「**↻ {{redistPlanName}} の再配分**」（`redistPlanName` = 「**すべての計画**」(all) / `plan.name` / 「**計画**」）
- サブ行「{{redistPlanMeta}} · {{redistModeText}} · **未完了 {{redistTargetCount}}件を今日〜期限前日に配置します**」
  - 単一計画: `` `${subj} · ${test?'テスト':'予習'} · 期限 ${fmtMD(due)} · 平日Max ${wkMax/60}h / 休日Max ${weMax/60}h` ``
  - all: `` `未完了のテスト・予習をまとめて調整 · 平日Max ${wkMax/60}h / 休日Max ${weMax/60}h` ``
- **手動配置トグル**（1705-1708）: 「**手動配置も対象**」+ `{{redistManualSub}}`（ON:「**固定済みも動かす**」/ OFF:「**固定済みは守る**」）、`aria-label="手動配置も再配分する"`, `aria-pressed={{redistManualPressed}}`。トグル 34×19px、つまみ 13px、`translateX(15px)`(ON)/`0px`
- **モードチップ** 見出し「**組み方（{{redistLimitNote}}）**」（1711-1715）

  | id | ラベル | `redistModeText` |
  |---|---|---|
  | `even` | **上限内で均等** | **各日の負荷率が近づくように配置** |
  | `evenUnlimited` | **上限無視で均等** | **各計画のタスクを期間全体へ等間隔で配置** |
  | `early` | **できるだけ早く** | **空きがある早い日から順番に配置** |
  | `late` | **期限前から** | **期限前{N}日間の空きへ分散** |

  `redistLimitNote` = 「**最大負荷を無視し、期間全体へ等間隔で配置します**」(ignoreLimit) / 「**動かす対象は日ごとの最大負荷を厳守します**」
- `evenUnlimited` 警告（1716-1721、`--orgBg`/`--org`）: 「**各計画のタスクを期間全体へ等間隔に配置します**」/「**平日・休日の上限は無視します。プレビューの赤い棒で超過日を確認してください。**」
- `late` の日数入力（1722-1729）: 「**期限前**」+ `input[type=number,min=1,max=90][aria-label="期限前に使う日数"]` + 「**日間に分散**」/ 「**GOAL当日は含めず、この期間の空きを均等に使います**」。`onRedistLateDays`（4008）は `clamp(parseInt||1, 1, 90)`
- **固定超過警告**（`redistHasLockedOver = lockedOverDays.length>0 && !ignoreLimit`, 1730-1736）: 「**固定された予定だけで上限を超えている日があります**」/「**均等に見えない原因です。必要なら右上の「手動配置も対象」をONにしてください。**」/ `{{redistLockedOverText}}` = `` days.map(i => `${fmtMD(iso)} ${round(load/6)/10}h / 上限${round(max/6)/10}h`).join(' · ') ``
- **未配置警告**（1737-1742）: `{{redistUnplacedTitle}}` = ignoreLimit なら「**{n}件はGOAL前に作業日がなく未配置です**」、そうでなければ「**上限を守るため {n}件は未配置のまま残します**」。行「**• {{u.planName}} / {{u.title}} — {{u.reason}}**」
- **空**（1744-1746）: 「**再配分できる未完了タスクはありません。**」（`redistEmpty = pv ? pv.targets.length===0 : redistTargets.length===0`）
- **移動リスト**（1747-1755）: 教科色ドット / `{{m.title}}` / 「{{m.planName}} · {{m.min}}分 · 期限 {{m.due}}」（`fmtMD(pl.due)+'まで'`）/ `{{m.fromLabel}}`（pink, `text-decoration:line-through`）/ 「→」/ `{{m.toLabel}}`（`toC:'var(--grn)'`）。`m.bd` は常に `var(--line)`
- **負荷プレビュー**（1757-1768）: 「**適用後の負荷(先頭14日) — {{redistLoadCaption}}**」
  - `redistLoadCaption` = 「**赤い棒は設定上限の超過を示します**」(ignoreLimit) / 「**日ごとの最大負荷を上限として厳守**」
  - 14本のバー、枠 64px、`pct = Math.max(4, Math.min(100, Math.round(ld/mx*100)))+'%'`、`loadH = ld ? (round(ld/6)/10)+'h' : '0'`、ラベル `{{d.label}}{{d.dow}}`
- ボタン: 「**キャンセル**」（`closeRedist` → `{redistOpen:false, redistPlan:null}`）/ `{{redistApplyLabel}}` = 「**配置できる{n}件を適用**」(未配置あり) / 「**この内容で再配分する**」

#### `applyRedist`（HTML:4014-4020）
モーダル表示時の `pv` ではなく **その場で `computePreview` を再実行**。moves が 0 なら閉じてトースト「**再配分できる未完了タスクはありません**」。
適用は `segs` の `day` だけを書き換え（**`manualDay` は付けない**）、`toIso===T` のものを `addToOrder`。
トースト:
```
(plan==='all' ? '全体を' : 'この計画を') + (ignoreLimit ? '上限を無視して均等に' : '上限内で')
+ '再配分しました(' + moves.length + '件' + (unplaced.length ? '・未配置'+unplaced.length+'件' : '') + ')'
```

#### 未完了カウント（`const overdue = S.segs.filter` で再検索）
```js
// (v0.9 変更) overdue から !s.manualDay を外した
overdue       = segs.filter(s => !s.done && s.day < T && P[s.plan] && P[s.plan].due > T);
redistTargets = segs.filter(s => !s.done && (!s.manualDay || S.redistIncludeManual) && P[s.plan] && P[s.plan].due > T);
hasOverdue = overdue.length > 0;  overdueCount = overdue.length;
redistTargetCount = pv ? pv.targets.length : redistTargets.length;
```
> **(v0.9 修正)** 旧実装は `overdue` だけ `manualDay` を除外していたため、トップバー／ナビの「⚠ N件」と計画行の `⚠M`（`p.odCount`、`manualDay` も数える）が食い違っていた。**数える側に揃えた**（手動配置でも遅れていることに変わりはないため）。§11-Q12 は解消済。
> ただし**再配分の対象（`redistTargets`）は従来どおり `manualDay` を除外する**（「手動配置も対象」トグルが ON のときだけ含む）。したがって「⚠ 未完了 N件 → 再配分」を押したあと、実際に再配分で動く件数が N より少ないことはありうる（意図した仕様）。

### 7.9 復習 → テスト計画への変換 `reviewToTest`（HTML:3271-3295）

復習詳細ドロワーの「**テスト計画に変更**」（1642, `var(--vio)` 系）。
```js
pid = 'p'+Date.now().toString(36)+rand;  sid = 's'+…;
due  = /^\d{4}-\d{2}-\d{2}$/.test(rSel.due||'') ? rSel.due : T;
min  = Math.max(5, Number(rSel.min) || 10);
size = min <= 5 ? 'XS' : (min <= 10 ? 'S' : (min <= 20 ? 'M' : 'L'));
day  = due > T ? T : '';
this.PLANS[pid] = { name: rSel.title || 'テスト', type:'test', due, subj: rSel.subj || 'その他',
                    range: rSel.src || '範囲は未設定', timetablePeriod, timetableDate };
seg = { id:sid, plan:pid, title: rSel.title || 'テスト準備', size, min:this.SIZE_MIN[size], day, done:false };
// reviews から当該行を削除 / segs に追加 / order を差し替え / view:'tests' + editorPlan:pid をプリロード
```
トースト「**復習をテスト計画に変更しました**」。`subj` が空なら `'その他'` が `subjOf()` に登録される。

### 7.10 計画関連の既存挙動の注意点

- `segs.length === 0` の計画では `p.dash` / `p.progPct` が `NaN` / `'NaN%'`（SVG の `stroke-dasharray` と進捗バーの `width` に NaN が入る）。`p.progText` は `'0/0 完了'`。§11-Q13
- **`manualDay` を解除する UI は存在しない。** §11-Q14
- `applyRedist` はモーダル表示中に `wkMax` 等が変わっていた場合、再計算結果（表示中のプレビューと違う内容）を適用する。§11-Q15
- Cockpit のカードと Tests の行は**同一オブジェクト**（`ckPlans = plans.map(p => p)`）
- `plan.due` の直接書き換え（GOAL ドラッグ / `savePlanEdit` / `deletePlan`）は `this.PLANS` を破壊的に触るため、Undo は `undoPayload.plans` のスナップショットで戻す
- **GOAL のドラッグ先は `d.iso >= T` のみ許可で上限がない**が、`planTimelineDays` が最大 731 日で打ち切るためそれを超える日へは UI 上ドロップできない

---

## 8. データ画面

### 8.0 まず「存在しないもの」

- **`<canvas>` は 1つも使っていない。** グラフはすべて手書きの inline SVG（円グラフ = `stroke-dasharray` トリック、点数推移 = `<polyline>` + `<circle>` + `<text>`、ヒートマップ = `<rect>` のグリッド）
- **インポート（読み込み）UI は無い。** エクスポートのみ（§8.7）
- **棒グラフは無い**（棒グラフは Tests の日別負荷バーのみ）

> **(v0.9 追加)** 以下は v0.8 まで「存在しない」と書いていたが、**現在は存在する**:
> **期間切替（今週/今月/全期間）**（§8.6）/ **学習ストリーク**（§8.6）/ **日別ヒートマップ**（§8.6）/ **JSON・CSV エクスポート**（§8.7）。
> これに伴い `studyLog` の `day` は「日別集計に使われない」ではなくなった（ストリーク・ヒートマップ・CSV が使う）。ただし**円グラフの集計は期間チップが「全期間」のあいだ従来どおり日付を無視して全部足す**。

ルート（HTML:1237）: `flex:1;overflow:auto;display:grid;grid-template-columns:minmax(320px,2fr) minmax(430px,3fr);gap:16px;padding:18px 20px;align-content:start`

**(v0.9 変更) grid の中身（DOM 順）**:

| # | 要素 | grid 上の位置 |
|---|---|---|
| 1 | 期間チップ + 期間ラベル + ストリークピルの行（§8.6） | `grid-column:1/-1`（全幅） |
| 2 | 左カラムラッパ `display:flex;flex-direction:column;gap:16px;min-width:0;height:fit-content` — 中に「教科別 勉強時間」（§8.1）と「日別の学習量」（§8.6）を縦に積む | 1列目 |
| 3 | 「テスト結果」カード（§8.2） | 2列目 |
| 4 | 「エクスポート」カード（§8.7） | `grid-column:1/-1`（全幅・最下段） |

> `grid-column:1/-1` は幅820px以下の1カラム（`display:flex;flex-direction:column`, C-474）では無視されるだけで、縦積み順は DOM 順のまま。

### 8.1 カード1「教科別 勉強時間」（円グラフ, HTML:1238-1262）

- 見出し行（1239）: ドット `width:8px;height:8px;border-radius:99px;background:var(--acc);box-shadow:var(--gAcc)` / 「**教科別 勉強時間**」（`font:700 14px 'Noto Sans JP'`）/ 右端「**学習ログ+完了タスク**」（`margin-left:auto;font-size:11px;color:var(--tx3)`）
- ドーナツ枠（1241）: `position:relative;width:172px;height:172px;flex:none`
- SVG（1242）: `<svg width="172" height="172" viewBox="0 0 42 42">`
  - 土台円: `<circle cx="21" cy="21" r="15.9" fill="none" stroke="var(--line)" stroke-width="7">`
  - `sc-for pieArcs as a` → `<circle cx="21" cy="21" r="15.9" fill="none" stroke="{{a.c}}" stroke-width="7" stroke-dasharray="{{a.dash}}" stroke-dashoffset="{{a.off}}">`
  - 半径 15.9 → 円周 ≈ 99.9 ≒ 100。dasharray の単位＝パーセントとして扱う。`stroke-dashoffset` の基準 25 で 12時方向スタート
- 中央（1248）: `{{pieTotalH}}`（`font:700 22px 'Space Grotesk';color:var(--tx0);line-height:1`）+ 「**合計**」（`font-size:10px;color:var(--tx3);margin-top:3px`）
- 凡例（1250-1259）: `flex:1;min-width:150px;display:flex;flex-direction:column;gap:7px`。`sc-for pieLegend as l` 各行:
  - 色見本 `width:9px;height:9px;border-radius:3px;background:{{l.c}};flex:none`
  - `{{l.name}}`（`flex:1;font:500 12px 'Noto Sans JP';color:var(--tx1)`）
  - `{{l.h}}`（`font:700 12px 'Space Grotesk';color:var(--tx0)`）
  - `{{l.pct}}`（`font-size:10.5px;color:var(--tx3);width:34px;text-align:right`）
- 脚注（1261）: 「**タスクや復習を完了すると、その分数が自動で加算されます**」

**凡例が0件のときの空状態表示は無い**（ドーナツは土台円だけ、中央は `0h`）。

#### 集計ロジック **(v0.9 変更)**（`const studyEntries = []` で再検索）

集計元は **`studyEntries`（studyLog + 完了 seg + 完了 extra を1本にまとめたリスト）** に整理され、そこへ期間フィルタ（§8.6）が掛かる形になった。**全期間（既定）での合計・並び順・パーセントは v0.8 と完全に一致する。**

```js
// 集計元を1本のリストにまとめる。日付は studyLog=day / 完了seg=day / 完了extra=day で拾う。
// 完了した復習(completedAt)は confirmAsk が同じ分数を studyLog に書いているので、ここでは足さない(二重計上になる)。
const studyEntries = [];
S.studyLog.forEach(e => studyEntries.push({ day: e.day || '', subj: e.subj, min: e.min }));
S.segs.forEach(s => { if (s.done && P[s.plan]) studyEntries.push({ day: s.day || '', subj: P[s.plan].subj, min: s.min }); });
S.extras.forEach(x => { if (x.done) studyEntries.push({ day: x.day || '', subj: x.subj, min: x.min }); });

const pieTotals = {};
studyEntries.forEach(e => { if (inDataRange(e.day)) pieTotals[e.subj] = (pieTotals[e.subj] || 0) + e.min; });
const pieTotal = Object.keys(pieTotals).reduce((a,k) => a + pieTotals[k], 0);
const pieArcs = [], pieLegend = [];
let pieCum = 0;
Object.keys(pieTotals).sort((a,b) => pieTotals[b] - pieTotals[a]).forEach(name => {
  const min = pieTotals[name], pct = pieTotal ? min / pieTotal * 100 : 0;
  const sub = this.subjOf(name);
  pieArcs.push({ c: sub.c, dash: pct.toFixed(2) + ' ' + (100 - pct).toFixed(2), off: (25 - pieCum).toFixed(2) });
  pieLegend.push({ name, c: sub.c, bg: sub.bg, h: toH(min), pct: Math.round(pct) + '%' });
  pieCum += pct;
});
```
**要点**
1. **3つのソース**: `studyLog`（履歴・永続）＋ `segs` の `done===true`（教科は `PLANS[seg.plan].subj`。seg 自身は `subj` を持たない）＋ `extras` の `done===true`（`x.subj`）
   - **(v0.9 変更)** `P[s.plan]` が存在しない孤児 seg は `if (s.done && P[s.plan])` でスキップされる（旧実装は `P[s.plan].subj` で `TypeError` になりうる）。§11-Q36 の防御が円グラフ側にだけ入った形
   - **(v0.9 明示)** 完了した復習は `completedAt` から足し直さない。`confirmAsk` が同じ分数を `studyLog` に書いているので、足すと二重計上になる（§6.2 の副作用）
2. `segs`/`extras` は「今 done であるもの」を**毎回ライブに数える**。チェックを外すと即座に消える。`studyLog` は追記のみで消えない
3. ソートは分数の**降順**。同値のときは `Object.keys` の挿入順に依存
4. `this.subjOf(name)` は**副作用付き**（未知教科なら `this.SUBJ` にパレット色を採番して追加）。`renderVals` 冒頭 2554-2562 が先行登録するのは `PLANS[*].subj` / `segs` / `extras` / `reviews` / `scores` / `addSubj` / `scoreSubj` で、**`studyLog` の subj は対象外** → 「studyLog にしか存在しない教科」はこのループ内で初めて色が採番される
5. `toH(m)` = `(Math.round(m/6)/10) + 'h'`（§4.12）

### 8.2 カード2「テスト結果」（HTML:1263-1290）

- 見出し（1264）: ドット `background:var(--vio);box-shadow:var(--gVio)` / 「**テスト結果**」/ 右端「**クリックで推移を表示**」
- `sc-if scoreGroupsHas` → `sc-for scoreGroups as g`:
  ```
  <div class="score-group-row" onClick="{{ g.onOpen }}"
       style="display:flex;align-items:center;gap:9px;padding:10px 12px;background:var(--bg2);
              border:1px solid var(--line);border-left:3px solid {{ g.c }};border-radius:10px;cursor:pointer"
       style-hover="background:var(--bg3);border-color:var(--line2)">
  ```
  **直下の 6 つの `span` の順序がモバイル grid 配置の前提**:
  1. 教科ピル `font:700 10px 'Noto Sans JP';color:{{g.c}};background:{{g.bg}};border-radius:99px;padding:2px 8px;flex:none` = `{{g.subj}}`
  2. テスト名 `flex:1;min-width:0;font:500 13px 'Noto Sans JP';color:var(--tx0);ellipsis` = `{{g.name}}`
  3. `font-size:10.5px;color:var(--tx3);font-family:'Space Grotesk';flex:none` = `{{g.n}} · 最新 {{g.lastDay}}`
  4. `font:700 11px 'Space Grotesk';color:{{g.deltaC}};flex:none` = `{{g.delta}}`
  5. `font:700 16px 'Space Grotesk';color:{{g.c}};flex:none` = `{{g.latest}}<span style="font-size:10px">点</span>`
  6. `color:var(--tx3);font-size:12px;flex:none` = `→`
- `sc-if scoreGroupsNone` → 「**まだ記録がありません。返却されたテストの点数を下から記録しましょう**」（`font-size:11.5px;color:var(--tx3);padding:6px 2px`）
- 入力行（1280、**常に表示**）: `display:flex;gap:8px;flex-wrap:wrap;align-items:center;border-top:1px solid var(--line);padding-top:12px`
  1. `<input list="compass-score-names" value="{{scoreName}}" onChange="{{onScoreName}}" placeholder="テスト名" style="flex:2;min-width:150px;padding:9px 11px;border:1px solid var(--line2);border-radius:9px;background:var(--bg2);color:var(--tx0);font:500 12.5px 'Noto Sans JP';outline:none" style-focus="border-color:var(--acc)">`
  2. `<datalist id="compass-score-names">` ← `{{scoreNameOptions}}` の `{{o.name}}`
  3. `<input list="compass-subj-list2" value="{{scoreSubj}}" onChange="{{onScoreSubj}}" placeholder="教科" style="flex:1;min-width:90px;…">`
  4. `<datalist id="compass-subj-list2">` ← `{{addSubjOptions}}`（**Add 画面と共有・`recentSubjs` 優先の並び**、3374-3376）
  5. `<input type="number" min="0" max="100" value="{{scoreVal}}" onChange="{{onScoreVal}}" placeholder="点数" style="width:78px;…font:500 12.5px 'Space Grotesk';…">`
  6. `<input type="date" value="{{scoreDay}}" max="{{addDayMin}}" onChange="{{onScoreDay}}" style="width:150px;padding:8px 10px;…font:500 12px 'Space Grotesk';…;color-scheme:{{schemeVal}}">` — `addDayMin = T`（**今日より未来は選べない**）
  7. `<button onClick="{{addScore}}" style="padding:9px 16px;border:none;border-radius:9px;background:var(--grad);color:var(--onAcc);font:700 12px 'Noto Sans JP';cursor:pointer;white-space:nowrap;flex:none">＋ 記録</button>`
- 脚注（1289）: 「**テスト名はTestsで作った計画から選べます · 同じテスト名で記録すると推移がつながります**」

#### グループ化（HTML:3312-3329）
```js
const scoreSorted = S.scores.slice().sort((a, b) => a.day < b.day ? -1 : 1);   // 日付昇順（同日で 1 を返す非対称比較子）
const scGroupMap = {};
scoreSorted.forEach(sc => { (scGroupMap[sc.name] = scGroupMap[sc.name] || []).push(sc); });   // キーは name のみ（教科は無視）
const scoreGroups = Object.keys(scGroupMap).map(name => {
  const arr = scGroupMap[name], last = arr[arr.length-1];
  const prev = arr.length > 1 ? arr[arr.length-2] : null;
  const dv = prev ? last.score - prev.score : null;
  const sub = this.subjOf(last.subj);      // ★ 色は「最新レコードの教科」
  return { name, subj:last.subj, c:sub.c, bg:sub.bg,
    n: arr.length + '回', latest: last.score, lastDay: this.fmtMD(last.day),
    delta: dv == null ? '–' : (dv > 0 ? '▲ +' + dv : (dv < 0 ? '▼ ' + dv : '± 0')),
    deltaC: dv == null ? 'var(--tx3)' : (dv > 0 ? 'var(--grn)' : (dv < 0 ? 'var(--pink)' : 'var(--tx3)')),
    _day: last.day,
    onOpen: () => this.setState({ scoreSel: name }) };
}).sort((a, b) => a._day < b._day ? 1 : -1);    // 最新テストが上
```
`scoreGroupsHas: scoreGroups.length > 0` / `scoreGroupsNone: scoreGroups.length === 0`（4133）。`_day` は未使用のままテンプレートに渡る。

#### `scoreNameOptions`（HTML:3356-3358）
```js
planIds.forEach(pid => { if (P[pid].type === 'test' && scoreNameOptions.indexOf(P[pid].name) < 0) scoreNameOptions.push(P[pid].name); });
S.scores.forEach(sc => { if (scoreNameOptions.indexOf(sc.name) < 0) scoreNameOptions.push(sc.name); });
```
`planIds` は**アクティブな計画のみ**（期限切れかつ全完了は除外）、`planOrder` の並び順。

#### ハンドラ
```js
onScoreName: (e) => {                                            // 4147-4151
  const v = e.target.value;
  const pl = planIds.map(id => P[id]).find(p => p.name === v);    // 種類は問わない（prep でも一致すれば拾う）
  this.setState(s => ({ scoreName: v, scoreSubj: pl ? pl.subj : s.scoreSubj }));
},
onScoreSubj / onScoreVal / onScoreDay: 値をそのまま state へ
```
`addScore` は §4.7。**Enter キーのハンドラは無い**（ボタンのみ）。

### 8.3 点数推移ドロワー（`scOpen`, HTML:1649-1694 / 3330-3355, 4134-4145）

```js
const scArr  = S.scoreSel ? (scGroupMap[S.scoreSel] || []) : [];
const scOpen = scArr.length > 0;              // ★ 開閉の唯一の条件
const scSub  = scOpen ? this.subjOf(scArr[scArr.length-1].subj) : null;
const scLast = scOpen ? scArr[scArr.length-1] : null;
const scPrev = scArr.length > 1 ? scArr[scArr.length-2] : null;
const scDv   = scPrev && scLast ? scLast.score - scPrev.score : null;
```

- 幅 `scW = S.panelW.score + 'px'`（既定 400、`max-width:94vw`）、`scResize = this.resizer('score','left')`
- ヘッダ（1654-1658）: 教科ピル `{{scSubj}}`（`color:{{scSubjC}};background:{{scSubjBg}};font:700 11px 'Noto Sans JP';border-radius:99px;padding:3px 10px;flex:none`）/ テスト名 `{{scName}}`（`flex:1;min-width:0;font:700 14px 'Noto Sans JP';ellipsis`）/ 「✕」（26×26, `border:1px solid var(--line2);border-radius:7px`）
- 統計タイル4列（1659-1664、`grid-template-columns:1fr 1fr 1fr 1fr;gap:8px`、各 `background:var(--bg2);border-radius:10px;padding:9px 10px`、ラベル `font-size:10px;color:var(--tx3)`）:
  1. 「**最新**」→ `{{scLatest}}`（`font:700 16px 'Space Grotesk';color:{{scSubjC}};margin-top:2px`）+ `<span style="font-size:10px">点</span>`
  2. 「**前回比**」→ `{{scDelta}}`（`font:700 15px 'Space Grotesk';color:{{scDeltaC}};margin-top:3px`）— `scDv == null ? '–' : (scDv>0 ? '▲ +'+scDv : (scDv<0 ? '▼ '+scDv : '± 0'))`
  3. 「**最高**」→ `{{scBest}}点` — `scArr.length ? Math.max.apply(null, scArr.map(x=>x.score)) : 0`
  4. 「**平均**」→ `{{scAvg}}点` — `scArr.length ? Math.round(scArr.reduce((a,b)=>a+b.score,0)/scArr.length) : 0`
- **折れ線グラフ**（1665-1680）:
  ```
  <div style="background:var(--bg2);border-radius:12px;padding:12px 8px 6px">
    <svg viewBox="0 0 360 200" style="width:100%;height:auto">
      <line x1="30" y1="14"  x2="338" y2="14"  stroke="var(--line)" stroke-width="1">   <!-- 100 -->
      <line x1="30" y1="92"  x2="338" y2="92"  stroke="var(--line)" stroke-width="1">   <!--  50 -->
      <line x1="30" y1="170" x2="338" y2="170" stroke="var(--line)" stroke-width="1">   <!--   0 -->
      <text x="24" y="18"  text-anchor="end" style="font:10px 'Space Grotesk';fill:var(--tx3)">100</text>
      <text x="24" y="96"  …>50</text>
      <text x="24" y="174" …>0</text>
      <polyline points="{{ scPts }}" fill="none" stroke="{{ scSubjC }}" stroke-width="2"></polyline>
      <sc-for list="{{ scDots }}" as="d">
        <circle cx="{{d.cx}}" cy="{{d.cy}}" r="3.5" fill="{{ scSubjC }}"></circle>
        <text x="{{d.cx}}" y="{{d.labelY}}" text-anchor="middle" style="font:700 10px 'Space Grotesk';fill:{{ scSubjC }}">{{ d.label }}</text>
        <text x="{{d.cx}}" y="188" text-anchor="middle" style="font:9px 'Space Grotesk';fill:var(--tx3)">{{ d.dayLabel }}</text>
      </sc-for>
    </svg>
  </div>
  ```
  座標変換（3334-3342）:
  ```js
  const scMinD = scOpen ? this.daysUntil(scArr[0].day) : 0;
  const scMaxD = scOpen ? this.daysUntil(scArr[scArr.length-1].day) : 0;
  const scX = (d) => (scMaxD === scMinD ? 184 : 30 + (d - scMinD) / (scMaxD - scMinD) * 308);
  const scY = (v) => 14 + (100 - v) / 100 * 156;
  scPts  = scArr.map(sc => scX(daysUntil(sc.day)).toFixed(1) + ',' + scY(sc.score).toFixed(1)).join(' ');
  scDots = scArr.map(sc => ({ cx, cy, label: sc.score, labelY: (scY(sc.score) - 8).toFixed(1), dayLabel: this.fmtMD(sc.day) }));
  ```
  **X 軸は日付の実距離に比例**（等間隔ではない）。全レコードが同日なら全点が `x=184` に重なる。点が1つでも `<polyline>` は出る（線は描画されない）。
- 説明（1681）: 「**記録の履歴 — 同じテスト名で追加すると、ここにつながります**」
- 履歴リスト（1682-1691、`flex:1;overflow:auto;gap:5px`）。`scRows = scScoreRows`（3346-3355）:
  ```js
  scArr.slice().reverse().map((sc, i, all) => {
    const before = all[i+1];                     // reverse 後なので「1つ古い記録」
    const d2 = before ? sc.score - before.score : null;
    return { dayLabel: this.fmtMD(sc.day) + (sc.day === T ? '(今日)' : ''),
             score: sc.score,
             delta: d2 == null ? '' : (d2 > 0 ? '+' + d2 : String(d2)),
             deltaC: d2 == null ? 'var(--tx3)' : (d2 > 0 ? 'var(--grn)' : (d2 < 0 ? 'var(--pink)' : 'var(--tx3)')),
             onRemove: () => this.setState(s => ({ scores: s.scores.filter(x => x.id !== sc.id) })) };
  })
  ```
  各行 `display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg2);border:1px solid var(--line);border-radius:8px`:
  `{{r.dayLabel}}`（`flex:1;font-size:11.5px;color:var(--tx2);font-family:'Space Grotesk'`）/ `{{r.delta}}`（`font:700 10.5px 'Space Grotesk';color:{{r.deltaC}}`）/ `{{r.score}}`（`font:700 14px 'Space Grotesk';color:var(--tx0)`）+ `<span style="font-size:9px">点</span>` / 「✕」（20×20, `style-hover="color:var(--pink);background:var(--pinkBg)"`）

**閉じ方（4通り）**: オーバーレイ or ✕ → `closeSc`（`scoreSel:null`）/ `Escape` / 表示中グループの最後の1件を ✕ で消す（`scArr` が空 → `scOpen=false`。`scoreSel` は残るが無害）/ `Cmd/Ctrl+Z`（`scoreSel:null` にリセットされる）。

### 8.4 データ画面が触る state

| キー | 初期値 | persist | undo |
|---|---|---|---|
| `studyLog` | `[]` | ✔ | ✔ |
| `scores` | `[]` | ✔ | ✔ |
| `scoreName` | `''` | ✖ | ✖ |
| `scoreSubj` | `''` | ✖ | ✖ |
| `scoreVal` | `''` | ✖ | ✖ |
| `scoreDay` | `this.TODAY` | ✖ | ✖ |
| `scoreSel` | `null` | ✖ | ✖ |
| `dataRange` **(v0.9 追加)** | `'all'` | ✖ | ✖ |
| `panelW.score` | `400` | ✔（`panelW` 経由 + localStorage） | ✖ |

読み取りのみ: `segs`, `extras`, `PLANS`, `theme`（`schemeVal`）, `view`。

> **(v0.9) `dataRange` は意図的に非永続**。`persistentKeys()` は **23キーのまま**で `dataRange` を含まないため、期間チップを切り替えても `exportData()` の JSON は変化せず、**クラウド PUT も localStorage 書き込みも発生しない**（§4.14 の JSON 差分トリガ）。リロードすると「全期間」に戻る。

### 8.5 データ画面の挙動上の注意点

1. **`studyLog` は削除不能・上限なし**。UI から個別エントリを見る手段も消す手段もない（**(v0.9 追加)** ただし §8.7 のエクスポートで中身を書き出せるようにはなった）
2. **同じ勉強時間が二重計上されない設計**: `segs`/`extras` は done のときライブ集計、`studyLog` は「元データが消えるとき」だけ移送。**(v0.9 修正)** 通常削除経路でも完了 seg が `studyLog` へ移されるようになったため（§7.6）、**未完了を含む計画を削除しても完了分は失われない**
3. `confirmAsk` が記録する分数は**復習の元の `min`**（モーダルで選び直したサイズではない）
4. `scoreSorted` の比較子は同値で `1` を返す非対称比較子 → **同日に複数記録すると並びが挿入順の逆になりうる**（`latest` / `前回比` / 折れ線の点順に影響）
5. `scoreGroups` のキーは `name` **のみ**。異なる教科で同じテスト名を記録すると 1 グループにまとまり、**色と教科ピルは最新レコードの教科**になる
6. 折れ線の X 軸は日付距離に比例 → **同日に複数記録すると全点が `x=184` に重なる**
7. `scoreDay` は非永続なのでリロードで今日に戻る
8. `pieArcs` は `pct.toFixed(2)` なので極小の教科でもわずかな弧が描かれる（0% にはならない）
9. `subjOf` の副作用が `renderVals` の中（＝レンダー中）で起きる。**React StrictMode の二重呼び出しで教科色の採番が変わりうる**
10. **(v0.9)** 期間チップ・ストリーク・ヒートマップ・エクスポートはすべて既存データからの**導出のみ**で、保存する state を1つも増やしていない（`dataRange` も非永続）

### 8.6 期間切替 / 学習ストリーク / 日別ヒートマップ **(v0.9 追加)**

#### 8.6.1 ヘッダ行（`grid-column:1/-1`）

```html
<div style="grid-column:1/-1;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
  <div style="display:flex;background:var(--bg1);border:1px solid var(--line);border-radius:99px;padding:2px">
    <sc-for list="{{ dataRangeChips }}" as="m" hint-placeholder-count="3">
      <span onClick="{{ m.onPick }}"
        style="font:700 11px 'Noto Sans JP';color:{{ m.c }};background:{{ m.bg }};
               border-radius:99px;padding:6px 15px;cursor:pointer;white-space:nowrap">{{ m.label }}</span>
    </sc-for>
  </div>
  <span style="font-size:10.5px;color:var(--tx3);font-family:'Space Grotesk'">{{ dataRangeNote }}</span>
  <span style="margin-left:auto;padding:6px 14px;background:var(--bg1);border:1px solid {{ streakBd }};
               border-radius:99px;font:700 12px 'Noto Sans JP';color:{{ streakC }};white-space:nowrap">{{ streakLabel }}</span>
</div>
```

#### 8.6.2 期間切替（`dataRange`）

```js
// 週は月曜始まり(復習の消化率と同じ数え方)
const dataWeekStart = this.isoShift(T, -((new Date(T + 'T00:00:00Z').getUTCDay() + 6) % 7));
const dataWeekEnd   = this.isoShift(dataWeekStart, 6);
const dataRange = (S.dataRange === 'week' || S.dataRange === 'month') ? S.dataRange : 'all';
// 日付を持たないもの(未配分のまま完了した単発タスクなど)は「全期間」でだけ数える
const inDataRange = (day) => {
  if (dataRange === 'all') return true;
  if (!day) return false;
  if (dataRange === 'month') return day.slice(0, 7) === T.slice(0, 7);
  return day >= dataWeekStart && day <= dataWeekEnd;
};
const dataRangeChips = [ {id:'week',label:'今週'}, {id:'month',label:'今月'}, {id:'all',label:'全期間'} ].map(mode => ({
  label: mode.label,
  c:  dataRange === mode.id ? 'var(--onAcc)' : 'var(--tx2)',
  bg: dataRange === mode.id ? 'var(--acc)'   : 'transparent',
  onPick: () => this.setState({ dataRange: mode.id })
}));
const dataRangeNote = dataRange === 'week'  ? (this.fmtMD(dataWeekStart) + ' 〜 ' + this.fmtMD(dataWeekEnd))
                    : dataRange === 'month' ? (parseInt(T.slice(5, 7), 10) + '月')
                    : 'すべての記録';
```

- チップは左から **今週 / 今月 / 全期間**。既定は `'all'`（初回表示は v0.8 と同一）。未知の値は `'all'` に丸める
- 週の判定は **月曜始まり**で、復習の週次消化率（§6.4）と同じ `-(getUTCDay()+6)%7` 式。ただし消化率は「月曜〜**今日**」、こちらは「月曜〜**日曜**」の7日枠
- 月の判定は `day.slice(0,7) === T.slice(0,7)`（文字列前方一致）。「直近30日」ではなく**暦月**
- **`day` が空文字のエントリ（未配分のまま完了した単発タスク、`day` を持たない studyLog）は 今週/今月 では数えない**
- **期間フィルタが掛かるのは円グラフと凡例だけ。** ストリーク・ヒートマップ・エクスポートは常に全期間

#### 8.6.3 学習ストリーク

```js
const dayMin = {};
studyEntries.forEach(e => { if (e.day) dayMin[e.day] = (dayMin[e.day] || 0) + (Number(e.min) || 0); });
// 今日がまだ0分でも昨日までの連続は途切れていない扱いにする
let streakDays = 0, streakCursor = dayMin[T] > 0 ? T : this.isoShift(T, -1);
while (streakDays < 3650 && dayMin[streakCursor] > 0) { streakDays++; streakCursor = this.isoShift(streakCursor, -1); }
// renderVals
streakLabel: streakDays > 0 ? ('🔥 連続' + streakDays + '日') : 'まだ連続記録はありません'
streakC:     streakDays > 0 ? 'var(--org)' : 'var(--tx3)'
streakBd:    streakDays > 0 ? 'color-mix(in srgb, var(--org) 40%, var(--line))' : 'var(--line)'
```

- 「その日に1分以上やったか」だけを見る（教科・種別は無関係）
- **今日が0分でも昨日までの連続は生きている**（起点が `dayMin[T] > 0 ? T : 昨日`）。今日やれば当日ぶんも含まれる
- ループ上限 3650 日（無限ループ防止）
- 記録が無ければ「**まだ連続記録はありません**」（`--tx3`、枠は `--line`）

#### 8.6.4 日別ヒートマップ「日別の学習量」

カード見出し: ドット `background:var(--org);box-shadow:none` /「**日別の学習量**」/ 右端「**直近15週**」。

```js
const HEAT_WEEKS = 15, HEAT_CELL = 12, HEAT_PITCH = 15, HEAT_PAD = 18, HEAT_TOP = 12;
const heatFill = (m, future) => {
  if (future)  return 'color-mix(in srgb, var(--tx3) 6%, transparent)';
  if (!m)      return 'color-mix(in srgb, var(--tx3) 14%, transparent)';
  if (m < 30)  return 'color-mix(in srgb, var(--acc) 22%, var(--bg2))';
  if (m < 60)  return 'color-mix(in srgb, var(--acc) 45%, var(--bg2))';
  if (m < 120) return 'color-mix(in srgb, var(--acc) 70%, var(--bg2))';
  return 'var(--acc)';
};
// SVG の <text>/<title> の中では {{ }} が <span> に包まれて描画されないため、
// 配列で渡してランタイムに素のテキストノードとして展開させる(support.js の walkText)。
const svgText = (s) => [s];
for (let w = 0; w < HEAT_WEEKS; w++) {
  const colX = HEAT_PAD + w * HEAT_PITCH;
  const colMon = this.isoShift(dataWeekStart, (w - (HEAT_WEEKS - 1)) * 7);   // 右端の列が「今週」
  // 月の最初の月曜だけに月ラベルを置く(ラベル同士が必ず4列以上離れる)
  if (parseInt(colMon.slice(8, 10), 10) <= 7) heatMonths.push({ x: colX, label: svgText(parseInt(colMon.slice(5,7),10) + '月') });
  for (let d = 0; d < 7; d++) {
    const iso = this.isoShift(colMon, d), future = iso > T, m = dayMin[iso] || 0;
    heatCells.push({ x: colX, y: HEAT_TOP + d * HEAT_PITCH, fill: heatFill(m, future),
                     tip: svgText(future ? this.fmtMD(iso) : (this.fmtMD(iso) + ' · ' + m + '分')) });
  }
}
const heatDows = [ {i:0,label:'月'}, {i:2,label:'水'}, {i:4,label:'金'} ]
  .map(r => ({ y: HEAT_TOP + r.i * HEAT_PITCH + HEAT_CELL - 3, label: svgText(r.label) }));
const heatLegend = [0, 20, 45, 90, 150].map(m => ({ fill: heatFill(m, false) }));
heatVB = '0 0 ' + (HEAT_PAD + HEAT_WEEKS*HEAT_PITCH - (HEAT_PITCH - HEAT_CELL))
       + ' ' + (HEAT_TOP + 7*HEAT_PITCH - (HEAT_PITCH - HEAT_CELL));   // = "0 0 240 114"
```

- `<svg viewBox="{{ heatVB }}" style="width:100%;max-width:520px;height:auto">`
- マスは `<rect width="12" height="12" rx="3" fill="{{ c.fill }}"><title>{{ c.tip }}</title></rect>` の **15列×7行 = 105個**。列＝週（左が最も古い / 右端が今週）、行＝**月曜が上・日曜が下**
- ツールチップはブラウザ標準の `<title>`（**JS ハンドラは0個**。`.tooltip`（§3.11）とは別系統）。文言は「`{M/D} · {N}分`」、未来日は「`{M/D}`」だけ
- 月ラベルは「その列の月曜の日が 1〜7 日」の列にだけ `y=8` で「`{N}月`」（700 7.5px 'Space Grotesk', `fill:var(--tx3)`）
- 行ラベルは 月 / 水 / 金 の3つだけ（`x=0`, 8px 'Noto Sans JP', `fill:var(--tx3)`）
- 凡例行: 「**少**」+ 5段の 11×11 色見本（`heatLegend` = 0/20/45/90/150 分の色）+「**多**」+ 右寄せ「**マスにカーソルを合わせるとその日の分数が出ます**」
- 濃さのしきい値は**絶対値**（0 / 1–29 / 30–59 / 60–119 / 120分以上）。ユーザーごとの相対値ではない
- 色はすべて `color-mix(… var(--acc) …, var(--bg2))` なので **note / dark / light の3テーマとも成立する**

> **`svgText = (s) => [s]` は必須の回避策**: support.js の `walkText` は配列を「素のテキストノードの列」として描画するが、文字列の `{{ }}` は `<span class="sc-interp">` に包む（C-508）。SVG の `<text>` / `<title>` の中に `<span>` を入れると描画されないため、SVG 内のテキストだけ配列で渡す。点数推移グラフのラベルが見えないのと同じ既存の癖（§3.12）。

### 8.7 エクスポート **(v0.9 追加)**

データ画面の最下段、`grid-column:1/-1` の全幅カード。見出し: ドット `background:var(--tx3);box-shadow:none` /「**エクスポート**」/ 右端「**全期間・全件**」。ボタン2つ（`padding:9px 16px;border:1px solid var(--line2);border-radius:9px;background:var(--bg2);color:var(--tx1);font:700 12px 'Noto Sans JP'`、`style-hover="border-color:var(--acc);color:var(--acc)"`）。脚注「**機種変更やバックアップに。読み込みは未対応です**」。

#### 8.7.1 共通ヘルパ `downloadText(filename, mime, text)`（クラスメソッド、`showToast` の直後）

```js
downloadText(filename, mime, text) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch (e) { return false; }
}
```
新しい API もサーバも使わない。**失敗しても throw せず false を返す**（呼び出し側がトーストを出し分ける）。

#### 8.7.2 JSON（`exportJson`）

```js
const expStamp = T.replace(/-/g, '');    // 'YYYYMMDD'
const ok = this.downloadText('compass-backup-' + expStamp + '.json', 'application/json',
                             JSON.stringify(this.exportData(), null, 2));
this.showToast(ok ? 'JSONを書き出しました' : '書き出しに失敗しました');
```
中身は **`exportData()` の戻り値そのまま** = `{version:1, plans:{…}, state:{persistentKeys の23キー}}`（§4.2）。**クラウド / localStorage に保存しているペイロードと完全に同形**なので、そのまま退避できる。インデントは2スペース。

#### 8.7.3 CSV（`exportCsv`）

`compass-study-YYYYMMDD.csv`。**1ファイルに2つの表**を空行で区切って入れる。

```
学習ログ
date,subject,minutes
2026-08-01,数学,20
…
                       ← 空行
テスト結果
date,test,subject,score
2026-07-10,"期末考査, 前期",英語,88
```

```js
const csvCell = (v) => {
  const s = (v == null) ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;      // RFC4180
};
const csvRow = (cells) => cells.map(csvCell).join(',');
// 日付なし(未配分のまま完了した単発タスクなど)は末尾へ寄せる
const csvByDay = (a, b) => { const x = a.day || '9999-99-99', y = b.day || '9999-99-99';
                             return x < y ? -1 : (x > y ? 1 : 0); };
const lines = ['学習ログ', csvRow(['date','subject','minutes'])];
studyEntries.slice().sort(csvByDay).forEach(e => lines.push(csvRow([e.day, e.subj, e.min])));
lines.push('');
lines.push('テスト結果', csvRow(['date','test','subject','score']));
scoreSorted.forEach(sc => lines.push(csvRow([sc.day, sc.name, sc.subj, sc.score])));
// Excel が UTF-8 と判定できるように BOM を先頭に付ける
const ok = this.downloadText('compass-study-' + expStamp + '.csv', 'text/csv;charset=utf-8',
                             '﻿' + lines.join('\r\n') + '\r\n');
this.showToast(ok ? 'CSVを書き出しました' : '書き出しに失敗しました');
```

- 学習ログの集計元は **円グラフと同じ `studyEntries`**（studyLog + 完了 seg + 完了 extra）。**期間チップの絞り込みは掛からない**（常に全期間）
- テスト結果は `scoreSorted`（`scores` を `day` 昇順にした配列、§8.2）をそのまま
- 先頭に **BOM (`﻿`)**、改行は **CRLF**、末尾にも改行
- 値に `"` `,` CR LF を含むときだけ RFC4180 の引用（`"` は二重化）
- **どちらのボタンも state を一切変更しない**（`toast` のみ）ので、保存 PUT は発火しない
- インポートは未実装。復元は JSON を Firestore / localStorage へ手で戻す運用

---

## 9. support.js の役割

### 9.1 モジュール構成（1つの IIFE。冒頭コメント `SUP:1`「GENERATED from dc-runtime/src/*.ts — do not edit.」）

| モジュール | 行 | 主な内容 |
|---|---|---|
| `src/react.ts` | 9-19 | `getReact()`（`window.React` が無ければ throw `dc-runtime: window.React is not available yet`）、`getReactDOM()`、`h()` |
| `src/parse.ts` | 24-84 | `parseDcDocument` / `parseDcText`（`/<x-dc(?:\s[^>]*)?>/` + `lastIndexOf('</x-dc>')`）/ `parseDataProps`（`$` 始まりキーを除外、`$preview` は別枠）/ `dcNameFromPath` |
| `src/boot.ts` | 86-198 | `BASE_CSS`(86) / `FULL_PAGE_CSS`(132) / `rootNameForDocument`(133) / `safeDecode`(143) / `boot`(150) |
| `src/expr.ts` | 203-293 | `resolve` / `parensWrapWhole` / `findTopLevelEquality` / `resolvePath` |
| `src/encode.ts` | 295-388 | `CAMEL_ATTR` / `INLINE_TEXT_TAGS` / `RAW_WRAP` / `EVENT_MAP` / `encodeCase` / `cssToObj` / `compileAttr` |
| `src/compile.ts` | 390-720 | `collectProps` / `compileTemplate` / `walkChildren` / `walkText` / `walkFor` / `walkIf` / `walkElement` / `contentKey` |
| `src/logic.ts` | 722-757 | `StreamableLogic`（= `DCLogic`）/ `evalDcLogic` |
| `src/component.ts` | 759-1039 | `shallowEqual` / `Placeholder` / `createComponentFactory` / `StreamableComponent`（エラーバウンダリ）/ `getDC` |
| `src/external.ts` | 1041-1235 | `<x-import>` / `<dc-import>` 用。**Compass は 1つも使っていない → Babel もロードされない** |
| `src/atomics.ts` | 1237-1240 | `ATOMIC_CSS`。**Compass はこのクラスを 1つも使っていない** |
| `src/helmet.ts` | 1243-1355 | `createHelmetManager` / `setDesignDocMode` |
| `src/pseudo.ts` | 1357-1375 | `createPseudoSheet` |
| `src/registry.ts` | 1378-1406 | `createRegistry` |
| `src/runtime.ts` | 1408-1572 | `createRuntime` / `ensureFetched` / `updateHtml` / `updateJs` / `adoptParsed` |
| 起動 | 1574-1663 | `loadReactUmd` / `hideRawTemplate` / `init` / `window` API |

### 9.2 メイン HTML が実際に使っている機能（完全リスト）

1. **`DCLogic`**（`class Component extends DCLogic`, HTML:1953）= `StreamableLogic`
2. `this.setState(patch|updater, cb)` — 数百箇所
3. `this.state` / `this.props`（`props.glow` 2580, `props.radius` 2581, `props.accent` 2582）
4. ライフサイクル override: `componentDidMount()` 2051 / `componentWillUnmount()` 2110 / `componentDidUpdate()` 2368
5. `renderVals()` 2550 — 返したオブジェクトが `{...userProps, ...renderVals()}` としてテンプレートの `{{ }}` 名前空間になる（`SUP:934`）
6. テンプレート機能: `<x-dc>` / `<helmet data-dc-atomics>` / `<sc-for list as hint-placeholder-count>` / `<sc-if value hint-placeholder-val>` / `{{ }}`（属性・テキスト）/ `style-hover` / `style-focus` / キャメルケースのイベント属性
7. `<script type="text/x-dc" data-dc-script data-props="…">` の `data-props`

**使っていない**: `forceUpdate` / `<x-import>` / `<dc-import>` / `__dc*` API 全部 / `getDC` / atomics クラス / `RAW_WRAP` 対象タグ（select/table 系）/ `hint-size` / `<meta name="design_doc_mode">`。

イベント属性のマッピング（`EVENT_MAP`, `SUP:315`）:
`onclick→onClick` / `onchange→onChange` / `oninput` / `onsubmit` / `onkeydown` / `onkeyup` / `onkeypress` / `onmousedown` / `onmouseup` / `onmouseenter` / `onmouseleave` / `onfocus` / `onblur` / `ondoubleclick→onDoubleClick` / `oncontextmenu` / `ondragstart` / `ondragover` / `ondragend` / `ondragenter` / `ondragleave` / `ondrop`。
**`onTouchEnd` は `EVENT_MAP` に無い**が、`key.startsWith('on')` の fallback（`SUP:413-414`）+ `sc-camel-` 復元で `onTouchEnd` になる（復習詳細・ミニタスク名編集で使用）。

### 9.3 React 移植で「副作用として再現が要る」もの

1. **`{{ }}` テキストは `<span class="sc-interp">` に包まれる**（`SUP:518`）。flex レイアウトと `:nth-child` に影響。
   影響箇所の例: Data の円グラフ中央 `{{pieTotalH}}`、凡例の3値、`{{g.n}} · 最新 {{g.lastDay}}`、`{{g.latest}}` + `点`、統計タイル4種、履歴行の3値、モバイル CSS が `>span:nth-child(n)` を使う `.review-table-row` / `.score-group-row`。
   **React 移植で素のテキストノードにすると子要素インデックスがずれる可能性があるため、実 DOM でのインデックス確認が必須。**
2. 改行だけの空白テキストノードは削除されるが、インデント（スペース入り）の空白は残る（`SUP:483`）
3. `value` / `checked` が `undefined` のとき `''` / `false` に落ちる → 常に controlled input（`SUP:709-711`）
4. `style` 文字列は `cssToObj` でオブジェクト化され、`--*` はカスタムプロパティとしてそのまま
5. `setState` の**同期反映**セマンティクス（§1.4）
6. `componentDidUpdate` が**毎レンダー**呼ばれる（保存・Undo スナップショットのトリガ）
7. `sc-for` の React key は**配列 index**
8. head に `BASE_CSS`（特に `@media print`）と `ATOMIC_CSS` が入る
9. React/ReactDOM は unpkg 由来（移植後は不要）
10. `style-hover` / `style-focus` は `!important` なし・詳細度 1 クラス（§3.9）

### 9.4 `{{ }}` 式評価の制限（`SUP:203-293`）

`resolve(vals, src)` がサポートするのは:
- 括弧で全体を包んだ式
- トップレベルの `===` / `!==` / `==` / `!=`
- 先頭 `!` の否定
- リテラル `true` / `false` / `null` / `undefined` / 数値（`/^-?\d+(\.\d+)?$/`）/ クォート文字列
- それ以外は `resolvePath` で `a.b[0].c` 形式のパス解決（`[...]` の中も再帰 resolve）

**関数呼び出し・算術演算子・三項・論理演算は非対応。** Compass テンプレートは単純な識別子とドットパス、`{{ false }}` / `{{ true }}`（hint 用）しか使っていない。

`compileAttr`（`SUP:376`）: 属性値が `{{ … }}` **だけ**なら `resolve` の生値（関数・オブジェクト・boolean をそのまま渡せる）、混在なら文字列連結（`?? ''`）、`{{` 無しなら定数。

### 9.5 `window` に生やされる API（`SUP:1626-1657`）

```
window.__dcUpdate(name, kind, content, streaming)
window.__dcSetProps(name, overrides)
window.__dcRootName()
window.__dcAnnotatedTemplate(name)
window.__dcTemplateSource(name)
window.__dcBoot()
window.__dcRegistry            // registry.entries（生オブジェクト）
window.getDC(name)
window.DCLogic                 // = StreamableLogic
window.StreamableLogic
window.__dcContentKeyed = true
```
加えて React/ReactDOM の UMD が `window.React` / `window.ReactDOM` を作る。

### 9.6 生成される DOM の外殻

```
<div id="dc-root">
  <div class="sc-host" data-sc-name="{rootName}" data-dc-tpl=undefined>
    … テンプレートのトップレベル要素群 …
  </div>
</div>
```
`compileTemplate`（`SUP:442`）が**全要素に `data-dc-tpl="連番"` を付与**する。
`renderVals()` が throw すると赤い `.sc-logic-error` バナー（`data-omelette-chrome=""`）を重ねて表示（`SUP:833-836`）。

### 9.7 helmet の挙動（`SUP:1246-1355`）

- `<helmet>` の子を種類別に head へ:
  - `SCRIPT`: `"SCRIPT|" + src|textContent` をキーに 1 回だけ append
  - `LINK` / `META`: `tag + "|" + href|src|outerHTML` をキーに 1 回だけ `cloneNode(true)` して append
  - **それ以外（＝Compass の巨大な `<style>`）**: `live` Map（キー `name + "|" + index`）で保持し、同じ要素の属性・textContent を**差分更新**（再作成しない）
- `window.addEventListener("message")`（`SUP:1287`）: `__dc_theme`（light/dark を `documentElement.dataset.theme` に反映）と `__dc_probe` を処理。**Compass はこのメッセージを使わない**（Compass の CSS は `.compass-theme-mode[data-theme]` を見るので影響なし）
- `<meta name="design_doc_mode">` が無いので `data-dc-canvas` は付かない

---

## 10. パリティチェックリスト

> 全 reader の parity 項目を重複統合し、画面別に番号を振ったもの。番号（C-1, C-2, …）は**固定**であり、書き換えの受け入れチェックリストとして使う。

### 10.1 起動・スプラッシュ・クラウド接続

- **C-1** アプリを開くと `.compass-splash` が全画面（`position:fixed;inset:0;z-index:9999`）で表示され、`pointer-events:none` で背後を触れない
- **C-2** スプラッシュは `.compass-splash__glow` → 製図SVG(`.compass-splash__build`) → 完成マークSVG(`.compass-splash__mark`) → ロゴタイプ(C O M P A S S) → 「ToDo」の順に、約2.75秒かけて組み上がる
- **C-3** 0.04s に横の製図ガイド線、0.12s に縦のガイド線が伸びる（`spGuideH`/`spGuideV` 1.55s）
- **C-4** 0.10s に外周の破線ガイドリング（r=231）が回りながら現れる（`spGuideRing` 1.6s）
- **C-5** 0.16s に太い下書きリム（sw 34）、0.24s に細いインクリム（sw 23）が `stroke-dashoffset` 1194→0 で描かれる
- **C-6** 0.40s にベゼルの目盛り36本（`dasharray 3.6 33.4`）が -42° から回り込んで止まる
- **C-7** 0.62s に文字盤（r=137）が scale .48→1.04→1 で立ち上がる
- **C-8** 0.80s / 0.88s / 0.96s に r=113 / 82 / 54 のリングが順に描かれる（ring-len 710/516/340）
- **C-9** 0.72s に針が -428° から振り切れ、26°→-12°→5.5°→-2°→0° と減衰して北で止まる
- **C-10** 0.95s にレーダーのくさびが -92°→268° に一周する
- **C-11** 0.98s から N→E→S→W が 60ms 間隔で打たれる
- **C-12** 1.18s に中心ピンが scale 0→1.14→1 で着地し、1.30s に波紋が scale .9→3.5 で広がる
- **C-13** build SVG が `spBuildOut`（76%→88% で opacity 1→0）、mark SVG が `spMarkSet`（74%→84% で opacity 0→1）でクロスフェードする
- **C-14** 完成後、ベゼルが90秒周期で360°回り続ける（`mkBezel`、2.1s 後から infinite）
- **C-15** 完成後、針が7秒周期で ±1.7°/-1.3°/0.5° 揺れ続ける（`mkDrift`、2.15s 後から infinite）
- **C-16** 完成後、中心ドットが3.4秒周期で scale 1↔1.22 / opacity 1↔.72 で呼吸する（`mkBreathe`）
- **C-17** 1.98s から COMPASS の7文字が34ms間隔で下からせり上がる（`spLetterIn`、blur 3px→0、`--li` 0..6）
- **C-18** 2.06s に「ToDo」が左から clip-path で拭き出され、2.24s に下線が左から引かれる
- **C-19** neon テーマの「ToDo」ロゴは `#5eebff→#f0fbff→#43e6b1→#ffd166` のグラデ文字になる
- **C-20** note / light テーマでは `.compass-splash__glow` が `display:none` になり、「ToDo」がグラデをやめ単色 `--sp-text` + 'Klee One' になり、下線も単色（note `#cdc6b9` / light `#6b6458`）になる
- **C-21** スプラッシュのステージは `width:min(292px,56vw)` の正方形になる
- **C-22** neon のスプラッシュ背景はシアン/琥珀の radial 2枚 + 135deg の紺グラデ、note は `#100f0c` + 32px罫線、light は `#f3f0e6` + `rgba(80,68,48,.1)` 罫線
- **C-23** クラウド読み込みが完了しても、`componentDidMount` から 2900ms 経過するまでスプラッシュは消えない
- **C-24** スプラッシュは `.compass-splash--ready` の付与によって 0.46秒でフェードアウトし、同時に stage が scale(1.09) + blur(7px) になる
- **C-25** フェードアウト完了後も要素は DOM に残り、`visibility:hidden` になるだけ
- **C-26** `prefers-reduced-motion:reduce` のときスプラッシュの全アニメーションが無効になり、`.compass-splash__build` `.compass-splash__glow` `.sp-guide` `.sp-guide-ring` `.sp-sweep` `.sp-pin-pulse` が `display:none` になり、退場は `spReadyOut .2s ease` になる
- **C-27** スプラッシュが消えるタイミングで親フレームへ `{type:'compass-ready'}` を `postMessage` する
- **C-28** 起動直後の画面は `state.view` の復元値（初回は `'cockpit'`）になる
- **C-29** 起動時、`localStorage['compass-ui']` を読み、`theme` が `'light'`/`'dark'`/`'note'` のいずれかのときだけ採用する
- **C-30** `localStorage['compass-ui']` の `theme` が `'dark'` かつ `themeVersion !== 3` のとき `'note'` に置き換える
- **C-31** `localStorage['compass-ui']` の `panelW` は、各キーが number かつ 120 以上、`editor` は 520 以下・他は 2000 以下のときだけ採用する
- **C-32** 起動時、`localStorage['compass-ui-data']` を `JSON.parse` して `dataPatch()` に通し、初期 state に `Object.assign` する
- **C-33** localStorage への読み書きはすべて try/catch で囲まれ、失敗しても何も起きない
- **C-34** 起動直後に `fetch('/api/app-state', {cache:'no-store'})` を1回だけ GET する（再取得・ポーリング・フォーカス時再読込はしない）
- **C-35** GET が 401 / 403 を返すと `cloudStatus` は `'login'` になる
- **C-36** GET が 503 を返すと `cloudStatus` は `'local'` になる
- **C-37** GET が上記以外の非OKを返すか例外になると `cloudStatus` は `'local'` になる
- **C-38** GET 成功でデータが空のとき、`cloudStatus` を `'saved'` にした上で**即座に `saveNow()`** を実行して初期状態を PUT する
- **C-39** GET 成功でデータがあるとき、`dataPatch` 適用後に `_lastSaveJson` を更新し、`_saveReady` を true に戻し、Undo 基準をリセットする
- **C-40** GET のレスポンスから `email` を読み、なければ `data.email`、それもなければ既存の `cloudUser` を `cloudUser` に入れる
- **C-41** ナビ下部のクラウド行は「{保存状態} · {メールアドレス}」形式で、保存状態は 同期中/保存中/保存済み/端末保存/未ログイン のいずれか（未知の値は「保存待ち」）
- **C-42** `cloudUser` が空のときクラウド行の右側は「gmail.com」と表示される
- **C-43** ナビ最下部に「Compass v0.8」が常に表示される

### 10.2 ナビゲーション

- **C-44** ナビは上から コックピット / 試験計画 / 今日のToDo / 復習 / タスク追加 / データ の6項目が既定順で並ぶ
- **C-45** ナビ項目をクリックすると `state.view` が切り替わり、その画面だけがマウントされる（他画面はアンマウントされる）
- **C-46** 画面を切り替えると、その画面のスクロール位置は必ず先頭に戻る
- **C-47** 画面を切り替えると `.compass-shell` の `data-view` 属性が新しい view id になる
- **C-48** 現在の画面のナビ項目に `is-active` が付き、背景 `color-mix(--nav-hue 14%)`・枠 `color-mix(--nav-hue 28%)`・文字色 `var(--nav-hue)` になり、左端(-15px)に 3px の縦バー(`::after`, `border-radius:0 3px 3px 0`, `box-shadow:none`)が出る
- **C-49** ナビにマウスを乗せると全項目の右端に `.app-nav-item__key`（1〜6の番号バッジ、19×19）が opacity 0→1 で現れる
- **C-50** ナビにマウスを乗せると `.app-nav-item__badge` に `margin-right:22px` が付き、番号バッジと重ならなくなる
- **C-51** 未完了(overdue)タスクが1件以上あると「試験計画」のナビ項目にだけ `⚠N` のバッジが出る（**(v0.9 変更)** このカウントは `manualDay` のミニタスクも数える）
- **C-52** ナビ項目をドラッグして別のナビ項目にドロップすると `state.navOrder` が入れ替わり、番号ヒント(1〜6)も新しい順序に振り直される
- **C-53** ドラッグ中のナビ項目は `opacity:.45` + `scale(.98)`、ドロップ先候補は `border-color:var(--acc)` + `inset 0 2px 0 var(--acc)` になる
- **C-54** ナビ右端の幅 7px のハンドルをドラッグするとナビ幅が 150〜340px の範囲で変わるが、CSS の `clamp(196px, …, 252px)!important` により**見た目は 196〜252px にしか動かない**
- **C-55** ナビ幅のドラッグを離すと `localStorage['compass-ui']` の `panelW.nav` に保存される（ドラッグ中は保存しない）
- **C-56** テンプレートの `.nav-dot` は `display:none!important` で常に非表示になる
- **C-57** ナビ項目のアイコンは data-URI SVG を `currentColor` の mask で描画し、通常 `opacity:.85`・hover と選択時に 1 になる（cockpit=4分割グリッド / tests=カレンダー / todo=チェック付きクリップボード / review=回転矢印と時計 / add=角丸四角の中のプラス / data=棒グラフ）
- **C-58** ナビ項目を hover すると背景が `color-mix(in srgb,var(--nav-hue) 9%,transparent)` になり、`transform` は `none` のままになる
- **C-59** ブランドボタン（Compass / 学習コックピット / ↗）をクリックするとアプリスイッチャーが開き、同時に検索が閉じて query が空になる
- **C-60** ブランドボタンを hover すると `translateY(-1px)` して背景が `--acc` 7%（note では `rgba(238,233,222,.05)`）になり、マークの枠が `--view` の実色・背景が `--view` 15% になり、`↗` が `translate(2px,-1px)` して `var(--acc)` になる
- **C-61** ブランドマークは 38×38・`border-radius:13px` で、中の compass-icon.svg は（属性は 34×34 だが）**CSS で 26×26** で描画される
- **C-62** ナビ下部のカウントダウンが0件のとき「下で自由に追加できます」が表示される
- **C-63** カウントダウンの残日数は 0日なら「今日」、正なら「N日」、負なら「N日前」と表示される
- **C-64** カウントダウンの残日数の色は、過ぎていれば `var(--tx3)`、3日以内なら `var(--pink)`、それ以外は `var(--acc)` になる
- **C-65** カウントダウンは日付の昇順で並び、リストは `max-height:118px` でスクロールする
- **C-66** カウントダウンの名前または日付（`YYYY-MM-DD` 形式）が不正なまま ＋ を押すとトースト「名前と日付を入力してください」が出る
- **C-67** カウントダウン追加に成功するとトースト「カウントダウンを追加しました」が出て、タイトルだけクリアされ日付は保持される。Enter キーでも追加できる
- **C-68** カウントダウンは試験計画(PLANS)とは連動せず独立して管理される
- **C-69** ナビ下部のショートカット表示は `1`–`6` 画面 / `/` 検索 / `N` 追加 / `F` 集中 の4つで、kbd が最小15px幅・`border-radius:4px` のキーキャップになる

### 10.3 テーマ

- **C-70** 既定テーマは `'note'` で、初回起動時は焼けた黒紙のノートテーマになる
- **C-71** テーマ `'note'` を選ぶと `data-theme` 属性が **`"dark"`** になり、罫線ノート紙の背景と Klee One の手書き見出しになる
- **C-72** テーマ `'dark'`（✦ ダーク）を選ぶと `data-theme` 属性が **`"neon"`** になり、罫線が消えてネオン系トークン（`--acc:#42d7f2` など）になる
- **C-73** テーマ `'light'`（☀ ライト）を選ぶと `data-theme` 属性が `"light"` になり、生成りの紙（`--bg0:#f3f0e6` / `--bg1:#fffdf6`）と濃いインクの配色になり、`--acc` は `props.accent`（既定 `#3d3629`）になる
- **C-74** テーマを切り替えると即座に `localStorage['compass-ui']` に `theme` と `themeVersion:3` が保存される
- **C-75** テーマスイッチは3列 grid で、選択中の項目だけ `background:var(--acc)` / `color:var(--onAcc)` になる
- **C-76** note では `--bg0:#100f0c` / `--acc:#f2ede1` / `--onAcc:#141310`、neon では `--bg0:#071421` / `--acc:#42d7f2` / `--onAcc:#04131d` になる
- **C-77** note と light では `--gAcc` / `--gVio` / `--gGrn` がすべて `none` になり、ネオン発光が消える。neon では `--gAcc` が `0 0 14px color-mix(in srgb,#42d7f2 30%,transparent)` になる（glow prop 既定 3 → 係数 1）
- **C-78** note テーマの `.compass-shell` に 32px ピッチ・1px 幅・`rgba(242,237,225,.075)` の横罫線が敷かれる
- **C-79** light テーマの `.compass-shell` に 32px ピッチ・`rgba(80,68,48,.09)` の横罫線が敷かれる。neon では罫線が一切表示されない
- **C-80** note テーマのコックピットパネルと各画面の背景が `rgba(16,15,12,.965)` + `rgba(238,233,222,.045)` の罫線になり、`.cockpit-panel--today` だけ `rgba(21,19,16,.985)` になる
- **C-81** note テーマでも紙の中央の縦の綴じ線は表示されない（`!important` に負ける）
- **C-82** note テーマの時間割スロットに 8deg と -5deg の2重の鉛筆ハッチが入り、左端に `inset 3px` の教科色の芯が出る。`.is-active` で左芯 4px + 外周 1px の `rgba(238,233,222,.28)` リングが付く
- **C-83** note テーマではナビ項目・`.cockpit-primary-action`・`.focus-launch` の `border-radius` が 11px になり、`.quota-line` の drop-shadow が消え、スクロールバーつまみが `rgba(238,233,222,.22)` になる
- **C-84** note テーマでは入力欄の背景が `rgba(18,17,14,.84)`・border が `rgba(238,233,222,.19)` に `!important` で固定され、`style-focus` の `border-color:var(--acc)` が効かなくなる
- **C-85** note テーマのトップバーは `rgba(16,15,12,.94)` の不透明背景になり `backdrop-filter` が無効になる（neon / light は `blur(18px)` の半透明）
- **C-86** 見出し（`.panel-heading` / `.app-view-title__name` / `.compass-brand__name` / `.empty-note b`）が Klee One 600・`letter-spacing:.035em` で表示される
- **C-87** `--font-hand` が `'Klee One','Noto Sans JP',serif`、`--font-num` が `'Space Grotesk','Noto Sans JP',sans-serif` として定義され、ルートの font-family が `'Noto Sans JP', system-ui, sans-serif` になる
- **C-88** `<head>` に Google Fonts の link が入り、Klee One 400/600・Noto Sans JP 400/500/700/900・Space Grotesk 500/700 が `display=swap` で読み込まれる。preconnect は fonts.googleapis.com への1本だけ
- **C-89** `.compass-shell` 全体に `font-variant-numeric:tabular-nums` が効いて数値の桁が揺れない
- **C-90** cockpit で `--view` が `var(--acc)`、tests で `var(--vio)`、todo で `var(--pink)`、review で `var(--grn)`、add で `var(--org)`、data で `var(--blue)` になり、`--grad` も同じ色になる
- **C-91** 画面を切り替えると `.compass-shell::before` の radial-gradient が `--view` 7% の色へ .5s ease でトランジションする
- **C-92** 画面を切り替えると `.app-view-title::before` の 3px 縦罫の色が .35s ease で `--view` へ変わる
- **C-93** 画面ごとの署名色はタイトル左バー・カウンタ・進捗バー・主要ボタン・フォーカスリング・空状態カード背景に一斉に反映される
- **C-94** 画面を切り替えると `[data-screen-label]` が `inkIn .3s cubic-bezier(.2,.85,.2,1)` で opacity 0→1・translateY(10px)→0 になる
- **C-95** `prefers-reduced-motion:reduce` では画面切替の `inkIn` が無効になり、`.compass-shell` 内の全 `transition-duration` が .01ms になり、`.app-nav-item` / `.cockpit-task` / `.cockpit-review` / `.cockpit-plan` / `.cockpit-primary-action` の transition が none になる
- **C-96** フォーカス可能要素は `.compass-shell` 内では `outline:2px solid var(--view)`、外では `var(--acc)` になり `outline-offset:2px` が付く
- **C-97** スクロールバーは幅8px、つまみが `rgba(128,150,190,.25)` の `border-radius:99px` になる
- **C-98** 教科『数学』は `--sj-indigo` 18%、『地理』『地総』は `--sj-forest` 20%、『英コミ』『英語』『英コ』は `--sj-amber` 17%、『LHR』『体育』『保健』は `--sj-graphite` になる
- **C-99** `SUBJ` に無い教科名を入力すると、登録済み教科数を 6 で割った余りで vio/blue/acc/pink/grn/org のパレットから色が巡回割当される

### 10.4 トップバー・検索

- **C-100** トップバーの視覚順は 左から ランチャー(order 0) → 画面タイトル(1) → 検索(2) → 右アクション(3) で、`min-height` は 70px（モバイル 52px）
- **C-101** 画面を切り替えるとトップバーのタイトルとサブタイトルが `titles` マップの値に変わる（例: data → 「学習データ」/「勉強時間とテスト結果をふり返る」）
- **C-102** ナビのラベルは「データ」だがヘッダーのタイトルは「学習データ」になる
- **C-103** トップバー右の日付は「M月D日(曜)」形式で今日（日本時間）を表示する
- **C-104** トップバー右のカウンタは「完了数/総数」で、スラッシュだけ `var(--tx3)` の淡色、数値は `var(--view)` 色になる
- **C-105** **(v0.9 変更)** 未完了タスクがあるときだけトップバーに「⚠ 未完了 N件 → 再配分」のピル（`--pink` 枠 / `--pinkBg` 背景 / `border-radius:99px`）が出て、クリックすると Tests 画面へ移動して再配分モーダルが `'all'` モードで開く。hover で `translateY(-1px) brightness(1.08)`
- **C-106** トップバー下端に高さ 2px の進捗バーがあり、幅が今日の完了率(`donutPct`)%、色が `var(--view)` になり、`width` が .55s cubic-bezier(.2,.8,.2,1) でアニメーションする
- **C-107** 進捗バーには `role="progressbar"` `aria-label="今日の完了率"` `aria-valuemin=0` `aria-valuemax=100` `aria-valuenow={donutPct}` が付く
- **C-108** 検索入力にフォーカスすると検索ポップオーバーが `fadeUp .16s ease` で開く（`top:calc(100% + 8px)`, `z-index:80`）
- **C-109** 検索欄を hover / focus-within すると border が `--acc` 64% になり、外側に 3px の `--acc` 9% リングが出る
- **C-110** 検索入力に文字があるときだけ ✕（検索語を消去）ボタンが表示される
- **C-111** ✕（検索語を消去）を押すと query が空になるがポップオーバーは開いたままになる
- **C-112** ポップオーバー右上の ✕（検索を閉じる）を押すと query が空になりポップオーバーも閉じる
- **C-113** 検索ポップオーバーは外側をクリックしても閉じない（Escape / ✕ / アプリスイッチャーを開く、のみ）
- **C-114** 検索ポップオーバーには教科チップが表示され、表記揺れ（英語/英コ→英コミ、歴総→歴史、地総→地理、化基→化学、生基→生物）は代表名1つに統合される
- **C-115** 教科チップをクリックすると query にその教科名が入り、同じチップを再度クリックすると query が空になる
- **C-116** 検索が未入力のとき「上のバーにタスク名または教科を入力してください」が表示される
- **C-117** 検索に文字を入力すると「結果 N件 — 今日のToDoへ追加できます」が表示され、1文字ごとに即座に結果が更新される
- **C-118** 検索は大文字小文字を区別しない部分一致で判定する
- **C-119** 検索結果が0件のとき「一致するタスクがありません」が表示される。結果リストは `max-height:370px` でスクロールする
- **C-120** 計画ミニタスクはタスク名・計画名・計画の教科のいずれかにマッチすると検索結果に出て、`where` が「{計画名} · {日付ラベル}」になる
- **C-121** 復習はタイトルと教科にマッチすると出て、`where` が「{stage}の復習 · {日付ラベル}」になり、added なら「追加済」、done なら「✓済」のタグが付く
- **C-122** 単発タスク(extras)はタイトルと教科にマッチすると出るが、「＋ 今日へ」ボタンは出ず常に「今日」タグが付く（`where` は `x.src`）
- **C-123** 「英語」で検索すると「英コミ」の項目もヒットし、「歴総」で検索すると「歴史」の項目もヒットする
- **C-124** 検索結果の計画ミニタスクは「未完了かつ今日でない」ときだけ「＋ 今日へ」が出て、押すと `day` が今日になり order に追加され、トースト「「{タイトル}」を今日に移動しました」が出る（`manualDay` は付かない）
- **C-125** 検索結果の復習は「未追加かつ未完了」なら **`due` が未来でも**「＋ 今日へ」で追加でき、トースト「「{タイトル}」を今日のToDoに追加しました」が出る
- **C-126** 検索語があるあいだコックピットの「今日のタスク」（タイトル・教科・src でマッチ）と「復習」（タイトル・教科）と Tests タイムラインのセグメント（タイトル・計画名・教科）が同時に絞り込まれる
- **C-127** ToDo 画面とデータ画面は検索語を入れても絞り込まれない。Tests の計画行自体も残る
- **C-128** 検索入力欄には「⌘K」のショートカット表示が出る（幅820px以下では非表示）

### 10.5 キーボードショートカット・トースト・Undo

- **C-129** `Cmd/Ctrl+K` を押すと検索ポップオーバーが開き、検索入力にフォーカスして既存文字が全選択される
- **C-130** テキスト入力中でないときに `/` を押すと検索にフォーカスする（修飾キーなしのみ）
- **C-131** テキスト入力中でないときに `1`〜`6` を押すと、ナビの並び順に対応する画面へ切り替わり `savePrefs()` が走る
- **C-132** テキスト入力中でないときに `n` を押すと「タスク追加」画面へ切り替わり `savePrefs()` が走る
- **C-133** テキスト入力中でないときに `f` を押すと「今日のToDo」画面へ切り替わり、同時に集中モードが開く
- **C-134** `Escape` を押すと 検索・再配分モーダル・アプリスイッチャー・復習詳細・理解度モーダル・点数ドロワー・集中モードが一括で閉じ、query も空になり、集中タイマーが `clearInterval` される
- **C-135** `Escape` を押してもミニタスク編集ドロワー(`editorPlan`)は閉じない
- **C-136** `Cmd/Ctrl+Z`（入力欄にフォーカスが無いとき）で直前の1操作が戻り、トースト「1つ前の操作に戻しました」が出る。戻せる操作がなければ「戻せる操作はありません」
- **C-137** Undo は1段のみで、2回続けて押しても2手前には戻らない
- **C-138** Undo 実行後は選択・ドラッグ・モーダル系の一時状態がすべてリセットされる
- **C-139** `Cmd/Ctrl+S` を押すと即時保存され、成功なら「Firebaseに保存しました」、失敗なら「Firebase保存に失敗: {理由}」（フォールバックは「未接続」）のトーストが出る。未準備なら「保存準備中です」
- **C-140** トーストは画面下端から26pxの位置に中央寄せ・`border-radius:99px` で `toastIn .2s ease` で表示され、2400ms 後に自動で消える
- **C-141** トーストを連続で出すと前のタイマーがキャンセルされ、常に最新の1件だけが表示される
- **C-142** ツールチップは `pointer-events:none` でマウス位置の上（`translate(-50%,-110%)`、`z-index:60`）に出る

### 10.6 コックピット

- **C-143** Cockpit はデスクトップ(1181px以上)で3カラム `minmax(360px,1.18fr) / minmax(290px,.9fr) / minmax(330px,1fr)`、パネル間の隙間 1px が `var(--line)` 色でヘアラインの罫に見える（note では `rgba(238,233,222,.12)`）
- **C-144** 3パネルはそれぞれ `height:calc(100vh - 68px)` で独立にスクロールし、外側の grid はスクロールしない
- **C-145** パネル見出し(`.cockpit-panel-title`)は `position:sticky; top:-22px` でスクロール時に上部固定され、背景に下向きグラデーションが掛かる
- **C-146** パネル見出しのドットは 9px 円で、外側に 3px の 16% 色リングが付く
- **C-147** 「今日のタスク」は計画ミニタスク(seg)が先、復習・単発(rev/extra)が後の順で並び、その中は `state.order` の順序に従う
- **C-148** タスクカードのチェックボックス（17×17, border 1.5px, radius 6px）をクリックすると done がトグルする。**カードの他の場所をクリックしても何も起きない**
- **C-149** 完了したタスクカードは `opacity:0.5` になりタイトルに `line-through` が付き、チェックボックスが `var(--acc)` の塗りに ✓ が出る
- **C-150** タスクカードのメタ行は「{min}分 · {src}」形式（seg は計画名、extra は `x.src`、rev は「{stage}の復習」）
- **C-151** 時間割由来のタスクには橙色の「時間割 {N}限」バッジが付く
- **C-152** タスク／復習／計画カードは `border-radius:13px`（`--ink-rad`）と `--ink-lift` の影を持ち、hover で `translateY(-2px)` + `--ink-lift-hi` + border `--acc` 28% になる
- **C-153** パネル見出しの右に「{件数}件 · {合計}h」が表示される（完了済みも含む合計）
- **C-154** 負荷行は「負荷 {合計}h / 平日Max {wkMax/60}h」と表示され、**休日でも「平日Max」表記のまま変わらない**
- **C-155** 負荷バーの幅は 合計分 / `wkMax` の百分率（最大100%）で、**完了済みタスクの分も差し引かれない**
- **C-156** `wkMax` の既定値は 240（表示 4h）、`weMax` の既定値は 360（表示 6h）
- **C-157** サブタスク（細分化）を1つ完了すると、そのタスクの min のうち該当分だけが完了分に加算され、ドーナツの％が部分的に上がる
- **C-158** サブタスクの `subSizes` が全件そろっているときは時間で重み付け、1つでも欠けていれば件数で均等割りされる
- **C-159** 「今日のタスク」が空のとき「今日のタスクはまだ空です」「右の復習や計画から「＋ 今日へ」で積みましょう。ドラッグでもここに置けます。」が破線枠で表示される
- **C-160** **(v0.9 変更)** 「復習」が空のとき「復習の予定はありません」「復習タスクを完了して理解度を記録すると、翌日→3日後→1週間後→2週間後の間隔で次の復習が自動で積まれます。」が表示される
- **C-161** 「試験・予習計画」が空のとき「計画がありません」「「タスク追加」からテストや予習の計画を作ると、ここに残り日数と進捗が並びます。」が表示される
- **C-162** 「ToDo画面で実行する →」を押すと ToDo 画面へ移動する（hover で `border-color:var(--acc);color:var(--acc)`）
- **C-163** 「計画を見る →」を押すと Tests 画面へ移動する（hover で `color:var(--view)`）
- **C-164** 週次消化率カードを押すと Review 画面へ移動する（hover で border `--grn` 45% / 背景 `var(--bg3)`）
- **C-165** 「未完了タスクを再配分」を押すと Tests 画面へ移動して再配分モーダルが `'all'` モードで開く（`background:var(--acc)` + `0 8px 24px` の `--acc` 17% の影、hover で `translateY(-1px) brightness(1.07)`）
- **C-166** 復習カードは `!added && !done` のときだけ `draggable="true"` になり、「今日のタスク」パネルへドロップすると `added=true` になり order に追加され、トースト「「{教科} {タイトル}」を今日のToDoに追加しました」が出る
- **C-167** 計画カードは未完了ミニタスクが1件も無いと `draggable="false"` になりドラッグ開始が `preventDefault` される
- **C-168** 計画カードを「今日のタスク」パネルへドロップすると、その計画の**配列順で最初の未完了ミニタスク**の `day` が今日になり、そのタスクが選択状態(`selId`)になり、トースト「「{タイトル}」を今日のToDoに追加しました」が出る
- **C-169** 復習カード／計画カードをドラッグ中は「今日のタスク」パネルの枠が `var(--grn)` になり「ここにドロップで今日のToDoに追加」の破線ボックスが出る
- **C-170** 今日のタスクカードをドラッグして「復習」パネルまたは「試験・予習計画」パネルにドロップすると今日から外れ、トースト「今日のToDoから戻しました」が出る（復習→`added=false` / 計画ミニタスク→`day=''` / 単発→`day=''`、いずれも order から除去）
- **C-171** 今日のタスクカードをドラッグ中は復習パネル・計画パネルの枠が `var(--acc)` になる
- **C-172** コックピットの今日のタスク同士はドラッグしても並べ替えできない
- **C-173** 復習パネルには `due` や `done` に関係なく**すべての**復習カードが並ぶ（完了済みは `opacity:0.5`）
- **C-174** 復習カードは `due` が今日ちょうどかつ未完了のとき背景が緑6%ティント・枠が緑35%になる
- **C-175** 復習カードの日付ラベルは `dayLabel`（今日/明日/M/D(曜)/M/D(期限切れ)）で、`due` が今日のときだけ `var(--pink)` になる
- **C-176** 復習パネルのタイトル右には pink で「今日 {revTodayCount}件」が表示される
- **C-177** 計画カードにはドーナツ状のリング（62×62, r=29, sw 6, `dasharray {dash} 182`, `rotate(-90 34 34)`）と中央に「あと N 日」が表示される
- **C-178** 計画カードには「{期限ラベル} · {範囲}」と 6px 進捗バー（`width` .45s ease）と「{完了}/{全体} 完了 · 次: {次のタスク名}」が並ぶ
- **C-179** 未完了タスクが1つもない計画では「次: 完了！」と表示される
- **C-180** 計画カードの背景は、テスト計画のみ `color-mix(in srgb, {light?'#6d4de0':'#a78bfa'} 6%, var(--bg2))`、予習は `var(--bg2)`。枠線はテストが solid・予習が dashed
- **C-181** Cockpit の週次消化率カードには「{消化率}{%}」と「今週の復習消化率 · {done}/{total}件」「Review画面へ →」が表示される

### 10.7 試験計画（Tests）

- **C-182** Tests 画面は上から プランコントロール → (未完了バナー) → (計画選択バナー) → スワイプヒント → タイムライン表 の順に並ぶ
- **C-183** 「平日 最大負荷」の ＋ / － で `wkMax` が30分ずつ変わり、60〜720分にクランプされる。「休日 最大負荷」も同様で、値は `var(--grn)` 色で表示される
- **C-184** 最大負荷は「{分/60}h」形式で表示される（240 → 4h）
- **C-185** 凡例に「テスト(実線)」「予習(点線)」と「XS 5分 / S 10分 / M 20分 / L 30分」（swatch 8/13/20/28px）が並ぶ
- **C-186** 未完了タスクがあるとき「⚠ 期限前に終わらなかったタスクが N件」「今日以降〜期限日に、最大負荷を守って自動で組み直せます」のバナーが出る
- **C-187** 「計画ごとに設定」を押すと `redistPickMode` になりボタンのラベルが「計画を選択中…」に変わり `aria-pressed="true"` になり、「↓ 再配分したい計画を選択してください」バナーとトーストが出る
- **C-188** 計画選択モード中は計画行の sticky セルが教科色10%で薄く塗られ、行をクリックすると編集ドロワーではなく再配分モーダルが開く
- **C-189** タイムライン表の左上セルには「計画 ＼ 日付」と表示され、左端列と日付ヘッダは横スクロールしても `position:sticky` で固定される
- **C-190** タイムライン表の日数は最低13日で、計画の期限やセグメントの日付が先ならその日まで伸び、**最大731日**で頭打ちになる
- **C-191** タイムラインは `270px + 日数×minmax(104px,1fr)` の grid で、`min-width` が `270 + 日数×104` px になり、`border-radius:16px` と `0 18px 50px rgba(0,0,0,.14)` の影を持つ
- **C-192** 日付ヘッダに負荷バー（幅14px, `border-radius:3px 3px 0 0`, `min-height:2px`, height .4s ease）があり、上限超過の日は棒とラベルが `--pink`、休日は `--grn`、平日は `--acc` になる
- **C-193** 各日の負荷は「Xh」（分/6 を四捨五入して10で割る）、0のときは「–」と表示される
- **C-194** 今日の列は `--acc` 8%、休日の列は `--grn` 5% の淡い背景になる（タイムラインセルは 6% / 4%）
- **C-195** 計画行を hover すると sticky セルの背景が `var(--bg3)` になる
- **C-196** テスト計画の横線は実線、予習計画は点線で描かれ、GOAL 日のセルでは `right:50%` まで、それより後の日には描かれない
- **C-197** 期限が今日より前の計画は横線も GOAL ピルも描かれない
- **C-198** GOAL ピルは「GOAL M/D」と表示され、2px 枠・`border-radius:99px`・`0 0 12px` の 35% グロー付きで、期限が今日以降のときだけ出る
- **C-199** セグメントチップの幅はサイズにより XS=32% / S=46% / M=68% / L=92% になり、高さ22px・`border-radius:7px`・1.5px の教科色枠・`box-shadow:0 0 0 2px var(--bg1)` を持つ
- **C-200** セグメントを hover すると `filter:brightness(1.3)` になり、カーソル位置の上にツールチップが出て「{計画名} · {分}分 · {サイズ} · {日付ラベル}」（手動固定なら「· 手動固定(再配分対象外)」が付く）が表示される
- **C-201** 完了したセグメントは背景 transparent・`opacity:.4`・ラベルが「✓」になる
- **C-202** セグメントチップをクリックすると done がトグルするが、ドラッグ直後の1クリックは無視される
- **C-203** セグメントをドラッグして**同じ計画の GOAL より前**のセルに落とすと日付が変わり `manualDay` が true になり、トースト「「{タイトル}」を{日付ラベル}へ移動しました」が出る
- **C-204** セグメントを別の計画の行や GOAL 当日以降のセルにはドロップできない
- **C-205** セグメントを今日のセルへ移動すると今日の ToDo に追加され、今日から外すと ToDo から外れる
- **C-206** GOAL ピルをドラッグして今日以降の日に落とすと計画の期限がその日に変わり、新しい期限以降にあったセグメントは期限の前日へまとめて移動する。トースト「「{計画名}」のGOALを{日付ラベル}へ変更しました」
- **C-207** GOAL を移動したとき、その計画を編集ドロワーで開いていれば日付入力(`edPlanDue`)も同期して更新される
- **C-208** 計画行の左端の「≡」ハンドルをドラッグすると `planOrder` が変わり、ドラッグ中の行は `opacity:.45`、ドロップ先の行の上端に `inset 0 2px 0` の線が出る
- **C-209** 計画行の左セルには 種別バッジ・（時間割由来なら）「時間割 N限」・「あとN日」・「{完了}/{全数} 完了」・「✎ 編集」が並ぶ
- **C-210** 期限切れセグメントがある計画の左セルにはピンクの「⚠N」が表示され、押すとその計画の再配分モーダルが開く（このカウントは `manualDay` も数える）
- **C-211** 期限が過ぎていて全ミニタスクが完了している計画は、Tests・Cockpit・ToDo から自動的に消える
- **C-212** タイムライン表の最下部に「≡ 計画は左のハンドルで並び替え · セグメントはドラッグで日付固定 · GOALもドラッグしてテスト日を変更 · クリックで完了 · GOAL当日以降には配置できません」が表示される
- **C-213** Tests 画面には専用の空状態テキストが無い（計画0件なら head + 説明行だけが残る）

### 10.8 再配分

- **C-214** 再配分モーダルは画面中央に `width:620px` / `max-width:92vw` / `max-height:86vh` で表示され、背景が `rgba(5,9,20,.66)` + `blur(3px)`、パネルが `popIn .18s ease` で開く
- **C-215** タイトルは「↻ {計画名} の再配分」で、全体再配分のときは計画名が「すべての計画」になる
- **C-216** サブ行に「{教科 · 種別 · 期限 · 平日Max/休日Max} · {組み方の説明} · 未完了 N件を今日〜期限前日に配置します」が表示される
- **C-217** 組み方チップは 上限内で均等 / 上限無視で均等 / できるだけ早く / 期限前から の4つ
- **C-218** 「上限無視で均等」を選ぶと橙色の注意ブロック「各計画のタスクを期間全体へ等間隔に配置します」「平日・休日の上限は無視します。プレビューの赤い棒で超過日を確認してください。」が出る
- **C-219** 「期限前から」を選ぶと「期限前 [N] 日間に分散」の数値入力（1〜90にクランプ）と「GOAL当日は含めず、この期間の空きを均等に使います」が出る
- **C-220** 「手動配置も対象」トグルを ON にすると `manualDay` のミニタスクも対象になり、サブ文言が「固定済みも動かす」（OFF は「固定済みは守る」）に変わる。トグルは 34×19px、つまみ 13px が `translateX(15px)` する
- **C-221** 対象外のタスクだけで上限を超えている日があるとき（上限無視モードでは出ない）「固定された予定だけで上限を超えている日があります」「均等に見えない原因です。必要なら右上の「手動配置も対象」をONにしてください。」+ 「{M/D} {X}h / 上限{Y}h」の一覧が出る
- **C-222** 置けなかったタスクがあるとき、上限内モードでは「上限を守るため N件は未配置のまま残します」、上限無視モードでは「N件はGOAL前に作業日がなく未配置です」と表示され、「• {計画名} / {タイトル} — {理由}」が並ぶ
- **C-223** 再配分の対象が0件のとき「再配分できる未完了タスクはありません。」が表示される
- **C-224** 移動リストは「{移動前} → {移動後}」で、移動前は取り消し線 + pink、移動後は `var(--grn)` で表示され、「{計画名} · {分}分 · 期限 {M/D}まで」が添えられる
- **C-225** 適用後の負荷プレビューは先頭14日ぶんの棒グラフ（枠64px、最低4%）で、上限超過日は `--pink` になり、キャプションが「赤い棒は設定上限の超過を示します」/「日ごとの最大負荷を上限として厳守」に切り替わる
- **C-226** 適用ボタンは未配置がある場合「配置できるN件を適用」、無い場合「この内容で再配分する」
- **C-227** 再配分を適用するとトースト「{全体を|この計画を}{上限を無視して均等に|上限内で}再配分しました(N件)」が出て、未配置があれば「・未配置M件」が付く
- **C-228** 移動できるタスクが0件のときは適用時にトースト「再配分できる未完了タスクはありません」が出てモーダルが閉じる
- **C-229** 再配分の対象は「未完了」「期限が今日より後の計画に属する」ミニタスクのみで、候補日から GOAL 当日は必ず除外される
- **C-230** 再配分は複数計画のとき期限の早い計画から順に処理され、先の計画の配置が後の計画の空き容量を減らす
- **C-231** 再配分で日付が今日になったミニタスクは自動で今日の ToDo に追加される
- **C-232** 再配分を適用してもミニタスクに `manualDay` は付かない
- **C-233** ページをリロードすると再配分モード・手動配置トグル・期限前日数はすべて初期値（`even` / OFF / 7）に戻る
- **C-234** 配置エンジン `scheduleItems` は `'even'` のとき候補日の空き容量に比例して散らし、**1件目は必ず候補日の初日**に置く。`'early'` は入る日から前詰め、`'flow'`（上限無視）は期間全体へ等間隔に置く
- **C-235** `min` が 0 や undefined のタスクも最低1分として扱われる

### 10.9 今日のToDo

- **C-236** ToDo 画面はデスクトップで2カラム `minmax(360px,2fr) / minmax(480px,3fr)` になる
- **C-237** 左カラムに「テスト・予習計画 · N件」「復習・単発タスク · N件」の2つのセクション見出しが表示される
- **C-238** 計画カードは「今日の日付のミニタスクを持つ計画」だけが並び、左端に 4px の教科色帯と `›` シェブロンが付く
- **C-239** 計画カードのバッジは今日分に未完了が残っていれば「あと{n}個」、全部済んでいれば「今日分OK」
- **C-240** 計画カードのメタは「{教科} / {期限ラベル}まで / 今日 {done}/{total} / 全体 {done}/{total}」形式
- **C-241** 計画カードをクリックすると、その計画の今日ぶん先頭のミニタスク（無ければ最初のミニタスク）が選択される
- **C-242** 選択中の計画カードは背景が `color-mix(教科色 14%, var(--bg3))`、枠が教科色になる（非選択は `color-mix(教科色 7%, var(--bg2))`）
- **C-243** 復習・単発カードはカードのどこをクリックしても選択され右に単一タスク詳細が出る
- **C-244** 復習・単発カードのチェックボックスをクリックすると**完了トグルと選択が同時に起きる**（stopPropagation なし）
- **C-245** 右上のサマリーカードに 110×110 のドーナツ（r=52, sw 10, `dasharray {doneMin/totalMin*327} 327`、中央に「{％}%」と「完了」）が出て、gradient stop が `--view` と `color-mix(--view 55%, --vio)` に上書きされる
- **C-246** 「今日のノルマ」欄は「{件数}件 · {合計}h をやり切る」、その下に「完了 {n} / {m}件」「残り {x}h」が表示される
- **C-247** 「▶ 集中モード」ボタンが表示され、押すと集中モードのオーバーレイが開く
- **C-248** 選択中が復習または単発タスクのときだけ単一タスク詳細が表示され、それ以外は計画詳細が表示される（**同時には出ない**）
- **C-249** 何も選択していないとき `sel` は今日のリストの先頭アイテムになる
- **C-250** 計画詳細ヘッダに種別チップ・計画名・「あと{n}日」（負なら0）が表示され、サブ行が「{教科} · 期限 {日付} · {done}/{total} 完了」になる
- **C-251** 計画詳細の3タイルは「全体進捗 {done} / {total}」「今日の進捗 {done} / {total}（あと{n}こ）」「今日のノルマ {タイトル}まで」
- **C-252** 今日のミニタスクが0件の計画では「今日の進捗」が「今日分なし」になる
- **C-253** ノルマ線が引かれていないとき「今日のノルマ」は「今日のノルマなし」になる
- **C-254** 計画詳細のミニタスク一覧はその計画の**全**ミニタスク（今日以外も未配分も）を配列順で表示し、`max-height:490px` を超えるとその中でスクロールする
- **C-255** ミニタスク行の日付チップは 期限切れ→`--pink`/`--pinkBg`、今日→`--acc`/`--accBg`、未来→`--tx2`/`--bg3`、未配分→`--tx3` になる
- **C-256** ミニタスク行の背景は今日が `color-mix(教科色 12%)`、期限切れが 10%、それ以外が 5% の濃さになる
- **C-257** ミニタスク行のチェックをクリックすると done がトグルし `opacity:0.52` と `line-through` が付く
- **C-258** ミニタスク行の右端サイズチップは「M·20分」形式で表示される
- **C-259** ミニタスク一覧の見出し右に「ノルマ線を上下にドラッグして変更」の注記が出る
- **C-260** ノルマ線は「⠿ ──── ↕ 今日のノルマ ここまで ──── ⠿」の形で `quotaIdx` の行の直後に表示され、`cursor:ns-resize` になる
- **C-261** ノルマ線を掴んで別のミニタスク行の上にドラッグすると、ドラッグ中にリアルタイムでノルマ線がその位置へ移動する
- **C-262** ノルマ線をドロップするとトースト「今日のノルマを「{タイトル}」までに変更しました」が出る
- **C-263** ノルマ線を一度も動かしていない計画では、日付が今日以前に設定された最後のミニタスクの直後に自動で引かれる
- **C-264** 手動で設定したノルマ位置は `planQuota` に保存され、リロード後も維持される。値は 0〜(タスク数-1) にクランプされる
- **C-265** ノルマ線の位置は負荷計算・再配分・完了判定には影響しない（表示専用）
- **C-266** 計画詳細でミニタスクが0件のとき「計画を選ぶとミニタスクを表示します」が表示される
- **C-267** 単一タスク詳細のヘッダに「復習」または「単発タスク」のチップと教科チップ、右に「選択中のタスク」が出る
- **C-268** 単一タスク詳細のメタは「見積 {min}分 · サイズ {size}」形式（計画タスクの場合のみ「 · 期限 {日付}」が付く）
- **C-269** 単一タスク詳細のタスク行は**どこをクリックしても**完了トグルする
- **C-270** 単一タスク詳細の「削除」を押すと該当タスクが state から消え order からも除かれ、トースト「「{タイトル}」を削除しました」が出る
- **C-271** 単一タスク詳細で細分化が0件なら「細分化はまだありません」が表示される
- **C-272** 単一タスク詳細の細分化行をクリックすると `subsDone[i]` がトグルし、チェックと `line-through` が変わる
- **C-273** 単発タスクを選択しているときだけ「ミニタスクを追加… (Enter)」の入力欄と「＋ 追加」が出る（復習では出ない）
- **C-274** 細分化を追加すると `subs`/`subsDone` が伸び、`subSizes` は既存のサイズ未設定分を空文字で埋めてから新しいサイズが末尾に付く。**トーストは出ない**
- **C-275** **(v0.9 変更)** 未来日で作成した単発タスク(extra)は order に入らないが、`day === 今日` になった時点で `todayIds` が自動収集するので「今日のタスク」「今日のToDo」に現れる（order 経由の項目より後ろ）

### 10.10 集中モード

- **C-276** 集中モードは全画面オーバーレイ（`z-index:65`、背景 `color-mix(--bg0 92%, black)` + `blur(16px)`）で、**背景クリックでは閉じず** ✕ か Escape でのみ閉じる
- **C-277** カードは `width:min(560px,92vw)` / `padding:28px` / `border-radius:20px` で「FOCUS MODE」ラベル（LS .08em）と ✕ を持つ
- **C-278** タイマー円は 210×210 で `border:10px solid var(--line)` の `border-top-color` だけ `var(--acc)` になり、中央に `MM:SS` が 700 48px 'Space Grotesk' で表示される
- **C-279** 集中モードの対象は「選択中かつ未完了のタスク」、無ければ「今日のリストで最初の未完了タスク」になる
- **C-280** 今日のタスクが全部完了 or 0件なら「今日のタスクはありません」「先にToDoへタスクを追加してください」が表示され「✓ タスク完了」ボタンが出ない
- **C-281** プリセットは 15分 / 25分 / 45分 の3つで、既定は 25分（`focusRemaining:1500`）
- **C-282** プリセットを押すとタイマーが停止し残り時間がその分数×60秒にリセットされる
- **C-283** 「▶ 集中開始」を押すとボタンが「一時停止」になり1秒ごとに残り時間が減る。「一時停止」で止まり「▶ 集中開始」に戻る
- **C-284** タイマーが 0 になるとトースト「集中時間が終了しました。おつかれさま！」が出てボタンが「もう一度」になり、「もう一度」で現在のプリセット（既定25分）にリセットされる
- **C-285** 計画タスクまたは単発タスクで「✓ タスク完了」を押すと done=true になり集中モードが閉じ、トースト「「{タイトル}」を完了しました」が出る
- **C-286** 復習タスクで「✓ タスク完了」を押すと集中モードが閉じて理解度モーダルが開く（トーストは出ない）
- **C-287** 集中モードの状態（開閉・残り時間・実行中）はリロードで保存されない

### 10.11 復習（Review）

- **C-288** Add 画面で種類「復習」を追加すると `reviews` に `{seriesId=自分のid, reviewNo:1, stage:'翌日', last:今日, due:選んだ日, min:SIZE_MIN[addSize], added:false, done:false}` が1件追加される
- **C-289** 復習を追加すると成功バナーが「復習「{教科} {タスク名}」を追加しました(次回 {日付ラベル})」、遷移ボタンが「Reviewで見る →」になる
- **C-290** 復習の `src` は時間割起点なら「時間割から追加」、そうでなければ「手動追加」（メモがあれば「 · {メモ}」が付く）
- **C-291** 種類「復習」ではサイズ見出しが「目安時間(復習1回ぶん)」になり、細分化タスク欄が非表示になり、詳細の補足が「(メモ)」になる
- **C-292** **通常のタスク（seg/extra）を完了しても reviews は増えない**（自動生成は実装されていない）
- **C-293** 復習のチェックを付ける操作（ToDo/Cockpit のチェックボックス、Review 表の「完了」、詳細の「✓ 復習完了にする」、集中モードの「✓ タスク完了」）をすると理解度モーダルが開き、同時に詳細ドロワーが閉じる
- **C-294** 理解度モーダルを開くと `revAskGrade` と `revAskSize` が毎回 null にリセットされる
- **C-295** 理解度モーダルのサイズチップは、初期状態で `sizeOfMin(復習のmin)`（5以下=XS/10以下=S/20以下=M/それ以上=L）が選択済みになる
- **C-296** 理解度を選ばずに「✓ 復習を完了する」を押すとトースト「理解度を選んでください」が出て何も起きない
- **C-297** 理解度モーダルの見出しは「復習おつかれさま！理解度はどうでしたか？」で、下に教科チップ・タスク名・「{stage}の復習」が並ぶ
- **C-298** 理解度の3枚は ◎ばっちり/次の間隔へ進む(緑)、○まあまあ/同じ間隔でもう一度(acc)、△不安…/明日 追加の復習(pink) で、選択すると文字が `var(--onAcc)`・背景がそのカードの色になる
- **C-299** 「ばっちり」で完了すると stage が 翌日→3日後→1週間後→2週間後 と1段進み、次回 due が**今日から**その段の日数（3/7/14日）後になる
- **C-300** 「まあまあ」で完了すると stage は変わらず、次回 due が今日から同じ日数後になる
- **C-301** 「不安…」で完了すると stage が `'翌日'` に戻り、次回 due が今日の翌日になる
- **C-302** stage が `'2週間後'` の復習を「ばっちり」で完了すると次回の復習が作られず、トーストが「定着！「{タスク名}」の復習は完了です 🎉」になる（**(v0.9 変更)** 「まあまあ」でも `stageDays` に次の間隔が無い stage なら同じく系列終了する。C-521）
- **C-303** 次回復習の due は必ず「今日」を起点に計算される（元の due や last が過去でもその分ずれない）
- **C-304** 次回の復習は `reviewNo` が +1、`seriesId` は元の系列 ID を継承し、`title`/`subj`/`timetablePeriod`/`timetableDate` も継承される
- **C-305** 次回の復習の `min` は理解度モーダルで選んだサイズの分数になり、`src` は「{M/D}に学習」（今日の日付）になる
- **C-306** 復習を完了すると、同じ `seriesId` で `reviewNo` が現在より大きい行がすべて削除されてから、次の1回だけが追加される
- **C-307** 復習を完了すると `studyLog` に `{day:今日, subj:その復習の教科, min:完了した復習のmin}` が1件追加される（次回用に選んだサイズの分数ではない）
- **C-308** 期限切れ（`due < 今日`）の復習を完了すると `added` が false になり order からも外れる。期限内の復習を完了しても `added` は保持される
- **C-309** 復習完了のトーストは、不安なら「明日、追加の復習を入れました({日付ラベル} · {サイズ})」、それ以外なら「次は{次のstage}に復習します({日付ラベル} · {サイズ})」になる
- **C-310** Review 画面の「今日やる復習」は `due` が今日ちょうどかつ未完了の件数を pink で表示する（遅れ分は含まない）
- **C-311** 「遅れている復習」は `due` が今日より前かつ未完了の件数で、1件以上なら pink、0件なら `var(--tx0)` になる
- **C-312** 今週の消化率の分母は「今週の月曜から今日まで」に `due` がある復習の全件、分子はそのうち done のものの件数（起点は `isoShift(今日, -((getUTCDay()+6)%7))`＝月曜、日曜は前の月曜が週初め）
- **C-313** 今週の対象が0件のとき消化率は「–」（%なし）、メタは「今週は対象なし」。対象があるとき `round(done/total*100)` と「{done}/{total}件」
- **C-314** Review テーブルの見出しは 教科 / タスク名 / 前回 / 次回復習 / 復習回 / 間隔 / 状態 / 操作 の8列（`86px minmax(200px,1fr) 84px 96px 68px 86px 72px 158px`）で、`min-width:960px` を下回ると横スクロールする
- **C-315** 並び替え「期限順」では 遅れ+今日 → 今後 → 完了 の順に並び、その中で due の昇順になる
- **C-316** 並び替え「教科ごと」では `SUBJ` の定義順に教科がまとまり、教科内は未完了が先・完了が後、その中で due 昇順になる
- **C-317** 並び替えが「期限順」のときだけ、最初の『未完了かつ due が明日以降』の行の直前に「▼ 明日から先の復習」の仕切りが入る（その行が先頭の場合は入らない）。教科ごとでは一切出ない
- **C-318** 教科チップは、その教科の未完了の復習が1件以上あるものだけ件数付きで表示され、押すと絞り込み、もう一度押すと解除される
- **C-319** 表の「前回」「次回復習」の日付は 今日→「今日」、明日→「明日」、昨日→「昨日」、それ以外は M/D、空なら「–」（`fmtD`）
- **C-320** 「復習回」列は「第N回」のピルで、`title` 属性が「{タスク名}の第N回復習」になる
- **C-321** 状態列は 完了→「完了」(tx3/透明)、期限切れ→「{N}日遅れ」(pink、最低1日遅れ)、今日→「今日」(grn)、明日→「明日」(acc)、それ以降→「今後」(tx2/bg3)
- **C-322** 行は左端に 3px の教科色ボーダーを持ち、未完了かつ `due <= 今日` の行は背景に教科色5%のティントが乗り、完了行は `opacity:.45` + `line-through` になる。hover で背景が `var(--bg3)`
- **C-323** 『未追加・未完了・due<=今日』の行にだけ「＋ 今日へ」（緑）が出て、押すと `added=true` + order 追加 + トースト「「{教科} {タスク名}」を今日のToDoに追加しました」
- **C-324** 『added かつ 未完了』の行には「✓ 追加済み」テキストが出る
- **C-325** 『未完了かつ due<=今日』の行にだけ「完了」ボタンが出て、押すと理解度モーダルが開く
- **C-326** 行クリックでも「⋯」ボタンでも詳細ドロワーが開き、ボタン類のクリックは行クリックに伝播しない
- **C-327** フッターに「行クリック / ⋯ で詳細パネル(日付変更・削除) · 期限順: 遅れ → 今日 → 今後 → 完了 / 教科ごと: 教科でまとめて表示 · 完了時に理解度を記録すると次の復習が自動で組まれます」が出る
- **C-328** Review 画面にも専用の空状態テキストは無い（0件なら head + foot のみ）
- **C-329** 復習詳細ドロワーは右から `slideInR .2s ease` で開き、幅は `panelW.review`（既定380px、`max-width:94vw`）、左端をドラッグすると 260〜max(320, 画面幅×0.92) の範囲でリサイズされ、離すと localStorage に保存される
- **C-330** ヘッダに 教科チップ・「第N回」チップ・「{stage}の復習」チップ（緑）が並び、時間割由来なら「時間割 N限」バッジも出る
- **C-331** タイトルをダブルクリック（モバイルは420ms以内の連続タップ）すると入力欄になり、入力するそばから復習の title が更新される。Enter でフォーカスが外れ、Escape で編集が終わる。下に「名称はダブルタップで編集できます」が出る
- **C-332** 情報カードは 前回学習日 / 次回復習日 / 今回の復習(第N回) / 復習タイミング(stage) / 目安時間({min}分) の5枚で、次回復習日は未完了かつ `due<=今日` なら pink になる
- **C-333** 「＋ 今日のToDoに追加」を押すと `added=true` になりトースト「「{教科} {タスク名}」を今日のToDoに追加しました」が出る
- **C-334** 追加済みのときは「✓ 今日のToDoに追加済み」と「今日のToDoから外す」が出て、外すと `added=false`・order から除去・トースト「今日のToDoから外しました」になる
- **C-335** **(v0.9 変更)** 「＋ 1日」「− 1日」は due 自身を起点に相対シフトし（13日枠に依存しない）、トースト「次回復習日を {日付ラベル} に変更しました」が出る
- **C-336** **(v0.9 変更)** due が期限切れ／13日以上先の復習に「＋ 1日」「− 1日」を押しても「今日」へは飛ばず、その due の前後1日に動く（旧実装は `DIDX` が undefined になり今日へ飛んでいた）
- **C-337** 「テスト計画に変更」を押すとその復習が削除されてテスト計画(`type:'test'`)とミニタスク1件が作られ、Tests に切り替わって計画エディタが開き、トースト「復習をテスト計画に変更しました」が出る
- **C-338** テスト計画に変換したとき、due が今日より後なら生成ミニタスクの day が今日になって今日の ToDo に入り、due が今日以前なら day が空（未配分）になる
- **C-339** 「Reviewから完全に削除」を押すと reviews と order から消え、ドロワーが閉じ、トースト「復習アイテムを削除しました」が出る
- **C-340** added かつ未完了の復習は、今日の負荷（`loadsMap`）に min ぶん加算される（他の日には加算されない）
- **C-341** 今日の ToDo に載る復習は、size 表示が実際の min に関わらず**常に「S」**になる
- **C-342** 完了済みの復習のチェックを押すと（モーダルなしで）`done=false` に戻る。生成済みの次回復習も studyLog も戻らない
- **C-343** ToDo 詳細で復習を選ぶと種別ラベルが「復習」になり、細分化タスクの追加 UI が出ず「細分化はまだありません」と表示される

### 10.12 タスク追加（Add）

- **C-344** ナビの「タスク追加」または `n` キーで view が `'add'` になる
- **C-345** Add 画面は中央寄せの `max-width:1180px` で、左が入力フォーム `minmax(420px,600px)`、右が時間割 `minmax(320px,1fr)` になる
- **C-346** 種類チップは「今日のタスク」「復習」「予習」「テスト」の4つが左からこの順で並ぶ
- **C-347** 種類チップで「テスト」または「予習」を選ぶと詳細セクションが自動的に開く（`addDetailOpen=true`）
- **C-348** 種類チップを切り替えると `addErr` と `addDone` がクリアされ、成功バナーが消える
- **C-349** 日付見出しは種類によって 予定日 / 復習日 / 期限日 / テスト日 に変わり、`input[type=date]` の `min` が今日になる
- **C-350** 種類が prep / test のときだけ「開始予定日(任意)」「計画開始日(任意) — 細分化タスクをこの日から配分」の第2日付欄が出る
- **C-351** 種類が single / review のときだけトップレベルのサイズチップ（XS·5分 / S·10分 / M·20分 / L·30分）が出る
- **C-352** 「今日」チップを押すと `addDay` が今日、「明日」で明日になり、日付エラーが消える。`addDay` が今日なら「今日」チップの背景が `var(--acc)`・文字が `var(--onAcc)` になる
- **C-353** タスク名入力で Enter を押しても送信されずフォーカスも移動しない（`preventDefault` のみ）
- **C-354** 教科入力で Enter を押すと `#add-day`（日付入力）にフォーカスが移る
- **C-355** 教科チップは `recentSubjs`（直近4件）を先頭にした順で最大8個表示され、押すと `addSubj` がその教科になり教科エラーが消える
- **C-356** 詳細の見出しは閉じているとき「▸ 詳細(細分化・メモ)」、開くと「▾ 詳細(細分化・メモ)」（復習では「(メモ)」）になり、右に「クリックで開閉」が出る
- **C-357** 細分化タスク入力（`#add-mini`）で Enter を押すと `addMinis` に1件追加され入力欄が空になり、再度 `#add-mini` にフォーカスが戻る
- **C-358** ミニタスクサイズチップを選ぶと `#add-mini` に自動でフォーカスが移る
- **C-359** 追加済みミニタスク行の ✕ を押すとその行だけが `addMinis` から消える（トーストなし）
- **C-360** 種類が test / prep のときだけ「自動で細分化」チップ（1件ずつ / DUO 範囲分割 / 青チャート用）が出る
- **C-361** DUO モードで開始1・終了400・区切り10 のときボタンが「40件を生成」になり、生成すると「1–10」「11–20」…「391–400」（en-dash 区切り）が `addMiniSize` のサイズで追加される
- **C-362** 青チャートモードで開始1・終了4 のときボタンが「16件を生成」になり、生成順は **1fe,1be,2fe,2be,3fe,3be,4fe,4be の後に 1fp,1bp,2fp,2bp,3fp,3bp,4fp,4bp**（例題を全プリント分 → 練習）になる
- **C-363** 生成件数が 500 を超えるとトースト「一度に生成できるのは500件までです」が出て何も追加されない
- **C-364** 生成タイトルがすべて既存と重複する場合トースト「同じ名前のミニタスクはすでに追加済みです」が出る
- **C-365** 生成成功時トースト「{n}件のミニタスクを生成しました」が出る
- **C-366** DUO の入力が不正なとき「DUOの開始・終了・区切り数を正しく入力してください」、青チャートが不正なとき「プリントの開始番号と終了番号を正しく入力してください」が出る
- **C-367** タスク名が空で送信するとタスク名欄の下に「タスク名を入力してください」が `var(--pink)` で表示される
- **C-368** 教科が空で送信すると「教科を入力してください」、日付が空で送信すると「{予定日|復習日|期限日|テスト日}を選んでください」が出る
- **C-369** 候補にない教科名を自由入力して追加すると `SUBJ` にパレット色が巡回で割り当てられ、以降の全画面の教科候補・チップに現れる
- **C-370** 種類 single で追加すると `extras` に1件増え、`src` が「単発タスク」（メモがあれば「単発タスク · {メモ}」）になる
- **C-371** 種類 single で予定日を**今日**にして追加すると order に id が追加され、コックピットの今日のタスクに即時表示される
- **C-372** 種類 single で細分化タスクを入れて追加すると extra に `subs` / `subsDone`(全false) / `subSizes` が付与される
- **C-373** 種類 test/prep で追加すると `PLANS` に `name` が「{教科} {タスク名}」の計画が作られ、メモが空なら `range` が「範囲は未設定」になる
- **C-374** 種類 test/prep で細分化タスクを1件も入れずに追加すると「内容を細分化する」(M·20分) が1件だけ作られ、その `day` は**空文字（未配分）**になる
- **C-375** 種類 test/prep で細分化タスクを入れて追加すると、開始日〜GOAL前日の空き容量に比例して日付が自動配分される（GOAL当日には置かれない、`'even'` モード）
- **C-376** 開始予定日が GOAL より後、または今日より前のときは開始日が今日に補正される
- **C-377** 追加成功後、緑のバナーに「✓ {label}」と「続けて追加」「{ToDoで見る|Reviewで見る|Testsで見る} →」が表示され、同じ文言のトーストが出る
- **C-378** 「続けて追加」を押すと成功バナーが消え `#add-title` にフォーカスが戻る。「{...}で見る →」を押すと対応する画面へ移動しバナーが消える
- **C-379** 追加後にタスク名・メモ・細分化リストはクリアされるが、教科・日付・サイズ・種類はそのまま残る
- **C-380** 追加後 `recentSubjs` の先頭にその教科が入り、最大4件に切り詰められる
- **C-381** 右カラムの時間割の週ストリップは ‹ / 月〜金の5日（曜 M/D）/ › の7ボタンで、選択中の日は `var(--acc)` 背景になる
- **C-382** 時間割スロットをクリックすると種類が「復習」に切り替わり、タスク名が「{N}限の復習」、教科がそのコマの教科になり、トースト「{N}限「{教科}」をAddに入力しました」が出る（`held` でないコマはクリック無効）
- **C-383** 時間割から入力した状態では Add 上部に橙色の「時間割から入力 · {M/D(曜) N限}」バナーと「解除」ボタンが出る
- **C-384** 時間割スロットに既にその日その限から作られた項目（復習含む）があると「✓ 追加済み」バッジが出て背景が緑寄りになる
- **C-385** スロットのメタは `held` なら「基本: {教科}」または「臨時コマ」、そうでなければ「基本なし」と表示され、未開講は `opacity:0.58` になる
- **C-386** 送信ボタンの下に「サイズ(XS=5分 / S=10分 / M=20分 / L=30分)や細分化は、あとからミニタスク編集でも変更できます。」が表示される

### 10.13 計画編集ドロワー

- **C-387** 「✎ 編集」または計画名セルのクリックで右側に計画編集ドロワーが `slideInR` で開き、背景に `rgba(5,9,20,.45)` のオーバーレイが敷かれる
- **C-388** 「しまう ›」を押すと右端 54px の縦書きタブ（`border-radius:12px 0 0 12px`）になり、オーバーレイが transparent かつ `pointer-events:none` になって**背後の画面が操作できる**
- **C-389** 折りたたんだタブの「‹」を押すとドロワーが元の幅に戻る
- **C-390** ドロワーの左端 7px をドラッグすると幅が 320〜min(520, max(360, 画面幅×0.62)) の範囲で変わる
- **C-391** ヘッダに「{テスト|予習} · 期限 {日付ラベル} · {範囲}」が表示される
- **C-392** 進捗ブロックに 64px ドーナツと「ミニタスク {完了} / {全数} 完了」「未完了ぶん 約{分}分」が表示される
- **C-393** 名前・教科・日付のいずれかが不正なまま保存するとトースト「名前・教科・日付を入力してください」、成功すると「計画を更新しました」が出る
- **C-394** 計画編集で期限を前倒しすると、新しい期限以降にあったミニタスクは期限の前日へ移動する
- **C-395** ミニタスク行のサイズボタンを押すたびに XS→S→M→L→XS と巡回し min も 5/10/20/30 に更新される
- **C-396** ミニタスク名をダブルクリック（モバイルは360ms以内のダブルタップ）するとインライン編集になり、Enter / Escape / blur で確定する
- **C-397** 日付入力を GOAL 当日以降にしようとするとトースト「タスクはGOALの前日までに設定してください」が出て変更されない
- **C-398** ミニタスクの日付を変更すると `manualDay` が true になり、以後の再配分の対象外になる（**解除する UI は存在しない**）
- **C-399** ミニタスクの日付を今日にすると order に追加され、今日から外すと order から除かれる。トースト「「{タイトル}」を{日付ラベル}へ移動しました」
- **C-400** ミニタスクをドラッグして並べ替えると、**日付は位置に残る**（並べ替え後の i 番目が元の i 番目の日付を持つ）
- **C-401** 並べ替え中、ドロップ位置が行の上半分なら上端に、下半分なら下端に `inset 0 ±3px 0 var(--acc)` の挿入線が出る
- **C-402** 並べ替え後にトースト「ミニタスクの順番を変更しました」が出る
- **C-403** 並べ替え後は FLIP アニメーション（`transform` → `transition:transform .18s ease`、220ms 後に解除、3px 未満の移動はスキップ）で行が滑らかに動く。ドラッグ中の要素は対象外
- **C-404** ドラッグ中のミニタスク行は背景 `var(--bg3)`・border `var(--acc)`・`scale(1.02)`・`0 10px 26px rgba(0,0,0,.45)`・`opacity:.85` になる
- **C-405** ミニタスク行の ✕ で削除するとトースト「「{タイトル}」を削除しました」が出て order からも除かれる
- **C-406** 「ミニタスクを追加…」で Enter を押すと `day=''` の未配分ミニタスクが追加され、トースト「ミニタスクを追加しました({サイズ}·{分}分 · 未配分)」が出て入力欄にフォーカスが戻る。**選んだサイズはリセットされない**
- **C-407** 全ミニタスクが完了済みの計画では削除ボタンが「完了として非表示にする」（緑）になり、**確認ダイアログ無しで** `studyLog` へ勉強時間を移してから計画が消え、トースト「「{名前}」を完了として非表示にしました（勉強時間は保持）」が出る
- **C-408** **(v0.9 変更)** 未完了ミニタスクがある計画では削除ボタンが「この計画を削除」になり、`window.confirm` が2行（「「{名前}」と、そのミニタスクをすべて削除しますか？」＋改行＋「完了済みミニタスクの勉強時間は、データ画面の記録に残ります。」）で出る。OK でトースト「計画を削除しました」
- **C-409** 計画を削除するとその計画のミニタスクがすべて `segs` と `order` から消える
- **C-410** 計画編集ドロワーの削除ボタンには hover 効果が付かない（`style-hover` の値に `{{ }}` が含まれ CSS として無効）
- **C-411** ミニタスクが0件の計画では進捗表示が「0/0 完了」になり、進捗リングと進捗バーの width が `NaN` になる

### 10.14 データ画面

- **C-412** データ画面はデスクトップ2カラム `minmax(320px,2fr) / minmax(430px,3fr)` で、左が「教科別 勉強時間」、右が「テスト結果」になる
- **C-413** 左カード右上に「学習ログ+完了タスク」、下部に「タスクや復習を完了すると、その分数が自動で加算されます」が表示される
- **C-414** 円グラフは canvas ではなく `viewBox="0 0 42 42"` の inline SVG で、`cx=21 cy=21 r=15.9 stroke-width=7` の circle を `stroke-dasharray` で重ねて描く（土台円は `stroke="var(--line)"` で常に1本）
- **C-415** 各弧の `stroke-dasharray` は `pct.toFixed(2) + ' ' + (100-pct).toFixed(2)`、`stroke-dashoffset` は `(25 - 累積pct).toFixed(2)` になる
- **C-416** 円グラフの中央に合計時間（例 1.5h）が 700 22px 'Space Grotesk' で表示され、その下に「合計」が出る
- **C-417** 勉強時間の合計は `studyLog` の全 min ＋ done な segs の min ＋ done な extras の min の総和である（**(v0.9 変更)** 期間チップが「全期間」のときの値。C-538 以降を参照）
- **C-418** done な seg の教科は seg 自身ではなく `PLANS[seg.plan].subj` から取られる
- **C-419** done なタスクのチェックを外すと、その分数が即座に円グラフと凡例から減る
- **C-420** 時間表示は `(Math.round(m/6)/10)+'h'` で、20分は 0.3h、25分は 0.4h、0分は 0h と表示される
- **C-421** 凡例は分数の降順に並び、各行は 9×9 の角丸3pxの色見本・教科名・時間・パーセント（width 34px 右寄せ）で構成される
- **C-422** 勉強時間が0のとき、円グラフは土台円のみ・中央は 0h・凡例は空になる（**専用の空状態テキストは出ない**）
- **C-423** **(v0.9 変更)** データ画面に期間切替・ストリーク・ヒートマップ・エクスポート（JSON/CSV）は**存在する**（C-538〜C-563）。カレンダー・棒グラフ・インポート UI は引き続き存在しない
- **C-424** `studyLog` を削除・編集する UI は存在しない
- **C-425** 「テスト結果」カードのドットは `var(--vio)`、右上に「クリックで推移を表示」が表示される
- **C-426** テスト結果が0件のとき「まだ記録がありません。返却されたテストの点数を下から記録しましょう」が表示される
- **C-427** テスト結果はテスト名でグループ化され、グループ行は最新記録日の降順に並ぶ
- **C-428** 各グループ行は 教科ピル / テスト名 / 「N回 · 最新 M/D」 / 前回比 / 最新点数+点 / → の6要素で構成され、左端に 3px の教科色ボーダーが付く
- **C-429** グループ行の教科ピルの色は、そのグループの**最新レコードの教科**の色になる
- **C-430** 前回比は 記録が1件なら「–」、上昇なら「▲ +N」（緑）、下降なら「▼ -N」（ピンク）、同点なら「± 0」（tx3）と表示される
- **C-431** グループ行にホバーすると background が `var(--bg3)`、border-color が `var(--line2)` になる
- **C-432** グループ行をクリックすると `scoreSel` にテスト名がセットされ、右から推移ドロワーがスライドインする
- **C-433** テスト名入力は `datalist#compass-score-names` を参照し、候補は「アクティブなテスト計画の名前」→「既存の記録のテスト名」の順に重複なしで並ぶ
- **C-434** テスト名に計画と同じ名前を入力すると、教科欄がその計画の教科で自動的に埋まる
- **C-435** 教科入力は `datalist#compass-subj-list2`（Add 画面と同じ `addSubjOptions`）を参照する
- **C-436** 点数入力は `type=number min=0 max=100` で幅78px、日付入力は `type=date` で `max` が今日、幅150px
- **C-437** テスト名・教科・点数のいずれかが空/非数値のまま「＋ 記録」を押すとトースト「テスト名・教科・点数を入力してください」が出る
- **C-438** 記録された点数は 0〜100 にクランプされ（150 → 100）、トースト「「{テスト名}」{点数}点を記録しました」が出る
- **C-439** 記録に成功するとテスト名欄と点数欄だけがクリアされ、教科欄と日付欄は残る。**Enter キーでは記録できない**
- **C-440** 記録した日付を変えてリロードすると日付欄は今日に戻る（`scoreDay` は非永続）
- **C-441** 「テスト名はTestsで作った計画から選べます · 同じテスト名で記録すると推移がつながります」がカード下部に表示される
- **C-442** 推移ドロワーは右から出て幅 `panelW.score`（既定400px）、左端をドラッグすると 260〜max(320, 画面幅×0.92) でリサイズされる
- **C-443** 推移ドロワーのヘッダは 教科ピル / テスト名（ellipsis）/ ✕ の3要素
- **C-444** 統計タイルは 最新 / 前回比 / 最高 / 平均 の4つで、最高は最大値、平均は `Math.round(合計/件数)`。記録が1件のとき前回比は「–」（tx3）
- **C-445** 折れ線グラフは `viewBox="0 0 360 200"` の inline SVG で、y=14/92/170 に3本の水平グリッド線と 100/50/0 のラベルが付く
- **C-446** 点の x 座標は `30 + (その日 - 最古日)/(最新日 - 最古日) × 308`（日付の実距離に比例）、y 座標は `14 + (100 - 点数)/100 × 156`
- **C-447** 全記録が同じ日付のとき、すべての点の x 座標は 184 になる
- **C-448** 各点には r=3.5 の円、その 8px 上に点数ラベル（700 10px 'Space Grotesk'）、y=188 に日付ラベル（9px）が描かれ、色は教科色になる
- **C-449** 「記録の履歴 — 同じテスト名で追加すると、ここにつながります」が表示される
- **C-450** 履歴リストは新しい順に並び、各行は 日付ラベル / 前回差 / 点数+点 / ✕ で構成される。今日の記録は「M/D(今日)」
- **C-451** 履歴の前回差は1つ古い記録との差で、正なら「+N」（緑）、負なら「N」（ピンク）、同点なら「0」（tx3）、最古の記録では空文字になる
- **C-452** 履歴行の ✕ をクリックするとその1件だけが `scores` から削除され、確認ダイアログは出ない（hover で `color:var(--pink);background:var(--pinkBg)`）
- **C-453** 推移ドロワーは 背景クリック / ✕ / Escape / 表示中グループの最後の1件を削除、のいずれでも閉じる
- **C-454** `Cmd/Ctrl+Z` で `studyLog` と `scores` が1つ前の状態に戻り、同時に `scoreSel` が null になってドロワーが閉じる
- **C-455** 点数は計画の完了状態と連動せず、計画を削除しても記録は残る

### 10.15 アプリスイッチャー

- **C-456** アプリスイッチャーは backdrop（`z-index:110`、`rgba(3,12,24,.72)` + `blur(16px)`、note では `rgba(8,8,7,.82)` で blur なし）+ `role="dialog" aria-modal="true" aria-label="Compassアプリ一覧"` のパネルで、backdrop クリックで閉じる
- **C-457** パネルは `width:min(680px,94vw)` / 145deg のグラデーション背景 / `border-radius:22px` / `0 34px 110px` の影で `popIn .2s ease` で開く
- **C-458** 「COMPASS APPS」（700 11px 'Space Grotesk', LS .12em, `var(--acc)`）「アプリを切り替える」（700 20px）「学習や毎日の記録を、Compassからひとつにつなげます。」が表示される
- **C-459** 現在アプリカードには「現在のアプリ」「Compass Tasks」「学習タスク・復習・試験計画」と ✓ が表示され、62×62 のアイコンが載り、クリックすると閉じる。hover で `translateY(-2px)`（note では transform なし）
- **C-460** 「ほかのアプリ」「アプリを選ぶと移動できます」の区切りの下に3枚のタイル（感謝ノート / 次のアプリ / アプリを追加）が 3列 grid で並ぶ
- **C-461** タイルは `--app-accent`（`#ff8fb8` / `#9a79f6` / `#43e6b1`）で枠・背景・アイコン・ステータスが着色される
- **C-462** 感謝ノート（説明「毎日の「ありがとう」を残すノート」、アイコン ♡）のステータスは「開く ↗」で、クリックすると `window.top` が `https://kansha-note.vercel.app/` へ遷移する
- **C-463** url が空のタイル（「次のアプリ」/「新しいCompassアプリのための場所」、「アプリを追加」/「これから増えるアプリをここに並べます」、いずれもアイコン ＋）はステータスが「COMING SOON」で `aria-disabled="true"` になり、クリックするとトースト「「{アプリ名}」は準備中です」が出る

### 10.16 レスポンシブ

- **C-464** 幅1180px以下でコックピットが2カラムになり、計画パネルが全幅の2列 grid（タイトルと主要ボタンは全幅）になり、パネル高さが auto / `min-height:520px` になる。検索欄が `min-width:260px` になる
- **C-465** 幅820px以下でナビが画面下部固定バー（高さ `calc(68px + env(safe-area-inset-bottom))`、`z-index:100`、`backdrop-filter:blur(20px)`、note では不透明）になる
- **C-466** 幅820px以下でブランドとナビフッターが非表示になり、代わりにトップバー左に 36×36 のランチャーボタンが出る
- **C-467** 幅820px以下でナビ項目が縦積みアイコン + 9.5px ラベルになり、選択マーカー(`::after`)と番号キーが消え、`border-radius:14px` になる
- **C-468** 幅820px以下で「タスク追加」が直径58px の円形 FAB になり、`top:-15px` 浮き上がり、`background:var(--org)`、アイコンはプラス記号のみ（28×28、stroke-width 2.4）、ラベル非表示、`box-shadow:0 14px 28px -10px rgba(0,0,0,.66)` になる
- **C-469** FAB を押し込むと `transform:scale(.93)` に縮む。`.is-active` / hover でも色は変わらない
- **C-470** 幅820px以下でナビの ⚠ バッジが項目の左上（`top:2px, right:calc(50% - 20px)`, 8.5px）に絶対配置される
- **C-471** 幅820px以下でトップバーが折り返し、検索欄が2行目に全幅で入る（order:4）
- **C-472** 幅820px以下で画面タイトルのサブテキスト・「⚠ 未完了 N件 → 再配分」ピル・「⌘K」バッジが非表示になる
- **C-473** 幅820px以下でコックピットが `display:block` の縦積みになり、各パネル下端に 1px のボーダーが入る
- **C-474** 幅820px以下で ToDo / Data が縦積み（`display:flex; flex-direction:column`）になり、Add が1カラムになる
- **C-475** 幅820px以下でタイムラインが `156px + 日数×92px` になり、「← 横にスワイプして日付を確認 →」のヒントが右寄せで出る
- **C-476** 幅820px以下で復習テーブルがヘッダ非表示のカードレイアウト（3領域 grid、`grid-template-areas` 3行）になり、各セルに `data-label`（前回/次回/復習回/間隔/状態）が 8.5px の小ラベルとして `::before` で表示される
- **C-477** 幅820px以下で時間割の週ストリップが `28px + 5列 + 28px` になる
- **C-478** 幅820px以下でミニタスク編集行のドラッグハンドルと日付ラベルが消え、日付 input（`color-scheme:dark` 固定）と ↑↓ ボタン（38×36）が出る
- **C-479** 幅820px以下でアプリ切替グリッドが1列になり、タイルが 44px アイコン + 本文 + ステータスの横並びになる
- **C-480** 幅820px以下で `.score-group-row` が3列 grid に再配置され、「→」（6番目の子）が `display:none` になる
- **C-481** 幅820px以下で `.todo-summary` が `flex-wrap:wrap` になり、「▶ 集中モード」が `width:100%; min-height:44px` になる

### 10.17 永続化・ランタイム

- **C-482** `exportData()` は必ず `{version:1, plans:{...}, state:{...}}` の3キーだけを持つオブジェクトを返す（`version` は読み込み時に一切参照されない）
- **C-483** `exportData().plans` は `this.PLANS` の浅いコピー、`state` は `persistentKeys()` の23キーを**その配列順で**代入したオブジェクト
- **C-484** PUT のボディは `JSON.stringify({ data: exportData() })` で、`Content-Type: application/json` ヘッダを付ける。常に全状態を送るフル置換
- **C-485** state が変化すると 280ms のトレーリングデバウンス後に PUT が発火し、待機中にさらに変わるとタイマーがリセットされる
- **C-486** `exportData()` の JSON が前回保存内容と同一なら PUT は発火しない（ドラッグ状態など非永続キーだけの変更では保存されない）
- **C-487** 同一の JSON が既にキュー済みのときはタイマーを延長せずそのまま待つ
- **C-488** 直前の保存試行と同一の JSON で、その試行から 1200ms 未満のときは保存をスキップする
- **C-489** `localStorage['compass-ui-data']` への書き込みはデバウンスされず、state 変化直後に同期的に行われる
- **C-490** 保存キューに積んだ時点で `cloudStatus` が `'saving'` に変わり（既に `'saving'` なら setState しない）、PUT 成功で `'saved'`、失敗で `'local'` になる
- **C-491** `beforeunload` / `visibilitychange` / `pagehide` による保存フラッシュは存在せず、280ms 以内にページを閉じるとクラウド保存は失われる（localStorage には残る）
- **C-492** クラウド読み込み中（`_saveReady=false`）の state 変更では保存が走らない
- **C-493** `savePrefs()` は `localStorage['compass-ui']` に `{theme, themeVersion:3, panelW}` だけを書き、テーマ切替 / 数字キー 1〜6 / n キー / パネルリサイズの mouseup で呼ばれる
- **C-494** `dataPatch` は `raw.data` があればそれを、なければ `raw` 自体をペイロードとして扱う
- **C-495** `dataPatch` は `payload.plans` がオブジェクト（配列でない）のときだけ `this.PLANS` を差し替える。plans が無い保存データでは既存の PLANS が残る
- **C-496** `dataPatch` は `persistentKeys` のうち `src[k] !== undefined` のキーだけを patch に入れ、**未知のキーは無視する**（次回保存で消える）。型検査は一切ない
- **C-497** 読み込み時、`plan.due` が `YYYY-MM-DD` 形式で `seg.day >= plan.due` の seg は day を `plan.due` の前日に戻す（`day` が空文字の seg と孤児 seg は対象外、`_dataRepaired` も立たない）
- **C-498** 読み込み時、reviews に `_legacyIndex` を一時付与して系列ごとに並べ替え、`reviewNo` と `seriesId` を補完する（`_legacyIndex` は保存されず、元の配列順は保持される）
- **C-499** 系列キーは `seriesId` が2件以上あれば `'series:'+seriesId`、そうでなければ subj/title/timetableDate/timetablePeriod を `|` で連結した `'legacy:'` キー。系列内は `last||due` 昇順 → `due` 昇順 → done が先 → 元の配列順で並べる
- **C-500** 同じ系列で最初の未完了より大きい `reviewNo` を持つ復習は読み込み時に削除され、order と selId からも取り除かれる
- **C-501** `done && added && due < TODAY` の復習は読み込み時に `added:false` にされ、order と selId から取り除かれる（履歴としては残る）
- **C-502** 読み込み時にデータ修復（`_dataRepaired`）が起きた場合、クラウド読み込み完了直後に即座に `saveNow()` で修復結果を保存する
- **C-503** id 生成は `'u'`/`'p'`/`'s'` 接頭辞 + `Date.now().toString(36)` + `Math.floor(Math.random()*999)`。スコアは `'sc'`、カウントダウンは `'cd'` で乱数は `*99`
- **C-504** 保存されるすべての日付は `'YYYY-MM-DD'` 文字列で、時刻やタイムスタンプはデータに含まれない
- **C-505** `TODAY` は `Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Tokyo'})` で求めた日本時間の日付で、日付の前後比較はすべて文字列の辞書順比較で行われる
- **C-506** `sessionStorage` / `indexedDB` は一切使用せず、localStorage のキーは `'compass-ui'` と `'compass-ui-data'` の2つだけ
- **C-507** `undoPayload` は `{plans: this.PLANS, state: undoKeys の14キー}` の形で、`componentDidUpdate` で JSON が変化したときに直前の値をスナップショットとして保持する（Undo 適用中は新しいスナップショットを取らない）
- **C-508** テンプレートの `{{ }}` テキストは `<span class="sc-interp">` に包まれて描画される（`:nth-child` を使うモバイル CSS の前提）
- **C-509** `style-hover` / `style-focus` 属性は単一クラス（`.scpN:hover` / `.scpN:focus`）の CSS ルールとして生成され、`!important` を持たない
- **C-510** logic の `setState` はホストの `logic.state` を同期的に書き換えるため、`setState` 直後に `this.state` を読むと新しい値が見える。updater が `null` を返すと state は変化しない
- **C-511** `componentDidUpdate` はレンダーのたびに呼ばれ、Undo スナップショット判定と `scheduleSave` を実行する
- **C-512** `data-props` 既定値により `this.props` は `glow=3` / `radius=12` / `accent='#3d3629'` になり、`--rad` は 12px になる
- **C-513** `data-props` に `$preview` があるため `FULL_PAGE_CSS`（`html,body{height:100%}`）は注入されず、高さは helmet 内の CSS が担う
- **C-514** テンプレートの全要素に `data-dc-tpl` 属性（連番）が付与され、ルートは `<div id="dc-root"><div class="sc-host" data-sc-name="…">` で包まれる
- **C-515** `renderVals()` が例外を投げると赤い `.sc-logic-error` バナーが重ねて表示される
- **C-516** `value` / `checked` に対応する `{{ }}` が undefined のとき、value は空文字、checked は false として描画される（常に controlled）

### 10.18 v0.9 で追加・修正された挙動

> C-517 以降は v0.9（`f4799ce` / `be2f44e` / `4796eeb` / `217fc9d`）で入った差分。**書き換え版は必ずこちら（修正後）の挙動を再現する。**
> 既存項目のうち C-51 / C-105 / C-160 / C-275 / C-302 / C-335 / C-336 / C-408 / C-417 / C-423 は本文を更新済み。

#### 不具合修正（§11 Q1 / Q3 / Q4 / Q8 / Q12 / Q30）

- **C-517** `todayIds` は `state.order` に加えて、`segs` の `day===今日`・**`extras` の `day===今日`**・`reviews` の `added && !(done && due<今日)` を、いずれも order 未収録のものだけ**この順で**追記して作られる
- **C-518** 明日以降の日付で作った単発タスク(extra)は、その予定日が来ると自動的に「今日のタスク」「今日のToDo」に現れる。order 経由で並んでいる項目より必ず後ろに入り、手動の並び順（order）は変わらない
- **C-519** `day` を持たない extra は従来どおり order 経由でしか今日に出ない（自動収集の条件は `x.day === 今日` の厳密一致）
- **C-520** 未完了ミニタスクを含む計画を「この計画を削除」で削除すると、完了済みミニタスクが `{day: seg.day || 今日, subj: 計画の教科, min: seg.min}` として `studyLog` へ転記されてから消える。データ画面の勉強時間の合計は削除前後で変わらない
- **C-521** stage に次の間隔が無い復習（レガシー移行分の `'定着 🎉'` など、`stageDays` にキーが無いもの）を「まあまあ」で完了すると、次回の復習は作られずトースト「定着！「{タスク名}」の復習は完了です 🎉」が出る（旧実装は +1日の `'定着 🎉'` 復習を無限に作り続けていた）
- **C-522** 「不安…」で完了したときだけは stage に関係なく必ず翌日の復習が作られる（`grade === 'low'` は系列終了の分岐に入らない）
- **C-523** 時間割スロットの教科上書きは表示中の日付（`addScheduleDate`）をキーに `dayOverrides` へ書かれ、読み出しと同じキーになる。土日にフォーカスした状態で書き換えても（`addScheduleDate` はその週の月曜）その場で画面に反映される
- **C-524** 旧バージョンが土日キーで書いた `dayOverrides` エントリは残るが、どこからも読まれない（マイグレーションは行わない）
- **C-525** トップバーの「⚠ 未完了 N件」とナビ「試験計画」の `⚠N` は `manualDay` のミニタスクも数え、計画行の `⚠M`（`p.odCount`）と常に一致する
- **C-526** 再配分の対象（`redistTargets`）は従来どおり `manualDay` を除外するので、「⚠ 未完了 N件 → 再配分」を押しても実際に動く件数が N より少ないことがある
- **C-527** Cockpit 復習パネルの空状態は「復習の予定はありません」「復習タスクを完了して理解度を記録すると、翌日→3日後→1週間後→2週間後の間隔で次の復習が自動で積まれます。」になる（Review 画面のフッター文言は従来どおり変更なし）

#### 復習の一括ToDo追加 / 相対シフト

- **C-528** Review 画面の統計カード3枚のすぐ右に「今日の復習をまとめてToDoへ」の緑ピルボタン（`background:var(--grn)`, `color:var(--onAcc)`, `border-radius:99px`, `box-shadow:var(--gGrn)`）が出て、末尾に件数バッジ（`background:color-mix(in srgb,var(--onAcc) 22%,transparent)`）が付く
- **C-529** ボタンの表示条件と対象は行の「＋ 今日へ」と完全に同じ `!added && !done && due <= 今日` で、**遅れている復習も含む**
- **C-530** 対象が0件のときボタン自体が出ない（押した直後は0件になるので消える）
- **C-531** ボタンは教科の絞り込み（`revFilter`）と並び替え（`revSort`）を見ないので、絞り込みで隠れている行も対象に入り、件数バッジも変わらない。「期限順」「教科ごと」どちらでも出る
- **C-532** ボタンを押すと対象全件が1回の `setState` で `added=true` になり、order 未収録の id だけが order 末尾へ `S.reviews` の配列順で追加される
- **C-533** ボタンを押したときのトーストは1回だけで「{N}件の復習を今日のToDoに追加しました」
- **C-534** 復習詳細の「＋ 1日」「− 1日」は `isoShift(その復習の due, ±1)` で相対シフトする。8/1（5日遅れ）の「＋ 1日」は 8/2、20日先の「＋ 1日」は21日先になる
- **C-535** シフトの下限は `min(現在の due, 今日)`。今日の復習に「− 1日」、期限切れの復習に「− 1日」を押しても due は動かない
- **C-536** 下限に張り付いて日付が動かないときは `mutReview` せず、トーストが「次回復習日はこれ以上前にできません」になる（「変更しました」は出ない）
- **C-537** `due` が `YYYY-MM-DD` 形式でない場合、シフトの起点は今日になる

#### データ画面: 期間切替 / ストリーク / ヒートマップ

- **C-538** データ画面の最上段に全幅（`grid-column:1/-1`）の行があり、左に期間チップ（今週 / 今月 / 全期間）のピルグループ、その右に期間ラベル、右端（`margin-left:auto`）にストリークピルが並ぶ
- **C-539** 期間チップの既定は「全期間」で、選択中は `color:var(--onAcc)` / `background:var(--acc)`、非選択は `color:var(--tx2)` / `background:transparent`
- **C-540** `dataRange` は `persistentKeys()`（23キーのまま）に含まれないので、期間を切り替えてもクラウド PUT も localStorage 書き込みも起きず、リロードすると「全期間」に戻る
- **C-541** 期間ラベルは 今週=「{M/D} 〜 {M/D}」（月曜〜日曜）、今月=「{N}月」、全期間=「すべての記録」
- **C-542** 週の起点は `isoShift(今日, -((getUTCDay()+6)%7))`＝その週の月曜で、終わりはその +6 日。月は `day.slice(0,7) === 今日.slice(0,7)` の暦月判定（直近30日ではない）
- **C-543** 期間フィルタが掛かるのは円グラフと凡例だけで、ストリーク・ヒートマップ・エクスポートは常に全期間を見る
- **C-544** `day` が空のエントリ（未配分のまま完了した単発タスクなど）は「全期間」でだけ数えられ、今週／今月では除外される
- **C-545** 集計元 `studyEntries` は `studyLog` + done な seg（教科は `PLANS[seg.plan].subj`、`PLANS` に無い孤児 seg はスキップ）+ done な extra の3種で、完了した復習は `completedAt` から足し直さない（`confirmAsk` が同じ分数を `studyLog` に書くため二重計上になる）
- **C-546** 期間チップが「全期間」のとき、合計・凡例の並び順・パーセントは v0.8 と完全に一致する
- **C-547** ストリークピルは学習日が続いていれば「🔥 連続{N}日」（`color:var(--org)`、枠 `color-mix(in srgb, var(--org) 40%, var(--line))`）、0日なら「まだ連続記録はありません」（`var(--tx3)`、枠 `var(--line)`）
- **C-548** ストリークは「その日に1分以上やったか」だけで数え、今日がまだ0分でも昨日までの連続は途切れない（起点が `dayMin[今日] > 0 ? 今日 : 昨日`）。上限は3650日
- **C-549** 左カラムは「教科別 勉強時間」カードの下に「日別の学習量」カード（ドット `var(--org)`、右上「直近15週」）が `gap:16px` で縦に並ぶ
- **C-550** ヒートマップは `viewBox="0 0 240 114"` の inline SVG に 12×12・`rx=3`・ピッチ15px の `<rect>` が **15列×7行 = 105個**並ぶ。列は左が最も古い週・右端が今週、行は上が月曜・下が日曜
- **C-551** マスの色は 未来日 = `color-mix(in srgb, var(--tx3) 6%, transparent)` / 0分 = `--tx3` 14% / 1–29分 = `var(--acc)` 22% / 30–59分 = 45% / 60–119分 = 70% / 120分以上 = `var(--acc)`（22〜70% は `var(--bg2)` と混色）で、しきい値は絶対値
- **C-552** 各マスの `<title>` は「{M/D} · {N}分」（未来日は「{M/D}」のみ）で、JS のホバーハンドラは1つも付かない
- **C-553** 月ラベルはその列の月曜が 1〜7 日の列にだけ `y=8` に「{N}月」が出る。行ラベルは 月 / 水 / 金 の3つだけ `x=0` に出る
- **C-554** 凡例行は「少」+ 5段の 11×11 色見本 + 「多」+ 右寄せ「マスにカーソルを合わせるとその日の分数が出ます」
- **C-555** SVG の `<text>` / `<title>` の内容は配列で渡して素のテキストノードとして描画する（文字列の `{{ }}` は `<span class="sc-interp">` に包まれ SVG 内では描画されないため。C-508）

#### データ画面: エクスポート

- **C-556** データ画面の最下段に全幅（`grid-column:1/-1`）の「エクスポート」カード（ドット `var(--tx3)`、右上「全期間・全件」、脚注「機種変更やバックアップに。読み込みは未対応です」）があり、「JSONをダウンロード」「CSVをダウンロード」の2ボタンが並ぶ（hover で `border-color:var(--acc);color:var(--acc)`）
- **C-557** 「JSONをダウンロード」は `exportData()` の戻り値（`{version:1, plans, state}`）を2スペースインデントで整形した `compass-backup-YYYYMMDD.json` を落とす。中身はクラウド／localStorage の保存ペイロードと完全に同形
- **C-558** 「CSVをダウンロード」は `compass-study-YYYYMMDD.csv` を落とす。中身は「学習ログ」表（見出し行 `date,subject,minutes`）と「テスト結果」表（`date,test,subject,score`）を**空行1つで区切った1ファイル**で、各表の上に日本語のラベル行が付く
- **C-559** 学習ログの行は円グラフと同じ `studyEntries` を日付昇順（`day` が空のものは末尾）で全件出力し、期間チップの絞り込みは掛からない。テスト結果は `scores` を日付昇順で全件出力する
- **C-560** CSV は先頭に BOM、改行は CRLF、末尾にも改行が付く。値に `"` `,` CR LF を含むときだけ RFC4180 に従って引用符で囲み `"` を二重化する
- **C-561** 書き出しは `Blob` + `a[download]` のクリックだけで完結し（`URL.revokeObjectURL` は4秒後）、成功で「JSONを書き出しました」/「CSVを書き出しました」、例外で「書き出しに失敗しました」のトーストが出る
- **C-562** エクスポートは state を一切変更しない（`toast` のみ）ので、保存 PUT も localStorage 書き込みも発生しない
- **C-563** インポート（読み込み）UI は存在しない

---

## 11. 未解決の疑問点

> **［解消済］** は、レポート作成時にコードを読み直して自力で答えが出たもの。**［要判断］** は書き換え方針の決定が必要なもの。
> **［RESOLVED (v0.9)］** は v0.9 で実装を直して決着済み。**書き換え版は修正後の挙動を再現する**（旧挙動を再現してはいけない）。

### Q1. Cockpit の「1日後・1週間後・1ヶ月後」というコピー ［**RESOLVED (v0.9)** / `f4799ce`］
**決着**: 文言を実装に合わせて書き換えた。Cockpit 復習の空状態は「復習タスクを完了して理解度を記録すると、翌日→3日後→1週間後→2週間後の間隔で次の復習が自動で積まれます。」になり、発火条件（＝**復習**の完了）も間隔（翌日/3日後/1週間後/2週間後）も実装と一致する。Review 画面のフッター文言は既に実装と一致していたため変更なし。→ C-160 / C-527、§2.10、§6.1

### Q2. `revSorted` / `scoreSorted` の非対称比較子 ［解消済 / 要判断］
両方とも等値のとき `0` ではなく `1` を返す（`return a.due < b.due ? -1 : 1;` HTML:3228、`(a,b) => a.day < b.day ? -1 : 1` HTML:3313）。
→ **同一 `due` / 同一 `day` の相対順序は V8 の sort 実装依存**。同日に複数のテスト点数を記録すると `latest` / 前回比 / 折れ線の点順が挿入順の逆になりうる。
**未判断**: 安定ソート（0 を返す）に直すと legacy と表示順が変わる。厳密再現を取るか。

### Q3. `dayOverrides` の読み書きキーのずれ ［**RESOLVED (v0.9)** / `f4799ce`］
**決着**: 修正した。`setSlotOverride` の書き込み先を `timetableFocusDate` から**読み出しと同じ `addScheduleDate`（＝いま表示している日）**へ揃えたので、土日にフォーカスした状態の書き換えもその場で画面に反映される。保存構造は変更していないため、旧実装が土日キーで書いた既存エントリは読まれない死にデータとして残る（マイグレーションはしない）。→ C-523 / C-524、§4.9

### Q4. 未来日の単発タスクが「今日」に現れない ［**RESOLVED (v0.9)** / `f4799ce`］
**決着**: 現れるようにした。`todayIds` が `segs` と同じ要領で **`day === TODAY` の `extras` も自動収集**する（order 未収録のものだけ追記するので手動の並び順は不変）。`submitAdd` / `itemOf` / 保存形は変更していない。→ C-275 / C-517〜C-519、§5.1

### Q5. `todayLoadPct` の無意味な三項演算 ［解消済 / 要判断］
`Math.min(100, Math.round((totalMin - doneMin === 0 ? totalMin : totalMin) / S.wkMax * 100))`（HTML:4046）— 両枝とも `totalMin` で、結果は常に `totalMin / wkMax`。おそらく「完了分を引く」意図の未完成コード。
**未判断**: バグごと再現するか、意図どおり `remainMin` にするか。

### Q6. Cockpit の負荷ラベルが休日でも「平日Max」固定 ［解消済 / 要判断］
テンプレート `HTML:974` はラベルが「平日Max」のリテラル、割る値も常に `S.wkMax`。`weMax` が使われるのは `maxOf(d)`（2482）経由の Tests の日別バーと再配分だけ。
**未判断**: 休日は `weMax` を使うよう直すか、バグごと再現するか。

### Q7. `.todo-other-card` のチェックボックスがバブルする ［解消済 / 要判断］
`HTML:1142-1143` のカードに `onClick="{{it.onSelect}}"`、内側のチェックボックスに `onClick="{{it.onToggle}}"`。**`stopPropagation` が無い**ため「完了トグル + 選択」が同時に起きる。
**未判断**: 意図した挙動か。

### Q8. `'定着 🎉'` を「まあまあ」で完了すると無限再生成 ［**RESOLVED (v0.9)** / `f4799ce`］
**決着**: 修正した。系列終了の条件を `grade === 'high' && !stageDays[ns]` から **`grade !== 'low' && !stageDays[ns]`** に変えたので、`stageDays` に次の間隔が無い stage（`'定着 🎉'` や未知のレガシー値）は high / mid のどちらでも「定着！…🎉」で終了する。`low` だけは従来どおり stage に関係なく翌日から組み直す。→ C-302 / C-521 / C-522、§6.2

### Q9. `shiftDue` が13日枠外の due を「今日」へ飛ばす ［**RESOLVED (v0.9)** / `be2f44e`］
**決着**: 修正した。`DIDX` / `DAYS` を経由せず **`isoShift(その復習の due, ±1)` で相対シフト**する。下限は `min(現在の due, 今日)` で、今日の復習を過去へ送ることはできないまま。下限に張り付いて日付が動かないときは「変更しました」ではなく**「次回復習日はこれ以上前にできません」**を出す（旧実装は動いていないのに変更トーストを出していた）。→ C-335 / C-336 / C-534〜C-537、§6.5

### Q10. 復習の `size` が `'S'` 固定 ［解消済 / 要判断］
`itemOf`（HTML:2825）が `size:'S'` をハードコード。`min:20` の復習でも Cockpit のサイズバッジは `S`、ToDo 詳細の `selSizeLabel` は `'S · 20分'` になる。
**未判断**: 1:1 再現の対象か。

### Q11. 「内容を細分化する」が必ず未配分になる ［解消済 / 要判断］
`scheduleSlots = minis.length ? scheduleItems(list, scheduleRoom, 'even') : []`（HTML:3562）。ミニタスク未入力時は `list` にダミー1件があるのに `scheduleSlots` は空配列なので、`slot == null` → `day:''`。
→ **`scheduleItems` を呼び忘れている**ことは確定。**未判断**: 意図的（未配分にしておきたい）か、バグか。

### Q12. `overdue` と `p.odCount` の数が食い違う ［**RESOLVED (v0.9)** / `f4799ce`］
**決着**: **数える側に揃えた**。`overdue` から `!s.manualDay` を外したので、トップバー／ナビの「⚠ N件」と計画行の「⚠M」は常に一致する（手動配置でも遅れていることに変わりはないため）。再配分の対象判定（`redistTargets`）は従来どおり `manualDay` を除外するので、⚠件数と実際に動く件数がずれることはありうる（意図した仕様）。→ C-51 / C-105 / C-525 / C-526、§2.3・§7.8

### Q13. ミニタスク0件の計画で `NaN` が出る ［解消済 / 要判断］
`p.dash = Math.round(doneN/segs.length*182)`、`p.progPct = Math.round(doneN/segs.length*100)+'%'`（HTML:2711-2712 付近）。`segs.length === 0` で `NaN` / `'NaN%'` になり、SVG の `stroke-dasharray` と進捗バーの `width` に NaN が入る（編集ドロワーで全ミニを消すと発生）。
**未判断**: バグごと再現するか 0 扱いに直すか。

### Q14. `manualDay` を解除する UI が無い ［解消済 / 要判断］
コード全体で `manualDay` を `false` / `delete` にする箇所は存在しない。一度ドラッグまたは日付入力したミニタスクは「手動配置も対象」を ON にしない限り**永久に再配分から外れる**。
**未判断**: Next.js 版で解除手段を足すか。

### Q15. `applyRedist` がプレビューと違う結果を適用しうる ［解消済 / 要判断］
`applyRedist`（HTML:4014）は表示中の `pv` ではなく **押下時に `computePreview` を再実行**する。モーダルを開いている間に `wkMax` / `weMax` を変えると、画面の移動リストと実際の適用結果が食い違う。
**未判断**: そのまま再現するか。

### Q16. テンプレート未参照の renderVals をどうするか ［解消済 / 要判断］
テンプレート（HTML:786-1880）を grep して 0 ヒットだったもの:
`todoItems` / `dragProps` / `addPlanMini` / `donutDashSmall` / `searchW` / `searchResize` / `weekRateAvailable` / `todoPlanRange` / `redistUnplacedCount` / `todoPlanCards.todayProg` / `todoPlanRows.quotaLabel` / plan の `lineC`（2816）/ `revDecorate.doneLabel` / `todoItems` 要素の `sec` `subLabel` `subDash` `rowGlow` `lift` `hasSubs`。
→ **すべて到達不能**であることは確定。特に `todoItems` / `dragProps` は「今日の ToDo を D&D で並べ替える」旧 UI の残骸。
**未判断**: 完全に落とすか、将来復活させる想定で残すか。

### Q17. 死にルールの CSS をどうするか ［解消済 / 要判断］
コードを読み直して確定した死にルール（§3.12 に一覧）:
- `.compass-nav>[style*="position:absolute"]{display:none!important}`（HTML:267）→ React は `position: absolute` とスペース付きで直列化するため一致せず、**モバイルでもナビのリサイズハンドルが残る**
- `.app-top-actions sc-if{display:none!important}` → `sc-if` は DOM に出ない
- `HTML:1601` の `style-hover` に `{{ }}` → CSS として無効
- `::selection` の `color-mix` → `--acc` がルートで未定義
- `[data-theme="dark"] .compass-shell::before` の綴じ線 → `!important` に負ける
**未判断**: それぞれ「そのまま再現」か「意図どおり動かす」か。

### Q18. `.cockpit-panel{height:calc(100vh - 68px)}` と `.compass-topbar{min-height:70px}` の 2px ずれ ［解消済 / 要判断］
`HTML:229` と `HTML:628` を確認済み。Cockpit パネルは 2px 分だけ余分に高い。**未判断**: どちらへ揃えるか。

### Q19. `themeName` の反転命名をどうするか ［要判断］
`note → data-theme="dark"` / `dark → data-theme="neon"`（HTML:3940）。1:1 再現を厳密に取るなら現状維持だが、CSS の可読性は著しく落ちる。`data-theme="note|neon|light"` に正規化して CSS セレクタも書き換えるかの判断が必要。

### Q20. スプラッシュの消し方 ［要判断］
現状は `document.querySelector('.compass-splash').classList.add(...)` の DOM 直接操作（HTML:2281-2282）。React では `splashReady` state が自然だが、「最低2900ms 表示」「クラウド読込完了がトリガ」の2条件の順序をどこまで厳密に維持するか（`notifyReady` が呼ばれない経路が将来できたとき、スプラッシュが永久に残る現在の挙動まで再現するか）。

### Q21. 検索ポップオーバーの外側クリック ［解消済 / 要判断］
backdrop も外側クリック検知も存在せず、閉じるのは ✕ / Escape / アプリスイッチャー起動のみ（コード全体を確認済み）。**未判断**: UX 改善として outside-click を足すか、1:1 再現を優先するか。

### Q22. Escape が `editorPlan` を閉じない ［解消済 / 要判断］
`_key` の Escape ハンドラ（HTML:2098）のキー一覧に `editorPlan` は含まれていない（`searchOpen, redistOpen, redistPlan, redistPickMode, query, appSwitcherOpen, revSel, revAsk, scoreSel, focusOpen, focusRunning`）。**未判断**: 意図的か。

### Q23. 集中モードが背景クリックで閉じない ［解消済 / 要判断］
`HTML:1816` のオーバーレイに `onClick` が無い（他のモーダルは全て背景クリックで閉じる）。**未判断**: 仕様として維持するか。

### Q24. `panelW.search`（既定308px）の未使用機構 ［解消済 / 要判断］
`searchW` / `searchResize` は `renderVals` が返すがテンプレート未参照。検索ポップオーバーは `left:0;right:0` で検索バー幅に追随する。**未判断**: この未使用パラメータを移植対象に含めるか（`persistentKeys` の `panelW` に含まれるため、値自体は保存され続ける）。

### Q25. 画面コンポーネントの DOM 順 ［解消済 / 要判断］
テンプレート上は `Cockpit → Tests → ToDo → Data → Add → Review`、ナビ既定順は `cockpit, tests, todo, review, add, data`。同時に1画面しか描画されないので実害なし。**未判断**: 移植時にどちらの順序で並べるか（差分検証のしやすさを取るならテンプレート順）。

### Q26. Google Fonts を `next/font` に置き換えるか ［要判断］
helmet 内の外部 `<link>`（Klee One / Noto Sans JP / Space Grotesk）。フォールバック挙動（特に 'Klee One' 未ロード時の手書き見出し）が変わる可能性がある。また **Space Grotesk の 600 は未ロードウェイト**なので、追加ロードするか合成のまま再現するかも同時に決める必要がある。

### Q27. `props`（glow / radius / accent）を露出するか ［要判断］
dc エディタ用の `data-props` 由来で UI からは変更できない。Next.js 版で設定として露出するか、既定値（3 / 12 / `#3d3629`）で定数にインライン化するか。
関連: `gl()` は `props.glow` に依存するため、**note/light テーマでも `--gAcc` が `none` なのに選択中カードだけ発光する**（§3.12-12）。テーマ整合を取るなら消すべきだが、現状再現なら残す必要がある。

### Q28. `window.top.location.assign(app.url)` ［要判断］
アプリスイッチャーの外部アプリ遷移（HTML:3933）は iframe から親フレーム全体を遷移させる。Next.js の同一オリジン化後もこの挙動を維持するか、`router.push` / 新規タブに変えるか。

### Q29. `studyLog` の無限成長 ［解消済 / 要判断］
追記のみで上限も削除 UI も重複排除も無い。**(v0.9)** 書き込みは `confirmAsk` と `deletePlan` の完了経路・通常経路の**3箇所**に増えた（Q30 の修正）。Firestore の1ドキュメント 1MiB 制限に将来ぶつかりうる。**未判断**: 「消えない履歴」仕様を維持するか、日付単位で集約・間引きするか。**(v0.9)** §8.7 のエクスポートで書き出して手動退避することはできるようになった。

### Q30. 未完了を含む計画の通常削除で勉強時間が失われる ［**RESOLVED (v0.9)** / `f4799ce`］
**決着**: 修正した。`deletePlan` の通常経路（確認ダイアログ経由）にも完了経路と同じ `studyLog` 転記（`{day: seg.day || T, subj: 計画の教科, min: seg.min}`）を入れたので、完了ぶんの勉強時間が円グラフから消えなくなった。確認ダイアログにも2行目「完了済みミニタスクの勉強時間は、データ画面の記録に残ります。」を追記した。→ C-408 / C-520、§7.6・§8.5-2

### Q31. `studyLog` に記録される分数が `askR.min` ［解消済 / 要判断］
`confirmAsk`（HTML:3116）は `min: askR.min`。モーダルで選び直した `nmin` は**次回復習の `min`** にしか使われない（3101）。**未判断**: この非対称を維持するか。

### Q32. `scoreGroups` のキーが `name` のみ ［解消済 / 要判断］
教科を見ないため、異なる教科で同じテスト名を記録すると1グループにまとまり、色と教科ピルは**最新レコードの教科**になる（HTML:3313, 3318）。**未判断**: 仕様として維持するか。

### Q33. 折れ線グラフの X 軸が日付距離に比例 ［解消済 / 要判断］
`scX`（HTML:3336）は `scMaxD === scMinD` なら 184 固定。**同日に複数記録すると全点が重なって読めない**。**未判断**: 等間隔プロットに変えてよいか。

### Q34. 円グラフの円周ずれ ［解消済 / 要判断］
`r=15.9` → 円周 ≈ 99.9 に対して 100 単位の `stroke-dasharray` を使っており約 0.1% ずれる。**未判断**: 正確な circumference に直してよいか（見た目はほぼ同一）。

### Q35. `subjOf()` の副作用が `renderVals` 内で起きる ［解消済 / 要判断］
未知教科への色採番（HTML:2013-2019）が**レンダー中**に実行される。特に `studyLog` にしか存在しない教科は `pieTotals` のループ（3305）で初めて採番される（`renderVals` 冒頭 2554-2562 の先行登録の対象外）。
→ **React StrictMode の二重レンダーで採番順（＝色）が変わりうる**ことは確定。**未判断**: 事前計算に切り出す際、既存データの色を変えないための採番順の再現方針。

### Q36. 孤児 seg（`PLANS` に無い `seg.plan`）の防御 ［解消済 / 要判断］
`dataPatch` に掃除処理は無く、`renderVals` の `P[s.plan].subj`（HTML:2680 等）で `TypeError` になりうる。実際には計画削除時に seg も必ず消えるので発生しないが、データ破損時に落ちる。**(v0.9)** データ画面の集計（`studyEntries`）にだけ `if (s.done && P[s.plan])` の防御が入った（§8.1）。**未判断**: 他の参照箇所にも同じ防御を入れるか。

### Q37. `exportData().version` のバージョニング ［解消済 / 要判断］
`version: 1` 固定で読み込み側は一切参照しない（デッドフィールド）ことを確認済み。**(v0.9)** §8.7 の JSON エクスポートが `exportData()` をそのまま書き出すので、**このフィールドはユーザーが手にするファイルにも入る**ようになった。**未判断**: 新実装でスキーマバージョニングを導入する余地はあるが、既存 Firestore データとの互換のため `1` を維持する必要がある。

### Q38. `reviewTasks` サブコレクションとの二重保持 ［要判断］
`AppShell.tsx` の `reviewsMigratedAt` フラグによる移行は**コンソールから手動で1回だけ実行**する運用（`SHELL:513-554`）。移行済みなら GET 時に `state.reviews` をコレクションの内容で差し替える。
一方レガシー側は `reviews` 配列の順序に依存する処理（`dataPatch` の `_legacyIndex` 復元など）を持つ。Next.js 版で **どちらを正とするか**、二重保持を維持するか片方に寄せるかの合意が必要。

### Q39. 実 API を作る場合の 401/403/503 分岐 ［解消済 / 要判断］
現在のブリッジ（`SHELL:183-236`）は **200 か 500 しか返さない**ため、`loadCloudState` の `cloudStatus:'login'`（401/403）と `'local'`（503）の分岐は到達しない。**未判断**: 書き換え後に実 API を作る際、この2分岐を活かすか削除するか。

### Q40. `datalist` の id 衝突 ［要判断］
`compass-score-names` / `compass-subj-list` / `compass-subj-list2` / `ed-subjects` はグローバル ID。React 移植で複数インスタンスが同時に存在しうる設計にする場合、ID をどう一意化するか（現状は単一インスタンス前提）。

### Q41. `support.js` の再現度 ［要判断］
ネイティブ React に置き換える前提でよいか。その場合、以下をどこまで厳密に再現するかの合意が必要:
- `{{ }}` テキストが `<span class="sc-interp">` に包まれる点（`>span:nth-child(n)` を使う `.review-table-row` / `.score-group-row` のモバイル CSS が壊れる）
- `style-hover` / `style-focus` の詳細度（1クラス・`!important` なし）
- `setState` の同期反映セマンティクス
- `#__dc-atomics`（未使用）と `BASE_CSS` の `.sc-placeholder` 系（`@media print` のベースラインだけは印刷時の見た目に影響する）








