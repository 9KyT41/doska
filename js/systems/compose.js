// L3: compose-движок. v0: выделение и удаление. Драг и граф — позже.
const Compose = (() => {
  const sel = new Set();

  function elOf(id) {
    return document.querySelector('.node[data-node-id="' + id + '"]');
  }
  function setSel(id, on) {
    if (on) sel.add(id); else sel.delete(id);
    const el = elOf(id);
    if (el) el.classList.toggle('sel', on);
  }
  function clearSel() {
    Array.from(sel).forEach(id => setSel(id, false));
    sel.clear();
  }

  function deleteNodes(ids) {
    const data = Project.getData();
    if (!data || !ids.length) return;
    const set = new Set(ids);
    data.entities = (data.entities || []).filter(n => !set.has(n.id));
    data.edges = (data.edges || []).filter(e => !set.has(e.from) && !set.has(e.to));
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
    if (!confirm('Удалить пустых нод: ' + empty.length + '?')) return;
    deleteNodes(empty.map(n => n.id));
  }

  function isEditing() {
    const a = document.activeElement;
    return a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
  }

  function init() {
    document.getElementById('board').addEventListener('mousedown', e => {
      const nodeEl = e.target.closest('.node');
      if (!nodeEl) { clearSel(); return; }
      const id = nodeEl.dataset.nodeId;
      if (e.ctrlKey) { setSel(id, !sel.has(id)); }
      else if (!sel.has(id)) { clearSel(); setSel(id, true); }
    });
    document.addEventListener('keydown', e => {
      if (isEditing()) return;   // внутри ноды Delete удаляет буквы, не ноду
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size) {
        e.preventDefault();
        deleteSelected();
      }
    });
  }

  return { init, deleteSelected, deleteEmpty, deleteNodes, selected: () => sel };
})();