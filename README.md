# Glidrop

A self-hosted file sharing app. Upload files, share via link or email invite. Simple, fast, Docker-ready.

## Features

- Upload one or multiple files at once with drag-and-drop
- Login required to upload (keeps your instance private)
- Shareable download links stay public (no login needed for recipients)
- Optional email invites to recipients
- Optional password protection per upload
- Optional max download limit per file
- Configurable link expiry (default 7 days)
- Automatic cleanup of expired files
- Download page with file info, size, expiry countdown
- Rate limiting on uploads and downloads
- PUID/PGID support for Docker
- Works behind reverse proxies
- Health check endpoint at `/healthz`

## Quick Start with Docker Compose

```bash
git clone https://github.com/eriklysoe/glidrop.git
cd glidrop
docker compose up -d
```

Open `http://localhost:3000` in your browser.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `BASE_URL` | `http://localhost:3000` | Public URL (used in generated links) |
| `UPLOAD_DIR` | `/data/uploads` | File storage directory |
| `DB_PATH` | `/data/db/glidrop.db` | SQLite database path |
| `MAX_FILE_SIZE_MB` | `100` | Max upload size in MB |
| `FILE_EXPIRY_DAYS` | `7` | Default days until link expires |
| `SECRET_KEY` | `change-me` | Key for password hashing |
| `CORS_ORIGIN` | `*` | CORS allowed origins |
| `ADMIN_USER` | `admin` | Login username |
| `ADMIN_PASS` | _(empty)_ | Login password (**required**) |
| `PUID` | `1000` | Run as this user ID |
| `PGID` | `1000` | Run as this group ID |
| `SMTP_HOST` | _(empty)_ | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_USER` | _(empty)_ | SMTP username |
| `SMTP_PASS` | _(empty)_ | SMTP password |
| `SMTP_FROM` | _(empty)_ | From address for emails |
| `SMTP_SECURE` | `false` | Use TLS for SMTP |

When using a reverse proxy, set `BASE_URL=https://share.yourdomain.com` in your docker-compose environment so that generated share links use the correct public URL.

## Manual Build (without Docker)

```bash
# Install frontend dependencies and build
cd frontend
npm install
npm run build
cd ..

# Install backend dependencies
cd backend
npm install
cd ..

# Start the server
cd backend
node server.js
```

The frontend is built to `frontend/dist` and served by the Express backend.

Set environment variables before starting, or create a `.env` file (see `.env.example`).

## Tech Stack

- **Backend**: Node.js + Express
- **Frontend**: Vite + React
- **Database**: better-sqlite3
- **Email**: Nodemailer (optional SMTP)
- **Container**: Docker + Docker Compose
