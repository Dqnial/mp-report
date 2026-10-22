# Развёртывание на сервер (VPS)

Схема на сервере: Docker → `db` (Postgres) + `redis` (очереди, лимит входа, кеш) + `backend` (NestJS) + `web` (Caddy: фронт, `/api`, HTTPS). Redis поднимается сам при выкладке — отдельно настраивать ничего не нужно; бэкенд работает и без него.

**Сервер ничего не собирает.** На каждый `git push` в `main` GitHub Actions (`.github/workflows/deploy.yml`) проверяет код (типы, линтер, тесты, сборка фронта), собирает образы под `amd64` и `arm64` в приватный реестр `ghcr.io` и по SSH обновляет сервер: копирует `docker-compose.prod.yml` и скрипты, скачивает образы, перезапускает, проверяет, что сайт отвечает. Поэтому хватает самого маленького сервера (1 ГБ памяти), а переезд между x86 и ARM не требует изменений.

Все команды ниже — для сервера (Ubuntu), если не сказано иное.

---

## 1. Сервер

Любой VPS с **Ubuntu 24.04**, от 1 ГБ памяти (x86 или ARM — образы собираются под оба), публичный IP.

- Подключение по SSH-ключу: `ssh ubuntu@<IP>` (на Windows ключ: `ssh-keygen -t ed25519`).
- Желательно **постоянный IP** (у многих провайдеров — «reserved/static IP»), иначе после пересоздания сервера адрес сменится.
- Открыть входящие **80 и 443** (TCP; UDP 443 — для HTTP/3, необязательно) — в панели провайдера (security group / firewall), если она есть.

Если в образе свой файрвол закрывает всё, кроме SSH (бывает в облачных образах Ubuntu), — открыть 80/443 и сохранить:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p udp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 2. Адрес (домен)

HTTPS-сертификат выдаётся на имя, не на IP. Варианты:

- **Бесплатно — DuckDNS**: <https://www.duckdns.org> → войти → создать поддомен, например `vizity-mp` → вписать IP сервера. Адрес: `vizity-mp.duckdns.org`.
- **Свой домен**: A-запись на IP сервера.

Проверка: `ping vizity-mp.duckdns.org` отвечает IP сервера.

## 3. Docker (и подкачка на 1 ГБ)

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && exit   # перелогиниться, чтобы docker работал без sudo
```

На сервере с 1 ГБ памяти — файл подкачки 2 ГБ, иначе Postgres + бэкенд могут не уместиться:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Код на сервер **не клонируется** — файлы развёртывания и образы привозит GitHub Actions.

## 4. Настройка и запуск

На сервере — только настройки (в git не попадают):

```bash
mkdir -p ~/mp-report/deploy && cd ~/mp-report/deploy
nano .env        # содержимое — по образцу deploy/.env.example
```

Заполнить:

```
DOMAIN=vizity-mp.duckdns.org
POSTGRES_PASSWORD=<openssl rand -hex 24>
JWT_ACCESS_SECRET=<openssl rand -hex 32>
BACKUP_REMOTE=                 # заполним в п. 6
```

**Подключить GitHub Actions** (GitHub → репозиторий → Settings → Secrets and variables → Actions):

| Где | Имя | Значение |
|---|---|---|
| Variables | `DEPLOY_HOST` | IP сервера |
| Variables | `DEPLOY_USER` | `ubuntu` |
| Secrets | `DEPLOY_SSH_KEY` | приватный ключ для выкладки целиком (файл `mp_deploy`, от `-----BEGIN` до `-----END…-----` включительно) |

Публичная половина этого ключа (`mp_deploy.pub`) — на сервере в `~/.ssh/authorized_keys`. Ключ отдельный от личного: отозвать доступ GitHub = удалить строку из `authorized_keys`.

**Первый запуск:** GitHub → Actions → *build-and-deploy* → *Run workflow* (или любой `git push` в `main`). Сборка образов в первый раз ~15–25 минут (дальше — кеш, быстрее), выкладка — минута. В конце шаг «проверка, что сайт отвечает».

Миграции базы применяются сами при каждом старте бэкенда. Сертификат Caddy получает сам за 10–30 секунд после первого старта.

Проверка: открыть `https://<DOMAIN>` — экран входа.

