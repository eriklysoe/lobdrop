# Glidrop v1.0.1

A self-hosted file sharing app. Upload files, share via link or email invite. Simple, fast, Docker-ready.

## Changes in v1.0.1

- Fix Docker healthcheck failing on Alpine (use 127.0.0.1 instead of localhost to avoid IPv6 resolution issue)

## Quick Start

```bash
docker compose up -d
```

Open `http://localhost:3000` in your browser.

**Default login:** `admin` / `changeme` — change `ADMIN_PASS` and `SECRET_KEY` before exposing to the internet.

## Docker Hub

```
docker pull eriklysoe/glidrop:v1.0.1
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `BASE_URL` | `http://localhost:3000` | Public URL (used in generated links) |
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

When using a reverse proxy, set `BASE_URL=https://share.yourdomain.com` so generated share links use the correct public URL.
