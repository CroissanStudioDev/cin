# CIN CLI — Product Requirements Document

## 1. Executive Summary

### Проблема

Студия разрабатывает ПО для корпоративных клиентов с закрытыми (airgapped) контурами. Код хостится на GitHub, а клиенты должны самостоятельно получать обновления и разворачивать их в своих закрытых сетях.

Текущий процесс доставки кода:

- Ручной, подверженный ошибкам
- Требует много времени на упаковку зависимостей и Docker images
- Отсутствует версионирование и аудит доставок
- Клиенты не имеют удобного инструмента для получения обновлений

### Участники процесса

| Сторона | Роль | Инфраструктура |
|---------|------|----------------|
| **Студия** | Разработка, хостинг кода на GitHub | GitHub + Deploy Keys |
| **Заказчик (лаборатория)** | Получение кода, сборка, упаковка | Сеть с интернетом |
| **Заказчик (закрытый контур)** | Развёртывание и эксплуатация | Изолированная сеть |

### Решение

**CIN CLI** — инструмент для заказчиков, автоматизирующий получение и развёртывание кода от студии:

1. **Pull** — получение кода из GitHub студии (в лаборатории заказчика)
2. **Build** — сборка Docker images (в лаборатории заказчика)
3. **Pack** — создание оффлайн-пакета для переноса (в лаборатории заказчика)
4. **Deploy** — развёртывание в закрытом контуре (без интернета)

### Критерии успеха

| Метрика | Текущее | Цель |
|---------|---------|------|
| Время на подготовку пакета | 2-4 часа (ручной процесс) | < 15 минут |
| Ошибки при переносе | Частые (забытые зависимости, images) | 0 |
| Время на развёртывание | 1-2 часа | < 10 минут |
| Аудит доставок | Отсутствует | 100% трекинг |

---

## 2. Архитектура системы

### Общая схема

