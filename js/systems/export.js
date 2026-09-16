// L3: export. Один детерминированный обход графа + сменные профили излучения (D15).
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
  function seqOut(node, edges) {
    return edges.filter(e => e.type === 'seq' && e.from === node.id)
                .sort((a, b) => (a.order || 0) - (b.order || 0));
  }
  function parPartners(id, edges) {
    const out = [];
    edges.forEach(e => {
      if (e.type !== 'par') return;
      if (e.from === id) out.push(e.to);
      else if (e.to === id) out.push(e.from);
    });
    return out;
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
          cycles.push({ path });
          path.forEach(p => inCycle.add(p));
        } else if (!color[nx]) dfs(nx);
      });
      stack.pop(); color[id] = 'black';
    }
    nodes.forEach(n => { if (!color[n.id]) dfs(n.id); });
    return { cycles, inCycle };
  }

  // --- общий обход (не зависит от профиля) ---
  function compile() {
    const data = Project.getData();
    const empty = { steps: [], annEdges: [], cycles: [], cycleNodes: new Set(),
                    byId: {}, stats: { steps: 0, ensembles: 0, annotations: 0, cycles: 0, fragments: 0 },
                    warn: { cycles: [] } };
    if (!data) return empty;
    const nodes = data.entities || [], edges = data.edges || [];
    const byId = {}; nodes.forEach(n => byId[n.id] = n);
    const annEdges = edges.filter(e => e.type === 'add');
    const annNodes = new Set(nodes.filter(n => isAnnotationOnly(n, edges)).map(n => n.id));
    const { cycles, inCycle } = findCycles(nodes, edges);

    const visited = new Set(), steps = [];
    function ensembleOf(id) {
      const group = [id], seen = new Set([id]), stack = [id];
      while (stack.length) {
        const cur = stack.pop();
        parPartners(cur, edges).forEach(pid => {
          if (!seen.has(pid) && byId[pid] && !visited.has(pid) && !inCycle.has(pid)) {
            seen.add(pid); group.push(pid); stack.push(pid);
          }
        });
      }
      group.sort();
      group.sort((a, b) => (a === id ? -1 : b === id ? 1 : 0));
      return group;
    }
    function visit(id) {
      if (visited.has(id) || inCycle.has(id) || !byId[id]) return;
      const group = ensembleOf(id);
      group.forEach(g => visited.add(g));
      steps.push(group);
      group.forEach(g => seqOut(byId[g], edges).forEach(e => {
        if (!inCycle.has(e.to)) visit(e.to);
      }));
    }
    const incomingSeq = new Set(edges.filter(e => e.type === 'seq').map(e => e.to));
    const roots = nodes.filter(n => !incomingSeq.has(n.id) && !annNodes.has(n.id) && !inCycle.has(n.id))
                       .map(n => n.id).sort();
    roots.forEach(visit);
    const frags = nodes.filter(n => !visited.has(n.id) && !annNodes.has(n.id) && !inCycle.has(n.id))
                       .map(n => n.id).sort();
    frags.forEach(visit);

    return {
      steps, annEdges, cycles, cycleNodes: inCycle, byId,
      stats: { steps: steps.length, ensembles: steps.filter(g => g.length > 1).length,
               annotations: annEdges.length, cycles: cycles.length,
               fragments: roots.length + frags.length },
      warn: { cycles }
    };
  }

  // --- профиль: чистый текст (в Word) ---
  function emitText(res) {
    const L = [];
    res.steps.forEach(group => {
      group.forEach(id => {
        const nd = res.byId[id];
        (nd.parts || []).forEach(p => {
          if (p.type === 'thought' && (p.text || '').trim()) L.push(p.text.trim());
          // audio: его расшифровка уже есть частью-мыслью выше -> ничего не дублируем
          // image: в текстовом профиле игнорируется
        });
      });
      L.push('');
    });
    res.annEdges.forEach(e => {
      const src = res.byId[e.from];
      if (!src) return;
      const t = firstThought(src).trim();
      if (t) L.push(t, '');
    });
    return L.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // --- профиль: markdown с медиа (выключен, вернётся позже) ---
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
    let n = 0;
    res.steps.forEach(group => {
      if (group.length > 1) {
        n++;
        const titled = group.map(id => byId[id]).filter(nd => nd.title && nd.title.trim());
        L.push('## ' + n + '. Ансамбль (вместе)' +
               (titled.length ? ': ' + titled.map(t => t.title.trim()).join(' + ') : ''));
        L.push('');
        group.forEach(id => emitNodeBody(byId[id], L, true));
      } else {
        const nd = byId[group[0]];
        if (nd.title && nd.title.trim()) {
          n++; L.push('## ' + n + '. ' + nd.title.trim()); L.push('');
          emitNodeBody(nd, L, false);
        } else emitNodeBody(nd, L, false);
      }
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

  // --- реестр профилей: новый профиль = одна запись, меню строится само ---
  const PROFILES = {
    text:     { label: 'Чистый текст (txt)', ext: 'txt', enabled: true,  emit: emitText },
    markdown: { label: 'Markdown (с медиа)',    ext: 'md',  enabled: false, emit: emitMarkdown }
  };

  function menuItems() {
    return Object.keys(PROFILES).filter(k => PROFILES[k].enabled).map(k => ({
      label: PROFILES[k].label,
      action: () => exportProfile(k)
    }));
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
    let msg = 'Экспорт «' + prof.label + '»: шагов ' + res.stats.steps + '.';
    if (res.warn.cycles.length) msg += ' ⚠ циклов: ' + res.warn.cycles.length + '.';
    msg += ' Текст также в буфере обмена.';
    alert(msg);
    Bus.emit('project:exported', { file: name, profile: key });
  }

  return { compile, exportProfile, menuItems, PROFILES };
})();