// L2: часть «картинка» — изображение в ноде.
Registry.register({
  type: 'image',
  defaults: function () {
    return { file: null, url: null, caption: null };
  },
  render: function (part) {
    const wrap = document.createElement('div');
    wrap.className = 'part part-image';
    if (part.url || part.file) {
      const img = document.createElement('img');
      img.className = 'part-image-img';

      const loadFromFile = async () => {
        if (!part.file) return;
        const url = await Project.readMedia(part.file);
        if (url) { img.src = url; return; }
        img.src = part.file;
      };

      if (part.url) img.src = part.url;
      else loadFromFile();

      img.onerror = () => {
        if (img.dataset.fallback !== '1') {
          img.dataset.fallback = '1';
          loadFromFile();
        }
      };
      wrap.appendChild(img);
    } else {
      const s = document.createElement('span');
      s.className = 'part-image-missing';
      s.textContent = '[картинка не сохранена]';
      wrap.appendChild(s);
    }
    return wrap;
  }
});