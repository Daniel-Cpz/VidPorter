const fs=require('node:fs');const path=require('node:path');const {isHTTP}=require('./media.cjs');
function write(file,jobs){
 if(!file)return;
 const records=jobs.filter(j=>j.state!=='done').map(j=>({id:j.id,state:j.stop==='canceled'?'canceled':j.state,title:j.title,directory:j.directory,threads:j.threads,completionRetryUsed:Boolean(j.completionRetryUsed),done:j.done,total:j.total,segmentsDone:j.segmentsDone,segmentsTotal:j.segmentsTotal,resource:{url:j.resource.url,kind:j.resource.kind,title:j.resource.title,mime:j.resource.mime,headers:Object.fromEntries(Object.entries(j.resource.headers||{}).filter(([k,v])=>k.toLowerCase()==='referer'&&isHTTP(v)))}}));
 fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify({version:1,jobs:records}));fs.renameSync(file+'.tmp',file);
}
function read(file){
 if(!file||!fs.existsSync(file))return [];
 const data=JSON.parse(fs.readFileSync(file,'utf8'));if(data.version!==1||!Array.isArray(data.jobs))throw new Error('下载列表记录格式无效');
 return data.jobs.filter(j=>typeof j.id==='string'&&typeof j.title==='string'&&typeof j.directory==='string'&&path.isAbsolute(j.directory)&&isHTTP(j.resource?.url)&&['HLS','VIDEO'].includes(j.resource.kind)).map(j=>({...j,state:j.state==='canceled'?'canceled':'paused',speed:0,output:'',message:j.state==='canceled'?'已取消，可点击恢复下载。':'已恢复上次未完成任务，点击继续；地址失效时请重新打开播放页。',threads:Math.max(1,Math.min(8,Number(j.threads)||4)),done:Math.max(0,Number(j.done)||0),resource:{...j.resource,headers:Object.fromEntries(Object.entries(j.resource.headers||{}).filter(([k,v])=>k.toLowerCase()==='referer'&&isHTTP(v)))}}));
}
module.exports={read,write};
