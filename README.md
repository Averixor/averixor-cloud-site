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

**Правильно для GitHub:** `index.html` лежить у **корені репозиторію**, не в підпапці `averixor-cloud-site-production/`.

---

## Деплой: GitHub → Cloudflare Pages

### 1. Створити репозиторій на GitHub

```bash
cd averixor-cloud-site-production   # каталог з index.html у корені
git init
git add .
git commit -m "Averixor Cloud production site"
git branch -M main
git remote add origin https://github.com/YOUR_USER/averixor-cloud-site.git
git push -u origin main
```

### 2. Cloudflare Pages

1. [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. Обрати репозиторій, гілку `main`
3. **Build command:** *(порожньо)*
4. **Build output directory:** `/`
5. **Deploy**

### 3. Домен

1. Pages → проєкт → **Custom domains** → `averixor.xyz`
2. DNS: CNAME `averixor.xyz` → `your-project.pages.dev` (або використати файл `CNAME` при GitHub Pages)

### 4. Nextcloud окремо

`cloud.averixor.xyz` — окремий сервер Nextcloud, не цей репозиторій.

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
