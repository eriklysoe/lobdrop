# ── Stage 1: Build frontend ──────────────────────────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Production ─────────────────────────────────────────────────────
FROM node:20-alpine
RUN apk add --no-cache su-exec shadow bash

WORKDIR /app

# Install backend dependencies
COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm install --omit=dev

# Copy backend source
COPY backend/ ./backend/

# Copy built frontend
COPY --from=frontend-build /build/dist ./frontend/dist

# Copy entrypoint
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Create data directories
RUN mkdir -p /data/uploads /data/db

ENV PORT=3000
ENV UPLOAD_DIR=/data/uploads
ENV DB_PATH=/data/db/glidrop.db

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

ENTRYPOINT ["/entrypoint.sh"]
