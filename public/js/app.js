import {
  SUPPORTED_EXTS,
  MAX_FILE_SIZE,
  uid,
  escHTML,
  escRe,
  debounce,
  decodeBuffer,
  htmlToText,
  countWords,
  sanitizeHtml,
  LRUCache
} from './text-utils.js';

import {
  summarize,
  findTermContext,
  searchChaptersAsync,
  highlightQueryHTML
} from './analysis.js';

import {
  DB,
  saveBookContent,
  loadBookContent,
  purgeBookData,
  importBackupData
} from './db.js';

import {
  parsePlain,
  parseMarkdownBook,
  parseFB2,
  parseDOCX,
  parseODT,
  parseRTF,
  parseHTMLBook,
  parsePDF,
  parseCBZ,
  parseMOBI,
  readEpubMeta,
  parseEPUBFull
} from './parsers.js';

import { initPWAController } from './pwa.js';
import {
  applyReadingEnhancements,
  refreshBeeLineColors,
  createAmbientNoiseController,
  DEMO_ARTICLE
} from './focus-tools.js';

const $ = (s, r = document) => r.querySelector(s);

let toastTimer = null;
function toast(msg, ms = 2400) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function copyTextToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => toast('Скопировано в буфер'),
      () => fallbackCopy(text)
    );
    return;
  }
  fallbackCopy(text);
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    toast('Скопировано в буфер');
  } catch {
    toast('Не удалось скопировать');
  }
  ta.remove();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------- Настройки, Шрифты и Темы ---------- */
const FONTS = {
  lexend: { name: 'Lexend', family: "'Lexend','Nunito',system-ui,sans-serif", tag: 'фокус' },
  atkinson: { name: 'Atkinson', family: "'Atkinson Hyperlegible Next','IBM Plex Sans',system-ui,sans-serif", tag: 'СДВГ' },
  literata: { name: 'Literata', family: "'Literata',Georgia,serif", tag: 'книжный' },
  jetbrains: { name: 'JetBrains', family: "'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace", tag: 'моно' },
  georgia: { name: 'PT Serif', family: "'PT Serif',Georgia,'Times New Roman',serif", tag: 'классика' },
  palatino: { name: 'Spectral', family: "'Spectral','Palatino Linotype',Georgia,serif", tag: 'антиква' },
  lora: { name: 'Lora', family: "'Lora',Baskerville,Georgia,serif", tag: 'мягкий' },
  crimson: { name: 'Garamond', family: "'EB Garamond',Garamond,'Times New Roman',serif", tag: 'строгий' },
  sans: { name: 'Inter', family: "'Inter',ui-sans-serif,system-ui,-apple-system,sans-serif", tag: 'гротеск' }
};

const SETTINGS_LS_KEY = 'grimoire_settings_v1';

const DEFAULT_SETTINGS = {
  theme: 'abyss',
  fontSize: 20,
  lineHeight: 1.7,
  letterSpacing: 0,
  fontFamily: 'literata',
  maxWidth: 64,
  justify: false,
  indent: true,
  hyphens: true,
  tapZones: true,
  nightFilter: 0,
  focusMode: false,
  bionicReading: false,
  bionicStrength: 'medium',
  readingRuler: false,
  beelineMode: false,
  zenAutoHide: true,
  noiseMode: 'off',
  noiseVolume: 0.25,
  ttsRate: 1,
  ttsPitch: 1,
  rsvpSpeed: 300,
  autoScrollSpeed: 5,
  epubFlow: 'scrolled',
  epubTouchMigrated: true,
  updatedAt: 0
};

const THEMES = ['abyss', 'graphite', 'parchment', 'soft', 'sepia', 'forest', 'void'];
const THEME_NAMES = {
  abyss: 'Бездна',
  graphite: 'Графит',
  parchment: 'Бумага',
  soft: 'Мягкий',
  sepia: 'Сепия',
  forest: 'Чаща',
  void: 'OLED'
};
const THEME_COLORS = {
  abyss: '#0a0a0c',
  graphite: '#1a1b1e',
  parchment: '#f4ecd8',
  soft: '#eaeaea',
  sepia: '#1c1712',
  forest: '#0b110e',
  void: '#000000'
};

