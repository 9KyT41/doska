// L4: иерархическое меню за [☰]. Единственная точка входа в функции (D8).
// v2: hover-аккордеон — на уровне открыта только одна ветка; подменю столбиком.
const Menu = (() => {
  let root = null, panel = null, open = false, tree = [];

  function build() {
    root = document.createElement('button');
    root.className = 'menu-button';
    root.textContent = '☰';
    root.title = 'Меню';
    root.addEventListener('click', toggle);

    panel = document.createElement('div');
    panel.className = 'menu-panel';
    panel.hidden = true;

    document.body.appendChild(root);
    document.body.appendChild(panel);
  }

  function openWrap(wrap) {
    const parent = wrap.parentElement;
    parent.querySelectorAll(':scope > .menu-wrap.open').forEach(w => {
      if (w !== wrap) w.classList.remove('open');
    });
    wrap.classList.add('open');
  }

  function renderItem(item) {
    if (item.children) {
      const wrap = document.createElement('div');
      wrap.className = 'menu-wrap';

      const head = document.createElement('button');
      head.className = 'menu-item menu-head';
      head.textContent = item.label;
      head.addEventListener('mouseenter', () => openWrap(wrap));
      head.addEventListener('click', () => wrap.classList.toggle('open'));
      wrap.appendChild(head);

      const sub = document.createElement('div');
      sub.className = 'submenu';
      item.children.forEach(ch => sub.appendChild(renderItem(ch)));
      wrap.appendChild(sub);

      wrap.addEventListener('mouseleave', () => wrap.classList.remove('open'));
      return wrap;
    }
    const b = document.createElement('button');
    b.className = 'menu-item';
    b.textContent = item.label;
    b.addEventListener('click', () => {
      close();
      if (item.action) item.action();
    });
    return b;
  }

  function render() {
    panel.innerHTML = '';
    tree.forEach(item => panel.appendChild(renderItem(item)));
  }

  function show() {
    open = true;
    render();
    panel.hidden = false;
    root.classList.add('open');
    Bus.emit('menu:opened');
  }
  function close() {
    open = false;
    panel.hidden = true;
    root.classList.remove('open');
    Bus.emit('menu:closed');
  }
  function toggle() { open ? close() : show(); }

  function init() {
    build();
    document.addEventListener('click', e => {
      if (open && !panel.contains(e.target) && e.target !== root) close();
    });
  }

  return {
    init,
    setTree(t) { tree = t; if (open) render(); },
    show, close
  };
})();