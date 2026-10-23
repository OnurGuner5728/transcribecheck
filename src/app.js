import { parseTranscript, compareTranscript, normalizeWord, makeCSV, formatTime } from './core.js';

const $ = id => document.getElementById(id);
const state = { audio: null, audioObjectUrl: null, worker: null, running: false, result: null, parsed: null };
const escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function showToast(message, isError = false) {
  const box = $('toast');
  box.textContent = message;
  box.style.background = isError ? '#ffe1e2' : '#e6f7f3';
  box.style.color = isError ? '#782d37' : '#183739';
  box.style.display = 'block';
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => box.style.display = 'none', 5400);
}

function unwrapGithub(raw) {
  let url;
  try { url = new URL(raw.trim()); } catch { throw new Error('Geçerli bir https:// bağlantısı girin.'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Yalnızca HTTP(S) bağlantıları desteklenir.');
  const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/([^/]+)\/(.+)$/);
  if (url.hostname === 'github.com' && m) return 'https://raw.githubusercontent.com/' + m.slice(1).join('/');
  if (url.hostname === 'github.com' && !url.pathname.includes('/releases/download/')) {
    throw new Error('GitHub depo sayfası değil, dosyanın “Copy raw file” bağlantısı gerekli.');
  }
  return url.href;
}

async function loadRemote(url, textOnly = false) {
  const response = await fetch(unwrapGithub(url), { redirect: 'follow' });
  if (!response.ok) throw new Error('Bağlantıdan dosya getirilemedi (HTTP ' + response.status + ').');
  if (textOnly) {
    const content = await response.text();
    if (/^\s*<!doctype html|^\s*<html/i.test(content)) throw new Error('Bağlantı metin dosyasına değil, bir HTML sayfasına gidiyor.');
    return content;
  }
  const blob = await response.blob();
  if (blob.size === 0) throw new Error('Bağlantıdaki ses dosyası boş.');
  if (blob.type.includes('text/html')) throw new Error('Bu URL ses yerine web sayfası döndürdü. Doğrudan ses bağlantısı ekleyin.');
  const name = decodeURIComponent(new URL(response.url).pathname.split('/').pop() || 'uzak-ses.wav');
  return new File([blob], name, { type: blob.type || 'application/octet-stream' });
}

function invalidateReport() {
  if (state.running) {
    if (state.worker) { state.worker.terminate(); state.worker = null; }
    setRunning(false);
    $('progressPanel').style.display = 'none';
  }
  if (state.result) {
    state.result = null;
    state.parsed = null;
    $('resultSection').style.display = 'none';
    showToast('Kaynak değişti. Önceki analiz gizlendi; güncel metin ve ses için yeniden analiz yapın.');
  }
}

function updateUnits(initial = false) {
  if (!initial) invalidateReport();
  const raw = $('transcriptInput').value.trim();
  if (!raw) { $('unitCount').textContent = 'Metin henüz girilmedi'; return; }
  try {
    const parsed = parseTranscript(raw);
    const total = parsed.units.reduce((n, u) => n + u.text.split(/\s+/).length, 0);
    const ids = new Set(parsed.units.map(u => u.id));
    const duplicateCount = parsed.kind === 'xml' ? parsed.units.length - ids.size : 0;
    $('unitCount').textContent = parsed.units.length + ' bölüm · yaklaşık ' + total + ' sözcük · ' + (parsed.kind === 'xml' ? 'XML' : parsed.kind.toUpperCase())
      + (duplicateCount ? ' · ⚠ ' + duplicateCount + ' yinelenen utterance ID (tam kaynak metin mi?)' : '');
  } catch {
    $('unitCount').textContent = 'Transkript okunamadı';
  }
}
$('transcriptInput').addEventListener('input', updateUnits);

function setAudio(file) {
  if (!file) return;
  invalidateReport();
  if (state.audioObjectUrl) URL.revokeObjectURL(state.audioObjectUrl);
  state.audio = file;
  state.audioObjectUrl = URL.createObjectURL(file);
  $('audioPlayer').src = state.audioObjectUrl;
  $('audioName').textContent = file.name;
  $('audioSize').textContent = (file.size / 1048576).toFixed(1) + ' MB · Analize hazır';
  $('audioSummary').style.display = 'flex';
  $('audioDrop').classList.add('hide');
  showToast('Ses dosyası hazır: ' + file.name);
}
function removeAudio() {
  invalidateReport();
  if (state.audioObjectUrl) URL.revokeObjectURL(state.audioObjectUrl);
  state.audio = null;
  state.audioObjectUrl = null;
  $('audioPlayer').removeAttribute('src');
  $('audioPlayer').load();
  $('audioSummary').style.display = 'none';
  $('audioDrop').classList.remove('hide');
  $('audioFile').value = '';
}
$('removeAudio').addEventListener('click', removeAudio);
$('audioFile').addEventListener('change', e => setAudio(e.target.files?.[0]));
$('audioDrop').addEventListener('dragover', e => { e.preventDefault(); $('audioDrop').classList.add('dragging'); });
$('audioDrop').addEventListener('dragleave', () => $('audioDrop').classList.remove('dragging'));
$('audioDrop').addEventListener('drop', e => {
  e.preventDefault(); $('audioDrop').classList.remove('dragging');
  const file = e.dataTransfer?.files?.[0];
  if (file) setAudio(file);
});
$('transcriptFile').addEventListener('change', async e => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    $('transcriptInput').value = await file.text();
    updateUnits();
    showToast(file.name + ' yüklendi.');
  } catch (err) { showToast(err.message, true); }
});
$('fetchTranscript').addEventListener('click', async () => {
  const button = $('fetchTranscript'); button.disabled = true;
  try {
    $('transcriptInput').value = await loadRemote($('transcriptUrl').value, true);
    updateUnits(); showToast('Bağlantıdaki transkript getirildi.');
  } catch (err) { showToast(err.message + ' (CORS engeli varsa dosyayı indirip yükleyin.)', true); }
  finally { button.disabled = false; }
});
$('fetchAudio').addEventListener('click', async () => {
  const button = $('fetchAudio'); button.disabled = true;
  try { setAudio(await loadRemote($('audioUrl').value)); }
  catch (err) { showToast(err.message + ' (CORS engeli varsa dosyayı indirip yükleyin.)', true); }
  finally { button.disabled = false; }
});

