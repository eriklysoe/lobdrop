#!/bin/bash
set -e

PUID=${PUID:-1000}
PGID=${PGID:-1000}

# Reuse existing group with this GID, or create 'abc'
EXISTING_GROUP=$(getent group "$PGID" | cut -d: -f1 || true)
if [ -z "$EXISTING_GROUP" ]; then
  addgroup -g "$PGID" abc
  GROUPNAME=abc
else
  GROUPNAME="$EXISTING_GROUP"
fi

# Reuse existing user with this UID, or create 'abc'
EXISTING_USER=$(getent passwd "$PUID" | cut -d: -f1 || true)
if [ -z "$EXISTING_USER" ]; then
  adduser -u "$PUID" -G "$GROUPNAME" -D -h /app abc
  USERNAME=abc
else
  USERNAME="$EXISTING_USER"
fi

mkdir -p /data/uploads /data/db
chown -R "$PUID:$PGID" /data /app

echo "Starting LobDrop as UID=$PUID GID=$PGID ($USERNAME:$GROUPNAME)"
exec su-exec "$USERNAME" node /app/backend/server.js
