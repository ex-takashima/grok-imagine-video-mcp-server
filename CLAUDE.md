# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

xAI の Grok Imagine Video API（`grok-imagine-video` モデル）を利用する MCP サーバー。Text-to-Video / Image-to-Video の動画生成と既存動画の編集を提供する。同じコアロジックを 2 つのエントリポイントから利用できる：

- **MCP サーバー** (`src/index.ts`) — Claude Desktop 等の MCP クライアント向け（stdio トランスポート、ツール `generate_video` / `edit_video` / `extend_video`）
- **バッチ CLI** (`src/cli/batch.ts`) — JSON 設定ファイルから複数ジョブを並列処理（`grok-imagine-video-batch`）

## 開発コマンド

```bash
npm install
npm run build          # tsc で src/ → dist/ にコンパイル
npm run dev            # tsc --watch（インクリメンタルビルド）
npm start              # MCP サーバー起動（node dist/index.js）
npm run batch -- examples/batch-simple.json --estimate-only   # バッチCLI実行
```

- テストフレームワークは未導入（`npm test` は存在しない）。動作確認は実際の API 呼び出しか `--estimate-only` で行う。
- ビルド前に動かすには必ず `npm run build` が必要（`dist/` を実行するため）。`src/` を編集したら再ビルドすること。
- `XAI_API_KEY` が未設定だと MCP サーバー／CLI とも起動時に終了する。`.env` から読み込まれる（`dotenv`）。

## アーキテクチャ

### コアの非同期フロー

xAI Video API は**非同期**。全ての生成・編集はこの流れに従う（`src/utils/video.ts`）：

1. `POST /v1/videos/{generations,edits}` → `request_id` を取得
2. `GET /v1/videos/{request_id}` をポーリング（デフォルト 5 秒間隔、最大 120 回）
3. レスポンスに `video.url` が現れたら完了。`status: 'failed'` でエラー。5xx は一時エラーとしてリトライ継続
4. `video.url` から MP4 をダウンロードしてローカル保存

`generateVideo` / `editVideo` はこのフロー全体（API 呼び出し→ポーリング→ダウンロード）を内包する。`pollInterval` と `maxPollAttempts` は引数で受け取り、MCP・CLI 双方から制御される。

### 共有コアと 2 つのエントリポイント

- `src/tools/generate.ts` (`generateVideo`)、`src/tools/edit.ts` (`editVideo`)、`src/tools/extend.ts` (`extendVideo`) が**唯一の実行ロジック**。MCP ハンドラ（`src/index.ts`）もバッチマネージャ（`src/utils/batch-manager.ts`）も、最終的にこの 3 関数を呼ぶ。新しい生成オプションを足すときは、この関数群 → 型定義 → 両エントリポイントの順で反映する。
- `src/index.ts` の `TOOLS` 配列が MCP のツールスキーマ（JSON Schema）。`src/tools/*.ts` 内のバリデーション・デフォルト値、および `src/utils/batch-config.ts` のバッチ検証と**三重管理**になっている点に注意（enum 値・範囲を変えたら全て更新）。
- ポーリング結果のパースは `src/utils/video.ts` の `pollVideoResult` に集約。1.5 では `status: "done"`、構造化エラー `{code, message}`（`extractVideoErrorMessage` で文字列化）、`progress`、`usage.cost_in_usd_ticks` を扱う。`respect_moderation === false`（モデレーションでブロックされ URL 空）も検出してエラーにする。

### バッチ処理 (`src/utils/batch-manager.ts`)

- `BatchManager` が `Semaphore`（自前実装、permit + 待ち行列）で `max_concurrent` を制御。
- ジョブ種別は `getJobOperation` + `isImageToVideo` / `isReferenceToVideo`（`src/utils/batch-config.ts`）で判定：`operation` 明示が最優先、なければ `video_url` あり → edit、それ以外は generate。generate 内で `reference_images` → R2V、`image_*` → I2V。延長は `"operation": "extend"` を明示（`video_url` だけだと edit 扱い）。
- ジョブ単位のリトライ（`retry_policy`）。エラーメッセージに `retry_on_errors` のパターン（`rate_limit`, `429` 等）が部分一致したときのみリトライ。
- 全体タイムアウトは `Promise.race` で実装。タイムアウト時、未完了ジョブは `cancelled` 扱いになる。
- `estimateBatchCost` のコスト単価（`VIDEO_COSTS`）は**プレースホルダの推定値**で、実際の xAI 料金ではない。
- バッチ設定の読み込み・検証・マージは `src/utils/batch-config.ts`（`loadBatchConfig` / `validateBatchConfig` / `mergeBatchConfig`、CLI フラグが設定ファイルより優先）。

