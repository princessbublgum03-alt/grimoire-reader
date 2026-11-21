import { escHTML } from './text-utils.js';

export const BIONIC_RATIOS = {
  light: 0.35,
  medium: 0.45,
  strong: 0.55
};

/**
 * Computes how many leading letters of a word should be bolded for Bionic Reading.
 * Targets ~40–50% of word length in default 'medium' mode while never bolding
 * the entire word for words of length >= 2.
 */
export function getBionicSplitIndex(word, strength = 'medium') {
  const len = String(word || '').length;
  if (len <= 0) return 0;
  if (len === 1) return 1;
  const ratio = BIONIC_RATIOS[strength] ?? BIONIC_RATIOS.medium;
  if (len <= 3) {
    if (strength === 'light') return 1;
    if (strength === 'strong') return Math.min(len - 1, 2);
    return len === 2 ? 1 : 2;
  }
  return Math.max(1, Math.min(len - 1, Math.ceil(len * ratio)));
}

/**
 * Transforms a plain text string into HTML with Bionic Reading bold fixation spans,
 * preserving Cyrillic/Latin letters, punctuation, whitespace, numbers, and escaping HTML.
 */
export function bionicizeText(text, strength = 'medium') {
  const raw = String(text ?? '');
  if (!raw) return '';
  const parts = raw.split(/([\p{L}]+)/u);
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    if (!seg) continue;
    if (i % 2 === 1) {
      const split = getBionicSplitIndex(seg, strength);
      const head = escHTML(seg.slice(0, split));
      const tail = escHTML(seg.slice(split));
      out += `<b class="bionic-fix">${head}</b>${tail}`;
    } else {
      out += escHTML(seg);
    }
  }
  return out;
}

/* ---------- BeeLine Color Gradient Palettes & Math ---------- */

const BEELINE_PALETTES = {
  // Light paper & soft themes: deep blue -> dark ink -> deep crimson
  parchment: { start: '#1b4f9c', mid: '#2c2621', end: '#8f2230' },
  soft: { start: '#194a96', mid: '#1f1f1f', end: '#8c1d2c' },
  // Dark themes: soft readable sky blue -> primary light ink -> warm coral/terracotta
  abyss: { start: '#82b4f5', mid: '#c8c8d0', end: '#e09679' },
  graphite: { start: '#86b7f7', mid: '#d0d2d6', end: '#e29a7d' },
  sepia: { start: '#8cb3d9', mid: '#d6c7b2', end: '#e08e6d' },
  forest: { start: '#82b8d4', mid: '#c2cfc7', end: '#d99a74' },
  void: { start: '#7aa2d4', mid: '#a8a8a8', end: '#c7856d' }
};

export function getBeeLinePalette(theme) {
  return BEELINE_PALETTES[theme] || BEELINE_PALETTES.abyss;
}

function parseHex(hex) {
  const h = String(hex || '#888888').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0
  ];
}

export function interpolateHexColor(hexA, hexB, t) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const [r1, g1, b1] = parseHex(hexA);
  const [r2, g2, b2] = parseHex(hexB);
  const r = Math.round(r1 + (r2 - r1) * clamped);
  const g = Math.round(g1 + (g2 - g1) * clamped);
  const b = Math.round(b1 + (b2 - b1) * clamped);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/**
 * True BeeLine line-continuity color function:
 * Even lines transition start -> mid -> end.
 * Odd lines transition end -> mid -> start.
 * Thus the end of line N shares the exact color of the start of line N+1.
 */
export function computeBeeLineColor(lineIndex, posRatio, palette) {
  const pal = palette || BEELINE_PALETTES.abyss;
  const t = Math.max(0, Math.min(1, Number.isFinite(posRatio) ? posRatio : 0));
  const isOdd = Math.abs(Math.floor(lineIndex)) % 2 === 1;
  const left = isOdd ? pal.end : pal.start;
  const right = isOdd ? pal.start : pal.end;
  if (t <= 0.5) {
    return interpolateHexColor(left, pal.mid, t * 2);
  }
  return interpolateHexColor(pal.mid, right, (t - 0.5) * 2);
}

