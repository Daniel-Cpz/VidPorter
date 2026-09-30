const {net, app, BrowserWindow, WebContentsView, session, ipcMain, dialog, shell, clipboard} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const {chromiumFetch} = require('./lib/transport.cjs');
const {Engine} = require('./lib/engine.cjs');
const {isHTTP, kind, header, sizeFromHeaders, visible} = require('./lib/media.cjs');

const quality = require('./lib/quality.cjs');
const qualityQueue = [];
let qualityActive = 0;
async function probeQuality(resource) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 12000);
  try {
    const response = await engine.request({resource, abort}, resource.url);
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try {
      while (true) {
        const result = await reader.read(); if (result.done) break;
        size += result.value.length; if (size > 2*1024*1024) throw new Error('播放列表过大');
        chunks.push(Buffer.from(result.value));
      }
    } finally { await reader.cancel().catch(() => {}); }
    const found = quality.fromManifest(Buffer.concat(chunks).toString('utf8'));
    const current = resources.get(resource.key);
    if (found && current?.id === resource.id) current.quality = found;
  } catch {} finally { clearTimeout(timer); }
}
function runQualityQueue() {
  while (qualityActive < 2 && qualityQueue.length) {
    const resource = qualityQueue.shift();
    if (resources.get(resource.key)?.id !== resource.id) continue;
    qualityActive++;
    void probeQuality(resource).finally(() => {qualityActive--; send('resources', publicResources()); runQualityQueue();});
  }
}

const {matchesURL} = require('./lib/url-filter.cjs');
const {parseSources, matchesSource} = require('./lib/source.cjs');
function allowedSource(url) { return matchesSource(url, config.sources, config.sourceSubdomains) && matchesURL(url,config.urlInclude,config.urlExclude); }

