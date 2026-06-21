# ☁️ Averixor Cloud

Сайт приватної хмари **Nextcloud** + локальний **демо-офіс** у браузері.

| URL | Призначення |
|---|---|
| `https://averixor.xyz` | Сайт (цей репозиторій) |
| `https://cloud.averixor.xyz` | Nextcloud — файли, синхронізація |

---

## Важливо: два різні продукти

### Nextcloud (хмара)
- Зберігання, синхронізація, обмін файлами
- **Nextcloud Office вимкнено** (richdocuments ламав сервер) — онлайн-редагування DOCX/XLSX у хмарі недоступне

### Демо-офіс (`/workspace/`)
- Локальні редактори в браузері (Quill, jSpreadsheet, IndexedDB)
- Імпорт/експорт офісних форматів
- **Не інтегровано з Nextcloud** — немає автоматичної синхронізації

---

## Структура репозиторію (файли в корені)

```text
index.html              # Головна
pages/                  # Розділи сайту
workspace/index.html    # Демо-офіс
assets/css/             # Стилі
assets/js/              # Скрипти сайту
assets/js/workspace/    # Демо-офіс
assets/img/             # Зображення та іконки
CNAME                   # averixor.xyz
sitemap.xml
site.webmanifest
_headers, _redirects    # Cloudflare Pages
```

Клонування:

```bash
git clone https://github.com/Averixor/averixor-cloud-site.git
cd averixor-cloud-site
```

---

## Деплой: GitHub → Cloudflare Pages

**Репозиторій:** https://github.com/Averixor/averixor-cloud-site  
**Гілка production:** `main` (захищена — обов’язковий E2E CI)

### Налаштування Pages (статичний сайт, без збірки)

| Параметр | Значення |
|----------|----------|
| Production branch | `main` |
| Framework preset | None / Custom |
| Build command | *(порожньо)* |
| Build output directory | `.` або `/` |
| Environment variables | не потрібні |

### Dashboard

1. [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Connect to Git**
2. Репозиторій: `Averixor/averixor-cloud-site`, гілка `main`
3. Build command — **порожньо**, output — **корінь репозиторію**
4. Після деплою: **Custom domains** → `averixor.xyz` (або автоматично з `CNAME`)
5. **Preview deployments** — увімкнено для PR; production лише з `main`

### Що підхоплюється автоматично

- `_headers` — security headers + CSP для `/workspace/*`
- `_redirects` — редіректи зі старих URL
- `CNAME` — `averixor.xyz`

### URL після деплою

- `https://<project>.pages.dev`
- `https://averixor.xyz`

### Nextcloud (окремо)

`cloud.averixor.xyz` — окремий VPS Nextcloud, не цей репозиторій.

---

## Локальний запуск

```bash
python3 -m http.server 8080
```

- `http://localhost:8080/` — сайт
- `http://localhost:8080/workspace/` — демо-офіс

---

## Підтримка

Офіційна пошта `support@averixor.xyz` поки **не налаштована**. З питаннями — до адміністратора сервера особисто.

---

## Тести (Playwright)

Критична цепочка backup → restore:

```bash
npm install
npx playwright install chromium
npm run test:e2e
```

Покриває: зашифрований `.averixor-backup`, wipe IndexedDB, atomic restore, merge-missing, UI wizard, негативні кейси (пароль, checksum, ліміт 250 МБ).

CI: `.github/workflows/e2e.yml` (push/PR → `main`).

---

## Ліцензія

MIT © 2026 Averixor Cloud
