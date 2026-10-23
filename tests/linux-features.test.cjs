const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const shortcuts = require('../src/linux/shortcuts.js');
const { createShortcutManager } = require('../src/linux/shortcut-manager.cjs');
const { normalize, read, save } = require('../src/linux/settings.cjs');
const { restoreBounds } = require('../src/linux/window-bounds.cjs');
const { cropRect, validRect } = require('../src/linux/capture-geometry.js');
const { messages } = require('../src/linux/i18n.js');
test('shortcuts reject reserved keys, bare keys and canonical duplicates', () => {
  assert.equal(shortcuts.canonical('Alt+Control+Q'), 'Control+Alt+Q');
  for (const value of ['Q', 'Control+Control+Q', 'Alt+F4', 'Control+Escape', 'Control+MadeUp', null]) assert.equal(shortcuts.canonical(value), null);
  assert.throws(() => shortcuts.validate({ ...shortcuts.defaults, capture: 'Alt+Control+Space' }), /shortcutConflict/);
  assert.equal(shortcuts.fromEvent({ key: 'q', ctrlKey: true, altKey: true }), 'Control+Alt+Q');
  assert.equal(shortcuts.fromEvent({ key: 'Shift', shiftKey: true }), undefined);
});
test('failed replacement restores previous shortcuts and reports partial recovery', () => {
  const bound = new Set(), taken = new Set();
  let suspended = false;
  const native = {
    register(key) { if (taken.has(key)) return false; bound.add(key); return true; },
    unregister(key) { bound.delete(key); }, isRegistered(key) { return bound.has(key); }, setSuspended(value) { suspended = value; }
  };
  const manager = createShortcutManager(native, Object.fromEntries(Object.keys(shortcuts.defaults).map(id => [id, () => {}])));
  assert.deepEqual(manager.start(shortcuts.defaults), []);
  taken.add('Control+Alt+Q');
  assert.throws(() => manager.replace({ ...shortcuts.defaults, capture: 'Control+Alt+Q' }), /shortcutUnavailable/);
  assert.deepEqual([...bound].sort(), Object.values(shortcuts.defaults).sort());
  manager.suspend(true); assert.equal(suspended, true); manager.suspend(false); assert.equal(suspended, false);
  taken.add(shortcuts.defaults.capture);
  assert.throws(() => manager.replace({ ...shortcuts.defaults, capture: 'Control+Alt+Q' }), /shortcutUnavailable/);
  assert.equal(manager.status().capture, false);
  assert.equal(manager.status().toggle, true);
});
test('invalid replacements do not unregister existing shortcuts', () => {
  let unregistered = 0;
  const manager = createShortcutManager({ register: () => true, unregister: () => unregistered++, isRegistered: () => true }, {});
  manager.start(shortcuts.defaults);
  assert.throws(() => manager.replace({ ...shortcuts.defaults, toggle: 'Control+Alt+C' }));
  assert.equal(unregistered, 0);
});
test('old settings migrate and profiles are bounded and deduplicated without losing valid bindings', () => {
  const result = normalize({ opacity: .7, shortcuts: { capture: 'Alt+Control+Q' }, language: 'en', profiles: [{ name: ' Game ', opacity: .6, bounds: { width: 800, height: 600, x: -800, y: 0 } }, { name: 'game', opacity: 1 }, { name: '' }, { name: 'x'.repeat(33) }] });
  assert.equal(result.opacity, .7); assert.equal(result.shortcuts.capture, 'Control+Alt+Q'); assert.equal(result.language, 'en');
  assert.equal(result.profiles.length, 1); assert.equal(result.profiles[0].name, 'Game'); assert.equal(result.profiles[0].bounds.x, -800);
  assert.equal(normalize({ opacity: .4 }).shortcuts.toggle, shortcuts.defaults.toggle);
  assert.deepEqual(normalize({ shortcuts: { toggle: shortcuts.defaults.capture } }).shortcuts, shortcuts.defaults);
});
test('corrupt settings are preserved and new features survive persistence', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agripa-features-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  const settings = normalize({ language: 'en', shortcuts: { capture: 'Control+Alt+Q' }, profiles: [{ name: 'Game', opacity: .6 }] });
  save(file, settings); save(file, settings);
  fs.writeFileSync(file, '[]');
  assert.equal(read(file).recovery, 'settingsRecovered');
  save(file, read(file).settings);
  assert.equal(read(file).settings.shortcuts.capture, 'Control+Alt+Q');
  assert.equal(read(file).settings.profiles[0].name, 'Game');
  assert.equal(read(file).settings.language, 'en');
  assert.equal(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find(name => name.includes('.corrupt-'))), 'utf8'), '[]');
});
test('missing monitor, negative coordinates and small work areas restore fully visible bounds', () => {
  const displays = [{ id: 1, workArea: { x: 0, y: 0, width: 1280, height: 720 } }, { id: 2, workArea: { x: -1920, y: 0, width: 1920, height: 1080 } }];
  assert.deepEqual(restoreBounds({ x: -1800, y: 100, width: 700, height: 760 }, displays, '2'), { x: -1800, y: 100, width: 700, height: 760 });
  assert.deepEqual(restoreBounds({ x: 4000, y: 2000, width: 1500, height: 1000 }, [displays[0]], 'missing'), { x: 0, y: 0, width: 1280, height: 720 });
});
test('crop handles reverse dragging, image scaling boundaries and invalid selections', () => {
  assert.deepEqual(cropRect({ x: 510, y: 400 }, { x: 10, y: 20 }, 800, 600), { x: 10, y: 20, width: 500, height: 380 });
  assert.deepEqual(cropRect({ x: -10, y: -20 }, { x: 900, y: 700 }, 800, 600), { x: 0, y: 0, width: 800, height: 600 });
  assert.equal(cropRect({ x: 5, y: 5 }, { x: 5, y: 5 }, 800, 600), null);
  assert.equal(cropRect({ x: NaN, y: 0 }, { x: 5, y: 5 }, 800, 600), null);
  assert.equal(validRect({ x: 799, y: 0, width: 2, height: 20 }, { width: 800, height: 600 }), false);
  assert.equal(validRect({ x: 0, y: 0, width: 20, height: 20 }, { width: 800, height: 600 }), true);
});
test('every UI message has Spanish and English text', () => {
  for (const [key, values] of Object.entries(messages)) assert.ok(values.length === 2 && values.every(value => typeof value === 'string' && value.length), key);
});
