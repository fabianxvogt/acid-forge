import assert from 'node:assert/strict';
import {
  buildEventTimeline,
  buildMidiBytes,
  createDefaultSession,
  fourBarSampleCount,
  liveStepTiming,
  noteFrequency,
  parseSession,
  serializeSession,
} from '../lib/session.ts';

const session = createDefaultSession();
const roundTripped = parseSession(serializeSession(session));
assert.deepEqual(roundTripped, session, 'default session must round-trip exactly');

session.patterns[0].events[2].note = 55;
session.patterns[0].events[2].accent = true;
session.patterns[0].events[3].slide = true;
session.patterns[0].automation = [{ step: 2, cutoff: 0.91, drive: 0.52 }];
const editedRoundTrip = parseSession(serializeSession(session));
assert.deepEqual(editedRoundTrip.patterns[0].events, session.patterns[0].events, 'event list must survive save/load');
assert.deepEqual(editedRoundTrip.patterns[0].automation, session.patterns[0].automation, 'automation must survive save/load');

const expectedSamples = Math.round((16 * 60 * 44100) / session.bpm);
assert.equal(fourBarSampleCount(session.bpm, 44100), expectedSamples, 'four-bar sample count must be exact');
assert.ok(noteFrequency(36) > 0 && Number.isFinite(noteFrequency(36)), 'voice frequencies must remain finite');

session.swing = 0.08;
session.patterns[0].chain = [0, 1, 2, 3];
session.patterns[0].events[1].note = 62;
session.patterns[1].events[0].note = 64;
const timeline = buildEventTimeline(session, 4);
const swungStep = timeline.find((event) => event.patternIndex === 0 && event.step === 1);
assert.ok(swungStep, 'shared timeline must include the swung step');
const unswungStepSeconds = (4 * 60 / session.bpm) / session.patterns[0].steps;
assert.ok(swungStep.startSeconds > unswungStepSeconds, 'nonzero swing must delay odd steps');
const evenLiveTiming = liveStepTiming(session.patterns[0], session.bpm, session.swing, 0, 0.9);
const oddLiveTiming = liveStepTiming(session.patterns[0], session.bpm, session.swing, 1, 0.9);
assert.ok(evenLiveTiming.stepSeconds > oddLiveTiming.stepSeconds, 'live scheduler must use swung even/odd spacing');
assert.equal(oddLiveTiming.voiceSeconds, oddLiveTiming.stepSeconds * 0.9, 'live voice duration must follow swung step timing and gate');

function readVarLength(bytes, start) {
  let value = 0;
  let offset = start;
  for (;;) {
    const byte = bytes[offset++];
    value = (value << 7) | (byte & 0x7f);
    if (!(byte & 0x80)) return { value, offset };
  }
}

function readMidiNoteOnTicks(bytes) {
  const notes = [];
  let offset = 22;
  let tick = 0;
  while (offset < bytes.length) {
    const delta = readVarLength(bytes, offset);
    offset = delta.offset;
    tick += delta.value;
    const status = bytes[offset++];
    if (status === 0xff) {
      offset += 1;
      const length = readVarLength(bytes, offset);
      offset = length.offset + length.value;
      continue;
    }
    if ((status & 0xf0) === 0x90 || (status & 0xf0) === 0x80) {
      const note = bytes[offset++];
      const velocity = bytes[offset++];
      if ((status & 0xf0) === 0x90 && velocity > 0) notes.push({ note, tick });
    }
  }
  return notes;
}

const midiNotes = readMidiNoteOnTicks(buildMidiBytes(session));
const expectedSwingTick = Math.round((swungStep.startSeconds / (60 / session.bpm)) * 480);
assert.ok(midiNotes.some((note) => note.note === 62 && note.tick === expectedSwingTick), 'MIDI bytes must preserve shared swung timing');
const chainStep = timeline.find((event) => event.bar === 1 && event.step === 0);
const expectedChainTick = Math.round((chainStep.startSeconds / (60 / session.bpm)) * 480);
assert.ok(midiNotes.some((note) => note.note === 64 && note.tick === expectedChainTick), 'MIDI bytes must follow the saved pattern chain');

assert.throws(() => parseSession('{"version":99}'), /Unsupported session version/);
assert.throws(() => parseSession('{"version":1,"patterns":[]}'), /Session needs 1–8 patterns/);

console.log(JSON.stringify({
  exactEventRoundTrip: true,
  exactAutomationRoundTrip: true,
  fourBarSampleCount: expectedSamples,
  bpm: session.bpm,
  malformedInputRejected: true,
  midiSwingAndChainTiming: true,
  liveSwingVoiceTiming: true,
}));
