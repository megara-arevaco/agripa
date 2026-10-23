(function (root) {
  const defaults = Object.freeze({ toggle: 'Control+Alt+Space', capture: 'Control+Alt+C', compact: 'Control+Alt+M', passthrough: 'Control+Alt+I', opacityUp: 'Control+Alt+O', opacityDown: 'Control+Alt+Shift+O' });
  const modifiers = ['Control', 'Alt', 'Shift', 'Super'];
  const keys = /^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Tab|Return|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right)$/;
  function canonical(value) {
    if (typeof value !== 'string') return null;
    const parts = value.split('+');
    const key = parts.pop();
    if (!keys.test(key) || !parts.length || parts.some(p => !modifiers.includes(p)) || new Set(parts).size !== parts.length) return null;
    if (key === 'F4' && parts.includes('Alt')) return null;
    return [...modifiers.filter(p => parts.includes(p)), key].join('+');
  }
  function validate(values) {
    if (!values || typeof values !== 'object') throw new Error('shortcutInvalid');
    const result = {};
    for (const id of Object.keys(defaults)) {
      result[id] = canonical(values[id]);
      if (!result[id]) throw new Error('shortcutInvalid');
    }
    if (new Set(Object.values(result)).size !== Object.keys(defaults).length) throw new Error('shortcutConflict');
    return result;
  }
  function fromEvent(event) {
    const key = event.key;
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return undefined;
    const mapped = { ' ': 'Space', Enter: 'Return', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' }[key] || (key.length === 1 ? key.toUpperCase() : key);
    return canonical([event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super', mapped].filter(Boolean).join('+'));
  }
  function format(value, language = 'es') {
    return value.split('+').map(p => ({ Control: 'Ctrl', Super: 'Super', Shift: language === 'es' ? 'Mayús' : 'Shift', Space: language === 'es' ? 'Espacio' : 'Space' }[p] || p)).join(' + ');
  }
  const api = { defaults, canonical, validate, fromEvent, format };
  if (typeof module !== 'undefined') module.exports = api;
  else root.AgripaShortcuts = api;
})(globalThis);