function readLocalSettings() {
  try {
    const raw = window.localStorage && window.localStorage.getItem(SETTINGS_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

let settings = { ...DEFAULT_SETTINGS, ...(readLocalSettings() || {}) };
const getFontFamily = (k) => (FONTS[k] || FONTS.literata).family;
const noiseController = createAmbientNoiseController();
let lastActiveNoiseMode = settings.noiseMode && settings.noiseMode !== 'off' ? settings.noiseMode : 'pink';

function updateFocusToolbarBadges() {
  const bionicBtn = $('#btn-bionic-quick');
  if (bionicBtn) {
    bionicBtn.classList.toggle('active', !!settings.bionicReading);
    bionicBtn.setAttribute('aria-pressed', settings.bionicReading ? 'true' : 'false');
  }
  const noiseActive = noiseController.getState().mode !== 'off';
  const noiseBtn = $('#btn-noise-quick');
  if (noiseBtn) {
    noiseBtn.classList.toggle('active', noiseActive);
    noiseBtn.setAttribute('aria-pressed', noiseActive ? 'true' : 'false');
  }
  const anyFocus = !!(
    settings.bionicReading ||
    settings.focusMode ||
    settings.readingRuler ||
    settings.beelineMode ||
    noiseActive
  );
  const focusBtn = $('#btn-focus-panel');
  if (focusBtn) {
    focusBtn.classList.toggle('active', anyFocus);
  }
}

function updateRulerVisibility() {
  const ruler = $('#reading-ruler');
  const reader = $('#reader');
  if (!ruler) return;
  const shouldShow = !!(settings.readingRuler && reader && !reader.hidden && !state.rendition);
  ruler.hidden = !shouldShow;
}

function applySettings() {
  const r = document.documentElement;
  r.dataset.theme = settings.theme;
  r.dataset.justify = settings.justify ? '1' : '0';
  r.dataset.indent = settings.indent ? '1' : '0';
  r.dataset.hyphens = settings.hyphens ? '1' : '0';
  r.dataset.focus = settings.focusMode ? '1' : '0';
  r.dataset.bionic = settings.bionicReading ? '1' : '0';
  r.dataset.beeline = settings.beelineMode ? '1' : '0';
  r.dataset.ruler = settings.readingRuler ? '1' : '0';
  r.style.setProperty('--fs', settings.fontSize + 'px');
  r.style.setProperty('--lh', String(settings.lineHeight));
  r.style.setProperty('--ls', Number(settings.letterSpacing || 0).toFixed(2) + 'px');
  r.style.setProperty('--maxw', String(settings.maxWidth));
  const family = getFontFamily(settings.fontFamily);
  r.style.setProperty('--reader-font', family);
  const inner = $('#reader-inner');
  if (inner) inner.style.fontFamily = family;
  r.style.setProperty('--night-opacity', String(settings.nightFilter / 100));
  const m = $('#meta-theme');
  if (m) m.setAttribute('content', THEME_COLORS[settings.theme] || '#0a0a0c');
  updateRulerVisibility();
  updateFocusToolbarBadges();
}

const persistSettingsToDB = debounce(() => DB.put('kv', settings, 'settings').catch(() => {}), 300);
function saveSettings() {
  settings.updatedAt = Date.now();
  try {
    if (window.localStorage) window.localStorage.setItem(SETTINGS_LS_KEY, JSON.stringify(settings));
  } catch { /* ignore */ }
  persistSettingsToDB();
}

async function loadSettings() {
  const local = readLocalSettings();
  try {
    const s = await DB.get('kv', 'settings');
    if (s && typeof s === 'object') {
      if (!s.fontFamily && typeof s.serif === 'boolean') s.fontFamily = s.serif ? 'georgia' : 'sans';
      if (!s.epubTouchMigrated) {
        s.epubFlow = 'scrolled';
        s.epubTouchMigrated = true;
      }
      const localTs = (local && Number(local.updatedAt)) || 0;
      const dbTs = Number(s.updatedAt) || 0;
      if (local && localTs >= dbTs) {
        settings = { ...DEFAULT_SETTINGS, ...s, ...local };
      } else {
        settings = { ...DEFAULT_SETTINGS, ...s };
      }
    } else if (local) {
      settings = { ...DEFAULT_SETTINGS, ...local };
    }
  } catch {
    if (local) settings = { ...DEFAULT_SETTINGS, ...local };
  }
  if (settings.noiseMode && settings.noiseMode !== 'off') {
    lastActiveNoiseMode = settings.noiseMode;
  }
}

/* ---------- Генерация обложек (LRU Cache) ---------- */
const coverCache = new LRUCache(80);

function wrapCanvasText(ctx, text, x, y, maxW, lineH, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
      if (lines.length >= maxLines) break;
    } else {
      line = test;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  const startY = y - ((lines.length - 1) * lineH) / 2;
  lines.forEach((l, i) => ctx.fillText(l, x, startY + i * lineH));
}

function generateCover(title, author) {
  const W = 360;
  const H = 540;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d');
  let seed = 0;
  for (const ch of (title + '|' + (author || ''))) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const g = x.createLinearGradient(0, 0, W * 0.6, H);
  g.addColorStop(0, '#0d0d11');
  g.addColorStop(0.5, '#15151b');
  g.addColorStop(1, '#070709');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  x.strokeStyle = 'rgba(197,160,89,.32)';
  x.lineWidth = 1;
  const cx = W / 2;
  const cy = H * 0.29;
  const R = 42 + rnd() * 10;
  x.beginPath();
  x.arc(cx, cy, R, 0, Math.PI * 2);
  x.stroke();
  x.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + i * ((2 * Math.PI) / 3);
    const px = cx + Math.cos(a) * R * 0.85;
    const py = cy + Math.sin(a) * R * 0.85;
    if (i) x.lineTo(px, py);
    else x.moveTo(px, py);
  }
  x.closePath();
  x.stroke();
  x.strokeStyle = 'rgba(197,160,89,.22)';
  x.strokeRect(16.5, 16.5, W - 33, H - 33);
  x.textAlign = 'center';
  x.fillStyle = '#c8c8d0';
  x.font = '600 24px Georgia,serif';
  wrapCanvasText(x, (title || 'Без названия').toUpperCase(), W / 2, H * 0.6, W - 72, 30, 4);
  x.fillStyle = 'rgba(197,160,89,.72)';
  x.font = 'italic 14px Georgia,serif';
  wrapCanvasText(x, author || '—', W / 2, H - 64, W - 80, 18, 2);
  const dataUrl = c.toDataURL('image/jpeg', 0.84);
  c.width = 0;
  c.height = 0;
  return dataUrl;
}

function getCoverFor(b) {
  if (b.cover) return b.cover;
  const cached = coverCache.get(b.id);
  if (cached) return cached;
  const c = generateCover(b.title, b.author);
  coverCache.set(b.id, c);
  return c;
}

/* ---------- Импорт книг и архивов ---------- */
async function parseByFormat(ext, buf, baseTitle, bookId) {
  if (ext === 'epub') {
    await DB.put('files', buf, bookId);
    try {
      return await parseEPUBFull(buf, baseTitle, bookId);
    } catch {
      const em = await readEpubMeta(buf);
      return {
        partialEpub: true,
        format: 'epub',
        title: em.title || baseTitle,
        author: em.author || '',
        cover: em.cover || null
      };
    }
  }
  if (ext === 'fb2') return parseFB2(decodeBuffer(buf));
  if (ext === 'docx') return parseDOCX(buf, baseTitle);
  if (ext === 'odt') return parseODT(buf, baseTitle);
  if (ext === 'rtf') return parseRTF(buf, baseTitle);
  if (ext === 'pdf') return parsePDF(buf, baseTitle);
  if (ext === 'cbz') return parseCBZ(buf, baseTitle, bookId);
  if (['html', 'htm', 'xhtml'].includes(ext)) return parseHTMLBook(decodeBuffer(buf), baseTitle);
  if (['mobi', 'prc', 'azw', 'azw3'].includes(ext)) return parseMOBI(buf, baseTitle);
  const text = decodeBuffer(buf);
  const res = ext === 'md' || ext === 'markdown' ? parseMarkdownBook(text, baseTitle) : parsePlain(text, baseTitle);
  res.format = ext === 'markdown' ? 'md' : ext;
  return res;
}

async function importOne(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const id = uid();
  const baseTitle = file.name.replace(/\.(fb2\.zip|[^.]+)$/i, '');
  const meta = {
    id,
    title: baseTitle,
    author: '',
    format: ext,
    cover: null,
    addedAt: Date.now(),
    lastReadAt: 0,
    size: file.size,
    chaptersCount: 1,
    wordsCount: 0
  };
  let parsed = null;
  const buf = await file.arrayBuffer();

  if (ext === 'zip') {
    if (typeof window.JSZip === 'undefined') throw new Error('Модуль распаковки ZIP не загружен');
    const zip = await window.JSZip.loadAsync(buf);
    const files = Object.values(zip.files).filter((f) => !f.dir && !f.name.includes('__MACOSX'));
    const entry = files.find((f) => /\.(fb2|epub|docx|odt|rtf|pdf|mobi|prc|azw|azw3|html|htm|xhtml|txt|md|markdown)$/i.test(f.name));
    if (entry) {
      const subExt = entry.name.split('.').pop().toLowerCase();
      const subBuf = await entry.async('arraybuffer');
      parsed = await parseByFormat(subExt, subBuf, baseTitle, id);
    } else if (files.some((f) => /\.(jpe?g|png|webp|gif)$/i.test(f.name))) {
      parsed = await parseCBZ(buf, baseTitle, id);
    } else {
      throw new Error('В ZIP-архиве нет поддерживаемых книг');
    }
  } else {
    parsed = await parseByFormat(ext, buf, baseTitle, id);
  }

  if (parsed && parsed.partialEpub) {
    meta.format = 'epub';
    meta.title = parsed.title || baseTitle;
    meta.author = parsed.author || '';
    meta.cover = parsed.cover || null;
  } else if (parsed) {
    if (!parsed.chapters || !parsed.chapters.length) throw new Error('Текст книги пуст');
    meta.title = parsed.title || baseTitle;
    meta.author = parsed.author || '';
    meta.format = parsed.format || ext;
    meta.cover = parsed.cover || null;
    meta.chaptersCount = parsed.chapters.length;
    meta.wordsCount = parsed.chapters.reduce((acc, ch) => acc + countWords(htmlToText(ch.html)), 0);
    await saveBookContent(id, {
      chapters: parsed.chapters,
      notes: parsed.notes || {},
      assets: parsed.assets || []
    });
  }

  if (!meta.cover) meta.cover = generateCover(meta.title, meta.author);
  await DB.put('books', meta);
  return meta;
}

async function getBookContent(book) {
  if (book.chapters && book.chapters.length) return { chapters: book.chapters, notes: book.notes || {} };
  const stored = await loadBookContent(book.id);
  if (stored && stored.chapters && stored.chapters.length) return stored;
  if (book.format === 'epub') {
    const buf = await DB.get('files', book.id).catch(() => null);
    if (buf) {
      try {
        const parsed = await parseEPUBFull(buf, book.title, book.id);
        await saveBookContent(book.id, {
          chapters: parsed.chapters,
          notes: parsed.notes || {},
          assets: parsed.assets || []
        }).catch(() => {});
        return { chapters: parsed.chapters, notes: parsed.notes || {} };
      } catch { /* ignore */ }
    }
  }
  return stored || { chapters: [], notes: {} };
}

async function handleFiles(fileList) {
  const files = [...(fileList || [])].filter(
    (f) => f && f.name && !f.name.startsWith('.') && f.size > 0 && f.size < MAX_FILE_SIZE &&
      SUPPORTED_EXTS.includes((f.name.split('.').pop() || '').toLowerCase())
  );
  if (!files.length) return toast('Нет подходящих файлов');
  toast('Импорт · ' + files.length + ' файл(ов)…', 60000);
  const errors = [];
  let ok = 0;
  for (let i = 0; i < files.length; i++) {
    try {
      const rec = await importOne(files[i]);
      ok++;
      toast('[' + (i + 1) + '/' + files.length + '] ' + rec.title, 1200);
    } catch (e) {
      errors.push({ name: files[i].name, error: e.message || 'Ошибка чтения' });
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  await loadLibrary();
  if (errors.length) showImportErrors(errors, ok, files.length);
  else toast('Добавлено книг: ' + ok, 2500);
}

function showImportErrors(errors, ok, total) {
  let body = ok > 0 ? `<p class="hint" style="color:var(--accent);margin-bottom:14px">Успешно импортировано: ${ok} из ${total}</p>` : '';
  errors.forEach((e) => {
    body += `<div class="err-row"><b>${escHTML(e.name)}</b><span>${escHTML(e.error)}</span></div>`;
  });
  body += '<div style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn-ghost" data-act="close">Закрыть</button></div>';
  const ov = openSheet('Ошибки импорта', body);
  ov._body.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="close"]')) closeSheet();
  });
}

/* ---------- Библиотека ---------- */
let libraryCache = [];
let progressMap = {};
let libFilterFormat = 'all';
let libSearchQuery = '';
let libSortBy = 'recent';

async function loadLibrary() {
  libraryCache = [];
  progressMap = {};
  try {
    const [books, progress] = await Promise.all([
      DB.getAll('books'),
      DB.getAll('progress').catch(() => [])
    ]);
    libraryCache = (books || []).filter((b) => !b.deleted);
    (progress || []).forEach((p) => {
      if (p && p.id) progressMap[p.id] = p;
    });
  } catch {
    libraryCache = [];
    progressMap = {};
  }
  renderLibrary();
}

function renderLibrary() {
  const grid = $('#grid');
  const empty = $('#empty');
  const controls = $('#lib-controls');

  if (!libraryCache.length) {
    grid.innerHTML = '';
    controls.hidden = true;
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  controls.hidden = false;

  const formats = ['all', ...new Set(libraryCache.map((b) => (b.format || 'txt').toLowerCase()))];
  if (!formats.includes(libFilterFormat)) libFilterFormat = 'all';
  const pillsWrap = $('#lib-format-pills');
  pillsWrap.innerHTML = formats
    .map((f) => `<button type="button" class="filter-pill ${libFilterFormat === f ? 'on' : ''}" data-fmt="${escHTML(f)}">${f === 'all' ? 'Все' : escHTML(f.toUpperCase())}</button>`)
    .join('');

  const q = libSearchQuery.trim().toLowerCase();
  const list = libraryCache.filter((b) => {
    if (libFilterFormat !== 'all' && (b.format || 'txt').toLowerCase() !== libFilterFormat) return false;
    if (q) {
      const hay = ((b.title || '') + ' ' + (b.author || '')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  list.sort((a, b) => {
    if (libSortBy === 'title') return (a.title || '').localeCompare(b.title || '', 'ru');
    if (libSortBy === 'progress') {
      const pa = (progressMap[a.id] && progressMap[a.id].percent) || 0;
      const pb = (progressMap[b.id] && progressMap[b.id].percent) || 0;
      return pb - pa;
    }
    if (libSortBy === 'added') return (b.addedAt || 0) - (a.addedAt || 0);
    const ra = (progressMap[a.id] && progressMap[a.id].updatedAt) || a.lastReadAt || a.addedAt || 0;
    const rb = (progressMap[b.id] && progressMap[b.id].updatedAt) || b.lastReadAt || b.addedAt || 0;
    return rb - ra;
  });

  grid.innerHTML = '';
  if (!list.length) {
    grid.innerHTML = '<p class="hint" style="grid-column:1/-1;text-align:center;padding:40px 0">По вашему запросу книг не найдено.</p>';
    return;
  }
  const frag = document.createDocumentFragment();
  for (const b of list) {
    const pct = Math.round(((progressMap[b.id] && progressMap[b.id].percent) || 0) * 100);
    const card = document.createElement('article');
    card.className = 'book-card';
    card.dataset.id = b.id;
    const safeTitle = escHTML(b.title || 'Без названия');
    card.innerHTML = `
      <button type="button" class="book-open-btn" aria-label="Открыть «${safeTitle}»">
        <div class="book-cover">
          <img src="${getCoverFor(b)}" loading="lazy" decoding="async" alt="">
          <span class="book-badge">${escHTML((b.format || 'txt').toUpperCase())}</span>
        </div>
        <div class="book-title">${safeTitle}</div>
        <div class="book-author">${escHTML(b.author || 'Неизвестен')}</div>
        <div class="book-bar" title="Прочитано: ${pct}%"><i style="width:${pct}%"></i></div>
      </button>
      <button type="button" class="book-del" title="Меню книги" aria-label="Меню книги «${safeTitle}»">
        <svg viewBox="0 0 24 24" style="width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
      </button>`;
    frag.appendChild(card);
  }
  grid.appendChild(frag);
}

async function purgeBook(id) {
  fullTextCache.delete(id);
  coverCache.delete(id);
  await purgeBookData(id);
}

async function showBookMenu(id) {
  const book = await DB.get('books', id);
  if (!book) return;
  const pct = Math.round(((progressMap[id] && progressMap[id].percent) || 0) * 100);
  const sizeKb = book.size ? Math.round(book.size / 1024) + ' КБ' : '';
  const html = `
    <div style="display:flex;gap:14px;margin-bottom:18px">
      <img src="${escHTML(getCoverFor(book))}" alt="" style="width:68px;aspect-ratio:2/3;object-fit:cover;border:1px solid var(--line)">
      <div style="min-width:0;flex:1">
        <div style="font-family:var(--serif);font-size:15px;margin-bottom:4px">${escHTML(book.title || 'Без названия')}</div>
        <div style="font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:8px">${escHTML(book.author || 'Автор не указан')}</div>
        <div class="hint">${escHTML((book.format || '').toUpperCase())} ${sizeKb ? '· ' + sizeKb : ''} · Прогресс: ${pct}%</div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <button class="btn-ghost" data-act="editmeta" style="justify-content:center">Изменить название / автора</button>
      <button class="btn-ghost" data-act="cover" style="justify-content:center">Сменить обложку</button>
      ${book.customCover ? '<button class="btn-ghost" data-act="resetcover" style="justify-content:center">Сбросить обложку</button>' : ''}
      <button class="btn-ghost" data-act="trash" style="justify-content:center">Убрать в корзину</button>
      <button class="btn-ghost" data-act="purge" style="justify-content:center;border-color:rgba(200,90,70,.5);color:#c96a58">Удалить навсегда</button>
    </div>`;
  const ov = openSheet('О книге', html);
  ov._body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'cover') pickCover(id);
    else if (act === 'editmeta') {
      closeSheet();
      const ev = openSheet(
        'Метаданные',
        `<div class="field"><label for="edit-title">Название</label><input type="text" id="edit-title" class="lib-search" style="padding:10px" value="${escHTML(book.title || '')}"></div>
         <div class="field"><label for="edit-author">Автор</label><input type="text" id="edit-author" class="lib-search" style="padding:10px" value="${escHTML(book.author || '')}"></div>
         <div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn-ghost" data-act="cancel">Отмена</button><button class="btn-ghost btn-solid" data-act="save">Сохранить</button></div>`
      );
      ev._body.addEventListener('click', async (e2) => {
        const btn = e2.target.closest('[data-act]');
        if (!btn) return;
        if (btn.dataset.act === 'cancel') closeSheet();
        if (btn.dataset.act === 'save') {
          book.title = ev._body.querySelector('#edit-title').value.trim() || 'Без названия';
          book.author = ev._body.querySelector('#edit-author').value.trim();
          if (!book.customCover) book.cover = generateCover(book.title, book.author);
          await DB.put('books', book);
          coverCache.delete(id);
          closeSheet();
          await loadLibrary();
          toast('Метаданные обновлены');
        }
      });
    } else if (act === 'resetcover') {
      const rec = await DB.get('books', id);
      if (rec) {
        rec.cover = generateCover(rec.title, rec.author);
        rec.customCover = false;
        await DB.put('books', rec);
      }
      coverCache.delete(id);
      closeSheet();
      await loadLibrary();
      toast('Обложка сброшена');
    } else if (act === 'trash') {
      const rec = await DB.get('books', id);
      if (rec) {
        rec.deleted = true;
        rec.deletedAt = Date.now();
        await DB.put('books', rec);
      }
      fullTextCache.delete(id);
      closeSheet();
      await loadLibrary();
      toast('Книга перемещена в корзину');
    } else if (act === 'purge') {
      closeSheet();
      if (await confirmDialog('Удалить книгу и все связанные заметки без возможности восстановления?', 'Удалить')) {
        await purgeBook(id);
        await loadLibrary();
        toast('Книга удалена');
      }
    }
  });
}

async function showTrash() {
  const all = (await DB.getAll('books')) || [];
  const deleted = all.filter((b) => b.deleted).sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  let html = deleted.length ? '' : '<p class="hint">Корзина пуста.</p>';
  deleted.forEach((b) => {
    html += `<div style="display:flex;gap:12px;align-items:center;margin-bottom:12px">
      <img src="${escHTML(getCoverFor(b))}" alt="" style="width:42px;aspect-ratio:2/3;object-fit:cover;border:1px solid var(--line)">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHTML(b.title || 'Без названия')}</div>
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.12em;margin-top:2px">${escHTML(b.author || b.format || '')}</div>
      </div>
      <button class="icon-btn trash-restore" data-id="${escHTML(b.id)}" title="Восстановить" aria-label="Восстановить"><svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg></button>
      <button class="icon-btn trash-purge" data-id="${escHTML(b.id)}" title="Удалить навсегда" aria-label="Удалить навсегда" style="color:#c96a58"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>`;
  });
  if (deleted.length) {
    html += '<div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="btn-ghost" id="btn-empty-trash" style="border-color:rgba(200,90,70,.5);color:#c96a58">Очистить корзину</button></div>';
  }
  const ov = openSheet('Корзина', html);
  ov._body.addEventListener('click', async (e) => {
    const rest = e.target.closest('.trash-restore');
    const prg = e.target.closest('.trash-purge');
    const emp = e.target.closest('#btn-empty-trash');
    if (rest) {
      const rec = await DB.get('books', rest.dataset.id);
      if (rec) {
        delete rec.deleted;
        delete rec.deletedAt;
        await DB.put('books', rec);
      }
      closeSheet();
      await loadLibrary();
      toast('Книга восстановлена');
    } else if (prg) {
      await purgeBook(prg.dataset.id);
      closeSheet();
      await loadLibrary();
      toast('Удалено навсегда');
    } else if (emp) {
      if (!(await confirmDialog('Очистить корзину безвозвратно?', 'Очистить'))) return;
      for (const b of deleted) await purgeBook(b.id);
      closeSheet();
      await loadLibrary();
      toast('Корзина очищена');
    }
  });
}

let coverTargetId = null;
function pickCover(id) {
  coverTargetId = id;
  const inp = $('#cover-input');
  inp.value = '';
  inp.click();
}

function readImageAsCover(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          const H = 540;
          const W = Math.max(200, Math.min(1000, Math.round(H * (img.width / img.height))));
          const c = document.createElement('canvas');
          c.width = W;
          c.height = H;
          c.getContext('2d').drawImage(img, 0, 0, W, H);
          const out = c.toDataURL('image/jpeg', 0.84);
          c.width = 0;
          c.height = 0;
          res(out);
        } catch (e) {
          rej(e);
        }
      };
      img.onerror = rej;
      img.src = fr.result;
    };
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}

async function onCoverPicked(e) {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f || !coverTargetId) return;
  try {
    const dataUrl = await readImageAsCover(f);
    const rec = await DB.get('books', coverTargetId);
    if (rec) {
      rec.cover = dataUrl;
      rec.customCover = true;
      await DB.put('books', rec);
    }
    coverCache.delete(coverTargetId);
    closeSheet();
    await loadLibrary();
    toast('Обложка обновлена');
  } catch {
    toast('Не удалось загрузить изображение');
  }
}

