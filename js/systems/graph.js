// L3: graph. Гнёзда, рёбра, линковка, гибкие нитки-кривые.
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

  // точка гнезда + нормаль наружу (куда нитка выходит)
  function anchorN(id, type) {
    const b = nodeBox(id);
    if (!b) return { x: 0, y: 0, nx: 1, ny: 0 };
    if (type === 'seq-out') return { x: b.x + b.w,   y: b.y + b.h / 2, nx:  1, ny: 0 };
    if (type === 'seq-in')  return { x: b.x,         y: b.y + b.h / 2, nx: -1, ny: 0 };
    if (type === 'par')     return { x: b.x + b.w/2, y: b.y,           nx:  0, ny:-1 };
    return { x: b.x + b.w / 2, y: b.y + b.h, nx: 0, ny: 1 };
  }

  function relOf(socketType) {
    if (socketType === 'seq-in' || socketType === 'seq-out') return 'seq';
    if (socketType === 'par') return 'par';
    return 'add';
  }

  function edgeSockets(e) {
    if (e.type === 'seq') return ['seq-out', 'seq-in'];
    if (e.type === 'par') return ['par', 'par'];
    return ['add', 'add'];
  }

  function curvePath(a, b) {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const k = Math.max(40, Math.min(160, dist * 0.4));
    return 'M ' + a.x + ' ' + a.y +
      ' C ' + (a.x + a.nx * k) + ' ' + (a.y + a.ny * k) + ', ' +
              (b.x + b.nx * k) + ' ' + (b.y + b.ny * k) + ', ' + b.x + ' ' + b.y;
  }

  function renderEdges() {
    const s = ensureSvg();
    s.innerHTML = '';
    const data = Project.getData();
    if (!data) return;
    (data.edges || []).forEach(e => {
      const sk = edgeSockets(e);
      const d = curvePath(anchorN(e.from, sk[0]), anchorN(e.to, sk[1]));
      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hit.setAttribute('d', d);
      hit.setAttribute('class', 'edge-hit');
      hit.dataset.edgeId = e.id;
      s.appendChild(hit);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      line.setAttribute('d', d);
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
    const a = anchorN(nodeId, socketType);
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('class', 'edge-temp edge-temp-' + relOf(socketType));
    p.setAttribute('d', 'M ' + a.x + ' ' + a.y + ' L ' + a.x + ' ' + a.y);
    s.appendChild(p);
    linking = { fromId: nodeId, type: socketType, temp: p, a: a };
  }

  function moveLink(e) {
    if (!linking) return;
    const w = Compose.toWorld(e.clientX, e.clientY);
    const a = linking.a;
    const dist = Math.hypot(w.x - a.x, w.y - a.y);
    const k = Math.max(30, Math.min(140, dist * 0.4));
    linking.temp.setAttribute('d',
      'M ' + a.x + ' ' + a.y +
      ' C ' + (a.x + a.nx * k) + ' ' + (a.y + a.ny * k) + ', ' + w.x + ' ' + w.y + ', ' + w.x + ' ' + w.y);
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
      e.stopPropagation();   // событие не доходит до compose — вид не сбрасывается
      const hit = e.target.closest('.edge-hit');
      if (hit && hit.dataset.edgeId) removeEdge(hit.dataset.edgeId);
    });
    ['project:created', 'project:open', 'entity:created', 'entity:moved',
     'entity:moving', 'entities:deleted', 'edge:added', 'edge:removed']
      .forEach(ev => Bus.on(ev, () => renderEdges()));
  }

  return { init, renderEdges, addEdge, removeEdge };
})();