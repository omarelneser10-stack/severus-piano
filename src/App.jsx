import { useState, useRef, useCallback, useEffect } from 'react';
import './styles/global.css';
import Uploader from './components/Uploader';
import Piano from './components/Piano';
import Controls from './components/Controls';
import NoteStrip from './components/NoteStrip';
import SheetLibrary from './components/SheetLibrary';
import {
  initAudio,
  playNote,
  stopAll,
  setVolume,
  getMidiNumber,
  getAudioContext,
  resumeContext,
} from './audio/pianoEngine';

function formatTime(secs) {
  const s = Math.max(0, secs);
  const m = Math.floor(s / 60);
  const sc = Math.floor(s % 60);
  return `${m}:${sc.toString().padStart(2, '0')}`;
}

function buildHighlights(beat) {
  if (!beat || beat.isRest) return new Map();
  const map = new Map();

  for (const note of (beat.rightHand || [])) {
    const midi = getMidiNumber(note.note);
    if (midi) {
      map.set(midi, { hand: 'right', finger: note.finger });
    }
  }
  for (const note of (beat.leftHand || [])) {
    const midi = getMidiNumber(note.note);
    if (midi) {
      const existing = map.get(midi);
      if (existing) {
        map.set(midi, { hand: 'both', finger: note.finger || existing.finger });
      } else {
        map.set(midi, { hand: 'left', finger: note.finger });
      }
    }
  }
  return map;
}

function getNoteDisplayText(beat) {
  if (!beat || beat.isRest) return 'REST';
  const rh = (beat.rightHand || []).map(n => n.note);
  const lh = (beat.leftHand || []).map(n => n.note);
  const all = [...new Set([...rh, ...lh])];
  return all.length > 0 ? all.join(' · ') : '';
}