/* ---------- Статистика и Резервное копирование ---------- */
async function showStatsSheet() {
  await flushReadingSession();
  const stats = (await DB.get('kv', 'stats')) || { minutes: 0, words: 0 };
  const notes = (await DB.getAll('notes')) || [];
  const bms = (await DB.getAll('bookmarks')) || [];
  const gloss = (await DB.getAll('glossary')) || [];
  const finished = libraryCache.filter((b) => ((progressMap[b.id] && progressMap[b.id].percent) || 0) >= 0.95).length;
  const totalMins = Math.round(stats.minutes || 0);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  const timeStr = hrs > 0 ? `${hrs} ч ${mins} м` : `${mins} мин`;
  const wordsStr = (stats.words || 0).toLocaleString('ru-RU');

  const html = `
  <div class="stat-grid">
    <div class="stat-card"><div class="stat-val">${libraryCache.length}</div><div class="stat-lbl">Книг в библиотеке</div></div>
    <div class="stat-card"><div class="stat-val">${finished}</div><div class="stat-lbl">Прочитано книг</div></div>
    <div class="stat-card"><div class="stat-val">${timeStr}</div><div class="stat-lbl">Время за чтением</div></div>
    <div class="stat-card"><div class="stat-val">${wordsStr}</div><div class="stat-lbl">Прочитано слов</div></div>
  </div>
  <div class="stat-grid" style="margin-top:-8px">
    <div class="stat-card"><div class="stat-val">${notes.length}</div><div class="stat-lbl">Сохранённых цитат</div></div>
    <div class="stat-card"><div class="stat-val">${bms.length} / ${gloss.length}</div><div class="stat-lbl">Закладки / Словарь</div></div>
  </div>
  <div class="field"><label>Резервная копия данных (заметки, закладки, словарь, прогресс)</label>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn-ghost" id="btn-export-backup" style="flex:1;justify-content:center">Экспорт JSON</button>
      <button class="btn-ghost" id="btn-import-backup" style="flex:1;justify-content:center">Импорт JSON</button>
    </div>
  </div>`;

  const ov = openSheet('Статистика', html);
  ov._body.querySelector('#btn-export-backup').addEventListener('click', async () => {
    const data = {
      version: 3,
      exportedAt: Date.now(),
      settings,
      stats,
      progress: await DB.getAll('progress'),
      notes,
      bookmarks: bms,
      glossary: gloss
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `grimoire-backup-${new Date().toISOString().slice(0, 10)}.json`);
    toast('Резервная копия сохранена');
  });
  ov._body.querySelector('#btn-import-backup').addEventListener('click', () => $('#backup-input').click());
}

/* ---------- Читалка и Счётчик статистики ---------- */
const state = {
  current: null,
  chapters: null,
  notes: null,
  chapterIndex: 0,
  chapterWords: 0,
  epub: null,
  rendition: null,
  toc: [],
  progress: null,
  selection: '',
  barsVisible: true,
  isSpeaking: false,
  isAutoScrolling: false,
  autoScrollTimer: null,
  lastScrollY: 0,
  readingTickAt: null,
  sessionMs: 0,
  lastWordsRatio: 0,
  sessionWords: 0
};

const fullTextCache = new LRUCache(3);
let activeAssetUrls = [];
let cachedParagraphs = [];
let lastFocusedPara = null;
let statsInterval = null;

function revokeActiveAssetUrls() {
  for (const u of activeAssetUrls) {
    try { URL.revokeObjectURL(u); } catch { /* ignore */ }
  }
  activeAssetUrls = [];
}

async function resolveChapterAssets(container) {
  const imgs = [...container.querySelectorAll('img[data-asset]')];
  if (!imgs.length) return;
  await Promise.all(imgs.map(async (img) => {
    const key = img.getAttribute('data-asset');
    if (!key) return;
    try {
      const blob = await DB.get('assets', key);
      if (blob instanceof Blob) {
        const url = URL.createObjectURL(blob);
        activeAssetUrls.push(url);
        img.src = url;
      }
    } catch { /* ignore */ }
  }));
}

async function flushReadingSession() {
  if (!state.current) return;
  const now = Date.now();
  if (state.readingTickAt && document.visibilityState === 'visible') {
    const delta = Math.min(60000, Math.max(0, now - state.readingTickAt));
    state.sessionMs += delta;
  }
  state.readingTickAt = now;

  const wholeMinutes = Math.floor(state.sessionMs / 60000);
  const wordsDelta = Math.max(0, Math.round(state.sessionWords));

  if (wholeMinutes > 0 || wordsDelta > 0) {
    state.sessionMs -= wholeMinutes * 60000;
    state.sessionWords -= wordsDelta;
    try {
      const stats = (await DB.get('kv', 'stats')) || { minutes: 0, words: 0 };
      stats.minutes = (stats.minutes || 0) + wholeMinutes;
      stats.words = (stats.words || 0) + wordsDelta;
      await DB.put('kv', stats, 'stats');
    } catch { /* ignore */ }
  }
}

function startStatsTracking() {
  stopStatsTracking();
  state.readingTickAt = Date.now();
  statsInterval = setInterval(() => {
    flushReadingSession();
  }, 15000);
}

function stopStatsTracking() {
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
}

const showReader = (show) => {
  $('#reader').hidden = !show;
  if (show) {
    setBars(true);
    updateRulerVisibility();
    updateFocusToolbarBadges();
  } else {
    stopAllActions();
    updateRulerVisibility();
  }
};
const setBars = (v) => {
  state.barsVisible = v;
  $('#reader').classList.toggle('bars-hidden', !v);
};
const setReaderMeta = (t, c) => {
  $('#rt-book').textContent = t || '';
  $('#rt-chapter').textContent = c || '';
};

function setPercent(p) {
  p = Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0));
  const w = (p * 100).toFixed(2) + '%';
  $('#progress-fill').style.width = w;
  const topFill = $('#top-progress-fill');
  if (topFill) topFill.style.width = w;
  $('#rt-percent').textContent = Math.round(p * 100) + '%';
}

async function openBook(id) {
  const book = (await DB.get('books', id)) || null;
  if (!book) {
    toast('Книга не найдена');
    return;
  }
  closeSheet();
  hideTermPill();
  book.lastReadAt = Date.now();
  await DB.put('books', book).catch(() => {});
  state.current = book;
  state.chapterIndex = 0;
  state.sessionMs = 0;
  state.sessionWords = 0;
  state.lastWordsRatio = 0;
  state.progress = await DB.get('progress', id).catch(() => null);
  showReader(true);
  setReaderMeta(book.title, 'Загрузка…');
  startStatsTracking();

  if (book.format === 'epub' && settings.epubFlow === 'paginated') {
    state.chapters = null;
    state.notes = null;
    $('#reader-body').hidden = true;
    $('#epub-host').hidden = false;
    $('#quick-nav-container').style.display = 'none';
    $('#rt-ch-count').textContent = 'EPUB';
    $('#rt-time-left').textContent = '';
    await openEpub(book, state.progress);
  } else {
    if (state.rendition) {
      try { state.rendition.destroy(); } catch { /* ignore */ }
      state.rendition = null;
    }
    if (state.epub) {
      try { state.epub.destroy(); } catch { /* ignore */ }
      state.epub = null;
    }
    $('#epub-host').hidden = true;
    $('#reader-body').hidden = false;
    const content = await getBookContent(book);
    if ((!content.chapters || !content.chapters.length) && book.format === 'epub') {
      $('#reader-body').hidden = true;
      $('#epub-host').hidden = false;
      await openEpub(book, state.progress);
      return;
    }
    state.chapters = content.chapters || [];
    state.notes = content.notes || {};
    let prog = state.progress;
    if (prog && prog.chapter === undefined && typeof prog.percent === 'number' && state.chapters.length) {
      const exact = prog.percent * state.chapters.length;
      prog = { ...prog, chapter: Math.min(state.chapters.length - 1, Math.floor(exact)), ratio: exact % 1 };
    }
    openCustom(book, prog);
  }
}

async function openEpub(book, prog) {
  const host = $('#epub-host');
  host.innerHTML = '';
  const buf = await DB.get('files', book.id).catch(() => null);
  if (!buf) {
    toast('Файл книги не найден');
    return closeReader();
  }
  if (typeof window.ePub === 'undefined') {
    toast('Модуль EPUB не загружен');
    return closeReader();
  }
  try {
    const eb = window.ePub(buf.slice(0));
    state.epub = eb;
    await eb.ready;
    const rendition = eb.renderTo(host, {
      width: '100%',
      height: '100%',
      flow: settings.epubFlow === 'scrolled' ? 'scrolled-doc' : 'paginated',
      spread: 'none'
    });
    state.rendition = rendition;

    rendition.hooks.content.register((contents) => {
      try {
        const doc = contents.document;
        injectEpubStyles(doc);
        let sx = 0, sy = 0, moved = false, horiz = null;
        doc.addEventListener('touchstart', (e) => {
          if (e.touches && e.touches.length === 1) {
            sx = e.touches[0].clientX;
            sy = e.touches[0].clientY;
            moved = false;
            horiz = null;
            host.classList.add('swiping');
          }
        }, { passive: true });
        doc.addEventListener('touchmove', (e) => {
          if (!e.touches || e.touches.length !== 1) return;
          const dx = e.touches[0].clientX - sx;
          const dy = e.touches[0].clientY - sy;
          if (Math.abs(dx) > 12 || Math.abs(dy) > 12) moved = true;
          if (horiz === null && (Math.abs(dx) > 14 || Math.abs(dy) > 14)) horiz = Math.abs(dx) > Math.abs(dy) * 1.2;
          if (horiz) host.style.transform = `translate3d(${dx * 0.42}px,0,0)`;
        }, { passive: true });
        doc.addEventListener('touchend', (e) => {
          host.classList.remove('swiping');
          const t = e.changedTouches && e.changedTouches[0];
          if (!t) {
            host.style.transform = '';
            return;
          }
          try {
            if (contents.window.getSelection().toString().trim()) {
              host.style.transform = '';
              return;
            }
          } catch { /* ignore */ }
          const dx = t.clientX - sx;
          const dy = t.clientY - sy;
          if (horiz && Math.abs(dx) > 52 && Math.abs(dy) < 60) {
            moved = true;
            const dir = dx > 0 ? 1 : -1;
            host.style.transform = `translate3d(${dir * 48}px,0,0)`;
            host.style.opacity = '0.45';
            setTimeout(() => {
              if (dir > 0) rendition.prev();
              else rendition.next();
              host.classList.add('swiping');
              host.style.transform = `translate3d(${-dir * 32}px,0,0)`;
              requestAnimationFrame(() => {
                host.classList.remove('swiping');
                host.style.transform = '';
                host.style.opacity = '1';
              });
            }, 110);
          } else {
            host.style.transform = '';
          }
        }, { passive: true });
        doc.addEventListener('click', (e) => {
          if (moved) {
            moved = false;
            return;
          }
          try {
            if (contents.window.getSelection().toString().trim()) return;
          } catch { /* ignore */ }
          const w = contents.window.innerWidth || doc.documentElement.clientWidth || 0;
          const x = e.clientX || 0;
          if (settings.epubFlow !== 'scrolled' && settings.tapZones) {
            if (x < w * 0.28) return rendition.prev();
            if (x > w * 0.72) return rendition.next();
          }
          setBars(!state.barsVisible);
        });
      } catch { /* ignore */ }
    });

    applyEpubTheme();
    rendition.on('rendered', applyEpubTheme);

    try {
      const nav = await eb.loaded.navigation;
      const flat = [];
      const walk = (items) => (items || []).forEach((i) => {
        flat.push({ label: (i.label || '').trim() || 'Раздел', href: i.href });
        if (i.subitems) walk(i.subitems);
      });
      walk(nav && nav.toc);
      state.toc = flat;
    } catch {
      state.toc = [];
    }

    rendition.on('relocated', (loc) => {
      const start = loc.start || {};
      let pct = start.percentage;
      const totalItems = (eb.spine && eb.spine.spineItems && eb.spine.spineItems.length) || 1;
      if (typeof pct !== 'number' || !Number.isFinite(pct)) pct = (start.index || 0) / totalItems;
      setPercent(pct);
      $('#rt-ch-count').textContent = `${(start.index || 0) + 1} / ${totalItems}`;
      let label = 'Глава ' + ((start.index || 0) + 1);
      if (state.toc.length && start.href) {
        const found = state.toc.find((t) => String(t.href).split('#')[0] === String(start.href).split('#')[0]);
        if (found) label = found.label;
      }
      setReaderMeta(book.title, label);
      state.sessionWords += 120;
      saveEpubProgress(loc);
    });

    rendition.on('selected', (_cfiRange, contents) => {
      try {
        const t = contents.window.getSelection().toString().trim();
        if (t && t.length >= 2 && t.length <= 250) showTermPill(t);
        else hideTermPill();
      } catch { /* ignore */ }
    });

    await rendition.display(prog && prog.cfi ? prog.cfi : undefined).catch(() => rendition.display());
    if (prog && prog.percent) setPercent(prog.percent);
  } catch (e) {
    toast('Не удалось открыть EPUB');
    console.error(e);
  }
}

let themeSeq = 0;

function injectEpubStyles(doc) {
  if (!doc || !doc.head) return;
  const fontsLink = $('#grimoire-fonts-css');
  if (fontsLink && fontsLink.href && !doc.getElementById('grimoire-epub-fonts')) {
    const link = doc.createElement('link');
    link.id = 'grimoire-epub-fonts';
    link.rel = 'stylesheet';
    link.href = fontsLink.href;
    doc.head.appendChild(link);
  }
  const cs = getComputedStyle(document.documentElement);
  const bg = cs.getPropertyValue('--bg').trim();
  const text = cs.getPropertyValue('--text').trim();
  const accent = cs.getPropertyValue('--accent').trim();
  const sel = cs.getPropertyValue('--sel').trim();
  const family = getFontFamily(settings.fontFamily);
  const ls = Number(settings.letterSpacing || 0).toFixed(2) + 'px';
  const align = settings.justify ? 'justify' : 'left';
  const indent = settings.indent ? '1.4em' : '0';
  const css = `
    html, body { background: ${bg} !important; color: ${text} !important; font-family: ${family} !important; font-size: ${settings.fontSize}px !important; line-height: ${settings.lineHeight} !important; letter-spacing: ${ls} !important; }
    body { padding: 0 8px !important; margin: 0 !important; }
    p, div, span, li, blockquote, section, article, td, th, font, em, strong, b, i, h1, h2, h3, h4, h5, h6 { font-family: ${family} !important; letter-spacing: ${ls} !important; }
    p { color: ${text} !important; text-align: ${align} !important; text-indent: ${indent} !important; line-height: ${settings.lineHeight} !important; }
    code, pre { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace !important; }
    a { color: ${accent} !important; }
    img { max-width: 100% !important; height: auto !important; }
    ::selection { background: ${sel} !important; }
  `;
  let styleEl = doc.getElementById('grimoire-epub-override');
  if (!styleEl) {
    styleEl = doc.createElement('style');
    styleEl.id = 'grimoire-epub-override';
    doc.head.appendChild(styleEl);
  }
  styleEl.textContent = css;
}

