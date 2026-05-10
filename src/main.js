import { diffChars } from 'diff';

// Global variables
let worker = null;
let audioBufferToTranscribe = null;
let mediaRecorder = null;
let audioStream = null;
let recordInterval = null;
let recordDurationSec = 0;
let isRecording = false;

// Audio Visualization variables
let audioContext = null;
let analyserNode = null;
let animationFrameId = null;
let activeTab = 'record-tab';
let currentActiveProgressFiles = new Map(); // Keep track of shard files

// DOM Elements
const webGpuStatusEl = document.getElementById('webgpu-status');
const whisperModelSelect = document.getElementById('whisper-model-select');
const llmEnableToggle = document.getElementById('llm-enable-toggle');
const llmModelSelectorGroup = document.getElementById('llm-model-selector-group');
const GEMMA_MODEL_ID = 'onnx-community/gemma-4-E2B-it-ONNX';
const llmInfoPanel = document.getElementById('llm-info-panel');
const llmInfoText = document.getElementById('llm-info-text');
const aiBadgeLabel = document.getElementById('ai-badge-label');
const languageSelect = document.getElementById('language-select');

// Helper to update the output panel's tab label dynamically based on selected LLM
function updateLlmBadgeLabel(modelId) {
  aiBadgeLabel.textContent = 'Gemma-4-E2B';
}

const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

const recordBtn = document.getElementById('record-btn');
const stopRecordBtn = document.getElementById('stop-record-btn');
const recordTimerEl = document.getElementById('record-timer');
const waveCanvas = document.getElementById('wave-canvas');
const audioPreviewContainer = document.getElementById('audio-preview-container');
const recordedAudioEl = document.getElementById('recorded-audio');

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const filePreviewContainer = document.getElementById('file-preview-container');
const uploadedAudioEl = document.getElementById('uploaded-audio');
const removeFileBtn = document.getElementById('remove-file-btn');

const runTranscribeBtn = document.getElementById('run-transcribe-btn');

const progressCard = document.getElementById('progress-card');
const progressTitle = document.getElementById('progress-title');
const currentStatusMsg = document.getElementById('current-status-msg');
const progressSpeed = document.getElementById('progress-speed');
const downloadProgressContainer = document.getElementById('download-progress-container');

const resultsSection = document.getElementById('results-section');
const sttTimeBadge = document.getElementById('stt-time-badge');
const llmTimeBadge = document.getElementById('llm-time-badge');
const rawTextOutput = document.getElementById('raw-text-output');
const runCorrectManuallyBtn = document.getElementById('run-correct-manually-btn');

const paneTabs = document.querySelectorAll('.pane-tab');
const outputTabContents = document.querySelectorAll('.output-tab-content');
const correctedTextOutput = document.getElementById('corrected-text-output');
const diffTextOutput = document.getElementById('diff-text-output');

const copyRawBtn = document.getElementById('copy-raw-btn');
const copyCorrectedBtn = document.getElementById('copy-corrected-btn');
const downloadMarkdownBtn = document.getElementById('download-markdown-btn');

// --- 1. Initialization and WebGPU Checking ---
window.addEventListener('DOMContentLoaded', async () => {
  // Check PWA Support and Register SW
  initPwa();

  // Check WebGPU compatibility
  const webgpuStatus = await checkWebGpuSupport();
  updateWebGpuUI(webgpuStatus);

  // Setup Web Worker
  initWorker();

  // Draw beautiful initial background wave in Canvas
  initCanvasWave();

  // UI Setup & Bindings
  setupEventBindings();
});

// PWA Service Worker Registration
function initPwa() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      const baseUrl = import.meta.env.BASE_URL || '/';
      navigator.serviceWorker.register(`${baseUrl}sw.js`)
        .then((reg) => {
          console.log('PWA Service Worker registered successfully:', reg.scope);
          const pwaBadge = document.getElementById('pwa-status');
          pwaBadge.className = 'badge status-webgpu'; // Turn green
        })
        .catch((err) => {
          console.error('Service Worker registration failed:', err);
        });
    });
  }
}

