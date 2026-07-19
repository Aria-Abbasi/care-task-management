#!/usr/bin/env sh
set -eu

BACKUP_DIR="${HAVEN_BACKUP_DIR:-./backups}"
RETENTION_DAYS="${HAVEN_BACKUP_RETENTION_DAYS:-30}"
mkdir -p "$BACKUP_DIR"
timestamp="$(date -u +%Y%m%d-%H%M%S)"
output="$BACKUP_DIR/haven-$timestamp.dump"

pg_dump "${HAVEN_DATABASE_URL:?HAVEN_DATABASE_URL is required}" --format=custom --file="$output"
sha256sum "$output" > "$output.sha256"
find "$BACKUP_DIR" -type f -name 'haven-*.dump*' -mtime "+$RETENTION_DAYS" -delete
echo "$output"
