import { PRESETS, type Session, noteFrequency, patternDurationSeconds } from './session';

export type StepCallback = (patternIndex: number, step: number) => void;

type Voice = { nodes: AudioNode[]; stop: () => void };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function cutoffHz(value: number): number {
  return 160 + value * value * 9200;
}

function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(512 * Float32Array.BYTES_PER_ELEMENT)) as Float32Array<ArrayBuffer>;
  const k = 1 + clamp(amount, 0, 1) * 28;
  for (let index = 0; index < curve.length; index += 1) {
    const x = (index * 2) / (curve.length - 1) - 1;
    curve[index] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

export class AcidAudioEngine {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private voices = new Set<Voice>();
  private timer: number | null = null;
  private playing = false;
  private currentStep = 0;
  private currentPattern = 0;
  private nextTickAt = 0;
  private session: Session | null = null;
  private onStep: StepCallback | null = null;

  async start(session: Session, onStep: StepCallback): Promise<void> {
    if (typeof window === 'undefined') return;
    await this.ensureContext();
    this.stop();
    this.session = session;
    this.onStep = onStep;
    this.playing = true;
    this.currentPattern = session.activePattern;
    this.currentStep = 0;
    this.nextTickAt = this.context!.currentTime + 0.03;
    this.timer = window.setInterval(() => this.tick(), 20);
  }

  stop(): void {
    this.playing = false;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.releaseAll();
    this.onStep = null;
  }

  panic(): void {
    this.releaseAll();
    if (this.output && this.context) {
      const now = this.context.currentTime;
      this.output.gain.cancelScheduledValues(now);
      this.output.gain.setValueAtTime(0.0001, now);
      this.output.gain.linearRampToValueAtTime(0.78, now + 0.015);
    }
  }

  async preview(note: number, presetId: string, cutoff: number, drive: number): Promise<void> {
    await this.ensureContext();
    this.playVoice(note, 0.82, 0.94, false, false, presetId, cutoff, drive, 0.48);
  }

  private async ensureContext(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
      this.output = this.context.createGain();
      this.output.gain.value = 0.78;
      this.output.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') await this.context.resume();
  }

  private tick(): void {
    if (!this.playing || !this.session || !this.context) return;
    const now = this.context.currentTime;
    if (now + 0.01 < this.nextTickAt) return;
    const pattern = this.session.patterns[this.currentPattern];
    const event = pattern.events[this.currentStep];
    const preset = PRESETS.find((item) => item.id === this.session!.presetId) ?? PRESETS[0];
    const automation = pattern.automation.find((point) => point.step === this.currentStep);
    const cutoff = automation?.cutoff ?? this.session.cutoff;
    const drive = automation?.drive ?? this.session.drive;
    if (event.note !== null) {
      this.playVoice(
        event.note,
        event.velocity,
        event.gate,
        event.accent,
        event.slide,
        preset.id,
        cutoff,
        drive,
        (60 / this.session.bpm) * (4 / pattern.steps),
      );
    }
    this.onStep?.(this.currentPattern, this.currentStep);
    const stepDuration = (60 / this.session.bpm) * (4 / pattern.steps);
    const swingOffset = this.currentStep % 2 === 1 ? this.session.swing * stepDuration : 0;
    this.nextTickAt = Math.max(this.nextTickAt + stepDuration + swingOffset, now + 0.005);
    this.currentStep += 1;
    if (this.currentStep >= pattern.steps) {
      this.currentStep = 0;
      const chain = patternChain(this.session, this.currentPattern);
      const chainPosition = chain.indexOf(this.currentPattern);
      this.currentPattern = chain[(chainPosition + 1) % chain.length];
    }
  }

  private playVoice(
    note: number,
    velocity: number,
    gate: number,
    accent: boolean,
    slide: boolean,
    presetId: string,
    cutoff: number,
    drive: number,
    stepDuration: number,
  ): void {
    if (!this.context || !this.output) return;
    const preset = PRESETS.find((item) => item.id === presetId) ?? PRESETS[0];
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const shaper = this.context.createWaveShaper();
    const envelope = this.context.createGain();
    const voiceGain = this.context.createGain();
    const duration = Math.max(0.08, stepDuration * clamp(gate, 0.1, 1));
    const peak = clamp(0.09 + velocity * 0.13 + (accent ? preset.accent * 0.08 : 0), 0.08, 0.32);
    osc.type = preset.oscillator;
    osc.frequency.setValueAtTime(slide ? noteFrequency(note - 5) : noteFrequency(note), now);
    if (slide) osc.frequency.linearRampToValueAtTime(noteFrequency(note), now + Math.min(0.12, duration * 0.65));
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoffHz(cutoff), now);
    filter.Q.setValueAtTime(0.8 + this.session!.resonance * 17, now);
    shaper.curve = driveCurve(drive);
    shaper.oversample = '2x';
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.linearRampToValueAtTime(peak, now + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration + preset.decay * 0.18);
    voiceGain.gain.value = 0.72;
    osc.connect(filter).connect(shaper).connect(envelope).connect(voiceGain).connect(this.output);
    osc.start(now);
    osc.stop(now + duration + preset.decay * 0.2 + 0.04);
    const voice: Voice = {
      nodes: [osc, filter, shaper, envelope, voiceGain],
      stop: () => {
        try {
          envelope.gain.cancelScheduledValues(this.context?.currentTime ?? 0);
          envelope.gain.setTargetAtTime(0.0001, this.context?.currentTime ?? 0, 0.012);
          osc.stop((this.context?.currentTime ?? 0) + 0.06);
        } catch {
          // The node may already have ended.
        }
      },
    };
    this.voices.add(voice);
    osc.addEventListener('ended', () => this.voices.delete(voice), { once: true });
  }

  private releaseAll(): void {
    for (const voice of this.voices) voice.stop();
    this.voices.clear();
  }
}

