import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTranscript, compareTranscript, normalizeWord, buildAliases, makeCSV } from '../src/core.js';

const fixture = '<speaker_transcript speaker="Anlatıcı" voice_style="Telaffuz: Roosevelt=Rozvelt, Churchill=Çörçil."><utterance id="109" timestamp="11:25 - 11:28" emotion="emphatic, slow pace"> Bu, cepheye girmek anlamına gelmiyordu. </utterance><utterance id="24" timestamp="02:18 - 02:25" emotion="strong, emphatic, slow pace"> Roosevelt’e göre Adana’da bin sekiz yüz kamyon vaat edilmiştir. Yalnız sekiz yüzü teslim edilmiştir. </utterance></speaker_transcript>';

test('parses full utterance metadata and speaker header', () => {
  const parsed = parseTranscript(fixture);
  assert.equal(parsed.units.length, 2);
  assert.equal(parsed.units[0].id, '109');
  assert.equal(parsed.units[1].timestamp, '02:18 - 02:25');
  assert.ok(parsed.header.includes('speaker="Anlatıcı"'));
});

test('finds missing words without listing emotion and tags as speech', () => {
  const parsed = parseTranscript(fixture);
  const result = compareTranscript(parsed, 'Bu cepheye girmek anlamına gelmiyordu. Rozvelte göre Adanada bin sekiz yüz kamyon vaat edilmiştir.');
  assert.equal(result.units[0].status, 'complete');
  assert.equal(result.units[1].status, 'partial');
  assert.match(result.missingXml, /utterance id="24"/);
  assert.match(result.missingXml, /Yalnız sekiz yüzü teslim edilmiştir/);
  assert.doesNotMatch(result.units[0].missingText, /emotion|emphatic/);
  assert.ok(result.missing > 0);
});

test('completely missing unit retains original xml', () => {
  const p = parseTranscript(fixture);
  const r = compareTranscript(p, 'Bu cepheye girmek anlamına gelmiyordu.');
  assert.equal(r.units[1].status, 'missing');
  assert.ok(r.missingXml.includes(p.units[1].originalMarkup));
});

test('plain transcript, punctuation and SRT', () => {
  assert.equal(normalizeWord('İnönü’ye'), 'inonuye');
  const p = parseTranscript('Birinci cümle. İkinci cümle!');
  assert.equal(p.units.length, 2);
  const s = parseTranscript('1\n00:00:00,000 --> 00:00:02,000\nMerhaba dünya.\n\n2\n00:00:02,000 --> 00:00:05,000\nGünaydın.');
  assert.equal(s.kind, 'srt');
  assert.equal(s.units[1].text, 'Günaydın.');
});

test('export csv with ids', () => {
  const r = compareTranscript(parseTranscript(fixture), '');
  assert.match(makeCSV(r), /109/);
  assert.equal(r.spoken, 0);
});