const $ = id => document.getElementById(id);
const status = $('status');
let current, draft, editing = null, closing = false, profileDirty = false;
const text = (key, values) => AgripaI18n.t(current?.settings.language || 'es', key, values);
const action = (name, value) => window.agripa.action(name, value);
function report(error) { status.textContent = error.message.replace(/^Error invoking remote method '[^']+': Error: /, ''); status.parentElement.dataset.error = 'true'; status.title = status.textContent; }
function updateOpacity(value) { $('opacity').value = Math.round(value * 100); $('opacity-value').value = `${Math.round(value * 100)} %`; }
function translate() {
  document.documentElement.lang = current.settings.language;
  document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = text(node.dataset.i18n); });
  document.querySelectorAll('[data-i18n-label]').forEach(node => { node.setAttribute('aria-label', text(node.dataset.i18nLabel)); node.title = text(node.dataset.i18nLabel); });
  document.querySelectorAll('[data-i18n-aria]').forEach(node => { node.setAttribute('aria-label', text(node.dataset.i18nAria)); });
  $('profile-name').placeholder = text('profilePlaceholder');
  $('language').value = current.settings.language;
}
function updateBindings() {
  for (const id of Object.keys(AgripaShortcuts.defaults)) {
    const button = document.querySelector(`[data-shortcut="${id}"]`);
    if (!button) continue;
    const changed = draft[id] !== current.settings.shortcuts[id];
    button.textContent = editing === id ? text('shortcutPrompt') : AgripaShortcuts.format(draft[id], current.settings.language);
    button.setAttribute('aria-label', `${text(id)}: ${button.textContent}`);
    button.setAttribute('aria-pressed', String(editing === id));
    const indicator = document.querySelector(`[data-shortcut-status="${id}"]`);
    indicator.textContent = text(editing === id ? 'suspended' : changed ? 'pending' : current.registered[id] ? 'registered' : 'unavailable');
    indicator.dataset.available = String(!changed && Boolean(current.registered[id]));
    document.querySelector(`[data-shortcut-label="${id}"]`).textContent = text(id);
  }
}
function buildBindings() {
  $('shortcuts').replaceChildren();
  for (const id of Object.keys(AgripaShortcuts.defaults)) {
    const row = document.createElement('div'); row.className = 'shortcut-row';
    const label = document.createElement('span'); label.dataset.shortcutLabel = id;
    const binding = document.createElement('div'); binding.className = 'shortcut-binding';
    const button = document.createElement('button'); button.dataset.shortcut = id; button.className = 'shortcut-button'; button.type = 'button';
    const indicator = document.createElement('span'); indicator.dataset.shortcutStatus = id; indicator.className = 'binding-status';
    button.addEventListener('click', async () => {
      try { if (editing) await endAssignment(); editing = id; await action('shortcut-begin'); updateBindings(); button.focus(); }
      catch (error) { editing = null; updateBindings(); report(error); }
    });
    binding.append(button, indicator); row.append(label, binding); $('shortcuts').append(row);
  }
  updateBindings();
}
function updateProfiles(selected = $('profile-select').value || current?.settings.activeProfile || '') {
  const select = $('profile-select'); select.replaceChildren(new Option(text('profileSelect'), ''));
  for (const profile of [...current.settings.profiles].sort((a, b) => a.name.localeCompare(b.name))) select.append(new Option(profile.name, profile.name));
  select.value = current.settings.profiles.some(p => p.name === selected) ? selected : '';
  $('profile-apply').disabled = !select.value; $('profile-delete').disabled = !select.value;
}
function applyState(next) {
  const languageChanged = current?.settings.language !== next.settings.language;
  const profileChanged = current?.settings.activeProfile !== next.settings.activeProfile;
  const bindingsChanged = JSON.stringify(current?.settings.shortcuts) !== JSON.stringify(next.settings.shortcuts);
  current = next;
  if (editing && !next.assigning) editing = null;
  if (!draft || bindingsChanged) draft = { ...next.settings.shortcuts };
  document.body.classList.toggle('compact', next.compact);
  document.body.classList.toggle('layout-locked', next.settings.layoutLocked);
  $('settings').hidden = !next.settingsOpen;
  $('settings-toggle').setAttribute('aria-expanded', String(next.settingsOpen));
  $('compact-toggle').setAttribute('aria-pressed', String(next.compact));
  if (languageChanged) { translate(); updateProfiles(); }
  const label = text(next.compact ? 'restore' : 'compact');
  $('compact-toggle').setAttribute('aria-label', label);
  $('compact-toggle').title = `${label} · ${AgripaShortcuts.format(next.settings.shortcuts.compact, next.settings.language)}`;
  document.querySelector('[data-action="hide"]').title = `${text('hide')} · ${AgripaShortcuts.format(next.settings.shortcuts.toggle, next.settings.language)}`;
  document.querySelector('[data-action="capture"]').title = `${text('capture')} · ${AgripaShortcuts.format(next.settings.shortcuts.capture, next.settings.language)}`;
  $('passthrough').checked = next.passthrough;
  $('layout-lock').checked = next.settings.layoutLocked;
  $('capture-delay').value = String(next.settings.captureDelay);
  $('auto-check-updates').checked = next.settings.autoCheckUpdates;
  $('active-profile').textContent = next.settings.activeProfile || 'ChatGPT';
  $('game-menu').title = next.settings.activeProfile || text('profileMenu');
  if (profileChanged) { updateProfiles(next.settings.activeProfile); fillProfile(next.settings.profiles.find(p => p.name === next.settings.activeProfile)); }
  renderUpdates();
  updateBindings();
}
async function endAssignment() { editing = null; await action('shortcut-end'); updateBindings(); }
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', async () => {
  button.disabled = true;
  try { if (editing) await endAssignment(); await action(button.dataset.action); } catch (error) { report(error); } finally { button.disabled = false; }
}));
async function openSettings(section) {
  if (editing) await endAssignment();
  const next = await action('settings'); draft = { ...next.settings.shortcuts }; applyState(next);
  updateOpacity(next.settings.opacity); updateProfiles();
  fillProfile(next.settings.profiles.find(p => p.name === $('profile-select').value));
  if (section) document.getElementById(section).scrollIntoView();
  else $('opacity').focus({ preventScroll: true });
}
$('settings-toggle').addEventListener('click', async () => {
  if (!$('settings').hidden) { await closeSettings(false); return; }
  try { await openSettings(); } catch (error) { report(error); }
});
$('opacity').addEventListener('input', () => { $('opacity-value').value = `${$('opacity').value} %`; action('opacity', Number($('opacity').value) / 100).catch(report); });
async function closeSettings(save) {
  if (closing) return;
  closing = true; $('save').disabled = $('cancel').disabled = true;
  try {
    if (editing) await endAssignment();
    if (save) { const next = await action('save', { shortcuts: draft, ...(profileDirty ? { profile: readProfile() } : {}) }); applyState(next); profileDirty = false; }
    await action('chat'); draft = { ...current.settings.shortcuts }; updateBindings(); $('settings-toggle').focus();
  } catch (error) { report(error); }
  finally { closing = false; $('save').disabled = $('cancel').disabled = false; }
}
$('save').addEventListener('click', () => closeSettings(true));
$('cancel').addEventListener('click', () => closeSettings(false));
$('language').addEventListener('change', async () => {
  try { if (editing) await endAssignment(); applyState(await action('language', $('language').value)); }
  catch (error) { $('language').value = current.settings.language; report(error); }
});
$('passthrough').addEventListener('change', () => action('passthrough', $('passthrough').checked).catch(error => { $('passthrough').checked = current.passthrough; report(error); }));
$('profile-select').addEventListener('change', () => {
  const profile = current.settings.profiles.find(p => p.name === $('profile-select').value);
  fillProfile(profile);
  if (profile) { draft = { ...profile.shortcuts }; updateBindings(); }
  $('profile-apply').disabled = $('profile-delete').disabled = !$('profile-select').value;
});
for (const operation of ['save', 'apply', 'delete']) $('profile-' + operation).addEventListener('click', async event => {
  event.currentTarget.disabled = true;
  try {
    if (editing) await endAssignment();
    const name = operation === 'save' ? $('profile-name').value.trim() : $('profile-select').value;
    applyState(await action('profile-' + operation, operation === 'save' ? readProfile() : name));
    updateProfiles(operation === 'delete' ? '' : name);
    if (operation === 'apply') { draft = { ...current.settings.shortcuts }; updateBindings(); updateOpacity(current.settings.opacity); }
    fillProfile(current.settings.profiles.find(p => p.name === (operation === 'delete' ? '' : name)));
  } catch (error) { report(error); }
  finally { $('profile-save').disabled = false; $('profile-apply').disabled = $('profile-delete').disabled = !$('profile-select').value; }
});
document.addEventListener('keydown', async event => {
  if (editing) {
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape') { await endAssignment().catch(report); return; }
    const value = AgripaShortcuts.fromEvent(event);
    if (value === undefined) return;
    if (!value) { report(new Error(text('shortcutInvalid'))); return; }
    const id = editing;
    const next = { ...draft, [id]: value };
    try { AgripaShortcuts.validate(next); draft = next; if ($('profile-name').value.trim()) profileDirty = true; await endAssignment(); }
    catch (error) { report(new Error(text(error.message))); }
    return;
  }
  if (event.key === 'Escape') { event.preventDefault(); if (!$('settings').hidden) closeSettings(false); else action('hide').catch(report); }
});
window.agripa.panelState(applyState);
window.agripa.opacityPreview(updateOpacity);
window.agripa.status(({ message, error }) => { status.textContent = message; status.title = message; status.parentElement.dataset.error = String(error); });
action('state').then(next => { applyState(next); updateOpacity(next.settings.opacity); buildBindings(); updateProfiles(); fillProfile(next.settings.profiles.find(p => p.name === next.settings.activeProfile)); }).catch(report);

