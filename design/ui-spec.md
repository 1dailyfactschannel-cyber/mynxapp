# Mynx — UI / UX Спецификация

## 1. Дизайн-философия: "Secure Glass"

Интерфейс должен передавать ощущение **безопасности, премиальности и современности**. Каждый элемент должен говорить: "твои данные под защитой".

### Принципы
1. **Clarity** — ничего лишнего, каждый элемент имеет цель
2. **Depth** — glassmorphism создаёт иерархию без жёстких границ
3. **Feedback** — мгновенная реакция на каждое действие
4. **Security cues** — зелёный замок, subtle glow при успешных операциях

---

## 2. Цветовая палитра

### Dark Theme (default)
```css
--bg-primary: #0a0a0f;           /* Глубокий чёрно-синий */
--bg-secondary: #111118;         /* Подложка для карточек */
--bg-glass: rgba(255,255,255,0.05);  /* Полупрозрачный фон */
--bg-glass-hover: rgba(255,255,255,0.08);
--border-glass: rgba(255,255,255,0.1);
--border-glass-hover: rgba(255,255,255,0.2);
--blur-glass: blur(20px) saturate(150%);

--accent-primary: #10b981;       /* Изумрудный — success, secure */
--accent-primary-glow: rgba(16,185,129,0.3);
--accent-secondary: #3b82f6;     /* Синий — links, actions */
--accent-danger: #ef4444;        /* Красный — delete, warning */
--accent-warning: #f59e0b;       /* Оранжевый — attention */

--text-primary: #f8fafc;         /* Белый */
--text-secondary: #94a3b8;       /* Приглушённый серый */
--text-muted: #475569;           /* Метки, placeholders */
--font-main: 'Inter', system-ui, sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;
```

### Light Theme
```css
--bg-primary: #f8fafc;
--bg-secondary: #ffffff;
--bg-glass: rgba(255,255,255,0.6);
--border-glass: rgba(0,0,0,0.08);
--text-primary: #0f172a;
--text-secondary: #64748b;
--text-muted: #94a3b8;
--accent-primary: #059669;
--accent-secondary: #2563eb;
```

### Accent Gradients (фоновые)
```css
--gradient-secure: linear-gradient(135deg, #0a0a0f 0%, #111827 50%, #0f172a 100%);
--gradient-glow: radial-gradient(circle at 50% 0%, rgba(16,185,129,0.15) 0%, transparent 60%);
--gradient-card: linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%);
```

---

## 3. Типографика

| Элемент | Шрифт | Размер | Weight | Line-height |
|---------|-------|--------|--------|-------------|
| App Title | Inter | 20px | 600 | 1.2 |
| Section Title | Inter | 18px | 600 | 1.3 |
| Card Title | Inter | 15px | 500 | 1.4 |
| Body | Inter | 14px | 400 | 1.5 |
| Caption | Inter | 12px | 400 | 1.4 |
| Password | JetBrains Mono | 14px | 400 | 1.2 |
| Code/Secret | JetBrains Mono | 13px | 400 | 1.2 |
| Button | Inter | 14px | 500 | 1 |
| Search | Inter | 15px | 400 | 1.5 |

---

## 4. Компоненты

### 4.1 Glass Card
```css
.glass-card {
  background: var(--gradient-card);
  backdrop-filter: var(--blur-glass);
  border: 1px solid var(--border-glass);
  border-radius: 16px;
  padding: 20px;
  transition: all 0.2s ease;
}
.glass-card:hover {
  border-color: var(--border-glass-hover);
  background: rgba(255,255,255,0.08);
}
```

### 4.2 Primary Button (Secure Action)
```css
.btn-primary {
  background: linear-gradient(135deg, #059669 0%, #10b981 100%);
  color: white;
  border: none;
  border-radius: 10px;
  padding: 10px 20px;
  font-weight: 500;
  box-shadow: 0 0 0 0 rgba(16,185,129,0.4);
  transition: all 0.2s ease;
}
.btn-primary:hover {
  box-shadow: 0 0 20px var(--accent-primary-glow);
  transform: translateY(-1px);
}
.btn-primary:active {
  transform: translateY(0);
}
```

