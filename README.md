# 書き起こし AI — Kakiokoshi AI 🚀

[![Vite](https://img.shields.io/badge/vite-%23646CFF.svg?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![JavaScript](https://img.shields.io/badge/javascript-%23F7DF1E.svg?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org/ja/docs/Web/JavaScript)
[![WebGPU](https://img.shields.io/badge/WebGPU-Enabled-success.svg?style=for-the-badge&logo=webgpu&logoColor=white)](#system-requirements)
[![PWA](https://img.shields.io/badge/PWA-Ready-ff69b4.svg?style=for-the-badge&logo=progressive-web-apps&logoColor=white)](https://web.dev/progressive-web-apps/)

**100%オンデバイス（ローカル）で動作する、プライバシー重視の超高速AI音声書き起こし＆文章校正Webアプリケーション（PWA）です。**  
音声データや書き起こしテキストは外部サーバーへ一切送信されず、すべてブラウザ内で安全に処理されます。

---

## ✨ 主な特徴

- 🔒 **100% 完全ローカル処理（プライバシー完全保護）**
  - 音声データのアップロード、外部APIキーの設定などは一切不要。通信傍受やデータ収集の心配なく、機密性の高いインタビューや会議の音声を処理できます。
- 🎙️ **高精度なオンデバイス音声認識 (STT)**
  - Hugging Face の `Transformers.js v3` を使用して、OpenAI の `Whisper` モデル（Tiny/Base）をブラウザ上で直接実行。
  - マイク録音のほか、主要な音声ファイル（MP3, WAV, M4A, FLACなど）のドラッグ＆ドロップによるインポートに対応。
- 🤖 **AI による自動文章校正**
  - Google の軽量・高性能LLM `Gemma-4-E2B` を WebGPU もしくは WASM で直接駆動。
  - 話し言葉特有の「ケバ（あのー、えっとなど）」の除去、誤字脱字の修正、および文法的に自然な文章への自動ブラッシュアップ。
- 📊 **文字単位のリアルタイム差分（Diff）表示**
  - `diff` ライブラリを統合。元の書き起こし（Whisper出力）と AI校正後の文章を比較し、追加箇所（緑）や削除箇所（赤）を直感的に色分け表示。
- 📈 **プレミアムな UI/UX & ビジュアライザ**
  - 近未来的なダークテーマ、ガラスモルフィズム、グラデーションエフェクト。
  - Web Audio API を活用した、マイク録音時の美しい3層リアルタイム波形アニメーション。
- 📶 **オフラインでも使える PWA 対応**
  - Service Worker とブラウザの Cache Storage API / IndexedDB により、一度サイトとモデルファイルをダウンロードすれば、**完全にインターネット接続のないオフライン環境でも動作します**。

---

## 🛠️ 技術スタック

| 技術要素 | 使用技術・ライブラリ | 用途 |
| :--- | :--- | :--- |
| **ビルド / 開発環境** | [Vite 8](https://vitejs.dev/) | 高速なモジュールバンドラ & HMR 開発環境 |
| **UI 構造 & ロジック** | HTML5 / Vanilla JavaScript (ESNext) | 軽量・高速・依存を最小限に抑えた設計 |
| **スタイリング** | Vanilla CSS (カスタムプロパティ、ダークテーマ) | 近未来的かつレスポンシブなプレミアムデザイン |
| **音声認識 / LLM 駆動**| [@huggingface/transformers (v3)](https://huggingface.co/docs/transformers.js/index) | ONNX Runtime Web を通じたオンデバイス AI の実行 |
| **高速化エンジン** | WebGPU / WebAssembly (WASM) Fallback | ブラウザ上でのハードウェアアクセラレーション推論 |
| **差分計算** | [diff](https://github.com/kpdecker/jsdiff) | Whisperテキストと校正後テキストの文字単位の比較 |
| **オフライン対応** | Service Worker / PWA Manifest | キャッシュ管理およびアプリのインストール対応 |

---

## 🚀 使い方

1. **AI モデルの選択・設定**
   - 必要に応じて、音声認識モデル（Whisper Tiny / Base）を選択します。
   - 「AI 文章校正を有効化」をオンにすると、書き起こし後に Gemma-4-E2B による校正が自動で実行されます。
2. **音声の取り込み**
   - **マイク録音**: 「マイク録音」タブで「録音開始」をクリックして録音を行い、終了したら「録音を停止・確定」を押します。
   - **ファイル追加**: 「ファイルを追加」タブに、お手持ちの音声ファイルをドラッグ＆ドロップ、またはファイル選択ダイアログからインポートします。
3. **書き起こし・校正の実行**
   - 「書き起こしを開始」ボタンをクリックします。
   - *※初回実行時のみ、AIモデルのダウンロード（数十MB〜1.5GB程度）が発生します。ダウンロード速度やお使いのPC性能により数分かかる場合がありますが、2回目以降はキャッシュから瞬時にロードされます。*
4. **結果の確認・出力**
   - 処理完了後、自動的に画面下部の結果パネルへスクロールします。
   - 「素の書き起こし (Whisper)」はテキストエリア内で直接手動修正できます。
   - 右側のパネルで「修正後テキスト」と、変更箇所を視覚化した「差分比較」を切り替えて確認できます。
   - クリップボードへのワンクリックコピーや、美しい Markdown 形式でのダウンロードが可能です。

---

## 💾 モデルのキャッシュについて

本アプリでダウンロードされるAIモデルファイル（WhisperおよびGemma）は、ブラウザ標準の **Cache Storage API** と **IndexedDB** に保存されます。

- **オフライン動作**: 2回目以降のアクセスではサーバーからのダウンロードは発生せず、瞬時にローカルキャッシュからロードされ、オフラインでも完全に機能します。
- **ディスク容量**: Gemma-4-E2B モデルは非常に高機能なため、ロード時に約1.5GBのローカルストレージ容量を必要とします。ブラウザのストレージ容量制限に空きがあることをご確認ください。

---

## 💻 システム要件

- **推奨ブラウザ**: 
  - **Google Chrome** (v113以降) / **Microsoft Edge** (WebGPU対応環境)
  - **Apple Safari** (iOS 18 / macOS Sequoia 以降のWebGPU開発者機能有効化環境、または WASM Fallback 動作)
- **ハードウェア推奨**:
  - **GPU**: Apple Silicon (M1/M2/M3/M4等) や NVIDIA GeForce 等のグラフィックボードを搭載した PC (WebGPUが有効になり、1.5GBのGemma LLMが数秒で超高速動作します)。
  - **メモリ (RAM)**: 8GB 以上 (16GB 以上を強く推奨)。WASM (CPU) で動作させる場合、メモリ不足（OOM）でタブがクラッシュするのを防ぐため、WebGPUでの動作を強く推奨します。

---

## 📦 開発と起動

### 必要な環境
- [Node.js](https://nodejs.org/) (v18 以上推奨)
- npm (Node.jsに同梱)

### セットアップ・起動手順

1. **リポジトリの複製**
   ```bash
   git clone <repository-url>
   cd kakiokoshi
   ```

2. **依存関係のインストール**
   ```bash
   npm install
   ```

3. **ローカル開発サーバーの起動**
   ```bash
   npm run dev
   ```
   ブラウザで `http://localhost:5173/` が開き、ローカルでの変更がリアルタイムに反映されます。

4. **本番用ビルド**
   ```bash
   npm run build
   ```
   `dist/` ディレクトリに、最適化およびハッシュ化された本番用スタティックファイルが出力されます。

5. **ビルド結果のプレビュー**
   ```bash
   npm run preview
   ```

---
## 🛡️ プライバシーステートメント

私たちはユーザーのプライバシーを最優先に考えています。
- **データ送信ゼロ**: 音声、テキスト、処理時間などのデータは、いかなるサーバーにも収集、分析、送信されません。
- **ソースのオープン性**: すべての挙動は完全に透過的であり、ブラウザの開発者ツール（Networkタブなど）から、外部への通信が一切発生していないことをユーザー自身でいつでも検証可能です。

---
© 2026 Kakiokoshi AI. WebGPU On-Device Computing.  
Developed with passion for privacy-first productivity.
