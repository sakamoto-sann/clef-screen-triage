# clef-screen-triage

Cloudflareの **Clef-flash** で、公開スクリーンショットの「読み込み中・エラー・表示済み・不明」を判定するCodexスキルです。

毎回Codexに画像全体を読ませる前に、単純な画面状態だけを小さな判断モデルに任せます。詳しい画面確認やタスクの完了判定はCodexが続けます。DOMで状態が分かる場合は、先にDOMを使います。

**個人で作成した実験的なスキルです。Cloudflare・OpenAIの公式スキルではありません。**

## 何ができるか

| 判定 | 次の処理 |
|---|---|
| `content`：主要な内容が表示されている | 状態確認を省き、依頼された検証を続ける |
| `loading`：読み込み表示やプレースホルダーが残っている | 短時間だけ待ち、撮り直す |
| `error`：障害、接続エラー、古いデータへの退避など | Codexに戻す |
| `unknown`：空白、ログイン要求、完了が分からないなど | Codexに戻す |

確信度が低い場合、認証やAPIが使えない場合もCodexに戻します。閾値は選択肢の確率0.8以上、モデルのconfidence 0.5以上、上位2候補の差0.3以上です。confidenceは正答率として校正された値ではありません。

料金、データの正しさ、デプロイ成功、操作完了、安全性、本人の承認を保証する仕組みではありません。Codexのすべての画像入力を自動で置き換えるものでもありません。

## インストール

macOS / Linux、Python 3.10以上を想定しています。実行コードはPython標準ライブラリだけで動きます。

```sh
git clone https://github.com/sakamoto-sann/clef-screen-triage.git
mkdir -p ~/.codex/skills/clef-screen-triage/scripts ~/.codex/skills/clef-screen-triage/references
cp clef-screen-triage/SKILL.md ~/.codex/skills/clef-screen-triage/
cp clef-screen-triage/scripts/triage.py ~/.codex/skills/clef-screen-triage/scripts/
cp clef-screen-triage/references/evaluation.md ~/.codex/skills/clef-screen-triage/references/
```

同名スキルが既にある場合は、上書き前に内容を確認してください。Codexの新しいタスク、またはスキル一覧の再読み込み後に利用できます。

## Cloudflareの設定

自分のCloudflareアカウントIDと、Workers AIを実行できる認証を設定します。アカウントIDは環境変数 `CLOUDFLARE_ACCOUNT_ID` に指定します。

```sh
export CLOUDFLARE_ACCOUNT_ID='自分の32桁のアカウントID'
```

認証は次のどちらかを使います。

- `CLOUDFLARE_API_TOKEN` をプロセス環境に設定する。権限は必要なアカウントのWorkers AI実行に限定してください。
- PATH上のWranglerで既にログインしている認証を使う。名前付きプロファイルを使う場合は `WRANGLER_PROFILE` を設定する。

トークンをコマンド引数、チャット、README、Git管理対象に貼らないでください。利用するシークレット管理ツールから実行環境へ渡してください。このヘルパーはトークンをファイルに保存せず、エラー本文や認証コマンドの出力も表示しません。

APIの設定は [Cloudflare公式REST APIガイド](https://developers.cloudflare.com/workers-ai/get-started/rest-api/)、モデル仕様は [Clef-flash公式ドキュメント](https://developers.cloudflare.com/workers-ai/models/clef-flash/) を参照してください。

Cloudflareの契約プランやアカウント全体の使用量は自動確認しません。無料枠内で試す場合は、ダッシュボードで自分のプランと残量を確認してください。ローカル上限は課金ゼロを保証しません。

## 使い方

自分が外部送信を許可した公開・検証用PNGに使います。

```sh
python3 ~/.codex/skills/clef-screen-triage/scripts/triage.py \
  --image /absolute/path/screenshot.png \
  --public-image
```

`--public-image` は、その画像のCloudflareへの送信を呼び出し側が許可したという宣言です。画像の公開性を自動判定するフラグではありません。私的なデスクトップ、ログイン後の画面、認証情報、個人情報は、その送信が別途許可されていない限り対象にしません。

出力例（説明用）：

```json
{"state":"content","route":"continue_visual_check","selected_probability":0.95,"confidence":0.8,"margin":0.92,"proves_data_correctness":false,"proves_action_success":false,"cache_hit":false,"input_tokens":900,"estimated_neurons":7.3638,"elapsed_ms":350.0}
```

| `route` | 呼び出し側の対応 |
|---|---|
| `continue_visual_check` | 基本状態だけは確認済みとして、依頼された詳細確認へ進む |
| `bounded_wait` | 短時間待って新しい画像を撮る |
| `codex` | 元画像とDOM/APIを使ってCodexで確認する |

待機後の呼び出しでは、累積の待機時間を `--elapsed-wait-ms 1500` のように渡します。待機時間と今回の処理時間の合計が2秒以上なら、loadingでもCodexへ戻します。ヘルパー自体は待機・撮影・ブラウザ操作をしません。これはHTTPタイムアウトではなく、推論結果を待機に使うかどうかの制限です。

## キャッシュと利用上限

- 同じ画像・質問の成功結果を24時間キャッシュ。キャッシュヒット時は認証・APIを呼ばない。
- 画像やトークンはキャッシュに保存しない。分類結果と使用量の記録はローカルに保存する。
- 既定のキャッシュ先はOSの一時ディレクトリ配下。`--cache-dir` で変更できる。
- 同じキャッシュ先で、UTC日ごとに未キャッシュ呼び出し20回、推定900 neuronsまで。各リクエスト前に100 neuronsを予約し、失敗時は予約を残す。
- 使用量の推定は入力100万トークンあたり8,182 neuronsを用いる。料金・換算率が変わる場合は更新が必要。
- 自動再試行・有料モデルへの切り替えはしない。同時実行時のロック競合はCodexへ戻す。
- 入力はPNG 1枚、4 MiB以下、100万画素以下。細かい文字を潰す縮小より、適切な撮影範囲を選ぶ。

上限はこのヘルパーとキャッシュ先に限ったものです。他のWorkers AI利用を合算せず、キャッシュ先の変更や削除でも記録は引き継がれません。

## 実測と限界

2026年10月7日の開発用20枚では20/20正解。ただし質問2つの方式では、Codexによる基本状態の画像確認を省ける判定は2/20でした。

質問を1つにし、閾値を固定してから別の13枚で評価すると **13/13正解、8/13（61.5%）が表示済みまたは短時間待機に分類**されました。エラー・古いデータへの退避・アクセス制限・未確認の操作完了を表示済み扱いした例はありませんでした。

推論リクエストの中央値は約355ms。認証取得に別途3.86秒かかったため、初回実行全体の速度ではありません。評価全体の33リクエストは入力32,124トークン、推定262.84 neuronsでした。

**61.5%は状態確認を省ける判定の割合であり、Codexトークン・使用枠・月額料金の削減率ではありません。料金削減は未測定です。**

検証用画面が多い小規模試験で、参照ラベルは作成者自身が付けています。独立した人による採点や広範な実運用検証は行っていません。[評価の詳細](references/evaluation.md)を参照してください。

## 開発・テスト

Node.js 24以上とPython 3.10以上で実行します。テストは架空の入力とモック認証だけを使い、Cloudflareへ接続しません。

```sh
npm ci
npm test
```

## ライセンス

MIT。ライセンス対象はこのスキルとヘルパーです。Cloudflareのモデルやサービスには、それぞれのライセンス・利用条件が適用されます。