### ローカル画像の base64 変換

`image_path` や `reference_images[].path` を指定するとローカルファイルを読み込んで **base64 data URL** に変換し API へ送る（`src/tools/generate.ts` の `imagePathToDataUrl` ヘルパに集約）。以前は Cloudflare R2 アップロードだったが廃止済み。`image_url`/`image_path` は排他、画像（I2V）と `reference_images`（R2V）も排他。`prompt` は T2V/R2V では必須だが I2V（画像指定時）では省略可。

### パス処理 (`src/utils/path.ts`)

- 相対パスは `OUTPUT_DIR` 環境変数（なければ `process.cwd()`）を基準に解決し、出力ディレクトリを自動作成。
- `generateUniqueFilePath` で既存ファイルとの衝突を回避（`name_1.mp4` のように連番付与）。上書きしない設計。
- CLI の `--allow-any-path` はこのパス制限を緩める（CI/CD 用）。

### 型定義の置き場

- `src/types/tools.ts` — モデル・アスペクト比・解像度・デフォルト値などの**定数（const アサーション）**とパラメータ型。バリデーションはこの定数配列を参照する。
- `src/types/batch.ts` — バッチ設定・結果・コスト見積もりの型。

## プラグイン

`plugins/grokvideo-generator/` は Claude Code 用プラグイン（`.claude-plugin/marketplace.json` で公開）。バッチ CLI をラップしたスキルを提供する。コアの動画ロジックには関与しない。

## 環境変数

`XAI_API_KEY`（必須）, `DEBUG`（`true` でデバッグログ）, `OUTPUT_DIR`, `VIDEO_POLL_INTERVAL`, `VIDEO_MAX_POLL_ATTEMPTS`。

## 制約値（変更時は型定義・MCPスキーマ・batch-config の3箇所を更新）

- 生成 duration: 1〜15 秒（デフォルト 8）／ 編集後の長さは元動画依存で `duration` 指定不可、編集元は最大 8.7 秒／ 延長 duration: 1〜10 秒（デフォルト 6）
- アスペクト比: `16:9`, `4:3`, `1:1`, `9:16`, `3:4`, `3:2`, `2:3`（デフォルト `16:9`）
- 解像度: `480p`, `720p`, `1080p`（デフォルト `720p`）
- `max_concurrent`: 1〜10（デフォルト 2）
- 定数の真実の源は `src/types/tools.ts`（`RESOLUTIONS`, `MIN/MAX_DURATION`, `MIN/MAX_EXTENSION_DURATION`, `DEFAULT_*` など）。

## モデルと機能の対応（実機検証済み・重要）

- **T2V / I2V / R2V / 編集 / 延長はすべて基本モデル `grok-imagine-video` で動作する**（公式ドキュメントの例も全て同モデル）。これがデフォルトかつ推奨。
- `/v1/models` には `grok-imagine-video-1.5` も存在するが、**T2V / R2V / 延長を「not supported for this model」で拒否**する pinned 版（I2V 中心の別系統）。1.5 の新機能を使うために 1.5 モデルを指定する必要はない。
- `1080p` は API 仕様上は有効だが、検証アカウントでは**どのモデルでも未開放**で `1080p video resolution is not available for this model.` が返った。コードは正しく、サーバー/アカウント側の制約。エラー本文は `extractApiErrorMessage`（`src/utils/video.ts`）で文字列/オブジェクト両形式から抽出して表示する。
- ポーリング失敗は 5xx と 429 のみリトライ（`pollVideoResult`）。それ以外の非OKはレスポンス本文を添えて即時エラー。