export default function App() {
  const [beats, setBeats] = useState(null);
  const [currentBeatIdx, setCurrentBeatIdx] = useState(0);
  const [highlights, setHighlights] = useState(new Map());
  const [noteDisplay, setNoteDisplay] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [tempo, setTempo] = useState(100);
  const [volume, setVolume] = useState(80);
  const [loopOn, setLoopOn] = useState(false);
  const [loopA, setLoopA] = useState(null);
  const [loopB, setLoopB] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [totalTime, setTotalTime] = useState(0);

  const pendingTimeouts = useRef([]);
  const playbackPos = useRef(0); // current beat index during playback
  const isPlayingRef = useRef(false);
  const tempoRef = useRef(100);
  const loopRef = useRef({ on: false, a: null, b: null });

  // Keep refs in sync
  useEffect(() => { tempoRef.current = tempo; }, [tempo]);
  useEffect(() => { loopRef.current = { on: loopOn, a: loopA, b: loopB }; }, [loopOn, loopA, loopB]);

  // Compute total time
  useEffect(() => {
    if (!beats) return;
    const total = beats.reduce((acc, b) => acc + b.duration, 0) / (tempoRef.current / 100);
    setTotalTime(total);
  }, [beats, tempo]);

  // Show first beat highlights when beats load
  useEffect(() => {
    if (beats && beats.length > 0) {
      setCurrentBeatIdx(0);
      setHighlights(buildHighlights(beats[0]));
      setNoteDisplay(getNoteDisplayText(beats[0]));
    }
  }, [beats]);

  function clearAllTimeouts() {
    pendingTimeouts.current.forEach(id => clearTimeout(id));
    pendingTimeouts.current = [];
  }

  function schedulePlayback(startBeatIdx) {
    if (!beats || beats.length === 0) return;

    const ctx = getAudioContext() || initAudio();
    const tf = tempoRef.current / 100;
    const loop = loopRef.current;

    const endBeat = loop.on && loop.b !== null ? loop.b + 1 : beats.length;
    const startBeat = startBeatIdx;

    let audioOffset = 0;
    let elapsedBefore = beats.slice(0, startBeat).reduce((acc, b) => acc + b.duration, 0) / tf;

    for (let i = startBeat; i < endBeat; i++) {
      const beat = beats[i];
      const duration = beat.duration / tf;
      const scheduleAt = ctx.currentTime + audioOffset;

      // Schedule audio
      if (!beat.isRest) {
        for (const note of (beat.rightHand || [])) {
          const midi = getMidiNumber(note.note);
          if (midi) playNote(midi, duration, scheduleAt, 'right');
        }
        for (const note of (beat.leftHand || [])) {
          const midi = getMidiNumber(note.note);
          if (midi) playNote(midi, duration, scheduleAt, 'left');
        }
      }

      // Schedule UI update
      const uiDelay = audioOffset * 1000;
      const capturedI = i;
      const capturedElapsed = elapsedBefore + audioOffset;

      const tid = setTimeout(() => {
        if (!isPlayingRef.current) return;
        playbackPos.current = capturedI;
        setCurrentBeatIdx(capturedI);
        setHighlights(buildHighlights(beats[capturedI]));
        setNoteDisplay(getNoteDisplayText(beats[capturedI]));
        setElapsedTime(capturedElapsed);
      }, uiDelay);
      pendingTimeouts.current.push(tid);

      audioOffset += duration;
    }

    // Schedule end / loop
    const endDelay = audioOffset * 1000;
    const tid = setTimeout(() => {
      if (!isPlayingRef.current) return;
      const loop = loopRef.current;
      if (loop.on) {
        clearAllTimeouts();
        const loopStart = loop.a !== null ? loop.a : 0;
        playbackPos.current = loopStart;
        schedulePlayback(loopStart);
      } else {
        handleStop();
      }
    }, endDelay);
    pendingTimeouts.current.push(tid);
  }

  const handlePlay = useCallback(async () => {
    if (!beats || beats.length === 0) return;

    const ctx = initAudio();
    await resumeContext();

    const startIdx = isPaused ? playbackPos.current : (loopRef.current.on && loopRef.current.a !== null ? loopRef.current.a : currentBeatIdx);

    isPlayingRef.current = true;
    setIsPlaying(true);
    setIsPaused(false);

    schedulePlayback(startIdx);
  }, [beats, isPaused, currentBeatIdx]);

  const handlePause = useCallback(async () => {
    const ctx = getAudioContext();
    if (ctx) await ctx.suspend();
    clearAllTimeouts();
    isPlayingRef.current = false;
    setIsPlaying(false);
    setIsPaused(true);
    stopAll();
    // Do NOT clear highlights — they persist during pause
  }, []);

  const handleStop = useCallback(() => {
    clearAllTimeouts();
    isPlayingRef.current = false;
    setIsPlaying(false);
    setIsPaused(false);
    stopAll();
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') ctx.resume();

    playbackPos.current = 0;
    setCurrentBeatIdx(0);
    setElapsedTime(0);

    if (beats && beats.length > 0) {
      setHighlights(buildHighlights(beats[0]));
      setNoteDisplay(getNoteDisplayText(beats[0]));
    } else {
      setHighlights(new Map());
      setNoteDisplay('');
    }
  }, [beats]);

  const handleStepForward = useCallback(async () => {
    if (!beats) return;
    const ctx = initAudio();
    await resumeContext();

    const nextIdx = Math.min((playbackPos.current || currentBeatIdx) + 1, beats.length - 1);
    playbackPos.current = nextIdx;
    setCurrentBeatIdx(nextIdx);

    const beat = beats[nextIdx];
    const tf = tempoRef.current / 100;
    if (!beat.isRest) {
      for (const note of (beat.rightHand || [])) {
        const midi = getMidiNumber(note.note);
        if (midi) playNote(midi, beat.duration / tf, ctx.currentTime, 'right');
      }
      for (const note of (beat.leftHand || [])) {
        const midi = getMidiNumber(note.note);
        if (midi) playNote(midi, beat.duration / tf, ctx.currentTime, 'left');
      }
    }
    setHighlights(buildHighlights(beat));
    setNoteDisplay(getNoteDisplayText(beat));
  }, [beats, currentBeatIdx]);

  const handleStepBack = useCallback(async () => {
    if (!beats) return;
    const ctx = initAudio();
    await resumeContext();

    const prevIdx = Math.max((playbackPos.current || currentBeatIdx) - 1, 0);
    playbackPos.current = prevIdx;
    setCurrentBeatIdx(prevIdx);

    const beat = beats[prevIdx];
    const tf = tempoRef.current / 100;
    if (!beat.isRest) {
      for (const note of (beat.rightHand || [])) {
        const midi = getMidiNumber(note.note);
        if (midi) playNote(midi, beat.duration / tf, ctx.currentTime, 'right');
      }
      for (const note of (beat.leftHand || [])) {
        const midi = getMidiNumber(note.note);
        if (midi) playNote(midi, beat.duration / tf, ctx.currentTime, 'left');
      }
    }
    setHighlights(buildHighlights(beat));
    setNoteDisplay(getNoteDisplayText(beat));
  }, [beats, currentBeatIdx]);

  const handleSeek = useCallback(async (idx) => {
    if (!beats) return;
    clearAllTimeouts();
    stopAll();

    const ctx = initAudio();
    await resumeContext();

    const wasPlaying = isPlayingRef.current;
    isPlayingRef.current = false;
    setIsPlaying(false);
    setIsPaused(false);

    playbackPos.current = idx;
    setCurrentBeatIdx(idx);
    setHighlights(buildHighlights(beats[idx]));
    setNoteDisplay(getNoteDisplayText(beats[idx]));

    const elapsed = beats.slice(0, idx).reduce((acc, b) => acc + b.duration, 0) / (tempoRef.current / 100);
    setElapsedTime(elapsed);

    if (wasPlaying) {
      isPlayingRef.current = true;
      setIsPlaying(true);
      schedulePlayback(idx);
    }
  }, [beats]);

  const handleTempoChange = useCallback((val) => {
    setTempo(val);
    tempoRef.current = val;
    // Recalculate total time
    if (beats) {
      const total = beats.reduce((acc, b) => acc + b.duration, 0) / (val / 100);
      setTotalTime(total);
    }
    // If playing, reschedule
    if (isPlayingRef.current) {
      clearAllTimeouts();
      stopAll();
      isPlayingRef.current = true;
      schedulePlayback(playbackPos.current);
    }
  }, [beats]);

  const handleVolumeChange = useCallback((val) => {
    setVolume(val);
    setVolume(val);
    import('./audio/pianoEngine').then(m => m.setVolume(val / 100));
  }, []);

  const handleProgressClick = useCallback((e) => {
    if (!beats) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetTime = ratio * totalTime;

    let acc = 0;
    const tf = tempoRef.current / 100;
    let targetIdx = 0;
    for (let i = 0; i < beats.length; i++) {
      const dur = beats[i].duration / tf;
      if (acc + dur > targetTime) { targetIdx = i; break; }
      acc += dur;
      targetIdx = i;
    }
    handleSeek(targetIdx);
  }, [beats, totalTime, handleSeek]);

  const handleParsed = useCallback((parsedBeats, _sheetInfo) => {
    // _sheetInfo is displayed inside Uploader — no extra state needed here
    setBeats(parsedBeats);
    clearAllTimeouts();
    stopAll();
    isPlayingRef.current = false;
    setIsPlaying(false);
    setIsPaused(false);
    playbackPos.current = 0;
    setCurrentBeatIdx(0);
    setLoopA(null);
    setLoopB(null);
  }, []);

  const progressRatio = totalTime > 0 ? elapsedTime / totalTime : 0;

  const handleLibraryLoad = useCallback((loadedBeats, loadedSheetInfo, name, thumbnail) => {
    handleParsed(loadedBeats, loadedSheetInfo);
  }, []);

  return (
    <div className="app-shell">
      {/* Header */}
      <header className="header">
        <div className="header-wordmark">
          SEVERUS <strong>Tools</strong> — Piano
        </div>
        <div className="header-badge">Sheet Reader</div>
      </header>

      {/* The Anthropic API key lives server-side in the /api/parse-sheet
          serverless function. If it's missing, the server will return a
          clear 500 when the user clicks "Extract Notes via AI". */}

      <main className="main">
        {/* Top section: uploader */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Upload & Parse</span>
          </div>
          <Uploader onParsed={handleParsed} />
        </div>

        {/* Sheet Library */}
        <SheetLibrary onLoad={handleLibraryLoad} />

        {/* Note display */}
        <div className="note-display">
          <div className="note-display-notes">
            {noteDisplay || (beats ? '·' : 'Upload sheet music to begin')}
          </div>
          {beats && (
            <div className="note-display-beat">
              Beat {(currentBeatIdx + 1)} / {beats.length}
            </div>
          )}
        </div>

        {/* Progress bar */}
        {beats && (
          <div className="progress-section">
            <span className="progress-time">{formatTime(elapsedTime)}</span>
            <div
              className="progress-bar-container"
              onClick={handleProgressClick}
            >
              <div
                className="progress-bar-fill"
                style={{ width: `${progressRatio * 100}%` }}
              />
            </div>
            <span className="progress-time">{formatTime(totalTime)}</span>
          </div>
        )}

        {/* Controls */}
        <Controls
          beats={beats}
          isPlaying={isPlaying}
          isPaused={isPaused}
          tempo={tempo}
          volume={volume}
          loopOn={loopOn}
          loopA={loopA}
          loopB={loopB}
          onPlay={handlePlay}
          onPause={handlePause}
          onStop={handleStop}
          onStepForward={handleStepForward}
          onStepBack={handleStepBack}
          onTempoChange={handleTempoChange}
          onVolumeChange={handleVolumeChange}
          onSetLoopA={() => setLoopA(currentBeatIdx)}
          onSetLoopB={() => setLoopB(currentBeatIdx)}
          onToggleLoop={() => setLoopOn(v => !v)}
        />

        {/* Note strip */}
        {beats && (
          <NoteStrip
            beats={beats}
            currentBeat={currentBeatIdx}
            onSeek={handleSeek}
            loopA={loopA}
            loopB={loopB}
          />
        )}

        {/* Piano */}
        {beats ? (
          <Piano highlights={highlights} />
        ) : (
          <div className="piano-section">
            <Piano highlights={new Map()} />
          </div>
        )}
      </main>
    </div>
  );
}