```
┌─────────────────────────────────────────────────────────────────┐
│                          СТУДИЯ                                 │
│                      (разработчик)                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                        GitHub                             │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │  │
│  │  │  backend    │  │  frontend   │  │  services   │       │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                    Deploy Keys (SSH)                            │
│                    выдаются заказчикам                          │
│                              │                                  │
└──────────────────────────────┼──────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                   ЛАБОРАТОРИЯ ЗАКАЗЧИКА                          │
│                     (с интернетом)                               │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐    SSH Keys    ┌──────────┐                       │
│  │  GitHub  │◄──────────────►│ cin │                       │
│  │  студии  │                │   pull   │                       │
│  └──────────┘                └────┬─────┘                       │
│                                   │                             │
│                                   ▼                             │
│                          ┌───────────────┐                      │
│                          │ Local Repos   │                      │
│                          └───────┬───────┘                      │
│                                  │                              │
│                                  ▼                              │
│                          ┌───────────────┐                      │
│                          │   cin    │                      │
│                          │     build     │                      │
│                          │ (docker-compose build)               │
│                          └───────┬───────┘                      │
│                                  │                              │
│                                  ▼                              │
│                          ┌───────────────┐                      │
│                          │   cin    │                      │
│                          │     pack      │                      │
│                          │ (docker save) │                      │
│                          └───────┬───────┘                      │
│                                  │                              │
│                                  ▼                              │
│                          ┌───────────────┐                      │
│                          │  package.tar  │                      │
│                          │  + manifest   │                      │
│                          │  + images.tar │                      │
│                          └───────┬───────┘                      │
│                                  │                              │
└──────────────────────────────────┼──────────────────────────────┘
                                   │
                            ┌──────┴──────┐
                            │   USB/NAS   │
                            └──────┬──────┘
                                   │
┌──────────────────────────────────┼──────────────────────────────┐
│               ЗАКРЫТЫЙ КОНТУР ЗАКАЗЧИКА                         │
│                    (без интернета)                              │
├──────────────────────────────────┼──────────────────────────────┤
│                                  │                              │
│                                  ▼                              │
│                          ┌───────────────┐                      │
│                          │   cin    │                      │
│                          │    deploy     │                      │
│                          │ (docker load) │                      │
│                          └───────┬───────┘                      │
│                                  │                              │
│                                  ▼                              │
│                          ┌───────────────┐                      │
│                          │ docker-compose│                      │
│                          │      up       │                      │
│                          └───────────────┘                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Технический стек

| Компонент | Технология | Обоснование |
|-----------|------------|-------------|
| Runtime | Node.js 20 LTS | Нативно работает везде, простота |
| CLI Framework | Commander.js | 225M+ загрузок/неделю, простой API |
| Конфигурация | YAML | Читаемый, удобный для редактирования |
| Git операции | simple-git | Обёртка над git CLI |
| Docker операции | dockerode / shell | Работа с docker и docker-compose |
| Архивация | tar + gzip | Нативная поддержка |
| Checksums | crypto (встроенный) | SHA256 верификация |

---

## 3. User Experience & Functionality

### Пользовательские персоны

| Персона | Сторона | Описание | Контекст использования |
|---------|---------|----------|------------------------|
| **Владелец студии** | Студия | Выдаёт deploy keys заказчикам | GitHub Settings |
| **Инженер заказчика (лаборатория)** | Заказчик | Работает в лаборатории с интернетом | Pull, Build, Pack |
| **Инженер заказчика (контур)** | Заказчик | Работает в закрытом контуре | Deploy |

### User Stories

#### US-1: Инициализация проекта

> Как инженер заказчика, я хочу быстро настроить CLI для получения ПО от студии.

**Acceptance Criteria:**
- `cin init` создаёт `.cin/config.yaml`
- Интерактивные prompts для базовой настройки
- Поддержка `--yes` для автоматических defaults

#### US-2: Добавление репозитория студии

> Как инженер заказчика, я хочу добавить репозиторий студии, к которому мне выдали доступ.

**Acceptance Criteria:**
- `cin repo add <url> --key <path>` добавляет репозиторий
- Использует deploy key, полученный от студии
- Автоматическое определение docker-compose.yml
- Валидация SSH ключа при добавлении

#### US-3: Получение обновлений от студии

> Как инженер заказчика в лаборатории, я хочу получить последние обновления кода от студии.

**Acceptance Criteria:**
- `cin pull` обновляет все репозитории из GitHub студии
- Автоматическое обновление git submodules (`--recurse-submodules`)
- Вывод changelog (новые коммиты)
- Сохранение версий в манифест

#### US-3.1: Поддержка Git Submodules

> Как инженер заказчика, я хочу получать репозитории с submodules, чтобы все зависимости кода были включены.

**Acceptance Criteria:**
- `cin pull` автоматически инициализирует и обновляет submodules
- Поддержка вложенных submodules (recursive)
- Submodules могут использовать отдельные SSH ключи (если доступ к разным репо)
- `cin repo add --submodules` включает обработку submodules (по умолчанию: true)
- `cin repo add --submodules-keys <mapping>` задаёт SSH ключи для submodules
- `cin pack` включает все submodules в git bundle
- `cin status` показывает состояние submodules

#### US-4: Сборка Docker images

> Как инженер заказчика в лаборатории, я хочу собрать Docker images из полученного кода.

**Acceptance Criteria:**
- `cin build` запускает `docker-compose build` для всех репозиториев
- Поддержка build args из конфигурации
- Параллельная сборка где возможно

#### US-5: Упаковка оффлайн-пакета

> Как инженер заказчика в лаборатории, я хочу создать пакет для переноса в закрытый контур.

**Acceptance Criteria:**
- `cin pack` создаёт архив
- Включает: исходники (git bundle), Docker images, docker-compose.yml
- Генерирует manifest.json с checksums
- Готов к переносу на USB/NAS

#### US-6: Развёртывание в закрытом контуре

> Как инженер заказчика в закрытом контуре, я хочу развернуть пакет без интернета.

**Acceptance Criteria:**
- `cin deploy <package>` распаковывает и запускает
- Верификация checksum перед распаковкой
- `docker load` для загрузки images
- `docker-compose up -d` для запуска

#### US-7: Управление конфигурациями для разных продуктов

> Как инженер заказчика, я хочу хранить конфигурации для разных продуктов студии отдельно.

**Acceptance Criteria:**
- Поддержка нескольких конфигураций в одной системе
- `cin --config <path>` для указания конфигурации
- Каждая конфигурация содержит свой набор репозиториев и ключей

#### US-8: Откат при неудачном обновлении (Rollback)

> Как инженер заказчика в закрытом контуре, я хочу безопасно откатиться к предыдущей версии, если обновление не работает.

**Acceptance Criteria:**
- `cin deploy` автоматически создаёт backup текущей версии перед обновлением
- `cin rollback` откатывает к предыдущей версии
- `cin rollback --list` показывает доступные версии для отката
- Хранение N последних версий (настраивается)
- Откат восстанавливает: Docker images, docker-compose.yml, volumes (опционально)

#### US-9: Идемпотентность операций

> Как инженер заказчика, я хочу безопасно повторять команды без побочных эффектов.

**Acceptance Criteria:**
- Повторный `cin pull` — пропускает, если нет новых коммитов
- Повторный `cin build` — использует Docker cache, пересобирает только изменённое
- Повторный `cin deploy` — проверяет текущую версию, пропускает если уже развёрнуто
- Все операции выводят понятный статус: `[SKIP]`, `[UPDATE]`, `[NEW]`

#### US-10: Управление секретами

> Как инженер заказчика, я хочу безопасно настроить секреты (API keys, пароли, сертификаты) для приложения.

**Acceptance Criteria:**
- Два режима настройки секретов:
  - **Интерактивный**: `cin secrets setup` — пошаговый wizard
  - **Файловый**: `cin secrets import <file>` — импорт из .env или secrets.yaml
- `cin secrets list` — показывает какие секреты настроены (без значений)
- `cin secrets check` — проверяет, все ли необходимые секреты заполнены
- CLI определяет необходимые секреты из docker-compose.yml (переменные без значений)
- Секреты хранятся локально в зашифрованном виде или в системном keychain
- При `cin deploy` секреты автоматически подставляются в .env

#### US-11: Сбор логов для диагностики

> Как инженер заказчика, я хочу собрать все логи в один файл, чтобы отправить студии для диагностики проблемы.

**Acceptance Criteria:**
- `cin logs collect` собирает все логи в архив
- Включает: docker-compose logs, системные логи CIN, manifest текущей версии
- `cin logs collect --days 3` — логи за последние N дней
- Автоматически убирает секреты из логов (sanitize)
- Формат: `cin-logs-2026-03-07.tar.gz`
- Архив можно безопасно отправить студии (без секретов, credentials)

#### US-12: Хуки и автоматизации

> Как инженер заказчика, я хочу автоматически запускать миграции и другие задачи при deploy.

**Acceptance Criteria:**
- Хуки определяются в конфигурации (`hooks.yaml` или в `config.yaml`)
- Поддержка lifecycle хуков:
  - `pre-deploy` — до остановки старой версии (миграции, backup данных)
  - `post-deploy` — после запуска новой версии (healthcheck, уведомления)
  - `pre-rollback` / `post-rollback` — при откате
- `cin run <task>` — ручной запуск задачи
- `cin run <task> --sudo` — запуск от администратора
- Задачи могут быть shell-командами или docker exec
- `cin tasks list` — список доступных задач
- Логирование выполнения задач

#### US-13: Конфигурируемые задачи (Tasks)

> Как инженер заказчика, я хочу определить повторяемые задачи в конфигурации.

**Acceptance Criteria:**
- Задачи определяются в `tasks.yaml` или в `config.yaml`
- Поддержка параметров: `cin run migrate --env production`
- Условное выполнение: только если сервис запущен
- Таймауты и retry логика
- Интерактивные задачи (например, подтверждение перед опасными операциями)

### Non-Goals (v1.0)

- Web-интерфейс для управления
- Автоматическая синхронизация между контурами
- Поддержка GitLab/Bitbucket (только GitHub)
- Шифрование пакетов
- Инкрементальные delta-обновления

---

## 4. CLI Interface

### Полный список команд

```bash
# Инициализация
cin init                              # Создать .cin/ в текущей папке
cin init --global                     # Создать ~/.cin/

