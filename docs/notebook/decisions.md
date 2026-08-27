# 授業ノート — いま決まっていること全部（2026-08-25 現在）

Compass の授業ノートまわりの決定事項の一枚まとめ。詳細仕様は
[spec.md](spec.md)、Notion 受け取りの設計は [notion-pull.md](notion-pull.md)、
Notion から Compass を呼ぶ MCP は [mcp.md](mcp.md)。

## 1. 全体の流れ

```
授業（録音）
  → Notion AIミーティングノート（要約＋文字起こし）     ← 毎日の手作業はこれだけ
  → 毎日17:00 Notionエージェントが compass-note@2 JSON化
  → ここから先は2経路（どちらか片方でも動く）
     A. 「Compass取り込みJSON」ページに保存 → Compassが起動時に受け取る（notion-pull.md）
     B. Notionのエージェントが Compass MCP の import_note を呼ぶ（mcp.md）
  → ノート画面に紙面が並び、想起問題ぶんの復習カードが「今日のToDo」へ
```

A は「Compassが取りに行く」、B は「Notionが呼ぶ」。B があると、Notion 側で
その日のうちに検証まで終わり、失敗が Notion のログに残る。

## 2. 正本の分担（2026-08-21 決定）

| データ | 正本 | 直したいとき |
|---|---|---|
| ノート本文（sections / recall / keywords …） | **Notion** | Notion側のJSONを直す → 次の受け取りで上書き |
| 解いた記録（◎○△）・復習の間隔・自分のまとめ・ノート写真 | **Compass (Firestore)** | Compassで操作。上書き取り込みでも消えない |

- Notion への書き戻しはしない（まとめ・理解度は Compass 側の学習記録）。
  ただし Notion のエージェントは MCP で**理解度を Compass へ書き込める**（2026-08-25 追加）。
  書き込めるのは `attempts` だけで、復習の間隔・まとめ・写真は変えられない
- 上書き取り込みは「授業日＋教科＋単元」の一致で同じノートに重なる。
  想起問題の順番が同じなら解いた記録も引き継がれる

## 3. 記録の運用（Notion側）

- 授業は **AIミーティングノート**で録る（要約＋文字起こし）
- 管理用DB「AIミーティングノート一覧（管理用）」
  （プロパティ: 授業名 / 日付 / 科目 / 単元 / 元ノートURL / 処理状況 / まとめノートrelation）
- DBに今日の行が無くても、エージェントは「今日作成されたAIミーティングノート」を
  検索するフォールバックで動く（DBは精度を上げるための補助）

## 4. 変換（Notionエージェント・毎日17:00）

指示文の完成品は Notion「【エージェント指示文】毎日17時の授業ノート→JSON変換」ページ。

- **写真なし運用**: 本文 `sections[].text` は全区画 `""`。録音から分かることは
  すべて `ai`（添削・補足）側へ。ノートを想像で書き起こさない
- **生徒のものとAIのものを混ぜない**:
  - `summary` … 必ず `""`（復習時に自分の言葉で書く欄。AIに要約させない）
  - `doubt` … 文字起こしで本人が発した疑問だけ。AIが疑問を作らない
  - `recall` … 本人の問い・先生が確認指示した問いを `origin:"self"`、
    足りない分をAIが `origin:"ai"` で補い、self を先に並べる。標準5問（3〜8問）
- **keywords** … 6〜12語。`ai` 本文と1字も違えない（部分一致で色を塗るため）。
  3色だけ: red＝最重要（用語・定義）/ blue＝事実（人物・年号・固有名詞）/
  green＝つながり（因果・対比・例外）
- **科目名は時間割の短名に変換**: 言語 / 英コ / 体育 / 数学 / 歴総 / 論表 / 化基 /
  芸術 / 生基 / 地総 / 現国 / 保健 / LHR、それ以外（物理基礎・情報Ⅰなど）→ その他。
  「社会」「理科」のような大分類は禁止
- **保存先**: 日付子ページ `M月D日`（例: 8月17日）、授業1回＝コードブロック1個
  （JSON以外を入れない）。再実行は `M月D日 (2)` と**別ページ**（追記・上書きしない）
- LaTeX は `$...$` / `$$...$$`、JSON内のバックスラッシュは必ず2個重ねる

## 5. 受け取り（Compass側・2026-08-21 実装）

- `/api/notion/pull` がサーバー側で Notion API を叩く（トークンをブラウザに出さない）
- 読むのは日付名（`M月D日` / ISO）の子ページだけ・最近編集の30枚
  （指示文ページは読まない。古いページも編集されれば窓に戻る）
- **冪等化**: `notionPullLog`（ブロックid → `last_edited_time`）。`compass-ui-data` の
  永続キーなので端末をまたいで効き、消したノートを勝手に復活させない
- **上書き先の解決**: ①ログが指すノート → ②授業日＋教科＋単元の一致 → ③新規。
  `(2)` ページはこの②で同じノートへの上書きになり、後勝ち
- 検証エラーのブロックは記録して同じ内容では再挑戦しない
  （Notion側で直せば `edited` が変わって自然に再取り込み）
- **起動時に自動受け取り**（新しいノートが入ったときだけトースト。preview では走らない）
  ＋ ノート画面サイドバーの「⟳ Notionから受け取る」ボタン
- 取り込みは手貼りモーダルと**同じ経路**（`parseNoteJson` → `commitNote`）。
  検証規則・復習カード生成・引き継ぎの挙動は1か所のまま
- **手貼りモーダルは控えとして残す**（写真込みでやり直すカスタムGPTの経路と、
  Notion障害時のバックアップ）