function readProfile() {
  return { name: $('profile-name').value.trim(), game: $('profile-game').value, answerLanguage: $('answer-language').value, spoilers: $('spoilers').value, progress: $('game-progress').value, instructions: $('prompt-instructions').value, quickPrompts: $('quick-prompts').value.split('\n').map(line => line.trim()).filter(Boolean).slice(0, 10), shortcuts: { ...draft } };
}
function previewProfile() { $('prompt-preview').value = AgripaProfiles.prompt(AgripaProfiles.content(readProfile(), $('profile-name').value, current?.settings.language || 'es')); }
function fillProfile(profile) {
  profileDirty = false;
  const value = AgripaProfiles.content(profile, profile?.name, current?.settings.language || 'es');
  $('profile-name').value = profile?.name || '';
  $('profile-game').value = value.game; $('answer-language').value = value.answerLanguage; $('spoilers').value = value.spoilers;
  $('game-progress').value = value.progress; $('prompt-instructions').value = value.instructions; $('quick-prompts').value = value.quickPrompts.join('\n');
  previewProfile();
}
for (const id of ['profile-name', 'profile-game', 'answer-language', 'spoilers', 'game-progress', 'prompt-instructions', 'quick-prompts']) $(id).addEventListener('input', () => { profileDirty = true; previewProfile(); });
$('copy-context').addEventListener('click', () => action('copy-draft-context', readProfile()).catch(report));
for (const [id, key, read] of [['layout-lock', 'layoutLocked', node => node.checked], ['capture-delay', 'captureDelay', node => Number(node.value)], ['auto-check-updates', 'autoCheckUpdates', node => node.checked]]) $(id).addEventListener('change', async () => {
  try { if (editing) await endAssignment(); applyState(await action('preferences', { [key]: read($(id)) })); }
  catch (error) { applyState(current); report(error); }
});
function renderUpdates() {
  const update = current.updates;
  $('app-version').textContent = current.version;
  const key = { idle: 'updateIdle', checking: 'updateChecking', current: 'updateCurrent', available: 'updateAvailable', downloading: 'updateDownloading', ready: 'updateReady', unavailable: 'updateAvailable', error: 'updateNetworkError' }[update.status];
  $('update-status').textContent = update.status === 'error' ? text(update.error || 'updateNetworkError') : text(key, update) + (update.error ? ' ' + text(update.error) : '');
  const busy = ['checking', 'downloading'].includes(update.status);
  $('update-check').disabled = busy;
  $('update-download').hidden = update.status !== 'available'; $('update-download').disabled = !update.canDownload;
  $('update-cancel').hidden = !busy; $('update-reveal').hidden = update.status !== 'ready';
  $('update-progress').hidden = update.status !== 'downloading'; $('update-progress').value = update.progress || 0;
}
for (const operation of ['check', 'download', 'cancel', 'reveal']) $('update-' + operation).addEventListener('click', async () => {
  try { const next = await action('update-' + operation); if (next) applyState(next); } catch (error) { report(error); }
});
window.agripa.openProfiles(() => openSettings('profiles-title').catch(report));
window.agripa.openUpdates(() => openSettings('updates-title').catch(report));
