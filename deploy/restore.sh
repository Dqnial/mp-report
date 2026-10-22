#!/usr/bin/env bash
# Восстановление базы из копии: ./restore.sh /var/backups/mp-report/mp-report-2026-10-20-0300.dump
# ВНИМАНИЕ: текущие данные в базе заменяются данными из копии.
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; set +a

FILE="${1:?укажите файл копии}"
COMPOSE="docker compose -f docker-compose.prod.yml"

read -r -p "Заменить данные в базе копией $FILE? (да/нет) " answer
[ "$answer" = "да" ] || { echo "отменено"; exit 1; }

$COMPOSE stop backend
$COMPOSE exec -T db pg_restore -U "$POSTGRES_USER" -d "${POSTGRES_DB:-mp_report}" \
  --clean --if-exists --no-owner < "$FILE"
$COMPOSE start backend
echo "восстановлено из $FILE"
