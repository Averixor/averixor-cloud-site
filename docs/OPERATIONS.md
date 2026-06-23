# Операції Averixor Cloud

Оновлено: 2026-06-22. Контекст: статичний маркетинговий сайт (`averixor.xyz`) + окремий Nextcloud (`cloud.averixor.xyz`).

---

## 1. Компоненти

| Компонент | Де живе | Стан |
|-----------|---------|------|
| Сайт (HTML/CSS/JS) | Cloudflare Pages, `dist/` | Stateless, redeploy з `main` |
| Nextcloud | Окремий VPS | Файли, синхронізація, облікові записи |
| Онлайн-офіс | — | **Не на сайті**; OnlyOffice/Collabora — окреме рішення на сервері |

---

## 2. RTO / RPO

| Компонент | RTO | RPO |
|-----------|-----|-----|
| **Сайт (CF Pages)** | 60–90 с (redeploy) | 0 (stateless) |
| **Nextcloud** | Залежить від runbook адміна | Залежить від backup-політики сервера |

Рекомендація: явний runbook backup Nextcloud (БД + `data/`) перед масовою реєстрацією користувачів.

---

## 3. Деплой сайту

```bash
npm run build    # → dist/
npm run verify   # структура + заборона dev-артефактів
npm run ci       # build + verify + smoke E2E
```

Production branch: `main`. Output directory у Cloudflare Pages: **`dist`**.

---

## 4. Compliance

| Вимога | Де |
|--------|-----|
| Privacy Policy | `pages/privacy.html` |
| Користувацька угода | `pages/terms.html` |
| Обробка ПД | Nextcloud = оператор; сайт — інформаційний |

---

## 5. Моніторинг (рекомендації)

- Uptime для `averixor.xyz` та `cloud.averixor.xyz`
- Алерт на 5xx Nextcloud
- Регулярна перевірка TLS і дискового простору VPS

---

## 6. Roadmap (не на сайті)

- WebDAV / desktop sync (через Nextcloud)
- SSO між сайтом і хмарою
- OnlyOffice або Collabora на `cloud.averixor.xyz` (серверна задача, не цей репозиторій)
