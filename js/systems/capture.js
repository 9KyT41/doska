// L3: capture-движок. Клава (N…Enter), paste, голос (зажал микрофон).
// Голос: машина состояний idle -> starting -> recording -> idle.
const Capture = (() => {
  let pill = null;
  let state = 'idle';
  let cancelRequested = false;
  let pendingDiscard = false;
  let rec = null;
  const pendingMedia = [];

  function freeSpot(data) {
    const cx = window.innerWidth / 2 - 100;
    const cy = window.innerHeight / 2 - 40;
    const n = (data.entities || []).length;
    const angle = n * 2.4;
    const r = 40 + 34 * Math.sqrt(n);
    return { x: Math.round(cx + r * Math.cos(angle)),
             y: Math.round(cy + r * Math.sin(angle)) };
  }

  function newThoughtNode(text, source) {
    const data = Project.getData();
    if (!data) return null;
    const pos = freeSpot(data);
    const node = Entity.createNode(pos.x, pos.y);
    Entity.addPart(node, 'thought', { text: text, source: source });
    data.entities.push(node);
    Bus.emit('entity:created', node);
    Project.markDirty();
    return node;
  }

  function startEditing(node) {
    const el = document.querySelector(
      '.node[data-node-id="' + node.id + '"] .part-thought');
    if (el) el.focus();
  }

  function isEditing() {
    const a = document.activeElement;
    return a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
  }

  // --- Пилюля и её состояния ---
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
    p.addEventListener('mousedown', e => { e.preventDefault(); onHoldStart(); });
    p.addEventListener('mouseup', onHoldEnd);
    p.addEventListener('mouseleave', onHoldEnd);
    document.body.appendChild(p);
    setPill('idle');
    return p;
  }

  function onHoldStart() {
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

  // --- Голос ---
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
      const pos = freeSpot(data);
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
      const h = document.querySelector('.board-hint');
      if (h) h.textContent = 'В file-режиме Chrome спрашивает микрофон при каждой загрузке. Постоянное разрешение — через start-server.bat (localhost).';
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
    Bus.on('project:save', () => { flushMedia(); });

    document.addEventListener('keydown', e => {
      if (isEditing()) {
        if (e.key === 'Enter' && !e.shiftKey) {
          if (e.target.classList.contains('node-title')) {
            e.preventDefault();
            const body = e.target.parentElement.querySelector('.part-thought');
            if (body) body.focus();
          } else if (e.target.classList.contains('part-thought')) {
            e.preventDefault();
            e.target.blur();
          }
        }
        return;
      }
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        onHoldStart();
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
      const text = (e.clipboardData || window.clipboardData).getData('text');
      if (text && text.trim()) {
        e.preventDefault();
        newThoughtNode(text.trim(), 'paste');
      }
    });
  }

  return { init, newThoughtNode, startEditing };
})();