/* ---------- Non-Destructive DOM Enhancement Engine ---------- */

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'CODE', 'PRE', 'SVG', 'TEXTAREA', 'INPUT', 'SELECT', 'BUTTON', 'NOSCRIPT'
]);

function shouldSkipNode(textNode) {
  if (!textNode || !textNode.nodeValue || !textNode.nodeValue.trim()) return true;
  let el = textNode.parentElement;
  while (el && el.id !== 'reader-inner') {
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.classList && (
      el.classList.contains('chapter-head') ||
      el.classList.contains('note-ref') ||
      el.classList.contains('rf-node') ||
      el.classList.contains('bionic-fix')
    )) {
      return true;
    }
    el = el.parentElement;
  }
  return false;
}

/**
 * Restores all text nodes previously wrapped by applyReadingEnhancements,
 * keeping images, blob URLs, footnotes, and semantic markup intact.
 */
export function stripReadingEnhancements(container) {
  if (!container) return;
  const wrapped = container.querySelectorAll('.rf-node');
  for (let i = 0; i < wrapped.length; i++) {
    const span = wrapped[i];
    const orig = typeof span.__origText === 'string' ? span.__origText : span.textContent;
    span.replaceWith(document.createTextNode(orig));
  }
  container.normalize();
}

/**
 * Applies Bionic Reading and/or BeeLine word-spans inside `container`.
 * Always starts from a clean restored DOM so toggling or combining modes never stacks tags.
 */
export function applyReadingEnhancements(container, {
  bionic = false,
  bionicStrength = 'medium',
  beeline = false,
  theme = 'abyss'
} = {}) {
  if (!container || typeof document === 'undefined') return;
  stripReadingEnhancements(container);
  if (!bionic && !beeline) return;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) {
    if (!shouldSkipNode(n)) nodes.push(n);
  }

  for (let i = 0; i < nodes.length; i++) {
    const textNode = nodes[i];
    const origText = textNode.nodeValue;
    const wrapper = document.createElement('span');
    wrapper.className = 'rf-node';
    wrapper.__origText = origText;

    if (beeline) {
      // Split into non-whitespace tokens and whitespace so each word can be measured per visual line
      const tokens = origText.split(/(\s+)/);
      let html = '';
      for (let j = 0; j < tokens.length; j++) {
        const tok = tokens[j];
        if (!tok) continue;
        if (/^\s+$/.test(tok)) {
          html += tok;
        } else {
          const inner = bionic ? bionicizeText(tok, bionicStrength) : escHTML(tok);
          html += `<span class="rf-w">${inner}</span>`;
        }
      }
      wrapper.innerHTML = html;
    } else {
      wrapper.innerHTML = bionicizeText(origText, bionicStrength);
    }

    textNode.replaceWith(wrapper);
  }

  if (beeline) {
    refreshBeeLineColors(container, theme);
  }
}

/**
 * Re-measures visual lines of `.rf-w` spans inside `container` and updates BeeLine colors
 * using batched reads followed by batched writes to avoid layout thrashing.
 */