// Check if WebGPU is available and get device name
async function checkWebGpuSupport() {
  if (!navigator.gpu) {
    return { supported: false, deviceName: null };
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (adapter) {
      return { supported: true, deviceName: adapter.name || 'WebGPU Device' };
    }
    return { supported: false, deviceName: null };
  } catch (err) {
    console.error('Error querying WebGPU adapter:', err);
    return { supported: false, deviceName: null };
  }
}

// Update WebGPU Status UI
function updateWebGpuUI(status) {
  if (status.supported) {
    webGpuStatusEl.className = 'badge status-webgpu';
    webGpuStatusEl.querySelector('.badge-text').textContent = `WebGPU: ${status.deviceName}`;
  } else {
    webGpuStatusEl.className = 'badge status-wasm';
    webGpuStatusEl.querySelector('.badge-text').textContent = 'CPU (WASM Fallback)';
    webGpuStatusEl.setAttribute('title', '高速な処理を行うには、WebGPU対応ブラウザ（ChromeやM2+ Mac等）を使用してください。');
  }
}

// --- 2. Web Worker Setup & Message Processing ---
function initWorker() {
  // Create modular Vite-compatible worker
  worker = new Worker(
    new URL('./worker.js', import.meta.url),
    { type: 'module' }
  );

  worker.onmessage = (e) => {
    const { type, data } = e.data;

    if (type === 'status') {
      handleWorkerStatusUpdate(data);
    } 
    else if (type === 'progress') {
      handleWorkerDownloadProgress(data);
    } 
    else if (type === 'result') {
      handleWorkerResult(data);
    } 
    else if (type === 'error') {
      handleWorkerError(data);
    }
  };
}

// Handle overall process step status messages from worker
function handleWorkerStatusUpdate(statusData) {
  const { status, model, message, device } = statusData;
  progressCard.classList.remove('hidden');

  if (status === 'loading') {
    progressTitle.innerHTML = `🔄 ${model === 'STT' ? '音声認識モデル' : '校正モデル'}を読み込み中...`;
    currentStatusMsg.textContent = message || 'モデルファイルをダウンロード中、および初期化を行っています。初回のみ数分かかる場合があります。';
  } 
  else if (status === 'processing') {
    progressTitle.innerHTML = `⚡ On-Device AI 処理中...`;
    currentStatusMsg.textContent = message || '推論を実行しています。ブラウザのタブを閉じないでください。';
    progressSpeed.textContent = '';
  } 
  else if (status === 'ready') {
    // Model is loaded and ready
    if (model === 'STT') {
      console.log('STT Model ready. Running transcription...');
      // Start the actual transcription after model is ready
      triggerTranscription();
    } else if (model === 'LLM') {
      console.log('LLM Model ready. Running correction...');
      triggerCorrection();
    }
  }
}

// Track file-by-file progress
function handleWorkerDownloadProgress(progressData) {
  const { model, file, progress, loaded, total } = progressData;
  if (!file) return;

  // Make a clean ID for the shard
  const fileId = file.replace(/[^a-zA-Z0-9]/g, '_');

  // Format size text
  const loadedMB = (loaded / (1024 * 1024)).toFixed(1);
  const totalMB = (total / (1024 * 1024)).toFixed(1);
  const progressPercent = progress.toFixed(1);

  // Get or Create shard progress element
  let shardItem = currentActiveProgressFiles.get(fileId);
  if (!shardItem) {
    shardItem = document.createElement('div');
    shardItem.className = 'shard-progress-item';
    shardItem.id = `shard-${fileId}`;
    shardItem.innerHTML = `
      <div class="shard-info">
        <span class="shard-name">${file.split('/').pop()} (${model})</span>
        <span class="shard-percent">0.0% (0.0 / 0.0 MB)</span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill"></div>
      </div>
    `;
    downloadProgressContainer.appendChild(shardItem);
    currentActiveProgressFiles.set(fileId, shardItem);
  }

  // Update shard UI values
  const percentEl = shardItem.querySelector('.shard-percent');
  const fillEl = shardItem.querySelector('.progress-bar-fill');
  
  percentEl.textContent = `${progressPercent}% (${loadedMB} / ${totalMB} MB)`;
  fillEl.style.width = `${progressPercent}%`;

  // Calculate global summary download status
  let totalFiles = currentActiveProgressFiles.size;
  progressSpeed.textContent = `Active Downloads: ${totalFiles} files`;
}

