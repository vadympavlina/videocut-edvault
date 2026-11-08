# Edvault — правила для всіх інструментів

## Темний режим (обов'язково для кожного інструмента)

Звичайний нейтральний темно-сірий, **без синього чи фіолетового відтінку** у фоні, панелях і рамках.
Акцентний колір лишається світло-блакитним. Сторінка, аркуш чи полотно для малювання лишаються світлими.

Тема вмикається атрибутом `data-theme="dark"` на `<html>`, вибір зберігається в `localStorage['edvault-theme']`
(`light` / `dark` / `auto`).

```css
:root[data-theme="dark"]{
  color-scheme:dark;
  --bg:#1e1e1e;--surface:#2c2c2c;--surface2:#383838;--surface3:#424242;
  --border:#3a3a3a;--border2:#4a4a4a;
  --text:#ededed;--text2:#c2c2c2;--muted:#9a9a9a;
  --accent:#9aabff;--accent-hover:#b3c0ff;--accent-light:rgba(154,171,255,.14);--accent-border:rgba(154,171,255,.38);--on-accent:#10153a;
  --cover:#181818;--on-cover:#ededed;--on-cover-2:#a8a8a8;--marker:#e8c93a;
  --danger:#f08a82;--danger-light:rgba(240,138,130,.12);--success:#5fd39b;
  --shadow-sm:0 1px 2px rgba(0,0,0,.4);--shadow-md:0 8px 22px rgba(0,0,0,.45);--shadow-lg:0 24px 60px rgba(0,0,0,.6);
  --float-bg:#383838;--float-text:#ededed;
  --canvas-bg:#1e1e1e;--canvas-dot:#2e2e2e;
}
```

- Робоча поверхня (аркуш документа, полотно, область зображення) у темній темі лишається світлою: на її контейнер
  повертаються світлі токени (`:root[data-theme="dark"] .page{…світлі змінні…; color:var(--text)}`), темна лише рамка інтерфейсу.
  Приклади: `.page` у `textcraft/tokens.css`, `#viewport` у `snap-editor.html`, біла сторінка у `whiteboard.html`.
- Затемнення під модальними вікнами: `rgba(0,0,0,.55)`, не синє.
- Тіні в темній темі — чорні (`rgba(0,0,0,…)`), не `rgba(28,40,105,…)`.
- `<meta name="theme-color">` у темній темі — `#1e1e1e`.
- Чорний колір у палітрах отримує світлий обідок, щоб не зливатися з панеллю.
- Еталон: `whiteboard.html`, `snap-editor.html`, `textcraft/tokens.css` у репозиторії edvault-tools.

## Інше
- Інтерфейс українською, без емодзі, звертання в нейтральному роді.
- Перед редизайном спершу показати варіанти, потім робити вибраний.
