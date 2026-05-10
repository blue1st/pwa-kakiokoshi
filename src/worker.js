import { pipeline, env } from '@huggingface/transformers';

// Configure transformers.js to use remote Hugging Face models by default and enable persistent local caching
env.allowLocalModels = false;
env.useBrowserCache = true;
env.useWasmCache = true;

let transcriber = null;
let corrector = null;

let currentSttModel = '';
let currentLlmModel = '';

// Helper to check and report progress
function makeProgressCallback(modelType) {
  return (progress) => {
    if (progress.status === 'progress' || progress.status === 'downloading' || progress.status === 'done') {
      self.postMessage({
        type: 'progress',
        data: {
          model: modelType,
          status: progress.status,
          file: progress.file || '',
          progress: progress.progress || 0,
          loaded: progress.loaded || 0,
          total: progress.total || 0,
        }
      });
    }
  };
}

self.onmessage = async (e) => {
  const { type, data } = e.data;

  // 1. Load STT Model
  if (type === 'load_stt') {
    const { modelName } = data;
    if (transcriber && currentSttModel === modelName) {
      self.postMessage({ type: 'status', data: { status: 'ready', model: 'STT', cached: true } });
      return;
    }

    currentSttModel = modelName;
    try {
      self.postMessage({ type: 'status', data: { status: 'loading', model: 'STT', message: `Initializing Whisper (${modelName.split('/').pop()})...` } });
      
      // Try with WebGPU
      transcriber = await pipeline('automatic-speech-recognition', modelName, {
        device: 'webgpu',
        progress_callback: makeProgressCallback('STT'),
      });
      
      self.postMessage({ type: 'status', data: { status: 'ready', model: 'STT', device: 'webgpu' } });
    } catch (gpuError) {
      console.warn('WebGPU failed for Whisper, falling back to WASM:', gpuError);
      try {
        self.postMessage({ type: 'status', data: { status: 'loading', model: 'STT', message: 'WebGPU failed. Falling back to CPU (WASM)...' } });
        
        transcriber = await pipeline('automatic-speech-recognition', modelName, {
          device: 'wasm',
          progress_callback: makeProgressCallback('STT'),
        });
        
        self.postMessage({ type: 'status', data: { status: 'ready', model: 'STT', device: 'wasm' } });
      } catch (wasmError) {
        console.error('WASM fallback also failed for Whisper:', wasmError);
        self.postMessage({ type: 'error', data: { model: 'STT', message: wasmError.message } });
      }
    }
  }

  // 2. Load LLM Correction Model (Qwen/Gemma)
  else if (type === 'load_llm') {
    const { modelName } = data;
    if (corrector && currentLlmModel === modelName) {
      self.postMessage({ type: 'status', data: { status: 'ready', model: 'LLM', cached: true } });
      return;
    }

    currentLlmModel = modelName;
    const label = modelName.split('/').pop();
    try {
      self.postMessage({ type: 'status', data: { status: 'loading', model: 'LLM', message: `Initializing LLM Correction Model (${label})...` } });
      
      corrector = await pipeline('text-generation', modelName, {
        device: 'webgpu',
        dtype: 'q4', // Quantized 4-bit for speed and size
        progress_callback: makeProgressCallback('LLM'),
      });
      
      self.postMessage({ type: 'status', data: { status: 'ready', model: 'LLM', device: 'webgpu' } });
    } catch (gpuError) {
      console.warn('WebGPU failed for LLM, falling back to WASM:', gpuError);
      try {
        self.postMessage({ type: 'status', data: { status: 'loading', model: 'LLM', message: 'WebGPU failed. Falling back to CPU (WASM) (Warning: This will be very slow)...' } });
        
        corrector = await pipeline('text-generation', modelName, {
          device: 'wasm',
          dtype: 'q4',
          progress_callback: makeProgressCallback('LLM'),
        });
        
        self.postMessage({ type: 'status', data: { status: 'ready', model: 'LLM', device: 'wasm' } });
      } catch (wasmError) {
        console.error('WASM fallback also failed for LLM:', wasmError);
        self.postMessage({ type: 'error', data: { model: 'LLM', message: wasmError.message } });
      }
    }
  }

  // 3. Transcribe audio
  else if (type === 'transcribe') {
    const { audio, modelName, options } = data;
    try {
      if (!transcriber || currentSttModel !== modelName) {
        // Automatically load STT if not preloaded
        self.postMessage({ type: 'status', data: { status: 'loading', model: 'STT', message: `Dynamically loading STT model ${modelName}...` } });
        transcriber = await pipeline('automatic-speech-recognition', modelName, {
          device: 'webgpu',
          progress_callback: makeProgressCallback('STT'),
        }).catch(async () => {
          return await pipeline('automatic-speech-recognition', modelName, {
            device: 'wasm',
            progress_callback: makeProgressCallback('STT'),
          });
        });
        currentSttModel = modelName;
      }

      self.postMessage({ type: 'status', data: { status: 'processing', model: 'STT', message: '音声データを解析中 (Whisper STT)...' } });
      
      const startTime = performance.now();
      
      // Transcription options
      const sttOptions = {
        chunk_length_s: 30,
        stride_length_s: 5,
        language: options.language === 'auto' ? null : options.language,
        task: 'transcribe',
        return_timestamps: false,
      };

      const result = await transcriber(audio, sttOptions);
      const duration = (performance.now() - startTime) / 1000;
      
      self.postMessage({ type: 'result', data: { model: 'STT', result: result.text, duration } });
    } catch (err) {
      console.error('Transcription error:', err);
      self.postMessage({ type: 'error', data: { model: 'STT', message: err.message } });
    }
  }

  // 4. Grammar / Polish Correction with Qwen/Gemma
  else if (type === 'correct') {
    const { text, modelName } = data;
    try {
      if (!corrector || currentLlmModel !== modelName) {
        const label = modelName.split('/').pop();
        // Automatically load LLM if not preloaded
        self.postMessage({ type: 'status', data: { status: 'loading', model: 'LLM', message: `Dynamically loading ${label}...` } });
        corrector = await pipeline('text-generation', modelName, {
          device: 'webgpu',
          dtype: 'q4',
          progress_callback: makeProgressCallback('LLM'),
        }).catch(async () => {
          return await pipeline('text-generation', modelName, {
            device: 'wasm',
            dtype: 'q4',
            progress_callback: makeProgressCallback('LLM'),
          });
        });
        currentLlmModel = modelName;
      }

      const label = modelName.split('/').pop();
      self.postMessage({ type: 'status', data: { status: 'processing', model: 'LLM', message: `文章を校正中 (${label})...` } });
      
      const startTime = performance.now();
      
      // Use structured messages. Transformers.js automatically applies each specific model's template!
      const messages = [
        {
          role: 'system',
          content: 'あなたは日本語のプロフェッショナルな校正者です。与えられた音声書き起こしテキストを、意味を変えずに、自然で極めて読みやすい日本語の文章に修正・校正してください。'
        },
        {
          role: 'user',
          content: `以下の音声書き起こしテキストを校正・修正してください。
余計なあいづち（「あのー」「えっと」など）、言い淀み、重複表現を削除（ケバ取り）し、適切な句読点（、。）を追加してください。
書き間違いや明らかな音声誤認識は文脈から判断して補正してください。
元の内容を完全に維持し、要約や内容の追加・改変はしないでください。
出力は「修正後の日本語テキストのみ」にしてください。余計な説明や前置き、解説は絶対に含めないでください。

書き起こしテキスト:
"""
${text}
"""`
        }
      ];

      const output = await corrector(messages, {
        max_new_tokens: 1024,
        temperature: 0.1, // Set very low for precise correction without hallucination
        do_sample: false,
        return_full_text: false,
      });

      let correctedText = '';
      if (output && Array.isArray(output) && output.length > 0) {
        const genText = output[0].generated_text;
        if (Array.isArray(genText)) {
          // Standard v3 chat template output extraction
          correctedText = genText.at(-1).content;
        } else if (typeof genText === 'string') {
          correctedText = genText;
        }
        correctedText = correctedText.trim();
      } else {
        throw new Error('AIモデルが応答を生成できませんでした。');
      }

      const duration = (performance.now() - startTime) / 1000;
      self.postMessage({ type: 'result', data: { model: 'LLM', result: correctedText, duration } });
    } catch (err) {
      console.error('LLM correction error:', err);
      self.postMessage({ type: 'error', data: { model: 'LLM', message: err.message } });
    }
  }
};
