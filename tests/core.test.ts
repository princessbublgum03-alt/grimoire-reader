import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decodeBuffer,
  sanitizeHtml,
  chunkOversizedChapters,
  LRUCache,
  countWords,
  htmlToText
} from '../public/js/text-utils.js';

import {
  parsePlain,
  parseMarkdownBook,
  parseFB2Fallback,
  parseRTF,
  palmDocDecompress,
  parseMOBI
} from '../public/js/parsers.js';

import {
  summarize,
  findTermContext,
  searchChaptersAsync,
  highlightQueryHTML
} from '../public/js/analysis.js';

test('decodeBuffer handles UTF-8 BOM, UTF-16LE, and Windows-1251', () => {
  const utf8Bom = new Uint8Array([0xEF, 0xBB, 0xBF, 0xD0, 0x9F, 0xD1, 0x80, 0xD0, 0xB8, 0xD0, 0xB2, 0xD0, 0xB5, 0xD1, 0x82]);
  assert.equal(decodeBuffer(utf8Bom), 'Привет');

  const utf16Le = new Uint8Array([0xFF, 0xFE, 0x48, 0x00, 0x69, 0x00]);
  assert.equal(decodeBuffer(utf16Le), 'Hi');

  // Windows-1251 "Тест" -> 0xD2, 0xE5, 0xF1, 0xF2
  const win1251 = new Uint8Array([0xD2, 0xE5, 0xF1, 0xF2]);
  assert.equal(decodeBuffer(win1251), 'Тест');
});

test('sanitizeHtml strips scripts, event handlers, and javascript URIs', () => {
  const dirty = '<p onclick="evil()">Привет</p><script>alert(1)</script><a href="javascript:alert(2)">link</a>';
  const clean = sanitizeHtml(dirty);
  assert.equal(clean.includes('<script'), false);
  assert.equal(clean.includes('onclick'), false);
  assert.equal(clean.includes('javascript:'), false);
  assert.equal(clean.includes('Привет'), true);
});

test('chunkOversizedChapters splits large HTML chapters on block boundaries', () => {
  const para = '<p>' + 'Текст главы '.repeat(30) + '</p>';
  const bigHtml = para.repeat(200);
  const res = chunkOversizedChapters([{ title: 'Большая глава', html: bigHtml }], 5000);
  assert.ok(res.length > 3);
  assert.ok(res[0].title.startsWith('Большая глава (1/'));
  const totalJoined = res.map((c) => c.html).join('');
  assert.equal(totalJoined.length, bigHtml.length);
});

test('LRUCache evicts oldest keys and invokes onEvict', () => {
  const evicted = [];
  const cache = new LRUCache(2, (k, v) => evicted.push([k, v]));
  cache.set('a', 1);
  cache.set('b', 2);
  cache.get('a'); // refresh 'a'
  cache.set('c', 3); // evicts 'b'
  assert.deepEqual(evicted, [['b', 2]]);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('b'), undefined);
});

test('parsePlain and parseMarkdownBook split chapters cleanly', () => {
  const txt = 'Вступление '.repeat(60) + '\n\nГлава 2\n' + 'Основной текст главы номер два. '.repeat(25);
  const plain = parsePlain(txt, 'Книга');
  assert.equal(plain.chapters.length, 2);
  assert.equal(plain.chapters[1].title, 'Глава 2');

  const md = '# Пролог\n\nТекст пролога.\n\n## Развязка\n\n**Важный** фрагмент текста.';
  const parsedMd = parseMarkdownBook(md, 'Заголовок');
  assert.equal(parsedMd.chapters.length, 2);
  assert.ok(parsedMd.chapters[1].html.includes('<strong>Важный</strong>'));
});

test('parseRTF decodes CP1251 and CP1252 and skips fonttbl/bin safely', () => {
  const rtf = "{\\rtf1\\ansi\\ansicpg1251{\\fonttbl{\\f0 Arial;}}\\pard\\'cf\\'f0\\'e8\\'e2\\'e5\\'f2\\bin3 XYZ \\'ec\\'e8\\'f0\\par}";
  const buf = new TextEncoder().encode(rtf).buffer;
  const res = parseRTF(buf, 'Тест RTF');
  assert.equal(res.format, 'rtf');
  assert.ok(htmlToText(res.chapters[0].html).includes('Привет мир'));
  assert.equal(htmlToText(res.chapters[0].html).includes('XYZ'), false);
});

test('parseFB2Fallback recovers metadata and text from damaged XML', () => {
  const brokenFb2 = '<FictionBook><title-info><book-title>Тайна</book-title><first-name>Иван</first-name><last-name>Петров</last-name></title-info><body><p>Первый абзац книги.</p><unclosed></body>';
  const res = parseFB2Fallback(brokenFb2);
  assert.equal(res.title, 'Тайна');
  assert.equal(res.author, 'Иван Петров');
  assert.ok(htmlToText(res.chapters[0].html).includes('Первый абзац книги.'));
});

