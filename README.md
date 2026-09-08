<!-- portfolio
{
  "title": "Acid Forge",
  "topic": "Music/Sound & rhythm",
  "type": "product",
  "description": "A local-first browser acid instrument for composing mono subtractive basslines",
  "demo": "https://acid-forge.fabian523417.chatgpt.site"
}
-->

# Acid Forge

Acid Forge is a local-first browser instrument for making short acid basslines with an original mono subtractive voice. Choose a source preset, edit a 16- or 32-step pattern, add accents and slides, chain patterns, record filter/drive moves, then save or export the result.

## Try it locally

```sh
npm install
npm run dev
```

Open the local URL in a Chromium-based browser. Press `Start` once to activate audio. `Z–M` previews the voice, `Space` toggles transport, and `Panic` releases active voices.

## v1 workflow

- Eight curated source presets with saw, square and triangle oscillator variants.
- 16/32-step monophonic patterns with note, velocity, gate, accent and slide editing.
- Pattern chaining, swing, live transport and recorded cutoff/drive automation.
- Versioned localStorage sessions plus portable JSON import/export.
- Four-bar WAV render at 44.1 kHz and standard MIDI note export.

MIDI carries notes, timing, gates and velocities. Synth-specific controls remain in the Acid Forge session JSON; they cannot be represented by standard MIDI notes alone.

## Verification

```sh
npm run verify
npx tsc --noEmit
npm run build
```

`npm run verify` checks exact event/automation round-trip, malformed input rejection, finite note frequencies and the four-bar sample-count invariant. The browser release check covers fresh start, save/reload, JSON export/import, malformed import, WAV/MIDI export, rapid stop/start and narrow viewport layout.

## Limits

Audio is synthesized on the visitor's device. Browser background throttling can affect live timing; the tool schedules against the audio clock but does not claim hardware-independent latency. WAV export includes four bars and a bounded envelope tail inside the documented render length.

## License

MIT. See [LICENSE](LICENSE).