$('advancedToggle').addEventListener('click', () => {
  const isOpen = $('advancedDetails').classList.toggle('open');
  $('advancedToggle').setAttribute('aria-expanded', String(isOpen));
  $('advancedToggle').textContent = isOpen ? 'Gelişmiş seçenekler ▴' : 'Gelişmiş seçenekler ▾';
});
$('loadDemo').addEventListener('click', () => {
  $('transcriptInput').value = '<speaker_transcript speaker="Anlatıcı" role="Narrator" voice_style="Telaffuz: Roosevelt=Rozvelt, Churchill=Çörçil.">\n'
    + '<utterance id="109" timestamp="11:25 - 11:28" emotion="emphatic, slow pace"> Bu, cepheye girmek anlamına gelmiyordu. </utterance>\n'
    + '<utterance id="24" timestamp="02:18 - 02:25" emotion="strong, emphatic, slow pace"> Roosevelt\\\'e göre Adana\\\'da bin sekiz yüz kamyon vaat edilmiştir. Yalnız sekiz yüzü teslim edilmiştir. </utterance>\n'
    + '</speaker_transcript>';
  updateUnits();
  $('recognizedOverride').value = 'Bu cepheye girmek anlamına gelmiyordu. Rozveltte göre Adanada bin sekiz yüz kamyon vaat edilmiştir.';
  if (!$('advancedDetails').classList.contains('open')) $('advancedToggle').click();
  showToast('Örnek metin ve örnek Whisper çıktısı yüklendi. “Metni karşılaştır” ile sonucu inceleyin.');
});

