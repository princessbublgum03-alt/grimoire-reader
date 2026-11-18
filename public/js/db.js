export const DB = (() => {
  let dbPromise = null;

  const open = () => dbPromise || (dbPromise = new Promise((res, rej) => {
    let req;
    try {
      req = indexedDB.open('grimoire', 3);
    } catch (e) {
      return rej(e);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      const autoIncStores = new Set(['glossary', 'notes', 'bookmarks']);
      ['books', 'progress', 'glossary', 'notes', 'bookmarks', 'kv'].forEach((n) => {
        if (!db.objectStoreNames.contains(n)) {
          db.createObjectStore(n, {
            keyPath: n === 'kv' ? undefined : 'id',
            autoIncrement: autoIncStores.has(n)
          });
        }
      });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets');
      if (!db.objectStoreNames.contains('chapters')) db.createObjectStore('chapters');
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => {
      dbPromise = null;
      rej(req.error || new Error('IndexedDB open failed'));
    };
  }));

  const run = (storeName, mode, fn) => open().then((db) => new Promise((res, rej) => {
    const tx = db.transaction(storeName, mode);
    const os = tx.objectStore(storeName);
    let r;
    try {
      r = fn(os);
    } catch (e) {
      return rej(e);
    }
    tx.oncomplete = () => res(r ? r.result : undefined);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  }));

  const putBatch = (storeName, entries) => open().then((db) => new Promise((res, rej) => {
    if (!entries.length) return res();
    const tx = db.transaction(storeName, 'readwrite');
    const os = tx.objectStore(storeName);
    for (const [val, key] of entries) {
      if (key === undefined) os.put(val);
      else os.put(val, key);
    }
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  }));

  const deleteByKeys = (storeName, keys) => open().then((db) => new Promise((res, rej) => {
    if (!keys.length) return res();
    const tx = db.transaction(storeName, 'readwrite');
    const os = tx.objectStore(storeName);
    for (const k of keys) os.delete(k);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  }));

  const getAllKeys = (storeName) => run(storeName, 'readonly', (o) => o.getAllKeys());

  return {
    get: (s, k) => run(s, 'readonly', (o) => o.get(k)),
    getAll: (s) => run(s, 'readonly', (o) => o.getAll()),
    getAllKeys,
    put: (s, v, k) => run(s, 'readwrite', (o) => (k === undefined ? o.put(v) : o.put(v, k))),
    putBatch,
    del: (s, k) => run(s, 'readwrite', (o) => o.delete(k)),
    deleteByKeys,
    clear: (s) => run(s, 'readwrite', (o) => o.clear())
  };
})();

export async function saveBookContent(bookId, { chapters = [], notes = {}, assets = [] }) {
  if (assets && assets.length) {
    await DB.putBatch('assets', assets.map(([key, blob]) => [blob, key]));
  }
  await DB.put('chapters', { chapters, notes }, bookId);
}

export async function loadBookContent(bookId) {
  const modern = await DB.get('chapters', bookId).catch(() => null);
  if (modern && Array.isArray(modern.chapters) && modern.chapters.length) {
    return modern;
  }
  const legacy = await DB.get('files', 'content_' + bookId).catch(() => null);
  if (legacy && Array.isArray(legacy.chapters) && legacy.chapters.length) {
    return legacy;
  }
  return null;
}

export async function purgeBookData(bookId) {
  await Promise.all([
    DB.del('books', bookId).catch(() => {}),
    DB.del('files', bookId).catch(() => {}),
    DB.del('files', 'content_' + bookId).catch(() => {}),
    DB.del('chapters', bookId).catch(() => {}),
    DB.del('progress', bookId).catch(() => {})
  ]);

  const [assetKeys, gloss, notes, bookmarks] = await Promise.all([
    DB.getAllKeys('assets').catch(() => []),
    DB.getAll('glossary').catch(() => []),
    DB.getAll('notes').catch(() => []),
    DB.getAll('bookmarks').catch(() => [])
  ]);

  const prefix = `asset_${bookId}_`;
  const matchingAssets = (assetKeys || []).filter((k) => typeof k === 'string' && k.startsWith(prefix));
  const glossIds = (gloss || []).filter((g) => g.bookId === bookId).map((g) => g.id);
  const noteIds = (notes || []).filter((n) => n.bookId === bookId).map((n) => n.id);
  const bmIds = (bookmarks || []).filter((b) => b.bookId === bookId).map((b) => b.id);

  await Promise.all([
    DB.deleteByKeys('assets', matchingAssets).catch(() => {}),
    DB.deleteByKeys('glossary', glossIds).catch(() => {}),
    DB.deleteByKeys('notes', noteIds).catch(() => {}),
    DB.deleteByKeys('bookmarks', bmIds).catch(() => {})
  ]);
}

export async function importBackupData(data) {
  if (!data || typeof data !== 'object') throw new Error('Invalid backup format');

  if (data.stats && typeof data.stats === 'object') {
    const curStats = (await DB.get('kv', 'stats').catch(() => null)) || { minutes: 0, words: 0 };
    await DB.put('kv', {
      minutes: Math.max(curStats.minutes || 0, Number(data.stats.minutes) || 0),
      words: Math.max(curStats.words || 0, Number(data.stats.words) || 0)
    }, 'stats');
  }

  for (const p of (data.progress || [])) {
    if (p && p.id) await DB.put('progress', p);
  }

  const existingNotes = (await DB.getAll('notes').catch(() => [])) || [];
  const existingBms = (await DB.getAll('bookmarks').catch(() => [])) || [];
  const existingGloss = (await DB.getAll('glossary').catch(() => [])) || [];

  const noteSigs = new Set(existingNotes.map((n) => `${n.bookId}|${n.timestamp}|${n.text}`));
  for (const n of (data.notes || [])) {
    if (!n || !n.bookId || !n.text) continue;
    const sig = `${n.bookId}|${n.timestamp}|${n.text}`;
    if (!noteSigs.has(sig)) {
      const { id: _drop, ...clean } = n;
      await DB.put('notes', clean);
      noteSigs.add(sig);
    }
  }

  const bmSigs = new Set(existingBms.map((b) => `${b.bookId}|${b.timestamp}|${b.label}`));
  for (const b of (data.bookmarks || [])) {
    if (!b || !b.bookId) continue;
    const sig = `${b.bookId}|${b.timestamp}|${b.label}`;
    if (!bmSigs.has(sig)) {
      const { id: _drop, ...clean } = b;
      await DB.put('bookmarks', clean);
      bmSigs.add(sig);
    }
  }

  const glossSigs = new Set(existingGloss.map((g) => `${g.bookId}|${g.term}`));
  for (const g of (data.glossary || [])) {
    if (!g || !g.bookId || !g.term) continue;
    const sig = `${g.bookId}|${g.term}`;
    if (!glossSigs.has(sig)) {
      const { id: _drop, ...clean } = g;
      await DB.put('glossary', clean);
      glossSigs.add(sig);
    }
  }
}
