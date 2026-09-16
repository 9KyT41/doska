// L2: часть «мысль» — текст мысли. Редактируется прямо на доске.
Registry.register({
  type: 'thought',
  defaults: function () {
    return { text: '', source: 'keys', createdAt: Date.now(),
             tag: null, transcriptOf: null };
  },
  render: function (part) {
    const el = document.createElement('div');
    el.className = 'part part-thought';
    el.contentEditable = 'plaintext-only';   // без богатого форматирования
    if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
    el.textContent = part.text;
    el.dataset.partId = part.id;
    return el;
  }
});