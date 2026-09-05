'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { AcidAudioEngine, renderMidi, renderWav } from '@/lib/audio';
import {
  PRESETS,
  cloneSession,
  createDefaultSession,
  makeEvent,
  noteName,
  parseSession,
  serializeSession,
  type Session,
  type StepEvent,
} from '@/lib/session';

const STORAGE_KEY = 'acid-forge.session.v1';
const NOTE_OPTIONS = Array.from({ length: 49 }, (_, index) => 24 + index);

type ModelContext = {
  registerTool: (
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: Record<string, unknown>;
      execute: (input: unknown) => unknown | Promise<unknown>;
      annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
    },
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
};

declare global {
  interface Document { modelContext?: ModelContext; }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Chip({ children, active = false }: { children: ReactNode; active?: boolean }) {
  return <span className={`chip ${active ? 'chip-active' : ''}`}>{children}</span>;
}

function Meter({ value, tone = 'acid' }: { value: number; tone?: 'acid' | 'rust' }) {
  return (
    <div className={`meter meter-${tone}`} aria-hidden="true">
      <span style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

function StepButton({
  event,
  index,
  selected,
  active,
  onClick,
}: {
  event: StepEvent;
  index: number;
  selected: boolean;
  active: boolean;
  onClick: () => void;
}) {
  const isRest = event.note === null;
  return (
    <button
      type="button"
      className={`step-button ${selected ? 'step-selected' : ''} ${active ? 'step-playing' : ''} ${isRest ? 'step-rest' : ''}`}
      onClick={onClick}
      aria-label={`Step ${index + 1}, ${isRest ? 'rest' : noteName(event.note)}`}
    >
      <span className="step-number">{String(index + 1).padStart(2, '0')}</span>
      <strong>{isRest ? '·' : noteName(event.note)}</strong>
      <span className="step-flags">
        {event.accent ? <i className="flag-accent" title="Accent" /> : null}
        {event.slide ? <i className="flag-slide" title="Slide" /> : null}
      </span>
    </button>
  );
}

export default function Home() {
  const engine = useRef(new AcidAudioEngine());
  const fileInput = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState<Session>(() => createDefaultSession());
  const [selectedStep, setSelectedStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState<{ pattern: number; step: number } | null>(null);
  const [status, setStatus] = useState('Ready to heat up.');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<'wav' | 'midi' | 'import' | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const pattern = session.patterns[session.activePattern];
  const event = pattern.events[Math.min(selectedStep, pattern.events.length - 1)];
  const preset = PRESETS.find((item) => item.id === session.presetId) ?? PRESETS[0];
  const chain = pattern.chain.length ? pattern.chain : [session.activePattern];
  const automationSteps = useMemo(() => {
    const points = new Map(pattern.automation.map((point) => [point.step, point]));
    return Array.from({ length: pattern.steps }, (_, index) => points.get(index));
  }, [pattern]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setSession(parseSession(saved));
    } catch {
      setStatus('Saved data could not be restored; starting with a clean session.');
    }
    return () => engine.current.stop();
  }, []);

  useEffect(() => {
    const modelContext = document.modelContext;
    if (!modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(modelContext.registerTool({
      name: 'set_acid_step',
      title: 'Set Acid Forge step',
      description: 'Set one step in the visible Acid Forge pattern. Use for composing or correcting a note, rest, accent, slide, gate, or velocity.',
      inputSchema: {
        type: 'object',
        properties: {
          step: { type: 'integer', minimum: 1, maximum: 32 },
          note: { anyOf: [{ type: 'integer', minimum: 24, maximum: 84 }, { type: 'null' }] },
          accent: { type: 'boolean' },
          slide: { type: 'boolean' },
          velocity: { type: 'number', minimum: 0.05, maximum: 1 },
          gate: { type: 'number', minimum: 0.1, maximum: 1 },
        },
        required: ['step', 'note'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!input || typeof input !== 'object') throw new Error('Input must be an object.');
        const value = input as { step?: unknown; note?: unknown; accent?: unknown; slide?: unknown; velocity?: unknown; gate?: unknown };
        const step = Number(value.step);
        const currentSession = sessionRef.current;
        const currentPattern = currentSession.patterns[currentSession.activePattern];
        if (!Number.isInteger(step) || step < 1 || step > currentPattern.steps) throw new Error(`Step must be between 1 and ${currentPattern.steps}.`);
        if (value.note !== null && (!Number.isInteger(value.note) || Number(value.note) < 24 || Number(value.note) > 84)) throw new Error('Note must be null or a MIDI note from 24 to 84.');
        const nextEvent: Partial<StepEvent> = {
          note: value.note as number | null,
          accent: Boolean(value.accent),
          slide: Boolean(value.slide),
          velocity: typeof value.velocity === 'number' ? Math.min(1, Math.max(0.05, value.velocity)) : 0.7,
          gate: typeof value.gate === 'number' ? Math.min(1, Math.max(0.1, value.gate)) : 0.9,
        };
        updateSession((draft) => Object.assign(draft.patterns[draft.activePattern].events[step - 1], nextEvent));
        setSelectedStep(step - 1);
        setStatus(`WebMCP set step ${step}.`);
        return { status: 'updated', step, note: nextEvent.note, pattern: currentSession.activePattern + 1 };
      },
    }, { signal: lifecycle.signal })).catch(() => setStatus('Structured control registration is unavailable in this browser.'));
    return () => lifecycle.abort();
  }, []);

  useEffect(() => {
    const onKey = (keyboardEvent: KeyboardEvent) => {
      const target = keyboardEvent.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'SELECT' || target?.tagName === 'TEXTAREA') return;
      if (keyboardEvent.code === 'Space') {
        keyboardEvent.preventDefault();
        void toggleTransport();
      }
      const keyNotes: Record<string, number> = { z: 36, s: 37, x: 38, d: 39, c: 40, v: 41, g: 42, b: 43, h: 44, n: 45, j: 46, m: 47 };
      const note = keyNotes[keyboardEvent.key.toLowerCase()];
      if (note) void engine.current.preview(note, session.presetId, session.cutoff, session.drive);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function updateSession(recipe: (draft: Session) => void) {
    setSession((current) => {
      const draft = cloneSession(current);
      recipe(draft);
      return draft;
    });
  }

  async function toggleTransport() {
    if (playing) {
      engine.current.stop();
      setPlaying(false);
      setPlayhead(null);
      setStatus('Transport stopped. Voices released.');
      return;
    }
    try {
      await engine.current.start(session, (patternIndex, step) => {
        setPlayhead({ pattern: patternIndex, step });
      });
      setPlaying(true);
      setStatus('Running live from the audio clock.');
    } catch {
      setStatus('Audio could not start. Press Start again after allowing sound.');
    }
  }

  function choosePattern(index: number) {
    updateSession((draft) => {
      draft.activePattern = index;
    });
    setSelectedStep(0);
    setStatus(`Editing pattern ${index + 1}: ${session.patterns[index].name}.`);
  }

  function updateEvent(patch: Partial<StepEvent>) {
    updateSession((draft) => {
      const target = draft.patterns[draft.activePattern].events[selectedStep];
      Object.assign(target, patch);
      if (target.note === null) target.velocity = 0;
      else if (target.velocity === 0) target.velocity = 0.7;
    });
  }

  function setSoundValue(key: 'cutoff' | 'drive' | 'resonance', value: number) {
    updateSession((draft) => {
      draft[key] = value;
      if (playing) {
        const active = draft.patterns[draft.activePattern];
        const existing = active.automation.find((point) => point.step === selectedStep);
        if (existing && key !== 'resonance') existing[key] = value;
        else if (!existing) active.automation.push({ step: selectedStep, cutoff: draft.cutoff, drive: draft.drive });
      }
    });
  }

  function selectPreset(id: string) {
    const next = PRESETS.find((item) => item.id === id) ?? PRESETS[0];
    updateSession((draft) => {
      draft.presetId = next.id;
      draft.cutoff = next.cutoff;
      draft.drive = next.drive;
      draft.resonance = next.resonance;
    });
    setStatus(`${next.name} loaded. Knob moves are stored as automation while running.`);
  }

  function toggleChain(index: number) {
    updateSession((draft) => {
      const target = draft.patterns[draft.activePattern];
      const existing = target.chain.length ? [...target.chain] : [draft.activePattern];
      const position = existing.indexOf(index);
      if (position >= 0 && existing.length > 1) existing.splice(position, 1);
      else if (position < 0) existing.push(index);
      target.chain = existing;
    });
  }

  function changeStepCount(steps: 16 | 32) {
    updateSession((draft) => {
      const target = draft.patterns[draft.activePattern];
      target.steps = steps;
      target.events = Array.from({ length: steps }, (_, index) => target.events[index] ?? makeEvent(null, index));
      target.automation = target.automation.filter((point) => point.step < steps);
    });
    setSelectedStep((current) => Math.min(current, steps - 1));
  }

  function saveSession() {
    try {
      window.localStorage.setItem(STORAGE_KEY, serializeSession(session));
      setSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      setStatus('Session saved locally on this device.');
    } catch {
      setStatus('Could not save locally. Export the session file to keep a portable copy.');
    }
  }

  function exportSession() {
    downloadBlob(new Blob([serializeSession(session)], { type: 'application/json' }), 'acid-forge-session.json');
    setStatus('Portable session exported as version 1 JSON.');
  }

  async function importSession(file: File) {
    setBusy('import');
    try {
      const text = await file.text();
      const next = parseSession(text);
      engine.current.stop();
      setPlaying(false);
      setPlayhead(null);
      setSession(next);
      setSelectedStep(0);
      setStatus(`Imported ${next.name}. Event lists and automation were restored.`);
    } catch (error) {
      setStatus(`Import failed: ${error instanceof Error ? error.message : 'malformed file'}`);
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function exportWav() {
    setBusy('wav');
    setStatus('Rendering four bars at 44.1 kHz…');
    try {
      const result = await renderWav(session, { bars: 4, sampleRate: 44100 });
      downloadBlob(result.blob, 'acid-forge-four-bars.wav');
      setStatus(`WAV ready · ${result.sampleCount.toLocaleString()} samples · ${result.seconds.toFixed(2)} seconds.`);
    } catch (error) {
      setStatus(`WAV export failed: ${error instanceof Error ? error.message : 'unknown audio error'}`);
    } finally {
      setBusy(null);
    }
  }

  function exportMidi() {
    setBusy('midi');
    try {
      downloadBlob(renderMidi(session), 'acid-forge-notes.mid');
      setStatus('MIDI ready · notes, gates, accents and timing exported; synth controls stay in the session JSON.');
    } catch (error) {
      setStatus(`MIDI export failed: ${error instanceof Error ? error.message : 'unknown MIDI error'}`);
    } finally {
      setBusy(null);
    }
  }

  function resetSession() {
    engine.current.stop();
    setPlaying(false);
    setPlayhead(null);
    setSession(createDefaultSession());
    setSelectedStep(0);
    setStatus('Factory session restored. Nothing was written until you save.');
  }

  const activePlayhead = playhead?.pattern === session.activePattern ? playhead.step : -1;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          <div><div className="brand-name">ACID / FORGE</div><div className="brand-subtitle">original mono instrument · v1</div></div>
        </div>
        <div className="transport-group" aria-label="Transport">
          <button type="button" className={`transport-button ${playing ? 'is-playing' : ''}`} onClick={() => void toggleTransport()}><span className="transport-icon">{playing ? '■' : '▶'}</span>{playing ? 'Stop' : 'Start'}<kbd>Space</kbd></button>
          <button type="button" className="panic-button" onClick={() => { engine.current.panic(); setStatus('Panic: all active voices released.'); }}>Panic</button>
          <label className="bpm-control">BPM <input aria-label="Tempo in BPM" type="number" min="70" max="180" value={session.bpm} onChange={(event) => updateSession((draft) => { draft.bpm = Math.min(180, Math.max(70, Number(event.target.value) || 70)); })} /></label>
        </div>
        <div className="top-actions">
          <button type="button" className="quiet-button" onClick={resetSession}>Reset</button>
          <button type="button" className="quiet-button" onClick={saveSession}>Save {savedAt ? <span className="button-meta">{savedAt}</span> : null}</button>
          <button type="button" className="quiet-button" onClick={exportSession}>Export JSON</button>
          <button type="button" className="solid-button" onClick={() => fileInput.current?.click()}>{busy === 'import' ? 'Loading…' : 'Import'}</button>
          <input ref={fileInput} className="sr-only" type="file" accept="application/json,.json" onChange={(event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) void importSession(file); }} />
        </div>
      </header>

      <div className="status-strip" role="status" aria-live="polite"><span className={`status-dot ${playing ? 'status-dot-live' : ''}`} /><span>{status}</span><span className="status-hint">Keyboard: Z–M previews the voice · click a step to edit</span></div>

      <section className="workspace-grid">
        <aside className="panel preset-panel">
          <div className="panel-heading"><div><span className="eyebrow">01 / source bank</span><h2>Pick a source</h2></div><Chip active>{PRESETS.length} presets</Chip></div>
          <div className="preset-list">{PRESETS.map((item, index) => <button type="button" className={`preset-card ${item.id === preset.id ? 'preset-selected' : ''}`} key={item.id} onClick={() => selectPreset(item.id)}><span className="preset-index">0{index + 1}</span><span className="preset-copy"><strong>{item.name}</strong><small>{item.family}</small></span><span className="preset-spark" aria-hidden="true"><i style={{ height: `${24 + item.cutoff * 28}%` }} /><i style={{ height: `${20 + item.resonance * 45}%` }} /><i style={{ height: `${18 + item.drive * 38}%` }} /><i style={{ height: `${16 + item.decay * 35}%` }} /></span></button>)}</div>
          <div className="source-note"><span className="note-pin">●</span><p><strong>{preset.name}</strong><br />{preset.description}</p></div>
        </aside>

        <section className="panel sequencer-panel">
          <div className="panel-heading sequencer-heading"><div><span className="eyebrow">02 / event forge</span><h2>Step sequencer</h2></div><div className="step-toggle" role="group" aria-label="Pattern length">{[16, 32].map((length) => <button key={length} type="button" className={pattern.steps === length ? 'active' : ''} onClick={() => changeStepCount(length as 16 | 32)}>{length}</button>)}</div></div>
          <div className="pattern-tabs" role="tablist" aria-label="Patterns">{session.patterns.map((item, index) => <button type="button" role="tab" aria-selected={index === session.activePattern} className={index === session.activePattern ? 'active' : ''} key={item.id} onClick={() => choosePattern(index)}><span>P{index + 1}</span>{item.name}</button>)}</div>
          <div className={`step-grid step-grid-${pattern.steps}`}>{pattern.events.map((item, index) => <StepButton key={`${pattern.id}-${index}`} event={item} index={index} selected={index === selectedStep} active={index === activePlayhead} onClick={() => setSelectedStep(index)} />)}</div>
          <div className="lane-heading"><span>FILTER AUTOMATION</span><span>{pattern.automation.length ? `${pattern.automation.length} recorded points` : 'Move filter / drive while running to record'}</span></div>
          <div className="automation-lane" aria-label="Automation overview">{automationSteps.map((point, index) => <button type="button" className={`automation-bar ${point ? 'has-point' : ''} ${index === selectedStep ? 'selected' : ''}`} key={index} onClick={() => setSelectedStep(index)} style={{ height: `${Math.max(12, (point?.cutoff ?? 0.2) * 78)}%` }} aria-label={`Automation step ${index + 1}`} />)}</div>
          <div className="chain-box"><div><span className="eyebrow">Pattern chain</span><p>Playback order for the live transport.</p></div><div className="chain-controls">{session.patterns.map((item, index) => <button type="button" key={item.id} className={`chain-chip ${chain.includes(index) ? 'active' : ''}`} onClick={() => toggleChain(index)}><span>P{index + 1}</span>{item.name}</button>)}</div><div className="chain-readout" aria-label="Current pattern chain">{chain.map((index, chainIndex) => <span key={`${index}-${chainIndex}`}>P{index + 1}</span>)}</div></div>
        </section>

        <aside className="right-stack">
          <section className="panel control-panel">
            <div className="panel-heading"><div><span className="eyebrow">03 / synth controls</span><h2>Shape the heat</h2></div><span className="mono-badge">MONO</span></div>
            <label className="select-label">Source preset <select value={preset.id} onChange={(event) => selectPreset(event.target.value)}>{PRESETS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <div className="knob-grid">
              <label className="knob-control"><span>Cutoff <output>{Math.round(session.cutoff * 100)}%</output></span><input type="range" min="0" max="1" step="0.01" value={session.cutoff} onChange={(event) => setSoundValue('cutoff', Number(event.target.value))} /><Meter value={session.cutoff} /></label>
              <label className="knob-control"><span>Drive <output>{Math.round(session.drive * 100)}%</output></span><input type="range" min="0" max="1" step="0.01" value={session.drive} onChange={(event) => setSoundValue('drive', Number(event.target.value))} /><Meter value={session.drive} tone="rust" /></label>
              <label className="knob-control"><span>Resonance <output>{Math.round(session.resonance * 100)}%</output></span><input type="range" min="0" max="1" step="0.01" value={session.resonance} onChange={(event) => setSoundValue('resonance', Number(event.target.value))} /><Meter value={session.resonance} /></label>
              <label className="knob-control"><span>Swing <output>{Math.round(session.swing * 100)}%</output></span><input type="range" min="0" max="0.35" step="0.01" value={session.swing} onChange={(event) => updateSession((draft) => { draft.swing = Number(event.target.value); })} /><Meter value={session.swing / 0.35} /></label>
            </div>
            <div className="voice-card"><span className="voice-wave" aria-hidden="true">∿</span><div><strong>Original subtractive voice</strong><p>Saw / square oscillator → resonant low-pass → soft clip.</p></div></div>
          </section>

          <section className="panel inspector-panel">
            <div className="panel-heading"><div><span className="eyebrow">04 / selected event</span><h2>Step {String(selectedStep + 1).padStart(2, '0')}</h2></div><Chip>{event.note === null ? 'REST' : noteName(event.note)}</Chip></div>
            <div className="event-fields">
              <label className="select-label">Note <select value={event.note === null ? 'rest' : event.note} onChange={(change) => updateEvent({ note: change.target.value === 'rest' ? null : Number(change.target.value) })}><option value="rest">Rest</option>{NOTE_OPTIONS.map((note) => <option key={note} value={note}>{noteName(note)}</option>)}</select></label>
              <label className="range-row"><span>Velocity <output>{Math.round(event.velocity * 100)}%</output></span><input type="range" min="0.05" max="1" step="0.01" value={event.velocity || 0.05} onChange={(change) => updateEvent({ velocity: Number(change.target.value) })} /></label>
              <label className="range-row"><span>Gate <output>{Math.round(event.gate * 100)}%</output></span><input type="range" min="0.1" max="1" step="0.01" value={event.gate} onChange={(change) => updateEvent({ gate: Number(change.target.value) })} /></label>
              <div className="toggle-row"><label><input type="checkbox" checked={event.accent} disabled={event.note === null} onChange={(change) => updateEvent({ accent: change.target.checked })} /><span>Accent</span></label><label><input type="checkbox" checked={event.slide} disabled={event.note === null} onChange={(change) => updateEvent({ slide: change.target.checked })} /><span>Slide</span></label></div>
            </div>
            <button type="button" className="preview-button" onClick={() => { if (event.note !== null) void engine.current.preview(event.note, session.presetId, session.cutoff, session.drive); setStatus(event.note === null ? 'Rest selected; no voice triggered.' : `${noteName(event.note)} auditioned.`); }} disabled={event.note === null}>Audition selected note <span>↗</span></button>
          </section>
        </aside>
      </section>

      <footer className="bottom-dock"><div className="dock-copy"><span className="eyebrow">Export / share</span><strong>Notes travel. Synth controls stay here.</strong><span>WAV is a four-bar rendered loop. MIDI carries notes, timing, gates and velocities.</span></div><div className="dock-actions"><button type="button" className="export-button export-wav" onClick={() => void exportWav()} disabled={busy !== null}><span>{busy === 'wav' ? 'Rendering…' : 'Render WAV'}</span><small>4 bars · 44.1k</small></button><button type="button" className="export-button export-midi" onClick={exportMidi} disabled={busy !== null}><span>{busy === 'midi' ? 'Writing…' : 'Export MIDI'}</span><small>standard notes</small></button></div></footer>
    </main>
  );
}
