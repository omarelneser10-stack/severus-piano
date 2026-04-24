import { useState, useEffect, useCallback } from 'react';

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function SheetLibrary({ onLoad }) {
  const [sheets, setSheets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [collapsed, setCollapsed] = useState(false);

  const fetchSheets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/cache-list');
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      setSheets(data.sheets || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSheets();
  }, [fetchSheets]);

  const handleLoad = async (sheet) => {
    try {
      const res = await fetch(`/api/cache-get?hash=${sheet.hash}`);
      if (!res.ok) throw new Error('Failed to load sheet');
      const data = await res.json();
      if (data.found && data.data) {
        onLoad(data.data.beats, data.data.sheetInfo, data.data.name, data.data.thumbnail);
      }
    } catch (err) {
      alert(`Could not load sheet: ${err.message}`);
    }
  };

  const handleDelete = async (e, hash) => {
    e.stopPropagation();
    if (!confirm('Remove this sheet from the library?')) return;
    setDeleting(hash);
    try {
      const res = await fetch(`/api/cache-delete?hash=${hash}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setSheets(prev => prev.filter(s => s.hash !== hash));
    } catch (err) {
      alert(`Could not delete: ${err.message}`);
    } finally {
      setDeleting(null);
    }
  };

  // Don't render the panel at all if the API routes aren't available (local dev without KV)
  if (error && error.includes('404')) return null;

  return (
    <div className="library-panel">
      <div className="library-header" onClick={() => setCollapsed(v => !v)}>
        <span className="panel-title">Sheet Library</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {sheets.length > 0 && (
            <span className="library-count">{sheets.length} saved</span>
          )}
          <span className="library-toggle">{collapsed ? '▼' : '▲'}</span>
        </div>
      </div>

      {!collapsed && (
        <div className="library-body">
          {loading && (
            <div className="library-empty">
              <div className="spinner" style={{ margin: '0 auto' }} />
            </div>
          )}

          {!loading && error && (
            <div className="library-empty" style={{ color: 'var(--red)' }}>
              Could not load library — {error}
            </div>
          )}

          {!loading && !error && sheets.length === 0 && (
            <div className="library-empty">
              No sheets saved yet. Parse a sheet and it will appear here automatically.
            </div>
          )}

          {!loading && !error && sheets.length > 0 && (
            <div className="library-grid">
              {sheets.map(sheet => (
                <div
                  key={sheet.hash}
                  className="library-card"
                  onClick={() => handleLoad(sheet)}
                  title="Click to load this sheet"
                >
                  {/* Thumbnail */}
                  <div className="library-thumb">
                    {sheet.thumbnail ? (
                      <img src={sheet.thumbnail} alt={sheet.name} />
                    ) : (
                      <div className="library-thumb-placeholder">𝄞</div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="library-info">
                    <div className="library-name">{sheet.name}</div>
                    <div className="library-meta">
                      {sheet.sheetInfo?.detectedStyle && (
                        <span className="library-tag">{sheet.sheetInfo.detectedStyle}</span>
                      )}
                      {sheet.sheetInfo?.keySignature && (
                        <span className="library-tag">{sheet.sheetInfo.keySignature}</span>
                      )}
                      {sheet.sheetInfo?.timeSignature && (
                        <span className="library-tag">{sheet.sheetInfo.timeSignature}</span>
                      )}
                    </div>
                    <div className="library-stats">
                      {sheet.beatCount} beats · {formatTime(sheet.totalDuration)} · {formatDate(sheet.savedAt)}
                    </div>
                  </div>

                  {/* Delete button */}
                  <button
                    className="library-delete"
                    onClick={(e) => handleDelete(e, sheet.hash)}
                    disabled={deleting === sheet.hash}
                    title="Remove from library"
                  >
                    {deleting === sheet.hash ? '…' : '×'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