# Управление репозиториями (от студии)
cin repo add <url> [options]          # Добавить репозиторий студии
  --name <name>                            # Имя репозитория
  --key <path|name>                        # SSH deploy key (путь или имя из конфига)
  --branch <branch>                        # Ветка (default: main)
  --compose <file>                         # docker-compose файл
  --submodules                             # Включить обработку submodules (default: true)
  --no-submodules                          # Отключить submodules
  --submodules-keys <json>                 # SSH ключи для submodules: '{"lib":"key-name"}'

cin repo remove <name>                # Удалить репозиторий
cin repo list                         # Список репозиториев

# Управление SSH ключами
cin key add <name> <path>             # Добавить SSH ключ в глобальный конфиг
cin key remove <name>                 # Удалить SSH ключ
cin key list                          # Список ключей

# Основные операции (в лаборатории)
cin pull [options]                    # Получить обновления от студии
  --repo <name>                            # Конкретный репозиторий
  --all                                    # Все репозитории (default)
  --no-submodules                          # Не обновлять submodules

cin build [options]                   # Собрать Docker images
  --repo <name>                            # Конкретный репозиторий
  --no-cache                               # Без кэша Docker

cin pack [options]                    # Создать оффлайн-пакет
  --output <path>                          # Путь для сохранения
  --format <tar.gz|zip>                    # Формат архива (default: tar.gz)
  --name <name>                            # Имя пакета (default: из project.name)

# Развёртывание (в закрытом контуре)
cin deploy <package> [options]        # Развернуть пакет
  --target <path>                          # Целевая директория
  --no-start                               # Не запускать docker-compose up
  --no-backup                              # Не создавать backup (не рекомендуется)

cin verify <package>                  # Проверить checksum пакета

# Откат версий
cin rollback [options]                # Откатить к предыдущей версии
  --to <version>                           # Конкретная версия (из --list)
  --target <path>                          # Целевая директория

cin rollback --list                   # Показать доступные версии для отката

# Управление секретами
cin secrets setup                     # Интерактивная настройка секретов
cin secrets import <file>             # Импорт из .env или secrets.yaml
cin secrets list                      # Показать настроенные секреты (без значений)
cin secrets check                     # Проверить, все ли секреты заполнены
cin secrets export [--format env|yaml]  # Экспорт в файл (для backup)

