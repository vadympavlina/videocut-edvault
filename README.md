# Відеоредактор Edvault

Монтаж у браузері: різання, текст, стрілки, розмиття, субтитри, музика, накладання, експорт у MP4. Усе працює локально, відео нікуди не вантажиться.

Статична сторінка без збирання: `index.html` + `videocut-app/`.

| Що | Де |
| --- | --- |
| Сторінка | `index.html` |
| Код редактора (ES-модулі) | `videocut-app/js/` |
| Стилі | `videocut-app/app.css` |
| Бібліотеки (mediabunny, ffmpeg, transformers) | `videocut-app/vendor/` |
| Шрифти інтерфейсу (OFL) | `fonts/` |
| Значки | `icons/` |

## Запуск і тести

```
npm start                # http://localhost:8080
npm test                 # модульні тести
npm run test:e2e         # браузерний тест (потрібні Playwright і ffmpeg)
```

Правила оформлення (темний режим, мова інтерфейсу) — у `CLAUDE.md`.

## Походження

Редактор винесено з репозиторію `edvault-tools`.
