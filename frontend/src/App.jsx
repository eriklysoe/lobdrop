import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useState, useEffect } from 'react';
import UploadCard from './components/UploadCard';
import FileManager from './components/FileManager';
import DownloadPage from './components/DownloadPage';
import BundleDownloadPage from './components/BundleDownloadPage';
import LoginPage from './components/LoginPage';

function AdminPanel({ user, onLogout }) {
  const [tab, setTab] = useState('upload');

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

      <div className="tab-bar">
        <button className={`tab-btn${tab === 'upload' ? ' active' : ''}`} onClick={() => setTab('upload')}>
          Upload
        </button>
        <button className={`tab-btn${tab === 'files' ? ' active' : ''}`} onClick={() => setTab('files')}>
          Files
        </button>
      </div>

      {tab === 'upload' ? (
        <UploadCard user={user} onSwitchToFiles={() => setTab('files')} />
      ) : (
        <FileManager />
      )}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setUser(data.username); })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
  };

  return (
    <BrowserRouter>
      <div className="app-bg">
        <div className="app-gradient" />
        <div className="app-content">
          <Routes>
            <Route path="/" element={
              checking ? null :
              user ? <AdminPanel user={user} onLogout={handleLogout} /> :
              <LoginPage onLogin={setUser} />
            } />
            <Route path="/d/:token" element={<DownloadPage />} />
            <Route path="/b/:token" element={<BundleDownloadPage />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  );
}
