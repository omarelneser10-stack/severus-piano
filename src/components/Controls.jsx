export default function Controls({
  beats,
  isPlaying,
  isPaused,
  tempo,
  volume,
  loopOn,
  loopA,
  loopB,
  onPlay,
  onPause,
  onStop,
  onStepForward,
  onStepBack,
  onTempoChange,
  onVolumeChange,
  onSetLoopA,
  onSetLoopB,
  onToggleLoop,
}) {
  const hasBeats = beats && beats.length > 0;

  return (
    <div className="controls-section">
      {/* Transport */}
      <div className="controls-row">
        <button
          className="btn"
          onClick={onStepBack}
          disabled={!hasBeats}
          title="Step back one beat"
        >
          ◀◀
        </button>

        {!isPlaying ? (
          <button
            className="btn btn-primary"
            onClick={onPlay}
            disabled={!hasBeats}
          >
            {isPaused ? '▶ Resume' : '▶ Play'}
          </button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={onPause}
          >
            ⏸ Pause
          </button>
        )}

        <button
          className="btn"
          onClick={onStop}
          disabled={!hasBeats}
          title="Stop and reset"
        >
          ■ Stop
        </button>

        <button
          className="btn"
          onClick={onStepForward}
          disabled={!hasBeats}
          title="Step forward one beat"
        >
          ▶▶
        </button>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Loop controls */}
        <button
          className={`btn${loopA !== null ? ' btn-active' : ''}`}
          onClick={onSetLoopA}
          disabled={!hasBeats}
          title="Set loop start point"
        >
          [A]
        </button>

        <button
          className={`btn${loopB !== null ? ' btn-active' : ''}`}
          onClick={onSetLoopB}
          disabled={!hasBeats}
          title="Set loop end point"
        >
          [B]
        </button>

        <button
          className={`btn${loopOn ? ' btn-active' : ''}`}
          onClick={onToggleLoop}
          disabled={!hasBeats}
        >
          Loop: {loopOn ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Sliders */}
      <div className="controls-row">
        <div className="slider-group">
          <span className="slider-label">
            Tempo — <span>{tempo}%</span>
          </span>
          <input
            type="range"
            min="25"
            max="200"
            value={tempo}
            onChange={e => onTempoChange(Number(e.target.value))}
          />
        </div>

        <div className="slider-group">
          <span className="slider-label">
            Volume — <span>{volume}%</span>
          </span>
          <input
            type="range"
            min="0"
            max="100"
            value={volume}
            onChange={e => onVolumeChange(Number(e.target.value))}
          />
        </div>
      </div>
    </div>
  );
}
