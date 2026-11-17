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
GRIMOIRE is a single-page web application packed into one self-contained `index.html` file. It turns any phone or desktop browser into a full-featured e-book reader. All books, bookmarks, and settings are stored locally in your browser (`IndexedDB`), work offline, and are never uploaded anywhere.

### Key Features

**Library**
* **Supported formats:** `EPUB`, `FB2`, `FB2.ZIP`, `MOBI`, `PRC`, `AZW`, `AZW3`, `TXT`, `MD`, as well as `DOCX` and `HTML`.
* **Import:** Add individual files or entire folders at once.
* **Cataloging:** Automatic extraction of metadata and cover art (or a clean generated card if missing), with reading progress shown directly on each book card.

**Reading & Typography**
* **Themes:** Three visual themes (*Abyss* — dark, *Parchment* — light, *Void* — monochrome) and an adjustable night filter.
* **Fonts & Layout:** Nine reading typefaces (including *Literata*, *Lora*, *Spectral*, *Crimson Pro*, *Merriweather*), customizable font size, line height, column width, and text alignment.
* **Focus:** Focus mode highlighting only the active paragraph, table of contents, full-text search, and automatic position saving.

**Reading Tools**
* **Insight:** Highlight any term or character name to find definition-like sentences elsewhere in the book.
* **Chapter Gist:** Automatic summary of key ideas in the current chapter.
* **Notes & Glossary:** Save quotes with personal comments, build a per-book glossary of terms, and export data to `JSON`.

**Audio & Speed Reading**
* **Text-to-Speech (TTS):** Listen to a selected passage or an entire chapter.
* **RSVP Mode:** Words are displayed one at a time at the optimal fixation point (100–1000 words per minute).
* **Auto-scroll:** Smooth text scrolling with adjustable speed.

### Privacy & Installation
* **Offline Mode:** Installable as a PWA via *"Add to Home Screen"* in Chrome or Safari. No internet connection is required after the first visit.
* **Backup:** Since data lives in browser storage, clearing browser data deletes the library — use the `JSON` export in Settings to back up notes and bookmarks.

### Architecture & License
A single self-contained `index.html` file with no build step required. Powered by `epub.js`, `JSZip`, `Service Worker`, `IndexedDB`, and custom parsers for `FB2`, `MOBI` (PalmDoc), `TXT`, and `Markdown`. Licensed under **BSD-2-Clause**.

---

<details>
<summary><b>Описание на русском языке</b></summary>
<br>

**[Открыть GRIMOIRE](https://princessbublgum03-alt.github.io/grimoire-reader/)**

### Суть проекта
GRIMOIRE упакован в один автономный файл `index.html` и превращает любой браузер на смартфоне или компьютере в полноценную читалку. Все книги, закладки и настройки хранятся локально в базе данных браузера (`IndexedDB`), работают без доступа к сети и никуда не передаются.

### Ключевые возможности

**Библиотека**
* **Поддержка форматов:** `EPUB`, `FB2`, `FB2.ZIP`, `MOBI`, `PRC`, `AZW`, `AZW3`, `TXT`, `MD`, а также `DOCX` и `HTML`.
* **Импорт:** добавление отдельных файлов или целых папок с коллекциями.
* **Каталогизация:** автоматическое извлечение метаданных и обложек (или генерация минималистичной карточки при их отсутствии), отображение прогресса чтения.

**Чтение и типографика**
* **Оформление:** три темы (*Abyss* — тёмная, *Parchment* — светлая, *Void* — монохромная) и настраиваемый ночной фильтр.
* **Шрифты и вёрстка:** девять книжных гарнитур (включая *Literata*, *Lora*, *Spectral*, *Crimson Pro*, *Merriweather*), гибкая настройка кегля, интерлиньяжа, ширины колонки и выравнивания.
* **Фокусировка:** режим подсветки только текущего абзаца, оглавление, полнотекстовый поиск и автосохранение позиции.

**Инструменты анализа**
* **Контекст («Вникнуть»):** выделение термина или имени находит в тексте книги предложения с их определениями.
* **Выжимка главы:** автоматическое резюме ключевых мыслей текущего раздела.
* **Заметки и глоссарий:** сохранение цитат с комментариями, формирование словаря терминов для каждой книги и экспорт данных в формат `JSON`.

**Аудио и скорочтение**
* **Синтез речи (TTS):** озвучивание выбранного фрагмента или всей главы.
* **RSVP-режим:** последовательная подача слов с акцентом на точке фиксации взгляда (от 100 до 1000 слов в минуту).
* **Автопрокрутка:** плавное движение текста с регулируемой скоростью.

### Приватность и установка
* **Работа офлайн:** приложение можно установить на главный экран смартфона через меню браузера (*«На экран „Домой“»* в Chrome или Safari) как полноценное PWA. После первого запуска интернет не требуется.
* **Резервное копирование:** поскольку данные привязаны к хранилищу браузера, очистка кэша удалит библиотеку — для сохранения прогресса и заметок предусмотрен экспорт в `JSON`.

### Архитектура и лицензия
Самодостаточный `index.html` без этапа сборки. В основе лежат `epub.js`, `JSZip`, `Service Worker`, `IndexedDB` и собственные парсеры для `FB2`, `MOBI` (PalmDoc), `TXT` и `Markdown`. Исходный код открыт под лицензией **BSD-2-Clause**.

</details>
