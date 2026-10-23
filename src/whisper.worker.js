import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;
let transcriber = null;
let activeModel = '';

function progress(payload) {
  self.postMessage({ type: 'model-progress', payload });
}
async function loadModel(model) {
  if (transcriber && activeModel === model) return;
  transcriber = null;
  const useGpu = typeof navigator !== 'undefined' && !!navigator.gpu;
  try {
    self.postMessage({ type: 'status', message: useGpu ? 'Whisper GPU üzerinde hazırlanıyor…' : 'Whisper CPU üzerinde hazırlanıyor…' });
    transcriber = await pipeline('automatic-speech-recognition', model, {
      device: useGpu ? 'webgpu' : 'wasm', progress_callback: progress
    });
  } catch (error) {
    if (!useGpu) throw error;
    self.postMessage({ type: 'status', message: 'GPU kullanılamadı, CPU ile yeniden deneniyor…' });
    transcriber = await pipeline('automatic-speech-recognition', model, {
      device: 'wasm', progress_callback: progress
    });
  }
  activeModel = model;
}
const SAMPLERATE = 16000;
const WINDOW = 28 * SAMPLERATE;
const OVERLAP = Math.floor(1.5 * SAMPLERATE);

self.onmessage = async event => {
  const { type, audio, model } = event.data || {};
  if (type !== 'transcribe') return;
  try {
    if (!(audio instanceof Float32Array) || !audio.length) throw new Error('Çözümlenmiş ses bulunamadı.');
    await loadModel(model || 'onnx-community/whisper-base');
    const parts = [];
    let index = 0;
    const total = Math.ceil(audio.length / (WINDOW - OVERLAP));
    for (let start = 0; start < audio.length; start += WINDOW - OVERLAP) {
      index++;
      const end = Math.min(audio.length, start + WINDOW);
      const segment = audio.slice(start, end);
      self.postMessage({ type: 'chunk-progress', current: index, total,
        at: start / SAMPLERATE, duration: audio.length / SAMPLERATE });
      let result;
      try {
        result = await transcriber(segment, { language: 'turkish', task: 'transcribe', return_timestamps: 'word' });
      } catch (err) {
        self.postMessage({ type: 'status', message: 'Kelime zamanları alınamadı; düz transkripsiyon deneniyor…' });
        result = await transcriber(segment, { language: 'turkish', task: 'transcribe' });
      }
      parts.push({
        start: start / SAMPLERATE, end: end / SAMPLERATE, text: result.text || '',
        words: (result.chunks || []).map(w => ({
          text: w.text || '', at: (w.timestamp?.[0] ?? 0) + start / SAMPLERATE,
          end: (w.timestamp?.[1] ?? 0) + start / SAMPLERATE
        }))
      });
      self.postMessage({ type: 'partial', text: result.text || '', current: index, total });
    }
    self.postMessage({ type: 'done', parts });
  } catch (error) {
    self.postMessage({ type: 'error', error: String(error?.message || error) });
  }
};