# Сбор логов для диагностики
cin logs                              # Показать логи docker-compose (live)
cin logs collect [options]            # Собрать логи в архив для отправки студии
  --days <n>                          # За последние N дней (default: 7)
  --output <path>                     # Путь для сохранения
  --include-env                       # Включить .env (БЕЗ секретов)

# Задачи и автоматизации
cin tasks list                        # Список доступных задач
cin run <task> [options]              # Запустить задачу
  --sudo                              # Запустить от администратора
  --env <key=value>                   # Передать переменные окружения
  --dry-run                           # Показать что будет выполнено, без запуска
  --yes                               # Пропустить подтверждение

# Утилиты
cin status                            # Состояние репозиториев и images
cin version                           # Версия CLI
cin help [command]                    # Помощь
```

### Принципы идемпотентности

Все команды безопасны для повторного запуска:

| Команда | При повторном запуске |
|---------|----------------------|
| `pull` | `[SKIP] backend: already at abc1234` |
| `build` | Использует Docker cache, пересобирает только изменённое |
| `pack` | Перезаписывает пакет с тем же именем (или `[SKIP]` если --no-overwrite) |
| `deploy` | `[SKIP] Already deployed: v1.2.3` (если та же версия) |
| `secrets setup` | Показывает уже настроенные, спрашивает только пустые |

### Пример рабочей сессии

```bash
# === ЛАБОРАТОРИЯ ЗАКАЗЧИКА (с интернетом) ===

# Предварительно: студия выдала deploy key для доступа к репозиториям

# 1. Инициализация
$ cin init
? Project name: studio-product
? Default SSH key: ~/.ssh/studio_deploy_key   # ключ от студии
Created .cin/config.yaml

# 2. Добавление репозиториев студии (по ссылкам от студии)
$ cin repo add git@github.com:studio/backend.git
Added repository 'backend'
  Branch: main
  Compose: docker-compose.yml
  Services: api, worker, db

$ cin repo add git@github.com:studio/frontend.git
Added repository 'frontend'
  Branch: main
  Compose: docker-compose.yml
  Services: nginx, app

# 3. Pull кода от студии
$ cin pull
Pulling backend... done (3 new commits)
Pulling frontend... done (1 new commit)
All repositories updated

# 4. Build Docker images
$ cin build
Building backend/api... done
Building backend/worker... done
Building frontend/app... done
Building frontend/nginx... done
All images built

# 5. Упаковка для переноса в закрытый контур
$ cin pack
Packaging...
  Creating git bundles...
  Exporting Docker images...
    - backend-api:latest (245 MB)
    - backend-worker:latest (180 MB)
    - frontend-app:latest (120 MB)
    - nginx:alpine (25 MB)
    - postgres:15 (380 MB)
  Generating manifest...
  Creating archive...

Package created: releases/studio-product-2026.03.07-v1.2.3.tar.gz
  Size: 892 MB
  SHA256: a1b2c3d4e5f6...

# Теперь скопировать на USB/NAS для переноса

# === ЗАКРЫТЫЙ КОНТУР ЗАКАЗЧИКА (без интернета) ===

# Пакет перенесён на USB/NAS

# 6. Верификация
$ cin verify studio-product-2026.03.07-v1.2.3.tar.gz
Checksum: VALID
Project: studio-product
Created: 2026-03-07 14:32:00
Contains:
  - backend (commit: abc1234)
  - frontend (commit: def5678)
Images: 5
Required secrets: DATABASE_URL, REDIS_URL, API_KEY

# 7. Настройка секретов (первый раз или через файл)
$ cin secrets check
Missing secrets:
  - DATABASE_URL    [NOT SET]
  - REDIS_URL       [NOT SET]
  - API_KEY         [NOT SET]

# Вариант A: Интерактивно
$ cin secrets setup
? Enter DATABASE_URL: postgres://user:pass@localhost:5432/db
? Enter REDIS_URL: redis://localhost:6379
? Enter API_KEY: ********
Secrets saved.

# Вариант B: Из файла (если secrets.yaml принесли на флешке)
$ cin secrets import /mnt/usb/secrets.yaml
Imported 3 secrets.

# 8. Развёртывание
$ cin deploy studio-product-2026.03.07-v1.2.3.tar.gz --target /opt/app
Creating backup of current version... done (v1.2.2)
Extracting package...
Loading Docker images...
  - backend-api:latest
  - backend-worker:latest
  - frontend-app:latest
  - nginx:alpine
  - postgres:15
Injecting secrets into .env... done
Starting services...

Deployment complete! (v1.2.3)

Services:
  - api         http://localhost:3000
  - frontend    http://localhost:80
  - db          localhost:5432

Manage with:
  cd /opt/app/current && docker-compose logs -f
  cin rollback                     # Откатить к v1.2.2

# 9. Откат (если что-то пошло не так)
$ cin rollback --list
Available versions:
  * v1.2.3  2026-03-07 14:32:00  (current)
    v1.2.2  2026-03-01 10:00:00
    v1.2.1  2026-02-15 09:00:00

