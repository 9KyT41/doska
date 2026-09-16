// L1: сущность-нода и счётчик id, продолжающийся после открытия проекта.
const Entity = (() => {
  let seq = 0;

  function nextId(prefix) {
    seq += 1;
    return prefix + '_' + String(seq).padStart(4, '0');
  }

  function scanIds(data) {
    let max = 0;
    const see = id => {
      const m = /_(\d+)$/.exec(id || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    };
    (data.entities || []).forEach(n => {
      see(n.id);
      (n.parts || []).forEach(p => see(p.id));
    });
    (data.edges || []).forEach(e => see(e.id));
    seq = max;
  }

   function createNode(x, y) {
    return { id: nextId('e'), title: '',
             transform: { x: x, y: y }, group: null, parts: [] };
  }

  function addPart(node, type, data) {
    const def = Registry.get(type);
    const part = Object.assign(
      { id: nextId('p'), type: type },
      def ? def.defaults() : {},
      data || {}
    );
    node.parts.push(part);
    return part;
  }

  return { createNode, addPart, nextId, scanIds };
})();