import { useState, useEffect, useCallback } from 'react';

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function timeAgo(dateStr) {
  const now = new Date();
  const d = new Date(dateStr + 'Z');
  const diff = now - d;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function timeUntil(dateStr) {
  const now = new Date();
  const d = new Date(dateStr + 'Z');
  const diff = d - now;
  if (diff <= 0) return 'expired';
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h left`;
  const days = Math.floor(hours / 24);
  return `${days}d left`;
}

export default function FileManager() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState({});
  const [deleting, setDeleting] = useState({});

  const fetchFiles = useCallback(() => {
    setLoading(true);
    fetch('/api/files')
      .then(r => r.ok ? r.json() : Promise.reject('Failed to load'))
      .then(data => { setFiles(data.files); setError(''); })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  const copyLink = (token) => {
    const url = `${window.location.origin}/d/${token}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url);
    } else {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(prev => ({ ...prev, [token]: true }));
    setTimeout(() => setCopied(prev => ({ ...prev, [token]: false })), 2000);
  };

  const deleteFile = (token, name) => {
    if (!confirm(`Delete "${name}"?`)) return;
    setDeleting(prev => ({ ...prev, [token]: true }));
    fetch(`/api/files/${token}`, { method: 'DELETE' })
      .then(r => {
        if (!r.ok) throw new Error('Delete failed');
        setFiles(prev => prev.filter(f => f.token !== token));
      })
      .catch(() => setError('Failed to delete file'))
      .finally(() => setDeleting(prev => ({ ...prev, [token]: false })));
  };

  if (loading) return <p className="fm-status">Loading files...</p>;
  if (error) return <p className="dl-error">{error}</p>;
  if (!files.length) return <p className="fm-status">No files uploaded yet.</p>;

  return (
    <div className="fm-list">
      <p className="fm-count">{files.length} file{files.length !== 1 ? 's' : ''}</p>
      {files.map(f => (
        <div key={f.token} className={`fm-item${timeUntil(f.expiresAt) === 'expired' ? ' fm-expired' : ''}`}>
          <div className="fm-info">
            <span className="fm-name">{f.name}</span>
            <span className="fm-meta">
              {f.sizeFormatted}
              {f.uploader ? ` \u00b7 ${f.uploader}` : ''}
              {` \u00b7 ${timeAgo(f.createdAt)}`}
              {` \u00b7 ${timeUntil(f.expiresAt)}`}
              {` \u00b7 ${f.downloadCount}${f.maxDownloads ? '/' + f.maxDownloads : ''} dl`}
              {f.passwordProtected ? ' \u00b7 pw' : ''}
            </span>
          </div>
          <div className="fm-actions">
            <button
              className={`copy-btn${copied[f.token] ? ' copied' : ''}`}
              onClick={() => copyLink(f.token)}
            >
              {copied[f.token] ? 'Copied!' : 'Copy link'}
            </button>
            <button
              className="del-btn"
              onClick={() => deleteFile(f.token, f.name)}
              disabled={deleting[f.token]}
            >
              {deleting[f.token] ? '...' : 'Delete'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
