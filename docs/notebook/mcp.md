# Compass MCP サーバー（Notion のカスタムエージェント向け）

2026-08-25 追加。Notion 側の **Study OS** から Compass のノートを読み、
想起問題の理解度を積み、`compass-note@2` を安全に取り込むための口。

Notion の「カスタム MCP サーバー」接続を通して、Notion のエージェントが
Compass のツールを直接呼べるようになる。これまで Compass への書き込みだけが
「専用 MCP が無い」という理由で dry-run 止まりだった（Notion「📄 FINAL RUN REPORT｜2026-08-22」）。
その穴を塞ぐのがこのサーバー。

```
授業 → Notion AIミーティングノート
     → Notion のエージェント（毎日決まった時間）
        ├ 読む   : list_notes / get_note / search_notes / list_weak_cards / get_understanding_stats
        ├ 取り込む: import_note（dry_run → commit）
        └ 積む   : record_understanding
     → Compass（Firestore: users/{uid}/notes, users/{uid}/noteImports）
```

`/api/notion/pull`（[notion-pull.md](notion-pull.md)）とは**別の経路**で、片方だけでも動く。
pull は「Compass が Notion のページを取りに行く」、MCP は「Notion が Compass を呼ぶ」。

---

## 1. 何ができて、何ができないか

| 対象 | MCP から |
|---|---|
| `users/{uid}/notes/{id}` の本文・重要語・想起問題 | 読む / `import_note` で書く |
| `NoteCard.attempts`（問題ごとの理解度） | 読む / `record_understanding` で追記する |
| `summary`（自分のまとめ）・`doubt`（自分の疑問）・`scans`（自分の写真） | **読むだけ**。上書き取り込みでも既存を引き継ぐ |
| `users/{uid}/settings/compass-ui-data`（復習の間隔・予定・点数・学習履歴） | **触らない**（読みにも行かない） |
| ノートの削除 | できない |

**復習の間隔は動かない。** `record_understanding` はノート側の履歴
（「この問題を、いつ、どう感じたか」）だけを増やす。間隔の計算はアプリで解いたときの
`ReviewShared.completeReview` の仕事で、これはアプリ内の `recordNoteAttempt` が
もともと守っている境界と同じ（spec §4）。

保存先を `notes` / `noteImports` の 2 コレクションに閉じているのは、
Notion からの取り込みが**既存セーブ全体を置き換える経路に混ざらない**ようにするため
（Notion「🔎 Compass × Study OS 接続監査｜2026-08-22」P0-1）。

---

## 2. 部品

| 置き場所 | 役割 |
|---|---|
| `src/app/api/mcp/[[...key]]/route.ts` | HTTP。合言葉の照合・メソッド・CORS だけ |
| `src/lib/server/mcpServer.ts` | JSON-RPC（`initialize` / `tools/list` / `tools/call` …） |
| `src/lib/server/mcpTools.ts` | ツール 10 個の定義と実行 |
| `src/lib/server/compassStore.ts` | `users/{uid}/notes` と `noteImports` だけを触るデータ層 |
| `src/lib/server/firestoreRest.ts` | Firestore REST の薄いクライアント（型付き値の相互変換） |
| `src/lib/server/googleAuth.ts` | サービスアカウント JWT → アクセストークン（`jose` で署名） |
| `src/lib/logic/noteSync.ts` | 冪等性キー・payload hash・duplicate/conflict の判断・理解度の集計（純ロジック） |
| `src/lib/logic/noteDocs.ts` | 生ドキュメント → `Note`。**クライアントと同じ関数**を使う |

`firebase-admin` は足していない。すでに入っている `jose` でサービスアカウント JWT を
署名し、Firestore REST を叩いている。

---

## 3. ツール

### 読む

