// L4: проектная оболочка. Создать/открыть/сохранить/сохранить как;
// адаптер хранилища (D11); память последней папки; запись и чтение медиа;
// автовосстановление последнего проекта; bak-копия и защита от чужой записи.
const Project = (() => {
  let dirHandle = null;
  let data = null;
  let dirty = false;
  let saveTimer = null;
  let loading = false;          // пока true — сейв и автосейв молчат
  let loadedModified = null;    // meta.modified на момент загрузки/записи
  let skipDangerOnce = false;   // разовое «пишу поверх сознательно» (restore bak)
  const FILE = 'data.json';
  const BAK = 'data.json.bak';

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
    if (loading) return;               // гонка при загрузке убита
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
  async function readTextViaHandle(dh, name) {
    const fh = await dh.getFileHandle(name);
    const f = await fh.getFile();
    return await f.text();
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
  async function writeText(name, text) {
    if (!dirHandle) return null;
    try {
      const fh = await dirHandle.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(text);
      await w.close();
      return name;
    } catch (e) { return null; }
  }

  // --- Адаптер B: фолбэк download/upload ---
  function download() {
    const blob = new Blob([serializeData()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = FILE; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function upload() {
    return new Promise((resolve, reject) => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.json,application/json';
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

  // --- Загрузка с предохранителем loading ---
  async function loadFrom(dh) {
    loading = true;
    try {
      const d = await readViaHandle(dh);
      dirHandle = dh;
      await idbSet('lastDir', dh);
      data = d;
      dirty = false;
      loadedModified = (d.meta && d.meta.modified) || null;
      refreshTitle();
      Bus.emit('project:open', { data: d });
    } finally {
      loading = false;
    }
  }

  // --- Автовосстановление последнего проекта (только чтение) ---
  async function tryRestoreLast(force) {
    if (!hasFS()) return false;
    const stored = await lastDir();
    if (!stored) return false;
    try {
      let perm = await stored.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        if (!force) {
          hint('Последний проект: папка «' + stored.name + '». Продолжить: Файл → Продолжить последний проект.');
          return false;
        }
        perm = await stored.requestPermission({ mode: 'readwrite' });
        if (perm !== 'granted') return false;
      }
      await loadFrom(stored);
      return true;
    } catch (e) { return false; }
  }
  function continueLast() { return tryRestoreLast(true); }

  // --- Операции ---
  function createNew() {
    data = emptyData();
    dirHandle = null;
    loadedModified = null;
    dirty = true;
    refreshTitle();
    Bus.emit('project:created', { data: data });
  }

  async function save(silent) {
    if (!data || loading) return;
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
      if (dirHandle) {
        let oldText = null;
        try { oldText = await readTextViaHandle(dirHandle, FILE); } catch (e) { oldText = null; }
        if (oldText !== null) {
          try {                                   // bak прежнего содержимого
            const bak = await dirHandle.getFileHandle(BAK, { create: true });
            const wb = await bak.createWritable();
            await wb.write(oldText);
            await wb.close();
          } catch (e) {}
          let danger = false;
          try {
            const old = JSON.parse(oldText);
            const otherLineage = !!(old.meta && data.meta && old.meta.created !== data.meta.created);
            const newer = !!(old.meta && loadedModified !== null &&
                             (old.meta.modified || 0) > loadedModified);
            danger = otherLineage || newer;
          } catch (e) {}
          if (danger && !skipDangerOnce) {
            if (silent) {
              hint('Автосейв пропущен: data.json изменился извне (другое окно?). Ctrl+S — сохранить вручную.');
              return;
            }
            if (!confirm('data.json в папке изменился извне или принадлежит другому проекту.\n' +
                         'Перезаписать его текущей версией? Прежняя копия останется в data.json.bak.')) return;
          }
        }
        skipDangerOnce = false;
        await writeViaHandle();
        saved = true;
        loadedModified = data.meta.modified;
      }
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
    let dh = null;
    if (hasFS()) {
      try {
        const stored = await lastDir();
        dh = await window.showDirectoryPicker({
          mode: 'readwrite', startIn: dirHandle || stored || undefined });
      } catch (e) {
        if (e && e.name === 'AbortError') return;
        dh = null;
      }
    }
    if (dh) {
      try { await loadFrom(dh); return; }
      catch (e) {
        if (e && e.name === 'NotFoundError') { alert('В выбранной папке нет data.json'); return; }
      }
    }
    try {
      const d = await upload();
      loading = true;
      data = d; dirty = false;
      loadedModified = (d.meta && d.meta.modified) || null;
      refreshTitle();
      Bus.emit('project:open', { data: d });
    }