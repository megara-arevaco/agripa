const { app, BrowserWindow, WebContentsView, Menu, Tray, globalShortcut, ipcMain, shell, screen, desktopCapturer, clipboard, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const store = require('./settings.cjs');
const { t } = require('./i18n.js');
const { format, validate } = require('./shortcuts.js');
const { createShortcutManager } = require('./shortcut-manager.cjs');
const { createCaptureService } = require('./capture.cjs');
const { restoreBounds } = require('./window-bounds.cjs');
const Profiles = require('./profiles.js');
const { createUpdater, releaseURL } = require('./updates.cjs');
const smoke = process.argv.includes('--smoke-test');
if (smoke) app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'agripa-smoke-')));
app.setName('Agripa');
app.setDesktopName('dev.megara.agripa.desktop');
const locked = app.requestSingleInstanceLock();
const icon = path.join(__dirname, 'assets/agripa.png');
const secure = { nodeIntegration: false, contextIsolation: true, sandbox: true };
let win, browser, tray, settings, file, shortcutManager, captureService, geometryTimer, updater;
let quitting = false, compact = false, passthrough = false, previousBounds, capturing = false, settingsOpen = false, assigning = false, previewOpacity = .85, smokeClipboard, smokeClipboardText = '', captureCancelled = false;
const popups = new Set(), hiddenPopups = new Set();
const text = (key, values) => t(settings?.language || 'es', key, values);
function status(message, error = false) { if (win && !win.isDestroyed()) win.webContents.send('status', { message, error }); }
function state() { return { settings: structuredClone(settings), compact, passthrough, settingsOpen, assigning, registered: shortcutManager?.status() || {}, updates: updater?.state() || { status: 'idle', version: app.getVersion() }, version: app.getVersion() }; }
function emitState() { if (win && !win.isDestroyed()) win.webContents.send('panel-state', state()); }
function currentGeometry() {
  const bounds = compact ? previousBounds : win.getBounds();
  return { bounds, monitorId: String(screen.getDisplayMatching(bounds).id) };
}
function persist(next = settings, geometry = currentGeometry()) {
  const updated = store.normalize({ ...next, ...geometry });
  try { store.save(file, updated); } catch { throw new Error(text('saveError')); }
  settings = updated;
}
function resumeShortcuts() { if (assigning) { assigning = false; shortcutManager.suspend(false); emitState(); } }
function hidePopups() { for (const popup of popups) if (popup.isVisible()) { hiddenPopups.add(popup); popup.hide(); } }
function restorePopups() { if (settingsOpen || compact) return; for (const popup of hiddenPopups) if (!popup.isDestroyed()) popup.show(); hiddenPopups.clear(); }
function show() { if (quitting) return; win.show(); win.focus(); restorePopups(); }
function hide() { resumeShortcuts(); hidePopups(); win.hide(); }
function toggle() { if (capturing) return; if (win.isVisible()) hide(); else { setPass(false); show(); } }
function setPass(value) {
  passthrough = value;
  for (const window of [win, ...popups]) window.setIgnoreMouseEvents(value, { forward: true });
  refreshTray(); emitState();
  status(value ? text('passEnabled', { shortcut: format(settings.shortcuts.passthrough, settings.language) }) : text('passDisabled'));
}
function layout() {
  if (!browser || compact) return;
  const [width, height] = win.getContentSize();
  browser.setBounds({ x: 0, y: 92, width, height: Math.max(1, height - 122) });
}
function applyBounds(bounds, monitorId) {
  const restored = restoreBounds(bounds, screen.getAllDisplays(), monitorId);
  win.setMinimumSize(Math.min(400, restored.width), Math.min(520, restored.height));
  win.setBounds(restored); layout();
  return restored;
}
function applyLayoutLock() { win.setResizable(!settings.layoutLocked && !compact); }
function setCompact() {
  if (capturing) return;
  resumeShortcuts();
  if (settingsOpen) { previewOpacity = settings.opacity; win.setOpacity(previewOpacity); settingsOpen = false; }
  setPass(false);
  compact = !compact;
  if (compact) { previousBounds = win.getBounds(); hidePopups(); win.setMinimumSize(400, 48); win.setSize(400, 48); }
  else { applyBounds(previousBounds, settings.monitorId); restorePopups(); }
  browser.setVisible(!compact);
  applyLayoutLock(); emitState();
}
function perform(callback) { Promise.resolve().then(callback).catch(error => status(error.message, true)); }
function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: text('show'), click: () => { setPass(false); show(); } },
    { label: text('hide'), click: hide },
    { label: text('capture'), enabled: !capturing, click: () => perform(() => capture(false)) },
    { label: text('crop'), enabled: !capturing, click: () => perform(() => capture(true)) },
    { label: text('annotate'), enabled: !capturing, click: () => perform(() => capture('annotate')) },
    ...(capturing ? [{ label: text('cancel'), click: cancelCapture }] : []),
    { type: 'separator' },
    { label: text('passthrough'), type: 'checkbox', checked: passthrough, enabled: !capturing, click: item => setPass(item.checked) },
    { label: text('compactToggle'), enabled: !capturing, click: setCompact },
    { type: 'separator' }, { label: text('quit'), click: () => app.quit() }
  ]));
}
async function safeExternal() { try { await shell.openExternal('https://chatgpt.com/'); } catch { throw new Error(text('externalError')); } }
function configureRemote(contents) {
  contents.setWindowOpenHandler(({ url }) => url.startsWith('https://') ? { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, icon, webPreferences: { ...secure, partition: 'persist:chatgpt' } } } : { action: 'deny' });
  contents.on('will-navigate', (event, url) => { if (!url.startsWith('https://') && !(smoke && url.startsWith('data:'))) event.preventDefault(); });
  contents.on('did-create-window', popup => {
    popups.add(popup); configureRemote(popup.webContents); popup.setIgnoreMouseEvents(passthrough, { forward: true });
    if (settingsOpen || compact || !win.isVisible()) { hiddenPopups.add(popup); popup.hide(); }
    popup.on('closed', () => { popups.delete(popup); hiddenPopups.delete(popup); });
  });
}
function cancelCapture() { captureCancelled = true; captureService.window()?.close(); }
async function capture(mode = 'capture', fixtureSources) {
  mode = mode === true ? 'crop' : mode === false ? 'capture' : mode;
  if (capturing) return;
  if (compact) setCompact();
  resumeShortcuts(); setPass(false);
  capturing = true; captureCancelled = false; refreshTray();
  const visiblePopups = [...popups].filter(popup => popup.isVisible());
  try {
    win.hide(); visiblePopups.forEach(popup => popup.hide());
    if (settings.captureDelay && !(await captureService.wait(settings.captureDelay))) { status(text('captureCancelled')); return; }
    await new Promise(resolve => setTimeout(resolve, smoke ? 0 : 250));
    const displays = screen.getAllDisplays();
    const width = Math.min(8192, Math.max(...displays.map(d => Math.ceil(d.size.width * d.scaleFactor))));
    const height = Math.min(8192, Math.max(...displays.map(d => Math.ceil(d.size.height * d.scaleFactor))));
    const sources = fixtureSources || await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width, height } });
    if (captureCancelled || quitting) { status(text('captureCancelled')); return; }
    const usable = sources.filter(source => !source.thumbnail.isEmpty());
    const image = await captureService.open(usable, mode);
    if (image) {
      if (smoke) smokeClipboard = image; else clipboard.writeImage(image);
      status(text(mode === 'crop' ? 'cropCopied' : 'captureCopied'));
    } else status(text('captureCancelled'));
  } catch { status(text('captureError'), true); }
  finally { capturing = false; refreshTray(); if (!quitting) { visiblePopups.forEach(popup => { if (!popup.isDestroyed()) popup.show(); }); show(); } }
}
function adjustOpacity(direction) {
  if (capturing) return;
  const next = Math.round(Math.max(.3, Math.min(1, previewOpacity + direction * .05)) * 100) / 100;
  if (!settingsOpen) persist({ ...settings, opacity: next });
  previewOpacity = next; win.setOpacity(next); emitState();
  win.webContents.send('opacity-preview', next);
}
function profileName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 32) throw new Error(text('profileNameRequired'));
  return value.trim();
}
function prepareProfile(value) {
  const name = profileName(typeof value === 'string' ? value : value?.name);
  const existing = settings.profiles.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
  if (existing < 0 && settings.profiles.length >= 50) throw new Error(text('profileLimit'));
  const profiles = [...settings.profiles], previous = profiles[existing];
  let shortcuts;
  try { shortcuts = validate(value?.shortcuts || settings.shortcuts); } catch (error) { throw new Error(text(error.message)); }
  const profile = { name, opacity: previewOpacity, ...currentGeometry(), shortcuts, ...Profiles.content({ ...previous, ...(typeof value === 'object' ? value : {}) }, name, settings.language) };
  if (existing < 0) profiles.push(profile); else profiles[existing] = profile;
  return profiles;
}
function copyText(value) {
  if (smoke) smokeClipboardText = value; else clipboard.writeText(value);
  status(text('promptCopied'));
}
function showGameMenu() {
  const profile = settings.profiles.find(p => p.name === settings.activeProfile);
  const questions = profile?.quickPrompts || Profiles.defaultQuestions[settings.language];
  Menu.buildFromTemplate([
    { label: text('copyContext'), enabled: Boolean(profile), click: () => perform(() => action('copy-context')) },
    { label: text('quickPrompts'), enabled: Boolean(questions.length), submenu: questions.map((question, index) => ({ label: question.length > 80 ? question.slice(0, 77) + '…' : question, click: () => perform(() => action('quick-prompt', { index })) })) },
    { type: 'separator' },
    { label: text('noProfile'), type: 'radio', checked: !profile, click: () => perform(() => { persist({ ...settings, activeProfile: '' }); emitState(); }) },
    ...settings.profiles.map(p => ({ label: p.name, type: 'radio', checked: settings.activeProfile === p.name, click: () => perform(() => action('profile-apply', p.name)) })),
    { type: 'separator' }, { label: text('editProfiles'), click: () => win.webContents.send('open-profiles') }
  ]).popup({ window: win });
}
async function action(name, value) {
  if (capturing && !['state', 'hide', 'quit', 'capture-cancel'].includes(name)) throw new Error(text('unavailableDuringCapture'));
  switch (name) {
    case 'state': return state();
    case 'hide': hide(); break;
    case 'compact': setCompact(); break;
    case 'passthrough': if (typeof value !== 'boolean') throw new Error(text('invalidAction')); setPass(value); break;
    case 'external': await safeExternal(); break;
    case 'capture': await capture(); break;
    case 'crop': await capture(true); break;
    case 'annotate': await capture('annotate'); break;
    case 'capture-cancel': cancelCapture(); break;
    case 'preferences': {
      const validators = { captureDelay: v => [0, 3, 5].includes(v), layoutLocked: v => typeof v === 'boolean', autoCheckUpdates: v => typeof v === 'boolean' };
      if (!value || !Object.keys(value).length || Object.entries(value).some(([key, v]) => !validators[key]?.(v))) throw new Error(text('invalidAction'));
      persist({ ...settings, ...value }); applyLayoutLock(); emitState(); refreshTray(); return state();
    }
    case 'copy-context': {
      const profile = settings.profiles.find(p => p.name === (value || settings.activeProfile));
      if (!profile) throw new Error(text('profileMissing'));
      copyText(Profiles.prompt(profile)); break;
    }
    case 'copy-draft-context': copyText(Profiles.prompt(Profiles.content(value, value?.name, settings.language))); break;
    case 'quick-prompt': {
      const profile = settings.profiles.find(p => p.name === (value?.name || settings.activeProfile));
      const questions = profile?.quickPrompts || Profiles.defaultQuestions[settings.language];
      if (!Number.isInteger(value?.index) || !questions[value.index]) throw new Error(text('invalidAction'));
      copyText(profile ? Profiles.prompt(profile, questions[value.index]) : questions[value.index]); break;
    }
    case 'game-menu': showGameMenu(); break;
    case 'update-check': await updater.check(); return state();
    case 'update-download': await updater.download(); return state();
    case 'update-cancel': updater.cancel(); break;
    case 'update-reveal': if (updater.state().status !== 'ready' || !updater.readyFile()) throw new Error(text('invalidAction')); shell.showItemInFolder(updater.readyFile()); break;
    case 'update-releases': await shell.openExternal(releaseURL); break;
    case 'settings':
      settingsOpen = true; browser.setVisible(false); hidePopups(); emitState(); return state();
    case 'chat':
      resumeShortcuts(); settingsOpen = false; previewOpacity = settings.opacity; win.setOpacity(previewOpacity); browser.setVisible(!compact); restorePopups(); emitState(); break;
    case 'opacity':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(text('opacityInvalid'));
      previewOpacity = Math.max(.3, Math.min(1, value)); win.setOpacity(previewOpacity); break;
    case 'shortcut-begin':
      if (!settingsOpen) throw new Error(text('invalidAction'));
      assigning = true; shortcutManager.suspend(true); emitState(); break;
    case 'shortcut-end': resumeShortcuts(); return state();
    case 'save': {
      resumeShortcuts();
      const previous = settings;
      let shortcuts, profiles = settings.profiles;
      if (value?.profile) profiles = prepareProfile(value.profile);
      try { shortcuts = validate(value?.shortcuts); } catch (error) { throw new Error(text(error.message)); }
      let replaced = false;
      try {
        shortcutManager.replace(shortcuts); replaced = true;
        persist({ ...settings, opacity: previewOpacity, shortcuts, profiles });
      } catch (error) {
        if (replaced) shortcutManager.start(previous.shortcuts);
        emitState(); throw new Error(text(error.message));
      }
      refreshTray(); emitState(); status(text('saved')); return state();
    }
    case 'language':
      if (!['en', 'es'].includes(value)) throw new Error(text('invalidAction'));
      persist({ ...settings, language: value }); refreshTray(); emitState(); status(text('saved')); return state();
    case 'profile-save': {
      persist({ ...settings, profiles: prepareProfile(value) }); emitState(); status(text('profileSaved')); return state();
    }
    case 'profile-apply': {
      const profile = settings.profiles.find(p => p.name === value);
      if (!profile) throw new Error(text('profileMissing'));
      resumeShortcuts();
      const previous = currentGeometry(), previousShortcuts = settings.shortcuts;
      let replaced = false;
      try {
        shortcutManager.replace(profile.shortcuts); replaced = true;
        const bounds = applyBounds(profile.bounds, profile.monitorId);
        persist({ ...settings, opacity: profile.opacity, shortcuts: profile.shortcuts, activeProfile: profile.name }, { bounds, monitorId: String(screen.getDisplayMatching(bounds).id) });
      } catch (error) { if (replaced) shortcutManager.start(previousShortcuts); applyBounds(previous.bounds, previous.monitorId); emitState(); throw new Error(text(error.message)); }
      previewOpacity = profile.opacity; win.setOpacity(previewOpacity); refreshTray(); emitState(); status(text('profileApplied')); return state();
    }
    case 'profile-delete':
      if (!settings.profiles.some(p => p.name === value)) throw new Error(text('profileMissing'));
      persist({ ...settings, profiles: settings.profiles.filter(p => p.name !== value), activeProfile: settings.activeProfile === value ? '' : settings.activeProfile }); emitState(); status(text('profileDeleted')); return state();
    case 'tools':
      Menu.buildFromTemplate([
        { label: text('annotate'), click: () => perform(() => capture('annotate')) },
        { label: text('captureDelay'), submenu: [0, 3, 5].map(seconds => ({ label: seconds ? `${seconds} s` : text('noDelay'), type: 'radio', checked: settings.captureDelay === seconds, click: () => perform(() => action('preferences', { captureDelay: seconds })) })) },
        { label: text('layoutLock'), type: 'checkbox', checked: settings.layoutLocked, click: item => perform(() => action('preferences', { layoutLocked: item.checked })) },
        { type: 'separator' },
        { label: text('home'), click: () => perform(() => browser.webContents.loadURL('https://chatgpt.com/')) },
        { label: text('reload'), click: () => browser.webContents.reload() },
        { label: text('external'), click: () => perform(safeExternal) },
        { type: 'separator' },
        { label: text('passthrough'), type: 'checkbox', checked: passthrough, click: item => setPass(item.checked) },
        { label: text('updates'), click: () => win.webContents.send('open-updates') },
        { type: 'separator' }, { label: text('quit'), click: () => app.quit() }
      ]).popup({ window: win }); break;
    case 'quit': app.quit(); break;
    default: throw new Error(text('invalidAction'));
  }
}
async function start() {
  file = path.join(app.getPath('userData'), 'settings.json');
  const loaded = store.read(file); settings = loaded.settings; previewOpacity = settings.opacity;
  const bounds = restoreBounds(settings.bounds, screen.getAllDisplays(), settings.monitorId);
  win = new BrowserWindow({ ...bounds, minWidth: Math.min(400, bounds.width), minHeight: Math.min(520, bounds.height), show: false, frame: false, alwaysOnTop: true, backgroundColor: '#19201d', icon, webPreferences: { ...secure, preload: path.join(__dirname, 'preload.cjs') } });
  win.setMenu(null); win.setOpacity(settings.opacity); applyLayoutLock();
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  browser = new WebContentsView({ webPreferences: { ...secure, partition: 'persist:chatgpt' } });
  win.contentView.addChildView(browser); configureRemote(browser.webContents);
  browser.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  browser.webContents.session.setPermissionCheckHandler(() => false);
  browser.webContents.on('did-finish-load', () => status(text('ready')));
  browser.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => { if (mainFrame && code !== -3) status(text('loadError'), true); });
  for (const contents of [win.webContents, browser.webContents]) contents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && !settingsOpen && !assigning) { event.preventDefault(); hide(); }
  });
  const handlers = { toggle, capture: () => perform(() => capture()), compact: setCompact, passthrough: () => { if (!capturing) setPass(!passthrough); }, opacityUp: () => perform(() => adjustOpacity(1)), opacityDown: () => perform(() => adjustOpacity(-1)) };
  // Smoke tests use their own registry so they never steal shortcuts from a live session.
  const fakeBindings = new Map();
  const nativeShortcuts = smoke ? { register(key, handler) { fakeBindings.set(key, handler); return true; }, unregister(key) { fakeBindings.delete(key); }, isRegistered(key) { return fakeBindings.has(key); }, setSuspended() {} } : globalShortcut;
  shortcutManager = createShortcutManager(nativeShortcuts, handlers);
  shortcutManager.start(settings.shortcuts);
  captureService = createCaptureService({ BrowserWindow, ipcMain, nativeImage }, { secure, icon, language: () => settings.language });
  updater = createUpdater({ version: app.getVersion(), directory: path.join(app.getPath('userData'), 'updates'), onChange: () => emitState(), ...(smoke ? { fetcher: async () => new Response(JSON.stringify({ tag_name: 'v' + app.getVersion(), assets: [] })) } : {}) });
  win.on('resize', layout);
  for (const event of ['move', 'resize']) win.on(event, () => {
    clearTimeout(geometryTimer);
    if (compact || capturing || quitting) return;
    geometryTimer = setTimeout(() => { if (!quitting && !compact) { try { persist(); } catch (error) { status(error.message, true); } } }, 350);
  });
  const recoverDisplay = () => {
    if (quitting || win.isDestroyed()) return;
    if (compact) {
      previousBounds = restoreBounds(previousBounds, screen.getAllDisplays(), settings.monitorId);
      const bounds = restoreBounds(win.getBounds(), screen.getAllDisplays(), settings.monitorId);
      win.setBounds(bounds);
    } else applyBounds(win.getBounds(), settings.monitorId);
    try { persist(); } catch (error) { status(error.message, true); }
  };
  screen.on('display-removed', recoverDisplay);
  screen.on('display-metrics-changed', recoverDisplay);
  win.on('blur', resumeShortcuts);
  win.on('close', event => { if (!quitting) { event.preventDefault(); hide(); } });
  ipcMain.handle('action', (event, name, value) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Unauthorized origin');
    return action(name, value);
  });
  await win.loadFile(path.join(__dirname, 'index.html')); layout();
  if (smoke) {
    const timeout = setTimeout(() => { console.error('SMOKE TIMEOUT'); app.exit(1); }, 45000);
    show();
    await require('./smoke.cjs')({ win, browser, action, state, capture, captureService, nativeImage, store, file, clipboardImage: () => smokeClipboard, clipboardText: () => smokeClipboardText, adjustOpacity });
    clearTimeout(timeout); app.quit(); return;
  }
  tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 24, height: 24 }));
  tray.setToolTip('Agripa'); tray.on('click', () => { setPass(false); toggle(); }); refreshTray();
  show(); emitState();
  if (loaded.recovery) status(text(loaded.recovery));
  browser.webContents.loadURL('https://chatgpt.com/').catch(() => status(text('loadError'), true));
  win.on('focus', emitState);
  if (settings.autoCheckUpdates) perform(() => updater.check());
}
if (!locked) app.quit();
else {
  app.on('second-instance', () => { if (win) { setPass(false); show(); } });
  app.whenReady().then(start).catch(error => { console.error(error); app.exit(1); });
}
app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  quitting = true; clearTimeout(geometryTimer);
  updater?.cancel(); captureService?.window()?.destroy();
  if (win && !win.isDestroyed() && settings) { try { persist(); } catch (error) { console.error(error.message); } }
  if (browser && !browser.webContents.isDestroyed()) browser.webContents.close();
  for (const popup of popups) if (!popup.isDestroyed()) popup.destroy();
});
app.on('will-quit', () => { shortcutManager?.clear(); tray?.destroy(); });
