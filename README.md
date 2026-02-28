# Grok Imagine Video MCP Server

[![npm version](https://badge.fury.io/js/grok-imagine-video-mcp-server.svg)](https://www.npmjs.com/package/grok-imagine-video-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

xAI の Grok Imagine Video API 用 MCP (Model Context Protocol) サーバー。テキストプロンプトからの動画生成、画像からの動画生成（Image-to-Video）、既存動画の編集をサポートします。

## クイックスタート (npx)

最も簡単な方法は `npx` を使用することです：

```bash
# APIキーを設定
export XAI_API_KEY="xai-your-api-key"

# サーバーを実行
npx grok-imagine-video-mcp-server
```

## 機能

- **動画生成（Text-to-Video）**: テキストプロンプトから新規動画を生成
- **動画生成（Image-to-Video）**: 画像を入力として動画を生成
- **動画編集**: 既存動画をプロンプトで編集
- **バッチ処理**: CLIで複数動画を一括処理
- 多様なアスペクト比をサポート（16:9, 4:3, 1:1, 9:16 など）
- 解像度: 720p, 480p
- 動画長: 1〜15秒（編集時は元動画と同じ長さ）
- 非同期処理対応（ポーリングによる結果取得）

## サポートモデル

| モデル | 機能 | 備考 |
|--------|------|------|
| `grok-imagine-video` | 生成・編集 | **推奨・デフォルト** |

## 必要条件

- Node.js 18.0.0 以上
- xAI API キー（[console.x.ai](https://console.x.ai/) から取得）

## インストール

### 方法1: npx（推奨）

```bash
npx grok-imagine-video-mcp-server
```

### 方法2: グローバルインストール

```bash
npm install -g grok-imagine-video-mcp-server
grok-imagine-video-mcp-server
```

## 設定

### 環境変数

| 変数 | 必須 | 説明 |
|------|------|------|
| `XAI_API_KEY` | Yes | xAI API キー |
| `DEBUG` | No | `true` でデバッグログを有効化 |
| `OUTPUT_DIR` | No | 動画のデフォルト出力ディレクトリ |
| `VIDEO_POLL_INTERVAL` | No | ポーリング間隔（ミリ秒、デフォルト: 5000） |
| `VIDEO_MAX_POLL_ATTEMPTS` | No | 最大ポーリング回数（デフォルト: 120） |

### Claude Desktop 設定

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "grok-imagine-video": {
      "command": "npx",
      "args": ["-y", "grok-imagine-video-mcp-server"],
      "env": {
        "XAI_API_KEY": "xai-your-api-key-here"
      }
    }
  }
}
```

## ツール

### generate_video

テキストプロンプトまたは画像から動画を生成します。

| パラメータ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `prompt` | string | Yes | 生成する動画の説明テキスト |
| `output_path` | string | No | 出力ファイルパス（デフォルト: generated_video.mp4） |
| `model` | string | No | モデル（デフォルト: grok-imagine-video） |
| `duration` | number | No | 動画長（1-15秒、デフォルト: 5） |
| `aspect_ratio` | string | No | アスペクト比（デフォルト: 16:9） |
| `resolution` | string | No | 解像度（720p/480p、デフォルト: 720p） |
| `image_url` | string | No | Image-to-Video用の入力画像URL |
| `image_path` | string | No | ローカル画像ファイルパス（base64 data URLとしてAPIに送信） |

> **注意**: `image_url` と `image_path` は同時に指定できません。

### edit_video

既存動画を編集します。

| パラメータ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `prompt` | string | Yes | 編集内容の説明 |
| `video_url` | string | Yes | 編集する動画のURL（公開アクセス可能、最大8.7秒） |
| `output_path` | string | No | 出力ファイルパス（デフォルト: edited_video.mp4） |
| `model` | string | No | モデル（デフォルト: grok-imagine-video） |

> **注意**: 編集後の動画は元動画と同じ長さになります。`duration` パラメータは編集時には指定できません。

## バッチ処理 CLI

### コマンド書式

```
grok-imagine-video-batch <config.json> [options]
```

または npx 経由：

```
npx grok-imagine-video-batch <config.json> [options]
```

### 基本的な使用例

```bash
# 設定ファイルでバッチ実行
npx grok-imagine-video-batch batch.json

# コスト見積もりのみ（実行しない）
npx grok-imagine-video-batch batch.json --estimate-only

# 出力先とフォーマットを指定
npx grok-imagine-video-batch batch.json --output-dir ./videos --format json

# ポーリング設定をカスタマイズ
npx grok-imagine-video-batch batch.json --poll-interval 10000 --max-poll-attempts 60

# 高並列実行（タイムアウト延長）
npx grok-imagine-video-batch batch.json --max-concurrent 5 --timeout 1800000

# ヘルプ表示
npx grok-imagine-video-batch --help

# バージョン表示
npx grok-imagine-video-batch --version
```

### CLI オプション一覧

| オプション | 短縮形 | 引数 | 説明 | デフォルト |
|-----------|--------|------|------|-----------|
| `--output-dir` | - | `<path>` | 出力ディレクトリを上書き | 設定ファイルから |
| `--format` | - | `text\|json` | 出力フォーマット | `text` |
| `--timeout` | - | `<ms>` | タイムアウト（ミリ秒、最小1000） | `600000` |
| `--max-concurrent` | - | `<n>` | 最大同時実行数（1-10） | `2` |
| `--poll-interval` | - | `<ms>` | ポーリング間隔（ミリ秒、最小1000） | `5000` |
| `--max-poll-attempts` | - | `<n>` | 最大ポーリング回数 | `120` |
| `--estimate-only` | - | - | コスト見積もりのみ（実行しない） | - |
| `--allow-any-path` | - | - | 任意の出力パスを許可（CI/CD用） | - |
| `--help` | `-h` | - | ヘルプメッセージ表示 | - |
| `--version` | `-v` | - | バージョン表示 | - |

### 終了コード

| コード | 意味 |
|--------|------|
| `0` | 成功（全ジョブ完了） |
| `1` | エラー（失敗またはキャンセルあり） |

### バッチ設定ファイル

```json
{
  "jobs": [
    {
      "prompt": "猫がボールで遊んでいる",
      "output_path": "cat_video.mp4",
      "duration": 5,
      "aspect_ratio": "16:9",
      "resolution": "720p"
    },
    {
      "prompt": "キャラクターが歩いているアニメーション",
      "image_url": "https://example.com/character.jpg",
      "output_path": "walking.mp4",
      "duration": 10
    },
    {
      "prompt": "ボールを大きくして",
      "video_url": "https://example.com/video.mp4",
      "output_path": "edited.mp4"
    }
  ],
  "output_dir": "./output",
  "max_concurrent": 2,
  "poll_interval": 5000,
  "max_poll_attempts": 120,
  "default_model": "grok-imagine-video",
  "default_duration": 5,
  "retry_policy": {
    "max_retries": 2,
    "retry_delay_ms": 1000
  }
}
```

### ジョブ定義スキーマ

各ジョブは3種類のうち1つを指定します：

#### 1. Text-to-Video（テキストから動画生成）

```json
{
  "prompt": "生成したい動画の説明",
  "output_path": "output.mp4",
  "duration": 5,
  "aspect_ratio": "16:9",
  "resolution": "720p",
  "model": "grok-imagine-video"
}
```

| フィールド | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `prompt` | string | Yes | 動画の説明テキスト |
| `output_path` | string | No | 出力ファイル名 |
| `duration` | number | No | 動画長（1-15秒） |
| `aspect_ratio` | string | No | アスペクト比 |
| `resolution` | string | No | 解像度（720p/480p） |
| `model` | string | No | モデル名 |

#### 2. Image-to-Video（画像から動画生成）

**URL指定の場合:**
```json
{
  "prompt": "画像をアニメーション化する説明",
  "image_url": "https://example.com/image.jpg",
  "output_path": "animated.mp4",
  "duration": 5
}
```

**ローカルファイルの場合（base64 data URL）:**
```json
{
  "prompt": "画像をアニメーション化する説明",
  "image_path": "./images/character.jpg",
  "output_path": "animated.mp4",
  "duration": 5
}
```

| フィールド | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `prompt` | string | Yes | アニメーションの説明 |
| `image_url` | string | No* | 入力画像のURL（公開アクセス可能） |
| `image_path` | string | No* | ローカル画像ファイルパス（base64 data URLとしてAPIに送信） |
| `output_path` | string | No | 出力ファイル名 |
| `duration` | number | No | 動画長（1-15秒） |

> *`image_url` または `image_path` のいずれかを指定（同時指定不可）

#### 3. Video Edit（動画編集）

```json
{
  "prompt": "編集内容の説明",
  "video_url": "https://example.com/video.mp4",
  "output_path": "edited.mp4"
}
```

| フィールド | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `prompt` | string | Yes | 編集内容の説明 |
| `video_url` | string | Yes | 編集する動画のURL（最大8.7秒） |
| `output_path` | string | No | 出力ファイル名 |

### グローバル設定

| フィールド | 型 | 説明 | デフォルト |
|-----------|-----|------|-----------|
| `output_dir` | string | 出力ディレクトリ | `./output` |
| `max_concurrent` | number | 最大同時実行数（1-10） | `2` |
| `poll_interval` | number | ポーリング間隔（ms） | `5000` |
| `max_poll_attempts` | number | 最大ポーリング回数 | `120` |
| `default_model` | string | デフォルトモデル | `grok-imagine-video` |
| `default_duration` | number | デフォルト動画長 | `5` |
| `default_aspect_ratio` | string | デフォルトアスペクト比 | `16:9` |
| `default_resolution` | string | デフォルト解像度 | `720p` |

### リトライポリシー

```json
{
  "retry_policy": {
    "max_retries": 2,
    "retry_delay_ms": 1000,
    "retry_on_errors": ["rate_limit", "429", "500", "502", "503"]
  }
}
```

| フィールド | 型 | 説明 | デフォルト |
|-----------|-----|------|-----------|
| `max_retries` | number | 最大リトライ回数 | `2` |
| `retry_delay_ms` | number | リトライ間隔（ms） | `1000` |
| `retry_on_errors` | string[] | リトライ対象エラー | 上記参照 |

設定例は `examples/` ディレクトリを参照してください：
- `batch-simple.json` - 基本的な動画生成
- `batch-image-to-video.json` - 画像からの動画生成（URL指定）
- `batch-local-images.json` - ローカル画像からの動画生成
- `batch-with-edits.json` - 動画編集チェーン
- `batch-social-media.json` - SNS向けフォーマット

## サポートされているアスペクト比

| アスペクト比 | 用途例 |
|-------------|--------|
| `16:9` | 横長ワイドスクリーン、YouTube（デフォルト） |
| `4:3` | 標準的な横長 |
| `1:1` | 正方形、Instagram |
| `9:16` | 縦長、TikTok、Reels、Stories |
| `3:4` | 縦長 |
| `3:2` / `2:3` | 写真比率 |

## サポートされている解像度

| 解像度 | 説明 |
|--------|------|
| `720p` | HD画質（デフォルト） |
| `480p` | 標準画質 |

## 動画長の制限

| 操作 | 最小 | 最大 | デフォルト |
|------|------|------|-----------|
| 生成（Text/Image-to-Video） | 1秒 | 15秒 | 5秒 |
| 編集 | - | 8.7秒 | 元動画と同じ |

## 非同期処理について

Video APIは非同期で動作します：

1. **リクエスト送信**: 動画生成/編集リクエストを送信
2. **request_id 取得**: APIから `request_id` が返される
3. **ポーリング**: 定期的に結果を確認（デフォルト: 5秒間隔）
4. **結果取得**: 完了後、動画URLを取得してダウンロード

```
POST /v1/videos/generations → { request_id: "abc123" }
                ↓
GET /v1/videos/abc123 → { status: "pending" } → 待機
                ↓
GET /v1/videos/abc123 → { status: "completed", url: "..." } → ダウンロード
```

## 使用例

```
# テキストから動画生成
「猫がボールで遊んでいる」の5秒動画を16:9で生成して

# 画像から動画生成
この画像のキャラクターを歩かせる動画を作って

# 動画編集
この動画の背景を夜に変更して
```

## API リファレンス

| 機能 | エンドポイント |
|------|---------------|
| 動画生成 | `POST https://api.x.ai/v1/videos/generations` |
| 動画編集 | `POST https://api.x.ai/v1/videos/edits` |
| 結果取得 | `GET https://api.x.ai/v1/videos/{request_id}` |

- **ドキュメント**: [docs.x.ai](https://docs.x.ai/)

## 開発

```bash
git clone https://github.com/ex-takashima/grok-imagine-video-mcp-server.git
cd grok-imagine-video-mcp-server
npm install
npm run build
npm start
```

### 開発用コマンド

```bash
# ビルド
npm run build

# ウォッチモード
npm run dev

# バッチCLI実行
npm run batch -- examples/batch-simple.json --estimate-only
```

## トラブルシューティング

### ポーリングがタイムアウトする

動画生成には時間がかかる場合があります。以下を試してください：

```bash
# ポーリング回数を増やす
npx grok-imagine-video-batch batch.json --max-poll-attempts 200

# タイムアウトを延長
npx grok-imagine-video-batch batch.json --timeout 1200000
```

### Rate Limit エラー

並列数を減らすか、リトライ設定を調整してください：

```json
{
  "max_concurrent": 1,
  "retry_policy": {
    "max_retries": 3,
    "retry_delay_ms": 5000,
    "retry_on_errors": ["rate_limit", "429"]
  }
}
```

## 関連プロジェクト

- [grok-imagine-image-mcp-server](https://github.com/ex-takashima/grok-imagine-image-mcp-server) - 画像生成用MCP Server

## ライセンス

MIT

## 作者

Junji Takashima <takajyun00@gmail.com>
