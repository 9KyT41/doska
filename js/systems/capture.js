// L3: capture-движок. 2a: клава (N…Enter) и paste. A1: ноль лишних решений.
const Capture = (() => {

  function freeSpot(data) {
    // спираль от центра экрана: ноды не падают друг на друга
    const cx = window.innerWidth / 2 - 100;
    const cy = window.innerHeight / 2 - 40;
    const n = (data.entities || []).length;
    const angle = n * 2.4;
    const r = 40 + 34 * Math.sqrt(n);
    return { x: Math.round(cx + r * Math.cos(angle)),
             y: Math.round(cy + r * Math.sin(angle)) };
  }

  function newThoughtNode(text, source) {
    const data = Project.getData();
    if (!data) return null;
    const pos = freeSpot(data);
    const node = Entity.createNode(pos.x, pos.y);
    Entity.addPart(node, 'thought', { text: text, source: source });
    data.entities.push(node);
    Bus.emit('entity:created', node);
    Project.markDirty();
    return node;
  }

  function startEditing(node) {
    const el = document.querySelector(
      '.node[data-node-id="' + node.id + '"] .part-thought');
    if (el) el.focus();
  }

  function isEditing() {
    const a = document.activeElement;
    return a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
  }

  function init() {
    document.addEventListener('keydown', e => {
      if (isEditing()) {
        if (e.key === 'Enter' && !e.shiftKey) {
          if (e.target.classList.contains('node-title')) {
            e.preventDefault();
            const body = e.target.parentElement.querySelector('.part-thought');
            if (body) body.focus();
          } else if (e.target.classList.contains('part-thought')) {
            e.preventDefault();
            e.target.blur();
          }
        }
        return;
      }
      if (e.key === 'n' || e.key === 'N' || e.key === 'т' || e.key === 'Т') {
        e.preventDefault();
        const node = newThoughtNode('', 'keys');
        if (node) startEditing(node);
      }
    });

    document.addEventListener('paste', e => {
      if (isEditing()) return;   // внутри ноды paste ведёт себя как обычный
      const text = (e.clipboardData || window.clipboardData).getData('text');
      if (text && text.trim()) {
        e.preventDefault();
        newThoughtNode(text.trim(), 'paste');
      }
    });
  }

  return { init, newThoughtNode, startEditing };
})();