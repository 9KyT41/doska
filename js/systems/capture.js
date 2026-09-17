// L3: capture-движок. Клава (N…Enter), paste, голос (зажал микрофон),
// картинки (drop/paste). Новые ноды рождаются под курсором.
const Capture = (() => {
  let pill = null;
  let state = 'idle';
  let cancelRequested = false;
  let pendingDiscard = false;
  let rec = null;
  let bound = false;
  let lastPointer = null;
  let voiceSpawn = 'cursor';
  const pendingMedia = [];

  function freeSpot(data) {
    const c = Compose.toWorld(window.innerWidth / 2, window.innerHeight / 2);
    const cx = c.x - 100, cy = c.y - 40;
    const n = (data.entities || []).length;
    const angle = n * 2.4;
    const r = 40 + 34 * Math.sqrt(n);
    return { x: Math.round(cx + r * Math.cos(angle)),
             y: Math.round(cy + r * Math.sin(angle)) };
  }

  // спавн под курсором; если точка занята — каскадом по диагонали до свободной
  function spawnPoint(data, cx, cy) {
    const w = Compose.toWorld(cx, cy);
    let x = Math.round(w.x - 110), y = Math.round(w.y - 40);
    const occupied = (px, py) => (data.entities || []).some(n => {
      const el = document.querySelector('.node[data-node-id="' + n.id + '"]');
      const nw = el ? el.offsetWidth : 220, nh = el ? el.offsetHeight : 120;
      return px < n.transform.x + nw && px + 220 > n.transform.x &&
             py < n.transform.y + nh && py + 120 > n.transform.y;
    });
    let guard = 0;
    while (occupied(x, y) && guard < 40) { x += 28; y += 28; guard++; }
    return { x: x, y: y };
  }
  function hereOrCenter(data) {
    return lastPointer ? spawnPoint(data, lastPointer.x, lastPointer.y) : freeSpot(data);
  }

  function newThoughtNode(text, source) {
    const data = Project.getData();
    if (!data) return null;
    const pos = hereOrCenter(data);
    const node = Entity.createNode(pos.x, pos.y);
    Entity.addPart(node, 'thought', { text: text, source: source });
    data.entities.push(node);
    Bus.emit('entity:created', node);
    Project.markDirty();
    return node;
  }

  function addThoughtToNode(node, text, source) {
    Entity.addPart(node, 'thought', { text: text, source: source });
    Bus.emit('entity:changed', node);
    Project.markDirty();
  }

  function startEditing(node) {
    Render.editPart(node, 'thought');
  }

  function isEditing() {
    const a = document.activeElement;
    return a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
  }

  // --- картинки ---
  async function addImagePart(node, file) {
    const url = URL.createObjectURL(file);
    const image = Entity.addPart(node, 'image', {
      url: url, file: null, caption: null });
    Bus.emit('entity:changed', node);
    Project.markDirty();
    const ext = (file.name.split('.pop').pop() || 'png').toLowerCase();
    pendingMedia.push({ part: image, blob: file, name: 'i_' + image.id + '.' + ext });
    flushMedia();
  }

  async function imagesFromFiles(files, targetNode, cx, cy) {
    const data = Project.getData();
    if (!data) return;
    const imgs = Array.from(files).filter(f => f.type && f.type.startsWith('image/'));
    if (!imgs.length) return;
    if (targetNode) {
      for (const f of imgs) await addImagePart(targetNode, f);
      return;
    }
    for (const f of imgs) {
      const pos = (cx != null) ? spawnPoint(data, cx, cy) : hereOrCenter(data);
      const node = Entity.createNode(pos.x, pos.y);
      data.entities.push(node);
      Bus.emit('entity:created', node);
      await addImagePart(node, f);
    }
  }

  function selectedNode() {
    const sel = Compose.selected();
    if (sel.size !== 1) return null;
    const data = Project.getData();
    return (data && data.entities.find(n => n.id === Array.from(sel)[0])) || null;
  }

  // --- пилюля и её состояния ---
  function setPill(mode) {
    if (!pill) return;
    pill.classList.remove('rec', 'starting');
    if (mode === 'rec') {
      pill.classList.add('rec');
      pill.textContent = '● слушаю — отпусти';
    } else if (mode === 'starting') {
      pill.classList.add('starting');
      pill.textContent = '…разрешаю микрофон';
    } else {
      pill.textContent = '🎙 держи — говори — отпусти';
    }
  }

  function buildMic() {
    const p = document.createElement('button');
    p.className = 'mic-pill';
    p.addEventListener('mousedown', e => { e.preventDefault(); onHoldStart('pill'); });
    p.addEventListener('mouseup', onHoldEnd);
    p.addEventListener('mouseleave', onHoldEnd);
    document.body.appendChild(p);
    return p;
  }

   function onHoldStart(src) {
    voiceSpawn = (src === 'pill') ? 'center' : 'cursor';
    if (state !== 'idle') return;
    state = 'starting';
    cancelRequested = false;
    setPill('starting');
    startVoice();
  }

  function onHoldEnd() {
    if (state === 'recording') stopVoice(false);
    else if (state === 'starting') cancelRequested = true;
  }

  // --- голос ---
  async function startVoice() {
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      state = 'idle'; setPill('idle');
      alert('Нет доступа к микрофону: ' + e.message);
      return;
    }
    if (state !== 'starting') {
      stream.getTracks().forEach(t => t.stop());
      state = 'idle'; setPill('idle');
      return;
    }
    const data = Project.getData();
    if (!data) {
      stream.getTracks().forEach(t => t.stop());
      state = 'idle'; setPill('idle');
      return;
    }
    try {
      const pos = (voiceSpawn === 'center')
      ? spawnPoint(data, window.innerWidth / 2, window.innerHeight / 2)
      : hereOrCenter(data);
      const node = Entity.createNode(pos.x, pos.y);
      const thought = Entity.addPart(node, 'thought', { text: '', source: 'voice' });
      data.entities.push(node);
      Bus.emit('entity:created', node);

      const chunks = [];
      const mediaRec = new MediaRecorder(stream);
      mediaRec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      mediaRec.onstop = () => finishVoice(node, thought, chunks, stream);
      mediaRec.start();

      let finalText = '';
      let recog = null;
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SR) {
        recog = new SR();
        recog.lang = 'ru-RU';
        recog.interimResults = true;
        recog.continuous = true;
        recog.onresult = ev => {
          let interim = '';
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const r = ev.results[i];
            if (r.isFinal) finalText += r[0].transcript + ' ';
            else interim += r[0].transcript;
          }
          thought.text = (finalText + interim).trim();
          Bus.emit('entity:changed', node);
        };
        recog.onerror = ev => { console.warn('Распознавание речи: ' + ev.error); };
        try { recog.start(); } catch (e) { recog = null; }
      }

      rec = { node: node, thought: thought, mediaRec: mediaRec, recog: recog };
      state = 'recording';
      setPill('rec');
      Project.markDirty();
      if (cancelRequested) stopVoice(true);
    } catch (e) {
      console.error(e);
      stream.getTracks().forEach(t => t.stop());
      state = 'idle'; setPill('idle');
    }
  }

  function stopVoice(discard) {
    if (state !== 'recording' || !rec) return;
    state = 'idle';
    setPill('idle');
    pendingDiscard = !!discard;
    const r = rec;
    try { if (r.recog) r.recog.stop(); } catch (e) {}
    try { r.mediaRec.stop(); } catch (e) { rec = null; }
  }

  function finishVoice(node, thought, chunks, stream) {
    stream.getTracks().forEach(t => t.stop());
    rec = null;
    const discard = pendingDiscard;
    pendingDiscard = false;
    const blob = new Blob(chunks, { type: 'audio/webm' });
    const data = Project.getData();
    const text = (thought.text || '').trim();
    if (discard && !text && blob.size < 20000) {
      const i = data.entities.indexOf(node);
      if (i >= 0) data.entities.splice(i, 1);
      Render.renderAll(data);
      Project.markDirty();
      return;
    }
    const audio = Entity.addPart(node, 'audio', {
      url: URL.createObjectURL(blob), file: null, duration: null });
    node.parts.splice(node.parts.indexOf(audio), 1);
    node.parts.unshift(audio);
    thought.transcriptOf = audio.id;
    pendingMedia.push({ part: audio, blob: blob, name: 'a_' + audio.id + '.webm' });
    Bus.emit('entity:changed', node);
    Project.markDirty();
    flushMedia();
  }

  async function flushMedia() {
    if (!Project.hasHandle() || pendingMedia.length === 0) return;
    while (pendingMedia.length) {
      const m = pendingMedia.shift();
      const path = await Project.writeMedia(m.name, m.blob);
      if (path) m.part.file = path;
    }
    Project.markDirty();
  }

  function init() {
    pill = buildMic();
    setPill('idle');
    Bus.on('project:save', () => { flushMedia(); });

    if (bound) return;
    bound = true;

    document.addEventListener('mousemove', e => {
      lastPointer = { x: e.clientX, y: e.clientY };
    });

    document.addEventListener('keydown', e => {
      if (isEditing()) {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.target.blur();
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          if (e.target.classList.contains('node-title')) {
            e.preventDefault();
            const data = Project.getData();
            const node = data && data.entities.find(n => n.id === e.target.dataset.nodeId);
            if (node) Render.editPart(node, 'thought');
          } else if (e.target.classList.contains('part-thought')) {
            e.preventDefault();
            e.target.blur();
          }
        }
        return;
      }
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        onHoldStart('key');
        return;
      }
      if (e.key === 'n' || e.key === 'N' || e.key === 'т' || e.key === 'Т') {
        e.preventDefault();
        const node = newThoughtNode('', 'keys');
        if (node) startEditing(node);
      }
    });

    document.addEventListener('keyup', e => {
      if (e.code === 'Space') onHoldEnd();
    });

    document.addEventListener('paste', e => {
      if (isEditing()) return;
      const items = e.clipboardData && e.clipboardData.items;
      if (items) {
        const imgs = [];
        for (let i = 0; i < items.length; i++) {
          if (items[i].type && items[i].type.startsWith('image/')) {
            const f = items[i].getAsFile();
            if (f) imgs.push(f);
          }
        }
        if (imgs.length) {
          e.preventDefault();
          imagesFromFiles(imgs, selectedNode());
          return;
        }
      }
      const text = (e.clipboardData || window.clipboardData).getData('text');
      if (!text || !text.trim()) return;
      e.preventDefault();
      const target = selectedNode();
      if (target) addThoughtToNode(target, text.trim(), 'paste');
      else newThoughtNode(text.trim(), 'paste');
    });

    document.addEventListener('dragover', e => { e.preventDefault(); });
    document.addEventListener('drop', e => {
      e.preventDefault();
      const files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      const nodeEl = e.target.closest ? e.target.closest('.node') : null;
      let target = null;
      if (nodeEl) {
        const data = Project.getData();
        target = (data && data.entities.find(n => n.id === nodeEl.dataset.nodeId)) || null;
      }
      imagesFromFiles(files, target, e.clientX, e.clientY);
    });
  }

  return { init, newThoughtNode, startEditing };
})();