function applyEpubTheme() {
  const rd = state.rendition;
  if (!rd || !rd.themes) return;
  const cs = getComputedStyle(document.documentElement);
  const bg = cs.getPropertyValue('--bg').trim();
  const text = cs.getPropertyValue('--text').trim();
  const accent = cs.getPropertyValue('--accent').trim();
  const sel = cs.getPropertyValue('--sel').trim();
  const family = getFontFamily(settings.fontFamily);
  const ls = Number(settings.letterSpacing || 0).toFixed(2) + 'px';
  const name = 'grimoire-theme-' + (++themeSeq);
  try {
    rd.themes.register(name, {
      html: { background: bg + ' !important' },
      body: {
        background: bg + ' !important',
        color: text + ' !important',
        'font-family': family + ' !important',
        'letter-spacing': ls + ' !important',
        padding: '0 8px !important',
        margin: '0 !important'
      },
      'p, div, span, li, blockquote, section, article, td, th, font, h1, h2, h3, h4, h5, h6': {
        'font-family': family + ' !important',
        'letter-spacing': ls + ' !important'
      },
      p: {
        color: text + ' !important',
        'text-align': settings.justify ? 'justify !important' : 'left !important',
        'text-indent': settings.indent ? '1.4em !important' : '0 !important'
      },
      a: { color: accent + ' !important' },
      img: { 'max-width': '100% !important', height: 'auto !important' },
      '::selection': { background: sel + ' !important' }
    });
    rd.themes.select(name);
    rd.themes.fontSize(settings.fontSize + 'px');
    rd.themes.override('line-height', String(settings.lineHeight));
    rd.themes.override('letter-spacing', ls);
    rd.themes.override('font-family', family);
    const contents = rd.getContents ? rd.getContents() : [];
    (Array.isArray(contents) ? contents : [contents]).forEach((c) => {
      if (c && c.document) injectEpubStyles(c.document);
    });
  } catch { /* ignore */ }
}

const saveEpubProgress = debounce(async (loc) => {
  if (!state.current || !state.rendition || !state.epub) return;
  const start = loc.start || {};
  let pct = start.percentage;
  const len = (state.epub.spine && state.epub.spine.spineItems && state.epub.spine.spineItems.length) || 1;
  if (typeof pct !== 'number' || !Number.isFinite(pct)) pct = (start.index || 0) / len;
  await DB.put('progress', { id: state.current.id, cfi: start.cfi || null, percent: pct || 0, updatedAt: Date.now() }).catch(() => {});
}, 500);

function openCustom(book, prog) {
  if (!state.chapters || !state.chapters.length) return toast('Нет текста');
  renderChapter(Math.max(0, Math.min((prog && prog.chapter) || 0, state.chapters.length - 1)), (prog && prog.ratio) || 0);
}

function applyChapterEnhancements() {
  const inner = $('#reader-inner');
  if (!inner || !state.chapters || state.rendition) return;
  applyReadingEnhancements(inner, {
    bionic: !!settings.bionicReading,
    bionicStrength: settings.bionicStrength || 'medium',
    beeline: !!settings.beelineMode,
    theme: settings.theme
  });
}

const scheduleBeeLineRefresh = debounce(() => {
  if (!settings.beelineMode || !state.current || state.rendition) return;
  const inner = $('#reader-inner');
  if (inner) refreshBeeLineColors(inner, settings.theme);
}, 100);

function renderChapter(idx, ratio) {
  const chapters = state.chapters;
  if (!chapters || !chapters.length) return;
  idx = Math.max(0, Math.min(idx, chapters.length - 1));
  state.chapterIndex = idx;
  state.lastWordsRatio = Math.max(0, Math.min(1, ratio || 0));

  revokeActiveAssetUrls();
  lastFocusedPara = null;
  focusBlockIndex = -1;

  const ch = chapters[idx];
  const inner = $('#reader-inner');
  inner.innerHTML = '<div class="chapter-head"><h2>' + escHTML(ch.title || '') + '</h2><div class="rule"><span>◆</span></div></div>' + (ch.html || '');
  applyChapterEnhancements();
  cachedParagraphs = [...inner.querySelectorAll('p, li, blockquote')];
  state.chapterWords = countWords(htmlToText(ch.html));
  resolveChapterAssets(inner);

  const body = $('#reader-body');
  body.scrollTop = 0;
  requestAnimationFrame(() => {
    body.scrollTop = Math.max(0, ratio) * Math.max(0, body.scrollHeight - body.clientHeight);
    updateCustomProgress(true);
    if (settings.beelineMode) refreshBeeLineColors(inner, settings.theme);
    updateFocus();
    updateRulerVisibility();
  });

  setReaderMeta(state.current.title, ch.title || '');
  $('#rt-ch-count').textContent = `Гл. ${idx + 1}/${chapters.length}`;
  hideTermPill();
  if (window.getSelection) {
    try { window.getSelection().removeAllRanges(); } catch { /* ignore */ }
  }
  const qn = $('#quick-nav');
  if (qn) {
    qn.max = chapters.length - 1;
    qn.value = idx;
  }
  $('#quick-nav-container').style.display = chapters.length > 1 ? 'flex' : 'none';
}

function customRatio() {
  const body = $('#reader-body');
  const max = body.scrollHeight - body.clientHeight;
  return max <= 0 ? 0 : Math.max(0, Math.min(1, body.scrollTop / max));
}

function updateCustomProgress(skipWordDelta = false) {
  const chapters = state.chapters;
  if (!chapters || !chapters.length) return;
  const ratio = customRatio();
  if (!skipWordDelta && ratio > state.lastWordsRatio) {
    state.sessionWords += (ratio - state.lastWordsRatio) * state.chapterWords;
  }
  state.lastWordsRatio = Math.max(state.lastWordsRatio, ratio);

  const pct = (state.chapterIndex + ratio) / chapters.length;
  setPercent(pct);
  const wordsLeft = Math.max(0, Math.round(state.chapterWords * (1 - ratio)));
  const minsLeft = Math.ceil(wordsLeft / 200);
  $('#rt-time-left').textContent = wordsLeft > 30 ? `~${minsLeft} мин` : '';
  saveCustomProgress();
}

const saveCustomProgress = debounce(async () => {
  if (!state.current || !state.chapters || !state.chapters.length) return;
  const ratio = customRatio();
  const prev = (await DB.get('progress', state.current.id).catch(() => null)) || {};
  await DB.put('progress', {
    ...prev,
    id: state.current.id,
    chapter: state.chapterIndex,
    ratio,
    percent: (state.chapterIndex + ratio) / state.chapters.length,
    updatedAt: Date.now()
  }).catch(() => {});
}, 450);

function animateChapterSwitch(dir, callback) {
  const inner = $('#reader-inner');
  if (!inner) return callback();
  inner.classList.remove('swiping');
  inner.style.transform = `translate3d(${dir * 56}px,0,0)`;
  inner.style.opacity = '0.35';
  setTimeout(() => {
    callback();
    inner.classList.add('swiping');
    inner.style.transform = `translate3d(${-dir * 42}px,0,0)`;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        inner.classList.remove('swiping');
        inner.style.transform = '';
        inner.style.opacity = '1';
      });
    });
  }, 110);
}

function goNext() {
  if (state.rendition) return state.rendition.next();
  const chapters = state.chapters || [];
  if (state.chapterIndex < chapters.length - 1) animateChapterSwitch(-1, () => renderChapter(state.chapterIndex + 1, 0));
  else toast('Конец книги');
}

function goPrev() {
  if (state.rendition) return state.rendition.prev();
  if (state.chapterIndex > 0) animateChapterSwitch(1, () => renderChapter(state.chapterIndex - 1, 0));
  else toast('Начало книги');
}

function pageDown() {
  if (state.rendition) return state.rendition.next();
  const body = $('#reader-body');
  if (body.scrollTop + body.clientHeight >= body.scrollHeight - 8) goNext();
  else body.scrollBy({ top: body.clientHeight * 0.86, behavior: 'smooth' });
}

function pageUp() {
  if (state.rendition) return state.rendition.prev();
  const body = $('#reader-body');
  if (body.scrollTop <= 8) goPrev();
  else body.scrollBy({ top: -body.clientHeight * 0.86, behavior: 'smooth' });
}

async function closeReader() {
  stopAllActions();
  stopStatsTracking();
  await flushReadingSession();
  revokeActiveAssetUrls();
  cachedParagraphs = [];
  lastFocusedPara = null;

  if (state.rendition) {
    if (state.current && state.current.format === 'epub') {
      try {
        const loc = state.rendition.currentLocation();
        if (loc && loc.start) {
          let pct = loc.start.percentage;
          const len = (state.epub && state.epub.spine && state.epub.spine.spineItems && state.epub.spine.spineItems.length) || 1;
          if (typeof pct !== 'number' || !Number.isFinite(pct)) pct = (loc.start.index || 0) / len;
          await DB.put('progress', { id: state.current.id, cfi: loc.start.cfi || null, percent: pct || 0, updatedAt: Date.now() });
        }
      } catch { /* ignore */ }
    }
    try { state.rendition.destroy(); } catch { /* ignore */ }
  }
  if (state.epub) {
    try { state.epub.destroy(); } catch { /* ignore */ }
  }
  state.rendition = null;
  state.epub = null;
  state.current = null;
  state.chapters = null;
  state.notes = null;
  $('#epub-host').innerHTML = '';
  $('#reader-inner').innerHTML = '';
  showReader(false);
  hideTermPill();
  closeSheet();
  await loadLibrary();
}

async function addBookmark() {
  if (!state.current) return;
  const bm = { bookId: state.current.id, timestamp: Date.now(), percent: 0 };
  if (state.rendition) {
    try {
      const loc = state.rendition.currentLocation();
      bm.cfi = loc && loc.start ? loc.start.cfi : null;
      bm.percent = loc && loc.start && Number.isFinite(loc.start.percentage) ? loc.start.percentage : 0;
    } catch { /* ignore */ }
    bm.label = $('#rt-chapter').textContent || 'EPUB';
  } else {
    bm.chapter = state.chapterIndex;
    bm.ratio = customRatio();
    const ch = state.chapters && state.chapters[state.chapterIndex];
    bm.label = (ch && ch.title) || ('Глава ' + (state.chapterIndex + 1));
    bm.percent = (state.chapterIndex + bm.ratio) / ((state.chapters || [1]).length || 1);
  }
  try {
    await DB.put('bookmarks', bm);
    toast('Закладка сохранена');
  } catch {
    toast('Ошибка сохранения закладки');
  }
}

/* ---------- Сноски ---------- */
function showFootnote(noteId) {
  const raw = state.notes && state.notes[noteId];
  if (!raw) return toast('Текст сноски [' + noteId + '] не найден');
  openSheet('Примечание [' + noteId + ']', '<div class="scroll-body">' + sanitizeHtml(raw) + '</div>');
}

/* ---------- Поиск по книге и Анализ ---------- */
async function currentChapterText() {
  if (!state.current) return '';
  if (state.rendition) {
    try {
      const contents = state.rendition.getContents();
      if (contents && contents.length) {
        return contents.map((c) => c.document.body.innerText || c.document.body.textContent || '').join('\n\n').trim();
      }
    } catch { /* ignore */ }
    return '';
  }
  const ch = state.chapters && state.chapters[state.chapterIndex];
  return ch ? htmlToText(ch.html) : '';
}

async function getFullText(book) {
  if (!book) return '';
  const cached = fullTextCache.get(book.id);
  if (cached) return cached;
  let text = '';
  const chapters = state.chapters || (await getBookContent(book)).chapters || [];
  if (chapters.length) {
    text = chapters.map((c) => c.title + '\n' + htmlToText(c.html)).join('\n\n');
  } else if (book.format === 'epub') {
    const buf = await DB.get('files', book.id).catch(() => null);
    if (!buf || typeof window.ePub === 'undefined') return '';
    const eb = window.ePub(buf.slice(0));
    await eb.ready;
    const parts = [];
    const items = eb.spine.spineItems;
    for (let i = 0; i < items.length; i++) {
      try {
        await items[i].load(eb.load.bind(eb));
        if (items[i].document && items[i].document.body) parts.push(items[i].document.body.textContent || '');
        items[i].unload();
      } catch { /* ignore */ }
    }
    text = parts.join('\n\n');
    try { eb.destroy(); } catch { /* ignore */ }
  }
  fullTextCache.set(book.id, text);
  return text;
}

let searchAbortController = null;
async function searchBook(query, signal) {
  const book = state.current;
  if (!book || !query.trim()) return [];
  const q = query.toLowerCase();

  if (state.rendition && book.format === 'epub') {
    const buf = await DB.get('files', book.id).catch(() => null);
    if (!buf || typeof window.ePub === 'undefined') return [];
    const eb = window.ePub(buf.slice(0));
    const results = [];
    try {
      await eb.ready;
      const items = eb.spine.spineItems || [];
      for (let i = 0; i < items.length && results.length < 50; i++) {
        if (signal && signal.aborted) break;
        try {
          await items[i].load(eb.load.bind(eb));
          const doc = items[i].document;
          const text = doc && doc.body ? doc.body.textContent || '' : '';
          if (text && text.toLowerCase().includes(q)) {
            let cfi = null;
            try {
              const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
              let node;
              while ((node = walker.nextNode())) {
                const idx = (node.nodeValue || '').toLowerCase().indexOf(q);
                if (idx >= 0) {
                  const range = doc.createRange();
                  range.setStart(node, idx);
                  range.setEnd(node, Math.min(node.nodeValue.length, idx + q.length));
                  if (window.ePub.CFI) cfi = new window.ePub.CFI(range, items[i].cfiBase).toString();
                  break;
                }
              }
            } catch { /* ignore */ }
            const sentences = text.match(/[^.!?…]+[.!?…]+[»"”)]?/g) || [text];
            for (const s of sentences) {
              if (results.length >= 50) break;
              if (s.toLowerCase().includes(q)) results.push({ chapter: 'Раздел ' + (i + 1), text: s.trim(), cfi, href: items[i].href });
            }
          }
          items[i].unload();
        } catch { /* ignore */ }
      }
    } finally {
      try { eb.destroy(); } catch { /* ignore */ }
    }
    return results;
  }

  return searchChaptersAsync(state.chapters || [], query, { limit: 100, signal });
}

async function showSearchSheet() {
  const ov = openSheet(
    'Поиск по книге',
    `<div class="field" style="margin-bottom:10px"><input type="text" id="search-input" placeholder="Введите слово или фразу…" class="lib-search" style="padding:12px;font-size:15px" aria-label="Поиск по тексту книги"></div>
     <div id="search-results" style="min-height:100px"></div>`
  );
  const input = ov._body.querySelector('#search-input');
  const resDiv = ov._body.querySelector('#search-results');
  input.focus();
  input.addEventListener('input', debounce(async () => {
    if (searchAbortController) searchAbortController.abort();
    searchAbortController = new AbortController();
    const { signal } = searchAbortController;
    const q = input.value.trim();
    if (q.length < 2) {
      resDiv.innerHTML = '';
      return;
    }
    resDiv.innerHTML = '<div class="spinner" style="margin:20px auto;display:block"></div>';
    const results = await searchBook(q, signal);
    if (signal.aborted) return;
    if (!results.length) {
      resDiv.innerHTML = '<p class="hint">Ничего не найдено.</p>';
      return;
    }
    resDiv.innerHTML = results
      .map((r) => `<button class="toc-item" style="flex-direction:column;align-items:flex-start" data-index="${r.index !== undefined ? r.index : ''}" data-cfi="${escHTML(r.cfi || '')}" data-href="${escHTML(r.href || '')}"><span style="font-size:10px;color:var(--muted);text-transform:uppercase">${escHTML(r.chapter)}</span><span>${highlightQueryHTML(escHTML(r.text), q)}</span></button>`)
      .join('');
    resDiv.querySelectorAll('.toc-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        closeSheet();
        if (state.rendition) {
          const target = btn.dataset.cfi || btn.dataset.href;
          if (target) state.rendition.display(target).catch(() => toast('Не удалось перейти'));
        } else if (btn.dataset.index !== '') {
          renderChapter(parseInt(btn.dataset.index, 10), 0);
        }
      });
    });
  }, 240));
}

