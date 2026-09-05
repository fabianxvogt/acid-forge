# Verification record

## Target contract

Acid Forge v1 is an original browser subtractive instrument with 16/32-step patterns, slides, accents, chaining, automation recording, eight source presets, transport/panic, local sessions, WAV and MIDI export.

## Automated checks

Run from the repository root:

- `npm run verify` — exact session event and automation round-trip, malformed import rejection, finite note frequency, and four-bar sample count.
- `npx tsc --noEmit` — source type-check.
- `npm run build` — production/static output.

The expected 132 BPM four-bar WAV count at 44.1 kHz is `320727` samples. The rendered WAV is mono, 16-bit PCM, and is bounded to the requested four-bar duration; envelopes are scheduled to decay inside that buffer rather than adding an unbounded tail.

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
