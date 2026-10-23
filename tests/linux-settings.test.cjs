const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalize, load, save } = require('../src/linux/settings.cjs');
test('invalid values and geometry recover to bounded settings', () => {
  assert.equal(normalize({ opacity: NaN }).opacity, .85);
  assert.equal(normalize({ opacity: 5 }).opacity, 1);
  assert.equal(normalize({ opacity: -5 }).opacity, .3);
  assert.deepEqual(normalize({ bounds: { width: 1, height: 1, x: Infinity, y: 0 } }).bounds, { width: 400, height: 520 });
});
test('atomic persistence and corrupt primary recovery preserve the valid backup', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agripa-settings-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  save(file, { opacity: .6 }); save(file, { opacity: .9 });
  assert.equal(load(file).opacity, .9);
  fs.writeFileSync(file, '{broken');
  assert.equal(load(file).opacity, .6);
  save(file, load(file)); assert.equal(load(file).opacity, .6);
  assert.equal(JSON.parse(fs.readFileSync(file + '.bak')).opacity, .6);
});
