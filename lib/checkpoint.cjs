const fs=require('node:fs/promises');const path=require('node:path');const crypto=require('node:crypto');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
async function save(job) {
 const data={version:1,key:job.resumeKey,stem:job.stem,kind:job.resource.kind,validator:job.validator||null,etag:job.etag||null,fingerprint:job.fingerprint||null,output:job.output?path.basename(job.output):null,outputSize:job.output?(await fs.stat(job.output)).size:null};
 await fs.writeFile(job.checkpoint+'.tmp',JSON.stringify(data));await fs.rename(job.checkpoint+'.tmp',job.checkpoint);
}
async function prepare(job) {
 job.resumeKey=digest(job.resource.kind+'\n'+job.resource.url);job.checkpoint=path.join(job.directory,'.streamcatch-'+job.resumeKey+'.json');
 let data;try{data=JSON.parse(await fs.readFile(job.checkpoint,'utf8'));}catch(e){if(e.code!=='ENOENT')throw new Error('续传记录无法读取，请先备份并检查下载目录');}
 if(data){
  if(data.version!==1||data.key!==job.resumeKey||data.kind!==job.resource.kind||typeof data.stem!=='string'||!data.stem||/[\\/]/.test(data.stem)||data.stem==='.'||data.stem==='..')throw new Error('续传记录无效');
  job.stem=data.stem;job.validator=data.validator;job.etag=data.etag;job.fingerprint=data.fingerprint;
  if(data.output&&path.basename(data.output)===data.output&&data.output.startsWith(job.stem+'.')){
   const file=path.join(job.directory,data.output);try{const stat=await fs.stat(file);if(stat.isFile()&&stat.size>0&&stat.size===data.outputSize){job.output=file;job.done=stat.size;return true;}}catch{}
  }
 }
 await save(job);return false;
}
module.exports={prepare,save,digest};
