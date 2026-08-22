# Notion からのノート受け取り

2026-08-21 追加。**ノート本文の正本は Notion**（「Compass取り込みJSON」ページ）で、
Compass はそこから受け取って表示・復習する側に回る。

## 全体の流れ

```
授業 → Notion AIミーティングノート（要約＋文字起こし）
     → 毎日17:00 の Notion エージェントが compass-note@2 JSON を生成
     → 「Compass取り込みJSON」ページの日付子ページ（`8月17日`）にコードブロックで保存
     → Compass が起動時 or ボタンで受け取り（このドキュメントの範囲）
     → parseNoteJson → commitNote（手貼りモーダルと同じ経路）
```

- 正本の分担:
  - **Notion** … ノート本文（sections / recall / keywords …）。直したいときは Notion 側の
    JSON を直す（`last_edited_time` が変わり、次の受け取りで上書きされる）
  - **Compass(Firestore)** … 学習の記録。解いた記録（attempts）・復習の間隔・自分のまとめ
    （summary）・ノートの写真（scans）。上書き取り込みでも `parseNoteJson` の `existing`
    経由で引き継がれ、Notion 側からは触れない

## 部品

| 置き場所 | 役割 |
|---|---|
| `src/app/api/notion/pull/route.ts` | Notion API の往復（トークンをブラウザに出さない）。日付子ページのコードブロックを集めて返すだけで、中身は検証しない |
| `src/lib/logic/notionPull.ts` | 純ロジック。Notion レスポンスの読み手・読み飛ばし判定・上書き先の解決 |
| `src/components/parts/NotionPull.ts` | クライアントの受け取り本体。`parseNoteJson` → `commitNote` へ流し、`notionPullLog` を更新 |
| `state.notionPullLog`（永続キー） | ブロック id → `{noteId, edited}`。冪等化のログ。`compass-ui-data` に入るので端末をまたいで効く |

## 受け取りの規則

1. **読むページ** … ルート直下の子ページのうち、名前が `M月D日`（`8月17日 (2)` も可）
   か ISO 日付のもの。指示文ページは読まない。最近編集の 30 枚だけ
   （古いページは取り込み済みで動かない前提。動けば窓に戻る）。
2. **読み飛ばし** … `notionPullLog` に同じ `last_edited_time` で載っているブロックは
   取り込み済み。検証エラーだったブロックも `noteId: ''` で記録し、同じ内容では
   再挑戦しない（Notion 側で直せば `edited` が変わって自然に再挑戦）。
3. **上書き先の解決** … ①ログが指すノート → ②授業日+教科+単元が一致するノート →
   ③無ければ新規。②があるのは、エージェントの再実行が `8月17日 (2)` と**別ページ**を
   作る運用のため（ブロック id では同一授業と分からない）。写真込みでやり直す
   カスタム GPT → 手貼りの上書きとも、この 3 つ組で自然に重なる。
4. **処理順** … ページ作成の古い順 × ページ内の並び順。`(2)` ページが後に来て
   上書きで勝つ（後勝ち）。
5. **起動時の自動受け取り** … `notes` と `compass-ui-data`（ログ）の両方が読み込まれてから
   1 回。新しいノートが入ったときだけトーストを出し、未設定・新着ゼロ・失敗では黙る。
   preview では走らない。手動は ノート画面サイドバーの「⟳ Notionから受け取る」。

## セットアップ（1 回だけ）

1. https://www.notion.so/my-integrations で「新しいインテグレーション」を作る
   （ワークスペースは Compass のノートがある方。権限は「コンテンツを読み取る」だけでよい）
2. シークレットを `.env.local` の `NOTION_TOKEN=` に貼る
3. Notion の「Compass取り込みJSON」ページを開き、右上「…」→「接続」→ 作った
   インテグレーションを追加（子ページにも継承される）
4. `NOTION_NOTES_PAGE_ID` はそのページ URL 末尾の 32 桁（`.env.local` に設定済み）
5. dev サーバーを再起動

未設定のままでもアプリは普通に動く（自動受け取りは黙って何もしない。ボタンを押すと
設定を促すトーストが出る）。

## Vercel（https://compass-tasks.vercel.app）

- プロジェクト `compass-tasks`（チーム n494n0）。Git 連携はしておらず、`npx vercel --prod` で
  手元の作業ツリーをそのまま上げる（`.gitignore` が `.vercelignore` を兼ねるので
  `.env.local` は上がらない）
- Production の環境変数: Firebase の `NEXT_PUBLIC_*` 6 つ ＋ `NOTION_TOKEN` ＋
  `NOTION_NOTES_PAGE_ID` ＋ `NOTION_ALLOWED_EMAILS`
- Firebase Auth の「承認済みドメイン」に `compass-tasks.vercel.app` が要る（Google ログインの
  ポップアップがこのドメインで開けるように）

## 決めたこと

- **手貼りモーダルは残す**。写真込みでやり直すカスタム GPT の経路と、Notion が落ちて
  いるときの控え。サイドバーでは受け取りボタンを主、手貼りを従に並べ替えた。
- **API ルートの本人確認は env で切り替える**（2026-08-22）。`NOTION_ALLOWED_EMAILS` が
  空ならローカル専用の緩さ（誰でも叩ける）。設定すると Firebase ログインの ID トークンを
  `Authorization: Bearer` で要求し、Google の公開鍵（`jose` の `createRemoteJWKSet`）で
  検証して、`email_verified` かつ一覧にあるメールだけ通す。Vercel では必ず設定する
  （ノートの中身と Notion の API 枠を他人に使わせないため）。
- **Notion への書き戻しはしない**。まとめ・理解度は Compass 側の学習記録で、
  正本の分担を崩さない。
