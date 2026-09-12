# セットアップ

## 1. スキルを作る

Amazon Developer Consoleで、Echoと同じAmazonアカウントを使用します。
日本語、Custom、自前ホスティングを選びます。公開・Lists権限・アカウントリンクは不要です。
呼び出し名は「やること相棒」。日本語対話モデルJSONをインポートしてビルドします。

`wrangler.jsonc`にSkill IDを設定します。呼び出し名がAmazon側で受理されない場合や、SearchQueryの境界が誤認識される場合はConsoleの検証結果と実発話に合わせてサンプルを調整してください。

## 2. 許可するuserIdを得る

TestをDevelopmentにし、Simulatorでスキルを起動します。リクエストJSONの`context.System.user.userId`を確認します。エンドポイント未設定の場合は、先に仮のWorkerをデプロイしてHTTPS URLを設定します。503でもリクエストJSONが表示されればIDを取得できます。

`ALLOWED_ALEXA_USER_ID`をSecretsへ登録します。IDが確認できない場合は設定完了を待ち、未認証の登録用URLを公開しないでください。
任意のdeviceId制限は、実機のIDを確認してから設定します。SimulatorのIDをEchoのIDと混同しないでください。

## 3. TodoistとCloudflare

TodoistのSettings → Integrations → Developerから個人APIトークンを取得します。
最初の書き込み確認には専用のテストアカウントを推奨します。追加先はそのトークンのInboxで、一覧・更新はそのアカウントのタスクが対象です。
TodoistのタイムゾーンはAsia/Tokyoにします。

```sh
npm ci
npx wrangler login
npx wrangler secret put TODOIST_API_TOKEN
npx wrangler secret put ALLOWED_ALEXA_USER_ID
npm run deploy
```

初回のsecret登録でWorker作成を求められた場合はこのアプリのWorkerだけを作成します。Workers Freeを選び、有料プランへ自動移行しません。

HTTPS URLは`/alexa`まで含めます。TLS設定は実際のworkers.devホストのCA署名済みワイルドカード証明書に対応する選択肢を使用します。
URLにCloudflare Access・ブラウザチャレンジは挟みません。全API操作は署名検証後に実行されます。

## 4. ローカルと本番を分離

`.dev.vars`はローカル専用です。Gitに含めません。本番Secretsの代用にはなりません。
本番Workerの入口に署名検証無効化フラグはありません。ローカル対話ロジックのテストはモックAPIで実施します。
開発用のWorker名とSkill IDを分ける場合はWrangler設定ファイルを複製し、`--config`で対象を明示してください。Secretsもそれぞれ登録します。

## 5. APL

ConsoleのInterfaceでAPLを有効化し、Hub Landscape Smallをサポート対象にします。
`ENABLE_APL`を`"true"`に変更してデプロイします。音声一覧の順序と画面番号が同じであること、ボタン→音声確認→確定が動くことを実機で確認します。

## トークン更新

Todoistでトークンを更新したら、同じSecret名に再登録します。漏洩したトークンは失効させます。
スキルを無効化・再有効化してuserIdが変わった場合は、信頼できるConsole上で新しいIDを確認して許可設定を更新します。