async function showNoteSheet(text) {
  const ov = openSheet(
    'Новая цитата',
    `<div class="scroll-body" style="margin-bottom:16px;border-left:2px solid var(--accent);padding-left:12px">${escHTML(text)}</div>
     <div class="field"><label for="note-input">Заметка (необязательно)</label><textarea class="term-note" id="note-input" placeholder="Ваша мысль или комментарий…"></textarea></div>
     <div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn-ghost" data-act="cancel">Отмена</button><button class="btn-ghost btn-solid" data-act="save">Сохранить</button></div>`
  );
  ov._body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'cancel') closeSheet();
    if (b.dataset.act === 'save') {
      const comment = ov._body.querySelector('#note-input').value.trim();
      await DB.put('notes', {
        bookId: state.current.id,
        chapter: state.chapters ? (state.chapters[state.chapterIndex].title || '') : ($('#rt-chapter').textContent || 'EPUB'),
        chapterIndex: state.chapterIndex,
        ratio: state.rendition ? 0 : customRatio(),
        text,
        comment,
        timestamp: Date.now()
      });
      toast('Цитата сохранена');
      closeSheet();
    }
  });
}

async function showSummary() {
  if (!state.current) return;
  const ov = openSheet('Суть главы', '<div class="spinner" style="margin:20px auto;display:block"></div>');
  const text = await currentChapterText();
  if (!text || text.length < 180) {
    ov._body.innerHTML = '<p class="hint">Недостаточно текста в текущей главе для выделения тезисов.</p>';
    return;
  }
  const theses = summarize(text, 4);
  ov._body.innerHTML = '<div class="scroll-body">' +
    theses.map((t, i) => `<div class="thesis"><i>${String(i + 1).padStart(2, '0')}</i><span>${escHTML(t)}</span></div>`).join('') +
    '</div>';
}

async function openTerm(termRaw) {
  const ov = openSheet('Вникнуть', '<div class="spinner" style="margin:20px auto;display:block"></div>');
  hideTermPill();
  const book = state.current;
  if (!book) return;
  const fullText = await getFullText(book);
  const { term, stemL, defs, mentions } = findTermContext(fullText, termRaw);
  if (!term) {
    closeSheet();
    return;
  }
  const list = defs.length ? defs : mentions;
  let html = `<div style="font-family:var(--serif);font-size:20px;color:var(--accent);margin-bottom:10px">${escHTML(term)}</div>`;
  if (list.length) {
    html += `<div style="font-size:9.5px;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);margin-bottom:8px">${defs.length ? 'Определения в книге' : 'Контекст упоминаний'}</div>`;
    list.forEach((d) => {
      html += `<div class="def-item">${escHTML(d).replace(new RegExp('(' + escRe(stemL) + '[а-яёa-z]*)', 'gi'), '<b>$1</b>')}</div>`;
    });
  } else {
    html += '<p class="hint">Контекстных определений в книге не найдено.</p>';
  }
  html += `<div class="field" style="margin-top:14px"><label for="gloss-note">Сохранить в словарь книги</label><textarea class="term-note" id="gloss-note" placeholder="Запишите значение или роль персонажа…">${defs[0] ? escHTML(defs[0]) : ''}</textarea></div>
    <div style="display:flex;justify-content:flex-end"><button class="btn-ghost btn-solid" id="btn-save-gloss">В словарь</button></div>`;
  ov._body.innerHTML = html;
  ov._body.querySelector('#btn-save-gloss').addEventListener('click', async () => {
    const desc = ov._body.querySelector('#gloss-note').value.trim();
    await DB.put('glossary', { bookId: book.id, term, desc, timestamp: Date.now() });
    toast('Добавлено в словарь');
    closeSheet();
  });
}

/* ---------- RSVP / Автоскролл / TTS ---------- */
let rsvpInterval = null;
let rsvpWords = [];
let rsvpIndex = 0;

async function startRSVP() {
  const text = await currentChapterText();
  if (!text || text.length < 30) return toast('Мало текста для скорочтения');
  rsvpWords = text.replace(/[\n\r]+/g, ' ').split(/\s+/).filter((w) => w.length > 0);
  rsvpIndex = 0;
  $('#rsvp-overlay').hidden = false;
  requestAnimationFrame(() => $('#rsvp-overlay').classList.add('open'));
  $('#rsvp-speed').value = settings.rsvpSpeed;
  $('#rsvp-speed-label').textContent = settings.rsvpSpeed + ' слов/мин';
  playRSVP();
}

function playRSVP() {
  if (rsvpInterval) cancelAnimationFrame(rsvpInterval);
  $('#rsvp-icon-play').style.display = 'none';
  $('#rsvp-icon-pause').style.display = 'block';
  const delay = 60000 / settings.rsvpSpeed;
  let lastTime = performance.now();
  const tick = (time) => {
    if (!rsvpInterval) return;
    if (time - lastTime >= delay) {
      if (rsvpIndex >= rsvpWords.length) {
        pauseRSVP();
        return;
      }
      const word = rsvpWords[rsvpIndex++];
      const len = word.length;
      let orpIdx = Math.floor(len * 0.35);
      if (len <= 2) orpIdx = 0;
      else if (len <= 5) orpIdx = 1;
      else if (len <= 9) orpIdx = 2;
      else if (len <= 13) orpIdx = 3;
      $('#rsvp-left').textContent = word.substring(0, orpIdx);
      $('#rsvp-orp').textContent = word.charAt(orpIdx) || '';
      $('#rsvp-right').textContent = word.substring(orpIdx + 1);
      $('#rsvp-progress-lbl').textContent = `${rsvpIndex} / ${rsvpWords.length}`;
      state.sessionWords += 1;
      lastTime = time;
    }
    rsvpInterval = requestAnimationFrame(tick);
  };
  rsvpInterval = requestAnimationFrame(tick);
}

function pauseRSVP() {
  if (rsvpInterval) cancelAnimationFrame(rsvpInterval);
  rsvpInterval = null;
  $('#rsvp-icon-play').style.display = 'block';
  $('#rsvp-icon-pause').style.display = 'none';
}

function stopRSVP() {
  pauseRSVP();
  $('#rsvp-overlay').classList.remove('open');
  setTimeout(() => {
    $('#rsvp-overlay').hidden = true;
  }, 260);
}

function toggleAutoScroll() {
  if (state.isAutoScrolling) return stopAutoScroll();
  if (!state.current || state.rendition) return toast('Переключите режим EPUB на «Свиток (как FB2)» для автоскролла');
  state.isAutoScrolling = true;
  state.lastScrollY = $('#reader-body').scrollTop;
  $('#btn-autoscroll').classList.add('active');
  toast('Автоскролл включён');
  loopAutoScroll();
}

function stopAutoScroll() {
  state.isAutoScrolling = false;
  $('#btn-autoscroll').classList.remove('active');
  if (state.autoScrollTimer) clearTimeout(state.autoScrollTimer);
}

function loopAutoScroll() {
  if (!state.isAutoScrolling || !state.chapters) return;
  const body = $('#reader-body');
  if (Math.abs(body.scrollTop - state.lastScrollY) > 12) {
    state.lastScrollY = body.scrollTop;
  } else {
    body.scrollTop += settings.autoScrollSpeed * 0.45;
    state.lastScrollY = body.scrollTop;
  }
  if (body.scrollTop + body.clientHeight >= body.scrollHeight - 2) {
    if (state.chapterIndex < state.chapters.length - 1) renderChapter(state.chapterIndex + 1, 0);
    else {
      stopAutoScroll();
      toast('Конец книги');
    }
  } else {
    state.autoScrollTimer = setTimeout(loopAutoScroll, 40);
  }
}

function speakText(text) {
  const S = window.speechSynthesis;
  if (!S) return toast('Синтез речи не поддерживается браузером');
  if (state.isSpeaking) {
    S.cancel();
    state.isSpeaking = false;
    $('#btn-tts').classList.remove('active');
    return;
  }
  const clean = String(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return toast('Нет текста для озвучки');
  S.cancel();
  const chunks = clean.match(/[^.!?…]{1,240}[.!?…]+[»"”)]?|[^.!?…]+$/g) || [clean];
  const voices = S.getVoices ? S.getVoices() : [];
  state.isSpeaking = true;
  $('#btn-tts').classList.add('active');
  const done = () => {
    state.isSpeaking = false;
    $('#btn-tts').classList.remove('active');
  };
  chunks.forEach((c, i) => {
    const u = new SpeechSynthesisUtterance(c.trim());
    const isRu = /[а-яё]/i.test(c);
    u.rate = settings.ttsRate;
    u.pitch = settings.ttsPitch;
    u.lang = isRu ? 'ru-RU' : 'en-US';
    if (voices.length) {
      const match = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(isRu ? 'ru' : 'en'));
      if (match) u.voice = match;
    }
    if (i === chunks.length - 1) {
      u.onend = done;
      u.onerror = done;
    }
    S.speak(u);
  });
}

function stopAllActions() {
  stopAutoScroll();
  stopRSVP();
  noiseController.stop();
  updateFocusToolbarBadges();
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  state.isSpeaking = false;
  $('#btn-tts').classList.remove('active');
  hideTermPill();
}

/* ---------- Focus Mode (Hover + Keyboard ↑/↓ + Scroll) ---------- */
let focusBlockIndex = -1;
let focusManualLockUntil = 0;

function setFocusedParagraph(el, scrollIntoView = false) {
  if (!el) return;
  if (lastFocusedPara && lastFocusedPara !== el) {
    lastFocusedPara.classList.remove('focused');
  }
  el.classList.add('focused');
  lastFocusedPara = el;
  focusBlockIndex = cachedParagraphs.indexOf(el);
  if (scrollIntoView) {
    focusManualLockUntil = Date.now() + 650;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function moveParagraphFocus(delta) {
  if (!cachedParagraphs.length) return;
  let nextIdx = focusBlockIndex;
  if (nextIdx < 0) {
    updateFocus(true);
    nextIdx = focusBlockIndex >= 0 ? focusBlockIndex : 0;
  }
  nextIdx = Math.max(0, Math.min(cachedParagraphs.length - 1, nextIdx + delta));
  setFocusedParagraph(cachedParagraphs[nextIdx], true);
}

function updateFocus(force = false) {
  if (!settings.focusMode || !cachedParagraphs.length) return;
  if (!force && Date.now() < focusManualLockUntil) return;
  const vh = window.innerHeight;
  const mid = vh * 0.46;
  let best = null;
  let bestDist = Infinity;
  for (let i = 0; i < cachedParagraphs.length; i++) {
    const p = cachedParagraphs[i];
    const r = p.getBoundingClientRect();
    if (r.bottom < 0) continue;
    if (r.top > vh) break;
    const d = Math.abs(r.top + r.height / 2 - mid);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  if (!best && cachedParagraphs.length) best = cachedParagraphs[0];
  if (best && best !== lastFocusedPara) {
    setFocusedParagraph(best, false);
  }
}

/* ---------- UI: Модальные шторки ---------- */
let _currentOverlay = null;
function openSheet(title, bodyHTML, footerHTML = '') {
  closeSheet();
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${escHTML(title)}">
    <div class="sheet-head">
      <div class="sheet-title">${escHTML(title)}</div>
      <button type="button" class="icon-btn" data-sheet-close aria-label="Закрыть"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div class="sheet-body">${bodyHTML}</div>
    ${footerHTML ? `<div class="sheet-foot">${footerHTML}</div>` : ''}
  </div>`;
  document.body.appendChild(ov);
  ov._body = ov.querySelector('.sheet-body');
  requestAnimationFrame(() => ov.classList.add('open'));
  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('[data-sheet-close]')) closeSheet();
  });
  _currentOverlay = ov;
  return ov;
}

function closeSheet() {
  if (!_currentOverlay) return;
  const ov = _currentOverlay;
  _currentOverlay = null;
  ov.classList.remove('open');
  setTimeout(() => ov.remove(), 260);
}

function confirmDialog(msg, okLabel = 'OK') {
  return new Promise((res) => {
    const ov = openSheet(
      'Подтверждение',
      `<p style="font-family:var(--reader-font);font-size:16px;line-height:1.6;margin:0 0 20px">${escHTML(msg)}</p>
       <div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn-ghost" data-act="cancel">Отмена</button><button class="btn-ghost btn-solid" data-act="ok">${escHTML(okLabel)}</button></div>`
    );
    ov._body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      closeSheet();
      res(b.dataset.act === 'ok');
    });
  });
}

function showTermPill(text) {
  state.selection = text;
  const pill = $('#term-pill');
  pill.hidden = false;
  requestAnimationFrame(() => pill.classList.add('show'));
}

function hideTermPill() {
  const pill = $('#term-pill');
  if (!pill) return;
  pill.classList.remove('show');
  setTimeout(() => {
    if (!pill.classList.contains('show')) pill.hidden = true;
  }, 220);
  state.selection = '';
}