function parseCurrent() {
  const parsed = parseTranscript($('transcriptInput').value);
  if (!parsed.units.some(u => u.text.trim())) throw new Error('Transkriptte karşılaştırılacak söz bulunamadı.');
  return parsed;
}
function setRunning(value) {
  state.running = value;
  $('startBtn').disabled = value;
  $('compareText').disabled = value;
  $('cancelBtn').classList.toggle('hide', !value);
}
function updateProgress(pct, title, message) {
  $('progressPanel').style.display = 'block';
  $('progressTitle').textContent = title;
  $('progressMessage').textContent = message;
  const v = Math.round(Math.min(100, Math.max(0, pct)));
  $('progressFill').style.width = v + '%';
  $('progressPercent').textContent = v + '%';
}

async function decodeAudio(file) {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  let source;
  try { source = await audioContext.decodeAudioData(await file.arrayBuffer()); }
  catch {
    throw new Error('Ses dosyası çözümlenemedi. WAV veya MP3 dosyasına dönüştürüp tekrar deneyin.');
  } finally { audioContext.close().catch(() => {}); }
  if (source.duration < 0.2) throw new Error('Ses çok kısa.');
  const renderLength = Math.ceil(source.duration * 16000);
  const offline = new OfflineAudioContext(1, renderLength, 16000);
  const node = offline.createBufferSource();
  node.buffer = source;
  node.connect(offline.destination);
  node.start();
  const resampled = await offline.startRendering();
  return new Float32Array(resampled.getChannelData(0));
}

function mergeParts(parts) {
  const words = [];
  const texts = [];
  let previousLastEnd = 0;
  for (const part of parts) {
    if (part.words?.length) {
      const normalized = part.words
        .filter(w => (w.text || '').trim())
        .map(w => ({ ...w, norm: normalizeWord(w.text) }));
      const unique = normalized.filter(w => w.at >= previousLastEnd - 0.20);
      if (!unique.length && !words.length) words.push(...normalized);
      else words.push(...unique);
      texts.push(unique.map(w => w.text).join(' '));
      previousLastEnd = Math.max(previousLastEnd, part.end - 0.20);
    } else {
      const current = String(part.text || '').trim();
      const prev = texts.join(' ').split(/\s+/);
      const now = current.split(/\s+/);
      let overlap = 0;
      for (let k = Math.min(prev.length, now.length, 22); k > 0; k--) {
        if (prev.slice(-k).map(normalizeWord).join('|') === now.slice(0, k).map(normalizeWord).join('|')) { overlap = k; break; }
      }
      texts.push(now.slice(overlap).join(' '));
      previousLastEnd = Math.max(previousLastEnd, part.end - 0.20);
    }
  }
  return { text: texts.join(' ').replace(/\s+([.,!?;:])/g, '$1').replace(/\s+/g, ' ').trim(), words };
}

function cancelCurrent() {
  if (state.worker) { state.worker.terminate(); state.worker = null; }
  setRunning(false);
  $('progressPanel').style.display = 'none';
}
$('cancelBtn').addEventListener('click', () => { cancelCurrent(); showToast('Analiz iptal edildi.'); });