export function refreshBeeLineColors(container, theme = 'abyss') {
  if (!container || typeof document === 'undefined') return;
  const palette = getBeeLinePalette(theme);
  const blocks = container.querySelectorAll('p, li, blockquote, .fb-v');
  const measurements = [];

  // Phase 1: Batched DOM reads
  for (let b = 0; b < blocks.length; b++) {
    const words = blocks[b].querySelectorAll('.rf-w');
    if (!words.length) continue;
    const items = [];
    for (let i = 0; i < words.length; i++) {
      const el = words[i];
      items.push({ el, top: el.offsetTop, left: el.offsetLeft });
    }
    measurements.push(items);
  }

  // Phase 2: Group into visual lines & batch style writes
  let globalLineIndex = 0;
  for (let b = 0; b < measurements.length; b++) {
    const items = measurements[b];
    const lines = [];
    let currentLine = [];
    let currentTop = null;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (currentTop === null || Math.abs(it.top - currentTop) <= 6) {
        currentLine.push(it);
        if (currentTop === null) currentTop = it.top;
      } else {
        lines.push(currentLine);
        currentLine = [it];
        currentTop = it.top;
      }
    }
    if (currentLine.length) lines.push(currentLine);

    for (let l = 0; l < lines.length; l++) {
      const lineWords = lines[l];
      const count = lineWords.length;
      for (let w = 0; w < count; w++) {
        const ratio = count <= 1 ? 0.5 : w / (count - 1);
        lineWords[w].el.style.color = computeBeeLineColor(globalLineIndex, ratio, palette);
      }
      globalLineIndex++;
    }
  }
}

/* ---------- Web Audio Procedural Ambient Noise (Zero External Files) ---------- */

export function generateWhiteNoiseSamples(length, rng = Math.random) {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = (rng() * 2 - 1) * 0.6;
  }
  return out;
}

/**
 * Paul Kellet's refined 7-stage pink noise (-3 dB/octave) approximation.
 */
export function generatePinkNoiseSamples(length, rng = Math.random) {
  const out = new Float32Array(length);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < length; i++) {
    const white = rng() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    const sample = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
    out[i] = Math.max(-1, Math.min(1, sample));
  }
  return out;
}

/**
 * Integrated brown/red noise (-6 dB/octave) — warm deep rumble ideal for ADHD focus.
 */
export function generateBrownNoiseSamples(length, rng = Math.random) {
  const out = new Float32Array(length);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = rng() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    out[i] = Math.max(-1, Math.min(1, last * 3.2));
  }
  return out;
}

export function createAmbientNoiseController() {
  let ctx = null;
  let source = null;
  let filter = null;
  let gain = null;
  let mode = 'off';
  let volume = 0.25;
  const bufferCache = new Map();

  function ensureContext() {
    if (ctx) return ctx;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
    filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3800;
    gain = ctx.createGain();
    gain.gain.value = 0;
    filter.connect(gain);
    gain.connect(ctx.destination);
    return ctx;
  }

  function getBuffer(noiseMode) {
    if (bufferCache.has(noiseMode)) return bufferCache.get(noiseMode);
    const ac = ensureContext();
    if (!ac) return null;
    const sampleRate = ac.sampleRate || 44100;
    const length = sampleRate * 4;
    const buf = ac.createBuffer(1, length, sampleRate);
    const ch = buf.getChannelData(0);
    let samples;
    if (noiseMode === 'white') samples = generateWhiteNoiseSamples(length);
    else if (noiseMode === 'brown') samples = generateBrownNoiseSamples(length);
    else samples = generatePinkNoiseSamples(length);

    // Apply short 20ms crossfade at buffer boundaries for completely seamless looping
    const fade = Math.min(Math.floor(sampleRate * 0.02), Math.floor(length / 8));
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      const tailIdx = length - fade + i;
      samples[i] = samples[i] * t + samples[tailIdx] * (1 - t);
    }
    ch.set(samples);
    bufferCache.set(noiseMode, buf);
    return buf;
  }

  function stopSource() {
    if (source) {
      try {
        source.stop();
        source.disconnect();
      } catch { /* ignore */ }
      source = null;
    }
  }

  function applyGain(targetVol) {
    if (!ctx || !gain) return;
    const now = ctx.currentTime;
    const scaled = Math.max(0, Math.min(1, targetVol)) * 0.35;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(scaled, now, 0.06);
  }

  function setMode(nextMode) {
    const valid = ['off', 'white', 'pink', 'brown'].includes(nextMode) ? nextMode : 'off';
    mode = valid;
    if (valid === 'off') {
      if (ctx && gain) {
        applyGain(0);
        setTimeout(() => {
          if (mode === 'off') stopSource();
        }, 180);
      } else {
        stopSource();
      }
      return true;
    }

    const ac = ensureContext();
    if (!ac) return false;
    if (ac.state === 'suspended') {
      ac.resume().catch(() => {});
    }

    stopSource();
    const buf = getBuffer(valid);
    if (!buf) return false;

    if (filter) {
      filter.frequency.value = valid === 'white' ? 3200 : valid === 'pink' ? 4200 : 1200;
    }

    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(filter);
    src.start(0);
    source = src;
    applyGain(volume);
    return true;
  }

  function setVolume(nextVol) {
    volume = Math.max(0, Math.min(1, Number.isFinite(nextVol) ? nextVol : 0.25));
    if (mode !== 'off') applyGain(volume);
  }

  function stop() {
    setMode('off');
  }

  function getState() {
    return { mode, volume };
  }

  return { setMode, setVolume, stop, getState };
}

