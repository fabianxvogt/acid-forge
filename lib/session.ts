export type StepEvent = {
  note: number | null;
  velocity: number;
  slide: boolean;
  accent: boolean;
  gate: number;
};

export type AutomationPoint = {
  step: number;
  cutoff: number;
  drive: number;
};

export type Pattern = {
  id: string;
  name: string;
  steps: 16 | 32;
  events: StepEvent[];
  automation: AutomationPoint[];
  chain: number[];
};

export type Preset = {
  id: string;
  name: string;
  family: string;
  description: string;
  cutoff: number;
  resonance: number;
  drive: number;
  accent: number;
  decay: number;
  oscillator: OscillatorType;
};

export type Session = {
  version: 1;
  name: string;
  bpm: number;
  swing: number;
  activePattern: number;
  presetId: string;
  cutoff: number;
  drive: number;
  resonance: number;
  patterns: Pattern[];
};

export type ScheduledEvent = {
  bar: number;
  patternIndex: number;
  step: number;
  event: StepEvent;
  startSeconds: number;
  durationSeconds: number;
};

export const SESSION_VERSION = 1 as const;

export const PRESETS: Preset[] = [
  {
    id: 'acid-spark',
    name: 'Acid Spark',
    family: 'bright 303-ish',
    description: 'A lean saw with a fast, singing filter.',
    cutoff: 0.46,
    resonance: 0.8,
    drive: 0.24,
    accent: 0.83,
    decay: 0.34,
    oscillator: 'sawtooth',
  },
  {
    id: 'rubber-room',
    name: 'Rubber Room',
    family: 'rounded + elastic',
    description: 'Soft square edges and a springy low-pass.',
    cutoff: 0.31,
    resonance: 0.68,
    drive: 0.35,
    accent: 0.7,
    decay: 0.46,
    oscillator: 'square',
  },
  {
    id: 'night-shift',
    name: 'Night Shift',
    family: 'low + shadowy',
    description: 'A dark pulse for slow, sub-heavy phrases.',
    cutoff: 0.2,
    resonance: 0.59,
    drive: 0.42,
    accent: 0.74,
    decay: 0.55,
    oscillator: 'sawtooth',
  },
  {
    id: 'metal-bloom',
    name: 'Metal Bloom',
    family: 'resonant + sharp',
    description: 'High resonance, clipped edges, long bloom.',
    cutoff: 0.53,
    resonance: 0.93,
    drive: 0.58,
    accent: 0.9,
    decay: 0.64,
    oscillator: 'sawtooth',
  },
  {
    id: 'acid-mint',
    name: 'Acid Mint',
    family: 'clean + nimble',
    description: 'A quick square voice that leaves room for drums.',
    cutoff: 0.39,
    resonance: 0.72,
    drive: 0.14,
    accent: 0.65,
    decay: 0.28,
    oscillator: 'square',
  },
  {
    id: 'rust-belt',
    name: 'Rust Belt',
    family: 'gritty + wide',
    description: 'Drive forward, filter half-open, edges worn in.',
    cutoff: 0.49,
    resonance: 0.74,
    drive: 0.78,
    accent: 0.86,
    decay: 0.4,
    oscillator: 'sawtooth',
  },
  {
    id: 'glass-house',
    name: 'Glass House',
    family: 'thin + precise',
    description: 'A brittle top end for interlocking slides.',
    cutoff: 0.62,
    resonance: 0.88,
    drive: 0.2,
    accent: 0.77,
    decay: 0.31,
    oscillator: 'triangle',
  },
  {
    id: 'afterimage',
    name: 'Afterimage',
    family: 'slow + fluorescent',
    description: 'Long envelopes and a filter that hangs in the air.',
    cutoff: 0.44,
    resonance: 0.83,
    drive: 0.48,
    accent: 0.82,
    decay: 0.78,
    oscillator: 'sawtooth',
  },
];

const NOTE_POOL = [36, 36, 43, 36, 48, 43, 36, 38, 41, 36, 43, 46, 36, 36, 48, 43];

export function makeEvent(note: number | null, index = 0): StepEvent {
  return {
    note,
    velocity: note === null ? 0 : index % 4 === 0 ? 0.84 : 0.67,
    slide: note !== null && [3, 7, 11].includes(index % 16),
    accent: note !== null && [0, 5, 12].includes(index % 16),
    gate: note === null ? 0.5 : index % 4 === 3 ? 0.72 : 0.9,
  };
}

