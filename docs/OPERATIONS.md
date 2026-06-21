## Milestone: Backup + Restore (2026-06-21)

| Функція | Статус |
|---------|--------|
| Зашифрований бэкап `.averixor-backup` | Argon2id у **Web Worker** + AES-256-GCM; швидкий режим (16MB) |
| Restore Wizard | Replace / **Merge missing**; пароль до decrypt |
| Plain ZIP (демо) | «Усе в ZIP» — без шифрування |
| Ліміт бэкапу | 250 МБ |
| WebDAV | **Не реалізовано** (після стабільного restore) |

### Формат `.averixor-backup`

- Magic `AVXRBACK1`, v1
- KDF: Argon2id (mem=64MB, t=3, p=4) для нових бэкапів
- Legacy IndexedDB encryption: PBKDF2 600k (лише для unlock існуючих сховищ)
- Маніфест: records + meta.encryption + checksum

---

Оновлено: 2026-06-21. Контекст: offline-first демо-офіс + статичний сайт + окремий Nextcloud.

---

## 1. Ransomware / data loss recovery

**Питання:** Чи достатньо «Усе в ZIP» для production? Чи потрібен encrypted export + restore + WebDAV?

**Відповідь:**

| Режим | Прийнятність |
|--------|----------------|
| **Демо / ознайомлення** | «Усе в ZIP» + нагадування кожні 7 днів — **прийнятно** |
| **Робочі документи (офіс)** | **Недостатньо** без encrypted backup + restore + (опційно) WebDAV ciphertext sync |
| **Гос/військовий контур** | **Неприйнятно** без E2EE at rest + регулярний off-device backup + політика RPO |

**Що є зараз:**
- Ручний «Усе в ZIP» (повний вміст, включно з PDF-wrapper + анотації)
- Нагадування backup (localStorage, 7 днів)
- Опційне AES-256-GCM шифрування IndexedDB (пароль, PBKDF2 600k)
- **Немає:** auto-sync Nextcloud, encrypted ZIP з окремим ключем, restore з ZIP в один клік

**Рекомендація для production data sovereignty:** Q4 2026 — WebDAV → Nextcloud **лише ciphertext**; restore wizard з ZIP.

---

## 2. Schema corruption / breaking change rollback

**Питання:** Чи потрібна auto-migration + pre-migration ZIP?

**Відповідь:** **Так**, для будь-якого breaking change.

| Стан | Деталі |
|------|--------|
| Зараз | `DB_VERSION=2`, `schemaVersion` на записах, store `meta`, подія `ws-schema-upgrade` |
| Міграції | Мінімальні; повноцінний pipeline — Q4 2026 |
| Pre-migration backup | **Обов'язково вручну** перед деплоєм; автоматичний ZIP перед `onupgradeneeded` — roadmap (потребує UI + час на великих сховищах) |

**Політика:** bump `DB_VERSION` → банер «зробіть ZIP» → міграція з backward-compat де можливо.

---

## 3. RTO / RPO

| Компонент | RTO | RPO |
|-----------|-----|-----|
| **Сайт (CF Pages)** | 60–90 с (redeploy) | 0 (stateless) |
| **Workspace (IndexedDB)** | N/A (локально) | **= час останнього «Усе в ZIP»** |
| **Nextcloud** | **Не визначено** (потрібен runbook адміна) | **Не визначено** |

**Цільовий RPO для робочих документів (рекомендація оператора):**

- **Звичайний офіс:** 24 год (щоденний ZIP або файли в Nextcloud)
- **Конфіденційний контур:** **1 год** (годинний backup + E2EE)
- **Критичний (гос):** **15 хв** — лише з auto-sync ciphertext + моніторингом; поточний демо-офіс **не відповідає**

Оберіть RPO явно при публічній реєстрації користувачів.

---

## 4. Compliance & legal

| Вимога | Зараз | Потрібно на цьому етапі? |
|--------|-------|---------------------------|
| Privacy Policy | ✅ `pages/privacy.html` | **Так** — додано |
| Користувацька угода | ✅ `pages/terms.html` | **Так** — додано |
| Закон UA «Про захист ПД» | Nextcloud = оператор ПД; сайт — інформаційний | Політика + контакт адміна |
| Реєстрація в Україні | Через Nextcloud, не через сайт | DPA між оператором і користувачем — **потрібно** при масовій реєстрації |
| SOC 2 / ISO 27001 | **Ні** | Roadmap лише якщо є B2B/держзамовлення; **не обіцяємо** |

---

## 5. Threat model & budget

### Adversary (пріоритет)

1. **Звичайний malware / шкідливе розширення браузера** — основний для демо-офісу (plaintext IndexedDB без пароля)
2. **Insider (сам користувач / спільний ПК)** — високий; шифрування паролем знижує ризик
3. **Targeted (APT / держрівень)** — демо-офіс **не розрахований**; потрібні HSM/окремий контур, audit, pentest

### Бюджет (чесно)

| Стаття | Бюджет |
|--------|--------|
| CF Pages | ~$0 |
| VPS Nextcloud | Є (основна витрата) |
| Uptime / synthetic | **$0** (не налаштовано) |
| Sentry / error tracking | **$0** |
| CVE / Trivy CI | **$0** |
| Pentest | **$0** |

**Висновок:** zero-budget ops. Для гос/військового позиціонування потрібен мінімум: моніторинг + backup runbook + pentest перед заявою «data sovereignty».

---

## Зрілість (оновлена оцінка)

| Область | Було | Зараз |
|---------|------|-------|
| UI | 7/10 | 7/10 |
| Security & durability | 4/10 | **6/10** (E2EE opt-in, DOMPurify, limits, CSP/SRI частково, backup reminder) |
| Production-ready для секретних даних | — | **Ні** (потрібен WebDAV ciphertext + RPO + pentest) |
