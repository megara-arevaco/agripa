const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const Profiles = require('../src/linux/profiles.js');
const { normalize } = require('../src/linux/settings.cjs');
const { defaults } = require('../src/linux/shortcuts.js');
const { createUpdater, selectRelease, newer } = require('../src/linux/updates.cjs');
const binary = Buffer.from('Agripa fixture, never executed.');
const digest = createHash('sha256').update(binary).digest('hex');
function release(changes = {}) {
  return { tag_name: 'v1.2.0', draft: false, prerelease: false, assets: [{ name: 'Agripa-1.2.0.AppImage', state: 'uploaded', browser_download_url: 'https://github.com/megara-arevaco/agripa/releases/download/v1.2.0/Agripa-1.2.0.AppImage', size: binary.length, digest: 'sha256:' + digest, ...changes }] };
}
function harness(t, metadata = release(), download = () => new Response(binary)) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agripa-update-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const calls = [];
  const updater = createUpdater({ version: '0.1.0', arch: 'x64', directory, fetcher: async (url, options) => { calls.push({ url, options }); return url.includes('api.github.com') ? new Response(JSON.stringify(metadata)) : download(url, options); } });
  return { updater, directory, calls };
}
test('game prompt includes reply language, spoiler policy, progress and preferences', () => {
  const profile = Profiles.content({ game: 'Elden Ring', answerLanguage: 'en', spoilers: 'hints', progress: 'Limgrave', instructions: 'Keep it brief.', quickPrompts: ['Compare these weapons.'] });
  const prompt = Profiles.prompt(profile, profile.quickPrompts[0]);
  for (const expected of ['Elden Ring', 'English', 'Start with hints', 'Limgrave', 'Keep it brief.', 'Compare these weapons.']) assert.ok(prompt.includes(expected), expected);
  assert.match(Profiles.prompt({ game: 'Hades', answerLanguage: 'es', spoilers: 'none' }), /Evita spoilers/);
});
test('profile content bounds user data and retains an explicitly empty quick-question list', () => {
  const p = Profiles.content({ game: 'x'.repeat(200), instructions: 'y'.repeat(4000), quickPrompts: Array(15).fill('q'.repeat(600)), spoilers: 'invalid' });
  assert.equal(p.game.length, 120); assert.equal(p.instructions.length, 3000); assert.equal(p.quickPrompts.length, 10); assert.equal(p.quickPrompts[0].length, 500); assert.equal(p.spoilers, 'none');
  assert.deepEqual(Profiles.content({ quickPrompts: [] }).quickPrompts, []);
});
test('legacy profiles inherit current shortcuts and migrate prompt context without losing geometry', () => {
  const p = normalize({ language: 'en', shortcuts: { ...defaults, capture: 'Control+Alt+Q' }, profiles: [{ name: 'Game', bounds: { x: 100, y: 200, width: 800, height: 700 } }], activeProfile: 'Game', captureDelay: 3, layoutLocked: true, autoCheckUpdates: true });
  assert.equal(p.profiles[0].shortcuts.capture, 'Control+Alt+Q'); assert.equal(p.profiles[0].game, 'Game'); assert.equal(p.profiles[0].answerLanguage, 'en');
  assert.equal(p.profiles[0].bounds.x, 100); assert.equal(p.activeProfile, 'Game'); assert.equal(p.captureDelay, 3); assert.equal(p.layoutLocked, true); assert.equal(p.autoCheckUpdates, true);
  assert.equal(normalize({ captureDelay: -5, activeProfile: 'missing', layoutLocked: 'true' }).captureDelay, 0);
  assert.equal(normalize({ activeProfile: 'missing' }).activeProfile, '');
});
test('stable version comparison prevents downgrade and excludes prerelease packages', () => {
  assert.equal(newer('1.10.0', '1.9.9'), true); assert.equal(newer('0.1.0', '0.2.0'), false); assert.equal(newer('1.0.0', '1.0.0'), false);
  assert.equal(selectRelease({ ...release(), prerelease: true }, '0.1.0', 'x64').status, 'current');
  assert.equal(selectRelease(release(), '2.0.0', 'x64').status, 'current');
  assert.throws(() => newer('1.0.0-beta', '0.1.0'));
  assert.equal(selectRelease(release(), '0.1.0', 'arm64').error, 'updateArchitecture');
});
test('verified update is written only after size and SHA-256 match, without executing it', async t => {
  const { updater, calls } = harness(t);
  assert.equal((await updater.check()).status, 'available');
  assert.equal((await updater.download()).status, 'ready');
  assert.deepEqual(fs.readFileSync(updater.readyFile()), binary);
  assert.equal(fs.statSync(updater.readyFile()).mode & 0o777, 0o700);
  assert.equal(calls.length, 2); assert.ok(calls.every(call => call.options.redirect === 'manual'));
});
test('a missing digest blocks download', async t => {
  const { updater, directory, calls } = harness(t, release({ digest: null }));
  assert.equal((await updater.check()).canDownload, false);
  assert.equal((await updater.download()).error, 'updateNoDigest');
  assert.equal(calls.length, 1); assert.deepEqual(fs.readdirSync(directory), []);
});
test('bad hashes discard the partial download', async t => {
  const { updater, directory } = harness(t, release(), () => new Response(Buffer.alloc(binary.length)));
  await updater.check(); assert.equal((await updater.download()).error, 'updateHashMismatch'); assert.deepEqual(fs.readdirSync(directory), []);
});
test('truncated and oversized downloads are rejected and cleaned up', async t => {
  for (const bytes of [Buffer.from('short'), Buffer.alloc(binary.length + 1)]) {
    const { updater, directory } = harness(t, release(), () => new Response(bytes));
    await updater.check(); assert.equal((await updater.download()).error, 'updateSizeMismatch'); assert.deepEqual(fs.readdirSync(directory), []);
  }
});
test('untrusted redirects and download origins are rejected before following them', async t => {
  const { updater, calls, directory } = harness(t, release(), () => new Response(null, { status: 302, headers: { location: 'https://example.org/evil' } }));
  await updater.check(); assert.equal((await updater.download()).error, 'updateOriginInvalid'); assert.equal(calls.length, 2); assert.deepEqual(fs.readdirSync(directory), []);
  assert.throws(() => selectRelease(release({ browser_download_url: 'https://example.org/evil' }), '0.1.0', 'x64'), /updateMetadataInvalid/);
});
test('cancelled updates leave no executable or partial file', async t => {
  const { updater, directory } = harness(t);
  await updater.check(); const pending = updater.download(); updater.cancel();
  assert.equal((await pending).status, 'available'); assert.deepEqual(fs.readdirSync(directory), []); assert.equal(updater.readyFile(), undefined);
});
