import {
  PRESETS,
  buildMidiBytes,
  buildEventTimeline,
  liveStepTiming,
  sessionPatternChain,
  type Session,
  noteFrequency,
} from './session';

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
    this.playVoice(note, 0.82, false, false, presetId, cutoff, drive, 0.48 * 0.94);
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
    const timing = liveStepTiming(pattern, this.session.bpm, this.session.swing, this.currentStep, event.gate);
    if (event.note !== null) {
      this.playVoice(
        event.note,
        event.velocity,
        event.accent,
        event.slide,
        preset.id,
        cutoff,
        drive,
        timing.voiceSeconds,
      );
    }
    this.onStep?.(this.currentPattern, this.currentStep);
    this.nextTickAt = Math.max(this.nextTickAt + timing.stepSeconds, now + 0.005);
    this.currentStep += 1;
    if (this.currentStep >= pattern.steps) {
      this.currentStep = 0;
      const chain = sessionPatternChain(this.session);
      const chainPosition = chain.indexOf(this.currentPattern);
      this.currentPattern = chain[(chainPosition + 1) % chain.length];
    }
  }

  private playVoice(
    note: number,
    velocity: number,
    accent: boolean,
    slide: boolean,
    presetId: string,
    cutoff: number,
    drive: number,
    durationSeconds: number,
  ): void {
    if (!this.context || !this.output) return;
    const preset = PRESETS.find((item) => item.id === presetId) ?? PRESETS[0];
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const shaper = this.context.createWaveShaper();
    const envelope = this.context.createGain();
    const voiceGain = this.context.createGain();
    const duration = Math.max(0.08, durationSeconds);
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
  const chain = sessionPatternChain(session);
  return chain.length ? chain : [patternIndex];
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
  for (const scheduled of buildEventTimeline(session, bars)) {
      const event = scheduled.event;
      if (event.note !== null) {
        const start = scheduled.startSeconds;
        const osc = context.createOscillator();
        const filter = context.createBiquadFilter();
        const shaper = context.createWaveShaper();
        const envelope = context.createGain();
        const pattern = session.patterns[scheduled.patternIndex];
        const automation = pattern.automation.find((point) => point.step === scheduled.step);
        const duration = Math.max(0.08, scheduled.durationSeconds);
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
    const rawSample = channel[index];
    if (!Number.isFinite(rawSample)) throw new Error(`Offline render produced a non-finite sample at index ${index}.`);
    const sample = clamp(rawSample, -1, 1);
    view.setInt16(44 + index * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }
  return output;
}

export function renderMidi(session: Session): Blob {
  return new Blob([new Uint8Array(buildMidiBytes(session))], { type: 'audio/midi' });
}

declare global {
  interface Window {
    webkitOfflineAudioContext?: typeof OfflineAudioContext;
  }
}