/* ---------- Быстрая вставка текста и Демо-текст ---------- */
async function importTextAsBook(rawTitle, rawText, openNow = true) {
  const text = String(rawText || '').trim();
  if (!text) return null;
  const firstLine = text.split(/\n+/)[0].replace(/^#+\s*/, '').trim().slice(0, 64);
  const title = String(rawTitle || '').trim() || firstLine || 'Без названия';
  const id = uid();
  const isMarkdown = /^#{1,3}\s|\*\*[^*]+\*\*/m.test(text);
  const parsed = isMarkdown ? parseMarkdownBook(text, title) : parsePlain(text, title);
  const wordsCount = parsed.chapters.reduce((acc, ch) => acc + countWords(htmlToText(ch.html)), 0);
  const meta = {
    id,
    title: parsed.title || title,
    author: rawTitle === DEMO_ARTICLE.title ? DEMO_ARTICLE.author : 'Вставленный текст',
    format: isMarkdown ? 'md' : 'txt',
    cover: generateCover(parsed.title || title, rawTitle === DEMO_ARTICLE.title ? DEMO_ARTICLE.author : 'Заметка'),
    addedAt: Date.now(),
    lastReadAt: Date.now(),
    size: new Blob([text]).size,
    chaptersCount: parsed.chapters.length,
    wordsCount
  };
  await saveBookContent(id, { chapters: parsed.chapters, notes: {}, assets: [] });
  await DB.put('books', meta);
  await loadLibrary();
  if (openNow) await openBook(id);
  return meta;
}

async function openDemoArticle() {
  const existing = libraryCache.find((b) => b.title === DEMO_ARTICLE.title);
  if (existing) {
    await openBook(existing.id);
    return;
  }
  await importTextAsBook(DEMO_ARTICLE.title, DEMO_ARTICLE.text, true);
  toast('Демо-текст загружен');
}

function showPasteTextSheet() {
  const html = `
    <div class="field">
      <label for="paste-title">Название (необязательно)</label>
      <input type="text" id="paste-title" class="lib-search" style="padding:10px 12px" placeholder="Статья, конспект или глава…">
    </div>
    <div class="field">
      <label for="paste-content">Текст для чтения (поддерживается Markdown)</label>
      <textarea id="paste-content" class="paste-area" placeholder="Вставьте любой текст, статью или конспект…"></textarea>
      <div id="paste-err" class="form-err" hidden>Вставьте текст или загрузите демо-текст перед началом чтения.</div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:space-between;align-items:center">
      <button type="button" class="btn-ghost" id="btn-fill-demo">Загрузить демо-текст</button>
      <div style="display:flex;gap:8px">
        <button type="button" class="btn-ghost" data-act="cancel">Отмена</button>
        <button type="button" class="btn-ghost btn-solid" id="btn-paste-read">Читать</button>
      </div>
    </div>`;
  const ov = openSheet('Вставить текст', html);
  const B = ov._body;
  const titleInp = B.querySelector('#paste-title');
  const area = B.querySelector('#paste-content');
  const errEl = B.querySelector('#paste-err');
  area.focus();

  area.addEventListener('input', () => {
    if (area.value.trim()) errEl.hidden = true;
  });

  B.querySelector('#btn-fill-demo').addEventListener('click', () => {
    titleInp.value = DEMO_ARTICLE.title;
    area.value = DEMO_ARTICLE.text;
    errEl.hidden = true;
    toast('Демо-текст вставлен');
  });

  B.querySelector('[data-act="cancel"]').addEventListener('click', closeSheet);

  B.querySelector('#btn-paste-read').addEventListener('click', async () => {
    const val = area.value.trim();
    if (!val) {
      errEl.hidden = false;
      area.focus();
      return;
    }
    closeSheet();
    await importTextAsBook(titleInp.value.trim(), val, true);
  });
}

/* ---------- Панель Концентрации (СДВГ / Глубокое чтение) ---------- */
function showFocusPanel() {
  const liveNoise = noiseController.getState().mode;
  const volPct = Math.round((settings.noiseVolume ?? 0.25) * 100);
  const html = `
    <div class="focus-presets">
      <button type="button" class="btn-ghost btn-solid" id="btn-preset-adhd">СДВГ-фокус</button>
      <button type="button" class="btn-ghost" id="btn-preset-clear">Сбросить режимы</button>
    </div>

    <div class="focus-row">
      <div class="focus-info">
        <div class="focus-name">Бионическое чтение</div>
        <div class="focus-desc">Выделяет первые 40–50% букв каждого слова для быстрых фиксаций взгляда</div>
      </div>
      <button type="button" class="toggle-switch" data-toggle="bionicReading" aria-label="Бионическое чтение" aria-pressed="${settings.bionicReading ? 'true' : 'false'}"></button>
    </div>
    <div class="focus-sub" id="bionic-strength-wrap" ${settings.bionicReading ? '' : 'hidden'}>
      <div class="seg" data-focus-seg="bionicStrength">
        <button type="button" data-val="light" class="${settings.bionicStrength === 'light' ? 'on' : ''}">Мягко</button>
        <button type="button" data-val="medium" class="${settings.bionicStrength === 'medium' ? 'on' : ''}">Стандарт</button>
        <button type="button" data-val="strong" class="${settings.bionicStrength === 'strong' ? 'on' : ''}">Сильно</button>
      </div>
    </div>

    <div class="focus-row">
      <div class="focus-info">
        <div class="focus-name">Фокус на абзаце</div>
        <div class="focus-desc">Приглушает остальные абзацы. Переключение курсором или стрелками ↑ / ↓</div>
      </div>
      <button type="button" class="toggle-switch" data-toggle="focusMode" aria-label="Фокус на абзаце" aria-pressed="${settings.focusMode ? 'true' : 'false'}"></button>
    </div>

    <div class="focus-row">
      <div class="focus-info">
        <div class="focus-name">Линейка чтения</div>
        <div class="focus-desc">Светлая полоса высотой в 2 строки следует за курсором и затемняет фон</div>
      </div>
      <button type="button" class="toggle-switch" data-toggle="readingRuler" aria-label="Линейка чтения" aria-pressed="${settings.readingRuler ? 'true' : 'false'}"></button>
    </div>

    <div class="focus-row">
      <div class="focus-info">
        <div class="focus-name">Цветовой градиент строк (BeeLine)</div>
        <div class="focus-desc">Плавный переход оттенка связывает конец строки с началом следующей</div>
      </div>
      <button type="button" class="toggle-switch" data-toggle="beelineMode" aria-label="Цветовой градиент строк BeeLine" aria-pressed="${settings.beelineMode ? 'true' : 'false'}"></button>
    </div>

    <div class="focus-row">
      <div class="focus-info">
        <div class="focus-name">Дзен-скрытие панелей</div>
        <div class="focus-desc">Скрывает панели при прокрутке и показывает при наведении на верхний край</div>
      </div>
      <button type="button" class="toggle-switch" data-toggle="zenAutoHide" aria-label="Дзен-скрытие панелей" aria-pressed="${settings.zenAutoHide ? 'true' : 'false'}"></button>
    </div>

    <div class="field" style="margin-top:16px">
      <label>Фоновый шум (Web Audio)</label>
      <div class="seg" data-focus-seg="noiseMode">
        <button type="button" data-val="off" class="${liveNoise === 'off' ? 'on' : ''}">Выкл</button>
        <button type="button" data-val="white" class="${liveNoise === 'white' ? 'on' : ''}">Белый</button>
        <button type="button" data-val="pink" class="${liveNoise === 'pink' ? 'on' : ''}">Розовый</button>
        <button type="button" data-val="brown" class="${liveNoise === 'brown' ? 'on' : ''}">Коричневый</button>
      </div>
    </div>
    <div class="field" style="margin-bottom:6px">
      <label for="noise-vol">Громкость шума: <span id="noise-vol-val">${volPct}</span>%</label>
      <input type="range" id="noise-vol" min="0" max="100" step="1" value="${volPct}">
    </div>
    <div style="display:flex;justify-content:flex-end;margin-top:14px">
      <button type="button" class="btn-ghost" id="btn-goto-typo">Шрифты и типографика</button>
    </div>`;

  const ov = openSheet('Концентрация', html);
  const B = ov._body;

  const syncButtons = () => {
    B.querySelectorAll('[data-toggle]').forEach((btn) => {
      const k = btn.dataset.toggle;
      btn.setAttribute('aria-pressed', settings[k] ? 'true' : 'false');
    });
    const strWrap = B.querySelector('#bionic-strength-wrap');
    if (strWrap) strWrap.hidden = !settings.bionicReading;
    B.querySelectorAll('[data-focus-seg="bionicStrength"] button').forEach((b) => {
      b.classList.toggle('on', b.dataset.val === settings.bionicStrength);
    });
    const curNoise = noiseController.getState().mode;
    B.querySelectorAll('[data-focus-seg="noiseMode"] button').forEach((b) => {
      b.classList.toggle('on', b.dataset.val === curNoise);
    });
  };

  B.querySelector('#btn-preset-adhd').addEventListener('click', () => {
    settings.bionicReading = true;
    settings.bionicStrength = 'medium';
    settings.focusMode = true;
    settings.fontFamily = 'lexend';
    settings.lineHeight = 1.75;
    settings.letterSpacing = 0.4;
    settings.maxWidth = 62;
    settings.justify = false;
    applySettings();
    saveSettings();
    applyChapterEnhancements();
    updateFocus(true);
    if (state.rendition) applyEpubTheme();
    syncButtons();
    toast('Активирован СДВГ-фокус (Lexend + Бионика + Фокус)');
  });

  B.querySelector('#btn-preset-clear').addEventListener('click', () => {
    settings.bionicReading = false;
    settings.focusMode = false;
    settings.readingRuler = false;
    settings.beelineMode = false;
    settings.noiseMode = 'off';
    noiseController.stop();
    applySettings();
    saveSettings();
    applyChapterEnhancements();
    syncButtons();
    toast('Режимы концентрации выключены');
  });

  B.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.toggle;
      settings[key] = !settings[key];
      if (key === 'readingRuler' && settings.readingRuler) {
        document.documentElement.style.setProperty('--ruler-y', '42vh');
      }
      applySettings();
      saveSettings();
      if (key === 'bionicReading' || key === 'beelineMode') {
        applyChapterEnhancements();
      }
      if (key === 'focusMode') {
        if (settings.focusMode) updateFocus(true);
        else if (lastFocusedPara) {
          lastFocusedPara.classList.remove('focused');
          lastFocusedPara = null;
        }
      }
      syncButtons();
    });
  });

  B.querySelectorAll('[data-focus-seg]').forEach((seg) => {
    const key = seg.dataset.focusSeg;
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-val]');
      if (!b) return;
      const val = b.dataset.val;
      if (key === 'bionicStrength') {
        settings.bionicStrength = val;
        saveSettings();
        applyChapterEnhancements();
      } else if (key === 'noiseMode') {
        settings.noiseMode = val;
        if (val !== 'off') lastActiveNoiseMode = val;
        noiseController.setVolume(settings.noiseVolume ?? 0.25);
        const ok = noiseController.setMode(val);
        if (!ok && val !== 'off') toast('Web Audio недоступен в браузере');
        saveSettings();
        updateFocusToolbarBadges();
      }
      syncButtons();
    });
  });

  const volEl = B.querySelector('#noise-vol');
  if (volEl) {
    volEl.addEventListener('input', () => {
      const pct = parseInt(volEl.value, 10) || 0;
      settings.noiseVolume = pct / 100;
      B.querySelector('#noise-vol-val').textContent = String(pct);
      noiseController.setVolume(settings.noiseVolume);
      saveSettings();
    });
  }

  B.querySelector('#btn-goto-typo').addEventListener('click', () => {
    showReaderSettings();
  });
}

/* ---------- Настройки (Общие и Читалка) ---------- */
function buildTypographyFields(prefix = '') {
  return `
  <div class="field"><label>Режим чтения EPUB</label><div class="seg" data-seg="epubFlow"><button data-val="scrolled" class="${settings.epubFlow === 'scrolled' ? 'on' : ''}">Свиток (как FB2)</button><button data-val="paginated" class="${settings.epubFlow === 'paginated' ? 'on' : ''}">Страницы</button></div></div>
  <div class="field"><label>Тема оформления (без резкого белого)</label><div class="seg" data-seg="theme">${THEMES.map((t) => `<button data-val="${t}" class="${settings.theme === t ? 'on' : ''}">${THEME_NAMES[t]}</button>`).join('')}</div></div>
  <div class="field"><label>Гарнитура (вкл. шрифты для концентрации)</label><div class="font-grid" data-font-grid>${Object.entries(FONTS).map(([k, f]) => `<button type="button" class="font-btn ${settings.fontFamily === k ? 'on' : ''}" data-val="${k}"><span style="font-family:${f.family}">Аа</span><small>${f.name}</small><span class="font-tag">${f.tag}</span></button>`).join('')}</div></div>
  <div class="field"><label for="${prefix}fs">Размер шрифта: <span id="${prefix}fs-val">${settings.fontSize}</span>px</label><input type="range" id="${prefix}fs" min="14" max="32" value="${settings.fontSize}"></div>
  <div class="field"><label for="${prefix}lh">Межстрочный интервал: <span id="${prefix}lh-val">${settings.lineHeight.toFixed(2)}</span></label><input type="range" id="${prefix}lh" min="1.25" max="2.3" step="0.05" value="${settings.lineHeight}"></div>
  <div class="field"><label for="${prefix}ls">Межбуквенный интервал (трекинг): <span id="${prefix}ls-val">${Number(settings.letterSpacing || 0).toFixed(1)}</span>px</label><input type="range" id="${prefix}ls" min="0" max="3" step="0.2" value="${Number(settings.letterSpacing || 0)}"></div>
  <div class="field"><label for="${prefix}mw">Ширина колонки: <span id="${prefix}mw-val">${settings.maxWidth}</span>ch</label><input type="range" id="${prefix}mw" min="45" max="95" value="${settings.maxWidth}"></div>
  <div class="field"><label>Вёрстка абзаца</label>
    <div class="seg" data-seg="justify" style="margin-bottom:6px"><button data-val="1" class="${settings.justify ? 'on' : ''}">По ширине</button><button data-val="0" class="${!settings.justify ? 'on' : ''}">По левому</button></div>
    <div class="seg" data-seg="indent" style="margin-bottom:6px"><button data-val="1" class="${settings.indent ? 'on' : ''}">Красная строка</button><button data-val="0" class="${!settings.indent ? 'on' : ''}">Без отступа</button></div>
    <div class="seg" data-seg="hyphens"><button data-val="1" class="${settings.hyphens ? 'on' : ''}">Переносы вкл</button><button data-val="0" class="${!settings.hyphens ? 'on' : ''}">Переносы выкл</button></div>
  </div>
  <div class="field"><label for="${prefix}nf">Ночной фильтр (тёплый): <span id="${prefix}nf-val">${settings.nightFilter}</span>%</label><input type="range" id="${prefix}nf" min="0" max="65" value="${settings.nightFilter}"></div>
  <div class="field"><label>Концентрация</label>
    <div class="seg" data-seg="bionic" style="margin-bottom:6px"><button data-val="0" class="${!settings.bionicReading ? 'on' : ''}">Бионика выкл</button><button data-val="1" class="${settings.bionicReading ? 'on' : ''}">Бионическое чтение</button></div>
    <div class="seg" data-seg="focus" style="margin-bottom:6px"><button data-val="0" class="${!settings.focusMode ? 'on' : ''}">Фокус выкл</button><button data-val="1" class="${settings.focusMode ? 'on' : ''}">Фокус на абзаце</button></div>
    <div class="seg" data-seg="beeline"><button data-val="0" class="${!settings.beelineMode ? 'on' : ''}">BeeLine выкл</button><button data-val="1" class="${settings.beelineMode ? 'on' : ''}">Градиент BeeLine</button></div>
  </div>`;
}

