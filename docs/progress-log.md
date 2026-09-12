# やること相棒 作業ログ

最終更新: 2026-09-12

## 目的

Echo Show 5（第2世代）から、Alexaカスタムスキル「やること相棒」を通じてTodoistを操作する。Todoistを唯一のタスク保存先とし、Cloudflare Workersをバックエンドに使う。

MVPの対象操作は次の4つ。

1. タスクを追加する
2. 今日のタスクを一覧表示・読み上げする
3. 一覧の番号を指定してタスクを完了する
4. 一覧の番号を指定してタスクを明日に延期する

## 決定した構成

```text
Echo Show 5
  → Alexaカスタムスキル「やること相棒」
  → Cloudflare Workers
  → Todoist API v1
  → Todoist
```

- Alexa Lists APIは使用しない。
- AWS Lambda、独自DB、Cron、キュー、生成AIはMVPでは使用しない。
- Todoistの個人APIトークンはCloudflare Workers Secretsに保存する。
- 番号とTodoistタスクIDの対応はAlexaのセッション属性に保持する。
- 一覧の有効期間は最大5分、更新確認の有効期間は60秒。
- APLは実装済みだが、初期設定では無効にして音声操作を先に確認する。
- 子タスクを持つ親タスクの完了と、繰り返しタスクの延期はMVP対象外。

設計の詳細は[architecture.md](architecture.md)、セットアップ方法は[setup.md](setup.md)を参照。

## リポジトリと実装状況

- リポジトリ: <https://github.com/infixer/todoist-alexa-app>
- 作業ブランチ: `feat/personal-alexa-skill`
- ドラフトPR: <https://github.com/infixer/todoist-alexa-app/pull/1>

### 2026-09-12: 初期実装

コミット: `08cfd77 Implement personal Alexa Todoist skill on Cloudflare Workers`

実装した内容:

- Cloudflare Workerの`POST /alexa`エンドポイント
- Alexaの署名、証明書チェーン、SAN、証明書期限、150秒以内のタイムスタンプ検証
- Skill ID、Alexa userId、任意のdeviceIdによる利用制限
- Todoist API v1クライアント
- タスク追加、今日の一覧、完了、翌日延期
- 書き込み前の「はい／いいえ」による確認
- Todoist `/sync`のコマンドUUIDを使った重複実行防止
- 一覧番号とTodoistタスクIDの固定対応
- Echo Show向けAPL一覧、完了ボタン、明日へボタン
- 日本語対話モデルJSON
- セットアップ手順、アーキテクチャ、実機受入チェックリスト
- GitHub ActionsによるCI

署名検証の実装中、Workers互換ランタイムでは`node:tls.rootCertificates`が空になることが判明した。そのため、公式Node.js 24 LTSのMozilla CAストアから生成した公開ルートCAをリポジトリへ同梱し、信頼済みルートまで証明書チェーンを検証する方式へ変更した。

初期実装時の検証結果:

- TypeScript型チェック成功
- 33件のテストがNode.js上で成功
- 同じ33件がWorkers互換ランタイム上でも成功
- Wranglerのデプロイ用dry-runビルド成功
- `npm audit`で既知の脆弱性0件
- GitHub ActionsのCI成功

### 2026-09-12: 日本語サンプル発話の修正

コミット: `b5089cf Separate Japanese utterance slot tokens with spaces`

Alexa Developer Consoleで最初の対話モデルをビルドしたところ、12件のエラーが発生した。

主なエラー:

```text
Parsing error in sample: "CompleteTaskIntent: {taskNumber}番を完了".
The slot "taskNumber" in intent "CompleteTaskIntent" is not referenced.
The slot "taskContent" in intent "AddTaskIntent" is not referenced.
```

原因は、スロット参照と前後の日本語が空白なしで連結されていたこと。

```text
修正前: {taskNumber}番を完了
修正後: {taskNumber} 番を完了

修正前: タスクに{taskContent}を追加して
修正後: タスクに {taskContent} を追加して
```

すべてのスロット参照の前後に半角スペースを追加した。再発防止として、宣言済みスロットがサンプル発話から参照され、参照の前後が空白または文端になっていることを検証するテストも追加した。

修正後のローカル検証:

- TypeScript型チェック成功
- 34件のテスト成功
- 修正版JSONをGitHubへpush済み

