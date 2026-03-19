import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import Database from 'better-sqlite3';
import nodemailer from 'nodemailer';
import archiver from 'archiver';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'db', 'lobdrop.db');
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_MB || '100', 10) * 1024 * 1024;
const FILE_EXPIRY_DAYS = parseInt(process.env.FILE_EXPIRY_DAYS || '7', 10);
const SECRET_KEY = process.env.SECRET_KEY || 'change-me';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || '';

// ── Startup validation ─────────────────────────────────────────────────────
if (SECRET_KEY === 'change-me' || SECRET_KEY.length < 32) {
  console.error(
    'ERROR: SECRET_KEY must be set to a random string of at least 32 characters.\n' +
    'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
  process.exit(1);
}

if (!ADMIN_PASS) {
  console.error('ERROR: ADMIN_PASS must be set and cannot be empty.');
  process.exit(1);
}

if (CORS_ORIGIN === '*') {
  console.warn('WARNING: CORS_ORIGIN is set to "*" (wildcard). This allows any origin to make requests. Set CORS_ORIGIN to your BASE_URL in production.');
}

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || '';
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';

const smtpConfigured = !!(SMTP_HOST && SMTP_FROM);
const IS_HTTPS = BASE_URL.startsWith('https');
const COOKIE_FLAGS = `Path=/; HttpOnly; SameSite=Strict${IS_HTTPS ? '; Secure' : ''}`;

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

db.exec(`
  CREATE TABLE IF NOT EXISTS bundles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE NOT NULL,
    created_by TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS bundle_files (
    bundle_id INTEGER NOT NULL,
    file_token TEXT NOT NULL,
    PRIMARY KEY (bundle_id, file_token),
    FOREIGN KEY (bundle_id) REFERENCES bundles(id) ON DELETE CASCADE,
    FOREIGN KEY (file_token) REFERENCES files(token) ON DELETE CASCADE
  )
`);

// ── Helpers ─────────────────────────────────────────────────────────────────
function generateToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function hashPassword(plain) {
  return crypto.createHmac('sha256', SECRET_KEY).update(plain).digest('hex');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
  // Remove empty bundles (all their files were deleted or expired)
  db.prepare(`DELETE FROM bundles WHERE id NOT IN (SELECT DISTINCT bundle_id FROM bundle_files)`).run();
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
  try {
  await transporter.sendMail({
    from: SMTP_FROM,
    to,
    subject: `File shared with you: ${fileName}`,
    text: `A file has been shared with you.\n\nFile: ${fileName}\nDownload: ${downloadUrl}\n`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <h2 style="color:#7c3aed;">A file has been shared with you</h2>
        <p><strong>${escapeHtml(fileName)}</strong></p>
        <a href="${escapeHtml(downloadUrl)}" style="display:inline-block;padding:12px 24px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;margin-top:12px;">Download File</a>
      </div>
    `,
  });
  } catch (err) {
    console.error('SMTP send error:', err.message);
    // Never expose SMTP errors to the client — caller uses .catch(() => {})
  }
}

async function sendBundleEmail(to, fileNames, bundleUrl) {
  if (!transporter) return;
  try {
    const fileList = fileNames.map(n => `  - ${n}`).join('\n');
    const fileListHtml = fileNames.map(n => `<li>${escapeHtml(n)}</li>`).join('');
    await transporter.sendMail({
      from: SMTP_FROM,
      to,
      subject: `Files shared with you (${fileNames.length} file${fileNames.length !== 1 ? 's' : ''})`,
      text: `Files have been shared with you:\n\n${fileList}\n\nDownload: ${bundleUrl}\n`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
          <h2 style="color:#7c3aed;">Files shared with you</h2>
          <ul>${fileListHtml}</ul>
          <a href="${escapeHtml(bundleUrl)}" style="display:inline-block;padding:12px 24px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;margin-top:12px;">View &amp; Download</a>
        </div>
      `,
    });
  } catch (err) {
    console.error('SMTP send error:', err.message);
  }
}

// ── Express App ─────────────────────────────────────────────────────────────
const app = express();
// Only trust proxy headers if behind a reverse proxy (HTTPS or explicit env var)
if (IS_HTTPS || process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: IS_HTTPS ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: IS_HTTPS,
}));
app.use(cors({
  origin: CORS_ORIGIN,
  credentials: CORS_ORIGIN !== '*',
}));
app.use(express.json({ limit: '1mb' }));

// Rate limiters
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many uploads. Try again later.' },
});

const downloadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many downloads. Try again later.' },
});

