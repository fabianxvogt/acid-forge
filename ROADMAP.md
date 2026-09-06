# Acid Forge roadmap

## Now

- Non-interactive v1 acceptance is complete at executable source SHA `d128ba5819aa7f25e39c59683e54cc55fd320e71`: exact session/event/automation round-trip, malformed and oversized import rejection, finite WAV samples, four-bar sample count, swing-aware MIDI chain timing, live swung voice timing, typecheck, and full lint all pass.
- Finish the browser release check for desktop and narrow Chromium layouts, repeated transport actions, downloads, and local save/reload.
- Keep the experience static, local-first and usable without an account.

## Next

- Measure live timing and export startup on more Chromium devices.
- Consider per-pattern names and richer automation lanes if real users need them.

## Later

- Optional Web MIDI input after a separate compatibility pass.
- Additional voice models only if they remain clearly distinct from the original v1 voice.

## Done

- Original mono subtractive voice with eight source presets.
- 16/32-step sequencing, accents, slides and pattern chaining.
- Live cutoff/drive automation recording.
- Transport, panic, local save/reopen, versioned import/export.
- Four-bar WAV and standard MIDI export.
- Shared swing-aware schedule is used by live playback, WAV, and MIDI; automated acceptance evidence is recorded in [`docs/verification.md`](docs/verification.md).