$ cin rollback
Rolling back to v1.2.2...
Stopping current services...
Restoring Docker images...
Restoring configuration...
Starting services...

Rollback complete! Now running: v1.2.2

# 10. Повторный deploy (идемпотентность)
$ cin deploy studio-product-2026.03.07-v1.2.3.tar.gz --target /opt/app
[SKIP] Already deployed: v1.2.3 at /opt/app
```

---

## 5. Конфигурация

### Глобальный конфиг (`~/.cin/config.yaml`)

```yaml
version: 1

# Настройки заказчика
organization:
  name: "Alpha Corporation"

# SSH ключи, полученные от студий
ssh_keys:
  studio-main: "~/.ssh/studio_deploy_key"
  studio-mobile: "~/.ssh/studio_mobile_key"

defaults:
  pack_format: "tar.gz"
  output_dir: "./releases"
  branch: "main"
```

### Проектный конфиг (`.cin/config.yaml`)

```yaml
version: 1

project:
  name: "studio-product"           # Название продукта от студии
  type: "docker-compose"

# Информация о студии-поставщике
vendor:
  name: "Studio Name"
  contact: "support@studio.com"

# Репозитории, к которым студия дала доступ
repositories:
  - name: backend
    url: "git@github.com:studio/backend.git"
    branch: main
    ssh_key: studio-main           # Ключ из глобального конфига
    submodules:
      enabled: true                # Обрабатывать submodules (default: true)
      recursive: true              # Включая вложенные submodules
      keys:                        # SSH ключи для submodules (если отличаются)
        shared-lib: studio-libs    # submodule path → key name
        vendor/sdk: studio-sdk
    docker:
      compose_file: "docker-compose.yml"
      services:
        - api
        - worker
        - db
      build_args:
        NODE_ENV: production

  - name: frontend
    url: "git@github.com:studio/frontend.git"
    branch: main
    ssh_key: studio-main
    submodules:
      enabled: true
    docker:
      compose_file: "docker-compose.prod.yml"
      services:
        - nginx
        - app
```

### Хуки и задачи (`.cin/hooks.yaml`)

```yaml
version: 1

# Lifecycle хуки — выполняются автоматически
hooks:
  pre-deploy:
    - name: "Backup database"
      run: "docker exec db pg_dump -U postgres > /backup/db-$(date +%Y%m%d).sql"
      timeout: 300
      continue_on_error: false

    - name: "Run migrations"
      run: "docker exec api npm run migrate"
      timeout: 120

  post-deploy:
    - name: "Healthcheck"
      run: "curl -f http://localhost:3000/health || exit 1"
      retries: 3
      retry_delay: 10

    - name: "Clear cache"
      run: "docker exec api npm run cache:clear"

  pre-rollback:
    - name: "Notify team"
      run: "echo 'Rollback initiated' >> /var/log/cin/events.log"

  post-rollback:
    - name: "Verify rollback"
      run: "curl -f http://localhost:3000/health"

# Ручные задачи — запускаются через `cin run <task>`
tasks:
  migrate:
    description: "Run database migrations"
    run: "docker exec api npm run migrate"
    confirm: true                        # Спросить подтверждение

  migrate:rollback:
    description: "Rollback last migration"
    run: "docker exec api npm run migrate:rollback"
    confirm: true
    sudo: false

  seed:
    description: "Seed database with test data"
    run: "docker exec api npm run db:seed"
    env:
      - SEED_COUNT=100
    confirm: true

  shell:api:
    description: "Open shell in API container"
    run: "docker exec -it api /bin/sh"
    interactive: true

  backup:
    description: "Backup all data"
    run: |
      docker exec db pg_dump -U postgres > /backup/db-$(date +%Y%m%d).sql
      tar -czf /backup/uploads-$(date +%Y%m%d).tar.gz /opt/app/uploads
    sudo: true                           # Требует sudo
    timeout: 600

  logs:api:
    description: "Tail API logs"
    run: "docker logs -f api --tail 100"
    interactive: true
```

**Пример использования:**

```bash
# Список задач
$ cin tasks list
Available tasks:
  migrate           Run database migrations
  migrate:rollback  Rollback last migration
  seed              Seed database with test data
  shell:api         Open shell in API container
  backup            Backup all data (requires sudo)
  logs:api          Tail API logs

# Запуск задачи
$ cin run migrate
Running: migrate
? This will run database migrations. Continue? (y/N) y
Executing: docker exec api npm run migrate
[migrate] Running migrations...
[migrate] Applied 3 migrations
Done.

# Запуск с sudo
$ cin run backup --sudo
[sudo] password for engineer:
Running: backup
Executing backup...
Done. Backup saved to /backup/

# Dry-run (показать что будет выполнено)
$ cin run migrate --dry-run
Would execute:
  docker exec api npm run migrate
