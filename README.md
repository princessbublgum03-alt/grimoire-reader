GRIMOIRE — Offline Book Reader for Your Browser

A self-contained web reader with a local library. No accounts, no servers, no tracking — your books never leave your device.

Open the reader: https://princessbublgum03-alt.github.io/grimoire-reader/

GRIMOIRE is a single-page web application (one index.html file) that turns any browser — phone or desktop — into a full-featured e-book reader with a private library. Books are stored locally in your browser (IndexedDB), work offline, and are never uploaded anywhere.

Features

Library

Supported formats: EPUB, FB2, FB2.ZIP, TXT, MD, MOBI, PRC, AZW, AZW3

Import books one by one or add an entire folder at once

Automatic extraction of title, author, and cover art from the book file; if a book has no cover, a clean generated card is created

Reading progress is shown directly on each book card

Reading

Three visual themes: Abyss (dark), Parchment (light), and Void (black and gray)

Night filter with adjustable intensity

Nine reading fonts, including Literata, Lora, Spectral, Crimson Pro, and Merriweather

Adjustable text size, line height, column width, and text alignment

Focus mode: only the paragraph you are currently reading stays highlighted

Table of contents, full-text search, and automatic position saving

Reading tools

"Insight": highlight any term and the reader finds definition-like sentences elsewhere in the book

"Chapter gist": automatic summary of the key ideas of the current chapter

Quotes and notes with your own comments

A per-book glossary of collected terms

Export of notes, glossary, and bookmarks to JSON

Read aloud and speed reading

Text-to-speech (TTS): listen to a chapter or a selected passage

RSVP speed reading: words are shown one at a time at the optimal fixation point, 100–1000 words per minute

Auto-scroll with adjustable speed

Privacy and offline mode

All books, progress, notes, and settings are stored only on your device (IndexedDB)

Installable as a PWA: use "Add to Home Screen" on your phone

Works offline after the first visit

No sign-up, no analytics, no requests that send your data anywhere

Getting started

Open the reader in your browser using the link above

Press "+" and select your books (or a whole folder)

Tap a cover to start reading

On Android (Chrome) or iOS (Safari), choose "Add to Home Screen" to install it as an app

Note: clearing your browser data deletes the library. Use the JSON export in Settings to back up your notes and bookmarks.

Technical details

A single self-contained index.html file, no build step required

epub.js for EPUB rendering

JSZip for archive handling and as a fallback EPUB parser

IndexedDB for storage; Service Worker and PWA for offline support

Custom parsers for FB2, MOBI (PalmDoc), TXT, and Markdown

License

BSD-2-Clause (inherits the epub.js license)