// Handle final text output from AI models
function handleWorkerResult(resultData) {
  const { model, result, duration } = resultData;

  if (model === 'STT') {
    console.log('Transcription success!', result);
    sttTimeBadge.textContent = `STT: ${duration.toFixed(1)}s`;
    sttTimeBadge.classList.remove('hidden');

    rawTextOutput.value = result;
    runCorrectManuallyBtn.disabled = false;
    
    // Auto-scroll to results
    resultsSection.classList.remove('hidden');
    resultsSection.scrollIntoView({ behavior: 'smooth' });

    // Check if AI Correction is enabled
    if (llmEnableToggle.checked) {
      currentActiveProgressFiles.clear();
      downloadProgressContainer.innerHTML = '';
      const selectedLlmModel = GEMMA_MODEL_ID;
      updateLlmBadgeLabel(selectedLlmModel);
      worker.postMessage({
        type: 'load_llm',
        data: { modelName: selectedLlmModel }
      });
    } else {
      // Done. Hide progress card
      progressCard.classList.add('hidden');
    }
  } 
  else if (model === 'LLM') {
    console.log('Correction success!', result);
    llmTimeBadge.textContent = `AI校正: ${duration.toFixed(1)}s`;
    llmTimeBadge.classList.remove('hidden');

    // Display corrected text
    correctedTextOutput.textContent = result;
    correctedTextOutput.classList.remove('placeholder-text');

    // Calculate Diff!
    const rawText = rawTextOutput.value;
    renderDiffView(rawText, result);

    // Enable download
    downloadMarkdownBtn.disabled = false;

    // Hide progress card
    progressCard.classList.add('hidden');
  }
}

// Handle Worker Errors
function handleWorkerError(errorData) {
  const { model, message } = errorData;
  progressCard.classList.remove('hidden');
  progressTitle.innerHTML = `⚠️ エラーが発生しました`;
  currentStatusMsg.innerHTML = `<span style="color:var(--danger)">[${model}] エラー: ${message}</span><br>メモリ不足、またはデバイスがモデル要件を満たしていない可能性があります。WebGPUを有効化するか、モデルサイズを下げてお試しください。`;
  runTranscribeBtn.disabled = false;
}

// --- 3. Speech-to-Text & AI Correction execution triggers ---
function startProcessPipeline() {
  if (!audioBufferToTranscribe) return;

  // UI state
  runTranscribeBtn.disabled = true;
  resultsSection.classList.add('hidden');
  sttTimeBadge.classList.add('hidden');
  llmTimeBadge.classList.add('hidden');
  rawTextOutput.value = '';
  correctedTextOutput.textContent = 'AI校正を実行すると、ここに修正後のテキストが表示されます。';
  correctedTextOutput.classList.add('placeholder-text');
  diffTextOutput.textContent = 'AI校正を実行すると、ここに変更箇所の差分が表示されます。';
  diffTextOutput.classList.add('placeholder-text');
  
  // Clear file progress
  currentActiveProgressFiles.clear();
  downloadProgressContainer.innerHTML = '';

  const modelName = whisperModelSelect.value;
  console.log(`Requesting STT Model Load: ${modelName}`);

  // 1st step: Tell worker to load Whisper model
  worker.postMessage({
    type: 'load_stt',
    data: { modelName }
  });
}

function triggerTranscription() {
  const modelName = whisperModelSelect.value;
  const language = languageSelect.value;

  console.log('Triggering Whisper STT transcription...');
  worker.postMessage({
    type: 'transcribe',
    data: {
      audio: audioBufferToTranscribe,
      modelName,
      options: { language }
    }
  });
}

