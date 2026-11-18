import { escRe, htmlToText } from './text-utils.js';

const STOP_RU = new Set(
  'и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него до вас нибудь опять уж вам ведь там потом себя ничего ей может они тут где есть надо ней для мы тебя их чем была сам чтоб без будто чего раз тоже себе под будет ж тогда кто этот того потому этого какой совсем ним здесь этом один почти мой тем чтобы нее сейчас были куда зачем всех никогда можно при наконец два об другой хоть после над больше тот через эти нас про всего них какая много разве три эту моя впрочем хорошо свою этой перед иногда лучше чуть том нельзя такой им более всегда конечно всю между эта эти это того также который которые которая которое которых которым свой своя свои своего своей своих весь вся всё всех всего всей своего'.split(/\s+/)
);

const STOP_EN = new Set(
  'the a an and or but if then than that this these those of in on at to for from by with without into over under about as is are was were be been being have has had do does did not no nor so such very more most much many some any all each both few other another its it he she they them his her their our your my me you we us i him hers theirs ours yours mine what which who whom whose when where why how there here can could would should may might must shall will just also only even still yet because while during before after above below between through up down out off again once'.split(/\s+/)
);

export function stem(w) {
  if (/[а-яё]/i.test(w)) {
    return w.replace(/(иями|ями|ами|ов|ев|ый|ий|ая|ое|ые|ыми|ими|ать|ять|ить|ется|ются|лся|лась|ние|ния|нию|ний|ость|ости|ой|ей|ам|ям|ах|ях|ом|ем|ы|и|а|о|е|у|ю|я|ь)$/i, '');
  }
  return w.replace(/(ingly|edly|ation|ness|ments|ment|ing|ies|ed|es|s)$/i, '');
}

export function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-zа-яё0-9-\s]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_RU.has(w) && !STOP_EN.has(w))
    .map(stem);
}

export function splitSentences(text) {
  return (String(text).replace(/\s+/g, ' ').trim().match(/[^.!?…]+[.!?…]+[»"”)]?/g) || [])
    .map((s) => s.trim())
    .filter(Boolean);
}

export function summarize(text, n = 4) {
  const sents = splitSentences(text).filter((s) => s.split(/\s+/).length > 5);
  if (sents.length <= n) return sents;

  const sTokens = sents.map(tokenize);
  const tf = new Map();
  sTokens.forEach((ts) => ts.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1)));

  let maxTf = 1;
  tf.forEach((v) => {
    if (v > maxTf) maxTf = v;
  });

  const scored = sTokens.map((ts, i) => {
    if (!ts.length) return { i, score: 0, s: sents[i], set: new Set() };
    const uniq = new Set(ts);
    let sc = 0;
    uniq.forEach((t) => {
      sc += (tf.get(t) || 0) / maxTf;
    });
    sc = (sc / Math.sqrt(ts.length)) * (1 + 0.75 * Math.exp(-i / 6));
    if (ts.length > 55) sc *= 0.88;
    if (sents[i].length > 420) sc *= 0.8;
    return { i, score: sc, s: sents[i], set: uniq };
  });

  scored.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const cand of scored) {
    if (picked.length >= n) break;
    const tooSimilar = picked.some((p) => {
      let inter = 0;
      cand.set.forEach((t) => {
        if (p.set.has(t)) inter++;
      });
      const union = cand.set.size + p.set.size - inter;
      return union > 0 && inter / union > 0.55;
    });
    if (!tooSimilar) picked.push(cand);
  }
  if (!picked.length && scored.length) picked.push(scored[0]);
  return picked.sort((a, b) => a.i - b.i).map((p) => p.s);
}

export function findTermContext(fullText, termRaw) {
  const term = String(termRaw).replace(/\s+/g, ' ').replace(/[«»"']/g, '').trim().slice(0, 100);
  if (!term) return { term: '', stemL: '', defs: [], mentions: [] };
  const sentences = fullText.match(/[^.!?…]+[.!?…]+[»"”)]?/g) || [];
  const lowerTerm = term.toLowerCase();
  const stemL = lowerTerm.slice(0, Math.max(3, Math.min(6, lowerTerm.length)));
  const defs = [];
  const mentions = [];

  for (const raw of sentences) {
    const s = raw.trim();
    if (s.length > 25 && s.length < 460 && s.toLowerCase().includes(stemL)) {
      if (/(?:—|–|-|:)\s*это(?=\s|$|[.,;])/i.test(s) || /означа(?:ет|ют)|называ(?:ется|ют)|представля(?:ет|ют)|\bis (?:a|an|the)\b|\bmeans\b/i.test(s)) {
        if (defs.length < 4) defs.push(s);
      } else if (mentions.length < 4) {
        mentions.push(s);
      }
      if (defs.length >= 4 && mentions.length >= 4) break;
    }
  }
  return { term, stemL, defs, mentions };
}

export async function searchChaptersAsync(chapters, query, { limit = 100, signal = null } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q || !Array.isArray(chapters)) return [];
  const results = [];

  for (let i = 0; i < chapters.length; i++) {
    if (signal && signal.aborted) return results;
    const text = htmlToText(chapters[i].html || '');
    if (text.toLowerCase().includes(q)) {
      const sentences = text.match(/[^.!?…]+[.!?…]+[»"”)]?/g) || [text];
      for (const s of sentences) {
        if (s.toLowerCase().includes(q)) {
          results.push({ chapter: chapters[i].title || `Глава ${i + 1}`, index: i, text: s.trim() });
          if (results.length >= limit) return results;
        }
      }
    }
    if (i % 6 === 5) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return results;
}

export function highlightQueryHTML(escapedText, query) {
  if (!query) return escapedText;
  const re = new RegExp('(' + escRe(query) + ')', 'gi');
  return escapedText.replace(re, '<mark class="search-hit">$1</mark>');
}
