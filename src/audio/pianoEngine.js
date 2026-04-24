// ─── pianoEngine.js ─────────────────────────────────────────────────────────
// Warm acoustic grand piano synthesizer using Web Audio API

let audioCtx = null;
let masterGain = null;
let compressor = null;
let convolver = null;
let dryGain = null;
let wetGain = null;
let activeNodes = [];

// Generate a synthetic concert hall impulse response
function generateImpulseResponse(ctx, duration = 1.8, decay = 2.0) {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * duration;
  const buffer = ctx.createBuffer(2, length, sampleRate);

  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      // Exponential decay with noise
      const envelope = Math.pow(1 - t / duration, decay);
      // Pre-delay (~20ms) for more realistic room ambiance
      const preDelay = i < sampleRate * 0.02 ? 0 : 1;
      data[i] = (Math.random() * 2 - 1) * envelope * preDelay;
    }
  }
  return buffer;
}

export function initAudio() {
  if (audioCtx) return audioCtx;

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // Master compressor
  compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 10;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.005;
  compressor.release.value = 0.2;

  // Master gain
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.8;

  // Convolver (reverb)
  convolver = audioCtx.createConvolver();
  convolver.buffer = generateImpulseResponse(audioCtx);

  // Dry/wet routing
  dryGain = audioCtx.createGain();
  dryGain.gain.value = 0.75;

  wetGain = audioCtx.createGain();
  wetGain.gain.value = 0.25;

  // Routing: compressor → dryGain → masterGain → destination
  //          compressor → convolver → wetGain → masterGain → destination
  compressor.connect(dryGain);
  dryGain.connect(masterGain);

  compressor.connect(convolver);
  convolver.connect(wetGain);
  wetGain.connect(masterGain);

  masterGain.connect(audioCtx.destination);

  return audioCtx;
}

export function setVolume(val) {
  if (masterGain) masterGain.gain.value = Math.max(0, Math.min(1, val));
}

export function getMidiNumber(noteName) {
  if (!noteName) return null;

  // Fix 5: normalize all flat spellings to sharps first
  const ENHARMONIC = {
    'Cb': 'B', 'Db': 'C#', 'Eb': 'D#', 'Fb': 'E',
    'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#',
  };

  const NOTE_MAP = {
    'C': 0, 'C#': 1,
    'D': 2, 'D#': 3,
    'E': 4,
    'F': 5, 'F#': 6,
    'G': 7, 'G#': 8,
    'A': 9, 'A#': 10,
    'B': 11,
  };

  // Parse note name + octave, e.g. "F#3", "Bb5", "C4"
  const match = noteName.match(/^([A-G][#b]?)(\d)$/);
  if (!match) return null;

  let [, name, octaveStr] = match;
  const octave = parseInt(octaveStr, 10);

  // Normalize flats → sharps
  name = ENHARMONIC[name] || name;

  const semitone = NOTE_MAP[name];
  if (semitone === undefined) return null;

  // MIDI: C4 = 60
  return (octave + 1) * 12 + semitone;
}

function midiToFrequency(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function playNote(midiNumber, duration, startTime, hand = 'right') {
  if (!audioCtx) return null;
  if (midiNumber < 21 || midiNumber > 108) return null;

  const freq = midiToFrequency(midiNumber);
  const nodes = [];

  // Multiple oscillators for warm piano timbre
  const oscConfigs = [
    { type: 'triangle', harmonic: 1, gain: 0.50 },
    { type: 'sine',     harmonic: 2, gain: 0.30 },
    { type: 'sine',     harmonic: 3, gain: 0.15 },
    { type: 'sine',     harmonic: 4, gain: 0.05 },
  ];

  // Per-note gain node
  const noteGain = audioCtx.createGain();

  // Per-note lowpass filter for warmth
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  // Higher notes have brighter cutoff
  const brightness = Math.pow(midiNumber / 88, 1.5);
  filter.frequency.value = 1200 + brightness * 5000;
  filter.Q.value = 0.8;

  filter.connect(compressor);
  noteGain.connect(filter);

  // ADSR
  const attack = 0.008;
  const decay = 0.2;
  const sustainLevel = 0.35;
  const release = 0.6;

  // Velocity simulation — higher notes ring slightly brighter
  const velocity = 0.5 + (midiNumber - 21) / (108 - 21) * 0.5;

  noteGain.gain.setValueAtTime(0, startTime);
  noteGain.gain.linearRampToValueAtTime(velocity, startTime + attack);
  noteGain.gain.linearRampToValueAtTime(sustainLevel * velocity, startTime + attack + decay);
  noteGain.gain.setValueAtTime(sustainLevel * velocity, startTime + duration - release);
  noteGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration + release);

  for (const cfg of oscConfigs) {
    const osc = audioCtx.createOscillator();
    const oscGain = audioCtx.createGain();
    osc.type = cfg.type;
    osc.frequency.value = freq * cfg.harmonic;
    oscGain.gain.value = cfg.gain;
    osc.connect(oscGain);
    oscGain.connect(noteGain);
    osc.start(startTime);
    osc.stop(startTime + duration + release + 0.1);
    nodes.push(osc, oscGain);
  }

  nodes.push(noteGain, filter);
  activeNodes.push(...nodes);

  // Cleanup after note finishes
  const stopDelay = (startTime - audioCtx.currentTime + duration + release + 0.2) * 1000;
  setTimeout(() => {
    nodes.forEach(n => {
      try { n.disconnect(); } catch (_) {}
    });
    activeNodes = activeNodes.filter(n => !nodes.includes(n));
  }, Math.max(stopDelay, 0));

  return nodes;
}

export function playBeat(beat, tempoFactor = 1) {
  if (!audioCtx) return;

  const now = audioCtx.currentTime;
  const duration = beat.duration / tempoFactor;

  if (!beat.isRest) {
    for (const note of (beat.rightHand || [])) {
      const midi = getMidiNumber(note.note);
      if (midi) playNote(midi, duration, now, 'right');
    }
    for (const note of (beat.leftHand || [])) {
      const midi = getMidiNumber(note.note);
      if (midi) playNote(midi, duration, now, 'left');
    }
  }
}

export function stopAll() {
  activeNodes.forEach(n => {
    try { n.disconnect(); } catch (_) {}
  });
  activeNodes = [];
}

export function getAudioContext() {
  return audioCtx;
}

export function resumeContext() {
  if (audioCtx && audioCtx.state === 'suspended') {
    return audioCtx.resume();
  }
  return Promise.resolve();
}