function triggerCorrection() {
  const rawText = rawTextOutput.value.trim();
  if (!rawText) {
    alert('校正するテキストがありません。');
    progressCard.classList.add('hidden');
    return;
  }

  const selectedLlmModel = GEMMA_MODEL_ID;
  console.log(`Triggering LLM Correction using model: ${selectedLlmModel}`);
  updateLlmBadgeLabel(selectedLlmModel);

  worker.postMessage({
    type: 'correct',
    data: {
      text: rawText,
      modelName: selectedLlmModel
    }
  });
}

// --- 4. Beautiful Visualizing Canvas Wave (Resting & Active) ---
function initCanvasWave() {
  const ctx = waveCanvas.getContext('2d');
  
  // High DPI canvas support
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    waveCanvas.width = waveCanvas.offsetWidth * dpr;
    waveCanvas.height = waveCanvas.offsetHeight * dpr;
    ctx.scale(dpr, dpr);
  }
  
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  let phase = 0;

  function draw() {
    animationFrameId = requestAnimationFrame(draw);
    
    const width = waveCanvas.offsetWidth;
    const height = waveCanvas.offsetHeight;
    ctx.clearRect(0, 0, width, height);

    // Get live data if recording
    let volume = 0.15; // default resting amplitude
    if (isRecording && analyserNode) {
      const dataArray = new Uint8Array(analyserNode.frequencyBinCount);
      analyserNode.getByteFrequencyData(dataArray);
      
      // Calculate overall volume factor
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      volume = Math.max(0.08, (sum / dataArray.length) / 128); // Dynamic scale
    }

    // Draw background grid lines for aesthetic premium look
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
    ctx.lineWidth = 1;
    for (let i = 0; i < width; i += 40) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, height);
      ctx.stroke();
    }

    // Draw 3 layers of beautiful overlapping sine waves
    const waves = [
      { amplitude: 35 * volume, speed: 0.05, color: 'rgba(139, 92, 246, 0.45)', frequency: 0.015 }, // Violet
      { amplitude: 22 * volume, speed: -0.07, color: 'rgba(59, 130, 246, 0.35)', frequency: 0.022 }, // Blue
      { amplitude: 10 * volume, speed: 0.03, color: 'rgba(168, 85, 247, 0.2)', frequency: 0.03 }   // Pink/Light purple
    ];

    phase += 0.05;

    waves.forEach((wave) => {
      ctx.beginPath();
      ctx.strokeStyle = wave.color;
      ctx.lineWidth = 2.5;
      
      // Add glowing shadow to lines
      ctx.shadowColor = wave.color;
      ctx.shadowBlur = 10;

      for (let x = 0; x < width; x++) {
        const y = height / 2 + Math.sin(x * wave.frequency + phase * wave.speed) * wave.amplitude;
        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.shadowBlur = 0; // reset
    });
  }

  draw();
}

// --- 5. Audio Preprocessing (Decode & Resample to 16kHz Mono) ---
async function preprocessAudio(audioBlob) {
  const arrayBuffer = await audioBlob.arrayBuffer();
  
  // Use compatible AudioContext creation
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  
  // 1. Decode compressed audio into PCM AudioBuffer
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  
  // 2. Offline audio processing to resample down to 16,000Hz mono
  const TARGET_SAMPLE_RATE = 16000;
  const offlineCtx = new OfflineAudioContext(
    1, // 1 Channel (Mono)
    Math.round(audioBuffer.duration * TARGET_SAMPLE_RATE),
    TARGET_SAMPLE_RATE
  );
  
  // Create buffer source
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);
  
  // Run resampling rendering
  const resampledBuffer = await offlineCtx.startRendering();
  
  // Extract Float32 samples
  return resampledBuffer.getChannelData(0);
}