```

### Пример: несколько продуктов от разных студий

```
~/.cin/
├── config.yaml                    # Глобальные настройки + все SSH ключи
└── projects/
    ├── studio-a-product/          # Продукт от Студии A
    │   └── .cin/config.yaml
    └── studio-b-mobile/           # Продукт от Студии B
        └── .cin/config.yaml
```

---

## 6. Структура пакета

### Содержимое архива

```
studio-product-2026.03.07-v1.2.3.tar.gz
└── studio-product-2026.03.07-v1.2.3/
    ├── manifest.json              # Метаданные пакета
    ├── sources/                   # Git bundles
    │   ├── backend.bundle         # Основной репозиторий
    │   ├── backend/               # Submodules репозитория backend
    │   │   ├── shared-lib.bundle
    │   │   └── vendor-sdk.bundle
    │   └── frontend.bundle
    ├── docker/
    │   ├── images.tar             # Все Docker images
    │   └── docker-compose.yml     # Объединённый compose для деплоя
    └── scripts/
        ├── deploy.sh              # Скрипт развёртывания
        └── healthcheck.sh         # Проверка здоровья сервисов
```

### Формат manifest.json

```json
{
  "version": "1.0",
  "package": {
    "name": "studio-product-2026.03.07-v1.2.3",
    "created": "2026-03-07T14:32:00Z",
    "created_by": "cin-cli@0.1.0"
  },
  "project": {
    "name": "studio-product",
    "type": "docker-compose"
  },
  "vendor": {
    "name": "Studio Name"
  },
  "repositories": [
    {
      "name": "backend",
      "url": "git@github.com:studio/backend.git",
      "branch": "main",
      "commit": "abc1234567890",
      "commit_date": "2026-03-07T12:00:00Z",
      "submodules": [
        {
          "path": "shared-lib",
          "url": "git@github.com:studio/shared-lib.git",
          "commit": "111222333444"
        },
        {
          "path": "vendor/sdk",
          "url": "git@github.com:studio/sdk.git",
          "commit": "555666777888"
        }
      ]
    },
    {
      "name": "frontend",
      "url": "git@github.com:studio/frontend.git",
      "branch": "main",
      "commit": "def5678901234",
      "commit_date": "2026-03-06T18:00:00Z",
      "submodules": []
    }
  ],
  "docker": {
    "images": [
      {
        "name": "backend-api:latest",
        "size": 245000000,
        "digest": "sha256:..."
      },
      {
        "name": "backend-worker:latest",
        "size": 180000000,
        "digest": "sha256:..."
      }
    ],
    "total_size": 892000000
  },
  "checksums": {
    "sources/backend.bundle": "sha256:...",
    "sources/frontend.bundle": "sha256:...",
    "docker/images.tar": "sha256:...",
    "docker/docker-compose.yml": "sha256:..."
  }
}
```

### Генерация offline docker-compose.yml

**Исходный (с build):**
```yaml
services:
  api:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    depends_on:
      - db
```

**Сгенерированный (для закрытого контура):**
```yaml
# Generated by CIN CLI
# Package: studio-product-2026.03.07-v1.2.3
# DO NOT EDIT

services:
  api:
    image: backend-api:latest
    restart: always
    ports:
      - "3000:3000"
    depends_on:
      - db

  db:
    image: postgres:15
    restart: always
    volumes:
      - db_data:/var/lib/postgresql/data

volumes:
  db_data:
```

### Rollback: структура версий

При каждом `deploy` создаётся backup предыдущей версии:

```
/opt/app/                              # --target директория
├── current/                           # Текущая активная версия (symlink)
│   ├── docker-compose.yml
│   ├── .env
│   └── ...
├── versions/                          # История версий
│   ├── v1.2.3_2026-03-07T14-30-00/
│   │   ├── docker-compose.yml
│   │   ├── .env
│   │   ├── images.tar                 # Сохранённые images
│   │   └── manifest.json
│   ├── v1.2.2_2026-03-01T10-00-00/
│   │   └── ...
│   └── v1.2.1_2026-02-15T09-00-00/
│       └── ...
└── .cin/
    ├── state.json                     # Текущее состояние
    └── rollback.yaml                  # Настройки rollback
```

**rollback.yaml:**
```yaml
max_versions: 3                        # Хранить N последних версий
backup_volumes: false                  # Бэкапить Docker volumes (опасно, много места)
auto_cleanup: true                     # Автоудаление старых версий
```

### Secrets: архитектура

CLI определяет необходимые секреты из docker-compose.yml:

```yaml
# docker-compose.yml от студии
services:
  api:
    environment:
      - DATABASE_URL              # ← Нет значения = требуется секрет
      - REDIS_URL                 # ← Нет значения = требуется секрет
      - API_KEY                   # ← Нет значения = требуется секрет
      - NODE_ENV=production       # ← Есть значение = не секрет
