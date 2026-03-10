import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import Database from 'better-sqlite3';
import nodemailer from 'nodemailer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'db', 'glidrop.db');
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_MB || '100', 10) * 1024 * 1024;
const FILE_EXPIRY_DAYS = parseInt(process.env.FILE_EXPIRY_DAYS || '7', 10);
const SECRET_KEY = process.env.SECRET_KEY || 'change-me';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || '';

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || '';
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';

const smtpConfigured = !!(SMTP_HOST && SMTP_FROM);

// ── Ensure directories ─────────────────────────────────────────────────────
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// ── Database ────────────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    size INTEGER NOT NULL,
    uploader TEXT DEFAULT '',
    password_hash TEXT,
    max_downloads INTEGER,
    download_count INTEGER DEFAULT 0,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// ── Helpers ─────────────────────────────────────────────────────────────────
function generateToken() {
  return crypto.randomBytes(8).toString('base64url').slice(0, 10);
}

function hashPassword(plain) {
  return crypto.createHmac('sha256', SECRET_KEY).update(plain).digest('hex');
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ── Cleanup expired files ───────────────────────────────────────────────────
function cleanupExpired() {
  const rows = db.prepare(`SELECT stored_name FROM files WHERE expires_at < datetime('now')`).all();
  for (const row of rows) {
    const filePath = path.join(UPLOAD_DIR, row.stored_name);
    try { fs.unlinkSync(filePath); } catch { /* already gone */ }
  }
  db.prepare(`DELETE FROM files WHERE expires_at < datetime('now')`).run();
}

// Run cleanup every hour
cleanupExpired();
setInterval(cleanupExpired, 60 * 60 * 1000);

// ── Mailer ──────────────────────────────────────────────────────────────────
let transporter = null;
if (smtpConfigured) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
}

async function sendShareEmail(to, fileName, downloadUrl) {
  if (!transporter) return;
  await transporter.sendMail({
    from: SMTP_FROM,
    to,
    subject: `File shared with you: ${fileName}`,
    text: `A file has been shared with you.\n\nFile: ${fileName}\nDownload: ${downloadUrl}\n`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <h2 style="color:#7c3aed;">A file has been shared with you</h2>
        <p><strong>${fileName}</strong></p>
        <a href="${downloadUrl}" style="display:inline-block;padding:12px 24px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;margin-top:12px;">Download File</a>
      </div>
    `,
  });
}

// ── Express App ─────────────────────────────────────────────────────────────
const app = express();
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

// Rate limiters
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many uploads. Try again later.' },
});

const downloadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many downloads. Try again later.' },
});

// Multer storage
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => {
    const unique = crypto.randomUUID();
    const ext = path.extname(file.originalname);
    cb(null, unique + ext);
  },
});
const upload = multer({ storage, limits: { fileSize: MAX_FILE_SIZE } });

// ── Auth helpers ────────────────────────────────────────────────────────────
const SESSION_DAYS = 30;

function generateSession() {
  return crypto.randomBytes(32).toString('base64url');
}

function requireAuth(req, res, next) {
  const token = req.cookies?.session;
  if (!token) return res.status(401).json({ error: 'Login required' });

  const session = db.prepare(
    `SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')`
  ).get(token);

  if (!session) return res.status(401).json({ error: 'Session expired' });
  req.user = session.username;
  next();
}

// Cleanup expired sessions alongside files
const origCleanup = cleanupExpired;
cleanupExpired = function () {
  origCleanup();
  db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`).run();
};

// ── Cookie parser (minimal) ─────────────────────────────────────────────────
app.use((req, _res, next) => {
  req.cookies = {};
  const header = req.headers.cookie;
  if (header) {
    for (const pair of header.split(';')) {
      const [k, ...v] = pair.trim().split('=');
      if (k) req.cookies[k.trim()] = v.join('=').trim();
    }
  }
  next();
});

// ── Routes ──────────────────────────────────────────────────────────────────

// Health check
app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

// SMTP status
app.get('/api/smtp-status', (_req, res) => res.json({ configured: smtpConfigured }));

// Auth: login
app.post('/api/auth/login', express.json(), (req, res) => {
  const { username, password } = req.body || {};

  if (!ADMIN_PASS) {
    return res.status(500).json({ error: 'ADMIN_PASS not configured on server' });
  }

  if (username !== ADMIN_USER || password !== ADMIN_PASS) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = generateSession();
  db.prepare(
    `INSERT INTO sessions (token, username, expires_at) VALUES (?, ?, datetime('now', '+' || ? || ' days'))`
  ).run(token, username, SESSION_DAYS);

  res.setHeader('Set-Cookie',
    `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`
  );
  res.json({ username });
});

// Auth: check session
app.get('/api/auth/me', (req, res) => {
  const token = req.cookies?.session;
  if (!token) return res.status(401).json({ error: 'Not logged in' });

  const session = db.prepare(
    `SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')`
  ).get(token);

  if (!session) return res.status(401).json({ error: 'Session expired' });
  res.json({ username: session.username });
});