$('startBtn').addEventListener('click', async () => {
  if (state.running) return;
  let parsed;
  try {
    parsed = parseCurrent();
    if (!state.audio) throw new Error('Önce ses dosyası veya ses bağlantısı ekleyin.');
  } catch (err) { showToast(err.message, true); return; }
  state.parsed = parsed;
  setRunning(true);
  $('resultSection').style.display = 'none';
  updateProgress(3, 'Ses hazırlanıyor…', 'Dosya tarayıcıda açılıp 16 kHz mono biçimine dönüştürülüyor.');
  try {
    const audio = await decodeAudio(state.audio);
    if (!state.running) return;
    const duration = formatTime(audio.length / 16000);
    updateProgress(10, 'Whisper modeli hazırlanıyor…', 'İlk kullanımda model indirilecek. Ses uzunluğu: ' + duration);
    const worker = new Worker(new URL('./whisper.worker.js', import.meta.url), { type: 'module' });
    state.worker = worker;
    worker.onmessage = event => {
      if (!state.running) return;
      const msg = event.data;
      if (msg.type === 'status') {
        updateProgress(12, 'Whisper modeli hazırlanıyor…', msg.message);
      } else if (msg.type === 'model-progress') {
        const p = msg.payload;
        if (p?.status === 'progress' && Number.isFinite(p.progress)) {
          updateProgress(11 + p.progress * 0.07, 'Whisper modeli indiriliyor…',
            (p.file || 'Model verisi') + ' · %' + Math.floor(p.progress));
        }
      } else if (msg.type === 'chunk-progress') {
        const percent = 20 + 76 * (msg.current - 1) / Math.max(1, msg.total);
        updateProgress(percent, 'Ses Whisper ile çözümleniyor…',
          'Bölüm ' + msg.current + '/' + msg.total + ' · ' + formatTime(msg.at) + ' / ' + duration);
      } else if (msg.type === 'done') {
        try {
          updateProgress(97, 'Transkript karşılaştırılıyor…', 'Ses metniyle orijinal metnin sözcükleri eşleştiriliyor.');
          const merged = mergeParts(msg.parts);
          if (!merged.text.trim()) throw new Error('Whisper seste konuşma algılayamadı. Sesin doğru dosya olduğunu kontrol edin.');
          state.result = compareTranscript(parsed, merged.text, $('aliasInput').value);
          renderReport(state.result);
          updateProgress(100, 'Analiz tamamlandı', 'Rapor hazır. Aşağıdan eksikleri ve XML çıktısını inceleyin.');
          setRunning(false);
          if (state.worker) { state.worker.terminate(); state.worker = null; }
          $('resultSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (err) { cancelCurrent(); showToast(err.message, true); }
      } else if (msg.type === 'error') {
        cancelCurrent(); showToast('Whisper hatası: ' + msg.error, true);
      }
    };
    worker.onerror = event => {
      cancelCurrent(); showToast('Whisper yüklenemedi: ' + (event.message || 'Tarayıcı / model hatası.'), true);
    };
    worker.postMessage({ type: 'transcribe', audio, model: $('modelSelect').value }, [audio.buffer]);
  } catch (err) {
    cancelCurrent(); showToast(err.message, true);
  }
});

$('compareText').addEventListener('click', () => {
  try {
    const parsed = parseCurrent();
    const heard = $('recognizedOverride').value.trim();
    if (!heard) throw new Error('Hazır Whisper çıktısı alanına metin ekleyin.');
    state.result = compareTranscript(parsed, heard, $('aliasInput').value);
    renderReport(state.result);
    $('resultSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) { showToast(err.message, true); }
});

function styledUnit(unit) {
  let html = '';
  let cursor = 0;
  for (const word of unit.tokens) {
    html += escapeHtml(unit.text.slice(cursor, word.start));
    const chunk = escapeHtml(unit.text.slice(word.start, word.end));
    html += word.status === 'spoken' ? chunk : '<mark class="miss">' + chunk + '</mark>';
    cursor = word.end;
  }
  return html + escapeHtml(unit.text.slice(cursor));
}
function unitCard(unit) {
  const label = unit.status === 'complete' ? 'Eksiksiz eşleşti' : unit.status === 'missing' ? 'Tamamen eksik' : 'Kısmen eksik';
  return '<div class="unit"><div class="unit-top"><div class="unit-meta">'
    + '<span class="unit-id">#' + escapeHtml(unit.id) + '</span>'
    + (unit.timestamp ? '<span>' + escapeHtml(unit.timestamp) + '</span>' : '')
    + (unit.emotion ? '<span title="' + escapeHtml(unit.emotion) + '">· ' + escapeHtml(unit.emotion) + '</span>' : '')
    + '</div><span class="status ' + escapeHtml(unit.status) + '">' + label + '</span></div>'
    + '<div class="unit-text">' + styledUnit(unit) + '</div>'
    + (unit.missingText ? '<div class="unit-footer">Eşleşmeyen: ' + escapeHtml(unit.missingText) + '</div>' : '')
    + '</div>';
}
function updateList() {
  const result = state.result;
  if (!result) return;
  const filter = $('resultFilter').value;
  const list = result.units.filter(u => filter === 'all' || (filter === 'issues' ? u.status !== 'complete' : u.status === filter));
  $('visibleCount').textContent = list.length + '/' + result.units.length + ' bölüm';
  $('unitList').innerHTML = list.length
    ? list.map(unitCard).join('')
    : '<div class="good-empty">Bu filtrede bölüm bulunamadı.</div>';
}
$('resultFilter').addEventListener('change', updateList);

function renderReport(result) {
  $('resultSection').style.display = 'block';
  $('metricCoverage').textContent = result.coverage.toLocaleString('tr-TR') + '%';
  $('metricSpoken').textContent = result.spoken.toLocaleString('tr-TR');
  $('metricMissing').textContent = result.missing.toLocaleString('tr-TR');
  $('metricUnits').textContent = String(result.missingUnits);
  $('metricUnitsHint').textContent = result.fullMissing + ' tam · ' + result.partial + ' kısmi';
  $('reportSummary').textContent = result.units.length + ' bölüm ve ' + result.total + ' referans kelimesi karşılaştırıldı. Eksikler Whisper tahminidir.';
  $('missingOutput').textContent = result.missingXml.trim() || 'Eksik bölüm tespit edilmedi.';
  $('recognizedOutput').textContent = result.recognizedText || 'Ses metni yok.';
  $('extraOutput').textContent = result.extra.length ? result.extra.join(' ') : 'Kaynak dışında okunan kelime tespit edilmedi.';
  $('resultFilter').value = result.missingUnits ? 'issues' : 'all';
  updateList();
}
$('newCheck').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

async function copy(text) {
  try { await navigator.clipboard.writeText(text); showToast('Panoya kopyalandı.'); }
  catch (err) { showToast('Panoya kopyalanamadı. Dosyayı indirebilirsiniz.', true); }
}
function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a);
  a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('copyXml').addEventListener('click', () => { if (state.result) copy(state.result.missingXml); });
$('downloadXml').addEventListener('click', () => {
  if (!state.result) return;
  download('eksik-utterance.' + (state.result.kind === 'xml' ? 'xml' : 'txt'), state.result.missingXml, 'text/plain;charset=utf-8');
});
$('downloadCsv').addEventListener('click', () => {
  if (state.result) download('transcribecheck-rapor.csv', makeCSV(state.result), 'text/csv;charset=utf-8');
});
$('downloadJson').addEventListener('click', () => {
  if (!state.result) return;
  const r = state.result;
  download('transcribecheck-rapor.json', JSON.stringify({
    createdAt: new Date().toISOString(), model: $('modelSelect').value,
    summary: { coverage: r.coverage, spoken: r.spoken, missing: r.missing,
      fullMissing: r.fullMissing, partial: r.partial, affectedUnits: r.missingUnits },
    items: r.units.map(u => ({
      id: u.id, timestamp: u.timestamp, emotion: u.emotion, status: u.status,
      text: u.text, missingSpans: u.missingSpans, missingMarkup: u.outputMarkup
    })), asrText: r.recognizedText, extraWords: r.extra
  }, null, 2), 'application/json;charset=utf-8');
});
$('modelSelect').addEventListener('change', invalidateReport);
$('aliasInput').addEventListener('input', invalidateReport);
$('recognizedOverride').addEventListener('input', invalidateReport);
updateUnits(true);
