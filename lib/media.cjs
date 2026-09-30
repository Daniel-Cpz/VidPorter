const path = require('node:path');
function isHTTP(url) {
  try { const u = new URL(url); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; }
}
function kind(url, mime = '') {
  if (!isHTTP(url)) return '';
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  mime = mime.split(';')[0].trim().toLowerCase();
  if (ext === '.m3u8' || /^(application\/(vnd.apple.mpegurl|x-mpegurl)|audio\/(x-)?mpegurl)$/.test(mime)) return 'HLS';
  if (ext === '.mpd' || mime === 'application/dash+xml') return 'DASH';
  if (['.ts', '.m4s', '.cmfv', '.cmfa', '.aac'].includes(ext) || mime === 'video/mp2t') return '';
  return ['.mp4', '.webm', '.mkv', '.mov', '.m4v', '.flv', '.ogv'].includes(ext) || mime.startsWith('video/') ? 'VIDEO' : '';
}
function header(headers, name) {
  const found = Object.keys(headers || {}).find(k => k.toLowerCase() === name.toLowerCase());
  const value = found ? headers[found] : null;
  return Array.isArray(value) ? value[0] : value;
}
function sizeFromHeaders(headers, status = 200) {
  const range = /^bytes \d+-\d+\/(\d+)$/.exec(header(headers, 'content-range') || '');
  if (range) return Number(range[1]);
  const length = header(headers, 'content-length');
  return status === 200 && /^\d+$/.test(length || '') ? Number(length) : null;
}
function safeName(value) {
  let name = String(value || 'video').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 80);
  if (!name) name = 'video';
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  return name;
}
function requestHeaders(original, originalURL, targetURL) {
  const sameOrigin = new URL(originalURL).origin === new URL(targetURL).origin;
  const result = {};
  for (const [name, value] of Object.entries(original || {})) {
    const lower = name.toLowerCase();
    if (typeof value !== 'string' || /[\r\n]/.test(value)) continue;
    // Cookies come from Chromium's current cookie jar, not a captured string.
    if (['cookie', 'host', 'connection', 'content-length', 'range', 'if-range', 'accept-encoding', 'origin', 'trailer', 'te', 'upgrade', 'cookie2', 'keep-alive', 'transfer-encoding'].includes(lower) || lower.startsWith('sec-')) continue;
    if (lower === 'referer') {
      try {
        const ref = new URL(value);
        if (!['http:', 'https:'].includes(ref.protocol) || ref.username || ref.password) continue;
        if (ref.protocol === 'https:' && new URL(targetURL).protocol !== 'https:') continue;
      } catch { continue; }
    }
    if (sameOrigin || ['user-agent', 'referer', 'accept-language', 'accept'].includes(lower)) result[name] = value;
  }
  result['Accept-Encoding'] = 'identity';
  return result;
}
function visible(size, minimumMB, hideUnknown) {
  return size == null ? !hideUnknown : size >= minimumMB * 1000 * 1000;
}
module.exports = {isHTTP, kind, header, sizeFromHeaders, safeName, requestHeaders, visible};
