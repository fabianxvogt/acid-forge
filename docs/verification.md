# Verification record

## Target contract

Acid Forge v1 is an original browser subtractive instrument with 16/32-step patterns, slides, accents, chaining, automation recording, eight source presets, transport/panic, local sessions, WAV and MIDI export.

## Automated checks

Run from the repository root:

- `npm run verify` — exact session event and automation round-trip, malformed import rejection, finite note frequency, and four-bar sample count.
- `npx tsc --noEmit` — source type-check.
- `npm run build` — production/static output.

The expected 132 BPM four-bar WAV count at 44.1 kHz is `320727` samples. The rendered WAV is mono, 16-bit PCM, and is bounded to the requested four-bar duration; envelopes are scheduled to decay inside that buffer rather than adding an unbounded tail.

Live playback, WAV, and MIDI now share the same swing-aware four-bar event timeline. MIDI uses 480 ticks per quarter note and rounds shared event times to that declared resolution; verification includes a nonzero-swing odd-step assertion and a chained-pattern byte-timing assertion. Imports are capped at 1 MB, and non-finite offline samples fail WAV encoding explicitly.

## Acceptance snapshot — 2026-09-06

Source SHA: `d128ba5819aa7f25e39c59683e54cc55fd320e71`

`npm run verify` passed with exact event and automation round-trip, malformed import rejection, `320727` samples at 132 BPM, swing-aware MIDI/chain timing, and live swung voice timing. `npx tsc --noEmit`, `npm run lint`, and `npm run build` passed for this source.

No browser action was used for this snapshot. Browser QA remains a separate open gate.

## Browser QA matrix

| Check | Chromium desktop | Chromium narrow viewport | Safari | Evidence |
| --- | --- | --- | --- | --- |
| Fresh load and audio start | pending | pending | untested | manual browser run |
| 16/32 step editing | pending | pending | untested | manual browser run |
| Rapid stop/start + panic | pending | pending | untested | manual browser run |
| Save, reload, JSON export/import | pending | pending | untested | manual browser run |
| Malformed JSON error | pending | pending | untested | manual browser run |
| WAV duration/sample count | pending | pending | untested | downloaded output + status |
| MIDI note export | pending | pending | untested | downloaded output |

Safari remains explicitly untested for this release.