const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many email requests. Try again later.' },
});

// Sanitise filename: strip path traversal components, keep only the base name
function sanitiseFilename(name) {
  // Remove path separators and traversal
  let safe = name.replace(/[/\\]/g, '_').replace(/\.\./g, '_');
  // Decode percent-encoded traversal
  safe = decodeURIComponent(safe).replace(/[/\\]/g, '_').replace(/\.\./g, '_');
  // Remove control characters and null bytes
  safe = safe.replace(/[\x00-\x1f\x7f]/g, '');
  // Fallback if empty
  return safe || 'unnamed';
}

// Multer storage — store under UUID only (no extension on disk)
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, _file, cb) => {
    cb(null, crypto.randomUUID());
  },
});
const upload = multer({ storage, limits: { fileSize: MAX_FILE_SIZE } });

// ── Auth helpers ────────────────────────────────────────────────────────────
const SESSION_DAYS = 30;

function generateSession() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashSession(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function requireAuth(req, res, next) {
  const token = req.cookies?.session;
  if (!token) return res.status(401).json({ error: 'Login required' });

  const session = db.prepare(
    `SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')`
  ).get(hashSession(token));

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

// SMTP status (requires auth — leaking SMTP config is an info disclosure risk)
app.get('/api/smtp-status', requireAuth, (_req, res) => res.json({ configured: smtpConfigured }));

// Auth: login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' },
});

app.post('/api/auth/login', loginLimiter, express.json(), (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Invalid credentials' });
  }

  // Enforce max 72 chars to prevent bcrypt DoS with very long inputs
  if (password.length > 72) {
    return res.status(400).json({ error: 'Invalid credentials' });
  }

  // Timing-safe comparison to prevent timing attacks
  // Hash both sides so timingSafeEqual always compares equal-length buffers
  const hashStr = (s) => crypto.createHash('sha256').update(s).digest();
  const userMatch = crypto.timingSafeEqual(hashStr(username), hashStr(ADMIN_USER));
  const passMatch = crypto.timingSafeEqual(hashStr(password), hashStr(ADMIN_PASS));

  if (!userMatch || !passMatch) {
    console.warn(`Failed login attempt from IP ${req.ip} at ${new Date().toISOString()}`);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = generateSession();
  db.prepare(
    `INSERT INTO sessions (token, username, expires_at) VALUES (?, ?, datetime('now', '+' || ? || ' days'))`
  ).run(hashSession(token), username, SESSION_DAYS);

  res.setHeader('Set-Cookie',
    `session=${token}; ${COOKIE_FLAGS}; Max-Age=${SESSION_DAYS * 86400}`
  );
  res.json({ username });
});

// Auth: check session
app.get('/api/auth/me', (req, res) => {
  const token = req.cookies?.session;
  if (!token) return res.status(401).json({ error: 'Not logged in' });

  const session = db.prepare(
    `SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')`
  ).get(hashSession(token));

  if (!session) return res.status(401).json({ error: 'Session expired' });
  res.json({ username: session.username });
});

// Auth: logout
app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies?.session;
  if (token) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(hashSession(token));
  }
  res.setHeader('Set-Cookie', `session=; ${COOKIE_FLAGS}; Max-Age=0`);
  res.json({ ok: true });
});

// Auth: logout all sessions (admin only)
app.post('/api/auth/logout-all', requireAuth, (_req, res) => {
  db.prepare('DELETE FROM sessions').run();
  res.setHeader('Set-Cookie', `session=; ${COOKIE_FLAGS}; Max-Age=0`);
  res.json({ ok: true, message: 'All sessions revoked' });
});

