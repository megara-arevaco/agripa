const fs = require('node:fs');
const path = require('node:path');
const shortcuts = require('./shortcuts.js');
const profileContent = require('./profiles.js').content;
function opacity(value) { return Number.isFinite(value) ? Math.min(1, Math.max(.3, value)) : .85; }
function geometry(b) {
  const bounds = { width: 700, height: 760 };
  if (b && Number.isFinite(b.width) && Number.isFinite(b.height)) {
    bounds.width = Math.max(400, Math.min(8192, Math.round(b.width)));
    bounds.height = Math.max(520, Math.min(8192, Math.round(b.height)));
    if (Number.isFinite(b.x) && Number.isFinite(b.y)) { bounds.x = Math.round(b.x); bounds.y = Math.round(b.y); }
  }
  return bounds;
}
function normalize(value) {
  let bindings;
  try { bindings = shortcuts.validate({ ...shortcuts.defaults, ...value?.shortcuts }); } catch { bindings = { ...shortcuts.defaults }; }
  const profiles = [], names = new Set();
  if (Array.isArray(value?.profiles)) for (const p of value.profiles.slice(0, 50)) {
    if (typeof p?.name !== 'string') continue;
    const name = p.name.trim(), lower = name.toLowerCase();
    if (!name || name.length > 32 || names.has(lower)) continue;
    names.add(lower);
    let profileShortcuts;
    try { profileShortcuts = shortcuts.validate(p.shortcuts || bindings); } catch { profileShortcuts = { ...bindings }; }
    profiles.push({ name, opacity: opacity(p.opacity), bounds: geometry(p.bounds), monitorId: typeof p.monitorId === 'string' ? p.monitorId : '', shortcuts: profileShortcuts, ...profileContent(p, name, value?.language === 'en' ? 'en' : 'es') });
  }
  return { opacity: opacity(value?.opacity), bounds: geometry(value?.bounds), monitorId: typeof value?.monitorId === 'string' ? value.monitorId : '', language: value?.language === 'en' ? 'en' : 'es', shortcuts: bindings, profiles, activeProfile: profiles.some(p => p.name === value?.activeProfile) ? value.activeProfile : '', captureDelay: [0, 3, 5].includes(value?.captureDelay) ? value.captureDelay : 0, layoutLocked: value?.layoutLocked === true, autoCheckUpdates: value?.autoCheckUpdates === true };
}
function parse(file) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SyntaxError('Invalid settings');
  return value;
}
function read(file) {
  let primaryError;
  try { return { settings: normalize(parse(file)), recovery: null }; } catch (error) { primaryError = error; }
  try { return { settings: normalize(parse(file + '.bak')), recovery: 'settingsRecovered' }; } catch {}
  return { settings: normalize(null), recovery: primaryError.code === 'ENOENT' ? null : 'settingsReset' };
}
function load(file) { return read(file).settings; }
function save(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const data = JSON.stringify(normalize(value));
  try {
    const previous = fs.readFileSync(file, 'utf8');
    try { parse(file); }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      fs.writeFileSync(file + '.corrupt-' + Date.now(), previous, { mode: 0o600, flag: 'wx' });
      throw error;
    }
    fs.writeFileSync(file + '.bak', previous, { mode: 0o600 });
  } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  fs.writeFileSync(file + '.tmp', data, { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
}
module.exports = { normalize, load, read, save };