export function makePattern(id: string, name: string, steps: 16 | 32 = 16): Pattern {
  const events = Array.from({ length: steps }, (_, index) => {
    const note = index < NOTE_POOL.length ? NOTE_POOL[index] : index % 8 === 0 ? 36 : null;
    return makeEvent(note, index);
  });
  return { id, name, steps, events, automation: [], chain: [] };
}

export function createDefaultSession(): Session {
  const patterns = [
    makePattern('p1', 'Main heat'),
    makePattern('p2', 'Open circuit'),
    makePattern('p3', 'Pressure drop'),
    makePattern('p4', 'Last pass'),
  ];
  patterns[0].chain = [0, 1, 2, 3];
  return {
    version: SESSION_VERSION,
    name: 'Acid Forge / First Heat',
    bpm: 132,
    swing: 0.08,
    activePattern: 0,
    presetId: PRESETS[0].id,
    cutoff: PRESETS[0].cutoff,
    drive: PRESETS[0].drive,
    resonance: PRESETS[0].resonance,
    patterns,
  };
}

export function cloneSession(session: Session): Session {
  return JSON.parse(JSON.stringify(session)) as Session;
}

function numberInRange(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeEvent(value: unknown, fallback: StepEvent): StepEvent {
  const event = value && typeof value === 'object' ? (value as Partial<StepEvent>) : {};
  const note = event.note === null ? null : numberInRange(event.note, fallback.note ?? 36, 24, 84);
  return {
    note,
    velocity: note === null ? 0 : numberInRange(event.velocity, fallback.velocity, 0.05, 1),
    slide: Boolean(event.slide),
    accent: Boolean(event.accent),
    gate: numberInRange(event.gate, fallback.gate, 0.1, 1),
  };
}

export function normalizeSession(value: unknown): Session {
  if (!value || typeof value !== 'object') throw new Error('Session must be a JSON object.');
  const input = value as Partial<Session>;
  if (input.version !== SESSION_VERSION) throw new Error('Unsupported session version.');
  const fallback = createDefaultSession();
  const rawPatterns = Array.isArray(input.patterns) ? input.patterns : [];
  if (rawPatterns.length < 1 || rawPatterns.length > 8) throw new Error('Session needs 1–8 patterns.');
  const patterns: Pattern[] = rawPatterns.map((raw, index) => {
    const candidate = raw && typeof raw === 'object' ? (raw as Partial<Pattern>) : {};
    const steps = candidate.steps === 32 ? 32 : 16;
    const defaults = fallback.patterns[index % fallback.patterns.length];
    const incomingEvents = Array.isArray(candidate.events) ? candidate.events : [];
    const events = Array.from({ length: steps }, (_, eventIndex) =>
      normalizeEvent(incomingEvents[eventIndex], defaults.events[eventIndex % defaults.events.length]),
    );
    const automation = Array.isArray(candidate.automation)
      ? candidate.automation.slice(0, 128).map((point) => {
          const entry = point && typeof point === 'object' ? (point as Partial<AutomationPoint>) : {};
          return {
            step: Math.round(numberInRange(entry.step, 0, 0, steps - 1)),
            cutoff: numberInRange(entry.cutoff, 0.45, 0, 1),
            drive: numberInRange(entry.drive, 0.25, 0, 1),
          };
        })
      : [];
    const chain = Array.isArray(candidate.chain)
      ? candidate.chain
          .filter((entry): entry is number => Number.isInteger(entry) && entry >= 0 && entry < rawPatterns.length)
          .slice(0, 16)
      : defaults.chain;
    return {
      id: typeof candidate.id === 'string' && candidate.id ? candidate.id.slice(0, 32) : `p${index + 1}`,
      name:
        typeof candidate.name === 'string' && candidate.name.trim()
          ? candidate.name.trim().slice(0, 40)
          : `Pattern ${index + 1}`,
      steps,
      events,
      automation,
      chain,
    };
  });
  return {
    version: SESSION_VERSION,
    name: typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 80) : fallback.name,
    bpm: Math.round(numberInRange(input.bpm, fallback.bpm, 70, 180)),
    swing: numberInRange(input.swing, fallback.swing, 0, 0.35),
    activePattern: Math.round(numberInRange(input.activePattern, 0, 0, patterns.length - 1)),
    presetId: PRESETS.some((preset) => preset.id === input.presetId) ? input.presetId! : fallback.presetId,
    cutoff: numberInRange(input.cutoff, fallback.cutoff, 0, 1),
    drive: numberInRange(input.drive, fallback.drive, 0, 1),
    resonance: numberInRange(input.resonance, fallback.resonance, 0, 1),
    patterns,
  };
}

