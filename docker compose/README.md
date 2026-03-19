# LobDrop

A self-hosted file sharing app. Upload files, share via link or email invite. Supports multi-file bundles with ZIP download. Simple, fast, Docker-ready.

## Quick Start

1. Create a `.env` file next to `docker-compose.yml`:

```bash
SECRET_KEY=your-random-string-at-least-32-characters-long
ADMIN_PASS=your-secure-password
# BASE_URL=https://share.yourdomain.com
# CORS_ORIGIN=https://share.yourdomain.com
# TRUST_PROXY=true
```

Generate a secret key:
```bash
openssl rand -hex 32
```

2. Start the container:

```bash
docker compose up -d
```

Open `http://localhost:3000` in your browser.

**Default login:** `admin` / your `ADMIN_PASS` from `.env`

## Docker Hub

```
docker pull eriklysoe/lobdrop:v1.1
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SECRET_KEY` | **Yes** | — | Key for password/session hashing (min 32 chars) |
| `ADMIN_PASS` | **Yes** | — | Login password |
| `PORT` | No | `3000` | Server port |
| `BASE_URL` | No | `http://localhost:3000` | Public URL (used in share links) |
| `MAX_FILE_SIZE_MB` | No | `100` | Max upload size in MB |
| `FILE_EXPIRY_DAYS` | No | `7` | Default days until link expires |
| `CORS_ORIGIN` | No | `*` | CORS allowed origins (set to `BASE_URL` in production) |
| `TRUST_PROXY` | No | `false` | Set `true` if behind a reverse proxy without HTTPS in BASE_URL |
| `ADMIN_USER` | No | `admin` | Login username |
| `PUID` | No | `1000` | Run as this user ID |
| `PGID` | No | `1000` | Run as this group ID |
| `SMTP_HOST` | No | — | SMTP server hostname (enables email invites) |
| `SMTP_PORT` | No | `587` | SMTP server port |
| `SMTP_USER` | No | — | SMTP username |
| `SMTP_PASS` | No | — | SMTP password |
| `SMTP_FROM` | No | — | From address for emails |
| `SMTP_SECURE` | No | `false` | Use TLS for SMTP |

## Reverse Proxy

When behind a reverse proxy, set these in your `.env`:

```bash
BASE_URL=https://share.yourdomain.com
CORS_ORIGIN=https://share.yourdomain.com
TRUST_PROXY=true
```
