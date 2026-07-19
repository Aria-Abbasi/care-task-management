#!/usr/bin/env sh
set -eu

backup="${1:?Pass a .dump backup path}"
verification_url="${HAVEN_VERIFY_DATABASE_URL:?HAVEN_VERIFY_DATABASE_URL must point to an empty disposable database}"
sha256sum -c "$backup.sha256"
pg_restore --clean --if-exists --no-owner --dbname="$verification_url" "$backup"
psql "$verification_url" -v ON_ERROR_STOP=1 -c "SELECT COUNT(*) AS django_migrations FROM django_migrations;"
echo "Restore verification passed for $backup"
