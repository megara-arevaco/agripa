const path = require('node:path');
const { validRect } = require('./capture-geometry.js');
const { t } = require('./i18n.js');
function createCaptureService({ BrowserWindow, ipcMain, nativeImage }, { secure, icon, language }) {
  let pending;
  ipcMain.handle('capture-action', (event, name, value) => {
    const p = pending;
    if (!p || event.sender !== p.window.webContents || event.senderFrame !== p.window.webContents.mainFrame) throw new Error('Unauthorized capture origin');
    if (name === 'init') return { language: language(), phase: p.phase, remaining: p.remaining, mode: p.mode, edit: p.mode !== 'capture', crop: p.mode === 'crop', sources: p.sources.map(source => ({ id: source.id, name: source.name, kind: source.id.startsWith('screen:') ? 'screen' : 'window', thumbnail: source.thumbnail.resize({ width: 320 }).toDataURL() })) };
    if (name === 'cancel') { p.finish(null); return; }
    if (p.phase !== 'editor') throw new Error(t(language(), 'invalidAction'));
    if (name === 'choose') {
      const source = p.sources.find(source => source.id === value);
      if (!source || source.thumbnail.isEmpty()) throw new Error(t(language(), 'captureUnavailable'));
      if (p.mode === 'capture') { p.finish(source.thumbnail); return; }
      p.selected = source;
      return source.thumbnail.toDataURL();
    }
    if (name === 'copy') {
      const rect = value?.rect || value;
      if (!p.selected || !validRect(rect, p.selected.thumbnail.getSize())) throw new Error(t(language(), 'cropNeedSelection'));
      let result = p.selected.thumbnail.crop(rect);
      if (value?.png !== undefined) {
        if (typeof value.png !== 'string' || value.png.length > 64 * 1024 * 1024 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value.png)) throw new Error(t(language(), 'captureError'));
        result = nativeImage.createFromDataURL(value.png);
        const size = result.getSize();
        if (result.isEmpty() || size.width !== rect.width || size.height !== rect.height) throw new Error(t(language(), 'captureError'));
      }
      p.finish(result); return;
    }
    throw new Error(t(language(), 'invalidAction'));
  });
  function openWindow({ sources = [], mode = 'capture', phase = 'editor', remaining = 0 }) {
    return new Promise((resolve, reject) => {
      const countdown = phase === 'countdown';
      const window = new BrowserWindow({ width: countdown ? 360 : 900, height: countdown ? 230 : 720, minWidth: countdown ? 320 : 400, minHeight: countdown ? 200 : 400, resizable: !countdown, show: false, alwaysOnTop: true, backgroundColor: '#19201d', title: t(language(), countdown ? 'captureCountdown' : mode === 'annotate' ? 'annotate' : mode === 'crop' ? 'cropTitle' : 'captureChoose'), icon, autoHideMenuBar: true, webPreferences: { ...secure, preload: path.join(__dirname, 'capture-preload.cjs') } });
      const p = { window, sources, mode, phase, remaining, selected: null, timer: null, finish(result) { if (pending !== p) return; pending = null; clearInterval(p.timer); window.destroy(); resolve(result); } };
      pending = p;
      window.webContents.on('will-navigate', event => event.preventDefault());
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.on('closed', () => { clearInterval(p.timer); if (pending === p) { pending = null; resolve(null); } });
      window.once('ready-to-show', () => {
        window.show(); window.focus();
        if (countdown) p.timer = setInterval(() => {
          p.remaining--;
          if (p.remaining <= 0) p.finish(true);
          else window.webContents.send('capture-tick', p.remaining);
        }, 1000);
      });
      window.loadFile(path.join(__dirname, 'capture.html')).catch(error => { if (pending === p) { pending = null; clearInterval(p.timer); window.destroy(); reject(error); } });
    });
  }
  return {
    window() { return pending?.window; },
    wait(seconds) { return openWindow({ phase: 'countdown', remaining: seconds }); },
    open(sources, mode) {
      mode = mode === true ? 'crop' : mode === false ? 'capture' : mode;
      if (!['capture', 'crop', 'annotate'].includes(mode)) throw new Error(t(language(), 'invalidAction'));
      if (!sources.length) throw new Error(t(language(), 'captureUnavailable'));
      if (sources.length === 1 && mode === 'capture') return Promise.resolve(sources[0].thumbnail);
      return openWindow({ sources, mode });
    }
  };
}
module.exports = { createCaptureService };
