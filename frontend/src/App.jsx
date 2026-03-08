import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useState, useEffect } from 'react';
import UploadCard from './components/UploadCard';
import DownloadPage from './components/DownloadPage';
import LoginPage from './components/LoginPage';

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
              user ? <UploadCard user={user} onLogout={handleLogout} /> :
              <LoginPage onLogin={setUser} />
            } />
            <Route path="/d/:token" element={<DownloadPage />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  );
}
