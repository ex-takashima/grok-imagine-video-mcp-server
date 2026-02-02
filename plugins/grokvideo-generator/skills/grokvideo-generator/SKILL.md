---
name: grokvideo-generator
description: grok-imagine-video-batch CLIを使用し、テキスト/画像から動画を生成・編集
argument: 動画生成プロンプト
allowed-tools: Bash(echo *), Bash(npx grok-imagine-video-batch *), Read, Write, Skill
---

# Grok Imagine Video 動画生成スキル（CLI版）

`grok-imagine-video-batch` CLIを使用し、テキストや画像から動画を生成・編集するアシスタントです。


## 概要

- **Text-to-Video**: テキストプロンプトから動画を生成
- **Image-to-Video**: 画像を入力として動画を生成
- **Video Edit**: 既存動画をプロンプトで編集
- **バッチ処理**: 複数動画を一括処理

## 注意事項

- **生成時間**: 動画生成には数分かかる場合があります（5〜10分程度）
- **テキスト描画は苦手**: 細かい文字やテキストを含む動画は期待通りにならない場合があります
- **編集時の制限**: 編集する動画は最大8.7秒まで

## 動画長の制限

| 操作 | 最小 | 最大 | デフォルト |
|------|------|------|-----------|
| 生成（Text/Image-to-Video） | 1秒 | 15秒 | 5秒 |
| 編集 | - | 8.7秒 | 元動画と同じ |

## アスペクト比

| アスペクト比 | 用途 |
|--------------|------|
| `16:9` | 横長ワイドスクリーン、YouTube（デフォルト） |
| `4:3` | 標準的な横長 |
| `1:1` | 正方形、Instagram |
| `9:16` | 縦長、TikTok、Reels、Stories |
| `3:4` | 縦長 |

## 解像度

| 解像度 | 説明 |
|--------|------|
| `720p` | HD画質（デフォルト） |
| `480p` | 標準画質 |

## 実行手順

### Step 0: 環境チェック（初回のみ）

スキル実行前に環境を確認します。

**1. 環境変数の確認:**
```bash
echo $XAI_API_KEY
```

未設定の場合:
```
XAI_API_KEY が設定されていません。

設定方法:
export XAI_API_KEY="xai-your-api-key"

APIキーは https://console.x.ai/ から取得できます。
```

**2. CLIツールの確認:**
```bash
npx grok-imagine-video-batch --version
```

エラーの場合は自動的にダウンロードされます（npx経由）。

> **Note**: `npx` を使用するため、事前インストールは不要です。初回実行時に自動でダウンロードされます。

### Step 1: プロンプト確認

ユーザーの入力を確認:

**パターンA: プロンプト指定**
```
/grokvideo-generator 猫がボールで遊んでいる動画
```

**パターンB: 引数なし**
```
/grokvideo-generator
```
→ 対話形式で情報を収集

**パターンC: 画像から動画**
```
/grokvideo-generator この画像のキャラクターを歩かせて [画像URL]
```

**パターンD: 動画編集**
```
/grokvideo-generator この動画の背景を夜に変更して [動画URL]
```

### Step 2: パラメータ決定

ユーザーの要望に基づいてパラメータを決定:

**Text-to-Video（テキストから動画生成）:**

| パラメータ | デフォルト | 説明 |
|------------|------------|------|
| `duration` | `5` | 動画長（1-15秒） |
| `aspect_ratio` | `16:9` | アスペクト比 |
| `resolution` | `720p` | 解像度 |

**Image-to-Video（画像から動画生成）:**

| パラメータ | デフォルト | 説明 |
|------------|------------|------|
| `image_url` | - | 入力画像のURL |
| `image_path` | - | ローカル画像ファイルパス（R2自動アップロード） |
| `duration` | `5` | 動画長（1-15秒） |

> **注意**: `image_url` または `image_path` のいずれかを指定（同時指定不可）。`image_path` を使用するにはR2環境変数の設定が必要です。