## 5. Первый пользователь (админ)

```bash
docker compose -f docker-compose.prod.yml exec backend \
  npm run -s user:create -- <логин> '<пароль от 8 символов>' "<Фамилия Имя>" --admin
```

Коллеги потом — через «Ещё» → «Пригласить коллегу» в приложении.

## 6. Резервные копии — обязательно

Без копий вне сервера поломка или удаление сервера = потеря всех визитов.

**Хранилище** (бесплатно 10 GB): Cloudflare R2 — <https://dash.cloudflare.com> → R2 → создать bucket `mp-report-backups` → *Manage API tokens* → токен с правом Object Read & Write на этот bucket (сохранить Access Key ID, Secret, endpoint вида `https://<account>.r2.cloudflarestorage.com`).

```bash
sudo -v ; curl https://rclone.org/install.sh | sudo bash
rclone config        # n → имя r2 → тип s3 → provider Cloudflare → ключи → endpoint → остальное по умолчанию
rclone lsd r2:       # должен показать mp-report-backups
```

В `deploy/.env`: `BACKUP_REMOTE=r2:mp-report-backups`

Каталог для копий и проверочный запуск:

```bash
sudo mkdir -p /var/backups/mp-report && sudo chown ubuntu /var/backups/mp-report
./backup.sh          # ok: /var/backups/mp-report/mp-report-….dump (…K)
rclone ls r2:mp-report-backups
```

Ежедневно ночью — например, в 03:00 по местному времени (UTC+5 → 22:00 UTC) (`crontab -e`):

```
0 22 * * * /home/ubuntu/mp-report/deploy/backup.sh >> /home/ubuntu/backup.log 2>&1
```

Хранение: 14 дней на сервере, 60 дней в R2. Скрипт проверяет, что копия читается (`pg_restore --list`).

**Восстановление** (заменяет текущие данные):

```bash
./restore.sh /var/backups/mp-report/mp-report-2026-10-20-0300.dump
# или из R2: rclone copy r2:mp-report-backups/<файл> /tmp/ && ./restore.sh /tmp/<файл>
```

## 7. Телефон

1. Chrome → `https://<DOMAIN>` → войти.
2. Меню «⋮» → **Установить приложение** → на рабочем столе появится «Визиты».
3. Проверить: шаблон из WhatsApp → «Поделиться» → «Визиты»; «Отправить отчёт» → WhatsApp.

## Обновление приложения

`git push` в `main` — остальное сделает GitHub Actions. Если проверки (тесты, типы) не прошли, на сервер ничего не уходит.

Телефоны подтянут новую версию сами при следующем открытии (сервис-воркер `autoUpdate`). Данные в базе и очередь на телефонах не теряются.

**Откат** на предыдущую версию: каждый образ помечен ещё и хешем коммита.

```bash
cd ~/mp-report/deploy
IMAGE_TAG=<хеш коммита> docker compose -f docker-compose.prod.yml up -d --no-build
```

(чтобы скачать приватный образ вручную, нужен `docker login ghcr.io` с токеном GitHub с правом `read:packages`)

## Полезное

```bash
docker compose -f docker-compose.prod.yml ps            # что запущено
docker compose -f docker-compose.prod.yml logs -f web   # Caddy: сертификат, запросы
docker compose -f docker-compose.prod.yml restart backend
```

Локальная проверка этой же конфигурации на Windows (со сборкой из исходников): в `deploy/.env` `DOMAIN=localhost`, `HTTP_PORT=8080`, `HTTPS_PORT=8443` → `docker compose -f docker-compose.prod.yml up -d --build` → `https://localhost:8443` (сертификат самоподписанный).