export function patternChain(session: Session, patternIndex: number): number[] {
  const chain = session.patterns[session.activePattern]?.chain;
  if (chain?.length) {
    return chain.filter((index) => Number.isInteger(index) && index >= 0 && index < session.patterns.length);
  }
  return [patternIndex];
}

export async function renderWav(
  session: Session,
  options: { bars?: number; sampleRate?: number } = {},
): Promise<{ blob: Blob; sampleCount: number; seconds: number }> {
  const sampleRate = options.sampleRate ?? 44100;
  const bars = options.bars ?? 4;
  const seconds = (bars * 4 * 60) / session.bpm;
  const length = Math.round(seconds * sampleRate);
  const Offline = window.OfflineAudioContext ?? window.webkitOfflineAudioContext;
  if (!Offline) throw new Error('Offline audio rendering is not supported in this browser.');
  const context = new Offline(1, length, sampleRate);
  const output = context.createGain();
  output.gain.value = 0.78;
  output.connect(context.destination);
  const preset = PRESETS.find((item) => item.id === session.presetId) ?? PRESETS[0];
  let cursor = 0;
  let patternIndex = session.activePattern;
  for (let bar = 0; bar < bars; bar += 1) {
    const pattern = session.patterns[patternIndex];
    const stepDuration = patternDurationSeconds(pattern, session.bpm) / pattern.steps;
    for (let step = 0; step < pattern.steps; step += 1) {
      const event = pattern.events[step];
      if (event.note !== null) {
        const start = cursor + step * stepDuration;
        const osc = context.createOscillator();
        const filter = context.createBiquadFilter();
        const shaper = context.createWaveShaper();
        const envelope = context.createGain();
        const automation = pattern.automation.find((point) => point.step === step);
        const duration = Math.max(0.08, stepDuration * event.gate);
        osc.type = preset.oscillator;
        osc.frequency.setValueAtTime(event.slide ? noteFrequency(event.note - 5) : noteFrequency(event.note), start);
        if (event.slide) osc.frequency.linearRampToValueAtTime(noteFrequency(event.note), start + Math.min(0.12, duration * 0.65));
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(cutoffHz(automation?.cutoff ?? session.cutoff), start);
        filter.Q.setValueAtTime(0.8 + session.resonance * 17, start);
        shaper.curve = driveCurve(automation?.drive ?? session.drive);
        shaper.oversample = '2x';
        const peak = clamp(0.09 + event.velocity * 0.13 + (event.accent ? preset.accent * 0.08 : 0), 0.08, 0.32);
        envelope.gain.setValueAtTime(0.0001, start);
        envelope.gain.linearRampToValueAtTime(peak, start + 0.008);
        envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration + preset.decay * 0.18);
        osc.connect(filter).connect(shaper).connect(envelope).connect(output);
        osc.start(start);
        osc.stop(Math.min(seconds, start + duration + preset.decay * 0.2 + 0.04));
      }
    }
    cursor += patternDurationSeconds(pattern, session.bpm);
    const chain = patternChain(session, patternIndex);
    const chainPosition = chain.indexOf(patternIndex);
    patternIndex = chain[(chainPosition + 1) % chain.length];
  }
  const buffer = await context.startRendering();
  const wav = encodeWav(buffer);
  return { blob: new Blob([wav], { type: 'audio/wav' }), sampleCount: length, seconds };
}

