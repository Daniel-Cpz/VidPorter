const $ = id => document.getElementById(id);
const api = window.streamcatch;
let speedUnit='MB';
function speedText(n){return (speedUnit==='Mbps'?n*8/1000000:speedUnit==='MiB'?n/1048576:n/1000000).toFixed(1)+' '+(speedUnit==='Mbps'?'Mbps':speedUnit+'/s');}
let resources = [], jobs = [], browsing = true, opened = false, taskCategory = 'pending';
let checked = new Set(), activeBrowserTab = null;
const tabSelections = new Map(), tabDrafts = new Map();
const labels = {queued:'等待中',running:'下载中',paused:'已暂停',canceled:'已取消',done:'已完成',error:'失败'};
function bytes(n) { if (n == null) return '大小未知'; for (const u of ['B','KB','MB','GB']) { if(n<1000 || u==='GB') return n.toFixed(1)+' '+u; n/=1000; } }
let downloadToastTimer;
function hideDownloadToast(){clearTimeout(downloadToastTimer);$('downloadToast').hidden=true;}
function showDownloadToast(){clearTimeout(downloadToastTimer);$('downloadToast').hidden=false;downloadToastTimer=setTimeout(hideDownloadToast,5000);}
$('closeDownloadToast').onclick=hideDownloadToast;
function notice(text) { $('notice').textContent = text; $('notice').title = text; }
async function command(name, payload) { try { return await api.command(name, payload); } catch(error) { notice(error.message); return null; } }
function bounds() { const r = $('browserSlot').getBoundingClientRect(); void command('bounds', {x:r.x,y:r.y,width:r.width,height:r.height,visible:browsing && opened && !$('settingsDialog').open}); }
function tab(value) { browsing = value; $('browse').hidden = !value; $('tasks').hidden = value; $('browseTab').classList.toggle('active',value); $('tasksTab').classList.toggle('active',!value);if(!value)$('taskSubnav').hidden=false;$('pendingTasks').classList.toggle('active',!value&&taskCategory==='pending');$('completedTasks').classList.toggle('active',!value&&taskCategory==='done');bounds(); }
function button(text, fn) { const b=document.createElement('button');b.textContent=text;b.onclick=fn;return b; }
function drawTabs(state) {
  const live=new Set(state.tabs.map(t=>t.id));
  if(activeBrowserTab!==state.active){
    if(activeBrowserTab!==null){tabSelections.set(activeBrowserTab,checked);tabDrafts.set(activeBrowserTab,{text:$('sourceText').value,subdomains:$('sourceSubdomains').checked});}
    activeBrowserTab=state.active;checked=tabSelections.get(state.active)||new Set();
    $('minimum').value=state.config.minimum;$('unknown').checked=state.config.hideUnknown;
    const draft=tabDrafts.get(state.active);$('sourceText').value=draft?draft.text:(state.config.sources||[]).join(', ');$('sourceSubdomains').checked=draft?draft.subdomains:Boolean(state.config.sourceSubdomains);
    sourceStatus(state.config.sources||[],state.config.sourceSubdomains);$('urlInclude').value=state.config.urlInclude||'';$('urlExclude').value=state.config.urlExclude||'';
    const current=state.tabs.find(t=>t.id===state.active);$('address').value=current?.url==='about:blank'?'':current?.url||'';
  }
  for(const id of tabSelections.keys())if(!live.has(id)){tabSelections.delete(id);tabDrafts.delete(id);}
  const bar=$('browserTabs');bar.replaceChildren();
  for(const t of state.tabs){const item=document.createElement('div');item.className='browser-tab'+(t.id===state.active?' selected':'');
    const choose=button(t.title||'新标签页',()=>{tab(true);void command('tab-switch',t.id);});choose.title=t.url;
    const close=button('×',()=>command('tab-close',t.id));close.setAttribute('aria-label','关闭 '+t.title);item.append(choose,close);bar.append(item);}
  bar.append(button('+',()=>{tab(true);void command('tab-new');}));resources=state.resources;opened=Boolean(state.active);drawResources();bounds();
}
function drawSources() {
  const select=$('sourceSelect');select.replaceChildren(new Option('从已识别来源中选择并添加…',''));
  for(const host of [...new Set(resources.map(r=>r.host))].sort())select.add(new Option(host,host));
}
function sourceStatus(sources, subdomains) {
  $('sourceStatus').textContent='当前：'+(sources.length?sources.join('、')+(subdomains?'（包含子域名）':'（精确域名）'):'全部来源');
}
function drawResources() {
  drawSources();
  const list=$('resources');list.replaceChildren();const shown=resources.filter(r=>r.visible);
  $('resourceCount').textContent=shown.length+' / '+resources.length;
  for(const id of checked) if(!shown.some(r=>r.id===id)) checked.delete(id);
  if(!shown.length){const e=document.createElement('p');e.className='empty';e.textContent='播放视频后等待成功的媒体请求';list.append(e);}
  for(const r of shown){
    const row=document.createElement('div');row.className='resource';
    const check=document.createElement('input');check.type='checkbox';check.checked=checked.has(r.id);check.onchange=()=>check.checked?checked.add(r.id):checked.delete(r.id);
    const info=document.createElement('div');info.className='resource-info';
    const title=document.createElement('strong');title.textContent=r.title;title.title=r.title;
    const meta=document.createElement('p');meta.textContent=r.kind+' · '+bytes(r.size)+' · HTTP '+r.status;
    const host=document.createElement('p');host.textContent=r.host;
    const resolution=document.createElement('p');resolution.textContent='清晰度：'+(r.quality?r.quality.label+'（'+r.quality.source+'）':'未知');
    const address=document.createElement('p');address.className='resource-address';address.textContent=r.url;address.title=r.url;
    const direct=button('下载',async()=>{direct.disabled=true;try{await api.command('download',[r.id]);notice('已提交下载任务，可在下载任务页查看。');}catch(error){notice(error.message);}finally{direct.disabled=false;}});direct.className='primary resource-download';
    const details=document.createElement('div');details.className='resource-details';details.append(resolution,meta,host,address);
    const body=document.createElement('div');body.className='resource-body';body.append(details,direct);
    info.append(title,body,button('复制地址',()=>command('copy',r.id)));
    row.append(check,info);list.append(row);
  }
}
function drawJobs(){
  $('count').textContent=jobs.length;const list=$('jobs');const scrollTop=list.scrollTop;const fragment=document.createDocumentFragment();
  const mode=$('taskFilter').value;
  const doneCount=jobs.filter(j=>j.state==='done').length;
  $('pendingCount').textContent=jobs.length-doneCount;$('completedCount').textContent=doneCount;
  $('taskHeading').textContent=taskCategory==='done'?'已完成':'进行中／未完成';
  $('taskFilter').hidden=taskCategory==='done';$('batchActions').hidden=taskCategory==='done';
  const shown=jobs.filter(j=>taskCategory==='done'?j.state==='done':j.state!=='done'&&(mode==='all'||j.state===mode));
  if(!shown.length){const empty=document.createElement('p');empty.className='group-empty';empty.textContent=taskCategory==='done'?'暂无已完成任务':'当前筛选下暂无未完成任务';fragment.append(empty);}
  for(const j of shown){
    const card=document.createElement('div');card.className='job '+j.state;
    const head=document.createElement('div');head.className='job-head';
    const title=document.createElement('span');title.className='job-title';title.textContent=j.title;
    const state=document.createElement('span');state.className='job-state';state.textContent=labels[j.state];head.append(title,state);
    const progress=document.createElement('progress');progress.max=j.total||1;if(j.state==='done')progress.value=progress.max;else if(j.total)progress.value=j.done;else if(j.state!=='running')progress.value=0;
    const fraction=document.createElement('div');fraction.className='segment-progress';
    if(j.segmentsTotal>0){progress.max=j.segmentsTotal;progress.value=j.state==='done'?j.segmentsTotal:Math.min(j.segmentsDone||0,j.segmentsTotal);fraction.textContent=`${progress.value} / ${j.segmentsTotal} 分片`;}
    const foot=document.createElement('div');foot.className='job-foot';
    const message=document.createElement('div');message.className='job-message';message.textContent=bytes(j.done)+(j.speed?' · '+speedText(j.speed):'')+' · '+(j.message||'等待下载');
    const controls=document.createElement('div');controls.className='job-controls';
    if(['running','queued'].includes(j.state))controls.append(button('暂停',()=>command('job',{id:j.id,action:'pause'})));
    if(['paused','error'].includes(j.state))controls.append(button('继续',()=>command('job',{id:j.id,action:'resume'})));
    if(!['done','canceled'].includes(j.state))controls.append(button('取消',()=>command('job',{id:j.id,action:'cancel'})));
    if(j.state==='canceled'){
      controls.append(button('恢复下载',()=>command('job',{id:j.id,action:'restore'})));
      const remove=button('彻底删除',async()=>{remove.disabled=true;try{if(await command('delete-task',j.id))notice('已删除任务及未完成文件。');}finally{remove.disabled=false;}});remove.className='danger';remove.title='删除任务、未完成分片和续传记录，无法恢复';controls.append(remove);
    }
    if(j.state==='done')controls.append(button('播放文件',()=>command('open-result',j.id)));
    foot.append(message,controls);card.append(head,progress,fraction,foot);fragment.append(card);
  }
  list.replaceChildren(fragment);list.scrollTop=scrollTop;
}
for(const [id,action] of [['startAll','resume'],['pauseAll','pause'],['cancelAll','cancel'],['restoreAll','restore']])$(id).onclick=()=>command('jobs-all',action);
function showTaskCategory(category){taskCategory=category;tab(false);drawJobs();}
$('browseTab').onclick=()=>tab(true);
$('tasksTab').onclick=()=>{if(browsing){showTaskCategory(taskCategory);}else{$('taskSubnav').hidden=!$('taskSubnav').hidden;}};
$('pendingTasks').onclick=()=>showTaskCategory('pending');$('completedTasks').onclick=()=>showTaskCategory('done');
$('navigate').onclick=()=>{opened=true;tab(true);void command('navigate',$('address').value);};
$('address').onkeydown=e=>{if(e.key==='Enter')$('navigate').click();};
for(const name of ['back','forward','reload'])$(name).onclick=()=>command(name);
$('clear').onclick=()=>{checked.clear();void command('clear');};
$('selectAll').onclick=()=>{const shown=resources.filter(r=>r.visible);const all=shown.every(r=>checked.has(r.id));for(const r of shown)all?checked.delete(r.id):checked.add(r.id);drawResources();};
$('download').onclick=async()=>{if(!checked.size){notice('请先勾选视频资源。');return;}await command('download',[...checked]);showTaskCategory('pending');};
$('chooseFolder').onclick=async()=>{const value=await command('directory');if(value)$('directory').value=value;};
$('openSettings').onclick=()=>{void command('bounds',{visible:false});$('settingsDialog').showModal();};
$('closeSettings').onclick=()=>$('settingsDialog').close();
$('settingsDialog').onclose=bounds;
$('saveSettings').onclick=async()=>{const payload={retryCount:Math.max(0,Math.min(20,Math.floor(Number($('retryCount').value)||0))),speedUnit:$('speedUnit').value,language:$('language').value};if(await command('preferences',payload)){speedUnit=payload.speedUnit;window.setLanguage(payload.language);drawJobs();$('settingsDialog').close();}};
$('folderOpen').onclick=()=>command('open-directory');
for(const id of ['minimum','unknown','threads'])$(id).onchange=()=>command('settings',{minimum:$('minimum').value,hideUnknown:$('unknown').checked,threads:$('threads').value});
$('sourceSelect').onchange=()=>{const host=$('sourceSelect').value;if(!host)return;const old=$('sourceText').value.trim();$('sourceText').value=old?old+', '+host:host;};
$('applySources').onclick=async()=>{const subdomains=$('sourceSubdomains').checked;const sources=await command('sources',{text:$('sourceText').value,subdomains});if(sources){$('sourceText').value=sources.join(', ');sourceStatus(sources,subdomains);notice('来源筛选已应用');}};
$('resetSources').onclick=async()=>{const sources=await command('sources',{text:'',subdomains:false});if(sources){$('sourceText').value='';$('sourceSubdomains').checked=false;sourceStatus([],false);}};
$('sourceText').onkeydown=e=>{if(e.key==='Enter')$('applySources').click();};
$('applyKeywords').onclick=async()=>{if(await command('url-filter',{include:$('urlInclude').value,exclude:$('urlExclude').value}))notice('网址关键词筛选已应用');};
$('clearKeywords').onclick=()=>{$('urlInclude').value='';$('urlExclude').value='';$('applyKeywords').click();};
for(const id of ['urlInclude','urlExclude'])$(id).onkeydown=e=>{if(e.key==='Enter')$('applyKeywords').click();};
$('taskFilter').onchange=drawJobs;
api.listen((name,value)=>{if(name==='download-added'){showDownloadToast();}else if(name==='tabs'){drawTabs(value);}else if(name==='resources'){resources=value;drawResources();}else if(name==='jobs'){jobs=value;drawJobs();}else if(name==='navigation')$('address').value=value.url;else notice(value);});
new ResizeObserver(bounds).observe($('browserSlot'));
void (async()=>{const data=await command('init');if(!data)return;resources=data.resources;jobs=data.jobs;$('retryCount').value=data.config.retryCount??10;speedUnit=data.config.speedUnit||'MB';$('speedUnit').value=speedUnit;$('language').value=data.config.language||'zh';window.setLanguage($('language').value);$('appVersion').textContent='版本 '+data.version;document.title='VidPorter '+data.version;$('directory').value=data.config.directory;$('minimum').value=data.config.minimum;$('unknown').checked=data.config.hideUnknown;$('threads').value=data.config.threads;$('sourceText').value=(data.config.sources||[]).join(', ');$('sourceSubdomains').checked=Boolean(data.config.sourceSubdomains);sourceStatus(data.config.sources||[],data.config.sourceSubdomains);drawTabs(data.tabState);drawJobs();if(data.config.lastPage){$('address').value=data.config.lastPage;$('navigate').click();}if(jobs.length)notice('已恢复 '+jobs.length+' 个未完成任务，可在下载任务中继续。');})();
