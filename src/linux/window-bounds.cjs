function restoreBounds(bounds, displays, monitorId) {
  const selected = displays.find(d => String(d.id) === monitorId) || displays.find(({ workArea: a }) => Number.isFinite(bounds.x) && bounds.x < a.x + a.width && bounds.x + bounds.width > a.x && bounds.y < a.y + a.height && bounds.y + bounds.height > a.y) || displays[0];
  const a = selected.workArea;
  const width = Math.min(bounds.width, a.width), height = Math.min(bounds.height, a.height);
  const x = Number.isFinite(bounds.x) ? bounds.x : a.x + a.width - width - 24;
  const y = Number.isFinite(bounds.y) ? bounds.y : a.y + 24;
  return { width, height, x: Math.max(a.x, Math.min(x, a.x + a.width - width)), y: Math.max(a.y, Math.min(y, a.y + a.height - height)) };
}
module.exports = { restoreBounds };