| ツール | 引数 | 返すもの |
|---|---|---|
| `whoami` | — | 接続先・ノート件数・最新の授業日・書き込み境界 |
| `list_notes` | `subject` / `from` / `to` / `limit` | 一覧（本文なし） |
| `get_note` | `note_id`、または `date` + `subject` / `unit` | 1 冊の全文 |
| `search_notes` | `query` / `limit` | 重要語・本文・想起問題を横断した検索 |
| `list_weak_cards` | `subject` / `limit` / `include_untried` | 苦手な順（不安 → 未着手 → まあまあ） |
| `get_understanding_stats` | `from` / `to` | 教科ごとの ◎ / ○ / △ / 未着手 |
| `list_imports` | `limit` | 取り込み台帳 |
| `get_timetable` | — | 週の基本時間割と教科コード |

### 書く

| ツール | 引数 | すること |
|---|---|---|
| `record_understanding` | `note_id` / `results[{card_id, grade}]` / `day` | 理解度を追記。同じ日の同じ問題は 1 件に畳む（後勝ち） |
| `import_note` | `payload` / `mode` / `overwrite` / `idempotency_key` / `source` | `compass-note@2` を検証して保存 |

`grade` は `high`（◎ばっちり）/ `mid`（○まあまあ）/ `low`（△不安）。
`◎` `まあまあ` `1`〜`3` のような書き方も受け取って寄せる。

---

## 4. 取り込みの規則（`import_note`）

1. **`mode` の既定は `dry_run`**。検証だけで Firestore を 1 バイトも変えない
   （台帳にも書かない）。保存するときだけ `mode: "commit"`。
2. **冪等性キー**は `授業日 + 教科 + 単元` の 3 つ組から作る（`ik-` + SHA-256）。
   エージェントの再実行が Notion 側で別ページ（`8月17日 (2)`）を作っても同じキーに落ちる。
3. **payload hash** は取り込み後のノートの内容（id・日時・本人領域を除く）から作る。
   だから空白やキーの並びが変わっただけでは hash は変わらない。
4. 同じキーの再来:

   | 前回 | 今回の hash | 結論 |
   |---|---|---|
   | 無し | — | `dry_run` → `validated` / `commit` → `created` |
   | 有り | 同じ | `duplicate`（何も書かない） |
   | 有り | 違う | `conflict`（何も書かない） |
   | 有り | 違う + `overwrite: true` | `commit` → `updated` |

   `conflict` を既定にするのは「同じ授業を黙って書き換えない」ため。直した JSON を
   流し直すときだけ `overwrite: true` を明示する。
5. 上書きでも `summary` / `doubt` / `scans` と既存の `attempts` は残る
   （`parseNoteJson` の `existing` 経由。spec §3.4 / §3.6）。
6. 結果は `users/{uid}/noteImports/{key}` に残り、`list_imports` で読める。

---

## 5. セットアップ

### 5-1. サービスアカウントを作る

