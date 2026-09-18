// L3: compose-движок. Выделение, удаление через корзину, возврат, драг, пан/зум, поиск.
const Compose = (() => {
  const sel = new Set();
  let scale = 1, ox = 0, oy = 0;
  let boardEl = null, worldEl = null;
  let drag = null;
  let pointer = { x: 0, y: 0 };
  let raf = 0;

  function applyView() {
    if (worldEl) worldEl.style.transform =
      'translate(' + ox + 'px,' + oy + 'px) scale(' + scale + ')';
  }
  function toWorld(sx, sy) { return { x: (sx - ox) / scale, y: (sy - oy) / scale }; }

  // --- выделение ---
  function elOf(id) {
    return document.querySelector('.node[data-node-id="' + id + '"]');
  }
  function setSel(id, on) {
    if (on) sel.add(id); else sel.delete(id);
    const el = elOf(id);
    if (el) el.classList.toggle('sel', on);
  }
  function setSelection(ids) {
    clearSel();
    (ids || []).forEach(id => setSel(id, true));
  }
  function clearSel() {
    Array.from(sel).forEach(id => setSel(id, false));
    sel.clear();
  }
  function isEditing() {
    const a = document.activeElement;
    return a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
  }

  // --- центрирование на ноде (для поиска) ---
  function centerOn(node) {
    const el = elOf(node.id);
    const w = el ? el.offsetWidth : 200, h = el ? el.offsetHeight : 100;
    ox = innerWidth / 2 - (node.transform.x + w / 2) * scale;
    oy = innerHeight / 2 - (node.transform.y + h / 2) * scale;
    applyView();
  }

  // --- удаление = выселение в корзину (живёт в проекте, переживает сейв) ---
  function deleteNodes(ids) {
    const data = Project.getData();
    if (!data || !ids.length) return;
    const set = new Set(ids);
    const removed = (data.entities || []).filter(n => set.has(n.id));
    if (!removed.length) return;
    data.entities = data.entities.filter(n => !set.has(n.id));
    data.edges = (data.edges || []).filter(e => !set.has(e.from) && !set.has(e.to));
    if (!data.trash) data.trash = [];
    const now = Date.now();
    removed.forEach(n => { n.deletedAt = now; data.trash.push(n); });
    clearSel();
    Render.renderAll(data);
    Project.markDirty();
    Bus.emit('entities:deleted', { ids: ids });
  }
  function deleteSelected() { deleteNodes(Array.from(sel)); }
  function deleteEmpty() {
    const data = Project.getData();
    if (!data) return;
    const empty = (data.entities || []).filter(n => {
      const hasText = (n.parts || []).some(p =>
        p.type === 'thought' && (p.text || '').trim());
      const hasImage = (n.parts || []).some(p => p.type === 'image');
      return !hasText && !hasImage;
    });
    if (!empty.length) { alert('Пустых нод нет.'); return; }
    if (!confirm('Удалить пустых нод в корзину: ' + empty.length + '?')) return;
    deleteNodes(empty.map(n => n.id));
  }

  // --- корзина: вернуть / очистить ---
  function restoreLast() {
    const data = Project.getData();
    if (!data || !data.trash || !data.trash.length) { alert('Корзина пуста.'); return; }
    const n = data.trash.pop();
    delete n.deletedAt;
    data.entities.push(n);
    Render.renderAll(data);
    Project.markDirty();
    Bus.emit('entity:restored', n);
  }
  function clearTrash() {
    const data = Project.getData();
    if (!data || !data.trash || !data.trash.length) { alert('Корзина пуста.'); return; }
    if (!confirm('Очистить корзину НАВСЕГДА? Нод: ' + data.trash.length)) return;
    data.trash = [];
    Project.markDirty();
  }

  // --- позиция ноды ---
  function setNodePos(id, wx, wy) {
    const data = Project.getData();
    const node = data && data.entities.find(n => n.id === id);
    if (!node) return;
    node.transform.x = Math.round(wx);
    node.transform.y = Math.round(wy);
    const el = elOf(id);
    if (el) el.style.transform =
      'translate(' + node.transform.x + 'px,' + node.transform.y + 'px)';
  }

  // --- зум к курсору ---
  function zoomAt(sx, sy, factor) {
    const s2 = Math.min(3, Math.max(0.25, scale * factor));
    const w = toWorld(sx, sy);
    scale = s2;
    ox = sx - w.x * scale;
    oy = sy - w.y * scale;
    applyView();
    if (drag && drag.type === 'node') {
      const w2 = toWorld(pointer.x, pointer.y);
      setNodePos(drag.id, w2.x - drag.off.x, w2.y - drag.off.y);
    }
  }

  // --- автопан у краёв, пока тащим ноду ---
  function tick() {
    raf = 0;
    if (!drag || drag.type !== 'node') return;
    const m = 48, v = 14;
    let dx = 0, dy = 0;
    if (pointer.x < m) dx = v * (1 - pointer.x / m);
    else if (pointer.x > innerWidth - m) dx = -v * (1 - (innerWidth - pointer.x) / m);
    if (pointer.y < m) dy = v * (1 - pointer.y / m);
    else if (pointer.y > innerHeight - m) dy = -v * (1 - (innerHeight - pointer.y) / m);
    if (dx || dy) {
      ox += dx; oy += dy;
      applyView();
      const w = toWorld(pointer.x, pointer.y);
      setNodePos(drag.id, w.x - drag.off.x, w.y - drag.off.y);
      raf = requestAnimationFrame(tick);
    }
  }

  // --- вписать все ноды ---
  function fitAll() {
    const data = Project.getData();
    const ns = (data && data.entities) || [];
    if (!ns.length) { scale = 1; ox = 0; oy = 0; applyView(); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    ns.forEach(n => {
      const el = elOf(n.id);
      const w = el ? el.offsetWidth : 200, h = el ? el.offsetHeight : 100;
      minX = Math.min(minX, n.transform.x); minY = Math.min(minY, n.transform.y);
      maxX = Math.max(maxX, n.transform.x + w); maxY = Math.max(maxY, n.transform.y + h);
    });
    const pad = 80;
    const bw = maxX - minX + pad * 2, bh = maxY - minY + pad * 2;
    scale = Math.min(3, Math.max(0.25, Math.min(innerWidth / bw, innerHeight / bh)));
    ox = (innerWidth - (minX + maxX) * scale) / 2;
    oy = (innerHeight - (minY + maxY) * scale) / 2;
    applyView();
  }

  // --- поиск нод ---
  function initSearch() {
    const box = document.createElement('div');
    box.className = 'search-box';
    box.innerHTML = 
      '<button class="search-toggle" title="Поиск (Ctrl+F)">🔍</button>' +
      '<div class="search-panel" style="display:none;">' +
        '<input class="search-input" type="text" placeholder="Поиск нод…" autocomplete="off">' +
        '<div class="search-results" style="display:none;"></div>' +
      '</div>';
    document.body.appendChild(box);

    const toggle = box.querySelector('.search-toggle');
    const panel = box.querySelector('.search-panel');
    const input = box.querySelector('.search-input');
    const results = box.querySelector('.search-results');
    let timer = null;

    toggle.addEventListener('click', () => {
      const isOpen = panel.style.display !== 'none';
      panel.style.display = isOpen ? 'none' : 'block';
      toggle.style.display = isOpen ? 'block' : 'none';
      if (!isOpen) { input.focus(); input.select(); }
    });

    function closeSearch() {
      panel.style.display = 'none';
      toggle.style.display = 'block';
      input.value = '';
      results.style.display = 'none';
    }

    function doSearch(query) {
      results.innerHTML = '';
      if (!query || query.length < 2) {
        results.style.display = 'none';
        return;
      }
      const q = query.toLowerCase();
      const data = Project.getData();
      if (!data) return;
      const matches = (data.entities || []).filter(n => {
        if (n.title && n.title.toLowerCase().includes(q)) return true;
        return (n.parts || []).some(p => p.type === 'thought' && (p.text || '').toLowerCase().includes(q));
      }).slice(0, 10);

      if (!matches.length) {
        results.innerHTML = '<div class="search-result empty">Ничего не найдено</div>';
        results.style.display = 'block';
        return;
      }

      matches.forEach(n => {
        const el = document.createElement('div');
        el.className = 'search-result';
        const title = n.title || '(без названия)';
        const thought = (n.parts || []).find(p => p.type === 'thought');
        const text = thought ? (thought.text || '') : '';
        const preview = text.length > 60 ? text.slice(0, 60) + '…' : text;
        el.innerHTML = '<div class="search-result-title"></div>' +
                       (preview ? '<div class="search-result-text"></div>' : '');
        el.querySelector('.search-result-title').textContent = title;
        if (preview) el.querySelector('.search-result-text').textContent = preview;
        el.addEventListener('click', () => {
          closeSearch();
          setSelection([n.id]);
          centerOn(n);
        });
        results.appendChild(el);
      });
      results.style.display = 'block';
    }

    input.addEventListener('input', e => {
      clearTimeout(timer);
      timer = setTimeout(() => doSearch(e.target.value), 200);
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSearch();
      }
    });

    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А')) {
        e.preventDefault();
        panel.style.display = 'block';
        toggle.style.display = 'none';
        input.focus();
        input.select();
      }
    });
  }

  function init(board) {
    boardEl = board || document.getElementById('board');
    worldEl = Render.getWorld();

    boardEl.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      if (e.target.isContentEditable) return;   // в режиме правки мышь работает с текстом
      if (e.target.closest('.socket')) return;   // гнёзда ведёт graph, не compose
      e.preventDefault();                        // хват без нативного выделения
      const ae = document.activeElement;
      if (ae && ae.isContentEditable) ae.blur();
      pointer = { x: e.clientX, y: e.clientY };
      const nodeElm = e.target.closest('.node');
      if (nodeElm) {
        const id = nodeElm.dataset.nodeId;
        const data = Project.getData();
        const node = data.entities.find(n => n.id === id);
        const w = toWorld(e.clientX, e.clientY);
        drag = { type: 'node', id: id, moved: false,
                 sx: e.clientX, sy: e.clientY,
                 off: { x: w.x - node.transform.x, y: w.y - node.transform.y } };
        if (e.ctrlKey || e.metaKey) { setSel(id, !sel.has(id)); }
        else if (!sel.has(id)) { clearSel(); setSel(id, true); }
      } else {
        drag = { type: 'pan', sx: e.clientX, sy: e.clientY,
                 ox0: ox, oy0: oy, moved: false };
        boardEl.classList.add('panning');
      }
    });

    document.addEventListener('mousemove', e => {
      pointer = { x: e.clientX, y: e.clientY };
      if (!drag) return;
      if (drag.type === 'node') {
        if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 3) {
          drag.moved = true;
        }
        if (drag.moved) {
          const w = toWorld(e.clientX, e.clientY);
          setNodePos(drag.id, w.x - drag.off.x, w.y - drag.off.y);
          Bus.emit('entity:moving', { id: drag.id });
          if (!raf) raf = requestAnimationFrame(tick);
        }
      } else {
        if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 3) {
          drag.moved = true;
        }
        ox = drag.ox0 + (e.clientX - drag.sx);
        oy = drag.oy0 + (e.clientY - drag.sy);
        applyView();
      }
    });

    document.addEventListener('mouseup', (e) => {
      if (!drag) return;
      if (drag.type === 'node' && drag.moved) {
        if (e.altKey) {
          const d = Project.getData();
          const n = d && d.entities.find(x => x.id === drag.id);
          if (n) n.group = null;   // Alt+тянуть = вынуть из блока
        }
        Project.markDirty();
        Bus.emit('entity:moved', { id: drag.id });
      }
      if (drag.type === 'pan') {
        boardEl.classList.remove('panning');
        if (!drag.moved) clearSel();
      }
      drag = null;
    });

    boardEl.addEventListener('wheel', e => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });

    boardEl.addEventListener('dblclick', e => {
      if (e.target.closest('.node') || e.target.closest('.block') ||
          e.target.closest('.palette') || e.target.closest('.mic-pill') ||
          e.target.closest('.edges-svg') || e.target.closest('.search-box')) return;
      scale = 1; ox = 0; oy = 0; applyView();
    });

    document.addEventListener('keydown', e => {
      if (isEditing()) return;
      if (e.key === 'Delete' && sel.size) { e.preventDefault(); deleteSelected(); }
      if ((e.ctrlKey || e.metaKey) &&
          (e.key === 'z' || e.key === 'Z' || e.key === 'я' || e.key === 'Я')) {
        e.preventDefault();
        restoreLast();
      }
      if (e.key === 'Enter' && sel.size === 1) {
        const id = Array.from(sel)[0];
        const data = Project.getData();
        const node = data && data.entities.find(n => n.id === id);
        if (node) { e.preventDefault(); Render.editPart(node, 'thought'); }
      }
      if ((e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') &&
          !e.ctrlKey && !e.metaKey) fitAll();
    });

    initSearch();
  }

  return { init, deleteSelected, deleteEmpty, deleteNodes, setSelection,
           restoreLast, clearTrash, fitAll, centerOn,
           selected: () => sel, toWorld: toWorld };
})();