test('parseMOBI handles short header safely without RangeError and extracts uncompressed PalmDoc text', () => {
  const textStr = '<p>' + 'Содержимое книги MOBI для проверки парсера. '.repeat(4) + '</p>';
  const textBytes = new TextEncoder().encode(textStr);
  const rec0 = new Uint8Array(32); // deliberately shorter than 0x84!
  const dv0 = new DataView(rec0.buffer);
  dv0.setUint16(0, 1); // compression = 1 (none)
  dv0.setUint32(4, textBytes.length);
  dv0.setUint16(8, 1); // 1 text record

  const headerSize = 78 + 2 * 8; // 94 bytes -> pad to 100
  const rec0Offset = 100;
  const rec1Offset = rec0Offset + rec0.length;
  const full = new Uint8Array(rec1Offset + textBytes.length);
  const dv = new DataView(full.buffer);
  dv.setUint16(76, 2); // numRecords = 2
  dv.setUint32(78, rec0Offset);
  dv.setUint32(78 + 8, rec1Offset);
  full.set(rec0, rec0Offset);
  full.set(textBytes, rec1Offset);

  const res = parseMOBI(full.buffer, 'Книга MOBI');
  assert.equal(res.format, 'mobi');
  assert.ok(htmlToText(res.chapters[0].html).includes('Содержимое книги MOBI'));

  // Test palmDocDecompress literal + back-reference
  const comp = new Uint8Array([0x41, 0x42, 0x43, 0x80 | 0x00, 0x18]); // 'A','B','C' + back-ref dist=3 len=3 -> 'ABCABC'
  const dec = palmDocDecompress(comp);
  assert.equal(new TextDecoder().decode(dec), 'ABCABC');
});

test('analysis helpers summarize, find term context, and search chapters', async () => {
  const text = [
    'Архитектура автономных систем требует надёжного локального хранения данных.',
    'IndexedDB — это встроенная транзакционная база данных в браузере для больших объёмов.',
    'Service Worker перехватывает сетевые запросы и обеспечивает работу без интернета.',
    'Кэширование ресурсов снижает задержку запуска до нескольких миллисекунд.',
    'Пользователь может читать книги в метро и самолёте без сети.',
    'Резервное копирование в JSON гарантирует сохранность заметок и закладок.'
  ].join(' ');

  const summary = summarize(text, 2);
  assert.equal(summary.length, 2);

  const ctx = findTermContext(text, 'IndexedDB');
  assert.equal(ctx.defs.length, 1);
  assert.ok(ctx.defs[0].includes('встроенная транзакционная база данных'));

  const hits = await searchChaptersAsync(
    [
      { title: 'Глава 1', html: '<p>Первое упоминание термина ГРИМУАР в тексте.</p>' },
      { title: 'Глава 2', html: '<p>Обычный абзац.</p>' }
    ],
    'гримуар'
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].index, 0);
  assert.equal(highlightQueryHTML('Слово ГРИМУАР тут', 'гримуар'), 'Слово <mark class="search-hit">ГРИМУАР</mark> тут');
  assert.equal(countWords('Один два три'), 3);
});

test('public/ static assets use relative paths for GitHub Pages subfolder deployment', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const pubDir = path.resolve(process.cwd(), 'public');

  const html = fs.readFileSync(path.join(pubDir, 'index.html'), 'utf8');
  assert.ok(html.includes('</html>'), 'index.html must have closing </html>');
  for (const requiredId of [
    'id="boot"',
    'id="rsvp-overlay"',
    'id="rsvp-left"',
    'id="rsvp-orp"',
    'id="rsvp-right"',
    'id="btn-rsvp-play"',
    'id="rsvp-speed"',
    'id="toast"',
    'id="file-input"',
    'id="folder-input"',
    'id="cover-input"',
    'id="backup-input"'
  ]) {
    assert.ok(html.includes(requiredId), `index.html missing ${requiredId}`);
  }
  assert.equal(/(?:href|src)=["']\/(css|js|vendor|icons|manifest|sw)/.test(html), false);

  const manifest = JSON.parse(fs.readFileSync(path.join(pubDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.id, './');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  for (const icon of manifest.icons) {
    assert.ok(icon.src.startsWith('./icons/'), `Manifest icon must be relative: ${icon.src}`);
  }

  const parsersSrc = fs.readFileSync(path.join(pubDir, 'js', 'parsers.js'), 'utf8');
  assert.equal(parsersSrc.includes("'/vendor/"), false);
  assert.ok(parsersSrc.includes("'./vendor/pdf.min.js'"));
  assert.ok(parsersSrc.includes("'./vendor/pdf.worker.min.js'"));

  const swSrc = fs.readFileSync(path.join(pubDir, 'sw.js'), 'utf8');
  assert.ok(swSrc.includes('grimoire-shell-v5'));
  assert.equal(/['"]\/(css|js|vendor|icons|index\.html|manifest\.json)['"]/.test(swSrc), false);
});

test('DB.open rejects cleanly on timeout and onblocked without hanging', async () => {
  const { DB } = await import('../public/js/db.js');
  const origIDB = globalThis.indexedDB;
  try {
    // 1. Stalled open -> times out cleanly
    globalThis.indexedDB = {
      open: () => ({})
    } as unknown as IDBFactory;
    await assert.rejects(() => DB.open(40), /timeout/i);

    // 2. Blocked open -> rejects cleanly
    globalThis.indexedDB = {
      open: () => {
        const req: Record<string, unknown> = {};
        setTimeout(() => {
          if (typeof req.onblocked === 'function') (req.onblocked as () => void)();
        }, 5);
        return req;
      }
    } as unknown as IDBFactory;
    await assert.rejects(() => DB.open(500), /blocked/i);
  } finally {
    globalThis.indexedDB = origIDB;
  }
});