**Video Edit（動画編集）:**

| パラメータ | デフォルト | 説明 |
|------------|------------|------|
| `video_url` | - | 編集する動画のURL（必須、最大8.7秒） |

※編集時は動画長は元動画と同じになります

### Step 3: バッチ設定JSON構築

**Text-to-Video の例:**
```json
{
  "jobs": [
    {
      "prompt": "猫がボールで遊んでいる",
      "output_path": "cat_video.mp4",
      "duration": 5,
      "aspect_ratio": "16:9",
      "resolution": "720p"
    }
  ],
  "output_dir": "./output"
}
```

**Image-to-Video の例（URL指定）:**
```json
{
  "jobs": [
    {
      "prompt": "キャラクターが歩いているアニメーション",
      "image_url": "https://example.com/character.jpg",
      "output_path": "walking.mp4",
      "duration": 10
    }
  ],
  "output_dir": "./output"
}
```

**Image-to-Video の例（ローカルファイル）:**
```json
{
  "jobs": [
    {
      "prompt": "キャラクターが歩いているアニメーション",
      "image_path": "./images/character.png",
      "output_path": "walking.mp4",
      "duration": 10
    }
  ],
  "output_dir": "./output"
}
```

**Video Edit の例:**
```json
{
  "jobs": [
    {
      "prompt": "背景を夜景に変更して",
      "video_url": "https://example.com/video.mp4",
      "output_path": "edited.mp4"
    }
  ],
  "output_dir": "./output"
}
```

**複数パターン生成の例:**
```json
{
  "jobs": [
    {
      "prompt": "猫がボールで遊んでいる、昼間の庭",
      "output_path": "cat_day.mp4",
      "duration": 5,
      "aspect_ratio": "16:9"
    },
    {
      "prompt": "猫がボールで遊んでいる、夜の部屋",
      "output_path": "cat_night.mp4",
      "duration": 5,
      "aspect_ratio": "16:9"
    }
  ],
  "output_dir": "./output",
  "max_concurrent": 2
}
```

### Step 4: 設定ファイル作成

スクラッチパッドディレクトリに設定ファイルを作成:

```typescript
Write({
  file_path: "{scratchpad}/video-batch.json",
  content: JSON.stringify(batchConfig, null, 2)
})
```

### Step 5: バッチCLI実行

```bash
npx grok-imagine-video-batch {scratchpad}/video-batch.json --output-dir {output_dir} --format json
```

**CLIオプション:**

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `--output-dir <path>` | 出力ディレクトリ | 設定ファイルから |
| `--format text\|json` | 出力フォーマット | `text` |
| `--timeout <ms>` | タイムアウト（ミリ秒） | `600000` |
| `--max-concurrent <n>` | 最大同時実行数（1-10） | `2` |
| `--poll-interval <ms>` | ポーリング間隔（ミリ秒） | `5000` |
| `--max-poll-attempts <n>` | 最大ポーリング回数 | `120` |
| `--estimate-only` | コスト見積もりのみ | - |

### Step 5b: バックグラウンド実行（推奨）

動画生成は時間がかかるため、バックグラウンド実行を推奨します。

```javascript
// バックグラウンドで実行
Bash("npx grok-imagine-video-batch " + configPath + " --output-dir " + outputDir + " --format json --timeout 900000", { run_in_background: true })
// → task_id が返る

// 後で結果取得
TaskOutput(task_id)
```

**長時間生成の場合（タイムアウト延長）:**
```bash
npx grok-imagine-video-batch config.json --timeout 1200000 --max-poll-attempts 200
```

### Step 6: 結果報告

**成功時:**
```
動画を生成しました。

出力先: {output_dir}/{filename}.mp4
プロンプト: {使用したプロンプト}
動画長: {duration}秒
アスペクト比: {aspect_ratio}
```

