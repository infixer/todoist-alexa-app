# やること相棒

Echo Show 5（第2世代）からTodoistを操作する個人用Alexaカスタムスキルです。
Cloudflare Workersで動きます。Alexa Lists API、AWS、独自DB、定期処理、生成AIは使いません。

## できること

- 「アレクサ、やること相棒で牛乳を追加」→ 復唱 →「はい」でInboxへ期限なし追加
- 「アレクサ、やること相棒で今日の一覧」→ 今日が期限のタスクを5件ずつ読み上げ
- 同じ会話で「二番を完了」「二番を明日に延期」→ 確認 →「はい」で実行
- 「続き」で次の5件。「今日の一覧」で再取得・番号の振り直し
- オプションのAPL画面：番号・タスク名・完了／明日へボタン。確定は音声の「はい」

**実アカウントへの接続、Alexaによる対話モデルのビルド、実機APL描画、Cloudflare FreeのCPU計測は、セットアップ後に実施してください。ローカルテストだけで実機動作や無料枠適合を保証するものではありません。**

## 開発

Node.js 24 LTSとnpmを使用します。

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run check
npm run dev
```

`.dev.vars`にローカル用Secretsを入れ、`wrangler.jsonc`の`ALEXA_SKILL_ID`を設定します。
未設定の状態では`POST /alexa`は503、署名なしでは400を返します。公開入口に認証回避モードはありません。

## 初回セットアップ

詳しくは[セットアップ手順](docs/setup.md)を参照してください。

1. Amazon Developer Consoleで日本語Customスキルを作成（自前ホスティング、Development）。
2. `skill-package/interactionModels/custom/ja-JP.json`をJSON Editorへ貼り付け、Build Model。
3. Skill IDを`wrangler.jsonc`に設定。
4. `npm exec wrangler login`でCloudflareにログインし、下記Secretsを登録。
5. `npm run deploy`後、Developer ConsoleのHTTPSエンドポイントに`https://<worker>.<subdomain>.workers.dev/alexa`を設定。
6. Simulatorと、自分のAmazonアカウントに登録したEchoで動作確認。

```sh
npx wrangler secret put TODOIST_API_TOKEN
npx wrangler secret put ALLOWED_ALEXA_USER_ID
# 必要な場合だけ指定（SimulatorとEchoではIDが異なる）
npx wrangler secret put ALLOWED_ALEXA_DEVICE_ID
```

値は対話入力し、ソース・Git・チャットに貼らないでください。`secret put`はWorkerのバージョンを更新・デプロイする操作です。

## APL

音声確認後、ConsoleでAlexa Presentation Languageを有効化し、`hubLandscapeSmall`を対象にします。
`wrangler.jsonc`の`ENABLE_APL`を`"true"`にして再デプロイすると、対応端末にAPL 1.4の画面を返します。
APL非対応端末には音声のみ返します。古い画面・セッション切れの番号でタスクを更新しません。

## 操作上の制限

- 今日＝日本時間で今日が期限の未完了タスク。期限切れは含めません。TodoistのタイムゾーンをAsia/Tokyoに設定してください。
- 番号は同じセッション内だけ有効です。保持期限は最大5分、確認待ちは60秒。Alexa自身のタイムアウトで先に終了する場合があります。
- 番号を再利用して別タスクを指さないよう、操作済み番号は詰めません。
- 子タスクがある親の完了、繰り返しタスクの延期はTodoistアプリで行います。繰り返しタスクの完了は今回分を完了します。
- 日本以外のタイムゾーンを前提とした運用、100件を超える一会話の一覧は対象外です。
- 読み取り→確認→更新はTodoist全体をロックしません。別クライアントと同時編集しないでください。
- 更新結果不明時は同じUUIDの操作だけ再試行します。新しく「追加」と言い直すと別操作になるため重複し得ます。
- タスク名は読み上げ用に160文字、画面では120文字まで表示します。内容はAlexaにも送信されます。

## 構成とセキュリティ

- `src/security.ts`：生本文のSHA-256署名、CAチェーン・SAN・期限・timestamp、利用者の検証
- `src/skill.ts`：音声/APL共通の確認フローと番号管理
- `src/todoist.ts`：Todoist API v1の読み取りとUUID付き`/sync`書き込み
- `src/apl.ts`：小型横画面用のAPL
- `test/`：署名・チェーン・リプレイ・番号・日付・APIエラー・Worker入口のテスト

署名証明書は1時間以内かつ証明書期限内だけメモリーにキャッシュします。タスクやトークンのログは出しません。
利用者ID制限はアカウント制限であり、Echoに話しかける人の生体認証ではありません。

[アーキテクチャと採用条件](docs/architecture.md) / [実機受入チェック](docs/acceptance.md)
