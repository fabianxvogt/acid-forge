import assert from 'node:assert/strict';
import {
  createDefaultSession,
  fourBarSampleCount,
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

assert.throws(() => parseSession('{"version":99}'), /Unsupported session version/);
assert.throws(() => parseSession('{"version":1,"patterns":[]}'), /Session needs 1–8 patterns/);

console.log(JSON.stringify({
  exactEventRoundTrip: true,
  exactAutomationRoundTrip: true,
  fourBarSampleCount: expectedSamples,
  bpm: session.bpm,
  malformedInputRejected: true,
}));