export function serializeSession(session: Session): string {
  return JSON.stringify(normalizeSession(session), null, 2);
}

export function parseSession(text: string): Session {
  try {
    return normalizeSession(JSON.parse(text));
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Could not read that session.');
  }
}

export function noteName(note: number | null): string {
  if (note === null) return '—';
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[note % 12]}${Math.floor(note / 12) - 1}`;
}

export function noteFrequency(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

export function patternDurationSeconds(pattern: Pattern, bpm: number): number {
  return (4 * 60) / bpm;
}

export function sessionPatternChain(session: Session): number[] {
  const chain = session.patterns[session.activePattern]?.chain.filter(
    (index) => Number.isInteger(index) && index >= 0 && index < session.patterns.length,
  );
  return chain?.length ? chain : [session.activePattern];
}

export function stepStartSeconds(pattern: Pattern, bpm: number, swing: number, step: number): number {
  const base = patternDurationSeconds(pattern, bpm) / pattern.steps;
  const clampedSwing = Math.min(0.35, Math.max(0, swing));
  return Math.floor(step / 2) * base * 2 + (step % 2 === 1 ? base * (1 + clampedSwing) : 0);
}

export function stepDurationSeconds(pattern: Pattern, bpm: number, swing: number, step: number): number {
  const start = stepStartSeconds(pattern, bpm, swing, step);
  const next = step + 1 < pattern.steps ? stepStartSeconds(pattern, bpm, swing, step + 1) : patternDurationSeconds(pattern, bpm);
  return next - start;
}

export function buildEventTimeline(session: Session, bars = 4): ScheduledEvent[] {
  const timeline: ScheduledEvent[] = [];
  const chain = sessionPatternChain(session);
  for (let bar = 0; bar < bars; bar += 1) {
    const patternIndex = chain[bar % chain.length];
    const pattern = session.patterns[patternIndex];
    const barStart = bar * patternDurationSeconds(pattern, session.bpm);
    for (let step = 0; step < pattern.steps; step += 1) {
      const event = pattern.events[step];
      if (event.note === null) continue;
      timeline.push({
        bar,
        patternIndex,
        step,
        event,
        startSeconds: barStart + stepStartSeconds(pattern, session.bpm, session.swing, step),
        durationSeconds: stepDurationSeconds(pattern, session.bpm, session.swing, step) * event.gate,
      });
    }
  }
  return timeline;
}

function writeMidiVarLength(value: number): number[] {
  let buffer = value & 0x7f;
  const bytes: number[] = [];
  while ((value >>= 7)) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }
  for (;;) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
  return bytes;
}

export function buildMidiBytes(session: Session): number[] {
  const ticksPerQuarter = 480;
  const events: Array<{ tick: number; data: number[] }> = [];
  for (const scheduled of buildEventTimeline(session, 4)) {
    const event = scheduled.event;
    const start = Math.round((scheduled.startSeconds / (60 / session.bpm)) * ticksPerQuarter);
    const duration = Math.max(30, Math.round((scheduled.durationSeconds / (60 / session.bpm)) * ticksPerQuarter));
    const velocity = Math.round(Math.min(1, Math.max(0.05, event.velocity * (event.accent ? 1.12 : 1))) * 127);
    events.push({ tick: start, data: [0x90, event.note!, velocity] });
    events.push({ tick: start + duration, data: [0x80, event.note!, 0] });
  }
  events.sort((a, b) => a.tick - b.tick || a.data[0] - b.data[0]);
  const tempo = Math.round(60_000_000 / session.bpm);
  const track: number[] = [0, 0xff, 0x51, 3, (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff];
  let previousTick = 0;
  for (const event of events) {
    track.push(...writeMidiVarLength(event.tick - previousTick), ...event.data);
    previousTick = event.tick;
  }
  track.push(0, 0xff, 0x2f, 0);
  return [
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1,
    ticksPerQuarter >> 8, ticksPerQuarter & 0xff,
    0x4d, 0x54, 0x72, 0x6b,
    (track.length >> 24) & 0xff, (track.length >> 16) & 0xff,
    (track.length >> 8) & 0xff, track.length & 0xff,
    ...track,
  ];
}

export function fourBarSampleCount(bpm: number, sampleRate = 44100): number {
  return Math.round((16 * 60 * sampleRate) / bpm);
}
