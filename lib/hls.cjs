const {isHTTP} = require('./media.cjs');
function attributes(text) {
  const result = {};
  for (const match of text.matchAll(/([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))(?:,|$)/g)) result[match[1]] = match[2] ?? match[3];
  return result;
}
function absolute(value, base) {
  const result = new URL(value, base).href;
  if (!isHTTP(result)) throw new Error('播放列表包含不支持的资源协议。');
  return result;
}
function ivBytes(value, sequence) {
  let hex = value ? value.replace(/^0x/i, '') : BigInt(sequence).toString(16);
  if (!/^[\da-f]+$/i.test(hex) || hex.length > 32) throw new Error('无效的 HLS IV。');
  return Buffer.from(hex.padStart(32, '0'), 'hex');
}
function parse(text, base) {
  if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('响应不是 m3u8 播放列表，可能是验证页面。');
  const variants = [], audio = [], segments = [];
  let variant = null, duration = null, key = null, map = null, range = null, sequence = 0, discontinuity = false;
  const offsets = new Map();
  const rangeFor = (spec, url) => {
    if (!spec) return null;
    const m = /^(\d+)(?:@(\d+))?$/.exec(spec);
    if (!m) throw new Error('无法识别分片字节范围。');
    const length = Number(m[1]);
    const offset = m[2] === undefined ? offsets.get(url) : Number(m[2]);
    if (!length || !Number.isSafeInteger(length) || !Number.isSafeInteger(offset)) throw new Error('分片字节范围不完整。');
    offsets.set(url, offset + length);
    return {offset, length};
  };
  for (const line of text.split(/\r?\n/).map(x => x.trim()).filter(Boolean)) {
    if (/^#EXT-X-(DEFINE|GAP|PART|PRELOAD-HINT):?/.test(line)) throw new Error('当前版本不支持此扩展 HLS 播放列表。');
    if (line.startsWith('#EXT-X-STREAM-INF:')) variant = attributes(line.slice(18));
    else if (line.startsWith('#EXT-X-MEDIA:')) {
      const attrs = attributes(line.slice(13));
      if (attrs.TYPE === 'AUDIO' && attrs.URI) audio.push({...attrs, url: absolute(attrs.URI, base)});
    } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) sequence = Number(line.slice(22));
    else if (line.startsWith('#EXTINF:')) duration = Number(line.slice(8).split(',')[0]);
    else if (line.startsWith('#EXT-X-BYTERANGE:')) range = line.slice(17);
    else if (line === '#EXT-X-DISCONTINUITY') discontinuity = true;
    else if (line.startsWith('#EXT-X-KEY:')) {
      const attrs = attributes(line.slice(11));
      if (attrs.METHOD === 'NONE') key = null;
      else {
        if (attrs.METHOD !== 'AES-128' || (attrs.KEYFORMAT && attrs.KEYFORMAT !== 'identity')) throw new Error('不支持 DRM 或 SAMPLE-AES 视频。');
        if (!attrs.URI) throw new Error('缺少 HLS 密钥地址。');
        key = {url: absolute(attrs.URI, base), iv: attrs.IV || null};
      }
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const attrs = attributes(line.slice(11)), url = absolute(attrs.URI, base);
      if (key && !key.iv) throw new Error('加密初始化片段缺少 IV。');
      map = {url, range: rangeFor(attrs.BYTERANGE, url), key: key && {...key}, sequence};
    } else if (!line.startsWith('#')) {
      const url = absolute(line, base);
      if (variant) { variants.push({...variant, url, bandwidth: Number(variant.BANDWIDTH) || 0}); variant = null; }
      else {
        if (!Number.isFinite(duration) || duration <= 0) throw new Error('视频分片时长缺失或无效。');
        segments.push({url, duration, sequence: sequence++, range: rangeFor(range, url), key: key && {...key}, map, discontinuity});
        duration = null; range = null; discontinuity = false;
      }
    }
  }
  if (variants.length) return {type: 'master', variants, audio};
  if (!text.includes('#EXT-X-ENDLIST')) throw new Error('当前版本支持点播视频，暂不支持直播。');
  if (!segments.length) throw new Error('播放列表没有视频分片。');
  return {type: 'media', segments};
}
async function resolve(url, readText, depth = 0) {
  if (depth > 3) throw new Error('播放列表嵌套过深。');
  const response = await readText(url);
  const info = parse(response.text, response.url || url);
  if (info.type === 'media') return [info];
  const choice = [...info.variants].sort((a, b) => b.bandwidth - a.bandwidth)[0];
  const tracks = await resolve(choice.url, readText, depth + 1);
  const group = info.audio.filter(a => a['GROUP-ID'] === choice.AUDIO);
  const audio = group.find(a => a.DEFAULT === 'YES') || group.find(a => a.AUTOSELECT === 'YES') || group[0];
  if (audio) tracks.push(...await resolve(audio.url, readText, depth + 1));
  if (tracks.length > 2) throw new Error('当前不支持两个以上的音视频轨道。');
  return tracks;
}
module.exports = {attributes, parse, resolve, ivBytes};
