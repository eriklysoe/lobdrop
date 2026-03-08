import { useState, useRef, useEffect, useCallback } from 'react';

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default function UploadCard({ user, onLogout }) {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState({});
  const [smtpOk, setSmtpOk] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const inputRef = useRef();

  const [uploader, setUploader] = useState('');
  const [password, setPassword] = useState('');
  const [maxDownloads, setMaxDownloads] = useState('');
  const [expiryDays, setExpiryDays] = useState('7');
  const [emails, setEmails] = useState('');

  useEffect(() => {
    fetch('/api/smtp-status')
      .then(r => r.json())
      .then(d => setSmtpOk(d.configured))
      .catch(() => {});
  }, []);

  const addFiles = useCallback((newFiles) => {
    setFiles(prev => [...prev, ...Array.from(newFiles)]);
    setResults(null);
    setError('');
  }, []);

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  const handleUpload = async () => {
    if (!files.length) return;
    setUploading(true);
    setProgress(0);
    setError('');
    setResults(null);

    const formData = new FormData();
    files.forEach(f => formData.append('files', f));
    if (uploader) formData.append('uploader', uploader);
    if (password) formData.append('password', password);
    if (maxDownloads) formData.append('maxDownloads', maxDownloads);
    if (expiryDays) formData.append('expiryDays', expiryDays);
    if (emails && showEmail) formData.append('emails', emails);

    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
      };

      const result = await new Promise((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            const body = JSON.parse(xhr.responseText);
            reject(new Error(body.error || 'Upload failed'));
          }
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(formData);
      });

      setResults(result.files);
      setFiles([]);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const copyLink = (url, token) => {
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

  const resetForm = () => {
    setResults(null);
    setFiles([]);
    setError('');
    setProgress(0);
    setPassword('');
    setMaxDownloads('');
    setExpiryDays('7');
    setEmails('');
    setUploader('');
  };

  return (
    <div className="card">
      <div className="card-top">
        <a href="/" className="logo-link">
          <h1>Glidrop</h1>
        </a>
        {user && (
          <button className="logout-btn" onClick={onLogout} title="Sign out">
            {user} &middot; logout
          </button>
        )}
      </div>
      <p className="subtitle">Drop files, share links.</p>

      {!results ? (
        <>
          <div
            className={`dropzone${dragActive ? ' active' : ''}`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <p>Drag & drop files here or <span className="browse">browse</span></p>
            <input
              ref={inputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
            />
          </div>

          {files.length > 0 && (
            <div className="file-list">
              {files.map((f, i) => (
                <div key={i} className="file-item">
                  <span className="name">{f.name}</span>
                  <span className="size">{formatBytes(f.size)}</span>
                  <button className="remove" onClick={() => removeFile(i)}>&times;</button>
                </div>
              ))}
            </div>
          )}

          <div className="options">
            <div>
              <label>Your name (optional)</label>
              <input type="text" value={uploader} onChange={e => setUploader(e.target.value)} placeholder="Anonymous" />
            </div>

            <div className="option-row">
              <div>
                <label>Password (optional)</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="None" />
              </div>
              <div>
                <label>Max downloads</label>
                <input type="number" min="1" value={maxDownloads} onChange={e => setMaxDownloads(e.target.value)} placeholder="Unlimited" />
              </div>
            </div>

            <div>
              <label>Expiry (days)</label>
              <input type="number" min="1" max="365" value={expiryDays} onChange={e => setExpiryDays(e.target.value)} />
            </div>

            <div
              className={`toggle-row${showEmail ? ' on' : ''}`}
              onClick={() => setShowEmail(v => !v)}
            >
              <div className="toggle-switch" />
              <span>Email invite</span>
            </div>

            <div className={`email-section${showEmail ? ' open' : ''}`}>
              <label>Recipient emails (comma-separated)</label>
              <input type="text" value={emails} onChange={e => setEmails(e.target.value)} placeholder="alice@example.com, bob@example.com" />
              {!smtpOk && <p className="smtp-notice">Email not configured on this server</p>}
            </div>
          </div>

          {uploading && (
            <>
              <div className="progress-bar"><div className="fill" style={{ width: `${progress}%` }} /></div>
              <p className="progress-text">{progress}%</p>
            </>
          )}

          {error && <p className="dl-error" style={{ marginTop: 12 }}>{error}</p>}

          <button className="btn" disabled={!files.length || uploading} onClick={handleUpload}>
            {uploading ? 'Uploading...' : `Upload ${files.length || ''} file${files.length !== 1 ? 's' : ''}`}
          </button>
        </>
      ) : (
        <div className="results">
          <h2>Files uploaded!</h2>
          {results.map(f => (
            <div key={f.token} className="result-item">
              <span className="name">{f.name} ({f.size})</span>
              <button
                className={`copy-btn${copied[f.token] ? ' copied' : ''}`}
                onClick={() => copyLink(f.url, f.token)}
              >
                {copied[f.token] ? 'Copied!' : 'Copy link'}
              </button>
            </div>
          ))}
          <button className="btn btn-secondary" onClick={resetForm}>Upload more</button>
        </div>
      )}
    </div>
  );
}
