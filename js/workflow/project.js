// L4: проектная оболочка. Создать/открыть/сохранить/сохранить как;
// адаптер хранилища (D11); память последней папки; запись и чтение медиа.
const Project = (() => {
  let dirHandle = null;
  let data = null;
  let dirty = false;
  let saveTimer = null;
  const FILE = 'data.json';

  // --- Память последней папки (IndexedDB) ---
  function idb() {
    return new Promise((resolve, reject) => {
      const rq = indexedDB.open('doska', 1);
      rq.onupgradeneeded = () => { rq.result.createObjectStore('kv'); };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    });
  }
  async function idbGet(key) {
    try {
      const db = await idb();
      return await new Promise(resolve => {
        const rq = db.transaction('kv').objectStore('kv').get(key);
        rq.onsuccess = () => resolve(rq.result || null);
        rq.onerror = () => resolve(null);
      });
    } catch (e) { return null; }
  }
  async function idbSet(key, val) {
    try {
      const db = await idb();
      await new Promise(resolve => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(val, key);
        tx.oncomplete = resolve; tx.onerror = resolve;
      });
    } catch (e) {}
  }
  async function lastDir() { return await idbGet('lastDir'); }

  function emptyData(name) {
    return {
      meta: { name: name || 'Без имени', created: Date.now(),
              modified: Date.now(), specVersion: '0.7' },
      entities: [], edges: [], blocks: [], trash: []
    };
  }

  function hasFS() { return !!window.showDirectoryPicker; }

  function hint(text) {
    const el = document.querySelector('.board-hint');
    if (el) el.textContent = text;
  }

  function refreshTitle() {
    const name = data ? data.meta.name : null;
    document.title = name ? 'ДОСКА — ' + name + (dirty ? ' *' : '') : 'ДОСКА';
    if (!data) {
      hint('Доска пуста.');
    } else if (!dirHandle && data.entities.length === 0) {
      hint('Проект — это папка с data.json внутри. «Файл → Сохранить» спросит, где дому проекта жить. N — поймать мысль.');
    } else if (dirHandle) {
      hint('Проект «' + name + '» живёт в папке «' + dirHandle.name + '». Автосейв включён. N — поймать мысль.');
    } else {
      hint('Проект «' + name + '»: папка не выбрана — фолбэк-режим (скачивание файла).');
    }
    Bus.emit('project:changed', { data: data, dirty: dirty });
  }

  function markDirty() {
    dirty = true;
    refreshTitle();
    if (dirHandle) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => save(true), 800);
    }
  }

  function serializeData() {
    const clean = JSON.parse(JSON.stringify(data));
    (clean.entities || []).forEach(n =>
      (n.parts || []).forEach(p => { delete p.url; }));
    return JSON.stringify(clean, null, 2);
  }

  // --- Адаптер A: FS Access API ---
  async function writeViaHandle() {
    const fh = await dirHandle.getFileHandle(FILE, { create: true });
    const w = await fh.createWritable();
    await w.write(serializeData());
    await w.close();
  }
  async function readViaHandle(dh) {
    const fh = await dh.getFileHandle(FILE);
    const f = await fh.getFile();
    return JSON.parse(await f.text());
  }
  async function writeMedia(name, blob) {
    if (!dirHandle) return null;
    try {
      const media = await dirHandle.getDirectoryHandle('media', { create: true });
      const fh = await media.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      return 'media/' + name;
    } catch (e) { return null; }
  }
  async function readMedia(path) {
    if (!dirHandle) return null;
    try {
      const parts = path.split('/');
      const name = parts.pop();
      let dir = dirHandle;
      for (const seg of parts) dir = await dir.getDirectoryHandle(seg);
      const fh = await dir.getFileHandle(name);
      const f = await fh.getFile();
      return URL.createObjectURL(f);
    } catch (e) { return null; }
  }

  // --- Адаптер B: фолбэк download/upload ---
  function download() {
    const blob = new Blob([serializeData()],
              { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = FILE;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function upload() {
    return new Promise((resolve, reject) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.json,application/json';
      inp.onchange = () => {
        const f = inp.files[0];
        if (!f) return reject(new Error('отменено'));
        const r = new FileReader();
        r.onload = () => resolve(JSON.parse(r.result));
        r.onerror = () => reject(r.error);
        r.readAsText(f);
      };
      inp.click();
    });
  }

  // --- Операции ---
  function createNew() {
    data = emptyData();
    dirHandle = null;
    dirty = true;
    refreshTitle();
    Bus.emit('project:created', { data: data });
  }

  async function save(silent) {
    if (!data) return;
    data.meta.modified = Date.now();
    let saved = false;
    try {
      if (!dirHandle) {
        const stored = await lastDir();
        if (stored) {
          try {
            const perm = await stored.requestPermission({ mode: 'readwrite' });
            if (perm === 'granted') dirHandle = stored;
          } catch (e) {}
        }
        if (!dirHandle && hasFS()) {
          try {
            dirHandle = await window.showDirectoryPicker({
              mode: 'readwrite', startIn: stored || undefined });
          } catch (pe) {
            if (pe && pe.name === 'AbortError') return;
            dirHandle = null;
          }
        }
        if (dirHandle) await idbSet('lastDir', dirHandle);
      }
      if (dirHandle) { await writeViaHandle(); saved = true; }
    } catch (e) { /* падаем в фолбэк */ }
    if (!saved) download();
    dirty = false;
    refreshTitle();
    Bus.emit('project:save', { silent: !!silent });
  }

  async function saveAs() {
    if (!data) return;
    const prev = dirHandle;
    dirHandle = null;
    const stored = await lastDir();
    try {
      dirHandle = await window.showDirectoryPicker({
        mode: 'readwrite', startIn: prev || stored || undefined });
      await idbSet('lastDir', dirHandle);
      await save(false);
    } catch (pe) {
      dirHandle = prev;
    }
  }

  async function open() {
    let d = null, dh = null;
    if (hasFS()) {
      try {
        const stored = await lastDir();
        dh = await window.showDirectoryPicker({
          mode: 'readwrite', startIn: dirHandle || stored || undefined });
        d = await readViaHandle(dh);
      } catch (e) {
        if (e && e.name === 'AbortError') return;
        if (e && e.name === 'NotFoundError') {
          alert('В выбранной папке нет data.json');
          return;
        }
        dh = null; d = null;
      }
    }
    if (!d) {
      try { d = await upload(); } catch (e) { return; }
    }
    dirHandle = dh;
    if (dirHandle) await idbSet('lastDir', dirHandle);
    data = d;
    dirty = false;
    refreshTitle();
    Bus.emit('project:open', { data: data });
  }

  function init() {
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save(false);
      }
    });
    createNew();
  }

  return {
    init, createNew, save, saveAs, open, markDirty, writeMedia, readMedia,
    getData: () => data,
    hasHandle: () => !!dirHandle
  };
})();