function encodeWav(buffer: AudioBuffer): ArrayBuffer {
  const channel = buffer.getChannelData(0);
  const dataLength = channel.length * 2;
  const output = new ArrayBuffer(44 + dataLength);
  const view = new DataView(output);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, dataLength, true);
  for (let index = 0; index < channel.length; index += 1) {
    const sample = clamp(channel[index], -1, 1);
    view.setInt16(44 + index * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }
  return output;
}

function writeVarLength(value: number): number[] {
  let buffer = value & 0x7f;
  const bytes = [];
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

export function renderMidi(session: Session): Blob {
  const ticksPerQuarter = 480;
  const events: Array<{ tick: number; data: number[] }> = [];
  const pattern = session.patterns[session.activePattern];
  const ticksPerStep = Math.round((ticksPerQuarter * 4) / pattern.steps);
  for (let step = 0; step < pattern.steps * 4; step += 1) {
    const event = pattern.events[step % pattern.steps];
    if (event.note === null) continue;
    const start = step * ticksPerStep;
    const duration = Math.max(30, Math.round(ticksPerStep * event.gate));
    const velocity = Math.round(clamp(event.velocity * (event.accent ? 1.12 : 1), 0.05, 1) * 127);
    events.push({ tick: start, data: [0x90, event.note, velocity] });
    events.push({ tick: start + duration, data: [0x80, event.note, 0] });
  }
  events.sort((a, b) => a.tick - b.tick || a.data[0] - b.data[0]);
  const track: number[] = [0, 0xff, 0x51, 3, (60000000 / session.bpm) >> 16, (60000000 / session.bpm) >> 8 & 0xff, 60000000 / session.bpm & 0xff];
  let previousTick = 0;
  for (const event of events) {
    track.push(...writeVarLength(event.tick - previousTick), ...event.data);
    previousTick = event.tick;
  }
  track.push(0, 0xff, 0x2f, 0);
  const bytes = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, ticksPerQuarter >> 8, ticksPerQuarter & 0xff, 0x4d, 0x54, 0x72, 0x6b, (track.length >> 24) & 0xff, (track.length >> 16) & 0xff, (track.length >> 8) & 0xff, track.length & 0xff, ...track];
  return new Blob([new Uint8Array(bytes)], { type: 'audio/midi' });
}

declare global {
  interface Window {
    webkitOfflineAudioContext?: typeof OfflineAudioContext;
  }
}