### 4.3 Secondary Button (Glass)
```css
.btn-secondary {
  background: var(--bg-glass);
  border: 1px solid var(--border-glass);
  color: var(--text-primary);
  border-radius: 10px;
  padding: 10px 20px;
}
.btn-secondary:hover {
  background: var(--bg-glass-hover);
  border-color: var(--border-glass-hover);
}
```

### 4.4 Password Input (Secure)
```css
.input-password {
  background: rgba(0,0,0,0.3);
  border: 1px solid var(--border-glass);
  border-radius: 12px;
  padding: 12px 16px;
  font-family: var(--font-mono);
  color: var(--text-primary);
  transition: all 0.2s ease;
}
.input-password:focus {
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 3px rgba(16,185,129,0.15);
  outline: none;
}
```

### 4.5 Entry Card (Vault Item)
```css
.entry-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
  background: var(--bg-glass);
  border: 1px solid var(--border-glass);
  border-radius: 14px;
  transition: all 0.15s ease;
  cursor: pointer;
}
.entry-card:hover {
  background: var(--bg-glass-hover);
  border-color: var(--border-glass-hover);
  transform: translateX(4px);
}
.entry-card:active {
  transform: translateX(2px);
}
```

### 4.6 Strength Indicator
```css
.strength-bar {
  height: 4px;
  border-radius: 2px;
  background: #1f2937;
  overflow: hidden;
}
.strength-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.4s ease, background 0.3s ease;
}
.strength-weak { background: var(--accent-danger); }
.strength-fair { background: var(--accent-warning); }
.strength-good { background: #3b82f6; }
.strength-strong { background: var(--accent-primary); }
```

---

## 5. Экраны

### 5.1 Lock Screen (Unlock)
```
+----------------------------------------------------------+
|                                                          |
|                    [App Icon: 64px]                      |
|                    Mynx                              |
|                                                          |
|          +-----------------------------------+           |
|          | Enter master password...          |           |
|          +-----------------------------------+           |
|                                                          |
|               [      Unlock      ]                       |
|                                                          |
|          [🔓 Unlock with Windows Hello]                  |
|                                                          |
|                    Auto-lock: 5 min                        |
+----------------------------------------------------------+
```
- Фон: анимированный градиент (subtle shift)
- Поле ввода: glow при focus, иконка глаза (show/hide)
- Кнопка Unlock: пульсирующий glow при hover
- Windows Hello: ниже, subtle link style
- Если неправильный пароль: shake анимация + красный glow

### 5.2 Vault (Main Screen)
```
+----------------------------------------------------------+
|  🔐 Mynx     [🔍 Search all entries...]     [⚙] [🔒] |
+----------------------------------------------------------+
|  Sidebar  |  Main Content                                  |
|  ─────────|  +--------------------------------------------+|
|  [All]    |  | [🔍] [Gen] [Add] [Import]                ||
|  [Fav]    |  +--------------------------------------------+|
|  [Bank]   |  |                                            ||
|  [Social] |  |  [G] Google           | ******** | [🔑][✏] ||
|  [Work]   |  |  [GH] GitHub          | ******** | [🔑][✏] ||
|  [Dev]    |  |  [💳] Bank of America | ******** | [🔑][✏] ||
|  [★]      |  |  [▶] Netflix          | ******** | [🔑][✏] ||
|           |  |                                            ||
|           |  |  [🛡] Amazon          | ******** | [🔑][✏] ||
|           |  |  [📧] Gmail            | ******** | [🔑][✏] ||
+----------------------------------------------------------+
|  Status: 47 entries | Last backup: 2h ago | [💾 Backup]  |
+----------------------------------------------------------+
```
- Sidebar: glassmorphism, категории с badge count
- Entry cards: hover → shift right, glow border
- Actions: copy password (🔑), edit (✏), more (...)
- Search: Cmd+K, real-time фильтрация, fuzzy search
- Status bar: glassmorphism, компактная

