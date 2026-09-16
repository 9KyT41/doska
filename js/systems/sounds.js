const Sounds = (() => {
  let pack = null;
  function play(event) {
    if (!pack || !pack.files[event]) return;
    const a = new Audio(pack.files[event]);
    a.volume = 0.6;
    a.play().catch(() => {});
  }
  function init() {
    if (SOUNDPACKS.length) pack = SOUNDPACKS[0];
    document.addEventListener('click', () => Bus.emit('ui:click'), true);
    ['ui:click', 'project:open', 'project:save', 'node:create', 'theme:changed']
      .forEach(ev => Bus.on(ev, () => play(ev)));
  }
  return { init, setPack: p => { pack = p; } };
})();