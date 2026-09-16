const Themes = (() => {
  function apply(id) {
    const theme = THEMES.find(t => t.id === id) || THEMES[0];
    let link = document.getElementById('theme');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'stylesheet'; link.id = 'theme';
      document.head.appendChild(link);
    }
    link.href = theme.file;
    try { localStorage.setItem('doska.theme', theme.id); } catch (e) {}
    Bus.emit('theme:changed', { id: theme.id });
  }
  function init() {
    const sel = document.getElementById('theme-select');
    if (sel) {
      THEMES.forEach(t => {
        const o = document.createElement('option');
        o.value = t.id; o.textContent = t.name;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => apply(sel.value));
    }
    let saved = null;
    try { saved = localStorage.getItem('doska.theme'); } catch (e) {}
    apply(saved && THEMES.some(t => t.id === saved) ? saved : THEMES[0].id);
  }
  return { init, apply };
})();