```

**Хранение секретов:**

```
~/.cin/
├── secrets/
│   ├── studio-product.enc         # Зашифрованные секреты проекта
│   └── .keyfile                   # Ключ шифрования (или system keychain)
```

**Формат secrets.yaml (для импорта):**

```yaml
# secrets.yaml — можно передать инженеру в закрытом контуре
secrets:
  DATABASE_URL: "postgres://user:pass@localhost:5432/db"
  REDIS_URL: "redis://localhost:6379"
  API_KEY: "sk_live_xxxxx"
```

**Пример интерактивной настройки:**

```bash
$ cin secrets setup

Checking required secrets for: studio-product

Found 3 required secrets in docker-compose.yml:

  DATABASE_URL    [NOT SET]
  REDIS_URL       [NOT SET]
  API_KEY         [NOT SET]

? Enter DATABASE_URL: postgres://user:pass@localhost:5432/db
? Enter REDIS_URL: redis://localhost:6379
? Enter API_KEY: [hidden input]

Secrets saved to ~/.cin/secrets/studio-product.enc

$ cin secrets check
All 3 secrets configured for: studio-product
```

### Logs: сбор для диагностики

Когда что-то идёт не так, заказчик собирает логи и отправляет студии:

```bash
$ cin logs collect
Collecting logs for: studio-product

  Docker logs...        done (15 MB)
  CIN operation logs... done (2 MB)
  System info...        done
  Current manifest...   done

Sanitizing secrets... done
  Removed: DATABASE_URL, API_KEY, REDIS_URL

Archive created: cin-logs-2026-03-07.tar.gz (8 MB)

Safe to share with vendor.
```

**Структура архива логов:**

```
cin-logs-2026-03-07.tar.gz
└── cin-logs-2026-03-07/
    ├── README.txt                    # Что внутри, как читать
    ├── system/
    │   ├── info.json                 # OS, Docker version, disk space
    │   ├── docker-ps.txt             # Список контейнеров
    │   └── docker-stats.txt          # Использование ресурсов
    ├── services/
    │   ├── api.log                   # Логи каждого сервиса
    │   ├── worker.log
    │   ├── db.log
    │   └── nginx.log
    ├── cin/
    │   ├── operations.log            # История команд cin
    │   ├── last-deploy.log           # Лог последнего deploy
    │   └── errors.log                # Ошибки cin
    ├── config/
    │   ├── docker-compose.yml        # Текущий compose (без секретов)
    │   ├── manifest.json             # Манифест текущей версии
    │   └── env.sanitized             # .env с замаскированными значениями
    └── timeline.json                 # Хронология событий