### 5.3 Entry Detail (Modal / Slide-over)
```
+----------------------------------------------------------+
|  [G] Google Account                              [✕]     |
+----------------------------------------------------------+
|                                                          |
|  Username:     [my.email@gmail.com]              [🔑 Copy] |
|  Password:    [••••••••••••••]    [👁]         [🔑 Copy] |
|  URL:         [https://accounts.google.com]              |
|  Category:    [Social ▾]                                 |
|  Notes:      [Free text area...]                         |
|                                                          |
|  TOTP:        [123 456]      [30s timer circle]           |
|                                                          |
|  [Custom Fields]  + Add                                  |
|  Security: [██████░░] Good (78/100)                      |
|  Last modified: 3 days ago                               |
|                                                          |
|  [💾 Save]  [🗑 Delete]                                  |
+----------------------------------------------------------+
```
- Slide-over справа (Framer Motion: x → 0)
- Password: masked by default, toggle visibility
- TOTP: 30-секундный круговой прогресс, авто-обновление
- Security score: цветной bar + текст
- Custom fields: ключ-значение, можно добавлять

### 5.4 Password Generator
```
+----------------------------------------------------------+
|  Password Generator                              [✕]     |
+----------------------------------------------------------+
|                                                          |
|  [•••••••••••••••••••••••••••••••••]    [🔄] [📋]        |
|  Strength: [████████████░░░░] Strong (92/100)           |
|  Entropy:  85 bits                                       |
|                                                          |
|  Length:    [====●====] 16                               |
|  ├─ Uppercase    [✓]                                     |
|  ├─ Lowercase    [✓]                                     |
|  ├─ Numbers      [✓]                                     |
|  ├─ Symbols      [✓]  [_!@#$%^&*]                        |
|  ├─ Exclude ambiguous [✓]  [0, O, l, 1]                   |
|  └─ Easy to say [ ]                                      |
|                                                          |
|  Type: [Random •] [Memorable •] [Passphrase •] [PIN •]   |
|                                                          |
|  [Use This Password]                                     |
+----------------------------------------------------------+
```
- Большой моноширинный текст результата
- Слайдер длины с мгновенным preview
- Типы: Random / Memorable (diceware) / Passphrase / PIN
- Entropy: real-time расчёт, color-coded
- Strength bar: анимированный fill

### 5.5 Settings
```
+----------------------------------------------------------+
|  Settings                                        [✕]     |
+----------------------------------------------------------+
|  ┌ Security ─────────────────────────────────────────┐    |
|  │ Auto-lock: [After 5 minutes •]                  │    |
|  │ Lock on sleep: [✓]                              │    |
|  │ Clipboard clear: [After 30 seconds •]           │    |
|  │ Disable Windows clipboard history: [✓]           │    |
|  │ Biometric unlock: [✓] Windows Hello             │    |
|  └──────────────────────────────────────────────────┘    |
|  ┌ Appearance ───────────────────────────────────────┐    |
|  │ Theme: [Dark •] [Light] [System]                │    |
|  │ Glassmorphism intensity: [====●==] Medium       │    |
|  │ Font size: [14px •] [16px] [18px]               │    |
|  │ Density: [Compact] [Default •] [Comfortable]      │    |
|  └──────────────────────────────────────────────────┘    |
|  ┌ Backup ─────────────────────────────────────────┐    |
|  │ Auto-backup: [✓] Every 6 hours                   │    |
|  │ Backup location: [D:\Mynx\Backups]            │    |
|  │ Keep backups: [10 latest •] [30 days] [All]       │    |
|  │ [🗂 Open backup folder] [💾 Backup now]           │    |
|  └──────────────────────────────────────────────────┘    |
|  ┌ Import / Export ──────────────────────────────────┐    |
|  │ [Import from 1Password] [Import from Bitwarden]   │    |
|  │ [Export encrypted backup] [Export emergency kit]  │    |
|  └──────────────────────────────────────────────────┘    |
|  ┌ Danger Zone ────────────────────────────────────┐    |
|  │ [Change Master Password] [Delete all data]        │    |
|  └──────────────────────────────────────────────────┘    |
+----------------------------------------------------------+
```
- Settings groups: glass cards
- Danger zone: красная граница, подтверждение при клике

