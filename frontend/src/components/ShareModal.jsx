import { useState, useEffect } from 'react';

export default function ShareModal({ selectedTokens, files, onClose, onDone }) {
  const [bundleUrl, setBundleUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [emails, setEmails] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [smtpOk, setSmtpOk] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/smtp-status').then(r => r.json()).then(d => setSmtpOk(d.configured)).catch(() => {});
  }, []);

  const selectedFiles = files.filter(f => selectedTokens.has(f.token));

  const createBundle = async () => {
    setCreating(true);
    setError('');
    try {
      const res = await fetch('/api/bundles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileTokens: Array.from(selectedTokens),
          emails: showEmail && emails ? emails : undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error);
      }
      const data = await res.json();
      setBundleUrl(data.url);
      if (showEmail && emails) setEmailSent(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const copyLink = () => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(bundleUrl);
    } else {
      const ta = document.createElement('textarea');
      ta.value = bundleUrl;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h2>Share {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''}</h2>

        <div className="modal-file-list">
          {selectedFiles.map(f => (
            <div key={f.token} className="modal-file-item">
              {f.name} <span style={{ color: 'var(--text-dim)', marginLeft: 8 }}>{f.sizeFormatted}</span>
            </div>
          ))}
        </div>

        {!bundleUrl && (
          <>
            <div
              className={`toggle-row${showEmail ? ' on' : ''}`}
              onClick={() => setShowEmail(!showEmail)}
            >
              <div className="toggle-switch" />
              <span>Email invite</span>
            </div>

            <div className={`email-section${showEmail ? ' open' : ''}`}>
              {smtpOk ? (
                <div style={{ marginTop: 8 }}>
                  <label>Recipient emails (comma separated)</label>
                  <input
                    type="text"
                    value={emails}
                    onChange={e => setEmails(e.target.value)}
                    placeholder="user@example.com"
                  />
                </div>
              ) : (
                <p className="smtp-notice">SMTP not configured on server</p>
              )}
            </div>

            {error && <p className="dl-error" style={{ marginTop: 12 }}>{error}</p>}

            <button className="btn" onClick={createBundle} disabled={creating}>
              {creating ? 'Creating...' : 'Create shared link'}
            </button>
          </>
        )}

        {bundleUrl && (
          <div style={{ marginTop: 8 }}>
            <div className="modal-url-row">
              <input type="text" value={bundleUrl} readOnly style={{ fontSize: '0.8rem' }} />
              <button
                className={`copy-btn${copied ? ' copied' : ''}`}
                onClick={copyLink}
                style={{ marginLeft: 8, padding: '10px 16px', borderRadius: 8, border: 'none', background: copied ? 'var(--success)' : 'var(--accent)', color: '#fff', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'var(--font)' }}
              >
                {copied ? 'Copied!' : 'Copy link'}
              </button>
            </div>
            {emailSent && (
              <p style={{ color: 'var(--success)', fontSize: '0.85rem', marginTop: 10 }}>
                Email sent!
              </p>
            )}
            <button className="btn btn-secondary" onClick={() => { onDone?.(); onClose(); }} style={{ marginTop: 12 }}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