- APIルートの本人確認: `NOTION_ALLOWED_EMAILS` を設定すると Firebase ログインの
  IDトークンを要求し、許可したメールだけ通す（Vercel では必須。ローカルは空でよい）

## 6. 取り込み後の動き（既存仕様のまま）

- 想起問題1問 ＝ 復習カード1枚。取り込んだその日のうちに「今日のToDo」へ1枚積まれる
- 理解度は3段階: ◎ばっちり＝次の間隔へ / ○まあまあ＝同じ間隔でもう一度 /
  △不安＝明日もう一度。解いた記録はノート側にも `attempts` として残る
- まとめが空のノートには「まとめを書く」提案タスク（noteId単位で一度きり。しつこくしない）
- ノート削除で、そのノート由来の**未完了**復習・まとめタスクもカスケード削除
  （完了済みは学習履歴なので残す）
- ノートの写真は自分で撮って貼る（実体は端末のIndexedDB、最大12枚。JSONには入らない）
- 問題抽出は全ノート横断・「苦手な順」既定（△ → 未着手 → ○ → ◎）

## 6.5 Notion から Compass を呼ぶ MCP（2026-08-25 決定）

詳細は [mcp.md](mcp.md)。要点だけ:

- 口は `POST /api/mcp`。合言葉（`COMPASS_MCP_TOKEN`）で入る。ヘッダでも URL でも渡せる
- ツールは 10 個。読む 8 個（`list_notes` / `get_note` / `search_notes` /
  `list_weak_cards` / `get_understanding_stats` / `list_imports` / `get_timetable` / `whoami`）と
  書く 2 個（`record_understanding` / `import_note`）
- **触るのは `users/{uid}/notes` と `users/{uid}/noteImports` の 2 コレクションだけ。**
  `settings/compass-ui-data`（復習・予定・点数・学習履歴）には読みにも行かない
- `import_note` の既定は `dry_run`（Firestore を 1 バイトも変えない）。
  同じ授業の再送は `duplicate`、内容違いは `conflict`。上書きは `overwrite: true` を明示したときだけ
- 冪等性キーは `授業日 + 教科 + 単元`。台帳は `users/{uid}/noteImports/{key}`
- サービスアカウントは Firestore のルールを素通りするので、uid は `COMPASS_MCP_UID` で固定

## 7. スキーマ（compass-note@2）

- 現行は `compass-note@2`（本文＝自分のノートの再現、AIは添削で重なる）。
  旧 `@1`（blocks＋5色）も受理し、取り込み時に畳む
- 上限: recall 8問 / sections 24区画 / keywords 24語（エージェント運用では6〜12語）
- コードブロック・前置き・LaTeXバックスラッシュ1個などのAI出力の揺れは
  取り込み側が機械的に直して warning 報告
- 上書き取り込みで **`summary` と `doubt` が空なら既存を消さない**（2026-08-25 に
  `doubt` も `summary` と同じ扱いにした）。空は「消せ」ではなく「触るな」の意味

## 8. セットアップ状況（2026-08-25 時点）

| 項目 | 状態 |
|---|---|
| Compass側の実装（受け取り・UI・自動化） | ✅ 完了（テスト793件・本番ビルド確認済み） |
| MCPサーバーの実装（`/api/mcp`） | ✅ 完了（ローカルで疎通確認済み） |
| NOTION_TOKEN（インテグレーション「Compassの読み込み」） | ✅ `.env.local` 設定済み |
| 「Compass取り込みJSON」ページとの接続 | ✅ 済み（API疎通確認済み・現在ブロック0件） |
| `FIREBASE_SERVICE_ACCOUNT` / `COMPASS_MCP_UID` | ⬜ **未**（本人しか作れない鍵。mcp.md §5） |
| Notion AI Skills 11個（AI Skill指定済み） | ✅ 2026-08-25（`🧰 Compass MCP Tools v1` を追加、`Compass MCP Safety` を v0.3 へ） |
| **Notionカスタムエージェント作成＋毎日のスケジュール** | ⬜ **未**。2026-08-25 時点でワークスペースのエージェントは **0個**（API/MCPから作成できず、NotionのUIでしか作れない）。指示文は4体ぶん完成済み |
| Notion 側で「カスタムMCPサーバー」を有効化＋接続 | ⬜ **未**（Notionの設定 → Notion AI → AIコネクタ） |
| Vercel 本番（https://compass-tasks.vercel.app）への反映 | ✅ 2026-08-22 デプロイ / MCP 分は未デプロイ |
| 既知の穴: バックアップJSONに notes（解いた記録）が入らない | ⬜ 別タスクとして提案済み |
| 既知の穴: MCP で理解度を積んでも復習の予定は動かない | ⬜ 実運用を見てから決める（mcp.md §7） |

## 9. 関連リンク

- Notion「🧭 Compass取り込みJSON」: https://app.notion.com/p/3bb9fcddfdf481ddb2fcdbd6a7e2f297
- Notion「🤖 エージェント指示文」: https://app.notion.com/p/3be9fcddfdf481208670cdaceae6827c
- Notion「AIミーティングノート一覧（管理用）」: https://app.notion.com/p/d68b6417e15d4d01a4e1999fdfb9d99d
- Notion「📚 STUDY_OS｜v0.2-alpha」: https://app.notion.com/p/3c39fcddfdf481a29ad3fcf0abf577c5
- リポジトリ: [spec.md](spec.md)（ノート機能の全仕様）/ [notion-pull.md](notion-pull.md)（受け取りの設計）/
  [mcp.md](mcp.md)（Notion から呼ばれる MCP）
