# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LobDrop is a self-hosted file sharing application. Single Express backend serves both the API and the built React frontend. SQLite database, Docker deployment.

## Commands

### Backend (from `backend/`)
- `npm install` — install dependencies
- `npm start` — run production server
- `npm run dev` — run with `--watch` (auto-restart on changes)

### Frontend (from `frontend/`)
- `npm install` — install dependencies
- `npm run dev` — Vite dev server (proxies `/api` and `/healthz` to backend on port 3000)
- `npm run build` — production build to `frontend/dist/`

### Docker
- `docker compose up --build` — build and run
- `docker build -t eriklysoe/lobdrop:TAG .` — multi-stage build (frontend build + production image)

### Security verification
- `LOBDROP_URL=http://localhost:3000 ADMIN_PASS=<pass> node scripts/verify_security.js` — runtime security tests
- Results written to `results/security-verification.json`

No test suite or linter is configured.

## Architecture

**Backend** — single file `backend/server.js` (~700 lines). Express app with:
- SQLite via `better-sqlite3` (WAL mode, foreign keys ON)
- Four tables: `files`, `sessions`, `bundles`, `bundle_files`
- Multer for file uploads (stored as UUID filenames in `UPLOAD_DIR`)
- Session auth with HttpOnly/SameSite=Strict cookies (Secure when HTTPS), 30-day expiry, tokens hashed (SHA-256) in DB
- Rate limiting: login 10/15min, uploads 20/15min, downloads 100/hr, email 10/hr
- Hourly cleanup of expired files + orphaned bundles
- Optional SMTP via Nodemailer for email invites
- `archiver` for streaming ZIP bundles
- Serves `frontend/dist/` as static files with SPA fallback

**Frontend** — React 18 + React Router + Vite. All components in `frontend/src/components/`:
- `App.jsx` — router, auth state, tab switching between Upload/Files
- `UploadCard.jsx` — drag-and-drop upload with options (password, expiry, max downloads, email)
- `FileManager.jsx` — admin file list with select/share/delete
- `ShareModal.jsx` — create bundle link from selected files, optional email
- `DownloadPage.jsx` — public single-file download at `/d/:token`
- `BundleDownloadPage.jsx` — public bundle download at `/b/:token` with ZIP option
- `LoginPage.jsx` — admin login form

Styling is in `frontend/src/index.css` (CSS variables, no preprocessor).

## Key Patterns

- Each uploaded file gets a unique 32-char base64url token (24 random bytes) for its share URL
- Bundles group multiple file tokens under one bundle token
- File passwords are HMAC-SHA256 hashed with `SECRET_KEY`, compared via `timingSafeEqual`
- Uploaded filenames sanitised via `sanitiseFilename()` — stored on disk as UUID only
- HTML output in emails escaped via `escapeHtml()` to prevent XSS
- Session tokens hashed (SHA-256) before DB storage — DB dump does not expose valid sessions
- JSON body size limited to 1MB; bundle fileTokens capped at 100
- `trust proxy` only enabled when HTTPS or `TRUST_PROXY=true`
- Frontend proxies API calls in dev mode via `vite.config.js`
- Docker entrypoint (`docker/entrypoint.sh`) handles PUID/PGID user mapping
- All config via environment variables (see `.env.example`)

## Environment Variables

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `SECRET_KEY` | **Yes** | — | Min 32 chars, server refuses to start otherwise |
| `ADMIN_PASS` | **Yes** | — | Cannot be empty |
| `PORT` | No | `3000` | |
| `BASE_URL` | No | `http://localhost:3000` | Set to your public URL for correct share links |
| `CORS_ORIGIN` | No | `*` | Set to `BASE_URL` in production |
| `TRUST_PROXY` | No | `false` | Set `true` if behind reverse proxy without HTTPS in BASE_URL |
| `UPLOAD_DIR` | No | `data/uploads` | |
| `DB_PATH` | No | `data/db/lobdrop.db` | |
| `MAX_FILE_SIZE_MB` | No | `100` | |
| `FILE_EXPIRY_DAYS` | No | `7` | |
| `SMTP_HOST` | No | — | Enable email invites |
| `SMTP_PORT` | No | `587` | |
| `SMTP_USER` | No | — | |
| `SMTP_PASS` | No | — | |
| `SMTP_FROM` | No | — | |
| `SMTP_SECURE` | No | `false` | |
| `PUID` / `PGID` | No | `1000` | Docker user mapping |

## Docker Hub

Image: `eriklysoe/lobdrop` — push both `:vX.Y` and `:latest` tags.

## Security

See `SECURITY.md` for full details. Key rules for contributors:

### Security-sensitive areas
- `backend/server.js` — all auth, token generation, file handling, SMTP, and input validation
- `docker-compose.yml` — never hardcode secrets; use `${VAR}` references to `.env`
- `.env.example` — document required variables but never include real credentials
- `docker/entrypoint.sh` — privilege dropping; must always run Node as non-root

### Required practices
- **Any new API endpoint** must have a corresponding test in `scripts/verify_security.js` that confirms it returns 401/403 without auth
- **`npm audit`** must pass (`--audit-level=moderate`) before any release
- **`VITE_` prefix** is forbidden for any non-public configuration — anything with this prefix is bundled into client JS
- **Auth bypass whitelists** must use exact route matching — never substring, prefix, or suffix matching
- **SQL queries** must always use parameterised statements (`?` placeholders) — never string concatenation
- **Uploaded filenames** must be sanitised via `sanitiseFilename()` — files are stored on disk under UUID only
- **Password inputs** must be capped at 72 characters to prevent bcrypt/HMAC DoS
- **Error responses** must never include stack traces, file paths, or credential values
- **SMTP errors** must be logged server-side only — return generic "Email could not be sent" to client
- **Token generation** must use `crypto.randomBytes()` with minimum 24 bytes — never `Math.random()`
- **Session tokens** must be hashed via `hashSession()` before DB storage — never store raw tokens
- **HTML in emails** must use `escapeHtml()` for any user-supplied content (filenames, URLs)
- **Cookie flags** must use `COOKIE_FLAGS` constant — includes `Secure` automatically when HTTPS

### Breaking changes from security audit
- `SECRET_KEY` and `ADMIN_PASS` are now mandatory — server refuses to start without them
- Share tokens are now 32 chars (old 10-char tokens in existing DBs still work)
- Session tokens are hashed in DB — existing sessions invalidated on upgrade (users must re-login)
- `/api/smtp-status` now requires authentication
- `docker-compose.yml` reads secrets from `.env` file (no more hardcoded values)
