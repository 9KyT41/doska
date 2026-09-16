// L1: реестр типов частей. Тип части умеет рождаться, рисоваться и правиться.
const Registry = (() => {
  const types = {};
  return {
    register(def) { types[def.type] = def; },
    get(type) { return types[type]; },
    has(type) { return !!types[type]; }
  };
})();