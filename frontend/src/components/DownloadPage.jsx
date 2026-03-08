import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';

export default function DownloadPage() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [dlError, setDlError] = useState('');

  useEffect(() => {
    fetch(`/api/file/${token}`)
      .then(r => {
        if (!r.ok) return r.json().then(d => { throw new Error(d.error); });
        return r.json();
      })
      .then(setInfo)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const handleDownload = async () => {
    setDlError('');
    const url = `/api/download/${token}${password ? `?pw=${encodeURIComponent(password)}` : ''}`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json();
        setDlError(body.error || 'Download failed');
        return;
      }

      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = info.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);

      // Refresh info to update remaining downloads
      fetch(`/api/file/${token}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setInfo(d); })
        .catch(() => {});
    } catch {
      setDlError('Network error');
    }
  };

  const formatExpiry = (dateStr) => {
    const d = new Date(dateStr + 'Z');
    const now = new Date();
    const diff = d - now;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ${hours % 24}h remaining`;
    if (hours > 0) return `${hours}h remaining`;
    return 'Expiring soon';
  };

  if (loading) {
    return (
      <div className="card dl-card">
        <p style={{ color: 'var(--text-dim)' }}>Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card dl-card">
        <svg className="file-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
        <h1 className="dl-expired">{error}</h1>
        <a href="/" className="btn btn-secondary" style={{ marginTop: 24, textDecoration: 'none', display: 'inline-flex' }}>Go to Glidrop</a>
      </div>
    );
  }

  return (
    <div className="card dl-card">
      <svg className="file-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>

      <h1>{info.name}</h1>

      <div className="dl-info">
        <span>{info.size}</span>
        {info.uploader && <span>from {info.uploader}</span>}
        <span>{formatExpiry(info.expiresAt)}</span>
      </div>

      {info.downloadsRemaining !== null && (
        <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: 16 }}>
          {info.downloadsRemaining} download{info.downloadsRemaining !== 1 ? 's' : ''} remaining
        </p>
      )}

      {info.passwordProtected && (
        <div className="dl-password">
          <label>This file is password protected</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Enter password"
            onKeyDown={e => e.key === 'Enter' && handleDownload()}
          />
        </div>
      )}

      {dlError && <p className="dl-error">{dlError}</p>}

      <button className="btn" onClick={handleDownload}>Download</button>
    </div>
  );
}
