# Compass — 復習スケジュール管理アプリ

高校生向けの復習スケジュール管理アプリ。時間割をデータ源にして入力の手間をなくし、
復習キュー方式でタスクの溜まりすぎを防ぐ。

- ホスティング: Vercel
- データ保存: Firebase(Firestore)のみ
- 認証: Firebase Auth(Googleログイン)
- スマホ優先UI

## セットアップ

1. [Firebase コンソール](https://console.firebase.google.com/) でプロジェクトを作成
2. **Authentication** → ログイン方法で「Google」を有効化
3. **Firestore Database** を作成(本番モード)
4. プロジェクトの設定 → マイアプリでウェブアプリを追加し、構成値を取得
5. `.env.local.example` をコピーして `.env.local` を作り、値を設定
   (Vercel にも同じ環境変数を追加する)

```bash
npm install
npm run dev
```

## Firestore セキュリティルール

自分のデータだけ読み書きできるようにする:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

## データ構造

```
users/{uid}/
  settings/compass-timetableTemplate … 週の基本時間割 { mon: ["数学", …], … }
  settings/compass-subjects          … 科目マスタ { list: [{ name, priority }] }
  settings/compass-settings          … { dailyLimit, queueCap, lowPriorityGenerates }
  settings/compass-daily-{YYYY-MM-DD} … その日の実績(遅延生成。未来日付も編集可)
  settings/compass-reviewQueue       … 復習タスク一覧
```

## 主要な仕組み

- **夜の確認画面**: その日の時間割下書き(テンプレから自動生成)を確認し、
  差し替え・休講チェック・メモを付けて「確定」→ 復習タスクを生成。
- **復習回数**: 科目の優先度で決まる。高=3回(1日/1週/1ヶ月)、中=2回、低=1回(設定でオフ可)。
- **自己評価**: 余裕→次の間隔を2倍 / 普通→次の間隔 / 忘れてた→翌日に再スケジュール(簡易SM-2)。
- **キュー溢れ対策**: priorityScore(科目優先度×超過日数)順に表示、1日の上限(既定10件)、
  間隔の2倍以上超過で自動アーカイブ、同一科目の期限切れ統合、
  上限(既定50件)超過時は「2週間に再分散」を提案。

## コード構成

- `src/lib/reviewLogic.ts` … 復習間隔・スコア・統合・再分散の純ロジック
- `src/lib/data.ts` … Firestore データアクセス層(UIから SDK を直接呼ばない)
- `src/lib/firebase.ts` … Firebase 初期化と認証
- `src/components/` … 画面(復習キュー / 夜の確認 / 時間割テンプレ / 設定)
