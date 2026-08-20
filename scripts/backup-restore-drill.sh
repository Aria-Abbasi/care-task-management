#!/usr/bin/env sh
set -eu

artifact="${1:-/tmp/haven-restore-drill.dump}"
restore_db="haven_restore_drill"

# Wait for PostgreSQL to be ready to accept connections
retries=30
until docker compose exec -T db pg_isready -U haven >/dev/null 2>&1 || [ "$retries" -le 0 ]; do
  retries=$((retries - 1))
  sleep 1
done

docker compose exec -T db psql -U haven -d haven -v ON_ERROR_STOP=1 -c "CREATE TABLE IF NOT EXISTS haven_backup_drill (marker integer NOT NULL); TRUNCATE haven_backup_drill; INSERT INTO haven_backup_drill VALUES (1);" >/dev/null
docker compose exec -T db pg_dump -U haven -Fc haven > "$artifact"
test -s "$artifact"
docker compose exec -T db dropdb -U haven --if-exists "$restore_db"
docker compose exec -T db createdb -U haven "$restore_db"
docker compose exec -T db pg_restore -U haven -d "$restore_db" --no-owner < "$artifact"
count="$(docker compose exec -T db psql -U haven -d "$restore_db" -Atc 'SELECT COUNT(*) FROM haven_backup_drill')"
test "$count" -gt 0
docker compose exec -T db dropdb -U haven "$restore_db"
rm -f "$artifact"
echo "Backup/restore drill passed with $count verified marker."