1. [Firebase コンソール](https://console.firebase.google.com/) → プロジェクトの設定 →
   **サービスアカウント** → 「新しい秘密鍵の生成」で JSON をダウンロード
2. その JSON は**そのまま 1 行にして**（または base64 にして）env に入れる

```bash
# 1 行 JSON にする
node -e "console.log(JSON.stringify(require('./service-account.json')))"
# または base64
base64 -i service-account.json | tr -d '\n'
```

ダウンロードした JSON ファイルはリポジトリに置かない（`.gitignore` 済みだが、
そもそも作業フォルダの外へ移すのが安全）。

### 5-2. 自分の UID を調べる

Compass にログインして「データ」画面を開くと UID が出る。
（ブラウザのコンソールなら `firebase.auth().currentUser.uid`）

### 5-3. env を入れる

`.env.local`（ローカル）と Vercel の Production 両方に:

```
COMPASS_MCP_TOKEN=<24文字以上のランダム文字列>
COMPASS_MCP_UID=<自分の Firebase UID>
FIREBASE_SERVICE_ACCOUNT=<1行 JSON か base64>
```

合言葉はこれで作れる:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

Vercel へ入れるときは:

```bash
npx vercel env add COMPASS_MCP_TOKEN production --scope n494n0
npx vercel env add COMPASS_MCP_UID production --scope n494n0
npx vercel env add FIREBASE_SERVICE_ACCOUNT production --scope n494n0
npx vercel --prod --scope n494n0
```

### 5-4. Notion 側で繋ぐ

1. Notion の 設定 → **Notion AI** → AI コネクタ → 「カスタム MCP サーバー」を有効にする
   （ワークスペースのオーナー権限が要る）
2. カスタムエージェントの 接続を追加 → **カスタム MCP サーバー** → URL は `…/api/mcp`、
   **認証は「Bearer token」**を選んで `COMPASS_MCP_TOKEN` を貼る（既定は OAuth なので必ず変える）。
   ヘッダを付けられないクライアント向けに、URL にトークンを載せる形も用意してある:

   ```
   https://compass-tasks.vercel.app/api/mcp/<COMPASS_MCP_TOKEN>
   ```

3. 書き込みツール（`record_understanding` / `import_note`）は既定で
   **「常に確認する」**になっている。無人で動く層はここで止まるので、
   使う層は「自動的に実行」へ、使わない層は個別に**無効**にする。
4. エージェントの指示文に「Compass のノートは compass-study の MCP から読む」と書く。

**エージェントを複製したとき**：接続の認証だけは引き継がれず「ログインが必要です」になる。
… → 接続 → Bearer token → 貼り直す。**`COMPASS_MCP_TOKEN` を作り直したときも、
繋いである全エージェントで同じことをする** ―― 古いトークンのままの層は、
エラーを出さずにその層だけ動かなくなる。

### 5-5. 動作確認

```bash
TOKEN=<COMPASS_MCP_TOKEN>
curl -s -X POST https://compass-tasks.vercel.app/api/mcp \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"whoami"}}'
```

`notes` の件数が返れば繋がっている。`COMPASS_MCP_UID が未設定です` のような
`isError` の結果が返るときは env の設定漏れ。

---

## 6. 認証と、その限界

合言葉の渡し方は 3 通り。上から順に安全:

1. `Authorization: Bearer <token>`
2. `POST /api/mcp/<token>`（パスに載せる）
3. `POST /api/mcp?key=<token>`

2 と 3 は**トークンが URL に残る**（アクセスログ・ブラウザ履歴・スクリーンショット）。
用意しているのは、URL 1 本しか設定できないクライアントのため。
漏れたと思ったら `COMPASS_MCP_TOKEN` を作り直して再デプロイすれば、その瞬間に古い URL は死ぬ。

サービスアカウントは Firestore のセキュリティルールを**素通りする**。だから
「どの uid を触るか」はリクエストに決めさせず、`COMPASS_MCP_UID` で固定してある。

---

## 6.5 同時書き込みについて（既知の穴）

MCP もアプリも、ノートを**1 ドキュメント丸ごと**書く。だから次の順番が起きると、
MCP が足した理解度が消える:

1. アプリを開く（そのときのノートをメモリに読む）
2. MCP が `record_understanding` で `attempts` を足す
3. アプリでそのノートを編集する（単元名を直す、写真を足す…）
   → アプリは**手元の古いノート**を丸ごと書くので、2 の `attempts` が消える

いまは検出も防止もしていない。実際に困るのは「アプリを開いたまま Notion で答えた」ときだけなので、
実運用を見てから対処する（`revision` を持たせて更新前提条件を付けるのが素直な直し方）。
逆向き（アプリ → MCP）は、MCP が毎回 Firestore から読み直すので起きない。

## 7. まだやっていないこと

- 理解度を記録しても**復習の予定は動かない**。Notion で答えた問題も、アプリの ToDo には
  同じ復習が残る。復習の前進をどちらの正本にするかは、実運用を見てから決める。
- 同時書き込みの検出（§6.5）。
- 取り込みの承認画面（人が「取り込む / 保留 / 拒否」を選ぶ UI）は無い。
  いまは `dry_run` → 目視 → `commit` という手順がその代わり。
- OAuth（Notion 側の Dynamic Client Registration）には対応していない。合言葉だけ。