/* ---------- Демо-текст для мгновенной проверки режимов концентрации ---------- */

export const DEMO_ARTICLE = {
  title: 'Нейробиология глубокого чтения',
  author: 'GRIMOIRE · Демо-очерк',
  text: [
    'Человеческий мозг не создавался эволюцией для чтения. В отличие от устной речи, для которой существуют специализированные врождённые нейронные контуры, письмо появилось всего около пяти с половиной тысяч лет назад — слишком недавно, чтобы геном успел перестроиться. Каждый раз, когда мы учимся читать, кора больших полушарий перепрофилирует участки зрительной системы, изначально отвечавшие за распознавание контуров предметов и лиц. Эта удивительная способность к перестройке называется нейропластичностью.',
    'При обычном чтении глаза не скользят плавно по строчке, как кажется субъективно. Вместо этого взгляд совершает серию стремительных скачков — саккад — и коротких остановок, называемых фиксациями. Во время каждой фиксации, длящейся около двухсот миллисекунд, мозг считывает опорный фрагмент слова и мгновенно достраивает его окончание из контекста и долговременной памяти. Именно на этом механизме основано бионическое чтение: выделение первых сорока–пятидесяти процентов букв создаёт для глаз чёткие визуальные якоря и снижает количество лишних возвратов взгляда.',
    'Людям с СДВГ и всем, кто устал от бесконечного потока уведомлений, труднее всего удерживать рабочую память на длинном тексте: периферическое зрение постоянно цепляется за соседние абзацы, а при переходе с конца одной строки к началу следующей взгляд нередко перескакивает через строчку или возвращается назад. Режим фокуса на абзаце приглушает визуальный шум вокруг текущей мысли, линейка чтения задаёт спокойный горизонтальный ориентир, а мягкий цветовой градиент BeeLine связывает конец каждой строки с началом следующей единым оттенком.',
    'Не менее важна микротипографика и оптика экрана. Чисто белый фон на современном дисплее работает как миниатюрный прожектор, заставляя зрачок сужаться и ускоряя утомление глазных мышц. Тёплый оттенок бумаги, мягкий светлый или глубокий графитовый фон снижают контрастный стресс. Шрифты вроде Lexend и Atkinson Hyperlegible спроектированы специально для различимости похожих знаков, Literata поддерживает естественный ритм книжной строки, а JetBrains Mono выравнивает ритм фиксаций за счёт одинаковой ширины каждого символа.',
    'Наконец, акустическая среда напрямую влияет на уровень дофамина и устойчивость внимания. Абсолютная тишина иногда усиливает внутренний диалог, а резкие внешние звуки мгновенно срывают концентрацию. Ровный розовый или глубокий коричневый шум создаёт мягкую звуковую маскировку, выравнивая порог отвлекаемости. Попробуйте переключить режимы концентрации на верхней панели и подобрать сочетание шрифта, ширины колонки и шума, при котором текст буквально начинает течь сам собой.'
  ].join('\n\n')
};