// Upload (requires auth)
app.post('/api/upload', requireAuth, uploadLimiter, upload.array('files', 50), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    const { password, maxDownloads, expiryDays, emails, uploader } = req.body;

    // Input validation
    const expiry = parseInt(expiryDays, 10) || FILE_EXPIRY_DAYS;
    if (expiry < 1 || expiry > 365) {
      return res.status(400).json({ error: 'Expiry days must be between 1 and 365' });
    }
    const maxDl = maxDownloads ? parseInt(maxDownloads, 10) : null;
    if (maxDl !== null && (maxDl < 1 || maxDl > 100000)) {
      return res.status(400).json({ error: 'Max downloads must be between 1 and 100000' });
    }
    if (password && password.length > 72) {
      return res.status(400).json({ error: 'Password must be 72 characters or fewer' });
    }
    // Validate email format if provided
    if (emails) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const recipients = emails.split(',').map(e => e.trim()).filter(Boolean);
      for (const addr of recipients) {
        if (!emailRegex.test(addr)) {
          return res.status(400).json({ error: `Invalid email address: ${addr}` });
        }
      }
    }
    const pwHash = password ? hashPassword(password) : null;

    const insertStmt = db.prepare(`
      INSERT INTO files (token, original_name, stored_name, size, uploader, password_hash, max_downloads, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+' || ? || ' days'))
    `);

    const results = [];

    for (const file of req.files) {
      const token = generateToken();
      const safeName = sanitiseFilename(file.originalname);
      insertStmt.run(token, safeName, file.filename, file.size, uploader || '', pwHash, maxDl, expiry);

      const shareUrl = `${BASE_URL}/d/${token}`;
      results.push({
        token,
        name: safeName,
        size: formatBytes(file.size),
        url: shareUrl,
      });

      // Send emails if configured and provided
      if (emails && smtpConfigured) {
        const recipients = emails.split(',').map(e => e.trim()).filter(Boolean);
        for (const to of recipients) {
          sendShareEmail(to, safeName, shareUrl).catch(() => {});
        }
      }
    }

    res.json({ files: results });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// List all files (admin only)
app.get('/api/files', requireAuth, (_req, res) => {
  const rows = db.prepare(
    `SELECT token, original_name, size, uploader, download_count, max_downloads,
            password_hash IS NOT NULL AS password_protected,
            expires_at, created_at
     FROM files ORDER BY created_at DESC`
  ).all();

  res.json({
    files: rows.map(r => ({
      token: r.token,
      name: r.original_name,
      size: r.size,
      sizeFormatted: formatBytes(r.size),
      uploader: r.uploader,
      downloadCount: r.download_count,
      maxDownloads: r.max_downloads,
      passwordProtected: !!r.password_protected,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
    })),
  });
});

// Delete file (admin only)
app.delete('/api/files/:token', requireAuth, (req, res) => {
  const file = db.prepare('SELECT stored_name FROM files WHERE token = ?').get(req.params.token);
  if (!file) return res.status(404).json({ error: 'File not found' });

  const filePath = path.join(UPLOAD_DIR, file.stored_name);
  try { fs.unlinkSync(filePath); } catch { /* already gone */ }
  db.prepare('DELETE FROM files WHERE token = ?').run(req.params.token);

  res.json({ ok: true });
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

  // Check password (timing-safe comparison)
  if (file.password_hash) {
    const pw = req.query.pw || '';
    const inputHash = Buffer.from(hashPassword(pw), 'hex');
    const storedHash = Buffer.from(file.password_hash, 'hex');
    if (inputHash.length !== storedHash.length || !crypto.timingSafeEqual(inputHash, storedHash)) {
      return res.status(403).json({ error: 'Incorrect password' });
    }
  }

  // Atomically increment download count and re-check limit in one statement
  const updated = db.prepare(
    `UPDATE files SET download_count = download_count + 1
     WHERE id = ? AND (max_downloads IS NULL OR download_count < max_downloads)`
  ).run(file.id);

  if (updated.changes === 0) {
    return res.status(410).json({ error: 'Download limit reached' });
  }

  const filePath = path.join(UPLOAD_DIR, file.stored_name);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File missing from storage' });
  }

  res.download(filePath, file.original_name);
});

// ── Bundles ─────────────────────────────────────────────────────────────────

// Create bundle (requires auth)
app.post('/api/bundles', requireAuth, emailLimiter, (req, res) => {
  try {
    const { fileTokens, emails } = req.body || {};
    if (!Array.isArray(fileTokens) || fileTokens.length === 0) {
      return res.status(400).json({ error: 'No files selected' });
    }
    if (fileTokens.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 files per bundle' });
    }

    // Validate email format if provided
    if (emails) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const recipients = emails.split(',').map(e => e.trim()).filter(Boolean);
      for (const addr of recipients) {
        if (!emailRegex.test(addr)) {
          return res.status(400).json({ error: `Invalid email address: ${addr}` });
        }
      }
    }

    // Validate all tokens exist and are not expired
    const validFiles = [];
    for (const ft of fileTokens) {
      const file = db.prepare(
        `SELECT token, original_name FROM files WHERE token = ? AND expires_at > datetime('now')`
      ).get(ft);
      if (file) validFiles.push(file);
    }

    if (validFiles.length === 0) {
      return res.status(400).json({ error: 'No valid files found' });
    }

    const bundleToken = generateToken();
    const insertBundle = db.prepare(
      `INSERT INTO bundles (token, created_by) VALUES (?, ?)`
    );
    const insertBundleFile = db.prepare(
      `INSERT INTO bundle_files (bundle_id, file_token) VALUES (?, ?)`
    );

    const result = insertBundle.run(bundleToken, req.user || '');
    for (const f of validFiles) {
      insertBundleFile.run(result.lastInsertRowid, f.token);
    }

    const bundleUrl = `${BASE_URL}/b/${bundleToken}`;

    // Send emails if configured and provided
    if (emails && smtpConfigured) {
      const recipients = emails.split(',').map(e => e.trim()).filter(Boolean);
      const fileNames = validFiles.map(f => f.original_name);
      for (const to of recipients) {
        sendBundleEmail(to, fileNames, bundleUrl).catch(() => {});
      }
    }

    res.json({ token: bundleToken, url: bundleUrl });
  } catch (err) {
    console.error('Bundle creation error:', err);
    res.status(500).json({ error: 'Failed to create bundle' });
  }
});

