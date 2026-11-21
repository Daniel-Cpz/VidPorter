const fs = require('node:fs/promises');
const path = require('node:path');
const {createReadStream} = require('node:fs');
const {pipeline} = require('node:stream/promises');
const {spawn} = require('node:child_process');
const {randomUUID} = require('node:crypto');
const {digest} = require('./checkpoint.cjs');

async function verified(folder, name, signal) {
  signal?.throwIfAborted();
  try {
    const data = await fs.readFile(path.join(folder, name));
    const hash = (await fs.readFile(path.join(folder, name + '.sha256'), 'utf8')).trim();
    return data.length > 0 && digest(data) === hash;
  } catch(error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function localPlaylist(folder, track, signal) {
  const text = await fs.readFile(path.join(folder, 'track' + track + '.m3u8'), 'utf8');
  const entries = []; let duration = null, map = null, discontinuity = false, skipped = false;
  for (const raw of text.split(/\r?\n/)) {
    signal?.throwIfAborted();
    const line = raw.trim();
    if (line.startsWith('#EXTINF:')) {
      duration = Number(line.slice(8).split(',')[0]);
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('本地分片时长无效。');
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const match = /^#EXT-X-MAP:URI="(t\d+_init\d+\.mp4)"$/.exec(line);
      if (!match || !match[1].startsWith('t' + track + '_')) throw new Error('本地初始化分片无效。');
      map = match[1];
    } else if (line === '#EXT-X-DISCONTINUITY') discontinuity = true;
    else if (line && !line.startsWith('#')) {
      if (!new RegExp('^t' + track + '_s[0-9]+\\.bin$').test(line) || duration === null) throw new Error('本地分片清单无效。');
      if (await verified(folder, line, signal) && (!map || await verified(folder, map, signal))) {
        entries.push({name:line, duration, map, discontinuity:discontinuity || skipped});
        skipped = false;
      } else skipped = true;
      duration = null; discontinuity = false;
    } else if (line.startsWith('#EXT-X-KEY:')) throw new Error('强制合并仅使用已解密的本地分片。');
  }
  if (!entries.length) return null;
  const output = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-TARGETDURATION:' + Math.ceil(Math.max(...entries.map(e=>e.duration))), '#EXT-X-MEDIA-SEQUENCE:0'];
  let previousMap = null;
  for (const entry of entries) {
    if (entry.discontinuity) output.push('#EXT-X-DISCONTINUITY');
    if (entry.map && (entry.map !== previousMap || entry.discontinuity)) output.push('#EXT-X-MAP:URI="../' + entry.map + '"');
    output.push('#EXTINF:' + entry.duration + ',', '../' + entry.name); previousMap = entry.map;
  }
  output.push('#EXT-X-ENDLIST');
  return output.join('\n');
}

async function forceMerge(job, ffmpeg, signal) {
  if (!ffmpeg) throw new Error('未找到 FFmpeg，无法合并。');
  const key = digest(job.resource.kind + '\n' + job.resource.url);
  let stem = job.stem;
  try {
    const record = JSON.parse(await fs.readFile(path.join(job.directory, '.streamcatch-' + key + '.json'), 'utf8'));
    if (record.key !== key || record.kind !== 'HLS') throw new Error('续传记录不匹配。');
    stem = record.stem;
  } catch(error) { if (error.code !== 'ENOENT') throw error; }
  if (typeof stem !== 'string' || !stem || /[\\/<>:"|?*]/.test(stem) || stem === '.' || stem === '..') throw new Error('任务文件名无效。');
  const folder = path.join(job.directory, stem + '_parts');
  let video;
  try { video = await localPlaylist(folder, 0, signal); }
  catch(error) {if(error.code==='ENOENT')throw new Error('没有可合并的本地 HLS 分片，请先开始下载。');throw error;}
  if (!video) throw new Error('没有可合并的完整分片，或分片校验失败。');
  let audio;
  try { audio = await localPlaylist(folder, 1, signal); }
  catch(error) { if (error.code !== 'ENOENT') throw error; }
  const workspace = await fs.mkdtemp(path.join(folder, '.force-merge-'));
  if (!path.resolve(workspace).startsWith(path.resolve(folder) + path.sep)) throw new Error('临时目录无效。');
  const output = path.join(job.directory, stem + '.incomplete-' + randomUUID().slice(0,8) + '.mkv');
  try {
    const playlists = [video, audio].filter(Boolean);
    const args = ['-hide_banner', '-loglevel', 'error', '-y'];
    for (let i=0; i<playlists.length; i++) {
      const file = path.join(workspace, 'track' + i + '.m3u8'); await fs.writeFile(file, playlists[i]);
      args.push('-protocol_whitelist', 'file,crypto,data', '-allowed_extensions', 'ALL', '-i', file);
    }
    if (audio) args.push('-map', '0:v:0?', '-map', '1:a:0?');
    const temp = path.join(workspace, 'output.mkv'); args.push('-c', 'copy', temp);
    signal?.throwIfAborted();
    await new Promise((resolve, reject)=>{
      const child = spawn(ffmpeg, args, {windowsHide:true, stdio:['ignore','ignore','pipe'], signal});
      let details = '', spawnError;
      child.stderr.on('data',data=>{details=(details+data.toString()).slice(-2000);});
      child.on('error',error=>{spawnError=error;});
      child.on('close',code=>spawnError ? reject(spawnError) : code===0 ? resolve() : reject(new Error('强制合并失败：' + details)));
    });
    signal?.throwIfAborted();
    if ((await fs.stat(temp)).size === 0) throw new Error('合并输出为空。');
    // Exclusive creation avoids overwriting files and also works on removable drives.
    const destination = await fs.open(output, 'wx');
    try { await pipeline(createReadStream(temp), destination.createWriteStream(), {signal}); }
    catch(error) { await destination.close().catch(()=>{});await fs.rm(output,{force:true}).catch(()=>{});throw error; }
    finally { await destination.close().catch(()=>{}); }
    return output;
  } finally { await fs.rm(workspace, {recursive:true, force:true}).catch(()=>{}); }
}
module.exports = {forceMerge, localPlaylist};
