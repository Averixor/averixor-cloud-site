# ☁️ Averixor Cloud

Сайт-обкладинка приватної хмари **Nextcloud**.

| URL | Призначення |
|---|---|
| `https://averixor.xyz` | Сайт (цей репозиторій) |
| `https://cloud.averixor.xyz` | Nextcloud — файли, синхронізація |

---

## Важливо

Averixor Cloud зараз позиціонується як обкладинка для Nextcloud: зберігання, синхронізація та обмін файлами. Редактор документів на сайті прибрано.

---

## Структура репозиторію (файли в корені)

```text
index.html              # Головна
pages/                  # Розділи сайту
assets/css/             # Стилі
assets/js/              # Скрипти сайту
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

## GitHub vs Cloudflare Pages

| | GitHub (репозиторій) | Cloudflare Pages (сайт) |
|---|---|---|
| Призначення | Розробка, тести, CI, історія | Публічний `averixor.xyz` |
| Вміст | Увесь проєкт (крім `.gitignore`) | Лише `dist/` після `npm run build` |
| `tests/`, `package.json` | Так | Ні |
| `node_modules/` | Локально, не в git | Ні |

Збірка production (тільки статика для сайту):

```bash
npm run build    # → dist/
npm run verify   # перевірка структури
```

---

## Деплой: Cloudflare Pages

**Репозиторій:** https://github.com/Averixor/averixor-cloud-site  
**Гілка production:** `main` (E2E CI обов’язковий)

### Налаштування Pages

| Параметр | Значення |
|----------|----------|
| Production branch | `main` |
| Framework preset | **None** (не Workers, не Wrangler static з output `.`) |
| **Build command** | `npm run build` |
| **Build output directory** | **`dist`** (не `.` і не `/`) |
| **Deploy command** | *(порожньо — не `wrangler deploy`)* |
| Environment variables | не потрібні |

> **Помилка `Asset too large … node_modules/workerd`?**  
> Cloudflare намагається залити **весь репозиторій** (output = `.`).  
> У Dashboard → Settings → Builds: output має бути **`dist`**, deploy command — **порожній**.  
> У репо є `wrangler.toml` з `pages_build_output_dir = "dist"`.

### Dashboard

1. [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. Репозиторій: `Averixor/averixor-cloud-site`, гілка `main`
3. Build: `npm run build`, output: **`dist`**, deploy command — **не заповнювати**
4. **Custom domains** → `averixor.xyz`
5. Preview deployments для PR; production лише з `main`

Якщо проєкт уже створено як Worker з `wrangler deploy` і `assets.directory = "."` — краще **новий Pages-проєкт** з налаштуваннями вище, або в Settings виправити output на `dist` і прибрати deploy command.

### Що потрапляє на сайт (`dist/`)

`index.html`, `pages/`, `assets/`, `robots.txt`, `sitemap.xml`, `site.webmanifest`, `CNAME`, `_headers`, `_redirects`, `.nojekyll`, `README.md`, `LICENSE`, `docs/OPERATIONS.md`

**Не потрапляє:** `tests/`, `node_modules/`, `package.json`, `.env*`, Playwright-артефакти.

### Домени

- `averixor.xyz` → цей статичний сайт (Cloudflare Pages)
- `cloud.averixor.xyz` → **окремий Nextcloud** (не чіпати, не деплоїти з цього репо)

---

## Локальний запуск

**Розробка** (усі файли):

```bash
python3 -m http.server 8080
```

**Production-збірка** (як на Cloudflare):

```bash
npm run build
python3 -m http.server 8080 --directory dist
```

---

## Підтримка

Офіційна пошта `support@averixor.xyz` поки **не налаштована**. З питаннями — до адміністратора сервера особисто.

---

## Стан

- Сайт — обкладинка для Nextcloud: навігація, опис можливостей, посилання на вхід і реєстрацію.
- Демо-офіс (`/workspace/`) та сторінка офісних форматів прибрані; старі URL редіректяться на головну.
- Smoke-тести Playwright проходять у CI.

---

## Тести (Playwright)

```bash
npm install
npx playwright install chromium
npm run test:e2e
```

Покриває: завантаження головної та всіх сторінок `pages/`, наявність посилань на хмару, мобільне меню.

CI: `.github/workflows/e2e.yml` (push/PR → `main`).

---

## Ліцензія

MIT © 2026 Averixor Cloud
