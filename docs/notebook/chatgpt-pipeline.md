# 授業ノートを ChatGPT で作る（Notion AI のクレジットを使わない経路）

2026-08-27 追加。**Notion のカスタムエージェントで授業ノートを作るのをやめた。**
文字起こしを読んでノートと想起問題を作る仕事は Notion AI のクレジットを
一気に食い潰す（2026-08-26 に上限到達し、全カスタムエージェントが一時停止した）。

重い生成を ChatGPT に移し、Compass への取り込みだけをこちら（スクリプト）でやる。

```
授業を録る（本人がやるのはここだけ）
  → Notion が AI ミーティングノートを作る（トップレベルの非公開ページ）
  → 16:30 @今日 自動回収（Claude のスケジュールタスク）
       …「🎙️ AIミーティングノート保存」へ移す
  → 16:45 ChatGPT のスケジュール
       … 指示書を読み、その日の授業ぶんの compass-note@2 を作って
         「🧭 Compass取り込みJSON / M月D日」にコードブロックで置く
  → 17:10 Claude のスケジュールタスク
       … scripts/import-notion-json.mjs が JSON を読んで MCP の import_note へ
  → Compass（Firestore）
```

## なぜこの形か

| 分担 | 理由 |
|---|---|
| **ChatGPT** が生成 | Notion AI のクレジットを使わない。Notion コネクタで授業ページも写真も読める |
| **Notion** が置き場 | 生成物が人の目に見える場所に残る。失敗しても JSON を手で直せる |
| **スクリプト**が取り込み | ここにモデルを挟まない。冪等性（`duplicate` / `conflict`）はサーバー側の判断に任せる |

Compass 側の受け取り（`/api/notion/pull`、[notion-pull.md](notion-pull.md)）は**そのまま残る**。
同じページを読むので、スクリプトが動かなかった日もアプリを開けば入る。
どちらの経路でも授業日＋教科＋単元の 3 つ組で同じノートに重なる。

## 部品

| 置き場所 | 役割 |
|---|---|
| Notion「🤖 ChatGPT用｜授業ノート生成 指示書」 | ChatGPT が毎回読む正本。ルールを直すのはここ |
| ChatGPT のスケジュール「Compass授業ノート生成」 | 平日 16:45。指示書を読んで実行する |
| `scripts/import-notion-json.mjs` | Notion の JSON → MCP `import_note`（dry_run → commit） |
| Claude のタスク `compass-import-chatgpt-json` | 平日 17:10 に上のスクリプトを走らせる |
| Claude のタスク `notion-collect-class-notes` | 平日 16:30。その日の授業ページを保存フォルダへ移す |

## スクリプト

```bash
node scripts/import-notion-json.mjs --catchup          # 今日・昨日・一昨日（定期実行はこれ）
node scripts/import-notion-json.mjs                    # 今日（JST）の「M月D日」だけ
node scripts/import-notion-json.mjs --date 2026-08-24
node scripts/import-notion-json.mjs --title "テスト 8月26日"
node scripts/import-notion-json.mjs --dry             # dry_run だけ
```

env は `.env.local` から読む（`NOTION_TOKEN` / `NOTION_NOTES_PAGE_ID` / `COMPASS_MCP_TOKEN`）。
`source` は `chatgpt-daily` で台帳に残るので、`list_imports` でどの経路から来たか分かる。

## 実測（2026-08-26〜27）

- ChatGPT は「🎙️ AIミーティングノート保存」配下の当日ページを**全部**見つけられる。
  Notion のカスタムエージェントからは 1 件も見えなかったので、ここが決定的な違い。
- 8/26（5 コマ）: 7 コマ中 5 コマを授業と判定、SHR と空のミーティングを除外。
  タイトルが「ミーティング」でも中身が古典の授業なら取り込む、まで正しく判断した。
- 8/24（5 コマ）: `created` ×5。もう一度走らせると `duplicate` ×5。冪等。
- 8/27（3 コマ）: 回収 → 生成 → 取り込みまで通しで実行し `created` ×3。
  ページ名が「数学Ⅱ」「保険」（本人の手打ち）でも、中身を見て `数学` / `保健` に寄せられた
  ―― 教科の変換表に「数学はすべて→数学」「ページ名よりも中身を優先」を足したあと。

**取りこぼしの拾い直しは 2 段構え**: ChatGPT 側は今日ぶんを書いたあと昨日・一昨日のページが
無ければ作る。取り込み側は `--catchup` で 3 日ぶんを見る。どちらも既にあるものには触らない。

## 写真（黒板・ノート）について ―― まだ効いていない

指示書には「本人の手書きノートは `sections[].text` に再現、黒板は `ai` へ」と書いてあるが、
**2026-08-27 時点で `text` は空のまま**。ChatGPT の報告:

> Notion から写真ブロック自体は検出できたが、**署名付き HEIC 画像のバイナリを開く処理が拒否された**。
> そのため写真を本人の手書きだと推測して転記することはせず、`text:""` のままにした。

つまりプロンプトの問題ではなく**画像形式（HEIC）の問題**。直し方は 2 つ:

1. iPhone の 設定 → カメラ → フォーマット を「互換性優先」（JPEG）にする。撮る側で 1 回変えるだけ
2. 取り込み前に HEIC → JPEG へ変換して貼り直す（自動化するなら `sips` などで）

1 が圧倒的に安い。写真が JPEG になれば、指示書の写真ルールがそのまま効くはず（未検証）。

## Notion のカスタムエージェントの今

| エージェント | いま |
|---|---|
| Note Builder（17:00 記録層） | **17:00 のトリガーを OFF にした**。生成は ChatGPT に移ったので、クレジットが戻っても勝手に走らない |
| Verifier（17:30 検証層） | そのまま。読み中心なので軽い（クレジット復活まで停止中） |
| Recall Coach（20:00 定着層） | そのまま（同上） |
| Morning Brief（07:30 起動層） | そのまま（同上） |

ChatGPT のカスタム MCP（コネクタ）は Plus でも作成ダイアログまでは出るが、
**認証が OAuth / 認証なし の 2 択で Bearer ヘッダを付けられない**。
Compass MCP を ChatGPT から直接呼ぶなら、URL にトークンを載せる形
（`…/api/mcp/<COMPASS_MCP_TOKEN>` ＋ 認証なし）になる ―― トークンが接続設定に残るのと引き換え。
いまは使っていない。
