(function (root) {
  function cropRect(start, end, width, height) {
    if (![start?.x, start?.y, end?.x, end?.y, width, height].every(Number.isFinite) || width < 1 || height < 1) return null;
    const x = Math.max(0, Math.floor(Math.min(start.x, end.x)));
    const y = Math.max(0, Math.floor(Math.min(start.y, end.y)));
    const right = Math.min(width, Math.ceil(Math.max(start.x, end.x)));
    const bottom = Math.min(height, Math.ceil(Math.max(start.y, end.y)));
    if (right - x < 2 || bottom - y < 2) return null;
    return { x, y, width: right - x, height: bottom - y };
  }
  function validRect(rect, size) {
    return rect && ['x', 'y', 'width', 'height'].every(key => Number.isInteger(rect[key])) && rect.x >= 0 && rect.y >= 0 && rect.width >= 2 && rect.height >= 2 && rect.x + rect.width <= size.width && rect.y + rect.height <= size.height;
  }
  const api = { cropRect, validRect };
  if (typeof module !== 'undefined') module.exports = api;
  else root.AgripaCapture = api;
})(globalThis);