```

**Формат env.sanitized (секреты замаскированы):**

```bash
# .env (sanitized by cin logs collect)
DATABASE_URL=postgres://****:****@localhost:5432/db
REDIS_URL=redis://localhost:6379
API_KEY=sk_live_****
NODE_ENV=production
```

---

## 7. Структура проекта CLI

```
cin/
├── bin/
│   └── cin.js                # Entry point
├── src/
│   ├── commands/
│   │   ├── init.js
│   │   ├── repo/
│   │   │   ├── add.js
│   │   │   ├── remove.js
│   │   │   └── list.js
│   │   ├── key/
│   │   │   ├── add.js
│   │   │   ├── remove.js
│   │   │   └── list.js
│   │   ├── secrets/
│   │   │   ├── setup.js           # Интерактивная настройка
│   │   │   ├── import.js          # Импорт из файла
│   │   │   ├── list.js
│   │   │   ├── check.js
│   │   │   └── export.js
│   │   ├── logs/
│   │   │   ├── index.js           # cin logs (live view)
│   │   │   └── collect.js         # cin logs collect
│   │   ├── tasks/
│   │   │   ├── list.js            # cin tasks list
│   │   │   └── run.js             # cin run <task>
│   │   ├── pull.js
│   │   ├── build.js
│   │   ├── pack.js
│   │   ├── deploy.js
│   │   ├── rollback.js
│   │   ├── verify.js
│   │   └── status.js
│   ├── lib/
│   │   ├── config.js              # Работа с YAML конфигами
│   │   ├── git.js                 # Git операции (clone, pull, bundle)
│   │   ├── docker.js              # Docker операции (build, save, load)
│   │   ├── packager.js            # Сборка пакетов
│   │   ├── deployer.js            # Развёртывание
│   │   ├── rollback.js            # Откат версий
│   │   ├── secrets.js             # Управление секретами
│   │   ├── logs.js                # Сбор логов
│   │   ├── hooks.js               # Lifecycle хуки (pre/post-deploy)
│   │   ├── tasks.js               # Выполнение задач
│   │   └── manifest.js            # Генерация manifest.json
│   └── utils/
│       ├── checksum.js            # SHA256
│       ├── crypto.js              # Шифрование секретов
│       ├── sanitizer.js           # Удаление секретов из логов
│       ├── logger.js              # Форматированный вывод
│       └── prompts.js             # Интерактивные вопросы
├── templates/
│   ├── config.yaml                # Шаблон конфига
│   └── scripts/
│       ├── deploy.sh
│       └── healthcheck.sh
├── package.json
└── README.md
```

---

## 8. Безопасность

| Аспект | Решение |
|--------|---------|
| SSH ключи | Хранятся локально (~/.cin/), никогда не включаются в пакеты |
| Верификация пакетов | SHA256 checksum для каждого файла в manifest.json |
| Целостность images | Docker digest verification |
| Секреты | Шифруются AES-256, ключ в system keychain или ~/.cin/.keyfile |
| Секреты в памяти | Очищаются после использования, не логируются |
| Rollback | Backup создаётся до deploy, старые версии автоочищаются |

---

## 9. Roadmap

### MVP (v0.1.0) — 2 недели

- [x] Базовая структура CLI с Commander.js
- [x] `init` — создание конфигурации
- [x] `repo add/list/remove` — управление репозиториями
- [x] `key add/list/remove` — управление SSH ключами
- [x] `pull` — клонирование и обновление через simple-git
- [x] Поддержка git submodules (recursive init/update)
- [x] Конфигурация в YAML
- [x] Идемпотентность: `[SKIP]` для уже выполненных операций

### v0.2.0 — 2 недели

- [x] `build` — docker-compose build
- [ ] `pack` — создание архива с Docker images
- [ ] Базовый manifest.json
- [ ] Checksums для файлов
- [ ] `secrets setup/import/list/check` — управление секретами
- [ ] Шифрование секретов (AES-256)

### v1.0.0 — 2 недели

- [ ] `deploy` — развёртывание с автоматическим backup
- [ ] `rollback` — откат к предыдущей версии
- [ ] `verify` — проверка пакетов
- [ ] `logs` / `logs collect` — просмотр и сбор логов для диагностики
- [ ] Sanitizer — автоматическое удаление секретов из логов
- [ ] `status` — состояние системы
- [ ] Lifecycle хуки: `pre-deploy`, `post-deploy`, `pre-rollback`, `post-rollback`
- [ ] `tasks list` / `run <task>` — конфигурируемые задачи
- [ ] Полная документация
- [ ] Поддержка нескольких проектов от разных студий

### v1.1.0 — будущее

- [ ] Шифрование пакетов (age/GPG)
- [ ] Инкрементальные delta-обновления
- [ ] Поддержка GitLab/Bitbucket
- [ ] System keychain интеграция для секретов
- [ ] Параллельное выполнение независимых хуков

---

## 10. Риски и митигация

| Риск | Вероятность | Влияние | Митигация |
|------|-------------|---------|-----------|
| Большой размер Docker images | Высокая | Средний | Multi-stage builds, Alpine images, gzip сжатие |
| Разные версии Docker в контурах | Средняя | Высокий | Документировать минимальные требования (Docker 20.10+) |
| Конфликты портов при deploy | Средняя | Средний | Конфигурируемые порты в compose |
| Повреждение данных при переносе | Низкая | Критический | Checksums, верификация перед deploy |
| SSH ключи с passphrase | Средняя | Низкий | Поддержка ssh-agent |
| Submodules с разными ключами доступа | Средняя | Средний | Маппинг SSH ключей для каждого submodule в конфиге |

---

## 11. Зависимости

### Runtime

```json
{
  "dependencies": {
    "commander": "^12.0.0",
    "yaml": "^2.4.0",
    "simple-git": "^3.22.0",
    "ora": "^8.0.0",
    "chalk": "^5.3.0",
    "inquirer": "^9.2.0",
    "tar": "^7.0.0",
    "archiver": "^7.0.0"
  }
}
```

### System Requirements

| Компонент | Лаборатория | Закрытый контур |
|-----------|-------------|-----------------|
| Node.js | 20 LTS+ | 20 LTS+ |
| Git | 2.30+ | Не требуется |
| Docker | 20.10+ | 20.10+ |
| Docker Compose | v2.0+ | v2.0+ |
| Disk Space | 10GB+ | Зависит от пакета |

---

## Appendix A: Glossary

| Термин | Определение |
|--------|-------------|
| **Студия** | Разработчик ПО, хостит код на GitHub |
| **Заказчик** | Корпорация, получающая ПО от студии |
| **Лаборатория заказчика** | Окружение заказчика с доступом к интернету, где происходит pull и сборка |
| **Закрытый контур** | Изолированная сеть заказчика без доступа к интернету |
| **Deploy key** | SSH ключ с read-only доступом к репозиторию, выдаётся студией заказчику |
| **Git bundle** | Файл, содержащий полную историю git репозитория |
| **Git submodule** | Вложенный git репозиторий внутри основного, используется для подключения зависимостей |
| **Manifest** | JSON файл с метаданными пакета |
| **Vendor** | Студия-поставщик ПО |
| **Rollback** | Откат к предыдущей версии при неудачном обновлении |
| **Idempotent** | Операция, которую можно безопасно повторять без побочных эффектов |
| **Secrets** | Конфиденциальные данные: пароли, API ключи, сертификаты |
