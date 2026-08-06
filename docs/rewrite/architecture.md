# Compass Next.js 完全移行 アーキテクチャ設計

対象: `Compass App.dc.html`(4262行) + `support.js`(dc-runtime) + iframe ブリッジ(`AppShell.tsx`)を、
100% Next.js/React ネイティブ実装へ置き換える。

方針(ユーザー承認済み): **見た目と挙動は完全再現。承認済みバグ修正(v0.9)は反映。到達不能な
死にコード・効いていないCSSは持ち込まない。既存 Firestore データはそのまま読める。**

正典は [app-spec.md](app-spec.md)。パリティ項目 C-1..C-516(+v0.9 追加分)が受け入れ基準。

---

## 1. ゴールと非ゴール

- ゴール: iframe / srcDoc / fetch シム / dc-runtime の全廃。React コンポーネント + 直接
  Firestore アクセスで同一の UX・同一の保存データ形状。
- 非ゴール: UI の刷新、データスキーマの刷新、新機能(v0.9 パック以外)、SSR 最適化。
  画面はクライアントコンポーネントで良い(現行も全部クライアント)。

## 2. モジュール構成

```
src/
  app/
    page.tsx            — 認証ゲート + <CompassApp/> (iframe 廃止)
    AppShell.tsx        — 廃止(認証UIは components/auth へ移植)
    globals.css         — 既存 + レガシー全CSSの移植(§4)
  components/
    auth/AuthScreen.tsx — 現 AppShell の AuthScreen を移植
    CompassApp.tsx      — ルート: スプラッシュ、topbar、nav、画面切替、トースト、オーバーレイ
    screens/
      Cockpit.tsx  Tests.tsx  Todo.tsx  Review.tsx  DataScreen.tsx  AddTask.tsx
    parts/              — 画面内の大きな塊(FocusOverlay, RedistModal, MiniTaskEditor,
                          SearchPopover, AppSwitcher, Heatmap, Donut, ScoreChart …)
  lib/
    firebase.ts         — 既存のまま
    store.ts            — 状態コンテナ(§3)
    persistence.ts      — Firestore GET/PUT(§5。A-2-3 の差分書き込みを吸収)
    logic/
      dates.ts          — T/DIDX/isoShift/fmtMD/dayLabel/週の起点(月曜) など
      schedule.ts       — scheduleItems(even/early/flow), 再配分, 負荷計算
      reviews.ts        — confirmAsk の遷移表(翌日→3日後→1週間後→2週間後→定着), shiftDue
      subjects.ts       — SUBJ パレット割当(§6)
      aggregate.ts      — データ画面の集計(pie/期間切替/ストリーク/ヒートマップ), 消化率
      csv.ts / export.ts — v0.9 エクスポート
```

分割の原則: レガシーの renderVals(1関数)を「純ロジック(lib/logic)」と「表示(components)」に
分けるだけで、**計算式・分岐・文言は 1:1 で移植**する。到達不能戻り値(spec Q16 の14件)は移植しない。

## 3. 状態設計 — 単一ストア

レガシーは単一コンポーネントのフラット state + `this.PLANS`(インスタンスフィールド) +
1段 Undo。これを **useSyncExternalStore ベースの単一ストア**(依存追加なし)で再現する:

- `store.state` — レガシー state と同名キー・同型。恒久キーは spec の 23 persistentKeys。
- `store.plans` — 旧 this.PLANS。**state 外である必然性は無いので store 内の通常フィールド**
  にするが、シリアライズ時は従来どおり `exportData().plans` として分離出力。
- `store.undo` — 旧 undoPayload と同じ {plans, state:<14 undoKeys>} 1段。
- UI 一時状態(モーダル開閉、ドラッグ中、集中モード残秒 等)もレガシーが state に持つものは
  同じ場所に置く(保存対象外は 23 キーに含まれないので自然に永続化されない)。
- StrictMode 二重レンダー対策: 副作用(subjOf のパレット割当 等)はレンダー外へ(§6)。

## 4. CSS・テーマ

- レガシー CSS(L14-783 + support.js 注入分)を globals.css へ移植。クラス名は原則そのまま
  (パリティ検証を「同名クラスの計算スタイル比較」でやるため)。
- **spec Q17 の死にCSS 5件は移植しない**。Q18 の 2px 食い違いは 70px に統一。
- テーマ: `data-theme` の値を `note | neon | light` に**正規化**(Q19)。state.theme の保存値
  ('note'/'dark'/'light')は変えない(既存データ互換)。マッピングだけ表引きで解決し、
  スキン CSS のセレクタを新値に書き換える。