---

## 6. Анимации (Framer Motion)

### 6.1 Page Transitions
```tsx
const pageVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25 } },
  exit: { opacity: 0, y: -10, transition: { duration: 0.15 } }
};
```

### 6.2 Entry Card Hover
```tsx
const cardHover = {
  rest: { x: 0, borderColor: "rgba(255,255,255,0.1)" },
  hover: { x: 4, borderColor: "rgba(255,255,255,0.2)", transition: { duration: 0.15 } }
};
```

### 6.3 Modal / Slide-over
```tsx
const slideOver = {
  hidden: { x: "100%", opacity: 0.8 },
  visible: { x: 0, opacity: 1, transition: { type: "spring", damping: 25, stiffness: 200 } },
  exit: { x: "100%", opacity: 0.8, transition: { duration: 0.2 } }
};
```

### 6.4 Unlock Button Glow
```tsx
const glowPulse = {
  animate: {
    boxShadow: [
      "0 0 0 0 rgba(16,185,129,0)",
      "0 0 0 4px rgba(16,185,129,0.3)",
      "0 0 0 0 rgba(16,185,129,0)"
    ],
    transition: { duration: 2, repeat: Infinity }
  }
};
```

### 6.5 Wrong Password Shake
```tsx
const shake = {
  animate: {
    x: [0, -10, 10, -10, 10, 0],
    transition: { duration: 0.4 }
  }
};
```

---

## 7. Responsive Layout

### Min Width: 360px
- Sidebar collapses в drawer (hamburger menu)
- Entry cards: full width, stacked actions
- Generator: вертикальный layout

### Width: 768px+
- Sidebar: fixed 240px
- Entry cards: 2-column grid (опционально)
- Generator: горизонтальный layout

### Width: 1200px+
- Entry cards: 1-column list (предпочтительно для сканирования)
- Detail: slide-over справа
- Command palette: centered, max-width 640px

---

## 8. Keyboard Shortcuts

| Shortcut | Действие |
|----------|----------|
| `Ctrl/Cmd + K` | Открыть Command Palette / Search |
| `Ctrl/Cmd + L` | Lock vault (немедленно) |
| `Ctrl/Cmd + N` | Новая запись |
| `Ctrl/Cmd + G` | Генератор паролей |
| `Ctrl/Cmd + ,` | Settings |
| `Escape` | Закрыть модал / отменить |
| `Ctrl/Cmd + C` | Copy selected password (внутри записи) |
| `Ctrl/Cmd + Enter` | Save entry |
| `Ctrl/Cmd + Shift + B` | Backup now |
| `Ctrl/Cmd + /` | Показать shortcuts |

---

## 9. Accessibility (WCAG 2.1 AA)

- **Color contrast**: 4.5:1 для body text, 3:1 для large text
- **Focus indicators**: visible outline (2px solid accent) на всех интерактивных элементах
- **Screen readers**: ARIA labels для всех иконок-кнопок
- **Keyboard nav**: Tab order логичный, Escape закрывает модал
- **Reduced motion**: `prefers-reduced-motion` уважается
- **Font scaling**: поддержка 200% zoom

---

## 10. Иконки (Lucide)

| Использование | Иконка |
|--------------|--------|
| App | `shield` |
| Lock | `lock` |
| Unlock | `unlock` |
| Search | `search` |
| Add entry | `plus` |
| Edit | `pencil` |
| Delete | `trash-2` |
| Copy | `copy` |
| Password visible | `eye` |
| Password hidden | `eye-off` |
| Generator | `dice-5` |
| TOTP | `timer` |
| Settings | `settings` |
| Backup | `save` |
| Import | `download` |
| Export | `upload` |
| Favorite | `star` |
| Category | `folder` |
| Security | `shield-check` |
| Warning | `alert-triangle` |
| Success | `check-circle-2` |
| Info | `info` |
