// L3: blocks. Кластеры как в UE: лассо (B+рамка), имя inline, цвет палитрой.
const Blocks = (() => {
  const PALETTE = ['#b3402e', '#2e7d4f', '#2b5fb3', '#7a4bbf', '#b3802e', '#2e8b8b'];
  const PALETTE_NAMES = ['красный', 'зелёный', 'синий', 'фиолетовый', 'оранжевый', 'бирюзовый'];
  let layer = null, worldEl = null, boardEl = null;
  let drag = null, marquee = null, paletteEl = null, bHeld = false;
  const els = new Map();

  function data() { return Project.getData(); }
  function list() { const d = data(); return (d && d.blocks) || []; }
  function isEditing() {
    const a = document.activeElement;
    return a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
  }
  function ensureLayer() {
    if (layer) return layer;
    worldEl = Render.getWorld();
    boardEl = document.getElementById('board');
    layer = document.createElement('div');
    layer.className = 'blocks-layer';
    worldEl.insertBefore(layer, worldEl.firstChild);
    return layer;
  }
  function membersOf(blockId) {
    const d = data(); if (!d) return [];
    return (d.entities || []).filter(n => n.group && n.group.blockId === blockId);
  }
  function nodeSize(id) {
    const el = document.querySelector('.node[data-node-id="' + id + '"]');
    return { w: el ? el.offsetWidth : 200, h: el ? el.offsetHeight : 100 };
  }
  function bbox(nodes) {
    if (!nodes.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      const s = nodeSize(n.id);
      minX = Math.min(minX, n.transform.x); minY = Math.min(minY, n.transform.y);
      maxX = Math.max(maxX, n.transform.x + s.w); maxY = Math.max(maxY, n.transform.y + s.h);
    });
    const pad = 24, top = 34;
    return { x: minX - pad, y: minY - top, w: (maxX - minX) + pad * 2, h: (maxY - minY) + top + pad };
  }
  function hexA(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }
  function nextColor() { return PALETTE[list().length % PALETTE.length]; }
  function currentScale() {
    const m = new DOMMatrixReadOnly(getComputedStyle(Render.getWorld()).transform);
    return m.a || 1;
  }

  // --- инкрементальный рендер: элементы живут, dblclick не умирает ---
  function render() {
    const L = ensureLayer();
    const seen = new Set();
    list().forEach(b => {
      seen.add(b.id);
      let el = els.get(b.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'block';
        el.dataset.blockId = b.id;
        const t = document.createElement('div'); t.className = 'block-title';
        const lab = document.createElement('span'); lab.className = 'block-label';
        const dot = document.createElement('span'); dot.className = 'block-color'; dot.title = 'цвет';
        const close = document.createElement('span'); close.className = 'block-close'; close.textContent = '×';
        close.title = 'удалить блок (ноды останутся)';
        t.appendChild(lab); t.appendChild(dot); t.appendChild(close);
        el.appendChild(t);
        L.appendChild(el);
        els.set(b.id, el);
      }
      const lab = el.querySelector('.block-label');
      if (document.activeElement !== lab) lab.textContent = b.title || '';
      el.querySelector('.block-title').style.background = b.color;
      el.style.background = hexA(b.color, 0.18);
      const box = bbox(membersOf(b.id));
      if (box) { el.style.left = box.x + 'px'; el.style.top = box.y + 'px';
                 el.style.width = box.w + 'px'; el.style.height = box.h + 'px'; }
    });
    els.forEach((el, id) => { if (!seen.has(id)) { el.remove(); els.delete(id); } });
  }

  function groupSelection() {
    const d = data(); if (!d) return null;
    const ids = Array.from(Compose.selected());
    if (!ids.length) return null;
    if (!d.blocks) d.blocks = [];
    const b = { id: Entity.nextId('b'), title: '', color: nextColor() };
    d.blocks.push(b);
    ids.forEach(id => { const n = d.entities.find(x => x.id === id); if (n) n.group = { blockId: b.id }; });
    Project.markDirty(); Bus.emit('block:changed', b); render();
    return b;
  }
  function deleteBlock(blockId) {
    const d = data(); if (!d) return;
    (d.entities || []).forEach(n => { if (n.group && n.group.blockId === blockId) n.group = null; });
    d.blocks = (d.blocks || []).filter(b => b.id !== blockId);
    Project.markDirty(); Bus.emit('block:changed', {}); render();
  }
  function setColor(blockId, color) {
    const d = data(); if (!d) return;
    const b = (d.blocks || []).find(x => x.id === blockId); if (!b) return;
    b.color = color;
    Project.markDirty(); Bus.emit('block:changed', b); render();
  }

  // --- палитра ---
  function closePalette() { if (paletteEl) { paletteEl.remove(); paletteEl = null; } }
  function openPalette(dot, blockId) {
    closePalette();
    paletteEl = document.createElement('div');
    paletteEl.className = 'palette';
    PALETTE.forEach((c, i) => {
      const s = document.createElement('span');
      s.className = 'palette-swatch';
      s.style.background = c;
      s.title = PALETTE_NAMES[i];
      s.addEventListener('mousedown', ev => ev.stopPropagation());
      s.addEventListener('click', ev => { ev.stopPropagation(); setColor(blockId, c); closePalette(); });
      paletteEl.appendChild(s);
    });
    document.body.appendChild(paletteEl);
    const r = dot.getBoundingClientRect();
    paletteEl.style.left = r.left + 'px';
    paletteEl.style.top = (r.bottom + 6) + 'px';
    setTimeout(() => document.addEventListener('mousedown', function oc(e) {
      if (paletteEl && !paletteEl.contains(e.target)) closePalette();
    }, { once: true }), 0);
  }

  // --- inline-имя ---
  function startEdit(label, blockId) {
    label.contentEditable = 'true';
    const bs = boardEl.scrollLeft, bt = boardEl.scrollTop;
    label.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(label);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    boardEl.scrollLeft = bs; boardEl.scrollTop = bt;
    const commit = () => {
      label.contentEditable = 'false';
      const d = data();
      const b = (d.blocks || []).find(x => x.id === blockId);
      if (b) { b.title = label.textContent.trim(); Project.markDirty(); Bus.emit('block:changed', b); }
      render();
    };
    label.addEventListener('blur', commit, { once: true });
    label.addEventListener('keydown', ev => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); label.blur(); }
      if (ev.key === 'Escape') { ev.preventDefault();
        const b = list().find(x => x.id === blockId);
        label.textContent = b ? (b.title || '') : ''; label.blur(); }
    });
  }

  // --- лассо B+рамка ---
  function nodesInRect(w) {
    const d = data(); if (!d) return [];
    return (d.entities || []).filter(n => {
      const s = nodeSize(n.id);
      return n.transform.x < w.x1 && n.transform.x + s.w > w.x0 &&
             n.transform.y < w.y1 && n.transform.y + s.h > w.y0;
    });
  }

  function init() {
    ensureLayer();

    document.addEventListener('keydown', e => {
      if (isEditing()) return;
      if (e.key === 'b' || e.key === 'B' || e.key === 'и' || e.key === 'И') {
        bHeld = true; boardEl.classList.add('marquee-mode');
      }
    });
    document.addEventListener('keyup', e => {
      if (e.key === 'b' || e.key === 'B' || e.key === 'и' || e.key === 'И') {
        bHeld = false; boardEl.classList.remove('marquee-mode');
      }
    });

    // capture: раньше compose, чтобы пан не стартовал под лассо
    boardEl.addEventListener('mousedown', e => {
      if (!bHeld || e.button !== 0) return;
      if (e.target.closest('.node') || e.target.closest('.block')) return;
      e.preventDefault(); e.stopPropagation();
      marquee = { sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY,
                  el: document.createElement('div') };
      marquee.el.className = 'marquee';
      boardEl.appendChild(marquee.el);
    }, true);

    layer.addEventListener('mousedown', e => {
      const blk = e.target.closest('.block');
      if (!blk) return;
      const id = blk.dataset.blockId;
      const label = blk.querySelector('.block-label');
      if (e.target.closest('.block-color')) {
        e.preventDefault(); e.stopPropagation();
        openPalette(e.target.closest('.block-color'), id);
        return;
      }
      if (e.target.closest('.block-close')) {
        e.preventDefault(); e.stopPropagation();
        deleteBlock(id);
        return;
      }
      if (label && label.isContentEditable) { e.stopPropagation(); return; }
      e.preventDefault(); e.stopPropagation();
      if (e.target.closest('.block-title')) {
        drag = { id, sx: e.clientX, sy: e.clientY, scale: currentScale(),
                 nodes: membersOf(id).map(n => ({ n, x: n.transform.x, y: n.transform.y })) };
      } else {
        Compose.setSelection(membersOf(id).map(n => n.id));
      }
    });

    document.addEventListener('mousemove', e => {
      if (marquee) {
        marquee.cx = e.clientX; marquee.cy = e.clientY;
        const x = Math.min(marquee.sx, marquee.cx), y = Math.min(marquee.sy, marquee.cy);
        const w = Math.abs(marquee.cx - marquee.sx), h = Math.abs(marquee.cy - marquee.sy);
        marquee.el.style.left = x + 'px'; marquee.el.style.top = y + 'px';
        marquee.el.style.width = w + 'px'; marquee.el.style.height = h + 'px';
        return;
      }
      if (!drag) return;
      const dx = (e.clientX - drag.sx) / drag.scale, dy = (e.clientY - drag.sy) / drag.scale;
      drag.nodes.forEach(o => {
        o.n.transform.x = Math.round(o.x + dx); o.n.transform.y = Math.round(o.y + dy);
        const el = document.querySelector('.node[data-node-id="' + o.n.id + '"]');
        if (el) el.style.transform = 'translate(' + o.n.transform.x + 'px,' + o.n.transform.y + 'px)';
      });
      Graph.renderEdges(); render();
    });

    document.addEventListener('mouseup', () => {
      if (marquee) {
        const a = Compose.toWorld(marquee.sx, marquee.sy);
        const b = Compose.toWorld(marquee.cx, marquee.cy);
        const rect = { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y),
                       x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
        marquee.el.remove(); marquee = null;
        const ids = nodesInRect(rect).map(n => n.id);
        if (ids.length) { Compose.setSelection(ids); groupSelection(); }
        return;
      }
      if (!drag) return;
      drag = null;
      Project.markDirty();
      Bus.emit('entity:moved', {});
    });

    layer.addEventListener('dblclick', e => {
      const t = e.target.closest('.block-title');
      if (!t) return;
      const blk = t.closest('.block');
      startEdit(blk.querySelector('.block-label'), blk.dataset.blockId);
    });

    ['project:created', 'project:open', 'entity:created', 'entity:moved', 'entity:moving',
     'entities:deleted', 'edge:added', 'edge:removed'].forEach(ev => Bus.on(ev, () => render()));
  }

  return { init, render, list, groupSelection, deleteBlock, setColor, PALETTE, PALETTE_NAMES };
})();