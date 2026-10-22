#!/usr/bin/env bash
# Резервная копия базы. Запускается cron'ом раз в сутки (см. deploy/README.md).
# Копия проверяется (pg_restore --list), хранится 14 дней на сервере и,
# если задан BACKUP_REMOTE, копируется вне сервера через rclone (60 дней).
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; set +a

DIR="${BACKUP_DIR:-/var/backups/mp-report}"
mkdir -p "$DIR"
FILE="$DIR/mp-report-$(date +%F-%H%M).dump"
COMPOSE="docker compose -f docker-compose.prod.yml"

$COMPOSE exec -T db pg_dump -U "$POSTGRES_USER" -d "${POSTGRES_DB:-mp_report}" -Fc > "$FILE"

# пустой или битый файл — это не копия
test -s "$FILE"
$COMPOSE exec -T db pg_restore --list < "$FILE" > /dev/null

find "$DIR" -name 'mp-report-*.dump' -mtime +14 -delete

if [ -n "${BACKUP_REMOTE:-}" ]; then
  rclone copy "$FILE" "$BACKUP_REMOTE"
  rclone delete --min-age 60d "$BACKUP_REMOTE"
fi

echo "ok: $FILE ($(du -h "$FILE" | cut -f1))"
