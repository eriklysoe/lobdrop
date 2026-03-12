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

No test suite or linter is configured.

## Architecture

**Backend** — single file `backend/server.js` (~600 lines). Express app with:
- SQLite via `better-sqlite3` (WAL mode, foreign keys ON)
- Four tables: `files`, `sessions`, `bundles`, `bundle_files`
- Multer for file uploads (stored as UUID filenames in `UPLOAD_DIR`)
- Session auth with HttpOnly cookies (30-day expiry)
- Rate limiting: 20 uploads/15min, 100 downloads/15min
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

- Each uploaded file gets a unique 10-char base64url token for its share URL
- Bundles group multiple file tokens under one bundle token
- File passwords are HMAC-SHA256 hashed with `SECRET_KEY`
- Frontend proxies API calls in dev mode via `vite.config.js`
- Docker entrypoint (`docker/entrypoint.sh`) handles PUID/PGID user mapping
- All config via environment variables (see `.env.example`)

## Docker Hub

Image: `eriklysoe/lobdrop` — push both `:vX.Y` and `:latest` tags.

