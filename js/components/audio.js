// L2: часть «аудио» — оригинал голоса. Плеер прямо в ноде.
Registry.register({
  type: 'audio',
  defaults: function () {
    return { file: null, url: null, duration: null };
  },
  render: function (part) {
    const wrap = document.createElement('div');
    wrap.className = 'part part-audio';
    if (part.url || part.file) {
      const a = document.createElement('audio');
      a.controls = true;

      const loadFromFile = async () => {
        if (!part.file) return;
        const url = await Project.readMedia(part.file);   // спрашиваем папку проекта
        if (url) { a.src = url; return; }
        a.src = part.file;                                 // последний шанс: относительный путь
      };

      if (part.url) a.src = part.url;                      // живой blob этой сессии
      else loadFromFile();

      a.addEventListener('error', () => {
        if (a.dataset.fallback !== '1') {
          a.dataset.fallback = '1';
          loadFromFile();
        }
      });
      wrap.appendChild(a);
    } else {
      const s = document.createElement('span');
      s.className = 'part-audio-missing';
      s.textContent = '[аудио не сохранено]';
      wrap.appendChild(s);
    }
    return wrap;
  }
});