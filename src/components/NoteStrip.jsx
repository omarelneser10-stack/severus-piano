import { useRef, useEffect } from 'react';

export default function NoteStrip({ beats, currentBeat, onSeek, loopA, loopB }) {
  const scrollRef = useRef();
  const tokenRefs = useRef({});

  // Auto-scroll to active token
  useEffect(() => {
    if (currentBeat === null || !scrollRef.current) return;
    const el = tokenRefs.current[currentBeat];
    if (!el) return;
    const container = scrollRef.current;
    const containerWidth = container.clientWidth;
    const tokenLeft = el.offsetLeft;
    const tokenWidth = el.offsetWidth;
    const targetScroll = tokenLeft - containerWidth / 2 + tokenWidth / 2;
    container.scrollTo({ left: targetScroll, behavior: 'smooth' });
  }, [currentBeat]);

  if (!beats || beats.length === 0) return null;

  return (
    <div className="note-strip-section">
      <div className="note-strip-scroll" ref={scrollRef}>
        <div className="note-strip">
          {beats.map((beat, idx) => {
            const isActive = idx === currentBeat;
            const isPlayed = currentBeat !== null && idx < currentBeat;
            const isLoopA = loopA === idx;
            const isLoopB = loopB === idx;

            const rhNotes = beat.rightHand?.map(n => n.note).join(' ') || '';
            const lhNotes = beat.leftHand?.map(n => n.note).join(' ') || '';

            // Fix 3: flag low-confidence notes
            const allNotes = [...(beat.rightHand || []), ...(beat.leftHand || [])];
            const hasLowConfidence = allNotes.some(
              n => n.confidence != null && n.confidence < 0.75
            );

            return (
              <div
                key={beat.beat}
                ref={el => tokenRefs.current[idx] = el}
                className={[
                  'beat-token',
                  isActive ? 'active' : '',
                  isPlayed ? 'played' : '',
                  hasLowConfidence ? 'uncertain' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => onSeek(idx)}
                title={hasLowConfidence
                  ? `Beat ${beat.beat} — some notes have low confidence, verify against sheet`
                  : `Beat ${beat.beat}`}
              >
                {isLoopA && <div className="loop-marker-a" />}
                {isLoopB && <div className="loop-marker-b" />}

                {/* Fix 3: low-confidence indicator */}
                {hasLowConfidence && (
                  <div style={{
                    position: 'absolute',
                    top: 2,
                    right: 3,
                    fontSize: '8px',
                    color: 'var(--accent)',
                    lineHeight: 1,
                    fontFamily: 'var(--font-mono)',
                  }}>?</div>
                )}

                <span className="beat-num">{beat.beat}</span>
                <div className="beat-notes">
                  {beat.isRest ? (
                    <span className="rest">rest</span>
                  ) : (
                    <>
                      {rhNotes && <div className="rh">{rhNotes}</div>}
                      {lhNotes && <div className="lh">{lhNotes}</div>}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
