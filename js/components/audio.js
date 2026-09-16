// L2: часть «аудио» — оригинал голоса. Плеер прямо в ноде.
Registry.register({
  type: 'audio',
  defaults: function () {
    return { file: null, url: null, duration: null };
  },
  render: function (part) {
    const wrap = document.createElement('div');
    wrap.className = 'part part-audio';
    const a = document.createElement('audio');
    a.controls = true;
    a.src = part.url || part.file || '';
    wrap.appendChild(a);
    return wrap;
  }
});