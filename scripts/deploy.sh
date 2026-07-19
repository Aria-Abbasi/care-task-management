#!/usr/bin/env sh
set -eu

previous_api="$(docker image inspect --format '{{.Id}}' haven-api:latest 2>/dev/null || true)"
previous_web="$(docker image inspect --format '{{.Id}}' haven-web:latest 2>/dev/null || true)"
[ -n "$previous_api" ] && docker image tag "$previous_api" haven-api:rollback
[ -n "$previous_web" ] && docker image tag "$previous_web" haven-web:rollback

if [ -n "${HAVEN_DATABASE_URL:-}" ]; then
  "$(dirname "$0")/backup.sh" >/dev/null
fi

docker compose build api web
docker compose up -d --remove-orphans

attempt=0
until curl --fail --silent http://127.0.0.1:8080/health/ready/ >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 40 ]; then
    echo "Deployment health check failed; restoring previous images." >&2
    [ -n "$previous_api" ] && docker image tag haven-api:rollback haven-api:latest
    [ -n "$previous_web" ] && docker image tag haven-web:rollback haven-web:latest
    docker compose up -d --no-build
    exit 1
  fi
  sleep 3
done

docker compose exec -T api python manage.py check --deploy
echo "Deployment healthy."