- {{ }} → sc-interp span 依存の ≤820px セル選択(Q41, C-508)は、**セルに明示クラスを振って
  書き直す**(span:nth-child 依存を廃止)。見た目は同一に保つ。
- フォント: next/font は使わず現行と同じ Google Fonts <link>(Klee One のフォールバック挙動
  維持、Q26)。Space Grotesk 600 は 500/700 しか読まれていない現状を維持(合成ウェイトも再現対象)。

## 5. 永続化 — 保存データ形状は不変

- 保存先・形状は現行のまま: `users/{uid}/settings/compass-ui-data` に
  `{ data: {version:1, state:<23キー>, plans}, email, updatedAt, reviewsMigratedAt? }`、
  移行済みなら `users/{uid}/reviewTasks/{id}` (+ `_seq`)。
- `persistence.ts` は現 AppShell の COMPASS_CLOUD_GET/PUT + A-2-3 差分書き込み+ baseline 管理を
  そのまま吸収(fetch シム・window ブリッジは廃止)。**23 キーの直列化順もレガシーと同一に固定**
  (レガシー版との相互運用期間中、無変更 PUT 検知が両実装で一致するように)。
- 保存トリガー: レガシー同様「直列化文字列の差分検知」をストア購読で再現(debounce 等の
  タイミングも spec §4 記載値に合わせる)。
- cloudStatus の 401/403/503 分岐(Q39)は到達不能だったため持ち込まない。200/500 相当の
  成功/失敗 2 値 + ローカルフォールバックを実装。

## 6. 教科カラー(subjOf)

レンダー中の SUBJ 変異(Q35)は移植しない。代わりに:
- 既存ユーザーのデータでは state.subjColors(または SUBJ 相当の保存キー — spec §4 の実キー名
  に従う)が既に割当済み → そのまま尊重。
- 未割当教科への新規割当は「タスク/ログ出現順で palette % 6」をデータ変更時に 1 回だけ実行
  (純関数 + useMemo)。レガシーと同じ入力順なら同じ色になることをパリティ項目で検証。

## 7. 認証・起動シーケンス

1. page.tsx: Firebase 未設定 → 案内画面 / preview=1 → プレビュー(ローカルのみ・保存無効)。
2. 認証済み → スプラッシュ(compass ロゴ)を表示しつつ GET → 完了とアニメ最低時間
   (レガシー 2900ms)の両方を待って開場(Q20 の「notifyReady 不達で永久スプラッシュ」は
   タイムアウトフォールバックを追加して再現しない)。
3. gmail.com 制限・ログアウト UI は現 AppShell と同一。

## 8. 移行・ロールアウト（完了 2026-08-06）

1. ~~ブランチ `feat/nextjs-rewrite`(feat/app-enhancements から分岐)。~~ 完了
2. ~~実装中はレガシーを `/?legacy=1` で並存(page.tsx で出し分け)→ 並走比較検証。~~ 完了
3. ~~パリティ検証(§9)が通ったら default を新実装に切替、レガシー HTML/support.js/iframe 系は
   削除コミットで退役(復元はタグで可能に)。~~ 完了 — 検証結果 589 PASS / FAIL 0(修正後)。
   **退役済み**: `Compass App.dc.html` / `support.js` / `src/app/AppShell.tsx` / `?legacy=1` 経路。
   復元はタグ `legacy-retired-20260806` から。
4. Firestore データには一切の migration を行わない(形状不変が原則。reviewsMigratedAt の
   有無どちらでも動くこと = A-2-1〜A-2-3 と同じ両対応)。

なお本書と `app-spec.md` / `css-notes.md` が参照する `HTML:行番号` は退役したファイルの
行番号であり、経緯の記録として残している(タグから取得可能)。

## 9. 検証戦略

- 受け入れ = spec §10 パリティチェックリスト(C-1..C-516 + v0.9 追加分)。
- 自動: tsc / next build / 主要ロジック(schedule, reviews, aggregate, csv)の純関数ユニットテスト
  (レガシーコードから抽出した期待値表で)。
- 手動+エージェント: プレビューで legacy vs new の並走スクリーンショット比較(全画面×3テーマ)、
  操作フロー(タスク追加→完了→復習→計画→再配分→データ→エクスポート)の一致確認。
- データ互換: 実データ形状のフィクスチャ(20件 reviews / plans / studyLog / scores)を GET に
  流し、両実装の描画と PUT ペイロードが一致することを確認。
