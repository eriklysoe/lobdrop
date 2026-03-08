import { BrowserRouter, Routes, Route } from 'react-router-dom';
import UploadCard from './components/UploadCard';
import DownloadPage from './components/DownloadPage';

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-bg">
        <div className="app-gradient" />
        <div className="app-content">
          <Routes>
            <Route path="/" element={<UploadCard />} />
            <Route path="/d/:token" element={<DownloadPage />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  );
}
