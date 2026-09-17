// L3: export. Обход графа в секции + профили излучения (D15).
// Приоритет секций: блоки с нитками → свободные цепочки → блоки без ниток → остальное.
const Export = (() => {

  function titleOf(node) {
    if (node.title && node.title.trim()) return node.title.trim();
    const t = (node.parts || []).find(p => p.type === 'thought' && (p.text || '').trim());
    if (t) {
      const s = t.text.trim().replace(/\s+/g, ' ');
      return s.length > 40 ? s.slice(0, 40) + '…' : s;
    }
    if ((node.parts || []).some(p => p.type === 'audio')) return 'голос';
    if ((node.parts || []).some(p => p.type === 'image')) return 'изображение';
    return node.id;
  }
  function firstThought(node) {
    const t = (node.parts || []).find(p => p.type === 'thought');
    return t ? (t.text || '') : '';
  }
  function isAnnotationOnly(node, edges) {
    const seq = edges.some(e => e.type === 'seq' && (e.from === node.id || e.to === node.id));
    const par = edges.some(e => e.type === 'par' && (e.from === node.id || e.to === node.id));
    const addOut = edges.some(e => e.type === 'add' && e.from === node.id);
    return addOut && !seq && !par;
  }
  function findCycles(nodes, edges) {
    const adj = {};
    nodes.forEach(n => adj[n.id] = []);
    edges.forEach(e => { if (e.type === 'seq') adj[e.from].push(e.to); });
    const color = {}, stack = [], cycles = [], inCycle = new Set();
    function dfs(id) {
      color[id] = 'gray'; stack.push(id);
      (adj[id] || []).forEach(nx => {
        if (color[nx] === 'gray') {
          const path = stack.slice(stack.indexOf(nx)).concat([nx]);
          cycles.push({ path }); path.forEach(p => inCycle.add(p));
        } else if (!color[nx]) dfs(nx);
      });
      stack.pop(); color[id] = 'black';
    }
    nodes.forEach(n => { if (!color[n.id]) dfs(n.id); });
    return { cycles, inCycle };
  }

  // par-кластеры (ансамбли) среди заданных id
  function parClusters(ids, edges) {
    const set = new Set(ids);
    const parent = {}; ids.forEach(i => parent[i] = i);
    function find(x) { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; }
    edges.forEach(e => {
      if (e.type !== 'par' || !set.has(e.from) || !set.has(e.to)) return;
      const a = find(e.from), b = find(e.to);
      if (a !== b) parent[a] = b;
    });
    const map = {};
    ids.forEach(i => { const r = find(i); (map[r] = map[r] || []).push(i); });
    return Object.values(map);
  }
  // упорядоченный список id -> шаги (par схлопнут), порядок кластеров по первой встрече
  function orderedSteps(orderedIds, edges) {
    const clusters = parClusters(orderedIds, edges);
    const pos = {}; orderedIds.forEach((id, i) => pos[id] = i);
    clusters.forEach(c => c.sort((a, b) => pos[a] - pos[b]));
    clusters.sort((a, b) => pos[a[0]] - pos[b[0]]);
    return clusters;
  }
  // порядок внутри набора по внутренним seq-ниткам (DFS от корней)
  function internalOrder(ids, edges) {
    const set = new Set(ids);
    const adj = {}; ids.forEach(i => adj[i] = []);
    const inDeg = {}; ids.forEach(i => inDeg[i] = 0);
    edges.forEach(e => {
      if (e.type !== 'seq' || !set.has(e.from) || !set.has(e.to)) return;
      adj[e.from].push({ to: e.to, order: e.order || 0 });
      inDeg[e.to]++;
    });
    ids.forEach(i => adj[i].sort((a, b) => a.order - b.order));
    const seen = new Set(), order = [];
    function dfs(id) {
      if (seen.has(id)) return;
      seen.add(id); order.push(id);
      adj[id].forEach(o => dfs(o.to));
    }
    ids.filter(i => inDeg[i] === 0).sort().forEach(dfs);
    ids.slice().sort().forEach(i => { if (!seen.has(i)) { seen.add(i); order.push(i); } });
    return order;
  }

  function compile() {
    const data = Project.getData();
    const empty = { sections: [], annEdges: [], cycles: [], cycleNodes: new Set(), byId: {},
                    stats: { sections: 0, ensembles: 0, annotations: 0, cycles: 0 }, warn: { cycles: [] } };
    if (!data) return empty;
    const nodes = data.entities || [], edges = data.edges || [];
    const byId = {}; nodes.forEach(n => byId[n.id] = n);
    const blocks = data.blocks || [];
    const annEdges = edges.filter(e => e.type === 'add');
    const annNodes = new Set(nodes.filter(n => isAnnotationOnly(n, edges)).map(n => n.id));
    const { cycles, inCycle } = findCycles(nodes, edges);
    const blockOf = id => { const n = byId[id]; return (n && n.group) ? n.group.blockId : null; };
    const membersOf = bid => nodes.filter(n => n.group && n.group.blockId === bid &&
                                                !annNodes.has(n.id) && !inCycle.has(n.id)).map(n => n.id);
    const hasSeqInside = bid => {
      const set = new Set(membersOf(bid));
      return edges.some(e => e.type === 'seq' && set.has(e.from) && set.has(e.to));
    };
    const touchedBySeq = id => edges.some(e => e.type === 'seq' && (e.from === id || e.to === id));

    const sections = [];

    // ТИР 1: блоки с внутренней последовательностью = главы по ниткам
    blocks.filter(b => hasSeqInside(b.id)).sort((a, b) => a.id.localeCompare(b.id)).forEach(b => {
      const ordered = internalOrder(membersOf(b.id), edges);
      sections.push({ title: b.title || null, steps: orderedSteps(ordered, edges) });
    });

    // ТИР 2: свободные цепочки (вне блоков), упорядоченные нитками
    const freeSet = new Set(nodes.filter(n => !blockOf(n.id) && !annNodes.has(n.id) &&
                                              !inCycle.has(n.id) && touchedBySeq(n.id)).map(n => n.id));
    const inFree = {}; freeSet.forEach(i => inFree[i] = true);
    const inDegFree = {}; freeSet.forEach(i => inDegFree[i] = 0);
    edges.forEach(e => {
      if (e.type === 'seq' && inFree[e.from] && inFree[e.to]) inDegFree[e.to]++;
    });
    const seenFree = new Set();
    function chainFrom(id) {
      const chain = [];
      (function dfs(x) {
        if (seenFree.has(x)) return;
        seenFree.add(x); chain.push(x);
        edges.filter(e => e.type === 'seq' && e.from === x && inFree[e.to])
             .sort((a, b) => (a.order || 0) - (b.order || 0))
             .forEach(e => dfs(e.to));
      })(id);
      return chain;
    }
    Array.from(freeSet).filter(i => inDegFree[i] === 0).sort().forEach(h => {
      const c = chainFrom(h);
      if (c.length) sections.push({ title: null, steps: orderedSteps(c, edges) });
    });
    Array.from(freeSet).sort().forEach(i => {
      if (!seenFree.has(i)) {
        const c = chainFrom(i);
        if (c.length) sections.push({ title: null, steps: orderedSteps(c, edges) });
      }
    });

    // ТИР 3: блоки без внутренней последовательности = главы в порядке создания
    blocks.filter(b => !hasSeqInside(b.id)).sort((a, b) => a.id.localeCompare(b.id)).forEach(b => {
      const members = membersOf(b.id).slice().sort();
      if (members.length) sections.push({ title: b.title || null, steps: orderedSteps(members, edges) });
    });

    // ТИР 4: всё остальное (мусором), в порядке создания
    const rest = nodes.filter(n => !blockOf(n.id) && !annNodes.has(n.id) && !inCycle.has(n.id) &&
                                   !touchedBySeq(n.id)).map(n => n.id).sort();
    if (rest.length) sections.push({ title: null, steps: orderedSteps(rest, edges) });

    const allSteps = sections.reduce((a, s) => a.concat(s.steps), []);
    return {
      sections, annEdges, cycles, cycleNodes: inCycle, byId,
      stats: { sections: sections.length,
               ensembles: allSteps.filter(g => g.length > 1).length,
               annotations: annEdges.length, cycles: cycles.length },
      warn: { cycles }
    };
  }

  // --- профиль: чистый текст ---
  function emitText(res) {
    const L = [];
    res.sections.forEach(sec => {
      if (sec.title) { L.push(sec.title); L.push(''); }
      sec.steps.forEach(step => {
        step.forEach(id => {
          const nd = res.byId[id];
          (nd.parts || []).forEach(p => {
            if (p.type === 'thought' && (p.text || '').trim()) L.push(p.text.trim());
          });
        });
        L.push('');
      });
    });
    res.annEdges.forEach(e => {
      const src = res.byId[e.from];
      if (!src) return;
      const t = firstThought(src).trim();
      if (t) L.push(t, '');
    });
    return L.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // --- профиль: markdown с медиа ---
  function emitNodeBody(nd, L, inEnsemble) {
    if (inEnsemble && nd.title && nd.title.trim()) L.push('**' + nd.title.trim() + '**');
    (nd.parts || []).forEach(p => {
      if (p.type === 'thought' && (p.text || '').trim()) { L.push(p.text.trim()); L.push(''); }
      else if (p.type === 'audio') {
        const dur = p.duration ? ', ' + p.duration + 's' : '';
        L.push('> 🔊 голос' + dur + ' — ' + (p.file || '[не сохранено]')); L.push('');
      }
      else if (p.type === 'image') { L.push('![изображение](' + (p.file || '[не сохранено]') + ')'); L.push(''); }
    });
  }
  function emitMarkdown(res) {
    const byId = res.byId, L = [];
    const data = Project.getData();
    L.push('# ' + ((data.meta && data.meta.name) || 'Без имени'));
    L.push('');
    res.sections.forEach(sec => {
      if (sec.title) { L.push('## ' + sec.title); L.push(''); }
      sec.steps.forEach(step => {
        if (step.length > 1) {
          L.push('### Ансамбль (вместе): ' + step.map(id => titleOf(byId[id])).join(' + '));
          L.push('');
          step.forEach(id => emitNodeBody(byId[id], L, true));
        } else {
          const nd = byId[step[0]];
          if (nd.title && nd.title.trim()) { L.push('### ' + nd.title.trim()); L.push(''); }
          emitNodeBody(nd, L, false);
        }
      });
    });
    if (res.annEdges.length) {
      L.push('---'); L.push('## Аннотации');
      res.annEdges.forEach(e => {
        const src = byId[e.from], tgt = byId[e.to];
        if (!src || !tgt) return;
        const txt = firstThought(src).replace(/\s+/g, ' ').trim() || titleOf(src);
        L.push('- к «' + titleOf(tgt) + '»: ' + txt);
      });
      L.push('');
    }
    if (res.cycles.length) {
      L.push('---'); L.push('## ⚠ Не скомпилировано: цикл');
      res.cycles.forEach(c => L.push('- цикл: ' + c.path.map(id => titleOf(byId[id])).join(' → ')));
      L.push('');
    }
    return L.join('\n');
  }

  const PROFILES = {
    text:     { label: 'Чистый текст (.txt)', ext: 'txt', enabled: true,  emit: emitText },
    markdown: { label: 'Markdown (с медиа)',  ext: 'md',  enabled: false, emit: emitMarkdown }
  };
  function menuItems() {
    return Object.keys(PROFILES).filter(k => PROFILES[k].enabled).map(k => ({
      label: PROFILES[k].label, action: () => exportProfile(k) }));
  }
  function baseName(data) {
    return (((data.meta && data.meta.name) || 'export').replace(/[\\/:*?"<>|]/g, '_'));
  }
  function downloadText(name, text) {
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function exportProfile(key) {
    const prof = PROFILES[key];
    if (!prof) return;
    const data = Project.getData();
    if (!data) return;
    const res = compile();
    const text = prof.emit(res);
    const name = baseName(data) + '.' + prof.ext;
    const saved = await Project.writeText(name, text);
    if (!saved) downloadText(name, text);
    try { await navigator.clipboard.writeText(text); } catch (e) {}
    let msg = 'Экспорт «' + prof.label + '»: секций ' + res.stats.sections +
              ', ансамблей ' + res.stats.ensembles + ', аннотаций ' + res.stats.annotations + '.';
    if (res.warn.cycles.length) msg += ' ⚠ циклов: ' + res.warn.cycles.length + '.';
    msg += ' Текст также в буфере обмена.';
    alert(msg);
    Bus.emit('project:exported', { file: name, profile: key });
  }

  return { compile, exportProfile, menuItems, PROFILES };
})();