let win, view, engine, browserSession, configFile;
const tabs = new Map(); let activeTab = null, lastBounds = {x:0,y:0,width:0,height:0}, browserVisible = false;
const filterConfig = () => ({minimum:config.minimum, hideUnknown:config.hideUnknown, sources:[...config.sources], sourceSubdomains:config.sourceSubdomains,urlInclude:config.urlInclude||'',urlExclude:config.urlExclude||''});
function tabState(){return {active:activeTab,tabs:[...tabs.values()].map(t=>({id:t.id,title:t.title,url:t.url})),config:filterConfig(),resources:publicResources()};}
function announceTabs(){send('tabs',tabState());}
function activateTab(id){
  const target=tabs.get(id);if(!target)return;
  const old=tabs.get(activeTab);if(old){old.filters=filterConfig();old.view.setVisible(false);}
  activeTab=id;view=target.view;Object.assign(config,target.filters);view.setBounds(lastBounds);view.setVisible(browserVisible);announceTabs();
}
function createTab(url='about:blank'){
  const child=new WebContentsView({webPreferences:{partition:'persist:streamcatch-browser',nodeIntegration:false,contextIsolation:true,sandbox:true}});
  const id=child.webContents.id;const t={id,view:child,title:'新标签页',url,filters:filterConfig()};tabs.set(id,t);win.contentView.addChildView(child);child.setVisible(false);attachBrowser(child.webContents);
  const navigated=url=>{t.url=url;if(isHTTP(url)){config.lastPage=url;saveConfig();}if(activeTab===id)send('navigation',{url});announceTabs();};
  child.webContents.on('did-navigate',(_e,url)=>navigated(url));
  child.webContents.on('did-navigate-in-page',(_e,url,main)=>{if(main)navigated(url);});
  child.webContents.on('page-title-updated',(_e,title)=>{t.title=title||'新标签页';announceTabs();});
  child.webContents.on('did-fail-load',(_e,code,message,_url,main)=>{if(main&&code!==-3)send('notice','网页加载失败：'+message);});
  activateTab(id);void child.webContents.loadURL(url).catch(error=>send('notice',error.message));return id;
}
function closeTab(id){
  const target=tabs.get(id);if(!target)return;tabs.delete(id);win.contentView.removeChildView(target.view);target.view.webContents.close();
  for(const [key,r] of resources)if(r.tabId===id)resources.delete(key);
  if(activeTab===id){activeTab=null;if(tabs.size)activateTab([...tabs.keys()].at(-1));else createTab();}
  announceTabs();
}
const resources = new Map(), requestLog = new Map(), headersByURL = new Map(), browserIDs = new Set();
let config = {directory: '', minimum: 0, hideUnknown: false, threads: 4, sources: [], sourceSubdomains: false,urlInclude:'',urlExclude:''};
function send(name, value) { if (win && !win.isDestroyed()) win.webContents.send(name, value); }
function publicResources() {
  return [...resources.values()].filter(r=>r.tabId===activeTab).map(({id, title, kind, size, url, status, quality}) => ({id, title, kind, size, quality, url,
    host: new URL(url).hostname, status, visible: visible(size, config.minimum, config.hideUnknown) && allowedSource(url)}));
}
function saveConfig() { fs.writeFileSync(configFile, JSON.stringify(config)); }
function addResource(data) {
  if (!isHTTP(data.url) || !data.kind || !tabs.has(data.tabId)) return;
  const key = data.tabId+'\n'+data.url;
  const old = resources.get(key);
  if (!old && resources.size >= 1000) return;
  const resource = {...old, ...data, key, id: old?.id || require('node:crypto').randomUUID()};
  if (resource.kind === 'HLS' || resource.kind === 'DASH') resource.size = null;
  resource.quality ||= quality.fromURL(resource.url);
  resources.set(key, resource);
  if (!old && resource.kind === 'HLS') { qualityQueue.push(resource); runQualityQueue(); }
  send('resources', publicResources());
}
function attachBrowser(contents) {
  browserIDs.add(contents.id);
  contents.on('destroyed', () => browserIDs.delete(contents.id));
  contents.on('will-navigate', (event, url) => { if (!isHTTP(url) && url !== 'about:blank') event.preventDefault(); });
  contents.setWindowOpenHandler(({url}) => {if(isHTTP(url)||url==='about:blank')createTab(url);return {action:'deny'};});
}
function installCapture() {
  const filter = {urls: ['http://*/*', 'https://*/*']};
  browserSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    if (browserIDs.has(details.webContentsId)) {
      requestLog.set(details.id, {headers: {...details.requestHeaders}, referrer: details.referrer,
        tabId: details.webContentsId, url: details.url, method: details.method, contents: details.webContents});
      headersByURL.set(details.url, {...details.requestHeaders});
      if (headersByURL.size > 2000) headersByURL.delete(headersByURL.keys().next().value);
      if (requestLog.size > 5000) requestLog.delete(requestLog.keys().next().value);
    }
    // Do not reapply Chromium-generated headers to background download requests.
    callback({});
  });
  browserSession.webRequest.onResponseStarted(filter, details => {
    const record = requestLog.get(details.id); requestLog.delete(details.id);
    if (!record || record.method !== 'GET' || ![200, 206].includes(details.statusCode)) return;
    const mime = header(details.responseHeaders, 'content-type') || '';
    const type = kind(details.url, mime); if (!type) return;
    const wc = record.contents;
    const title = wc && !wc.isDestroyed() ? wc.getTitle() : new URL(details.url).hostname;
    addResource({tabId:record.tabId,url: details.url, title: title || '视频', kind: type, mime,
      headers: record.headers, size: sizeFromHeaders(details.responseHeaders, details.statusCode), status: details.statusCode});
  });
  browserSession.webRequest.onErrorOccurred(filter, details => requestLog.delete(details.id));
  browserSession.webRequest.onCompleted(filter, details => requestLog.delete(details.id));
  browserSession.on('will-download', (event, item, contents) => {
    if (!contents || !browserIDs.has(contents.id)) return;
    event.preventDefault();
    const url = item.getURL(), mime = item.getMimeType();
    addResource({tabId:contents.id,url, mime, kind: kind(url, mime), size: item.getTotalBytes() || null,
      title: contents?.getTitle() || item.getFilename(), headers: headersByURL.get(url) || {}, status: 200});
  });
}
function trusted(event) { return event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame; }
app.whenReady().then(async () => {
  // Reuse settings, unfinished jobs, and the browser session for existing installations.
  const legacyUserData = path.join(app.getPath('appData'), 'streamcatch-browser');
  if (fs.existsSync(legacyUserData)) app.setPath('userData', legacyUserData);
  configFile = path.join(app.getPath('userData'), 'settings.json');
  try { config = {...config, ...JSON.parse(fs.readFileSync(configFile, 'utf8'))}; } catch {}
  if(config.sizeUnit!=='MB'){config.minimum=(Number(config.minimum)||0)*1.048576;config.sizeUnit='MB';saveConfig();}
  config.directory ||= path.join(app.getPath('downloads'), 'VidPorter');
  browserSession = session.fromPartition('persist:streamcatch-browser');
  browserSession.setUserAgent(browserSession.getUserAgent().replace(/\sElectron\/\S+/g, '').replace(/\s(?:streamcatch-browser|StreamCatch)\/\S+/gi, ''));
  browserSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  win = new BrowserWindow({width: 1480, height: 940, minWidth: 1100, minHeight: 720,
    title: 'VidPorter '+app.getVersion(), icon: path.join(__dirname, 'icon.png'), backgroundColor: '#f4f6fa',
    webPreferences: {preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true}});
  installCapture();
  let ffmpeg = require('ffmpeg-static');
  if (app.isPackaged) ffmpeg = ffmpeg.replace('app.asar', 'app.asar.unpacked');
  engine = new Engine({fetch: (url, options) => chromiumFetch(net, browserSession, url, options), directory: config.directory,maxRetries:config.retryCount??10, queueFile: path.join(app.getPath('userData'), 'unfinished-downloads.json'),
    ffmpeg, notify: jobs => send('jobs', jobs), lookupHeaders: url => headersByURL.get(url)});
  ipcMain.handle('command', async (event, command, payload) => {
    if (!trusted(event)) throw new Error('无效的消息来源。');
    switch (command) {
      case 'init': return {config,version:app.getVersion(),tabState:tabState(),resources:publicResources(),jobs:engine.publicJobs()};
      case 'tab-switch':activateTab(payload);return;
      case 'tab-close':closeTab(payload);return;
      case 'tab-new':createTab();return;
      case 'jobs-all':if(['resume','pause','cancel','restore'].includes(payload))engine.controlAll(payload);return;
      case 'navigate': {
        let url = String(payload).trim(); if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        if (!isHTTP(url)) throw new Error('请输入 HTTP / HTTPS 网址。');
        createTab(url); return;
      }
      case 'bounds': {
        const [width, height] = win.getContentSize();
        const r = payload || {};
        const x = Math.max(0, Math.min(width, Math.round(Number(r.x) || 0)));
        const y = Math.max(0, Math.min(height, Math.round(Number(r.y) || 0)));
        lastBounds = {x, y, width: Math.max(0, Math.min(width-x, Math.round(Number(r.width) || 0))),
          height: Math.max(0, Math.min(height-y, Math.round(Number(r.height) || 0)))};
        view?.setBounds(lastBounds);
        browserVisible=Boolean(r.visible);view?.setVisible(browserVisible); return;
      }
      case 'back': if (view.webContents.navigationHistory.canGoBack()) view.webContents.navigationHistory.goBack(); return;
      case 'forward': if (view.webContents.navigationHistory.canGoForward()) view.webContents.navigationHistory.goForward(); return;
      case 'reload': view.webContents.reload(); return;
      case 'clear': for(const [key,r] of resources)if(r.tabId===activeTab)resources.delete(key); send('resources', publicResources()); return;
      case 'preferences': {
        config.retryCount=Math.max(0,Math.min(20,Math.floor(Number(payload.retryCount)||0)));engine.maxRetries=config.retryCount;
        config.language=payload.language==='en'?'en':'zh';config.speedUnit=['MiB','MB','Mbps'].includes(payload.speedUnit)?payload.speedUnit:'MB';saveConfig();return true;
      }
      case 'url-filter': {
        config.urlInclude=String(payload.include||'').slice(0,2000);config.urlExclude=String(payload.exclude||'').slice(0,2000);
        saveConfig();send('resources',publicResources());return true;
      }
      case 'sources': {
        const sources = parseSources(payload.text);
        config.sources = sources; config.sourceSubdomains = Boolean(payload.subdomains);
        saveConfig(); send('resources', publicResources()); return sources;
      }
      case 'settings': {
        config.minimum = Math.max(0, Math.min(1048576, Number(payload.minimum) || 0));
        config.threads = Math.max(1, Math.min(8, Number(payload.threads) || 4));
        config.hideUnknown = Boolean(payload.hideUnknown); saveConfig(); send('resources', publicResources()); return;
      }
      case 'directory': {
        const result = await dialog.showOpenDialog(win, {defaultPath: config.directory, properties: ['openDirectory', 'createDirectory']});
        if (!result.canceled) { config.directory = result.filePaths[0]; engine.directory = config.directory; saveConfig(); }
        return config.directory;
      }
      case 'open-directory': await fs.promises.mkdir(config.directory, {recursive: true}); return shell.openPath(config.directory);
      case 'download': {
        if (!Array.isArray(payload)) return;
        for (const id of payload.slice(0, 100)) {
          const resource = [...resources.values()].find(r => r.id === id);
          if (resource && resource.tabId===activeTab && allowedSource(resource.url) && visible(resource.size, config.minimum, config.hideUnknown)) {
            const taskId=engine.add(resource, config.threads);if(taskId)send('download-added',taskId);
          }
        }
        return;
      }
      case 'delete-task': await engine.deleteCanceled(payload);return true;
      case 'job': if (['pause', 'resume', 'cancel', 'restore'].includes(payload?.action)) engine.control(payload.id, payload.action); return;
      case 'open-result': {
        const job = engine.jobs.find(j => j.id === payload && j.state === 'done');
        if (job?.output) return shell.openPath(job.output); return;
      }
      case 'copy': {
        const resource = [...resources.values()].find(r => r.id === payload); if (resource) clipboard.writeText(resource.url); return;
      }
    }
  });
  win.on('close', event => {
    if (engine.active) {
      const response = dialog.showMessageBoxSync(win, {type: 'question', buttons: ['继续下载', '退出'], defaultId: 0,
        message: '当前正在下载。退出后将保存未完成任务，下次启动可继续。确定退出？'});
      if (response === 0) { event.preventDefault(); return; }
    }
    engine.shutdown();
    for (const child of BrowserWindow.getAllWindows()) if (child !== win) child.destroy();
    for(const t of tabs.values())t.view.webContents.close();
  });
  win.on('closed', () => { win = null; });
  createTab();
  await win.loadFile(path.join(__dirname, 'index.html'));

});
app.on('window-all-closed', () => app.quit());