**失敗時:**
```
動画生成に失敗しました。

エラー: {エラーメッセージ}

対処法:
1. プロンプトを修正して再試行
2. コンテンツポリシー違反の可能性を確認
3. 画像/動画URLがアクセス可能か確認
```

## 対話モード（引数なしの場合）

```
動画を生成します。

どのような動画を生成しますか？
（例: 猫がボールで遊んでいる5秒の動画）

また、以下も指定できます:
- 動画長: 1〜15秒（デフォルト: 5秒）
- アスペクト比: 16:9, 4:3, 1:1, 9:16
- 解像度: 720p, 480p
- 画像から動画: 画像URLを指定
- 動画編集: 動画URLを指定（最大8.7秒）
```

## 終了コード

| コード | 意味 |
|--------|------|
| 0 | 成功（全ジョブ完了） |
| 1 | エラー（失敗またはキャンセルあり） |

## 環境要件

- Node.js 18.0.0 以上
- `XAI_API_KEY` 環境変数が設定されていること

### ローカル画像（image_path）を使用する場合

Cloudflare R2 への自動アップロードが必要です。以下の環境変数を設定してください：

| 変数 | 説明 |
|------|------|
| `R2_ACCOUNT_ID` | Cloudflare アカウント ID |
| `R2_ACCESS_KEY_ID` | R2 API アクセスキー ID |
| `R2_SECRET_ACCESS_KEY` | R2 API シークレットキー |
| `R2_BUCKET_NAME` | R2 バケット名 |
| `R2_PUBLIC_URL` | R2 バケットの公開URL（例: `https://pub-xxxx.r2.dev`） |

## 使用例

### シンプルな生成
```
/grokvideo-generator 夕焼けの海辺を歩く人のシルエット
```

### 動画長指定
```
/grokvideo-generator 10秒で猫が眠りにつく様子
```
→ `duration: 10` を使用

### アスペクト比指定
```
/grokvideo-generator TikTok用の縦動画: ダンスするキャラクター
```
→ `aspect_ratio: "9:16"` を使用

### 複数生成
```
/grokvideo-generator 猫の動画を3パターン生成して
```
→ 3つのjobsを作成

### 画像から動画（Image-to-Video）
```
/grokvideo-generator この画像のキャラクターが手を振る: https://example.com/character.png
```
→ `image_url` を指定

### 動画編集
```
/grokvideo-generator この動画を夜のシーンに変更: https://example.com/video.mp4
```
→ `video_url` を指定して編集モード

## プロンプトのコツ

| ポイント | 説明 |
|----------|------|
| 具体的に | 「猫」より「オレンジ色の猫がボールを追いかけている」 |
| 動きを指定 | 「歩く」「走る」「ジャンプする」「回転する」など |
| 雰囲気指定 | 「晴れた日」「雨の中」「夕焼け」「ネオンライト」など |
| カメラワーク | 「パン」「ズームイン」「追従ショット」など |
| テキストは避ける | 文字を含む動画は苦手なので別途合成を推奨 |

## コスト目安

動画生成はAPI利用料金がかかります。詳細は [console.x.ai](https://console.x.ai/) を確認してください。

## トラブルシューティング

### ポーリングがタイムアウトする

```bash
# ポーリング回数を増やす
npx grok-imagine-video-batch batch.json --max-poll-attempts 200

# タイムアウトを延長（20分）
npx grok-imagine-video-batch batch.json --timeout 1200000
```

### Rate Limit エラー

並列数を減らしてください:

```json
{
  "max_concurrent": 1,
  "retry_policy": {
    "max_retries": 3,
    "retry_delay_ms": 5000
  }
}
```

## インストール方法

### スキルのインストール

```bash
# マーケットプレイス追加
/plugin marketplace add ex-takashima/grok-imagine-video-mcp-server

# プラグインインストール
/plugin install grokvideo-generator@ex-takashima
```

### 環境変数設定

```bash
export XAI_API_KEY="xai-your-api-key"
```
