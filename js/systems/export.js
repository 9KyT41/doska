// L3: export. Детерминированный обход графа + излучатель markdown (D15).
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

  function compile() {
    const data = Project.getData();
    if (!data) return { md: '', warn: { cycles: [] }, stats: null };
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

    const md = emit(data, steps, annEdges, cycles, inCycle, byId);
    return {
      md,
      warn: { cycles },
      stats: {
        steps: steps.length,
        ensembles: steps.filter(g => g.length > 1).length,
        annotations: annEdges.length,
        cycles: cycles.length,
        fragments: roots.length + frags.length
      }
    };
  }

  function emit(data, steps, annEdges, cycles, cycleNodes, byId) {
    const L = [];
    L.push('# ' + ((data.meta && data.meta.name) || 'Без имени'));
    L.push('');
    let n = 0;
    steps.forEach(group => {
      n++;
      if (group.length > 1) {
        L.push('## ' + n + '. Ансамбль (вместе): ' + group.map(id => titleOf(byId[id])).join(' + '));
      } else {
        L.push('## ' + n + '. ' + titleOf(byId[group[0]]));
      }
      group.forEach(id => {
        const node = byId[id];
        if (group.length > 1) { L.push(''); L.push('**' + titleOf(node) + '**'); }
        (node.parts || []).forEach(p => {
          if (p.type === 'thought' && (p.text || '').trim()) { L.push(''); L.push(p.text.trim()); }
          else if (p.type === 'audio') {
            const dur = p.duration ? ', ' + p.duration + 's' : '';
            L.push(''); L.push('> 🔊 голос' + dur + ' — ' + (p.file || '[не сохранено]'));
          }
          else if (p.type === 'image') {
            L.push(''); L.push('![изображение](' + (p.file || '[не сохранено]') + ')');
          }
        });
      });
      L.push('');
    });
    if (annEdges.length) {
      L.push('---'); L.push('## Аннотации');
      annEdges.forEach(e => {
        const src = byId[e.from], tgt = byId[e.to];
        if (!src || !tgt) return;
        const txt = firstThought(src).replace(/\s+/g, ' ').trim() || titleOf(src);
        L.push('- к «' + titleOf(tgt) + '»: ' + txt);
      });
      L.push('');
    }
    if (cycles.length) {
      L.push('---'); L.push('## ⚠ Не скомпилировано: цикл');
      cycles.forEach(c => L.push('- цикл: ' + c.path.map(id => titleOf(byId[id])).join(' → ')));
      L.push('');
      Array.from(cycleNodes).sort().forEach(id => {
        const node = byId[id]; if (!node) return;
        L.push('**' + titleOf(node) + '** (порядок не определён)');
        (node.parts || []).forEach(p => {
          if (p.type === 'thought' && (p.text || '').trim()) { L.push(''); L.push(p.text.trim()); }
        });
        L.push('');
      });
    }
    return L.join('\n');
  }

  function downloadText(name, text) {
    const blob = new Blob([text], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function exportMarkdown() {
    const res = compile();
    const data = Project.getData();
    const name = (((data && data.meta.name) || 'export').replace(/[\\/:*?"<>|]/g, '_')) + '.md';
    const saved = await Project.writeText(name, res.md);
    if (!saved) downloadText(name, res.md);
    let msg = 'Экспорт: шагов ' + res.stats.steps +
              ', ансамблей ' + res.stats.ensembles +
              ', аннотаций ' + res.stats.annotations + '.';
    if (res.warn.cycles.length) msg += ' ⚠ циклов: ' + res.warn.cycles.length + ' (имена — в секции файла).';
    alert(msg);
    Bus.emit('project:exported', { file: name });
  }

  return { compile, exportMarkdown };
})();