修正版の対話モデル:

<https://raw.githubusercontent.com/infixer/todoist-alexa-app/b5089cf/skill-package/interactionModels/custom/ja-JP.json>

### 2026-09-12: Alexa対話モデルのビルド成功

修正版の日本語対話モデルをAlexa Developer Consoleへ貼り直し、Save、Build skillを実行した。ビルドは成功した。

これにより、呼び出し名、4つのカスタムインテント、確認や終了などの標準インテント、各スロットとサンプル発話がAlexa側へ登録された。

## Alexa Developer Consoleで実施済みの作業

1. Alexa Developer Consoleで新しいスキルを作成した。
2. スキル名を「やること相棒」にした。
3. モデルはCustomを選択した。
4. ホスティングはProvision your ownを選択した。
5. テンプレートはStart from Scratchを選択した。
6. 最初の日本語対話モデルJSONをJSON Editorへ貼り付けた。
7. Build skillを実行し、上記のサンプル発話エラーを確認した。
8. 修正版JSONへ置き換えた。
9. SaveとBuild skillを再実行し、ビルド成功を確認した。

Alexa Skill ID:

```text
amzn1.ask.skill.5683b3f7-f821-4ba1-ac2a-28b209a05572
```

## 現在地

修正版の日本語対話モデルはリポジトリへ反映済みで、Alexa Developer Consoleでのビルドも成功している。

Cloudflare Workerはまだ実アカウントへデプロイしていない。Todoist APIトークン、許可するAlexa userId、Skill IDの本番設定も未実施。

## 次に行うこと

次回はCloudflare Workerの設定から再開する。順序は以下のとおり。

### 1. Skill IDをリポジトリへ設定する

対象ファイルは`wrangler.jsonc`。`ALEXA_SKILL_ID`の空文字を、作成済みスキルのIDに置き換える。

```json
"ALEXA_SKILL_ID": "amzn1.ask.skill.5683b3f7-f821-4ba1-ac2a-28b209a05572"
```

Skill IDは認証情報ではないため、リポジトリへ保存してよい。

### 2. Cloudflareへログインする

リポジトリのルートで依存関係を準備し、WranglerからCloudflareへログインする。

```sh
npm ci
npx wrangler login
```

ブラウザーにCloudflareの認可画面が表示されたら、このWorkerを配置するCloudflareアカウントで許可する。Workers Freeプランを維持し、有料プランへの変更は行わない。

### 3. Todoistトークンを取得する

Todoistの「設定 → 連携機能 → 開発者」から個人APIトークンを確認する。トークンはコピーしても、GitHub、ソースコード、チャットには貼らない。

Todoistのタイムゾーンも`Asia/Tokyo`になっていることを確認する。

### 4. 先にWorkerをデプロイする

許可するAlexa userIdはSimulatorのリクエストJSONから取得するため、まずWorkerを作成する。Todoistトークンは対話入力でSecretへ登録する。

```sh
npx wrangler secret put TODOIST_API_TOKEN
npm run deploy
```

`secret put`の実行中に値の入力を求められたら、その場でTodoistトークンを貼り付ける。値はコマンド行の引数に含めない。

デプロイ後に次のようなURLが表示されるので控える。

```text
https://todoist-alexa-app.<Cloudflareのサブドメイン>.workers.dev/alexa
```

この時点では`ALLOWED_ALEXA_USER_ID`が未設定なので、WorkerはAlexaの処理を実行しない。Todoistの更新も発生しない。

### 5. AlexaへEndpointを設定する

Alexa Developer Consoleで左側の「Endpoint」を開く。

- Service Endpoint TypeはHTTPSを選ぶ。
- Default Regionへ、WorkerのURLを`/alexa`まで含めて入力する。
- SSL Certificate Typeは、信頼された認証局が発行した証明書を使う選択肢を選ぶ。英語表示では「My development endpoint is a sub-domain of a domain that has a wildcard certificate from a certificate authority」に相当する選択肢。
- Save Endpointsを押す。

`workers.dev`の前にCloudflare Accessやブラウザーチャレンジを設定しない。

### 6. Alexa userIdを取得して許可する

Alexa Developer Consoleの「Test」を開き、Skill testing is enabled inをDevelopmentにする。入力欄で次を実行する。

