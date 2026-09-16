// L3: рендер. Ноды read-only по умолчанию; dblclick правит; ноды живут в #world.
const Render = (() => {
  let boardEl = null, worldEl = null;
  const nodeEls = new Map();

  function makeEditable(el) {
    el.contentEditable = 'plaintext-only';
    if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
  }

  function titleElement(node) {
    const t = document.createElement('div');
    t.className = 'node-title';
    t.contentEditable = 'false';
    t.textContent = node.title || '';
    t.dataset.nodeId = node.id;
    t.addEventListener('dblclick', () => { makeEditable(t); t.focus(); });
    return t;
  }

    function socketTitle(st) {
    return { 'seq-in': 'до', 'seq-out': 'после', 'par': 'вместе', 'add': 'доп' }[st] || '';
  }

  function rebuildNode(el, node) {
    el.innerHTML = '';
    const grip = document.createElement('div');
    grip.className = 'node-grip';
    const dot = document.createElement('span');
    dot.className = 'node-grip-dot';
    dot.textContent = '⠿';
    grip.appendChild(dot);
    grip.appendChild(titleElement(node));
    el.appendChild(grip);
    node.parts.forEach(part => {
      const def = Registry.get(part.type);
      if (def) {
        const pel = def.render(part);
        if (pel.classList.contains('part-thought')) {
          pel.contentEditable = 'false';
          pel.addEventListener('dblclick', () => { makeEditable(pel); pel.focus(); });
        }
        el.appendChild(pel);
      } else {
        const u = document.createElement('div');
        u.className = 'part part-unknown';
        u.textContent = '[часть: ' + part.type + ']';
        el.appendChild(u);
      }
    });
    ['seq-in', 'seq-out', 'par', 'add'].forEach(st => {
      const s = document.createElement('div');
      s.className = 'socket';
      s.dataset.socket = st;
      s.dataset.nodeId = node.id;
      s.title = socketTitle(st);
      el.appendChild(s);
    });
  }

  function editPart(node, type) {
    const el = nodeEls.get(node.id);
    if (!el) return;
    const target = type === 'thought'
      ? el.querySelector('.part-thought')
      : el.querySelector('.node-title');
    if (target) { makeEditable(target); target.focus(); }
  }

  function nodeElement(node) {
    let el = nodeEls.get(node.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'node';
      el.dataset.nodeId = node.id;
      worldEl.appendChild(el);
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
    worldEl = document.createElement('div');
    worldEl.id = 'world';
    boardEl.appendChild(worldEl);

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

    boardEl.addEventListener('focusout', e => {
      if (e.target.classList &&
          (e.target.classList.contains('part-thought') ||
           e.target.classList.contains('node-title'))) {
        e.target.contentEditable = 'false';
      }
    });

    Bus.on('project:created', d => { Entity.scanIds(d.data); renderAll(d.data); });
    Bus.on('project:open',    d => { Entity.scanIds(d.data); renderAll(d.data); });
    Bus.on('entity:created',  node => nodeElement(node));
    Bus.on('entity:changed',  node => {
      const el = nodeEls.get(node.id);
      if (el) rebuildNode(el, node);
    });
  }

  return { init, renderAll, nodeElement, editPart, getWorld: () => worldEl };
})();