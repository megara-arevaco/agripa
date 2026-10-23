const { validate } = require('./shortcuts.js');
function createShortcutManager(native, handlers) {
  let current = {}, registered = {};
  function clear() { for (const value of Object.values(registered)) native.unregister(value); registered = {}; }
  function install(values) {
    const failed = [];
    for (const [id, value] of Object.entries(values)) {
      try { if (native.register(value, handlers[id])) registered[id] = value; else failed.push(id); }
      catch { failed.push(id); }
    }
    return failed;
  }
  return {
    start(values) { current = validate(values); clear(); return install(current); },
    replace(values) {
      const next = validate(values);
      if (Object.keys(next).every(id => next[id] === current[id] && registered[id] && native.isRegistered(next[id]))) return;
      const previous = current;
      clear();
      const failed = install(next);
      if (failed.length) { clear(); install(previous); throw new Error('shortcutUnavailable'); }
      current = next;
    },
    status() { return Object.fromEntries(Object.entries(current).map(([id, value]) => [id, Boolean(registered[id] && native.isRegistered(value))])); },
    suspend(value) { native.setSuspended(value); },
    clear
  };
}
module.exports = { createShortcutManager };