// --- 6. Microphone Recording Operations ---
async function startRecording() {
  if (isRecording) return;
  
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // Set up Web Audio API nodes for visualizer
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const sourceNode = audioContext.createMediaStreamSource(audioStream);
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 256;
    sourceNode.connect(analyserNode);

    // Initialize MediaRecorder
    // Chrome support webm natively, safari support mp4, etc. 
    // Since we decode via Web Audio API anyway, standard format is fine.
    let options = {};
    if (MediaRecorder.isTypeSupported('audio/webm')) {
      options = { mimeType: 'audio/webm' };
    }
    
    mediaRecorder = new MediaRecorder(audioStream, options);
    let chunks = [];
    
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(chunks, { type: mediaRecorder.mimeType });
      const audioURL = URL.createObjectURL(audioBlob);
      recordedAudioEl.src = audioURL;
      audioPreviewContainer.classList.remove('hidden');

      // Heavy processing: downsample to 16kHz
      progressTitle.innerHTML = `⏳ 音声を処理中...`;
      currentStatusMsg.textContent = '音声データを16,000Hzモノラル形式に変換・デコードしています。';
      progressCard.classList.remove('hidden');
      
      try {
        audioBufferToTranscribe = await preprocessAudio(audioBlob);
        runTranscribeBtn.disabled = false;
        progressCard.classList.add('hidden');
      } catch (err) {
        console.error('PCM Resampling failed:', err);
        currentStatusMsg.innerHTML = `<span style="color:var(--danger)">オーディオデコードエラー: ${err.message}</span>`;
      }
    };

    // Start Recording
    mediaRecorder.start();
    isRecording = true;
    recordBtn.classList.add('recording');
    recordBtn.querySelector('.btn-label').textContent = '録音中...';
    stopRecordBtn.disabled = false;
    
    // Preview Hidden until stopped
    audioPreviewContainer.classList.add('hidden');

    // Timer Interval
    recordDurationSec = 0;
    recordTimerEl.textContent = '00:00';
    recordInterval = setInterval(() => {
      recordDurationSec++;
      const mins = Math.floor(recordDurationSec / 60).toString().padStart(2, '0');
      const secs = (recordDurationSec % 60).toString().padStart(2, '0');
      recordTimerEl.textContent = `${mins}:${secs}`;
    }, 1000);

  } catch (err) {
    console.error('Mic access denied or error:', err);
    alert('マイクへのアクセスを許可してください: ' + err.message);
  }
}

function stopRecording() {
  if (!isRecording) return;

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }

  if (audioStream) {
    audioStream.getTracks().forEach((track) => track.stop());
  }

  if (audioContext) {
    audioContext.close();
  }

  clearInterval(recordInterval);
  isRecording = false;
  recordBtn.classList.remove('recording');
  recordBtn.querySelector('.btn-label').textContent = '録音開始';
  stopRecordBtn.disabled = true;
}

// --- 7. Difference Renderer Logic (Char-by-Char) ---
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderDiffView(original, corrected) {
  // Use character diff for optimal Japanese support
  const diffs = diffChars(original, corrected);
  let htmlResult = '';

  diffs.forEach((part) => {
    const escapedVal = escapeHtml(part.value);
    if (part.added) {
      htmlResult += `<ins>${escapedVal}</ins>`;
    } else if (part.removed) {
      htmlResult += `<del>${escapedVal}</del>`;
    } else {
      htmlResult += `<span>${escapedVal}</span>`;
    }
  });

  diffTextOutput.innerHTML = htmlResult;
  diffTextOutput.classList.remove('placeholder-text');
}

