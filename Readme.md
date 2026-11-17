<div align="center">

# GRIMOIRE

**Offline Book Reader for Your Browser**  
A self-contained web reader with a local library. No accounts, no servers, no tracking — your books never leave your device.

**[Open GRIMOIRE](https://princessbublgum03-alt.github.io/grimoire-reader/)**

<br>

<img src="screenshot.png" alt="" width="320">

</div>

---

### Overview
GRIMOIRE is a single-page web application packed into one self-contained `index.html` file. It turns any phone, tablet, or desktop browser into a full-featured e-book reader. All books, bookmarks, quotes, and settings are stored locally in your browser (`IndexedDB`), work offline, and are never uploaded anywhere.

### Key Features

**Library**
- **Supported formats:** `EPUB`, `FB2`, `FB2.ZIP`, `MOBI`, `PRC`, `AZW`, `AZW3`, `PDF`, `DOCX`, `ODT`, `RTF`, `HTML`, `XHTML`, `TXT`, `MD`, `CBZ`, and `ZIP`.
- **Import:** Add individual files, import entire folders at once, or drag and drop files directly into the browser window.
- **Organization:** Instant search by title or author, format filters, and sorting by recent activity, date added, title, or reading progress.
- **Cataloging:** Automatic extraction of metadata and cover art (or a generated minimalist card if missing), custom cover upload, title/author editing, and reading progress shown on each book card.

**Reading & Typography**
- **Themes:** Five visual themes (*Abyss* — dark, *Parchment* — light, *Sepia* — warm dark, *Forest* — herbal dark, *Void* — pure black) and an adjustable warm night filter.
- **Fonts & Layout:** Nine reading typefaces (*Georgia*, *Palatino*, *Literata*, *Lora*, *Spectral*, *Crimson Pro*, *Merriweather*, *Atkinson Hyperlegible*, *Grotesk*), customizable font size, line height, column width, text alignment, paragraph indent, and hyphenation.
- **Focus & Navigation:** Focus mode highlighting only the active paragraph, edge tap-zones for page turning, interactive pop-up footnotes, remaining chapter reading time, full-text search, and automatic position saving.

**Reading Tools**
- **Insight:** Highlight any term or character name to find definition-like sentences and contextual mentions across the book.
- **Chapter Gist:** Automatic summary of key ideas in the current chapter.
- **Notes & Glossary:** Unified navigation drawer for chapters, bookmarks, quotes, and a per-book glossary. Export quotes to `Markdown` or back up all data to `JSON`.

**Audio & Speed Reading**
- **Text-to-Speech (TTS):** Listen to a selected passage or an entire chapter with adjustable speed.
- **RSVP Mode:** Words are displayed one at a time at the optimal fixation point (100–1000 words per minute).
- **Auto-scroll:** Smooth text scrolling with adjustable speed.

### Privacy & Installation
- **Offline Mode:** Installable as a PWA via *"Add to Home Screen"* in Chrome or Safari. No internet connection is required after the first visit.
- **Backup:** Since data lives in browser storage, clearing browser data deletes the library — use the `JSON` export in the Statistics menu to back up your progress, notes, and bookmarks.

### Architecture & License
A single self-contained `index.html` file with no build step required. Powered by `IndexedDB`, `epub.js`, `JSZip`, on-demand `PDF.js`, and custom parsers for `FB2`, `DOCX`, `ODT`, `RTF`, `MOBI` (PalmDoc), `CBZ`, `HTML`, `TXT`, and `Markdown`. Licensed under **BSD-2-Clause**.

---

<details>
<summary><b>Описание на русском языке</b></summary>
<br>

**[Открыть GRIMOIRE](https://princessbublgum03-alt.github.io/grimoire-reader/)**

### Суть проекта
GRIMOIRE упакован в один автономный файл `index.html` и превращает любой браузер на смартфоне, планшете или компьютере в полноценную читалку. Все книги, закладки, цитаты и настройки хранятся локально в базе данных браузера (`IndexedDB`), работают без доступа к сети и никуда не передаются.

### Ключевые возможности

**Библиотека**
- **Поддержка форматов:** `EPUB`, `FB2`, `FB2.ZIP`, `MOBI`, `PRC`, `AZW`, `AZW3`, `PDF`, `DOCX`, `ODT`, `RTF`, `HTML`, `XHTML`, `TXT`, `MD`, `CBZ` и `ZIP`.
- **Импорт:** добавление отдельных файлов, целых папок с коллекциями или перетаскивание файлов (Drag & Drop) прямо в окно браузера.
- **Навигация по библиотеке:** мгновенный поиск по названию и автору, фильтрация по форматам и сортировка по дате чтения, дате добавления, алфавиту или прогрессу.
- **Каталогизация:** автоматическое извлечение метаданных и обложек (или генерация минималистичной карточки при их отсутствии), редактирование названия и автора, смена обложки и отображение прогресса чтения.

**Чтение и типографика**
- **Оформление:** пять тем (*Бездна* — тёмная, *Пергамент* — светлая, *Сепия* — тёплая тёмная, *Чаща* — тёмно-зелёная, *Пустота* — чистый чёрный) и настраиваемый ночной фильтр.
- **Шрифты и вёрстка:** девять книжных гарнитур (*Georgia*, *Palatino*, *Literata*, *Lora*, *Spectral*, *Crimson Pro*, *Merriweather*, *Atkinson Hyperlegible*, *Grotesk*), гибкая настройка кегля, интерлиньяжа, ширины колонки, выравнивания, красной строки и переносов.
- **Фокусировка и навигация:** режим подсветки только текущего абзаца, листание нажатием по краям экрана, всплывающие сноски, расчёт оставшегося времени чтения главы, полнотекстовый поиск и автосохранение позиции.

**Инструменты анализа**
- **Контекст («Вникнуть»):** выделение термина или имени находит в тексте книги предложения с их определениями и упоминаниями.
- **Выжимка главы:** автоматическое резюме ключевых мыслей текущего раздела.
- **Заметки и глоссарий:** единое окно оглавления, закладок, цитат и словаря терминов книги. Экспорт цитат в `Markdown` и полное резервное копирование в `JSON`.

**Аудио и скорочтение**
- **Синтез речи (TTS):** озвучивание выбранного фрагмента или всей главы.
- **RSVP-режим:** последовательная подача слов с акцентом на точке фиксации взгляда (от 100 до 1000 слов в минуту).
- **Автопрокрутка:** плавное движение текста с регулируемой скоростью.

### Приватность и установка
- **Работа офлайн:** приложение можно установить на главный экран смартфона через меню браузера (*«На экран „Домой“»* в Chrome или Safari) как полноценное PWA. После первого запуска интернет не требуется.
- **Резервное копирование:** поскольку данные привязаны к хранилищу браузера, очистка кэша удалит библиотеку — для сохранения прогресса, закладок и заметок предусмотрен экспорт и импорт в `JSON`.

### Архитектура и лицензия
Самодостаточный `index.html` без этапа сборки. В основе лежат `IndexedDB`, `epub.js`, `JSZip`, подгружаемый по требованию `PDF.js` и собственные парсеры для `FB2`, `DOCX`, `ODT`, `RTF`, `MOBI` (PalmDoc), `CBZ`, `HTML`, `TXT` и `Markdown`. Исходный код открыт под лицензией **BSD-2-Clause**.

</details>