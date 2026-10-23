const $ = id => document.getElementById(id);
const action = (name, value) => window.agripaCapture.action(name, value);
let language = 'es', config, image, start, end, dragging = false, tool = 'crop', annotations = [], pendingMark;
const text = key => AgripaI18n.t(language, key);
const report = error => { $('capture-error').textContent = error.message; };
const canvas = $('crop-canvas');
const composed = document.createElement('canvas');
function selection() { return AgripaCapture.cropRect(start, end, canvas.width, canvas.height); }
function effectiveRect() { return selection() || (config.mode === 'annotate' ? { x: 0, y: 0, width: canvas.width, height: canvas.height } : null); }
function mark(context, item) {
  const a = item.start, b = item.end;
  context.save(); context.strokeStyle = item.color; context.fillStyle = item.color; context.lineWidth = item.width; context.lineCap = 'round'; context.lineJoin = 'round';
  if (item.tool === 'marker') context.globalAlpha = .35;
  if (item.tool === 'rectangle') context.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  else {
    context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
    if (item.tool === 'arrow') {
      const angle = Math.atan2(b.y - a.y, b.x - a.x), length = item.width * 4;
      context.beginPath(); context.moveTo(b.x - length * Math.cos(angle - Math.PI / 6), b.y - length * Math.sin(angle - Math.PI / 6)); context.lineTo(b.x, b.y); context.lineTo(b.x - length * Math.cos(angle + Math.PI / 6), b.y - length * Math.sin(angle + Math.PI / 6)); context.stroke();
    }
  }
  context.restore();
}
function composite(preview = false) {
  const result = composed;
  if (result.width !== canvas.width || result.height !== canvas.height) { result.width = canvas.width; result.height = canvas.height; }
  const context = result.getContext('2d'); context.clearRect(0, 0, result.width, result.height); context.drawImage(image, 0, 0);
  annotations.forEach(item => mark(context, item));
  if (preview && pendingMark) mark(context, pendingMark);
  return result;
}
function draw() {
  if (!image) return;
  const context = canvas.getContext('2d'), rendered = composite(true);
  context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(rendered, 0, 0);
  const rect = selection();
  $('crop-copy').disabled = !effectiveRect() || dragging;
  $('annotation-undo').disabled = $('annotation-clear').disabled = annotations.length === 0;
  const size = effectiveRect(); $('crop-size').textContent = size ? `${size.width} × ${size.height} px` : '';
  if (rect || config.mode === 'crop') {
    context.fillStyle = 'rgba(0,0,0,.6)'; context.fillRect(0, 0, canvas.width, canvas.height);
    if (rect) {
      context.clearRect(rect.x, rect.y, rect.width, rect.height);
      context.drawImage(rendered, rect.x, rect.y, rect.width, rect.height, rect.x, rect.y, rect.width, rect.height);
      context.strokeStyle = '#a0d7be'; context.lineWidth = 2 * canvas.width / canvas.getBoundingClientRect().width;
      context.strokeRect(rect.x, rect.y, rect.width, rect.height);
    }
  }
}
function point(event) {
  const bounds = canvas.getBoundingClientRect();
  return { x: Math.max(0, Math.min(canvas.width, (event.clientX - bounds.left) * canvas.width / bounds.width)), y: Math.max(0, Math.min(canvas.height, (event.clientY - bounds.top) * canvas.height / bounds.height)) };
}
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  canvas.focus(); canvas.setPointerCapture(event.pointerId); dragging = true;
  if (tool === 'crop') start = end = point(event);
  else pendingMark = { tool, color: $('annotation-color').value, start: point(event), end: point(event), width: (tool === 'marker' ? 20 : 3) * canvas.width / canvas.getBoundingClientRect().width };
  draw();
});
canvas.addEventListener('pointermove', event => {
  if (!dragging) return;
  if (tool === 'crop') end = point(event); else pendingMark.end = point(event);
  draw();
});
canvas.addEventListener('pointerup', event => {
  if (!dragging) return;
  if (tool === 'crop') end = point(event);
  else { pendingMark.end = point(event); if (Math.hypot(pendingMark.end.x - pendingMark.start.x, pendingMark.end.y - pendingMark.start.y) >= 2) annotations.push(pendingMark); pendingMark = null; }
  dragging = false; draw();
});
canvas.addEventListener('pointercancel', () => { dragging = false; pendingMark = null; draw(); });
async function copy() {
  const rect = effectiveRect();
  if (dragging || !rect) return;
  $('crop-copy').disabled = true;
  try {
    let png;
    if (annotations.length) {
      const result = document.createElement('canvas'); result.width = rect.width; result.height = rect.height;
      result.getContext('2d').drawImage(composite(), rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
      png = result.toDataURL('image/png');
    }
    await action('copy', { rect, ...(png ? { png } : {}) });
  } catch (error) { report(error); $('crop-copy').disabled = false; }
}
function setTool(value) {
  tool = value;
  document.querySelectorAll('[data-tool]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tool === tool)));
}
async function choose(id) {
  try {
    const data = await action('choose', id);
    if (!config.edit) return;
    image = new Image(); image.src = data; await image.decode();
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    start = end = undefined; annotations = []; pendingMark = null;
    setTool(config.mode === 'annotate' ? 'arrow' : 'crop');
    $('sources').hidden = true; $('crop-editor').hidden = false;
    $('capture-title').textContent = text(config.mode === 'annotate' ? 'annotate' : 'cropTitle'); $('capture-instructions').textContent = text(config.mode === 'annotate' ? 'annotationHelp' : 'cropHelp');
    $('crop-copy').textContent = text(config.mode === 'annotate' ? 'copyImage' : 'cropCopy');
    draw(); canvas.focus();
  } catch (error) { report(error); }
}
$('crop-copy').addEventListener('click', copy);
$('capture-cancel').addEventListener('click', () => action('cancel').catch(report));
$('capture-back').addEventListener('click', () => { $('crop-editor').hidden = true; $('sources').hidden = false; $('capture-title').textContent = text('captureChoose'); $('capture-instructions').textContent = text('captureChooseHelp'); document.querySelector('#sources button')?.focus(); });
$('annotation-undo').addEventListener('click', () => { annotations.pop(); draw(); });
$('annotation-clear').addEventListener('click', () => { annotations = []; draw(); });
document.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => { if (!dragging) setTool(button.dataset.tool); }));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); action('cancel').catch(report); }
  if (event.key === 'Enter' && event.target === canvas) { event.preventDefault(); copy(); }
  if (event.target === canvas && event.ctrlKey && event.key.toLowerCase() === 'z') { event.preventDefault(); annotations.pop(); draw(); }
});
window.addEventListener('resize', () => { if (image) draw(); });
window.agripaCapture.tick(seconds => { $('countdown-seconds').textContent = seconds; });
(async () => {
  config = await action('init'); language = config.language; document.documentElement.lang = language;
  document.title = `${text(config.phase === 'countdown' ? 'captureCountdown' : config.mode === 'annotate' ? 'annotate' : config.crop ? 'cropTitle' : 'captureChoose')} · Agripa`;
  $('capture-cancel').textContent = text('cancel');
  if (config.phase === 'countdown') {
    $('countdown').hidden = false; $('sources').hidden = true;
    $('capture-title').textContent = text('captureCountdown'); $('countdown-seconds').textContent = config.remaining; $('countdown-help').textContent = text('countdownHelp'); return;
  }
  $('capture-title').textContent = text('captureChoose'); $('capture-instructions').textContent = text('captureChooseHelp');
  $('sources').setAttribute('aria-label', text('captureChoose'));
  $('capture-back').textContent = text('back'); $('crop-copy').textContent = text('cropCopy');
  canvas.setAttribute('aria-label', text('cropHelp'));
  $('annotation-tools').setAttribute('aria-label', text('annotationTools'));
  document.querySelectorAll('[data-tool]').forEach(button => { button.textContent = text(button.dataset.tool === 'crop' ? 'cropTool' : button.dataset.tool); });
  $('annotation-color').setAttribute('aria-label', text('annotationColor'));
  ['gold', 'red', 'mint'].forEach((key, index) => { $('annotation-color').options[index].textContent = text(key); });
  $('annotation-undo').textContent = text('undo'); $('annotation-clear').textContent = text('clearAnnotations');
  for (const source of config.sources) {
    const button = document.createElement('button'); button.className = 'source-button'; button.dataset.source = source.id;
    const thumbnail = document.createElement('img'); thumbnail.src = source.thumbnail; thumbnail.alt = '';
    const name = document.createElement('span'); name.className = 'source-name'; name.textContent = source.name; name.title = source.name;
    const kind = document.createElement('span'); kind.className = 'source-kind'; kind.textContent = text(source.kind);
    button.append(thumbnail, name, kind); button.addEventListener('click', () => choose(source.id)); $('sources').append(button);
  }
  if (config.sources.length === 1 && config.edit) await choose(config.sources[0].id);
})().catch(report);
