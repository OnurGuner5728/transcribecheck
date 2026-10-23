import { diffArrays } from 'diff';

const WORDS = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
const escapeXml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function normalizeWord(word) {
  return String(word || '')
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i').replace(/æ/g, 'ae').replace(/œ/g, 'oe')
    .replace(/['’\u2019]/g, '').replace(/[^a-z0-9]/g, '');
}

export function tokenize(text) {
  const out = [];
  for (const match of String(text || '').matchAll(WORDS)) {
    const norm = normalizeWord(match[0]);
    if (norm) out.push({ text: match[0], norm, start: match.index, end: match.index + match[0].length });
  }
  return out;
}

function stripMarkup(input) {
  return String(input).replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&apos;/gi, "'");
}

function attr(openTag, name) {
  const escaped = name;
  const match = openTag.match(new RegExp('\\b' + escaped + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i'));
  return match?.[1] ?? match?.[2] ?? '';
}

export function parseTranscript(raw) {
  const source = String(raw || '').replace(/^\uFEFF/, '').trim();
  if (!source) throw new Error('Önce bir transkript ekleyin.');
  const wrapper = source.match(/<speaker_transcript\b[^>]*>/i)?.[0] || '';
  const units = [];
  const tagRegex = /(<utterance\b[^>]*>)([\s\S]*?)(<\/utterance\s*>)/gi;
  let match;
  while ((match = tagRegex.exec(source)) !== null) {
    const text = stripMarkup(match[2]).trim();
    if (!text) continue;
    units.push({
      id: attr(match[1], 'id') || String(units.length + 1),
      timestamp: attr(match[1], 'timestamp'), emotion: attr(match[1], 'emotion'),
      openTag: match[1], originalMarkup: match[0],
      text, kind: 'utterance', index: units.length
    });
  }
  if (units.length) {
    return { kind: 'xml', units, header: wrapper, footer: wrapper ? '</speaker_transcript>' : '', original: source };
  }
  // SRT: retain cue identifiers and timestamps without comparing them as spoken words.
  const cues = source.replace(/\r/g, '').split(/\n\s*\n/);
  if (cues.length && cues.some(block => /-->/.test(block))) {
    for (const cue of cues) {
      const lines = cue.split('\n').filter(Boolean);
      const timeIdx = lines.findIndex(line => /-->/.test(line));
      if (timeIdx < 0) continue;
      const text = stripMarkup(lines.slice(timeIdx + 1).join(' ')).trim();
      if (text) units.push({ id: lines[0] === lines[timeIdx] ? String(units.length + 1) : lines[0],
        timestamp: lines[timeIdx], emotion: '', text, kind: 'plain', index: units.length });
    }
    if (units.length) return { kind: 'srt', units, header: '', footer: '', original: source };
  }
  const paragraphs = source.split(/\n\s*\n/).flatMap(p => p.split(/(?<=[.!?…])\s+(?=[\p{Lu}0-9])/u))
    .map(s => stripMarkup(s).trim()).filter(Boolean);
  for (const text of paragraphs) {
    units.push({ id: String(units.length + 1), timestamp: '', emotion: '', text, kind: 'plain', index: units.length });
  }
  return { kind: 'plain', units, header: '', footer: '', original: source };
}

export function buildAliases(source, manual = '') {
  const pairStrings = [];
  for (const found of String(source).matchAll(/Telaffuz\s*:\s*([^".\n]+)/gi)) {
    pairStrings.push(found[1]);
  }
  if (manual.trim()) pairStrings.push(manual);
  const alias = new Map();
  for (const text of pairStrings) {
    for (const item of text.split(/[,;\n]/)) {
      const m = item.match(/^\s*([^=]+?)\s*=\s*([^=]+?)\s*$/);
      if (!m) continue;
      const a = tokenize(m[1]), b = tokenize(m[2]);
      if (a.length !== b.length || !a.length) continue;
      a.forEach((token, i) => {
        const canon = a[i].norm;
        alias.set(token.norm, canon);
        alias.set(b[i].norm, canon);
      });
    }
  }
  return alias;
}

function canonical(norm, aliases) {
  if (!aliases?.size) return norm;
  let matched = norm;
  for (const [alternate, main] of aliases.entries()) {
    if (norm === alternate || (norm.startsWith(alternate) && norm.length - alternate.length <= 3)) {
      const candidate = main + norm.slice(alternate.length);
      if (alternate.length > 2 && (candidate.length >= matched.length || matched === norm)) matched = candidate;
    }
  }
  return matched;
}

function markedUnit(u, missing) {
  if (u.kind === 'utterance') {
    if (missing.length === u.tokens.length) return u.originalMarkup;
    return missing.map(segment => `${u.openTag} ${escapeXml(segment)} </utterance>`).join('\n');
  }
  return missing.join('\n');
}

export function compareTranscript(parsed, recognizedText, manualAliases = '') {
  const aliases = buildAliases(parsed.header || parsed.original.slice(0, 1800), manualAliases);
  const reference = [];
  const units = parsed.units.map(unit => {
    const tokens = tokenize(unit.text).map(t => ({ ...t, unitIndex: unit.index, status: 'missing',
      key: canonical(t.norm, aliases) }));
    reference.push(...tokens);
    return { ...unit, tokens, missingSpans: [], missingText: '', status: 'missing', spokenCount: 0 };
  });
  const observed = tokenize(recognizedText).map(t => ({ ...t, key: canonical(t.norm, aliases) }));
  const changes = diffArrays(reference, observed, {
    comparator: (a, b) => a.key === b.key
  });
  let extra = [];
  let lastRemoved = [];
  for (const change of changes) {
    if (change.added) {
      extra.push(...change.value.map(w => w.text));
    } else if (change.removed) {
      lastRemoved = change.value;
    } else {
      for (const t of change.value) t.status = 'spoken';
    }
  }
  let spoken = 0;
  let missing = 0;
  for (const unit of units) {
    const words = unit.tokens;
    unit.spokenCount = words.filter(w => w.status === 'spoken').length;
    spoken += unit.spokenCount;
    missing += words.length - unit.spokenCount;
    const missingWords = words.filter(w => w.status !== 'spoken');
    const spans = [];
    let group = [];
    function flush() {
      if (!group.length) return;
      let text = unit.text.slice(group[0].start, group[group.length - 1].end);
      const after = unit.text.slice(group[group.length - 1].end);
      const punctuation = after.match(/^[\s]*[.,!?;:…]+/u);
      if (punctuation) text += punctuation[0].trimEnd();
      spans.push({ text: text.trim(), from: group[0].start, to: group[group.length - 1].end });
      group = [];
    }
    for (const w of words) {
      if (w.status === 'spoken') { flush(); continue; }
      group.push(w);
    }
    flush();
    unit.missingSpans = spans;
    unit.missingText = spans.map(s => s.text).join(' … ');
    unit.status = unit.spokenCount === words.length ? 'complete' : unit.spokenCount ? 'partial' : 'missing';
    unit.outputMarkup = markedUnit(unit, spans.map(s => s.text));
  }
  const missingUnits = units.filter(u => u.status !== 'complete');
  const snippets = missingUnits.map(u => u.outputMarkup).filter(Boolean).join('\n');
  const missingXml = parsed.kind === 'xml' && parsed.header
    ? `${parsed.header}\n${snippets}\n${parsed.footer}`
    : snippets;
  return {
    units, observed, extra, spoken, missing, total: reference.length,
    coverage: reference.length ? Math.round(spoken * 1000 / reference.length) / 10 : 0,
    missingUnits: missingUnits.length,
    fullMissing: units.filter(u => u.status === 'missing').length,
    partial: units.filter(u => u.status === 'partial').length,
    missingXml,
    recognizedText: String(recognizedText || '').trim(), kind: parsed.kind
  };
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const n = Math.floor(seconds);
  return `${String(Math.floor(n / 3600)).padStart(2, '0')}:${String(Math.floor(n % 3600 / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

export function makeCSV(result) {
  const quote = s => '"' + String(s ?? '').replace(/"/g, '""') + '"';
  return '\uFEFF' + [
    ['ID', 'Zaman', 'Durum', 'Kelimeler', 'Okunan', 'Eksik metin', 'Orijinal metin'].map(quote).join(','),
    ...result.units.map(u => [u.id, u.timestamp, u.status, u.tokens.length, u.spokenCount, u.missingText, u.text].map(quote).join(','))
  ].join('\r\n');
}