// Auth: logout
app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies?.session;
  if (token) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
  res.setHeader('Set-Cookie', 'session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
  res.json({ ok: true });
});

// Upload (requires auth)
app.post('/api/upload', requireAuth, uploadLimiter, upload.array('files', 50), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    const { password, maxDownloads, expiryDays, emails, uploader } = req.body;
    const expiry = parseInt(expiryDays, 10) || FILE_EXPIRY_DAYS;
    const maxDl = maxDownloads ? parseInt(maxDownloads, 10) : null;
    const pwHash = password ? hashPassword(password) : null;

    const insertStmt = db.prepare(`
      INSERT INTO files (token, original_name, stored_name, size, uploader, password_hash, max_downloads, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+' || ? || ' days'))
    `);

    const results = [];

    for (const file of req.files) {
      const token = generateToken();
      insertStmt.run(token, file.originalname, file.filename, file.size, uploader || '', pwHash, maxDl, expiry);

      const shareUrl = `${BASE_URL}/d/${token}`;
      results.push({
        token,
        name: file.originalname,
        size: formatBytes(file.size),
        url: shareUrl,
      });

      // Send emails if configured and provided
      if (emails && smtpConfigured) {
        const recipients = emails.split(',').map(e => e.trim()).filter(Boolean);
        for (const to of recipients) {
          sendShareEmail(to, file.originalname, shareUrl).catch(() => {});
        }
      }
    }

    res.json({ files: results });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// File info (for download page)
app.get('/api/file/:token', (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE token = ?').get(req.params.token);
  if (!file) return res.status(404).json({ error: 'File not found or expired' });

  const expiresAt = new Date(file.expires_at + 'Z');
  if (expiresAt < new Date()) {
    return res.status(410).json({ error: 'This file has expired' });
  }

  if (file.max_downloads && file.download_count >= file.max_downloads) {
    return res.status(410).json({ error: 'Download limit reached' });
  }

  res.json({
    name: file.original_name,
    size: formatBytes(file.size),
    uploader: file.uploader,
    expiresAt: file.expires_at,
    passwordProtected: !!file.password_hash,
    downloadsRemaining: file.max_downloads ? file.max_downloads - file.download_count : null,
  });
});

// Download
app.get('/api/download/:token', downloadLimiter, (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE token = ?').get(req.params.token);
  if (!file) return res.status(404).json({ error: 'File not found or expired' });

  const expiresAt = new Date(file.expires_at + 'Z');
  if (expiresAt < new Date()) {
    return res.status(410).json({ error: 'This file has expired' });
  }

  if (file.max_downloads && file.download_count >= file.max_downloads) {
    return res.status(410).json({ error: 'Download limit reached' });
  }

  // Check password
  if (file.password_hash) {
    const pw = req.query.pw || '';
    if (hashPassword(pw) !== file.password_hash) {
      return res.status(403).json({ error: 'Incorrect password' });
    }
  }

  // Increment download count
  db.prepare('UPDATE files SET download_count = download_count + 1 WHERE id = ?').run(file.id);

  const filePath = path.join(UPLOAD_DIR, file.stored_name);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File missing from storage' });
  }

  res.download(filePath, file.original_name);
});

// ── Serve frontend (production) ─────────────────────────────────────────────
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// ── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Glidrop running at ${BASE_URL} (port ${PORT})`);
});
