import {
  escHTML,
  escRe,
  decodeBuffer,
  win1251ByteToChar,
  win1252ByteToChar,
  htmlToText,
  sanitizeHtml,
  textLinesToHtml,
  chunkOversizedChapters
} from './text-utils.js';

/* ---------- TXT & Markdown ---------- */
export function parsePlain(text, fallbackTitle) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const headRe = /^\s*(?:(?:глава|часть|книга|том|пролог|эпилог|chapter|part|book)[\s.:№\dIVXLCDM][^.!?]{0,60}|#{1,3}\s+\S.*)$/i;
  const chapters = [];
  let cur = { title: fallbackTitle || 'Начало', lines: [] };
  for (const line of lines) {
    const t = line.trim();
    if (t && t.length < 80 && headRe.test(t) && !/[.!?]$/.test(t) && cur.lines.join('').trim().length > 300) {
      chapters.push(cur);
      cur = { title: t.replace(/^#+\s*/, ''), lines: [] };
    } else {
      cur.lines.push(line);
    }
  }
  chapters.push(cur);
  const out = chapters
    .map((c, i) => ({ title: c.title || ('Часть ' + (i + 1)), html: textLinesToHtml(c.lines) }))
    .filter((c) => c.html !== '<p></p>');
  const finalChapters = chunkOversizedChapters(out.length ? out : [{ title: 'Текст', html: textLinesToHtml(lines) }]);
  return { title: fallbackTitle, author: '', chapters: finalChapters, format: 'txt' };
}

function mdInline(s) {
  return escHTML(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^\w_])_([^_\n]+)_/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<span class="md-link">$1</span>');
}

export function parseMarkdownBook(text, fallbackTitle) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const sections = [];
  let cur = { title: fallbackTitle || 'Начало', blocks: [] };
  let buf = [];
  const flushBuf = () => {
    if (buf.length) {
      cur.blocks.push(buf.join('\n'));
      buf = [];
    }
  };
  for (const l of lines) {
    const hm = l.match(/^(#{1,2})\s+(.*)$/);
    if (hm) {
      flushBuf();
      if (cur.blocks.length) sections.push(cur);
      cur = { title: hm[2].trim(), blocks: [] };
    } else if (!l.trim()) {
      flushBuf();
    } else {
      buf.push(l);
    }
  }
  flushBuf();
  if (cur.blocks.length || !sections.length) sections.push(cur);
  const chapters = sections.map((sec, idx) => {
    const html = sec.blocks.map((b) => {
      const t = b.trim();
      if (!t) return '';
      if (/^```/.test(t)) return '<pre>' + escHTML(t.replace(/^```[^\n]*\n?/, '').replace(/```\s*$/, '')) + '</pre>';
      let m;
      if ((m = t.match(/^(#{1,6})\s+(.*)$/))) {
        const lvl = Math.min(m[1].length + 1, 6);
        return '<h' + lvl + '>' + mdInline(m[2]) + '</h' + lvl + '>';
      }
      if (/^(---|\*\*\*|___)$/.test(t)) return '<hr>';
      if (/^>\s?/.test(t)) return '<blockquote>' + t.split('\n').map((l) => mdInline(l.replace(/^>\s?/, ''))).join('<br>') + '</blockquote>';
      if (/^[-*+]\s+/.test(t)) return '<ul>' + t.split('\n').filter((l) => /^[-*+]\s+/.test(l)).map((l) => '<li>' + mdInline(l.replace(/^[-*+]\s+/, '')) + '</li>').join('') + '</ul>';
      if (/^\d+\.\s+/.test(t)) return '<ol>' + t.split('\n').filter((l) => /^\d+\.\s+/.test(l)).map((l) => '<li>' + mdInline(l.replace(/^\d+\.\s+/, '')) + '</li>').join('') + '</ol>';
      return '<p>' + mdInline(t).replace(/\n/g, '<br>') + '</p>';
    }).join('\n');
    return { title: sec.title || ('Глава ' + (idx + 1)), html: html || '<p></p>' };
  });
  return { title: fallbackTitle, author: '', chapters: chunkOversizedChapters(chapters), format: 'md' };
}

/* ---------- FB2 ---------- */
function fb2Node(node, binaries) {
  if (node.nodeType === 3) return escHTML(node.nodeValue);
  if (node.nodeType !== 1) return '';
  const name = (node.localName || '').toLowerCase();
  const inner = () => [...node.childNodes].map((c) => fb2Node(c, binaries)).join('');
  switch (name) {
    case 'p': return '<p>' + inner() + '</p>';
    case 'emphasis': return '<em>' + inner() + '</em>';
    case 'strong': return '<strong>' + inner() + '</strong>';
    case 'strikethrough': return '<del>' + inner() + '</del>';
    case 'sub': return '<sub>' + inner() + '</sub>';
    case 'sup': return '<sup>' + inner() + '</sup>';
    case 'code': return '<code>' + inner() + '</code>';
    case 'title': return '<h3>' + inner() + '</h3>';
    case 'subtitle': return '<h4>' + inner() + '</h4>';
    case 'epigraph':
    case 'cite': return '<blockquote>' + inner() + '</blockquote>';
    case 'annotation': return '<div class="fb-annotation">' + inner() + '</div>';
    case 'poem': return '<div class="fb-poem">' + inner() + '</div>';
    case 'stanza': return '<div class="fb-stanza">' + inner() + '</div>';
    case 'v': return '<p class="fb-v">' + inner() + '</p>';
    case 'text-author':
    case 'date': return '<p class="fb-author">' + inner() + '</p>';
    case 'empty-line': return '<div class="fb-empty"></div>';
    case 'table': return '<table class="fb-table">' + inner() + '</table>';
    case 'tr': return '<tr>' + inner() + '</tr>';
    case 'th': return '<th>' + inner() + '</th>';
    case 'td': return '<td>' + inner() + '</td>';
    case 'image': {
      const href = node.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
        node.getAttribute('xlink:href') || node.getAttribute('l:href') || node.getAttribute('href') || '';
      const id = href.replace(/^#/, '');
      if (binaries && binaries[id]) return '<figure><img src="' + binaries[id] + '" loading="lazy" alt=""></figure>';
      return '';
    }
    case 'a': {
      const type = node.getAttribute('type') || '';
      const href = node.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
        node.getAttribute('xlink:href') || node.getAttribute('l:href') || node.getAttribute('href') || '';
      if ((type === 'note' || href.startsWith('#')) && href) {
        return '<sup class="note-ref" data-note="' + escHTML(href.replace(/^#/, '')) + '">[' + (inner() || '*') + ']</sup>';
      }
      return '<span>' + inner() + '</span>';
    }
    default: return inner();
  }
}

function collectFB2Sections(sec, prefix, out, binaries) {
  const titleEl = [...sec.children].find((e) => e.localName === 'title');
  const name = [prefix, titleEl ? (titleEl.textContent || '').replace(/\s+/g, ' ').trim() : ''].filter(Boolean).join(' · ');
  const kids = [...sec.children].filter((e) => e.localName === 'section');
  const ownNodes = [...sec.children].filter((e) => e.localName !== 'section' && e.localName !== 'title');
  if (kids.length) {
    if (ownNodes.length) {
      const html = ownNodes.map((n) => fb2Node(n, binaries)).join('');
      if (html.trim()) out.push({ title: name || 'Фрагмент', html });
    }
    kids.forEach((k) => collectFB2Sections(k, name, out, binaries));
  } else {
    out.push({ title: name || ('Глава ' + (out.length + 1)), html: ownNodes.map((n) => fb2Node(n, binaries)).join('') || '<p></p>' });
  }
}

export function parseFB2Fallback(xmlText) {
  const titleM = xmlText.match(/<book-title[^>]*>([\s\S]*?)<\/book-title>/i);
  const title = titleM ? (htmlToText(titleM[1]).trim() || 'Без названия') : 'Без названия';
  const firstM = xmlText.match(/<first-name[^>]*>([\s\S]*?)<\/first-name>/i);
  const lastM = xmlText.match(/<last-name[^>]*>([\s\S]*?)<\/last-name>/i);
  const author = [firstM ? htmlToText(firstM[1]) : '', lastM ? htmlToText(lastM[1]) : ''].filter(Boolean).join(' ').trim();
  const bodyM = xmlText.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let body = bodyM ? bodyM[1] : xmlText;
  body = body.replace(/<binary[^>]*>[\s\S]*?<\/binary>/gi, '');
  const text = body
    .replace(/<title[^>]*>/gi, '\n\n## ')
    .replace(/<\/title>/gi, '\n')
    .replace(/<p[^>]*>/gi, '\n\n')
    .replace(/<\/p>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
  if (!text) throw new Error('FB2: XML повреждён');
  return { ...parsePlain(text, title), title, author, format: 'fb2' };
}

export function parseFB2(xmlText) {
  if (typeof DOMParser === 'undefined') return parseFB2Fallback(xmlText);
  let doc = null;
  try {
    const parser = new DOMParser();
    doc = parser.parseFromString(xmlText, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      doc = parser.parseFromString(xmlText.replace(/<\?xml[^?]*\?>/g, '').replace(/<!DOCTYPE[^>]*>/gi, ''), 'text/xml');
    }
    if (doc.getElementsByTagName('parsererror').length) doc = null;
  } catch {
    doc = null;
  }
  if (!doc) return parseFB2Fallback(xmlText);

  const all = (tag, root = doc) => [...root.getElementsByTagNameNS('*', tag)];
  const first = (tag, root = doc) => all(tag, root)[0] || null;
  const txt = (n) => (n ? (n.textContent || '').trim() : '');

  const ti = first('title-info');
  const title = txt(ti ? first('book-title', ti) : null) || 'Без названия';
  let author = '';
  if (ti) {
    const a = first('author', ti);
    if (a) author = ['first-name', 'middle-name', 'last-name', 'nickname'].map((t) => txt(first(t, a))).filter(Boolean).join(' ');
  }

  const binaries = {};
  all('binary').forEach((b) => {
    const id = b.getAttribute('id');
    if (id) {
      const ct = b.getAttribute('content-type') || 'image/jpeg';
      const data = (b.textContent || '').replace(/\s+/g, '');
      if (data) binaries[id] = 'data:' + ct + ';base64,' + data;
    }
  });

  let cover = null;
  try {
    const cp = ti ? first('coverpage', ti) : null;
    if (cp) {
      const img = first('image', cp);
      if (img) {
        const href = img.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
          img.getAttribute('xlink:href') || img.getAttribute('l:href') || img.getAttribute('href') || '';
        const id = href.replace(/^#/, '');
        if (binaries[id]) cover = binaries[id];
      }
    }
  } catch {
    cover = null;
  }

  const bodies = all('body');
  const notesBody = bodies.find((b) => /notes|comments/i.test(b.getAttribute('name') || '')) || null;
  const notes = {};
  if (notesBody) {
    all('section', notesBody).forEach((s) => {
      const id = s.getAttribute('id');
      if (id) {
        const tEl = first('title', s);
        const head = tEl ? '<strong>' + escHTML(txt(tEl)) + '</strong><br>' : '';
        notes[id] = sanitizeHtml(head + [...s.children].filter((c) => c.localName !== 'title').map((c) => fb2Node(c, binaries)).join(''));
      }
    });
  }

  const chapters = [];
  bodies.filter((b) => b !== notesBody).forEach((body) => {
    const secs = [...body.children].filter((c) => c.localName === 'section');
    if (secs.length) secs.forEach((s) => collectFB2Sections(s, '', chapters, binaries));
    else chapters.push({ title: 'Текст', html: [...body.children].map((c) => fb2Node(c, binaries)).join('') || '<p></p>' });
  });

  if (!chapters.length) throw new Error('FB2: нет текста');
  return { title, author, cover, chapters: chunkOversizedChapters(chapters), notes, format: 'fb2' };
}

/* ---------- RTF (O(N) sticky-regex parser with codepage detection) ---------- */
export function parseRTF(buf, fallbackTitle) {
  const raw = new TextDecoder('latin1').decode(buf);
  const skipGroups = new Set([
    'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object',
    'header', 'footer', 'headerl', 'headerr', 'footnote', 'fldinst'
  ]);
  const cpgMatch = raw.slice(0, 512).match(/\\ansicpg(\d+)/i);
  const cpg = cpgMatch ? parseInt(cpgMatch[1], 10) : 1251;
  const byteToChar = cpg === 1252 ? win1252ByteToChar : win1251ByteToChar;

  const cmdRe = /([a-zA-Z]+)(-?\d*) ?/y;
  let out = '';
  let i = 0;
  const len = raw.length;
  let ucSkip = 1;
  const stack = [];
  let ignore = false;

  while (i < len) {
    const ch = raw[i];
    if (ch === '{') {
      stack.push({ ignore, ucSkip });
      i++;
      if (raw[i] === '\\' && raw[i + 1] === '*') {
        ignore = true;
        i += 2;
      }
    } else if (ch === '}') {
      const st = stack.pop();
      if (st) {
        ignore = st.ignore;
        ucSkip = st.ucSkip;
      }
      i++;
    } else if (ch === '\\') {
      i++;
      const next = raw[i];
      if (next === "'") {
        const hex = raw.slice(i + 1, i + 3);
        i += 3;
        if (!ignore) {
          const code = parseInt(hex, 16);
          if (!Number.isNaN(code)) out += byteToChar(code);
        }
      } else if (next === '\\' || next === '{' || next === '}') {
        if (!ignore) out += next;
        i++;
      } else if (next === '~') {
        if (!ignore) out += '\u00A0';
        i++;
      } else if (next === '\n' || next === '\r') {
        if (!ignore) out += '\n';
        i++;
      } else {
        cmdRe.lastIndex = i;
        const m = cmdRe.exec(raw);
        if (m) {
          const word = m[1].toLowerCase();
          const arg = m[2];
          i = cmdRe.lastIndex;
          if (word === 'bin' && arg !== '') {
            const n = Math.max(0, parseInt(arg, 10) || 0);
            i = Math.min(len, i + n);
          } else if (skipGroups.has(word)) {
            ignore = true;
          } else if (!ignore) {
            if (word === 'par' || word === 'pard' || word === 'line' || word === 'sect') out += '\n\n';
            else if (word === 'tab') out += '\t';
            else if (word === 'emdash') out += '—';
            else if (word === 'endash') out += '–';
            else if (word === 'lquote') out += '‘';
            else if (word === 'rquote') out += '’';
            else if (word === 'ldblquote') out += '«';
            else if (word === 'rdblquote') out += '»';
            else if (word === 'uc' && arg !== '') ucSkip = Math.max(0, parseInt(arg, 10) || 0);
            else if (word === 'u' && arg !== '') {
              let c = parseInt(arg, 10);
              if (c < 0) c += 65536;
              out += String.fromCharCode(c);
              let s = ucSkip;
              while (s > 0 && i < len) {
                if (raw[i] === '\\' && raw[i + 1] === "'") i += 4;
                else i++;
                s--;
              }
            }
          }
        } else {
          i++;
        }
      }
    } else if (ch === '\r' || ch === '\n') {
      i++;
    } else {
      if (!ignore) out += ch;
      i++;
    }
  }

  const clean = out.replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) throw new Error('RTF: текст не извлечён');
  const res = parsePlain(clean, fallbackTitle);
  res.format = 'rtf';
  return res;
}

/* ---------- MOBI / PalmDoc (hardened DataView bounds + auto-chunking) ---------- */
export function palmDocDecompress(input) {
  let cap = input.length * 3 + 1024;
  let out = new Uint8Array(cap);
  let pos = 0;
  let i = 0;
  const ensure = (n) => {
    if (pos + n >= cap) {
      cap = Math.max(cap * 2, pos + n + 1024);
      const next = new Uint8Array(cap);
      next.set(out);
      out = next;
    }
  };
  while (i < input.length) {
    const c = input[i++];
    if (c === 0) {
      ensure(1);
      out[pos++] = 0;
    } else if (c <= 8) {
      ensure(c);
      for (let k = 0; k < c && i < input.length; k++) out[pos++] = input[i++];
    } else if (c <= 0x7f) {
      ensure(1);
      out[pos++] = c;
    } else if (c <= 0xbf) {
      const c2 = input[i++] || 0;
      const pair = ((c & 0x3f) << 8) | c2;
      const dist = pair >> 3;
      const len = (pair & 7) + 3;
      ensure(len);
      const start = pos - dist;
      for (let k = 0; k < len; k++) out[pos++] = start + k >= 0 ? out[start + k] : 0x20;
    } else {
      ensure(2);
      out[pos++] = 0x20;
      out[pos++] = c ^ 0x80;
    }
  }
  return out.subarray(0, pos);
}

export function parseMOBI(buf, fallbackTitle) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.length < 100) throw new Error('MOBI: повреждён');
  const numRecords = dv.getUint16(76);
  if (!numRecords || numRecords < 2) throw new Error('MOBI: нет записей');

  const recOffsets = [];
  for (let i = 0; i < numRecords && 78 + i * 8 + 4 <= u8.length; i++) {
    const off = dv.getUint32(78 + i * 8);
    if (off >= u8.length) break;
    recOffsets.push(off);
  }
  if (recOffsets.length < 2) throw new Error('MOBI: пустая таблица');
  recOffsets.push(u8.length);

  const r0 = u8.subarray(recOffsets[0], recOffsets[1]);
  if (r0.length < 16) throw new Error('MOBI: повреждённый заголовок');
  const d0 = new DataView(r0.buffer, r0.byteOffset, r0.byteLength);
  const compression = d0.getUint16(0);
  const textLength = d0.getUint32(4);
  const textRecords = d0.getUint16(8);
  if (compression === 17480) throw new Error('MOBI: алгоритм сжатия HUFF/CDIC не поддерживается');

  let encoding = 1252;
  let title = fallbackTitle || 'Без названия';
  let author = '';
  const encName = () => (encoding === 65001 ? 'utf-8' : (encoding === 1251 ? 'windows-1251' : 'windows-1252'));

  if (r0.length >= 32 && String.fromCharCode(r0[16] || 0, r0[17] || 0, r0[18] || 0, r0[19] || 0) === 'MOBI') {
    const mobiHeaderLen = d0.getUint32(20);
    encoding = d0.getUint32(28) || 1252;
    try {
      if (r0.length >= 92) {
        const fullNameOff = d0.getUint32(84);
        const fullNameLen = d0.getUint32(88);
        if (fullNameOff && fullNameLen && fullNameOff + fullNameLen <= r0.length) {
          const t = new TextDecoder(encName()).decode(r0.subarray(fullNameOff, fullNameOff + fullNameLen)).trim();
          if (t) title = t;
        }
      }
      if (r0.length >= 0x84 && mobiHeaderLen >= 0x70) {
        const exthFlags = d0.getUint32(0x80);
        const exthOff = 16 + mobiHeaderLen;
        if ((exthFlags & 0x40) && exthOff + 12 <= r0.length) {
          if (String.fromCharCode(r0[exthOff], r0[exthOff + 1], r0[exthOff + 2], r0[exthOff + 3]) === 'EXTH') {
            const recCount = d0.getUint32(exthOff + 8);
            let p = exthOff + 12;
            const eView = new DataView(r0.buffer, r0.byteOffset, r0.byteLength);
            for (let k = 0; k < recCount && p + 8 <= r0.length; k++) {
              const rType = eView.getUint32(p);
              const rLen = eView.getUint32(p + 4);
              if (rLen < 8 || p + rLen > r0.length) break;
              const val = new TextDecoder(encName()).decode(r0.subarray(p + 8, p + rLen)).trim();
              if (rType === 100 && val) author = val;
              if (rType === 503 && val) title = val;
              p += rLen;
            }
          }
        }
      }
    } catch { /* ignore metadata decode failure */ }
  }

  const chunks = [];
  let total = 0;
  const last = Math.min(textRecords, recOffsets.length - 2);
  for (let i = 1; i <= last; i++) {
    const raw = u8.subarray(recOffsets[i], recOffsets[i + 1]);
    const dec = compression === 2 ? palmDocDecompress(raw) : raw;
    chunks.push(dec);
    total += dec.length;
  }
  const bytes = new Uint8Array(total);
  let pos = 0;
  for (const ch of chunks) {
    bytes.set(ch, pos);
    pos += ch.length;
  }
  const len = Math.min(textLength || bytes.length, bytes.length);
  const textSlice = bytes.subarray(0, len);
  let rawHtml = '';
  if (encoding === 65001) {
    try {
      rawHtml = new TextDecoder('utf-8', { fatal: true }).decode(textSlice);
    } catch {
      rawHtml = decodeBuffer(textSlice);
    }
  } else {
    try {
      rawHtml = new TextDecoder('utf-8', { fatal: true }).decode(textSlice);
    } catch {
      try {
        rawHtml = new TextDecoder(encName()).decode(textSlice);
      } catch {
        rawHtml = decodeBuffer(textSlice);
      }
    }
  }

  const parts = rawHtml.split(/<mbp:pagebreak[^>]*>/i).filter((p) => p.trim());
  const chapters = [];
  parts.forEach((part) => {
    let html = sanitizeHtml(part);
    if (typeof document !== 'undefined') {
      const wrap = document.createElement('div');
      wrap.innerHTML = html;
      wrap.querySelectorAll('a[filepos], a[recindex]').forEach((a) => {
        const span = document.createElement('span');
        span.innerHTML = a.innerHTML;
        a.replaceWith(span);
      });
      html = wrap.innerHTML;
    } else {
      html = html.replace(/<a\b[^>]*filepos[^>]*>([\s\S]*?)<\/a>/gi, '<span>$1</span>');
    }
    if (htmlToText(html).length < 40) return;
    let chTitle = 'Часть ' + (chapters.length + 1);
    const h = html.match(/<h[1-3][^>]*>([\s\S]{1,120}?)<\/h[1-3]>/i);
    if (h) {
      const tt = htmlToText(h[1]);
      if (tt && tt.length < 90) chTitle = tt;
    }
    chapters.push({ title: chTitle, html });
  });

  if (!chapters.length) {
    const plain = htmlToText(rawHtml);
    if (!plain.trim()) throw new Error('MOBI: текст не извлечён');
    chapters.push({ title: 'Текст', html: textLinesToHtml(plain.split('\n')) });
  }
  return { title, author, chapters: chunkOversizedChapters(chapters), format: 'mobi' };
}

/* ---------- HTML / XHTML ---------- */
export function parseHTMLBook(text, fallbackTitle) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const title = (doc.querySelector('title') && doc.querySelector('title').textContent.trim()) || fallbackTitle || 'Без названия';
  const authorMeta = doc.querySelector('meta[name="author"]');
  const author = authorMeta ? (authorMeta.getAttribute('content') || '').trim() : '';
  const cleanHtml = sanitizeHtml(doc.body ? doc.body.innerHTML : text);
  const wrap = document.createElement('div');
  wrap.innerHTML = cleanHtml;
  const chapters = [];
  let cur = { title, nodes: [] };
  for (const child of [...wrap.childNodes]) {
    if (child.nodeType === 1 && /^H[1-3]$/i.test(child.tagName)) {
      const hText = (child.textContent || '').trim();
      if (hText && cur.nodes.length > 1) {
        chapters.push({ title: cur.title, html: cur.nodes.join('') });
        cur = { title: hText, nodes: [] };
        continue;
      }
    }
    if (child.nodeType === 1) cur.nodes.push(child.outerHTML);
    else if (child.nodeType === 3 && child.nodeValue.trim()) cur.nodes.push('<p>' + escHTML(child.nodeValue.trim()) + '</p>');
  }
  if (cur.nodes.length) chapters.push({ title: cur.title, html: cur.nodes.join('') });
  if (!chapters.length) throw new Error('HTML: пустой документ');
  return { title, author, chapters: chunkOversizedChapters(chapters), format: 'html' };
}

/* ---------- DOCX ---------- */
export async function parseDOCX(buf, fallbackTitle) {
  const zip = await window.JSZip.loadAsync(buf);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('DOCX: не найден word/document.xml');

  let title = fallbackTitle;
  let author = '';
  const coreFile = zip.file('word/core.xml') || zip.file('docProps/core.xml');
  if (coreFile) {
    try {
      const coreXml = await coreFile.async('string');
      const tm = coreXml.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
      const am = coreXml.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i);
      if (tm && tm[1].trim()) title = htmlToText(tm[1]).trim();
      if (am && am[1].trim()) author = htmlToText(am[1]).trim();
    } catch { /* ignore */ }
  }

  const notes = {};
  const fnFile = zip.file('word/footnotes.xml');
  if (fnFile) {
    try {
      const fnXml = await fnFile.async('string');
      const fnDoc = new DOMParser().parseFromString(fnXml, 'application/xml');
      [...fnDoc.getElementsByTagNameNS('*', 'footnote')].forEach((fn) => {
        const id = fn.getAttribute('w:id') || fn.getAttribute('id');
        if (id && id !== '0' && id !== '-1') {
          const txt = [...fn.getElementsByTagNameNS('*', 't')].map((t) => t.textContent).join(' ').trim();
          if (txt) notes[id] = '<p>' + escHTML(txt) + '</p>';
        }
      });
    } catch { /* ignore */ }
  }

  const xmlStr = await docFile.async('string');
  const doc = new DOMParser().parseFromString(xmlStr, 'application/xml');
  const body = doc.getElementsByTagNameNS('*', 'body')[0] || doc.documentElement;
  const chapters = [];
  let cur = { title: title || 'Начало', parts: [] };

  const renderRun = (r) => {
    const texts = [...r.getElementsByTagNameNS('*', 't')].map((t) => escHTML(t.textContent || '')).join('');
    const fnRef = r.getElementsByTagNameNS('*', 'footnoteReference')[0];
    let fnHtml = '';
    if (fnRef) {
      const fnId = fnRef.getAttribute('w:id') || fnRef.getAttribute('id');
      if (fnId && notes[fnId]) fnHtml = `<sup class="note-ref" data-note="${escHTML(fnId)}">[${escHTML(fnId)}]</sup>`;
    }
    if (!texts && !fnHtml) return '';
    const rPr = r.getElementsByTagNameNS('*', 'rPr')[0];
    let out = texts + fnHtml;
    if (rPr) {
      if (rPr.getElementsByTagNameNS('*', 'b').length) out = '<strong>' + out + '</strong>';
      if (rPr.getElementsByTagNameNS('*', 'i').length) out = '<em>' + out + '</em>';
    }
    return out;
  };

  const renderPara = (p) => {
    const pPr = p.getElementsByTagNameNS('*', 'pPr')[0];
    let styleVal = '';
    if (pPr) {
      const pStyle = pPr.getElementsByTagNameNS('*', 'pStyle')[0];
      if (pStyle) styleVal = pStyle.getAttribute('w:val') || pStyle.getAttribute('val') || '';
    }
    const inner = [...p.children]
      .filter((c) => c.localName === 'r' || c.localName === 'hyperlink')
      .map((c) => (c.localName === 'hyperlink' ? [...c.getElementsByTagNameNS('*', 'r')].map(renderRun).join('') : renderRun(c)))
      .join('')
      .trim();
    if (!inner) return null;
    const isHeading = /^(Heading\s*[123]|Заголовок\s*[123]|Title|Subtitle|[123])$/i.test(styleVal);
    return { isHeading, text: htmlToText(inner), html: isHeading ? '<h3>' + inner + '</h3>' : '<p>' + inner + '</p>' };
  };

  for (const node of [...body.children]) {
    if (node.localName === 'p') {
      const res = renderPara(node);
      if (!res) continue;
      if (res.isHeading && res.text.length < 110 && cur.parts.length > 2) {
        chapters.push({ title: cur.title, html: cur.parts.join('') });
        cur = { title: res.text, parts: [] };
      } else {
        cur.parts.push(res.html);
      }
    } else if (node.localName === 'tbl') {
      const rows = [...node.getElementsByTagNameNS('*', 'tr')].map((tr) => {
        const cells = [...tr.getElementsByTagNameNS('*', 'tc')]
          .map((tc) => '<td>' + [...tc.getElementsByTagNameNS('*', 't')].map((t) => escHTML(t.textContent || '')).join(' ') + '</td>')
          .join('');
        return '<tr>' + cells + '</tr>';
      }).join('');
      if (rows) cur.parts.push('<table class="fb-table">' + rows + '</table>');
    }
  }
  if (cur.parts.length) chapters.push({ title: cur.title, html: cur.parts.join('') });
  if (!chapters.length) throw new Error('DOCX: текст не найден');
  return { title, author, chapters: chunkOversizedChapters(chapters), notes, format: 'docx' };
}

/* ---------- ODT ---------- */
export async function parseODT(buf, fallbackTitle) {
  const zip = await window.JSZip.loadAsync(buf);
  const contentFile = zip.file('content.xml');
  if (!contentFile) throw new Error('ODT: не найден content.xml');
  const xmlStr = await contentFile.async('string');
  const doc = new DOMParser().parseFromString(xmlStr, 'application/xml');
  const chapters = [];
  let cur = { title: fallbackTitle || 'Начало', parts: [] };
  const walk = (el) => {
    for (const ch of [...el.children]) {
      const ln = ch.localName;
      if (ln === 'h') {
        const t = (ch.textContent || '').trim();
        if (t) {
          if (cur.parts.length > 2) {
            chapters.push({ title: cur.title, html: cur.parts.join('') });
            cur = { title: t, parts: [] };
          } else {
            cur.parts.push('<h3>' + escHTML(t) + '</h3>');
          }
        }
      } else if (ln === 'p') {
        const t = (ch.textContent || '').trim();
        if (t) cur.parts.push('<p>' + escHTML(t) + '</p>');
      } else if (ln === 'list') {
        const items = [...ch.getElementsByTagNameNS('*', 'list-item')].map((li) => '<li>' + escHTML((li.textContent || '').trim()) + '</li>').join('');
        if (items) cur.parts.push('<ul>' + items + '</ul>');
      } else {
        walk(ch);
      }
    }
  };
  walk(doc.documentElement);
  if (cur.parts.length) chapters.push({ title: cur.title, html: cur.parts.join('') });
  if (!chapters.length) throw new Error('ODT: текст не найден');
  return { title: fallbackTitle, author: '', chapters: chunkOversizedChapters(chapters), format: 'odt' };
}

/* ---------- PDF (100% offline local bundle + memory cleanup) ---------- */
let pdfJsPromise = null;
export function ensurePdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (pdfJsPromise) return pdfJsPromise;
  pdfJsPromise = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = '/vendor/pdf.min.js';
    s.onload = () => {
      if (!window.pdfjsLib) {
        pdfJsPromise = null;
        return rej(new Error('PDF.js не инициализирован'));
      }
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js';
      res(window.pdfjsLib);
    };
    s.onerror = () => {
      pdfJsPromise = null;
      rej(new Error('Не удалось загрузить локальный модуль PDF.js'));
    };
    document.head.appendChild(s);
  });
  return pdfJsPromise;
}

export async function parsePDF(buf, fallbackTitle) {
  const pdfjsLib = await ensurePdfJs();
  const loadingTask = pdfjsLib.getDocument({ data: buf.slice(0) });
  const pdf = await loadingTask.promise;
  let title = fallbackTitle;
  let author = '';
  let cover = null;

  try {
    try {
      const meta = await pdf.getMetadata();
      if (meta && meta.info) {
        if (meta.info.Title && meta.info.Title.trim()) title = meta.info.Title.trim();
        if (meta.info.Author && meta.info.Author.trim()) author = meta.info.Author.trim();
      }
    } catch { /* ignore */ }

    try {
      const page1 = await pdf.getPage(1);
      const vp = page1.getViewport({ scale: 0.8 });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width;
      canvas.height = vp.height;
      await page1.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      cover = canvas.toDataURL('image/jpeg', 0.82);
      canvas.width = 0;
      canvas.height = 0;
      page1.cleanup();
    } catch { /* ignore cover render */ }

    const PAGES_PER_CHAPTER = 10;
    const chapters = [];
    let curPages = [];
    let startPage = 1;

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      try {
        const tc = await page.getTextContent();
        let lastY = null;
        const lines = [];
        let line = '';
        for (const item of tc.items) {
          const y = item.transform ? Math.round(item.transform[5]) : null;
          if (lastY !== null && y !== null && Math.abs(y - lastY) > 8) {
            if (line.trim()) lines.push(line.trim());
            line = item.str;
          } else {
            line += (line && !line.endsWith(' ') && !item.str.startsWith(' ') ? ' ' : '') + item.str;
          }
          if (y !== null) lastY = y;
        }
        if (line.trim()) lines.push(line.trim());
        const pageHtml = lines.length ? textLinesToHtml(lines) : '';
        if (pageHtml) curPages.push(pageHtml);
      } finally {
        page.cleanup();
      }

      if (p % PAGES_PER_CHAPTER === 0 || p === pdf.numPages) {
        if (curPages.length) {
          chapters.push({
            title: pdf.numPages <= PAGES_PER_CHAPTER ? 'Текст' : `Страницы ${startPage}–${p}`,
            html: curPages.join('<hr>')
          });
        }
        curPages = [];
        startPage = p + 1;
      }

      if (p % 8 === 0) await new Promise((r) => setTimeout(r, 0));
    }

    if (!chapters.length) throw new Error('PDF не содержит текстового слоя (возможно, это скан)');
    return { title, author, cover, chapters: chunkOversizedChapters(chapters), format: 'pdf' };
  } finally {
    try { await pdf.destroy(); } catch { /* ignore */ }
  }
}

/* ---------- CBZ (Stores images as binary Blobs in IndexedDB assets store) ---------- */
export async function parseCBZ(buf, fallbackTitle, bookId) {
  const zip = await window.JSZip.loadAsync(buf);
  const imgFiles = Object.values(zip.files)
    .filter((f) => !f.dir && /\.(jpe?g|png|webp|gif)$/i.test(f.name) && !f.name.includes('__MACOSX'))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!imgFiles.length) throw new Error('CBZ: изображения не найдены');

  let cover = null;
  const PAGES_PER_CH = 15;
  const chapters = [];
  const assets = [];

  for (let i = 0; i < imgFiles.length; i += PAGES_PER_CH) {
    const slice = imgFiles.slice(i, i + PAGES_PER_CH);
    const htmlParts = [];
    for (let j = 0; j < slice.length; j++) {
      const f = slice[j];
      const ext = f.name.split('.').pop().toLowerCase();
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
      const u8 = await f.async('uint8array');
      const blob = new Blob([u8], { type: mime });
      const assetKey = `asset_${bookId}_${i + j}`;
      assets.push([assetKey, blob]);

      if (!cover) {
        cover = await new Promise((res) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.onerror = () => res(null);
          fr.readAsDataURL(blob);
        });
      }
      htmlParts.push(`<div class="cbz-page"><img data-asset="${escHTML(assetKey)}" loading="lazy" alt="Страница ${i + j + 1}"></div>`);
    }
    chapters.push({
      title: imgFiles.length <= PAGES_PER_CH ? 'Выпуск' : `Страницы ${i + 1}–${Math.min(i + PAGES_PER_CH, imgFiles.length)}`,
      html: htmlParts.join('')
    });
  }
  return { title: fallbackTitle, author: '', cover, chapters, assets, format: 'cbz' };
}

/* ---------- EPUB ---------- */
function resolveEpubPath(baseDir, relHref) {
  if (!relHref) return '';
  let clean = relHref.split('#')[0];
  try { clean = decodeURIComponent(clean); } catch { /* ignore */ }
  clean = clean.replace(/^\.\//, '');
  if (!baseDir) return clean;
  const stack = baseDir.split('/').filter(Boolean);
  for (const part of clean.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

export async function epubMetaFromZip(buf) {
  if (typeof window.JSZip === 'undefined') return null;
  const zip = await window.JSZip.loadAsync(buf);
  let opfPath = null;
  const cf = zip.file('META-INF/container.xml');
  if (cf) {
    const c = await cf.async('string');
    const m = c.match(/full-path\s*=\s*"([^"]+)"/i);
    if (m) opfPath = m[1];
  }
  let opfFile = opfPath ? zip.file(opfPath) : null;
  if (!opfFile) {
    const cand = Object.keys(zip.files).find((n) => /\.opf$/i.test(n));
    if (cand) {
      opfFile = zip.file(cand);
      opfPath = cand;
    }
  }
  if (!opfFile) return null;
  const opf = await opfFile.async('string');
  const pick = (re) => {
    const m = opf.match(re);
    return m ? m[1].replace(/<[^>]+>/g, '').trim() : '';
  };
  const title = pick(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
  const author = pick(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i);
  let cover = null;
  try {
    let href = null;
    const im = opf.match(/<item[^>]*properties\s*=\s*["'][^"']*cover-image[^"']*["'][^>]*>/i);
    if (im) href = (im[0].match(/href\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!href) {
      const cm = opf.match(/<meta[^>]*name\s*=\s*["']cover["'][^>]*content\s*=\s*["']([^"']+)["']/i) ||
        opf.match(/<meta[^>]*content\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']cover["']/i);
      if (cm) {
        const itemRe = new RegExp('<item[^>]*id\\s*=\\s*["\']' + escRe(cm[1]) + '["\'][^>]*>', 'i');
        const im2 = opf.match(itemRe);
        if (im2) href = (im2[0].match(/href\s*=\s*["']([^"']+)["']/i) || [])[1];
      }
    }
    if (href) {
      const base = (opfPath || '').split('/').slice(0, -1).join('/');
      const clean = href.replace(/^\.\//, '');
      const full = base ? base + '/' + clean : clean;
      const fileName = clean.split('/').pop();
      const cf2 = zip.file(decodeURIComponent(full)) || zip.file(full) ||
        zip.file(Object.keys(zip.files).find((n) => n.endsWith('/' + fileName) || n === fileName) || '');
      if (cf2) {
        const b64 = await cf2.async('base64');
        const ext = (fileName.split('.').pop() || '').toLowerCase();
        const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : 'image/jpeg';
        cover = 'data:' + mime + ';base64,' + b64;
      }
    }
  } catch { /* ignore */ }
  return { title, author, cover };
}

export async function readEpubMeta(buf) {
  const fb = await epubMetaFromZip(buf).catch(() => null);
  if (fb && (fb.title || fb.cover)) return fb;
  if (typeof window.ePub !== 'undefined') {
    let book = null;
    try {
      book = window.ePub(buf.slice(0));
      await book.ready;
      const md = (await book.loaded.metadata) || {};
      return { title: (md.title || '').trim(), author: (md.creator || '').trim(), cover: fb ? fb.cover : null };
    } catch { /* ignore */ } finally {
      try { if (book) book.destroy(); } catch { /* ignore */ }
    }
  }
  if (!fb) throw new Error('EPUB повреждён');
  return fb;
}

export async function parseEPUBFull(buf, fallbackTitle, bookId = '') {
  const zip = await window.JSZip.loadAsync(buf);
  const findZipFile = (path) => {
    if (!path) return null;
    const norm = path.replace(/^\/+/, '');
    let dec = norm;
    try { dec = decodeURIComponent(norm); } catch { /* ignore */ }
    return zip.file(norm) || zip.file(dec) ||
      zip.file(Object.keys(zip.files).find((k) => k.toLowerCase() === norm.toLowerCase() || k.toLowerCase().endsWith('/' + norm.split('/').pop().toLowerCase())) || '');
  };

  let opfPath = '';
  const containerFile = zip.file('META-INF/container.xml');
  if (containerFile) {
    const cXml = await containerFile.async('string');
    const m = cXml.match(/full-path\s*=\s*["']([^"']+)["']/i);
    if (m) opfPath = m[1];
  }
  let opfFile = opfPath ? findZipFile(opfPath) : null;
  if (!opfFile) {
    const cand = Object.keys(zip.files).find((n) => /\.opf$/i.test(n));
    if (cand) {
      opfPath = cand;
      opfFile = zip.file(cand);
    }
  }
  if (!opfFile) throw new Error('EPUB: не найден OPF-файл');

  const opfBase = opfPath.split('/').slice(0, -1).join('/');
  const opfStr = await opfFile.async('string');
  const opfDoc = new DOMParser().parseFromString(opfStr, 'application/xml');

  const getTagText = (tag) => {
    const el = opfDoc.getElementsByTagNameNS('*', tag)[0];
    return el ? (el.textContent || '').trim() : '';
  };
  const title = getTagText('title') || fallbackTitle || 'Без названия';
  const author = getTagText('creator') || '';

  const manifest = {};
  let navHref = '';
  let ncxHref = '';
  let coverId = '';
  [...opfDoc.getElementsByTagNameNS('*', 'meta')].forEach((m) => {
    if ((m.getAttribute('name') || '').toLowerCase() === 'cover' && m.getAttribute('content')) {
      coverId = m.getAttribute('content');
    }
  });
  [...opfDoc.getElementsByTagNameNS('*', 'item')].forEach((it) => {
    const id = it.getAttribute('id') || '';
    const href = it.getAttribute('href') || '';
    const media = it.getAttribute('media-type') || '';
    const props = it.getAttribute('properties') || '';
    if (id) manifest[id] = { href, media, props };
    if (/\bnav\b/i.test(props)) navHref = href;
    if (media === 'application/x-dtbncx+xml' || /\.ncx$/i.test(href)) ncxHref = href;
    if (/\bcover-image\b/i.test(props) && !coverId) coverId = id;
  });

  const assets = [];
  const assetMap = new Map();
  let assetCounter = 0;

  const getAssetInfo = async (fullPath, wantDataUrl = false) => {
    if (!fullPath) return null;
    if (assetMap.has(fullPath)) return assetMap.get(fullPath);
    const f = findZipFile(fullPath);
    if (!f) return null;
    try {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : ext === 'svg' ? 'image/svg+xml' : 'image/jpeg';
      const u8 = await f.async('uint8array');
      const blob = new Blob([u8], { type: mime });
      const assetKey = bookId ? `asset_${bookId}_${assetCounter++}` : '';
      if (assetKey) assets.push([assetKey, blob]);
      let dataUrl = null;
      if (wantDataUrl || !assetKey) {
        dataUrl = await new Promise((res) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.onerror = () => res(null);
          fr.readAsDataURL(blob);
        });
      }
      const info = { assetKey, dataUrl };
      assetMap.set(fullPath, info);
      return info;
    } catch {
      return null;
    }
  };

  let cover = null;
  if (coverId && manifest[coverId]) {
    const cInfo = await getAssetInfo(resolveEpubPath(opfBase, manifest[coverId].href), true);
    if (cInfo) cover = cInfo.dataUrl;
  }

  const tocMap = new Map();
  if (navHref) {
    const navFile = findZipFile(resolveEpubPath(opfBase, navHref));
    if (navFile) {
      try {
        const navDir = resolveEpubPath(opfBase, navHref).split('/').slice(0, -1).join('/');
        const navDoc = new DOMParser().parseFromString(await navFile.async('string'), 'text/html');
        navDoc.querySelectorAll('nav a[href], a[href]').forEach((a) => {
          const lbl = (a.textContent || '').replace(/\s+/g, ' ').trim();
          const h = resolveEpubPath(navDir, a.getAttribute('href') || '');
          if (lbl && h && !tocMap.has(h)) tocMap.set(h, lbl);
        });
      } catch { /* ignore */ }
    }
  }
  if (!tocMap.size && ncxHref) {
    const ncxFile = findZipFile(resolveEpubPath(opfBase, ncxHref));
    if (ncxFile) {
      try {
        const ncxDir = resolveEpubPath(opfBase, ncxHref).split('/').slice(0, -1).join('/');
        const ncxDoc = new DOMParser().parseFromString(await ncxFile.async('string'), 'application/xml');
        [...ncxDoc.getElementsByTagNameNS('*', 'navPoint')].forEach((np) => {
          const tEl = np.getElementsByTagNameNS('*', 'text')[0];
          const cEl = np.getElementsByTagNameNS('*', 'content')[0];
          const lbl = tEl ? (tEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
          const src = cEl ? cEl.getAttribute('src') || '' : '';
          const h = resolveEpubPath(ncxDir, src);
          if (lbl && h && !tocMap.has(h)) tocMap.set(h, lbl);
        });
      } catch { /* ignore */ }
    }
  }

  const spineRefs = [...opfDoc.getElementsByTagNameNS('*', 'itemref')]
    .map((ir) => ir.getAttribute('idref'))
    .filter((id) => id && manifest[id]);

  const chapters = [];
  const notes = {};

  for (let i = 0; i < spineRefs.length; i++) {
    const item = manifest[spineRefs[i]];
    if (!/html|xml/i.test(item.media) && !/\.(x?html|htm|xml)$/i.test(item.href)) continue;
    const itemPath = resolveEpubPath(opfBase, item.href);
    const itemDir = itemPath.split('/').slice(0, -1).join('/');
    const f = findZipFile(itemPath);
    if (!f) continue;

    const rawHtml = decodeBuffer(await f.async('uint8array'));
    const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
    const body = doc.body || doc.documentElement;
    if (!body) continue;

    const imgs = [...body.querySelectorAll('img, image')];
    for (const im of imgs) {
      const rawSrc = im.getAttribute('src') || im.getAttribute('xlink:href') || im.getAttribute('href') || '';
      if (rawSrc && !rawSrc.startsWith('data:')) {
        const resolved = resolveEpubPath(itemDir, rawSrc);
        const info = await getAssetInfo(resolved, !cover);
        if (info) {
          if (!cover && info.dataUrl) cover = info.dataUrl;
          if (im.tagName.toLowerCase() === 'image') {
            const newImg = doc.createElement('img');
            if (info.assetKey) newImg.setAttribute('data-asset', info.assetKey);
            else if (info.dataUrl) newImg.setAttribute('src', info.dataUrl);
            im.replaceWith(newImg);
          } else {
            if (info.assetKey) {
              im.removeAttribute('src');
              im.setAttribute('data-asset', info.assetKey);
            } else if (info.dataUrl) {
              im.setAttribute('src', info.dataUrl);
            }
          }
        } else {
          im.remove();
        }
      }
    }

    body.querySelectorAll('aside, .footnote, .endnote').forEach((fn) => {
      const fnId = fn.getAttribute('id');
      if (fnId) {
        notes[fnId] = sanitizeHtml(fn.innerHTML);
        fn.remove();
      }
    });
    body.querySelectorAll('[id]').forEach((el) => {
      const et = el.getAttribute('epub:type') || '';
      if (/footnote|endnote|rearnote/i.test(et)) {
        const fnId = el.getAttribute('id');
        if (fnId) {
          notes[fnId] = sanitizeHtml(el.innerHTML);
          el.remove();
        }
      }
    });
    body.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      const hashIdx = href.indexOf('#');
      if (hashIdx >= 0) {
        const fragId = href.slice(hashIdx + 1);
        const targetEl = fragId ? doc.getElementById(fragId) : null;
        if (targetEl && !notes[fragId] && (targetEl.textContent || '').trim().length < 600) {
          notes[fragId] = sanitizeHtml(targetEl.innerHTML || targetEl.textContent);
        }
        if (fragId && (/note|fn|cite|ref/i.test(fragId) || (a.textContent || '').trim().length <= 6)) {
          const sup = doc.createElement('sup');
          sup.className = 'note-ref';
          sup.setAttribute('data-note', fragId);
          sup.textContent = '[' + ((a.textContent || '').trim().replace(/^\[|\]$/g, '') || '*') + ']';
          a.replaceWith(sup);
        }
      }
    });

    const clean = sanitizeHtml(body.innerHTML);
    const plain = htmlToText(clean);
    if (plain.length < 5 && !clean.includes('<img')) continue;

    let chTitle = tocMap.get(itemPath) || '';
    if (!chTitle) {
      const hEl = body.querySelector('h1, h2, h3');
      if (hEl) {
        const ht = (hEl.textContent || '').replace(/\s+/g, ' ').trim();
        if (ht && ht.length < 110) chTitle = ht;
      }
    }
    if (!chTitle) chTitle = 'Глава ' + (chapters.length + 1);
    chapters.push({ title: chTitle, html: clean });
  }

  if (!chapters.length) throw new Error('EPUB: не удалось извлечь главы');
  return { title, author, cover, chapters: chunkOversizedChapters(chapters), notes, assets, format: 'epub' };
}
