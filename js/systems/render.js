// L3: рендер. Ноды из данных -> DOM доски. При вводе текста перерисовки нет.
const Render = (() => {
  let boardEl = null;
  const nodeEls = new Map();

  function titleElement(node) {
    const t = document.createElement('div');
    t.className = 'node-title';
    t.contentEditable = 'plaintext-only';
    if (t.contentEditable !== 'plaintext-only') t.contentEditable = 'true';
    t.textContent = node.title || '';
    t.dataset.nodeId = node.id;
    return t;
  }

  function rebuildNode(el, node) {
    el.innerHTML = '';
    el.appendChild(titleElement(node));
    node.parts.forEach(part => {
      const def = Registry.get(part.type);
      if (def) {
        el.appendChild(def.render(part));
      } else {
        const u = document.createElement('div');
        u.className = 'part part-unknown';
        u.textContent = '[часть: ' + part.type + ']';
        el.appendChild(u);
      }
    });
  }

  function nodeElement(node) {
    let el = nodeEls.get(node.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'node';
      el.dataset.nodeId = node.id;
      boardEl.appendChild(el);
      nodeEls.set(node.id, el);
      rebuildNode(el, node);
    }
    el.style.transform = 'translate(' + node.transform.x + 'px,' +
                          node.transform.y + 'px)';
    return el;
  }

  function renderAll(data) {
    nodeEls.forEach(el => el.remove());
    nodeEls.clear();
    if (!data) return;
    (data.entities || []).forEach(node => nodeElement(node));
  }

  function init(board) {
    boardEl = board;

    boardEl.addEventListener('input', e => {
      const data = Project.getData();
      if (!data) return;
      if (e.target.classList.contains('node-title')) {
        const node = data.entities.find(n => n.id === e.target.dataset.nodeId);
        if (node) { node.title = e.target.textContent; Project.markDirty(); }
        return;
      }
      const partEl = e.target.closest('.part');
      if (!partEl || !partEl.dataset.partId) return;
      const nodeEl = partEl.closest('.node');
      const node = data.entities.find(n => n.id === nodeEl.dataset.nodeId);
      if (!node) return;
      const part = node.parts.find(p => p.id === partEl.dataset.partId);
      if (!part) return;
      part.text = partEl.textContent;
      Project.markDirty();
    });

    Bus.on('project:created', d => { Entity.scanIds(d.data); renderAll(d.data); });
    Bus.on('project:open',    d => { Entity.scanIds(d.data); renderAll(d.data); });
    Bus.on('entity:created',  node => nodeElement(node));
    Bus.on('entity:changed',  node => {
      const el = nodeEls.get(node.id);
      if (el) rebuildNode(el, node);
    });
  }

  return { init, renderAll, nodeElement };
})();