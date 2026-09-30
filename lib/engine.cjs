const queue = require('./queue.cjs');
const checkpoint = require('./checkpoint.cjs');
const {retry, MAX_RETRIES} = require('./retry.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {safeName, requestHeaders, isHTTP} = require('./media.cjs');
const hls = require('./hls.cjs');
async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }
async function buffered(response, limit) {
  let size = 0; const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('资源超过当前处理大小上限。');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
class Engine {
  constructor({fetch, directory, ffmpeg, notify, lookupHeaders = () => null, queueFile = null, retryWait, maxRetries=10}) {
    Object.assign(this, {fetch, directory, ffmpeg, notify, lookupHeaders});
    this.maxRetries=maxRetries; this.retryWait = retryWait; this.queueFile = queueFile;
    this.jobs = queue.read(queueFile).map(j=>({...j,stem:safeName(j.title)+'__'+j.id})); this.active = null; this.closed = false;
  }
  publicJobs() {
    return this.jobs.map(({id, title, state, done, total, speed, message, output,segmentsDone,segmentsTotal}) => ({id, title, state, done, total, speed, message, output,segmentsDone,segmentsTotal}));
  }
  report(job, force = false) {
    if (!force && Date.now() - (job.lastReport || 0) < 200) return;
    job.lastReport = Date.now();
    if (force || !this.lastQueueSave || Date.now()-this.lastQueueSave>1000) {
      try {queue.write(this.queueFile, this.jobs);this.lastQueueSave=Date.now();} catch(error) {console.error('保存下载列表失败',error.message);}
    }
    this.notify(this.publicJobs());
  }
  add(resource, threads = 4) {
    if(this.jobs.some(j=>j.deleting&&j.directory===this.directory&&j.resource.url===resource.url))throw new Error('该任务正在删除，请稍后再添加。');
    const previous=this.jobs.find(j=>j.resource.url===resource.url&&j.directory===this.directory&&['queued','running','paused','error'].includes(j.state));
    if(previous){previous.resource={...resource};if(['paused','error'].includes(previous.state))this.control(previous.id,'resume');return previous.id;}
    if (!isHTTP(resource.url)) throw new Error('视频地址无效。');
    if (resource.kind === 'DASH') throw new Error('本版同会话下载支持普通视频和 HLS；暂不支持 DASH。');
    const id = crypto.randomUUID().slice(0, 12);
    const job = {id, title: resource.title, resource: {...resource}, state: 'queued', done: 0, total: null, speed: 0,
      message: '', output: '', directory: this.directory, stem: safeName(resource.title) + '__' + id,
      threads: Math.max(1, Math.min(8, Number(threads) || 4))};
    this.jobs.push(job); this.report(job, true); void this.next(); return id;
  }
  async deleteCanceled(id) {
    const job=this.jobs.find(j=>j.id===id);
    if(!job||job.state!=='canceled'||job.deleting)return;
    if(this.active===job)throw new Error('任务仍在停止，请稍后再删除。');
    if(this.jobs.some(j=>j!==job&&j.directory===job.directory&&j.resource.url===job.resource.url))throw new Error('另一个任务共用此网址的续传文件，请先处理重复任务。');
    job.deleting=true;
    try {
      const key=checkpoint.digest(job.resource.kind+'\n'+job.resource.url);
      const record=path.join(job.directory,'.streamcatch-'+key+'.json');
      let stem=job.stem;
      try {const data=JSON.parse(await fs.readFile(record,'utf8'));if(data.key!==key)throw new Error('续传记录不匹配');stem=data.stem;}
      catch(error){if(error.code!=='ENOENT')throw error;}
      if(typeof stem!=='string'||!stem||/[\\/<>:"|?*]/.test(stem)||stem==='.'||stem==='..')throw new Error('任务文件名无效，未删除文件。');
      await fs.rm(path.join(job.directory,stem+'_parts'),{recursive:true,force:true});
      for(const ext of ['.mp4','.webm','.mkv','.mov','.m4v','.flv','.ogv'])await fs.rm(path.join(job.directory,stem+ext+'.part'),{force:true});
      await fs.rm(record+'.tmp',{force:true});await fs.rm(record,{force:true});
      const remaining=this.jobs.filter(j=>j!==job);queue.write(this.queueFile,remaining);this.jobs=remaining;this.notify(this.publicJobs());
    } finally {job.deleting=false;}
  }
  controlAll(action) {
    // Apply the entire batch before allowing the scheduler to select a job.
    this.batchControl = true;
    try {for (const job of [...this.jobs]) this.control(job.id, action);}
    finally {this.batchControl = false;void this.next();}
  }
  control(id, action) {
    const job = this.jobs.find(j => j.id === id); if (!job) return;
    if ((action === 'resume' && ['paused', 'error'].includes(job.state)) || (action === 'restore' && job.state === 'canceled')) {
      job.state = 'queued'; job.stop = null; job.message = ''; this.report(job, true); void this.next();
    } else if (['pause', 'cancel'].includes(action) && ['running', 'queued', 'paused', 'error'].includes(job.state)) {
      const state = action === 'pause' ? 'paused' : 'canceled';
      if (job.state === 'running') { job.stop = state; job.speed = 0; job.message = action === 'pause' ? '正在停止请求并暂停…' : '正在停止请求并取消…'; job.abort.abort(); job.child?.kill(); }
      else job.state = state;
      this.report(job, true);
    }
  }
  requeueFailedAfterSuccess() {
    for (const failed of this.jobs) {
      if (failed.state !== 'error') continue;
      failed.completionRetryUsed = true;
      failed.state = 'queued'; failed.speed = 0;
      failed.message = '其他任务已完成，重新尝试先前失败的任务';
    }
  }
  async next() {
    if (this.closed || this.active || this.batchControl) return;
    const job = this.jobs.find(j => j.state === 'queued'); if (!job) return;
    this.active = job; job.state = 'running'; job.stop = null; job.abort = new AbortController();
    job.started = Date.now(); job.startBytes = job.done || 0;
    this.report(job, true);
    try {
      await retry(async () => {
      await fs.mkdir(job.directory, {recursive: true});
      if (!await checkpoint.prepare(job)) {
        if (job.resource.kind === 'HLS') await this.downloadHLS(job); else await this.downloadFile(job);
        await checkpoint.save(job);
      }
      }, {signal:job.abort.signal,wait:this.retryWait,maxRetries:()=>this.maxRetries,onRetry:(attempt,ms,error)=>{job.speed=0;job.message=`${error.message} · ${ms/1000} 秒后重试 ${attempt}/${this.maxRetries}`;this.report(job,true);}});
      job.state = 'done'; job.message = job.output; job.speed = 0;
      if (!this.closed) this.requeueFailedAfterSuccess();
    } catch (error) {
      job.state = job.stop || 'error'; job.speed = 0;
      job.message = job.stop === 'paused' ? '已保留进度，点击继续可恢复。' : job.stop === 'canceled' ? '已取消，未完成文件保留。' : error.message;
    } finally {
      job.child = null; this.active = null; this.report(job, true); void this.next();
    }
  }
  check(job) { if (job.abort.signal.aborted) throw new Error('任务已停止。'); }
  async request(job, address, extra = {}) {
    for (let redirect = 0; redirect < 6; redirect++) {
      this.check(job);
      if (!isHTTP(address)) throw new Error('资源使用了不支持的协议。');
      const observed = this.lookupHeaders(address);
      const headers = requestHeaders(observed || job.resource.headers, observed ? address : job.resource.url, address);
      const response = await this.fetch(address, {headers: {...headers, ...extra}, credentials: 'include',
        redirect: 'manual', signal: AbortSignal.any([job.abort.signal, AbortSignal.timeout(60000)]), bypassCustomProtocolHandlers: true});
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location'); await response.body?.cancel();
        if (!location) throw new Error('服务器重定向缺少地址。');
        address = new URL(location, address).href; continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        const site = new URL(address).hostname;
        throw new Error(`HTTP ${response.status} · ${site} 拒绝请求。请在内置浏览器完成正常访问并重新捕获资源。`);
      }
      // Electron documents Response.url as unreliable. Keep the URL we actually
      // requested after handling redirects for relative HLS URI resolution.
      response.streamcatchURL = address;
      return response;
    }
    throw new Error('资源重定向次数过多。');
  }
  async downloadFile(job) {
    const ext = path.extname(new URL(job.resource.url).pathname).toLowerCase();
    const suffix = ['.mp4', '.webm', '.mkv', '.mov', '.m4v', '.flv', '.ogv'].includes(ext) ? ext :
      job.resource.mime?.includes('webm') ? '.webm' : '.mp4';
    const target = path.join(job.directory, job.stem + suffix), partial = target + '.part';
    if (await exists(target)) throw new Error('目标文件已经存在。');
    let offset = await exists(partial) ? (await fs.stat(partial)).size : 0;
    if (!job.validator) offset = 0;
    const response = await this.request(job, job.resource.url, offset ? {'Range': `bytes=${offset}-`, 'If-Range': job.validator} : {});
    const mime = (response.headers.get('content-type') || '').toLowerCase();
    if (/text\/html|application\/json/.test(mime)) { await response.body.cancel(); throw new Error('返回的是网页或验证信息，不是视频。'); }
    const length = response.headers.get('content-length');
    let total = /^\d+$/.test(length || '') ? Number(length) : null;
    if (response.status === 206) {
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
      if (!offset || !match || Number(match[1]) !== offset || Number(match[2]) + 1 !== Number(match[3]) ||
          (total != null && total !== Number(match[3]) - offset) ||
          (job.etag && response.headers.get('etag') && job.etag !== response.headers.get('etag'))) {
        await response.body.cancel(); throw new Error('续传范围或文件校验信息改变，请新建任务。');
      }
      total = Number(match[3]);
    } else if (response.status === 200) {
      if (offset) job.message = '服务器不支持续传或文件更新，从头下载。';
      offset = 0;
    } else { await response.body.cancel(); throw new Error('不支持的文件响应。'); }
    const etag = response.headers.get('etag');
    job.etag = etag?.startsWith('W/') ? null : etag;
    job.validator = job.etag || response.headers.get('last-modified') || null;
    await checkpoint.save(job);
    job.done = offset; job.startBytes = offset; job.total = total;
    const file = await fs.open(partial, offset ? 'a' : 'w');
    try {
      for await (const data of response.body) {
        this.check(job);
        let written = 0;
        while (written < data.length) written += (await file.write(data, written, data.length-written)).bytesWritten;
        job.done += data.length; job.speed = (job.done-job.startBytes)/Math.max(.001, (Date.now()-job.started)/1000); this.report(job);
      }
    } finally { await file.close(); }
    this.check(job);
    if (!job.done || (total != null && job.done !== total)) throw new Error('文件尚未下载完整，可点击继续。');
    await fs.rename(partial, target); job.output = target;
  }
  async downloadHLS(job) {
    job.message = '正在使用浏览器会话读取播放列表…'; this.report(job, true);
    const folder = path.join(job.directory, job.stem + '_parts'); await fs.mkdir(folder, {recursive: true});
    if (!job.tracks) job.tracks = await hls.resolve(job.resource.url, async address => {
      const response = await this.request(job, address);
      return {text: (await buffered(response, 2*1024*1024)).toString('utf8'), url: response.streamcatchURL};
    });
    const fingerprint = checkpoint.digest(JSON.stringify(job.tracks));
    if (job.fingerprint && job.fingerprint !== fingerprint) throw new Error('播放列表已变化，不能安全复用旧分片。请选择新的下载目录。');
    job.fingerprint = fingerprint; await checkpoint.save(job);
    job.keys ||= new Map();
    const units = [], playlists = [];
    for (let t = 0; t < job.tracks.length; t++) {
      const segments = job.tracks[t].segments;
      const text = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-TARGETDURATION:' + Math.ceil(Math.max(...segments.map(s => s.duration))), '#EXT-X-MEDIA-SEQUENCE:0'];
      let previousMap = null, mapIndex = 0;
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const mapKey = JSON.stringify(segment.map);
        if (segment.discontinuity) text.push('#EXT-X-DISCONTINUITY');
        if (segment.map && mapKey !== previousMap) {
          const name = `t${t}_init${mapIndex++}.mp4`;
          units.push({...segment.map, name}); text.push(`#EXT-X-MAP:URI="${name}"`); previousMap = mapKey;
        }
        const name = `t${t}_s${i}.bin`;
        units.push({...segment, name}); text.push('#EXTINF:' + segment.duration + ',', name);
      }
      text.push('#EXT-X-ENDLIST');
      const file = path.join(folder, `track${t}.m3u8`); await fs.writeFile(file, text.join('\n')); playlists.push(file);
    }
    let index = 0, completed = 0;
    job.segmentsTotal=units.filter(u=>u.duration!=null).length;job.segmentsDone=0;
    job.total = null; job.done = 0; job.startBytes = 0; job.started = Date.now();
    const fetchUnit = async unit => {
      const target = path.join(folder, unit.name);
      if (await exists(target)) {
        try {
          const saved = await fs.readFile(target);
          const expected = (await fs.readFile(target + '.sha256', 'utf8')).trim();
          if (saved.length && checkpoint.digest(saved) === expected) {job.done += saved.length; job.startBytes += saved.length; return;}
        } catch {}
      }
      const range = unit.range;
      const response = await this.request(job, unit.url, range ? {Range: `bytes=${range.offset}-${range.offset+range.length-1}`} : {});
      if (range) {
        const expected = new RegExp(`^bytes ${range.offset}-${range.offset+range.length-1}/\\d+$`);
        if (response.status !== 206 || !expected.test(response.headers.get('content-range') || '')) {
          await response.body.cancel(); throw new Error('服务器未返回所需的 HLS 字节范围。');
        }
      }
      if (/text\/html/i.test(response.headers.get('content-type') || '')) { await response.body.cancel(); throw new Error('分片请求返回了验证页面。'); }
      let data = await buffered(response, 64*1024*1024);
      if (!data.length || (range && data.length !== range.length)) throw new Error('分片为空或不完整。');
      if (unit.key) {
        if (!job.keys.has(unit.key.url)) {
          const keyResponse = await this.request(job, unit.key.url);
          const key = await buffered(keyResponse, 1024);
          if (key.length !== 16) throw new Error('服务器未返回有效的 AES-128 视频密钥。');
          job.keys.set(unit.key.url, key);
        }
        const decipher = crypto.createDecipheriv('aes-128-cbc', job.keys.get(unit.key.url), hls.ivBytes(unit.key.iv, unit.sequence));
        data = Buffer.concat([decipher.update(data), decipher.final()]);
      }
      this.check(job);
      await fs.writeFile(target + '.part', data); this.check(job); await fs.rename(target + '.part', target);
      await fs.writeFile(target + '.sha256', checkpoint.digest(data));
      job.done += data.length; job.speed = (job.done-job.startBytes)/Math.max(.001, (Date.now()-job.started)/1000); this.report(job);
    };
    let firstError = null;
    const workers = Array.from({length: job.threads}, async () => {
      try {
        while (index < units.length) { this.check(job); const current = index++; try {
            await retry(() => fetchUnit(units[current]), {signal: job.abort.signal,wait:this.retryWait,maxRetries:()=>this.maxRetries,
              onRetry: (attempt, ms) => {job.message = `分片 ${current+1} / ${units.length} 连接中断，${ms/1000} 秒后重试 ${attempt}/${this.maxRetries}`; this.report(job, true);}});
          } catch(error) {
            if (!job.stop) error.message = `分片 ${current+1} / ${units.length} · ${new URL(units[current].url).pathname} · ${error.message}`;
            throw error;
          }
          if(units[current].duration!=null)job.segmentsDone++;
          job.message = `已处理分片 ${++completed} / ${units.length}`; this.report(job); }
      } catch (error) { firstError ||= error; job.abort.abort(); }
    });
    await Promise.allSettled(workers);
    if (firstError) throw firstError;
    this.check(job);
    job.message = '分片下载完成，正在合并…'; job.speed = 0; this.report(job, true);
    const output = path.join(job.directory, job.stem + '.mkv'), temp = path.join(folder, 'output.partial.mkv');
    if (await exists(output)) throw new Error('目标文件已经存在。');
    const args = ['-hide_banner', '-loglevel', 'error', '-y'];
    for (const playlist of playlists) args.push('-protocol_whitelist', 'file,crypto,data', '-allowed_extensions', 'ALL', '-i', playlist);
    if (playlists.length === 2) args.push('-map', '0:v:0', '-map', '1:a:0');
    args.push('-c', 'copy', temp);
    await new Promise((resolve, reject) => {
      const child = spawn(this.ffmpeg, args, {windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']});
      job.child = child; let error = '';
      child.stderr.on('data', chunk => { error = (error+chunk.toString()).slice(-3000); });
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve() : reject(new Error('合并失败：' + error)));
    });
    this.check(job); await fs.rename(temp, output); job.output = output;
    // Keep checkpoints until the complete output exists; never delete the source page or user files.
    try { await fs.rm(folder, {recursive: true}); } catch { job.message = '已完成；部分临时分片未能清理。'; }
  }
  shutdown() { this.closed = true; if (this.active) this.control(this.active.id, 'pause'); }
}
module.exports = {Engine, buffered};