// --- 8. Event Bindings and UI Listeners ---
function setupEventBindings() {
  // Sidebar toggling and message updating for dynamic model loading
  llmEnableToggle.addEventListener('change', () => {
    if (llmEnableToggle.checked) {
      llmModelSelectorGroup.classList.remove('hidden');
    } else {
      llmModelSelectorGroup.classList.add('hidden');
    }
  });


  // Tab switcher (Record vs Upload)
  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabBtns.forEach((b) => b.classList.remove('active'));
      tabContents.forEach((c) => c.classList.remove('active'));

      btn.classList.add('active');
      const tabId = btn.getAttribute('data-tab');
      document.getElementById(tabId).classList.add('active');
      activeTab = tabId;
      
      // Stop active recording if switching tabs
      if (isRecording) {
        stopRecording();
      }
    });
  });

  // Record Button bindings
  recordBtn.addEventListener('click', () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  });

  stopRecordBtn.addEventListener('click', () => {
    stopRecording();
  });

  // File Upload drag and drop bindings
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handlePickedFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) {
      handlePickedFile(fileInput.files[0]);
    }
  });

  // Remove file action
  removeFileBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // prevent file input click
    fileInput.value = '';
    audioBufferToTranscribe = null;
    filePreviewContainer.classList.add('hidden');
    runTranscribeBtn.disabled = true;
    uploadedAudioEl.src = '';
  });

  // Process triggers
  runTranscribeBtn.addEventListener('click', () => {
    startProcessPipeline();
  });

  // Manual Correction run button
  runCorrectManuallyBtn.addEventListener('click', () => {
    currentActiveProgressFiles.clear();
    downloadProgressContainer.innerHTML = '';
    
    const selectedLlmModel = GEMMA_MODEL_ID;
    updateLlmBadgeLabel(selectedLlmModel);

    const modelLabel = selectedLlmModel.split('/').pop();
    progressCard.classList.remove('hidden');
    progressTitle.innerHTML = `🔄 AI校正モデルを準備中...`;
    currentStatusMsg.textContent = `${modelLabel} のファイルをロードしています。しばらくお待ちください...`;
    
    worker.postMessage({
      type: 'load_llm',
      data: { modelName: selectedLlmModel }
    });
  });

  // Copy Buttons
  copyRawBtn.addEventListener('click', () => {
    const text = rawTextOutput.value;
    navigator.clipboard.writeText(text)
      .then(() => alert('素の書き起こしをコピーしました。'))
      .catch((err) => console.error(err));
  });

  copyCorrectedBtn.addEventListener('click', () => {
    const text = correctedTextOutput.textContent;
    navigator.clipboard.writeText(text)
      .then(() => alert('校正後のテキストをコピーしました。'))
      .catch((err) => console.error(err));
  });

  // Download Markdown
  downloadMarkdownBtn.addEventListener('click', () => {
    const rawText = rawTextOutput.value;
    const correctedText = correctedTextOutput.textContent;
    
    // Produce beautiful markdown diff summary
    const mdContent = `# Kakiokoshi AI 校正レポート

## 1. 修正後の文章 (校正済)
${correctedText}

---

## 2. 元の書き起こし (素)
${rawText}

---
*Created on-device with Kakiokoshi AI*
`;
    const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `kakiokoshi-report-${Date.now()}.md`;
    link.click();
    URL.revokeObjectURL(url);
  });

  // Tab buttons inside Output Pane
  paneTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      paneTabs.forEach((t) => t.classList.remove('active'));
      outputTabContents.forEach((c) => c.classList.remove('active'));

      tab.classList.add('active');
      const outputTabId = tab.getAttribute('data-output-tab');
      document.getElementById(outputTabId).classList.add('active');
    });
  });
}

// Handler for selected audio file
async function handlePickedFile(file) {
  if (!file.type.startsWith('audio/')) {
    alert('オーディオファイルのみ追加可能です。');
    return;
  }

  // Display file info
  const fileNameEl = filePreviewContainer.querySelector('.file-name');
  fileNameEl.textContent = `${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB)`;
  filePreviewContainer.classList.remove('hidden');

  const audioURL = URL.createObjectURL(file);
  uploadedAudioEl.src = audioURL;

  // Resample
  progressTitle.innerHTML = `⏳ ファイルをロード中...`;
  currentStatusMsg.textContent = '音声ファイルを解析し、16,000HzモノラルFloat32形式に変換しています。';
  progressCard.classList.remove('hidden');

  try {
    audioBufferToTranscribe = await preprocessAudio(file);
    runTranscribeBtn.disabled = false;
    progressCard.classList.add('hidden');
  } catch (err) {
    console.error('File resampling error:', err);
    currentStatusMsg.innerHTML = `<span style="color:var(--danger)">ファイルのデコードに失敗しました: ${err.message}</span><br>ブラウザがサポートしている音声形式であることをご確認ください。`;
  }
}
