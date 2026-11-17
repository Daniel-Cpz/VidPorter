const fs=require('node:fs/promises');const path=require('node:path');const crypto=require('node:crypto');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
async function save(job, file = job.checkpoint) {
 const data={version:1,key:job.resumeKey,stem:job.stem,kind:job.resource.kind,validator:job.validator||null,etag:job.etag||null,fingerprint:job.fingerprint||null,output:job.output?path.basename(job.output):null,outputSize:job.output?(await fs.stat(job.output)).size:null};
 await fs.writeFile(file+'.tmp',JSON.stringify(data));await fs.rename(file+'.tmp',file);
}
async function prepare(job, completedDirectory) {
 job.resumeKey=digest(job.resource.kind+'\n'+job.resource.url);job.checkpoint=path.join(job.directory,'.streamcatch-'+job.resumeKey+'.json');
 job.completedCheckpoint=completedDirectory?path.join(completedDirectory,digest(path.resolve(job.directory))+'-'+job.resumeKey+'.json'):null;
 let data;try{data=JSON.parse(await fs.readFile(job.checkpoint,'utf8'));}catch(e){if(e.code!=='ENOENT')throw new Error('续传记录无法读取，请先备份并检查下载目录');}
 if(!data&&job.completedCheckpoint){
  try{data=JSON.parse(await fs.readFile(job.completedCheckpoint,'utf8'));}
  catch(e){if(e.code!=='ENOENT')throw new Error('已完成下载记录无法读取，请检查应用数据目录');}
 }
 if(data){
  if(data.version!==1||data.key!==job.resumeKey||data.kind!==job.resource.kind||typeof data.stem!=='string'||!data.stem||/[\\/]/.test(data.stem)||data.stem==='.'||data.stem==='..')throw new Error('续传记录无效');
  job.stem=data.stem;job.validator=data.validator;job.etag=data.etag;job.fingerprint=data.fingerprint;
  if(data.output&&path.basename(data.output)===data.output&&data.output.startsWith(job.stem+'.')){
   const file=path.join(job.directory,data.output);try{const stat=await fs.stat(file);if(stat.isFile()&&stat.size>0&&stat.size===data.outputSize){job.output=file;job.done=stat.size;return true;}}catch{}
  }
 }
 await save(job);return false;
}
async function complete(job) {
 // Persist duplicate detection privately before removing the resumable sidecar.
 if(job.completedCheckpoint){
  await fs.mkdir(path.dirname(job.completedCheckpoint),{recursive:true});
  await save(job,job.completedCheckpoint);
 }
 await fs.rm(job.checkpoint+'.tmp',{force:true});
 await fs.rm(job.checkpoint,{force:true});
}
module.exports={prepare,save,complete,digest};
