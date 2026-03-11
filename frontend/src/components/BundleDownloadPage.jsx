import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';

function formatExpiry(dateStr) {
  const d = new Date(dateStr + 'Z');
  const now = new Date();
  const diff = d - now;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h left`;
  if (hours > 0) return `${hours}h left`;
  return 'Expiring soon';
}

export default function BundleDownloadPage() {
  const { token } = useParams();
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [passwords, setPasswords] = useState({});
  const [dlErrors, setDlErrors] = useState({});
  const [downloading, setDownloading] = useState({});
  const [zipping, setZipping] = useState(false);

  useEffect(() => {
    fetch(`/api/bundle/${token}`)
      .then(r => {
        if (!r.ok) return r.json().then(d => { throw new Error(d.error); });
        return r.json();
      })
      .then(setBundle)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const handleDownload = async (file) => {
    setDlErrors(prev => ({ ...prev, [file.token]: '' }));
    setDownloading(prev => ({ ...prev, [file.token]: true }));
    const pw = passwords[file.token] || '';
    const url = `/api/download/${file.token}${pw ? `?pw=${encodeURIComponent(pw)}` : ''}`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json();
        setDlErrors(prev => ({ ...prev, [file.token]: body.error || 'Download failed' }));
        return;
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch {
      setDlErrors(prev => ({ ...prev, [file.token]: 'Network error' }));
    } finally {
      setDownloading(prev => ({ ...prev, [file.token]: false }));
    }
  };

  const handleZipDownload = async () => {
    setZipping(true);
    try {
      const res = await fetch(`/api/bundle/${token}/zip`);
      if (!res.ok) {
        const body = await res.json();
        setError(body.error || 'ZIP download failed');
        return;
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `glidrop-bundle-${token}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch {
      setError('Network error');
    } finally {
      setZipping(false);
    }
  };

  if (loading) {
    return (
      <div className="card dl-card">
        <p style={{ color: 'var(--text-dim)' }}>Loading...</p>
      </div>
    );
  }

  if (error && !bundle) {
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

  const availableFiles = bundle.files.filter(f => !f.expired);
  const nonPwFiles = availableFiles.filter(f => !f.passwordProtected);
  const hasZippable = nonPwFiles.length > 0;

  return (
    <div className="card dl-card bundle-card">
      <svg className="file-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
      </svg>

      <h1>Shared files</h1>

      <div className="dl-info">
        <span>{bundle.files.length} file{bundle.files.length !== 1 ? 's' : ''}</span>
        {bundle.createdBy && <span>from {bundle.createdBy}</span>}
      </div>

      <div className="bundle-file-list">
        {bundle.files.map(f => (
          <div key={f.token} className={`bundle-file-item${f.expired ? ' expired' : ''}`}>
            <div className="bundle-file-info">
              <div className="bundle-file-name">{f.name}</div>
              <div className="bundle-file-meta">
                {f.sizeFormatted}
                {f.expired && ` \u00b7 ${f.reason}`}
                {!f.expired && ` \u00b7 ${formatExpiry(f.expiresAt)}`}
                {f.downloadsRemaining !== null && !f.expired && ` \u00b7 ${f.downloadsRemaining} dl left`}
                {f.passwordProtected && ' \u00b7 pw'}
              </div>
              {f.passwordProtected && !f.expired && (
                <div style={{ marginTop: 6 }}>
                  <input
                    type="password"
                    placeholder="Password"
                    value={passwords[f.token] || ''}
                    onChange={e => setPasswords(prev => ({ ...prev, [f.token]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && handleDownload(f)}
                    style={{ maxWidth: 180, padding: '6px 10px', fontSize: '0.8rem' }}
                  />
                </div>
              )}
              {dlErrors[f.token] && (
                <p style={{ color: 'var(--error)', fontSize: '0.8rem', marginTop: 4 }}>{dlErrors[f.token]}</p>
              )}
            </div>
            {!f.expired && (
              <button
                className="bundle-dl-btn"
                onClick={() => handleDownload(f)}
                disabled={downloading[f.token]}
              >
                {downloading[f.token] ? '...' : 'Download'}
              </button>
            )}
          </div>
        ))}
      </div>

      {error && <p className="dl-error">{error}</p>}

      {hasZippable && (
        <>
          <button className="btn" onClick={handleZipDownload} disabled={zipping}>
            {zipping ? 'Zipping...' : `Download all as ZIP (${nonPwFiles.length} file${nonPwFiles.length !== 1 ? 's' : ''})`}
          </button>
          {availableFiles.some(f => f.passwordProtected) && (
            <p style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginTop: 8, textAlign: 'center' }}>
              Password-protected files must be downloaded individually.
            </p>
          )}
        </>
      )}
    </div>
  );
}