function bindTypographyControls(B, prefix = '') {
  B.querySelectorAll('[data-seg]').forEach((seg) => {
    const key = seg.dataset.seg;
    seg.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-val]');
      if (!b) return;
      seg.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      if (key === 'theme') settings.theme = b.dataset.val;
      else if (key === 'justify') settings.justify = b.dataset.val === '1';
      else if (key === 'indent') settings.indent = b.dataset.val === '1';
      else if (key === 'hyphens') settings.hyphens = b.dataset.val === '1';
      else if (key === 'focus') settings.focusMode = b.dataset.val === '1';
      else if (key === 'bionic') settings.bionicReading = b.dataset.val === '1';
      else if (key === 'beeline') settings.beelineMode = b.dataset.val === '1';
      else if (key === 'epubFlow') {
        const prevFlow = settings.epubFlow;
        settings.epubFlow = b.dataset.val;
        applySettings();
        saveSettings();
        if (state.current && state.current.format === 'epub' && prevFlow !== settings.epubFlow) {
          await openBook(state.current.id);
        }
        return;
      } else if (key === 'tapZones') settings.tapZones = b.dataset.val === '1';

      applySettings();
      saveSettings();
      if (state.rendition) applyEpubTheme();
      if (key === 'bionic' || key === 'beeline') applyChapterEnhancements();
      else if (key === 'theme' || key === 'justify' || key === 'indent' || key === 'hyphens') scheduleBeeLineRefresh();
      if (key === 'focus') updateFocus(true);
    });
  });

  const fg = B.querySelector('[data-font-grid]');
  if (fg) {
    fg.addEventListener('click', (e) => {
      const b = e.target.closest('.font-btn');
      if (!b) return;
      B.querySelectorAll('.font-btn').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      settings.fontFamily = b.dataset.val;
      applySettings();
      saveSettings();
      if (state.rendition) applyEpubTheme();
      scheduleBeeLineRefresh();
    });
  }

  ['fs', 'lh', 'ls', 'mw', 'nf', 'as', 'ttsr', 'rsvp-r'].forEach((id) => {
    const el = B.querySelector('#' + prefix + id);
    if (!el) return;
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      if (id === 'fs') {
        settings.fontSize = v;
        B.querySelector('#' + prefix + 'fs-val').textContent = v;
      } else if (id === 'lh') {
        settings.lineHeight = v;
        B.querySelector('#' + prefix + 'lh-val').textContent = v.toFixed(2);
      } else if (id === 'ls') {
        settings.letterSpacing = v;
        B.querySelector('#' + prefix + 'ls-val').textContent = v.toFixed(1);
      } else if (id === 'mw') {
        settings.maxWidth = v;
        B.querySelector('#' + prefix + 'mw-val').textContent = v;
      } else if (id === 'nf') {
        settings.nightFilter = v;
        B.querySelector('#' + prefix + 'nf-val').textContent = v;
      } else if (id === 'as') {
        settings.autoScrollSpeed = v;
        B.querySelector('#' + prefix + 'as-val').textContent = v;
      } else if (id === 'ttsr') settings.ttsRate = v;
      else if (id === 'rsvp-r') {
        settings.rsvpSpeed = v;
        B.querySelector('#' + prefix + 'rs-val').textContent = v;
      }
      applySettings();
      saveSettings();
      if (state.rendition && (id === 'fs' || id === 'lh' || id === 'ls')) applyEpubTheme();
      if (id === 'fs' || id === 'lh' || id === 'ls' || id === 'mw') scheduleBeeLineRefresh();
    });
  });
}

function showSettings() {
  const html = buildTypographyFields('') + `
  <div class="field"><label>Листание нажатием по краям экрана</label><div class="seg" data-seg="tapZones"><button data-val="1" class="${settings.tapZones ? 'on' : ''}">Вкл</button><button data-val="0" class="${!settings.tapZones ? 'on' : ''}">Выкл</button></div></div>
  <div class="field"><label for="as">Скорость автоскролла: <span id="as-val">${settings.autoScrollSpeed}</span></label><input type="range" id="as" min="1" max="15" value="${settings.autoScrollSpeed}"></div>
  <div class="field"><label for="ttsr">Скорость озвучки TTS</label><input type="range" id="ttsr" min="0.5" max="2" step="0.1" value="${settings.ttsRate}"></div>
  <div class="field"><label for="rsvp-r">Скорость RSVP: <span id="rs-val">${settings.rsvpSpeed}</span> слов/мин</label><input type="range" id="rsvp-r" min="100" max="1000" step="10" value="${settings.rsvpSpeed}"></div>
  <div style="display:flex;gap:10px;margin-top:20px"><button class="btn-ghost" id="btn-show-trash" style="flex:1;justify-content:center">Корзина</button><button class="btn-ghost" id="btn-reset-settings" style="flex:1;justify-content:center;border-color:rgba(200,90,70,.5);color:#c96a58">Сбросить</button></div>`;
  const ov = openSheet('Настройки', html);
  const B = ov._body;
  bindTypographyControls(B, '');
  B.querySelector('#btn-show-trash').addEventListener('click', () => {
    closeSheet();
    showTrash();
  });
  B.querySelector('#btn-reset-settings').addEventListener('click', async () => {
    if (await confirmDialog('Сбросить все настройки к значениям по умолчанию?', 'Сбросить')) {
      settings = { ...DEFAULT_SETTINGS };
      noiseController.stop();
      applySettings();
      saveSettings();
      applyChapterEnhancements();
      closeSheet();
      toast('Настройки сброшены');
    }
  });
}

function showReaderSettings() {
  const html = buildTypographyFields('r-') +
    `<div style="display:flex;justify-content:flex-end;margin-top:12px"><button type="button" class="btn-ghost" id="btn-goto-focus">Панель концентрации (линейка, шум)</button></div>`;
  const ov = openSheet('Чтение и Шрифт', html);
  bindTypographyControls(ov._body, 'r-');
  ov._body.querySelector('#btn-goto-focus').addEventListener('click', () => {
    showFocusPanel();
  });
}

/* ---------- Навигация (Главы / Закладки / Цитаты / Словарь) ---------- */
async function showTOC(initialTab = 'toc') {
  if (!state.current) return;
  const bookId = state.current.id;
  const html = `
  <div class="tabs" role="tablist">
    <button role="tab" class="${initialTab === 'toc' ? 'on' : ''}" data-tab="toc">Главы</button>
    <button role="tab" class="${initialTab === 'bm' ? 'on' : ''}" data-tab="bm">Закладки</button>
    <button role="tab" class="${initialTab === 'notes' ? 'on' : ''}" data-tab="notes">Цитаты</button>
    <button role="tab" class="${initialTab === 'gloss' ? 'on' : ''}" data-tab="gloss">Словарь</button>
  </div>
  <div id="toc-tab-content"></div>`;
  const ov = openSheet('Навигация', html);
  const B = ov._body;
  const box = B.querySelector('#toc-tab-content');

  const renderTab = async (tab) => {
    B.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    if (tab === 'toc') {
      const items = state.rendition
        ? state.toc.map((t) => ({ title: t.label, href: t.href, index: null }))
        : (state.chapters || []).map((c, i) => ({ title: c.title || ('Глава ' + (i + 1)), index: i }));
      if (!items.length) {
        box.innerHTML = '<p class="hint">Оглавление отсутствует.</p>';
        return;
      }
      box.innerHTML = items
        .map((it) => `<button class="toc-item ${it.index === state.chapterIndex ? 'active' : ''}" data-idx="${it.index !== null ? it.index : ''}" data-href="${escHTML(it.href || '')}"><span style="flex:1">${escHTML(it.title)}</span></button>`)
        .join('');
      const act = box.querySelector('.toc-item.active');
      if (act) act.scrollIntoView({ block: 'center' });
    } else if (tab === 'bm') {
      const bms = ((await DB.getAll('bookmarks')) || []).filter((b) => b.bookId === bookId).sort((a, b) => b.timestamp - a.timestamp);
      if (!bms.length) {
        box.innerHTML = '<p class="hint">Закладок в этой книге пока нет.</p>';
        return;
      }
      box.innerHTML = bms
        .map((b) => `<div class="toc-item" data-bm-id="${b.id}" data-ch="${b.chapter ?? ''}" data-ratio="${b.ratio ?? 0}" data-cfi="${escHTML(b.cfi || '')}">
          <div style="flex:1"><div style="font-size:14px">${escHTML(b.label || 'Закладка')}</div><div style="font-size:10px;color:var(--muted);margin-top:2px">${Math.round((b.percent || 0) * 100)}% · ${new Date(b.timestamp).toLocaleDateString('ru-RU')}</div></div>
          <button class="icon-btn bm-del" data-del-bm="${b.id}" title="Удалить" aria-label="Удалить закладку"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
        </div>`)
        .join('');
    } else if (tab === 'notes') {
      const notes = ((await DB.getAll('notes')) || []).filter((n) => n.bookId === bookId).sort((a, b) => b.timestamp - a.timestamp);
      if (!notes.length) {
        box.innerHTML = '<p class="hint">Сохранённых цитат пока нет. Выделите фрагмент текста в книге, чтобы сохранить цитату.</p>';
        return;
      }
      box.innerHTML = `<div style="display:flex;justify-content:flex-end;margin-bottom:10px"><button class="btn-ghost" id="btn-export-md">Экспорт в Markdown</button></div>` +
        notes.map((n) => `<div class="def-item" style="position:relative;cursor:pointer" data-ch="${n.chapterIndex ?? ''}" data-ratio="${n.ratio ?? 0}">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;padding-right:28px">${escHTML(n.chapter || '')}</div>
          <div style="font-style:italic;margin-bottom:${n.comment ? '6px' : '0'}">«${escHTML(n.text)}»</div>
          ${n.comment ? `<div style="color:var(--accent);font-size:13.5px">— ${escHTML(n.comment)}</div>` : ''}
          <button class="icon-btn" data-del-note="${n.id}" style="position:absolute;top:4px;right:4px;width:28px;height:28px" title="Удалить" aria-label="Удалить цитату"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
        </div>`).join('');
      const expBtn = box.querySelector('#btn-export-md');
      if (expBtn) {
        expBtn.addEventListener('click', () => {
          const md = `# ${state.current.title}\n${state.current.author ? '*' + state.current.author + '*\n' : ''}\n` +
            notes.map((n) => `> ${n.text}\n${n.comment ? '\n**Заметка:** ' + n.comment + '\n' : ''}\n*(${n.chapter || ''})*`).join('\n\n---\n\n');
          downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), `${state.current.title}-quotes.md`);
          toast('Цитаты экспортированы в .md');
        });
      }
    } else if (tab === 'gloss') {
      const gloss = ((await DB.getAll('glossary')) || []).filter((g) => g.bookId === bookId).sort((a, b) => b.timestamp - a.timestamp);
      if (!gloss.length) {
        box.innerHTML = '<p class="hint">Словарь книги пуст. Выделите слово в тексте и нажмите «Вникнуть».</p>';
        return;
      }
      box.innerHTML = gloss
        .map((g) => `<div class="def-item" style="position:relative">
          <b>${escHTML(g.term)}</b>
          <div style="margin-top:4px">${escHTML(g.desc || '')}</div>
          <button class="icon-btn" data-del-gloss="${g.id}" style="position:absolute;top:4px;right:4px;width:28px;height:28px" title="Удалить" aria-label="Удалить термин"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
        </div>`)
        .join('');
    }
  };

  B.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) renderTab(b.dataset.tab);
  });

  box.addEventListener('click', async (e) => {
    const delBm = e.target.closest('[data-del-bm]');
    if (delBm) {
      e.stopPropagation();
      await DB.del('bookmarks', Number(delBm.dataset.delBm));
      return renderTab('bm');
    }
    const delNote = e.target.closest('[data-del-note]');
    if (delNote) {
      e.stopPropagation();
      await DB.del('notes', Number(delNote.dataset.delNote));
      return renderTab('notes');
    }
    const delGloss = e.target.closest('[data-del-gloss]');
    if (delGloss) {
      e.stopPropagation();
      await DB.del('glossary', Number(delGloss.dataset.delGloss));
      return renderTab('gloss');
    }

    const bmRow = e.target.closest('[data-bm-id]');
    if (bmRow) {
      closeSheet();
      if (state.rendition && bmRow.dataset.cfi) state.rendition.display(bmRow.dataset.cfi);
      else if (bmRow.dataset.ch !== '') renderChapter(parseInt(bmRow.dataset.ch, 10), parseFloat(bmRow.dataset.ratio) || 0);
      return;
    }
    const noteRow = e.target.closest('.def-item[data-ch]');
    if (noteRow && noteRow.dataset.ch !== '' && !state.rendition) {
      closeSheet();
      renderChapter(parseInt(noteRow.dataset.ch, 10), parseFloat(noteRow.dataset.ratio) || 0);
      return;
    }
    const tocBtn = e.target.closest('.toc-item');
    if (tocBtn) {
      closeSheet();
      if (state.rendition && tocBtn.dataset.href) state.rendition.display(tocBtn.dataset.href).catch(() => toast('Не удалось перейти'));
      else if (tocBtn.dataset.idx !== '') renderChapter(parseInt(tocBtn.dataset.idx, 10), 0);
    }
  });

  renderTab(initialTab);
}