```text
やること相棒を開いて
```

リクエストJSONの次の位置にある値を確認する。

```text
context.System.user.userId
```

この時点ではWorkerが未設定エラーを返してもよい。取得したuserIdをCloudflareのSecretへ対話入力する。

```sh
npx wrangler secret put ALLOWED_ALEXA_USER_ID
```

この操作で新しいWorkerバージョンが反映される。userIdもチャットや公開Issueへ貼らない。

`ALLOWED_ALEXA_DEVICE_ID`は初回には設定しない。SimulatorとEcho実機でdeviceIdが異なるため、設定すると片方が使えなくなる可能性がある。

### 7. Alexa Simulatorで音声MVPを確認する

まず追加によるTodoistの変更が起きない読み取り操作から確認する。

```text
やること相棒で今日の一覧
```

続いてテスト用のタスクで以下を確認する。

```text
やること相棒で動作確認を追加
いいえ

やること相棒で動作確認を追加
はい

やること相棒で今日の一覧
二番を明日に延期
いいえ
```

「いいえ」の後にTodoistが変更されていないことを確認してから、「はい」で完了と延期を試す。重要な実タスクを最初の確認に使わない。

### 8. Echo Show 5実機で音声を確認する

Alexa Developer ConsoleとEcho Show 5が同じAmazonアカウントに登録されていることを確認する。次の4操作を実機で試す。

1. タスクを追加する
2. 今日の一覧を聞く
3. 同じ会話内で番号を指定して完了する
4. 同じ会話内で番号を指定して明日に延期する

番号はセッションをまたいで使用できない。会話が終了した場合は、再度「今日の一覧」から始める。

### 9. APLを有効化する

音声の4操作が安定してから行う。

1. Alexa Developer ConsoleのInterfacesでAlexa Presentation Languageを有効にする。
2. `hubLandscapeSmall`をサポート対象にする。
3. `wrangler.jsonc`の`ENABLE_APL`を`"true"`へ変更する。
4. `npm run deploy`を実行する。
5. Echo Show 5で一覧、完了ボタン、明日へボタン、音声での最終確認を試す。

古い画面から操作した場合に、別のタスクが更新されず、一覧更新を求められることも確認する。

### 10. Cloudflare無料枠の適合を確認する

Cloudflare DashboardのWorker Metricsで次を確認する。

- Error 1102が発生していない。
- 証明書を初めて検証するリクエストでも、CPU時間の超過が継続して発生しない。
- Alexaがタイムアウトする前に応答している。
- リクエスト数がFreeプランの日次上限内に収まっている。

ローカルテストの処理時間はCloudflareのCPU時間と同じではない。実デプロイ後のMetricsを判断材料にする。

### 11. 最後にPRをマージする

実機受入チェックが終わったら、[ドラフトPR #1](https://github.com/infixer/todoist-alexa-app/pull/1)へ結果を記録し、Ready for reviewへ変更してから`main`へマージする。

実アカウントでの詳しい確認項目は[acceptance.md](acceptance.md)にまとめている。

実アカウントでの確認項目は[acceptance.md](acceptance.md)にまとめている。

## Secrets取り扱い上の注意

次の値はGitHub、ソースコード、チャットへ貼らない。

- Todoist個人APIトークン
- Cloudflare APIトークン

Todoistトークンは次のコマンドで対話入力する。

```sh
npx wrangler secret put TODOIST_API_TOKEN
```

Alexa userIdは秘密鍵ではないが、個人用スキルのアクセス制限値なので、Workers Secretとして登録する。

```sh
npx wrangler secret put ALLOWED_ALEXA_USER_ID
```

ローカル開発では`.dev.vars`を使用する。このファイルは`.gitignore`の対象になっている。

## 公式仕様の確認先

- [AlexaカスタムスキルをWebサービスとしてホスティング](https://developer.amazon.com/en-US/docs/alexa/custom-skills/host-a-custom-skill-as-a-web-service.html)
- [Alexaのインテント、発話、スロット](https://developer.amazon.com/ja-JP/docs/alexa/custom-skills/create-intents-utterances-and-slots.html)
- [Todoist API v1](https://developer.todoist.com/api/v1/)
- [Cloudflare Workersの制限](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
