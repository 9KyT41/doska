// L3: graph. Гнёзда, рёбра, линковка, отрисовка ниток.
const Graph = (() => {
  let svg = null, worldEl = null, linking = null;

  function ensureSvg() {
    if (svg) return svg;
    worldEl = Render.getWorld();
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'edges-svg');
    worldEl.insertBefore(svg, worldEl.firstChild);
    return svg;
  }

  function nodeBox(id) {
    const data = Project.getData();
    const node = data && data.entities.find(n => n.id === id);
    if (!node) return null;
    const el = document.querySelector('.node[data-node-id="' + id + '"]');
    return { x: node.transform.x, y: node.transform.y,
             w: el ? el.offsetWidth : 200, h: el ? el.offsetHeight : 100 };
  }

  function anchor(id, type) {
    const b = nodeBox(id);
    if (!b) return { x: 0, y: 0 };
    if (type === 'seq-out') return { x: b.x + b.w, y: b.y + b.h / 2 };
    if (type === 'seq-in')  return { x: b.x,       y: b.y + b.h / 2 };
    if (type === 'par')     return { x: b.x + b.w / 2, y: b.y };
    return { x: b.x + b.w / 2, y: b.y + b.h };
  }

  function edgeAnchors(e) {
    if (e.type === 'seq') return { a: anchor(e.from, 'seq-out'), b: anchor(e.to, 'seq-in') };
    if (e.type === 'par') return { a: anchor(e.from, 'par'), b: anchor(e.to, 'par') };
    return { a: anchor(e.from, 'add'), b: anchor(e.to, 'add') };
  }

  function renderEdges() {
    const s = ensureSvg();
    s.innerHTML = '';
    const data = Project.getData();
    if (!data) return;
    (data.edges || []).forEach(e => {
      const { a, b } = edgeAnchors(e);
      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      hit.setAttribute('x1', a.x); hit.setAttribute('y1', a.y);
      hit.setAttribute('x2', b.x); hit.setAttribute('y2', b.y);
      hit.setAttribute('class', 'edge-hit');
      hit.dataset.edgeId = e.id;
      s.appendChild(hit);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
      line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
      line.setAttribute('class', 'edge edge-' + e.type);
      s.appendChild(line);
    });
  }

  function addEdge(fromId, toId, type) {
    const data = Project.getData();
    if (!data || fromId === toId) return;
    if (!data.edges) data.edges = [];
    const dup = data.edges.some(e => e.from === fromId && e.to === toId && e.type === type) ||
      (type === 'par' && data.edges.some(e => e.from === toId && e.to === fromId && e.type === 'par'));
    if (dup) return;
    let order = 1;
    if (type === 'seq') order = data.edges.filter(e => e.from === fromId && e.type === 'seq').length + 1;
    const edge = { id: Entity.nextId('ed'), from: fromId, to: toId, type: type, order: order };
    data.edges.push(edge);
    Project.markDirty();
    Bus.emit('edge:added', edge);
    renderEdges();
  }

  function removeEdge(id) {
    const data = Project.getData();
    if (!data) return;
    data.edges = (data.edges || []).filter(e => e.id !== id);
    Project.markDirty();
    Bus.emit('edge:removed', { id: id });
    renderEdges();
  }

  function startLink(nodeId, socketType) {
    const s = ensureSvg();
    const a = anchor(nodeId, socketType);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('class', 'edge-temp');
    line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
    line.setAttribute('x2', a.x); line.setAttribute('y2', a.y);
    s.appendChild(line);
    linking = { fromId: nodeId, type: socketType, temp: line };
  }

  function moveLink(e) {
    if (!linking) return;
    const w = Compose.toWorld(e.clientX, e.clientY);
    const a = anchor(linking.fromId, linking.type);
    linking.temp.setAttribute('x1', a.x); linking.temp.setAttribute('y1', a.y);
    linking.temp.setAttribute('x2', w.x); linking.temp.setAttribute('y2', w.y);
  }

  function endLink(e) {
    if (!linking) return;
    const fromId = linking.fromId, type = linking.type;
    if (linking.temp) linking.temp.remove();
    linking = null;
    const target = e.target.closest ? e.target.closest('.node') : null;
    if (!target) return;
    const toId = target.dataset.nodeId;
    if (type === 'seq-out') addEdge(fromId, toId, 'seq');
    else if (type === 'seq-in') addEdge(toId, fromId, 'seq');
    else if (type === 'par') addEdge(fromId, toId, 'par');
    else if (type === 'add') addEdge(fromId, toId, 'add');
  }

  function init() {
    ensureSvg();
    worldEl.addEventListener('mousedown', e => {
      const sock = e.target.closest('.socket');
      if (!sock) return;
      e.preventDefault();
      e.stopPropagation();
      startLink(sock.dataset.nodeId, sock.dataset.socket);
    });
    document.addEventListener('mousemove', moveLink);
    document.addEventListener('mouseup', endLink);
    svg.addEventListener('dblclick', e => {
      const hit = e.target.closest('.edge-hit');
      if (hit && hit.dataset.edgeId) removeEdge(hit.dataset.edgeId);
    });
    ['project:created', 'project:open', 'entity:created', 'entity:moved',
     'entity:moving', 'entities:deleted', 'edge:added', 'edge:removed']
      .forEach(ev => Bus.on(ev, () => renderEdges()));
  }

  return { init, renderEdges, addEdge, removeEdge };
})();