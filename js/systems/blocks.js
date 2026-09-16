// L3: blocks. Именованные цветные кластеры (рамки UE) поверх нод.
const Blocks = (() => {
  const PALETTE = ['#b3402e', '#2e7d4f', '#2b5fb3', '#7a4bbf', '#b3802e', '#2e8b8b'];
  let layer = null, worldEl = null, drag = null;

  function data() { return Project.getData(); }
  function list() { const d = data(); return (d && d.blocks) || []; }
  function ensureLayer() {
    if (layer) return layer;
    worldEl = Render.getWorld();
    layer = document.createElement('div');
    layer.className = 'blocks-layer';
    worldEl.insertBefore(layer, worldEl.firstChild);
    return layer;
  }
  function membersOf(blockId) {
    const d = data(); if (!d) return [];
    return (d.entities || []).filter(n => n.group && n.group.blockId === blockId);
  }
  function bbox(nodes) {
    if (!nodes.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      const el = document.querySelector('.node[data-node-id="' + n.id + '"]');
      const w = el ? el.offsetWidth : 200, h = el ? el.offsetHeight : 100;
      minX = Math.min(minX, n.transform.x); minY = Math.min(minY, n.transform.y);
      maxX = Math.max(maxX, n.transform.x + w); maxY = Math.max(maxY, n.transform.y + h);
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

  function render() {
    const L = ensureLayer();
    L.innerHTML = '';
    list().forEach(b => {
      const box = bbox(membersOf(b.id));
      const el = document.createElement('div');
      el.className = 'block';
      el.dataset.blockId = b.id;
      el.style.background = hexA(b.color, 0.18);
      if (box) { el.style.left = box.x + 'px'; el.style.top = box.y + 'px';
                 el.style.width = box.w + 'px'; el.style.height = box.h + 'px'; }
      else { el.style.left = '0px'; el.style.top = '0px'; el.style.width = '140px'; el.style.height = '70px'; }
      const t = document.createElement('div');
      t.className = 'block-title';
      t.style.background = b.color;
      t.textContent = b.title || ('Блок ' + b.id);
      el.appendChild(t);
      L.appendChild(el);
    });
  }

  function groupSelection(title) {
    const d = data(); if (!d) return null;
    const ids = Array.from(Compose.selected());
    if (!ids.length) { alert('Сначала выдели ноды.'); return null; }
    if (!d.blocks) d.blocks = [];
    const b = { id: Entity.nextId('b'), title: title || 'Блок', color: nextColor() };
    d.blocks.push(b);
    ids.forEach(id => { const n = d.entities.find(x => x.id === id); if (n) n.group = { blockId: b.id }; });
    Project.markDirty(); Bus.emit('block:changed', b); render();
    return b;
  }
  function addSelectionTo(blockId) {
    const d = data(); if (!d) return;
    Array.from(Compose.selected()).forEach(id => {
      const n = d.entities.find(x => x.id === id); if (n) n.group = { blockId: blockId };
    });
    Project.markDirty(); Bus.emit('block:changed', { id: blockId }); render();
  }
  function removeSelectionFromBlock() {
    const d = data(); if (!d) return;
    Array.from(Compose.selected()).forEach(id => {
      const n = d.entities.find(x => x.id === id); if (n) n.group = null;
    });
    d.blocks = (d.blocks || []).filter(b => membersOf(b.id).length);
    Project.markDirty(); Bus.emit('block:changed', {}); render();
  }
  function deleteBlock(blockId) {
    const d = data(); if (!d) return;
    (d.entities || []).forEach(n => { if (n.group && n.group.blockId === blockId) n.group = null; });
    d.blocks = (d.blocks || []).filter(b => b.id !== blockId);
    Project.markDirty(); Bus.emit('block:changed', {}); render();
  }
  function renameBlock(blockId) {
    const d = data(); if (!d) return;
    const b = (d.blocks || []).find(x => x.id === blockId); if (!b) return;
    const t = prompt('Имя блока:', b.title || '');
    if (t === null) return;
    b.title = t.trim() || b.title;
    Project.markDirty(); Bus.emit('block:changed', b); render();
  }

  function init() {
    ensureLayer();
    layer.addEventListener('mousedown', e => {
      const blk = e.target.closest('.block');
      if (!blk) return;
      e.preventDefault(); e.stopPropagation();
      const id = blk.dataset.blockId;
      if (e.target.classList.contains('block-title')) {
        drag = { id, sx: e.clientX, sy: e.clientY, scale: currentScale(),
                 nodes: membersOf(id).map(n => ({ n, x: n.transform.x, y: n.transform.y })) };
      } else {
        Compose.setSelection(membersOf(id).map(n => n.id));
      }
    });
    document.addEventListener('mousemove', e => {
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
      if (!drag) return;
      drag = null;
      Project.markDirty();
      Bus.emit('entity:moved', {});
    });
    layer.addEventListener('dblclick', e => {
      const t = e.target.closest('.block-title');
      if (t) renameBlock(t.closest('.block').dataset.blockId);
    });
    ['project:created', 'project:open', 'entity:created', 'entity:moved', 'entity:moving',
     'entities:deleted', 'edge:added', 'edge:removed'].forEach(ev => Bus.on(ev, () => render()));
  }

  return { init, render, list, groupSelection, addSelectionTo,
           removeSelectionFromBlock, deleteBlock, renameBlock };
})();