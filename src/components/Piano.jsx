import { useRef, useEffect, useCallback } from 'react';
import { getMidiNumber, initAudio, playNote, resumeContext } from '../audio/pianoEngine';

// Full 88-key layout: A0 (MIDI 21) to C8 (MIDI 108)
// Build the key layout array
function buildKeyLayout() {
  const keys = [];
  const whitePattern = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B semitones
  const blackPattern = [1, 3, 6, 8, 10]; // C# D# F# G# A#

  let whiteIndex = 0;
  for (let midi = 21; midi <= 108; midi++) {
    const semitone = (midi - 21) % 12;
    const noteInOctave = (midi) % 12; // 0=C 1=C# 2=D...
    const octave = Math.floor((midi - 12) / 12); // MIDI octave

    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const noteName = noteNames[noteInOctave] + octave;
    const isBlack = [1, 3, 6, 8, 10].includes(noteInOctave);

    keys.push({ midi, noteName, isBlack, whiteIndex: isBlack ? null : whiteIndex });
    if (!isBlack) whiteIndex++;
  }
  return keys;
}

const KEY_LAYOUT = buildKeyLayout();
const WHITE_WIDTH = 28;
const BLACK_WIDTH = 18;
const WHITE_HEIGHT = 130;
const BLACK_HEIGHT = 82;

// Compute black key X positions
function getBlackKeyX(midi) {
  // Find the white key to the left of this black key
  const noteInOctave = midi % 12; // 0=C
  // offset within white key group
  const offsets = { 1: 0.65, 3: 1.65, 6: 3.65, 8: 4.65, 10: 5.65 };
  const offset = offsets[noteInOctave];
  if (offset === undefined) return null;

  // Count white keys from A0 (MIDI 21) to this point
  let whitesBefore = 0;
  for (let m = 21; m < midi; m++) {
    const ni = m % 12;
    if (![1, 3, 6, 8, 10].includes(ni)) whitesBefore++;
  }

  // First white key in the octave of this black key
  // Find closest preceding C
  let baseWhites = whitesBefore;
  // Adjust offset: we want from the left white key
  // For the note patterns: C=0 D=1 E=2 F=3 G=4 A=5 B=6 per octave (7 white keys)
  // Black key sits between white keys
  const whiteInOctave = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 }; // which white key slot (0-6) precedes
  const slot = whiteInOctave[noteInOctave];
  // Find how many whites before this octave start (C of that octave)
  const octave = Math.floor((midi - 12) / 12);
  // MIDI of C in this octave
  const cMidi = octave * 12 + 12; // C of octave
  // Count whites from A0 to this C
  let whitesBeforeC = 0;
  for (let m = 21; m < cMidi; m++) {
    const ni = m % 12;
    if (![1, 3, 6, 8, 10].includes(ni)) whitesBeforeC++;
  }
  // Clamp to valid range
  if (cMidi < 21) whitesBeforeC = 0;

  const x = (whitesBeforeC + slot) * WHITE_WIDTH + WHITE_WIDTH * 0.65;
  return x;
}

export default function Piano({ highlights }) {
  const scrollRef = useRef();
  const keyRefs = useRef({}); // midi -> DOM element

  // highlights: Map<midi, {hand: 'right'|'left'|'both', finger: number}>

  // Scroll to C4 on mount
  useEffect(() => {
    const c4Midi = 60;
    const keyEl = keyRefs.current[c4Midi];
    if (keyEl && scrollRef.current) {
      const containerWidth = scrollRef.current.clientWidth;
      const keyLeft = keyEl.offsetLeft;
      scrollRef.current.scrollLeft = keyLeft - containerWidth / 2 + WHITE_WIDTH / 2;
    }
  }, []);

  // Apply highlights
  useEffect(() => {
    // Clear all active states
    Object.values(keyRefs.current).forEach(el => {
      if (!el) return;
      el.classList.remove('active-right', 'active-left', 'active-both');
      const badge = el.querySelector('.finger-badge');
      if (badge) badge.remove();
    });

    if (!highlights || highlights.size === 0) return;

    highlights.forEach((info, midi) => {
      const el = keyRefs.current[midi];
      if (!el) return;

      const cls = info.hand === 'both' ? 'active-both'
        : info.hand === 'right' ? 'active-right'
        : 'active-left';
      el.classList.add(cls);

      // Finger badge
      if (info.finger) {
        const badge = document.createElement('div');
        badge.className = `finger-badge ${info.hand === 'both' ? 'both' : info.hand}`;
        badge.textContent = info.finger;
        el.appendChild(badge);
      }
    });
  }, [highlights]);

  // Touch/click event delegation on container
  const handlePointerDown = useCallback((e) => {
    // Find key element
    let target = e.target;
    while (target && !target.dataset.midi) {
      target = target.parentElement;
    }
    if (!target?.dataset.midi) return;

    const midi = parseInt(target.dataset.midi);
    e.preventDefault();

    // Play note
    const ctx = initAudio();
    resumeContext().then(() => {
      playNote(midi, 0.8, ctx.currentTime, 'right');
    });
  }, []);

  // Build white keys array and their positions
  const whiteKeys = KEY_LAYOUT.filter(k => !k.isBlack);
  const blackKeys = KEY_LAYOUT.filter(k => k.isBlack);
  const totalWidth = whiteKeys.length * WHITE_WIDTH;

  return (
    <div className="piano-section">
      <div
        className="piano-scroll"
        ref={scrollRef}
      >
        <div
          className="piano-keys"
          style={{ width: totalWidth, position: 'relative' }}
          onMouseDown={handlePointerDown}
          onTouchStart={(e) => {
            const touch = e.touches[0];
            const el = document.elementFromPoint(touch.clientX, touch.clientY);
            if (el) {
              let target = el;
              while (target && !target.dataset.midi) target = target.parentElement;
              if (target?.dataset.midi) {
                const midi = parseInt(target.dataset.midi);
                const ctx = initAudio();
                resumeContext().then(() => {
                  playNote(midi, 0.8, ctx.currentTime, 'right');
                });
              }
            }
          }}
        >
          {/* White keys */}
          {whiteKeys.map((key, i) => {
            const noteInOctave = key.midi % 12;
            const octave = Math.floor((key.midi - 12) / 12);
            const isC = noteInOctave === 0;
            return (
              <div
                key={key.midi}
                className="key-white"
                data-midi={key.midi}
                ref={el => keyRefs.current[key.midi] = el}
                style={{ position: 'relative', flexShrink: 0 }}
                title={key.noteName}
              >
                {isC && (
                  <div className="key-label">C{octave}</div>
                )}
              </div>
            );
          })}

          {/* Black keys — absolutely positioned */}
          {blackKeys.map(key => {
            const x = getBlackKeyX(key.midi);
            if (x === null) return null;
            return (
              <div
                key={key.midi}
                className="key-black"
                data-midi={key.midi}
                ref={el => keyRefs.current[key.midi] = el}
                style={{
                  position: 'absolute',
                  left: x,
                  top: 0,
                }}
                title={key.noteName}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