// Get bundle info (public)
app.get('/api/bundle/:token', (req, res) => {
  const bundle = db.prepare('SELECT * FROM bundles WHERE token = ?').get(req.params.token);
  if (!bundle) return res.status(404).json({ error: 'Bundle not found' });

  const files = db.prepare(`
    SELECT f.token, f.original_name, f.size, f.uploader,
           f.password_hash IS NOT NULL AS password_protected,
           f.download_count, f.max_downloads, f.expires_at
    FROM files f
    JOIN bundle_files bf ON bf.file_token = f.token
    WHERE bf.bundle_id = ?
    ORDER BY f.original_name
  `).all(bundle.id);

  const now = new Date();
  res.json({
    token: bundle.token,
    createdBy: bundle.created_by,
    createdAt: bundle.created_at,
    files: files.map(f => {
      const expiresAt = new Date(f.expires_at + 'Z');
      const expired = expiresAt < now;
      const limitReached = f.max_downloads && f.download_count >= f.max_downloads;
      return {
        token: f.token,
        name: f.original_name,
        size: f.size,
        sizeFormatted: formatBytes(f.size),
        uploader: f.uploader,
        passwordProtected: !!f.password_protected,
        downloadsRemaining: f.max_downloads ? f.max_downloads - f.download_count : null,
        expiresAt: f.expires_at,
        expired: expired || !!limitReached,
        reason: expired ? 'Expired' : limitReached ? 'Download limit reached' : null,
      };
    }),
  });
});

// Download bundle as ZIP (public)
app.get('/api/bundle/:token/zip', downloadLimiter, (req, res) => {
  const bundle = db.prepare('SELECT * FROM bundles WHERE token = ?').get(req.params.token);
  if (!bundle) return res.status(404).json({ error: 'Bundle not found' });

  const files = db.prepare(`
    SELECT f.* FROM files f
    JOIN bundle_files bf ON bf.file_token = f.token
    WHERE bf.bundle_id = ?
      AND f.expires_at > datetime('now')
      AND (f.max_downloads IS NULL OR f.download_count < f.max_downloads)
      AND f.password_hash IS NULL
  `).all(bundle.id);

  if (!files.length) {
    return res.status(410).json({ error: 'No downloadable files in bundle' });
  }

  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', `attachment; filename="lobdrop-bundle-${bundle.token}.zip"`);

  const archive = archiver('zip', { zlib: { level: 5 } });
  archive.on('error', (err) => {
    console.error('Archive error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'ZIP creation failed' });
  });
  archive.pipe(res);

  // Deduplicate filenames
  const usedNames = new Map();
  for (const f of files) {
    const filePath = path.join(UPLOAD_DIR, f.stored_name);
    if (!fs.existsSync(filePath)) continue;

    let name = f.original_name;
    const count = usedNames.get(name) || 0;
    if (count > 0) {
      const ext = path.extname(name);
      const base = name.slice(0, name.length - ext.length);
      name = `${base} (${count})${ext}`;
    }
    usedNames.set(f.original_name, count + 1);

    archive.file(filePath, { name });
    db.prepare(
      `UPDATE files SET download_count = download_count + 1
       WHERE id = ? AND (max_downloads IS NULL OR download_count < max_downloads)`
    ).run(f.id);
  }

  archive.finalize();
});

// ── Global error handler (never leak stack traces) ──────────────────────────
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
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
  console.log(`LobDrop running at ${BASE_URL} (port ${PORT})`);
});