/* ---------- События ---------- */
function on(sel, ev, fn, opts) {
  const el = $(sel);
  if (el) el.addEventListener(ev, fn, opts);
  return el;
}

function bindEvents() {
  on('#btn-import', 'click', () => $('#file-input')?.click());
  on('#btn-import-2', 'click', () => $('#file-input')?.click());
  on('#btn-import-folder', 'click', () => $('#folder-input')?.click());
  on('#btn-import-folder-2', 'click', () => $('#folder-input')?.click());
  on('#file-input', 'change', (e) => {
    handleFiles(e.target.files);
    e.target.value = '';
  });
  on('#folder-input', 'change', (e) => {
    handleFiles(e.target.files);
    e.target.value = '';
  });
  on('#cover-input', 'change', onCoverPicked);

  on('#backup-input', 'change', async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.settings) {
        settings = { ...DEFAULT_SETTINGS, ...data.settings };
        applySettings();
        saveSettings();
      }
      await importBackupData(data);
      closeSheet();
      await loadLibrary();
      toast('Резервная копия восстановлена');
    } catch {
      toast('Ошибка чтения файла резервной копии');
    }
  });

  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      dragDepth++;
      $('#drop-zone')?.classList.add('active');
    }
  });
  window.addEventListener('dragover', (e) => { e.preventDefault(); });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) $('#drop-zone')?.classList.remove('active');
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('#drop-zone')?.classList.remove('active');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });

  on('#btn-stats', 'click', showStatsSheet);
  on('#btn-settings', 'click', showSettings);
  on('#btn-trash', 'click', showTrash);
  on('#btn-night', 'click', () => {
    const cur = settings.nightFilter > 0 ? 0 : 30;
    settings.nightFilter = cur;
    applySettings();
    saveSettings();
    toast(cur ? 'Ночной фильтр вкл' : 'Ночной фильтр выкл');
  });
  on('#btn-theme', 'click', () => {
    const i = THEMES.indexOf(settings.theme);
    settings.theme = THEMES[(i + 1) % THEMES.length];
    applySettings();
    saveSettings();
    if (state.rendition) applyEpubTheme();
    toast('Тема: ' + THEME_NAMES[settings.theme]);
  });

  const searchInp = $('#lib-search');
  const clearBtn = $('#lib-search-clear');
  if (searchInp && clearBtn) {
    searchInp.addEventListener('input', debounce(() => {
      libSearchQuery = searchInp.value;
      clearBtn.hidden = !libSearchQuery;
      renderLibrary();
    }, 150));
    clearBtn.addEventListener('click', () => {
      searchInp.value = '';
      libSearchQuery = '';
      clearBtn.hidden = true;
      renderLibrary();
    });
  }
  on('#lib-format-pills', 'click', (e) => {
    const b = e.target.closest('[data-fmt]');
    if (!b) return;
    libFilterFormat = b.dataset.fmt;
    renderLibrary();
  });
  on('#lib-sort', 'change', (e) => {
    libSortBy = e.target.value;
    renderLibrary();
  });

  on('#grid', 'click', (e) => {
    const del = e.target.closest('.book-del');
    const card = e.target.closest('.book-card');
    if (!card) return;
    const id = card.dataset.id;
    if (del) {
      e.stopPropagation();
      showBookMenu(id);
    } else if (e.target.closest('.book-open-btn')) {
      openBook(id);
    }
  });

  on('#btn-paste-text', 'click', showPasteTextSheet);
  on('#btn-paste-text-2', 'click', showPasteTextSheet);
  on('#btn-demo-text', 'click', openDemoArticle);

  on('#btn-close-reader', 'click', closeReader);
  on('#btn-prev', 'click', goPrev);
  on('#btn-next', 'click', goNext);
  on('#btn-focus-panel', 'click', showFocusPanel);
  on('#btn-bionic-quick', 'click', () => {
    settings.bionicReading = !settings.bionicReading;
    applySettings();
    saveSettings();
    applyChapterEnhancements();
    toast(settings.bionicReading ? 'Бионическое чтение вкл' : 'Бионическое чтение выкл');
  });
  on('#btn-noise-quick', 'click', () => {
    const cur = noiseController.getState().mode;
    if (cur !== 'off') {
      settings.noiseMode = 'off';
      noiseController.stop();
      saveSettings();
      updateFocusToolbarBadges();
      toast('Фоновый шум выкл');
    } else {
      const target = lastActiveNoiseMode || 'pink';
      settings.noiseMode = target;
      noiseController.setVolume(settings.noiseVolume ?? 0.25);
      const ok = noiseController.setMode(target);
      saveSettings();
      updateFocusToolbarBadges();
      const labels = { white: 'Белый шум', pink: 'Розовый шум', brown: 'Коричневый шум' };
      toast(ok ? (labels[target] || 'Фоновый шум') + ' вкл' : 'Web Audio недоступен');
    }
  });
  on('#btn-toc', 'click', () => showTOC('toc'));
  on('#btn-search', 'click', showSearchSheet);
  on('#btn-bookmark', 'click', addBookmark);
  on('#btn-summary', 'click', showSummary);
  on('#btn-reader-settings', 'click', showReaderSettings);
  on('#btn-rsvp', 'click', startRSVP);
  on('#btn-autoscroll', 'click', toggleAutoScroll);
  on('#btn-tts', 'click', () => {
    if (state.isSpeaking) speakText('');
    else currentChapterText().then((txt) => speakText(txt));
  });
  on('#btn-fullscreen', 'click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen && document.exitFullscreen().catch(() => {});
  });

  let rulerRaf = 0;
  const updateRulerY = (y) => {
    if (!settings.readingRuler || !state.current || state.rendition) return;
    if (!rulerRaf) {
      rulerRaf = requestAnimationFrame(() => {
        document.documentElement.style.setProperty('--ruler-y', Math.round(y) + 'px');
        rulerRaf = 0;
      });
    }
  };

  on('#reader', 'pointermove', (e) => {
    if (settings.zenAutoHide && state.current && !state.barsVisible && e.clientY <= 38) {
      setBars(true);
    }
    updateRulerY(e.clientY);
  }, { passive: true });

  on('#reader', 'pointerdown', (e) => {
    if (e.pointerType === 'touch') updateRulerY(e.clientY);
  }, { passive: true });

  on('#reader-inner', 'mouseover', (e) => {
    if (!settings.focusMode) return;
    const block = e.target.closest('p, li, blockquote');
    if (block && block.closest('#reader-inner') && block !== lastFocusedPara) {
      focusManualLockUntil = Date.now() + 300;
      setFocusedParagraph(block, false);
    }
  });

  let scrollTicking = false;
  let lastZenScrollTop = 0;
  on('#reader-body', 'scroll', () => {
    if (!scrollTicking) {
      requestAnimationFrame(() => {
        const body = $('#reader-body');
        if (body && settings.zenAutoHide && !state.isAutoScrolling && Date.now() >= focusManualLockUntil) {
          const st = body.scrollTop;
          const delta = st - lastZenScrollTop;
          if (st > 72 && delta > 24 && state.barsVisible) {
            setBars(false);
            lastZenScrollTop = st;
          } else if ((st < 28 || delta < -48) && !state.barsVisible) {
            setBars(true);
            lastZenScrollTop = st;
          } else if (Math.abs(delta) > 24) {
            lastZenScrollTop = st;
          }
        } else if (body) {
          lastZenScrollTop = body.scrollTop;
        }
        updateCustomProgress();
        if (settings.focusMode) updateFocus();
        scrollTicking = false;
      });
      scrollTicking = true;
    }
  }, { passive: true });

  on('#quick-nav', 'input', (e) => {
    const idx = parseInt(e.target.value, 10);
    if (!Number.isNaN(idx)) renderChapter(idx, 0);
  });

  on('#reader-body', 'click', (e) => {
    const noteEl = e.target.closest('.note-ref');
    if (noteEl) {
      e.stopPropagation();
      return showFootnote(noteEl.dataset.note);
    }
    if (window.getSelection().toString().trim()) return;
    if (settings.tapZones) {
      const w = window.innerWidth;
      const x = e.clientX;
      if (x < w * 0.22) return pageUp();
      if (x > w * 0.78) return pageDown();
    }
    setBars(!state.barsVisible);
  });

  (() => {
    let sx = 0, sy = 0, active = false, horiz = null;
    const body = $('#reader-body');
    const inner = $('#reader-inner');
    if (!body || !inner) return;
    body.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        sx = e.touches[0].clientX;
        sy = e.touches[0].clientY;
        active = true;
        horiz = null;
        inner.classList.add('swiping');
      }
    }, { passive: true });
    body.addEventListener('touchmove', (e) => {
      if (!active || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - sx;
      const dy = e.touches[0].clientY - sy;
      if (horiz === null && (Math.abs(dx) > 14 || Math.abs(dy) > 14)) {
        horiz = Math.abs(dx) > Math.abs(dy) * 1.25;
      }
      if (horiz) inner.style.transform = `translate3d(${dx * 0.38}px,0,0)`;
    }, { passive: true });
    body.addEventListener('touchend', (e) => {
      inner.classList.remove('swiping');
      if (!active || !e.changedTouches[0]) {
        inner.style.transform = '';
        return;
      }
      active = false;
      if (window.getSelection().toString().trim()) {
        inner.style.transform = '';
        return;
      }
      const t = e.changedTouches[0];
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;
      if (horiz && Math.abs(dx) > 62 && Math.abs(dy) < 56) {
        if (dx > 0) goPrev();
        else goNext();
      } else {
        inner.style.transform = '';
      }
    }, { passive: true });
  })();

  on('#term-pill', 'click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const t = state.selection;
    hideTermPill();
    if (b.dataset.act === 'term') openTerm(t);
    else if (b.dataset.act === 'note') showNoteSheet(t);
    else if (b.dataset.act === 'copy') copyTextToClipboard(t);
    else if (b.dataset.act === 'speak') speakText(t);
  });

  on('#reader-inner', 'mouseup', () => {
    setTimeout(() => {
      const t = window.getSelection().toString().trim();
      if (t && t.length >= 2 && t.length <= 300) showTermPill(t);
      else hideTermPill();
    }, 15);
  });
  on('#reader-inner', 'touchend', () => {
    setTimeout(() => {
      const t = window.getSelection().toString().trim();
      if (t && t.length >= 2 && t.length <= 300) showTermPill(t);
    }, 180);
  });

  on('#btn-rsvp-close', 'click', stopRSVP);
  on('#btn-rsvp-play', 'click', () => {
    if (rsvpInterval) pauseRSVP();
    else {
      if (rsvpIndex >= rsvpWords.length) rsvpIndex = 0;
      playRSVP();
    }
  });
  on('#rsvp-speed', 'input', (e) => {
    settings.rsvpSpeed = parseInt(e.target.value, 10);
    const lbl = $('#rsvp-speed-label');
    if (lbl) lbl.textContent = settings.rsvpSpeed + ' слов/мин';
    saveSettings();
    if (rsvpInterval) {
      pauseRSVP();
      playRSVP();
    }
  });
  on('#rsvp-minus', 'click', () => {
    const el = $('#rsvp-speed');
    if (!el) return;
    el.value = Math.max(100, parseInt(el.value, 10) - 50);
    el.dispatchEvent(new Event('input'));
  });
  on('#rsvp-plus', 'click', () => {
    const el = $('#rsvp-speed');
    if (!el) return;
    el.value = Math.min(1000, parseInt(el.value, 10) + 50);
    el.dispatchEvent(new Event('input'));
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input,textarea,select')) return;
    if (e.key === 'Escape') {
      if (_currentOverlay) return closeSheet();
      const rsvpOv = $('#rsvp-overlay');
      if (rsvpOv && !rsvpOv.hidden) return stopRSVP();
      const readerEl = $('#reader');
      if (readerEl && !readerEl.hidden) return closeReader();
    }
    const readerEl = $('#reader');
    if (!readerEl || readerEl.hidden || _currentOverlay) return;
    if (e.key === 'ArrowLeft') goPrev();
    else if (e.key === 'ArrowRight') goNext();
    else if (settings.focusMode && !state.rendition && e.key === 'ArrowDown') {
      e.preventDefault();
      moveParagraphFocus(1);
    } else if (settings.focusMode && !state.rendition && e.key === 'ArrowUp') {
      e.preventDefault();
      moveParagraphFocus(-1);
    } else if (e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) {
      e.preventDefault();
      pageDown();
    } else if (e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) {
      e.preventDefault();
      pageUp();
    } else if (e.key === 'b' || e.key === 'B' || e.key === 'и' || e.key === 'И') addBookmark();
    else if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') $('#btn-fullscreen')?.click();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      flushReadingSession();
      if (state.rendition) {
        try {
          const loc = state.rendition.currentLocation();
          if (loc && loc.start) saveEpubProgress(loc);
        } catch { /* ignore */ }
      }
    } else {
      state.readingTickAt = Date.now();
    }
  });

  window.addEventListener('pagehide', () => {
    flushReadingSession();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  });
}

/* ---------- Инициализация ---------- */
function hideBoot() {
  const boot = $('#boot');
  if (boot) {
    boot.style.display = 'none';
    boot.hidden = true;
  }
}

function withTimeout(promise, ms = 2500) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error('Operation timeout')), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

let resizeBound = false;
async function init() {
  const bootGuard = setTimeout(hideBoot, 2500);
  try {
    applySettings();
    bindEvents();
    initPWAController({ openSheet, toast });
    await withTimeout(Promise.all([loadSettings(), loadLibrary()]), 2200).catch(() => {
      libraryCache = [];
      progressMap = {};
      renderLibrary();
    });
    applySettings();
  } catch (err) {
    console.error('GRIMOIRE init error:', err);
    toast('Ошибка инициализации хранилища', 3000);
    try { renderLibrary(); } catch { /* ignore */ }
  } finally {
    clearTimeout(bootGuard);
    hideBoot();
    if (!resizeBound) {
      resizeBound = true;
      window.addEventListener('resize', debounce(() => {
        if (state.rendition && state.rendition.resize) state.rendition.resize();
        scheduleBeeLineRefresh();
      }, 200));
    }
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
