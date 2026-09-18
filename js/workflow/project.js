// L4: проектная оболочка. Модель «полка» (D19): папка = полка,
// проект = <имя>.json на полке, медиа в media/<слаг>/. Переименование оставляет
// старый файл снимком; коллизии имён = автосуффикс; открытие полки с несколькими
// проектами = оверлей-список; автосейв только у привязанного проекта.
// Привязка всегда спрашивает: куда положить и (если имя не задано) как назвать.
// Предохранители: loading-флаг, bak перед перезаписью, защита линии, автовосстановление.
const Project = (() => {
  let dirHandle = null;
  let fileName = null;
  let data = null;
  let dirty = false;
  let saveTimer = null;
  let loading = false;
  let loadedModified = null;
  let skipDangerOnce = false;

  // --- имена ---
  function sanitizeName(name) {
    const s = (name || '').replace(/[\\/:*?"<>|]/g, '_').trim();
    return s || 'Без имени';
  }
  function slugOf(name) {
    return sanitizeName(name).toLowerCase().replace(/\s+/g, '-');
  }
  function fileOf(name) { return sanitizeName(name) + '.json'; }
  function bakOf(name) { return sanitizeName(name) + '.bak.json'; }

  // --- IndexedDB: последняя полка и последний файл ---
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
  async function lastFile() { return await idbGet('lastFile'); }

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
    } else if (!dirHandle || !fileName) {
      hint('Проект НЕ привязан к полке: «Файл → Сохранить» спросит, куда положить и как назвать. Автосейв выключен. N — поймать мысль.');
    } else {
      hint('Проект «' + name + '» живёт на полке «' + dirHandle.name + '» в файле «' + fileName + '». Автосейв включён. N — поймать мысль.');
    }
    Bus.emit('project:changed', { data: data, dirty: dirty });
  }
  function markDirty() {
    dirty = true;
    refreshTitle();
    if (loading) return;
    if (dirHandle && fileName) {
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

  // --- файловые примитивы ---
  async function exists(dh, fname) {
    try { await dh.getFileHandle(fname); return true; } catch (e) { return false; }
  }
  async function readText(dh, fname) {
    const fh = await dh.getFileHandle(fname);
    const f = await fh.getFile();
    return await f.text();
  }
  async function writeTextFile(dh, fname, text) {
    const fh = await dh.getFileHandle(fname, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
  }
  async function enumerateProjects(dh) {
    const names = [];
    try {
      for await (const entry of dh.values()) {
        if (entry.kind === 'file' && entry.name.endsWith('.json') &&
            !entry.name.endsWith('.bak.json')) names.push(entry.name);
      }
    } catch (e) {}
    return names.sort((a, b) => a.localeCompare(b, 'ru'));
  }

  // --- оверлей-список проектов полки ---
  function pickOverlay(names) {
    return new Promise(resolve => {
      const ov = document.createElement('div');
      ov.className = 'about-overlay';
      let html = '<div class="about-card"><h2>На полке несколько проектов — выбери:</h2>';
      names.forEach(() => { html += '<div class="search-result"></div>'; });
      html += '<button class="about-close">отмена</button></div>';
      ov.innerHTML = html;
      const items = ov.querySelectorAll('.search-result');
      names.forEach((n, i) => { items[i].textContent = n; items[i].dataset.fname = n; });
      ov.addEventListener('click', e => {
        if (e.target === ov || e.target.classList.contains('about-close')) {
          ov.remove(); resolve(null); return;
        }
        const item = e.target.closest('.search-result');
        if (item) { ov.remove(); resolve(item.dataset.fname); }
      });
      document.body.appendChild(ov);
    });
  }

  // --- загрузка с предохранителем loading ---
  async function loadFrom(dh, fname) {
    loading = true;
    try {
      const d = JSON.parse(await readText(dh, fname));
      dirHandle = dh;
      fileName = fname;
      await idbSet('lastDir', dh);
      await idbSet('lastFile', fname);
      data = d;
      dirty = false;
      loadedModified = (d.meta && d.meta.modified) || null;
      refreshTitle();
      Bus.emit('project:open', { data: d });
    } finally {
      loading = false;
    }
  }

  // --- привязка к полке с правилом коллизий (автосуффикс) ---
  async function attachToShelf(dh) {
    let base = sanitizeName(data.meta.name);
    let fname = fileOf(base);
    while (await exists(dh, fname)) {
      let same = false;
      try {
        const old = JSON.parse(await readText(dh, fname));
        same = !!(old.meta && data.meta && old.meta.created === data.meta.created);
      } catch (e) { same = false; }
      if (same) break;
      const m = base.match(/^(.*) \((\d+)\)$/);
      base = m ? m[1] + ' (' + (parseInt(m[2], 10) + 1) + ')' : base + ' (2)';
      fname = fileOf(base);
    }
    dirHandle = dh;
    fileName = fname;
    data.meta.name = base;
    await idbSet('lastDir', dh);
    await idbSet('lastFile', fname);
  }

  // --- автовосстановление последнего проекта ---
  async function tryRestoreLast(force) {
    if (!hasFS()) return false;
    const stored = await lastDir();
    if (!stored) return false;
    try {
      let perm = await stored.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        if (!force) {
          hint('Последняя полка: «' + stored.name + '». Продолжить: Файл → Продолжить последний проект.');
          return false;
        }
        perm = await stored.requestPermission({ mode: 'readwrite' });
        if (perm !== 'granted') return false;
      }
      const lf = await lastFile();
      if (lf && await exists(stored, lf)) { await loadFrom(stored, lf); return true; }
      const names = await enumerateProjects(stored);
      if (names.length === 1) { await loadFrom(stored, names[0]); return true; }
      if (names.length > 1 && force) {
        const pick = await pickOverlay(names);
        if (pick) { await loadFrom(stored, pick); return true; }
        return false;
      }
      if (names.length > 1) hint('На полке «' + stored.name + '» несколько проектов — Файл → Открыть проект…');
      return false;
    } catch (e) { return false; }
  }
  function continueLast() { return tryRestoreLast(true); }

  // --- операции ---
  function createNew() {
    if (data && !fileName && dirty && (data.entities || []).length) {
      if (!confirm('Текущая доска не сохранена в папку и будет потеряна. Продолжить?')) return;
    }
    data = emptyData();
    dirHandle = null;
    fileName = null;
    loadedModified = null;
    dirty = true;
    refreshTitle();
    Bus.emit('project:created', { data: data });
  }

  async function save(silent) {
    if (!data || loading) return;
    if (silent && (!dirHandle || !fileName)) return;   // бездомный не автосейвится
    data.meta.modified = Date.now();
    let saved = false;
    try {
      if (!dirHandle || !fileName) {
        const stored = await lastDir();
        let dh = null;
        if (hasFS()) {
          try {
            dh = await window.showDirectoryPicker({
              mode: 'readwrite', startIn: stored || undefined });
          } catch (pe) {
            if (pe && pe.name === 'AbortError') return;
            dh = null;
          }
        }
        if (!dh) throw new Error('no shelf');
        if (data.meta.name === 'Без имени') {
          const asked = prompt('Как назвать проект? Полка «' + dh.name + '»', dh.name);
          if (asked === null) return;   // отменил вопрос имени = отменил сейв
          data.meta.name = asked.trim() ? sanitizeName(asked) : sanitizeName(dh.name);
          refreshTitle();
        }
        await attachToShelf(dh);
      }
      let oldText = null;
      try { oldText = await readText(dirHandle, fileName); } catch (e) { oldText = null; }
      if (oldText !== null) {
        try { await writeTextFile(dirHandle, bakOf(fileName.replace(/\.json$/, '')), oldText); } catch (e) {}
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
            hint('Автосейв пропущен: ' + fileName + ' изменился извне (другое окно?). Ctrl+S — сохранить вручную.');
            return;
          }
          if (!confirm(fileName + ' в папке изменился извне или принадлежит другому проекту.\n' +
                       'Перезаписать его текущей версией? Прежняя копия останется в .bak.json.')) return;
        }
      }
      skipDangerOnce = false;
      await writeTextFile(dirHandle, fileName, serializeData());
      saved = true;
      loadedModified = data.meta.modified;
    } catch (e) { /* падаем в фолбэк */ }
    if (!saved) {
      const blob = new Blob([serializeData()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName || fileOf(data.meta.name);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    dirty = false;
    refreshTitle();
    Bus.emit('project:save', { silent: !!silent });
  }

  async function saveAs() {
    if (!data) return;
    const prevDir = dirHandle, prevFile = fileName;
    const stored = await lastDir();
    try {
      const dh = await window.showDirectoryPicker({
        mode: 'readwrite', startIn: dirHandle || stored || undefined });
      dirHandle = null; fileName = null;
      await attachToShelf(dh);
      await save(false);
    } catch (pe) {
      dirHandle = prevDir; fileName = prevFile;
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
      const names = await enumerateProjects(dh);
      if (!names.length) { alert('На полке нет проектов (.json).'); return; }
      let fname = names[0];
      if (names.length > 1) {
        fname = await pickOverlay(names);
        if (!fname) return;
      }
      try { await loadFrom(dh, fname); return; }
      catch (e) { alert('Не удалось открыть ' + fname); return; }
    }
    loading = true;
    try {
      const d = await new Promise((resolve, reject) => {
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
      dirHandle = null; fileName = null;
      data = d;
      dirty = false;
      loadedModified = (d.meta && d.meta.modified) || null;
      refreshTitle();
      Bus.emit('project:open', { data: d });
    } catch (e) { return; }
    finally { loading = false; }
  }

  async function restoreBackup() {
    const dh = dirHandle || (await lastDir());
    const fn = fileName || (await lastFile());
    if (!dh || !fn) { alert('Нет папки проекта — не из чего восстанавливать.'); return; }
    loading = true;
    try {
      const txt = await readText(dh, bakOf(fn.replace(/\.json$/, '')));
      const d = JSON.parse(txt);
      dirHandle = dh;
      fileName = fn;
      data = d;
      dirty = true;
      skipDangerOnce = true;
      refreshTitle();
      Bus.emit('project:open', { data: d });
      await save(false);
    } catch (e) {
      alert('Резервная копия .bak.json не найдена или не читается.');
    } finally { loading = false; }
  }

  async function rename() {
    if (!data) return;
    const next = prompt('Имя проекта:', data.meta.name || '');
    if (next === null) return;
    const clean = next.trim();
    if (!clean || clean === data.meta.name) return;
    if (dirHandle && fileName) {
      let base = sanitizeName(clean);
      let fname = fileOf(base);
      while (await exists(dirHandle, fname)) {
        let same = false;
        try {
          const old = JSON.parse(await readText(dirHandle, fname));
          same = !!(old.meta && data.meta && old.meta.created === data.meta.created);
        } catch (e) { same = false; }
        if (same) break;
        const m = base.match(/^(.*) \((\d+)\)$/);
        base = m ? m[1] + ' (' + (parseInt(m[2], 10) + 1) + ')' : base + ' (2)';
        fname = fileOf(base);
      }
      data.meta.name = base;
      fileName = fname;                 // старый файл остаётся лежать снимком
      await idbSet('lastFile', fname);
      refreshTitle();
      await save(false);
    } else {
      data.meta.name = sanitizeName(clean);
      refreshTitle();
    }
    markDirty();
    Bus.emit('project:renamed', { name: data.meta.name });
  }

  // --- медиа: media/<слаг проекта>/ ---
  async function writeMedia(name, blob) {
    if (!dirHandle) return null;
    try {
      const media = await dirHandle.getDirectoryHandle('media', { create: true });
      const sub = await media.getDirectoryHandle(slugOf(data.meta.name), { create: true });
      const fh = await sub.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      return 'media/' + slugOf(data.meta.name) + '/' + name;
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
      await writeTextFile(dirHandle, name, text);
      return name;
    } catch (e) { return null; }
  }

  function init() {
    document.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (k === 's' || k === 'ы')) {
        e.preventDefault();
        save(false);
      }
    });
    createNew();
    tryRestoreLast(false);
  }

  return {
    init, createNew, save, saveAs, open, markDirty, writeMedia, readMedia, writeText,
    rename, continueLast, restoreBackup,
    getData: () => data,
    hasHandle: () => !!dirHandle && !!fileName
  };
})();