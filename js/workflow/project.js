// L4: проектная оболочка. Создать/открыть/сохранить; адаптер хранилища (D11).
const Project = (() => {
  let dirHandle = null;   // папка проекта (FS Access API) или null
  let data = null;        // текущий проект в памяти
  let dirty = false;
  let saveTimer = null;
  const FILE = 'data.json';

  function emptyData(name) {
    return {
      meta: { name: name || 'Без имени', created: Date.now(),
              modified: Date.now(), specVersion: '0.7' },
      entities: [], edges: [], blocks: []
    };
  }

  function hasFS() { return !!window.showDirectoryPicker; }

  function refreshTitle() {
    document.title = data
      ? 'ДОСКА — ' + data.meta.name + (dirty ? ' *' : '')
      : 'ДОСКА';
    Bus.emit('project:changed', { data: data, dirty: dirty });
  }

  function markDirty() {
    dirty = true;
    refreshTitle();
    if (dirHandle) {                 // автосейв только когда есть ручка папки
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => save(true), 800);
    }
  }

  // --- Адаптер A: FS Access API ---
  async function writeViaHandle() {
    const fh = await dirHandle.getFileHandle(FILE, { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(data, null, 2));
    await w.close();
  }
  async function readViaHandle(dh) {
    const fh = await dh.getFileHandle(FILE);
    const f = await fh.getFile();
    return JSON.parse(await f.text());
  }

  // --- Адаптер B: фолбэк download/upload ---
  function download() {
    const blob = new Blob([JSON.stringify(data, null, 2)],
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
      if (!dirHandle && hasFS()) {
        try {
          dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        } catch (pe) {
          if (pe && pe.name === 'AbortError') return;   // сам отменил
          dirHandle = null;                              // API не дал → фолбэк
        }
      }
      if (dirHandle) { await writeViaHandle(); saved = true; }
    } catch (e) { /* падаем в фолбэк */ }
    if (!saved) download();
    dirty = false;
    refreshTitle();
    Bus.emit('project:save', { silent: !!silent });
  }

  async function open() {
    let d = null, dh = null;
    if (hasFS()) {
      try {
        dh = await window.showDirectoryPicker({ mode: 'readwrite' });
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
    init, createNew, save, open, markDirty,
    getData: () => data,
    hasHandle: () => !!dirHandle
  };
})();