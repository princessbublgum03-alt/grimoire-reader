export const SUPPORTED_EXTS = [
  'epub', 'fb2', 'zip', 'txt', 'md', 'markdown',
  'mobi', 'prc', 'azw', 'azw3', 'docx', 'odt',
  'rtf', 'pdf', 'cbz', 'html', 'htm', 'xhtml'
];

export const MAX_FILE_SIZE = 250 * 1024 * 1024;
export const MAX_CHAPTER_HTML_CHARS = 48000;

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const escHTML = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));

export const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const debounce = (fn, ms) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};

export const WIN1251_MAP = [
  0x0402, 0x0403, 0x201A, 0x0453, 0x201E, 0x2026, 0x2020, 0x2021,
  0x20AC, 0x2030, 0x0409, 0x2039, 0x040A, 0x040C, 0x040B, 0x040F,
  0x0452, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
  0x0098, 0x2122, 0x0459, 0x203A, 0x045A, 0x045C, 0x045B, 0x045F,
  0x00A0, 0x040E, 0x045E, 0x0408, 0x00A4, 0x0490, 0x00A6, 0x00A7,
  0x0401, 0x00A9, 0x0404, 0x00AB, 0x00AC, 0x00AD, 0x00AE, 0x0407,
  0x00B0, 0x00B1, 0x0406, 0x0456, 0x0491, 0x00B5, 0x00B6, 0x00B7,
  0x0451, 0x2116, 0x0454, 0x00BB, 0x0458, 0x0405, 0x0455, 0x0457
];

export function win1251ByteToChar(b) {
  if (b < 0x80) return String.fromCharCode(b);
  if (b >= 0xC0) return String.fromCharCode(0x0410 + (b - 0xC0));
  return String.fromCharCode(WIN1251_MAP[b - 0x80] || 0x20);
}

export function win1252ByteToChar(b) {
  const map1252 = {
    0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026,
    0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160,
    0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019,
    0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
    0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153,
    0x9E: 0x017E, 0x9F: 0x0178
  };
  if (b >= 0x80 && b <= 0x9F && map1252[b]) return String.fromCharCode(map1252[b]);
  return String.fromCharCode(b);
}

export function decodeBuffer(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (!bytes.length) return '';
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  let enc = '';
  try {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 512));
    const m = head.match(/encoding\s*=\s*["']([\w-]+)["']/i) || head.match(/charset\s*=\s*["']?([\w-]+)/i);
    if (m) enc = m[1].toLowerCase();
  } catch { /* ignore */ }
  if (enc && enc !== 'utf-8' && enc !== 'utf8') {
    try {
      return new TextDecoder(enc).decode(bytes);
    } catch { /* ignore */ }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { /* ignore */ }
  try {
    return new TextDecoder('windows-1251').decode(bytes);
  } catch {
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += win1251ByteToChar(bytes[i]);
    return out;
  }
}

let _scratch = null;
export function htmlToText(html) {
  if (!html) return '';
  const prepped = String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section|pre)>/gi, '\n');

  if (typeof document !== 'undefined') {
    if (!_scratch) _scratch = document.createElement('div');
    _scratch.innerHTML = prepped;
    const txt = _scratch.textContent || '';
    _scratch.textContent = '';
    return txt
      .replace(/[ \t\u00a0]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  }

  return prepped
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

export function countWords(str) {
  if (!str) return 0;
  const m = String(str).trim().match(/\S+/g);
  return m ? m.length : 0;
}

export function sanitizeHtml(html) {
  const raw = String(html || '');
  if (typeof document !== 'undefined') {
    const d = document.createElement('div');
    d.innerHTML = raw;
    d.querySelectorAll('script,style,link,meta,iframe,object,embed,audio,video,form,input,button,base').forEach((e) => e.remove());
    d.querySelectorAll('*').forEach((el) => {
      for (const a of [...el.attributes]) {
        const name = a.name.toLowerCase();
        const val = String(a.value || '').trim();
        if (name.startsWith('on') || name === 'style' || name === 'srcdoc' || (el.tagName === 'FONT' && (name === 'face' || name === 'size' || name === 'color'))) {
          el.removeAttribute(a.name);
        } else if ((name === 'href' || name === 'src' || name === 'xlink:href') && /^(javascript|vbscript|data:\s*text\/html):/i.test(val)) {
          el.removeAttribute(a.name);
        }
      }
    });
    return d.innerHTML;
  }
  return raw
    .replace(/<(script|style|iframe|object|embed|form|base)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|link|meta|input|button|base)[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\sstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(<font\b[^>]*?)\s(?:face|size|color)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '$1')
    .replace(/(href|src)\s*=\s*["']\s*(javascript|vbscript):[^"']*["']/gi, '$1="#"');
}

export function textLinesToHtml(lines) {
  const blocks = lines.join('\n').split(/\n\s*\n/);
  const out = [];
  for (const b of blocks) {
    const t = b.trim();
    if (!t) continue;
    out.push('<p>' + escHTML(t).replace(/\n/g, '<br>') + '</p>');
  }
  return out.join('') || '<p></p>';
}

/**
 * Splits oversized chapters along safe block boundaries (</p>, </div>, </figure>, <hr>)
 * so DOM rendering and scroll calculation remain fast even for massive books.
 */
export function chunkOversizedChapters(chapters, maxChars = MAX_CHAPTER_HTML_CHARS) {
  if (!Array.isArray(chapters) || !chapters.length) return chapters || [];
  const out = [];
  for (const ch of chapters) {
    const html = String(ch.html || '');
    if (html.length <= maxChars || html.includes('data-asset=')) {
      out.push(ch);
      continue;
    }
    const tokens = html.split(/(?=<(?:p|div|blockquote|h[1-6]|pre|ul|ol|table|figure|hr)\b)/i);
    if (tokens.length <= 1) {
      out.push(ch);
      continue;
    }
    const parts = [];
    let buf = '';
    for (const tok of tokens) {
      if (buf.length + tok.length > maxChars && buf.length > 0) {
        parts.push(buf);
        buf = tok;
      } else {
        buf += tok;
      }
    }
    if (buf) parts.push(buf);

    if (parts.length <= 1) {
      out.push(ch);
    } else {
      parts.forEach((p, idx) => {
        out.push({
          ...ch,
          title: `${ch.title || 'Глава'} (${idx + 1}/${parts.length})`,
          html: p
        });
      });
    }
  }
  return out;
}

export class LRUCache {
  constructor(maxSize = 20, onEvict = null) {
    this.maxSize = maxSize;
    this.onEvict = onEvict;
    this.map = new Map();
  }
  has(key) {
    return this.map.has(key);
  }
  get(key) {
    if (!this.map.has(key)) return undefined;
    const val = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, val);
    return val;
  }
  set(key, val) {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      const oldestKey = this.map.keys().next().value;
      const oldestVal = this.map.get(oldestKey);
      this.map.delete(oldestKey);
      if (this.onEvict) this.onEvict(oldestKey, oldestVal);
    }
    this.map.set(key, val);
    return this;
  }
  delete(key) {
    if (!this.map.has(key)) return false;
    const val = this.map.get(key);
    this.map.delete(key);
    if (this.onEvict) this.onEvict(key, val);
    return true;
  }
  clear() {
    if (this.onEvict) {
      for (const [k, v] of this.map.entries()) this.onEvict(k, v);
    }
    this.map.clear();
  }
}
