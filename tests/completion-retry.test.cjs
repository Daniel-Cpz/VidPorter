const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const {Engine}=require('../lib/engine.cjs');
async function idle(engine){for(let i=0;i<500;i++){if(!engine.active&&!engine.jobs.some(j=>j.state==='queued'))return;await new Promise(r=>setTimeout(r,5));}throw new Error('queue did not settle');}
test('each successful completion requeues previously failed tasks',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'completion-retry-'));const engine=new Engine({retryWait:async()=>{},directory:dir,notify:()=>{},fetch:()=>{throw new Error('unused');}});const attempts={};
 engine.downloadFile=async job=>{const key=job.title;attempts[key]=(attempts[key]||0)+1;if(key==='fail')throw new Error('failure');job.output=path.join(dir,job.stem+'.mp4');await fs.writeFile(job.output,'video');};
 try{
 engine.add({url:'https://example.test/fail',title:'fail',kind:'VIDEO'});await idle(engine);assert.equal(attempts.fail,11);
 engine.add({url:'https://example.test/success',title:'success',kind:'VIDEO'});await idle(engine);assert.equal(attempts.fail,22);assert.equal(engine.jobs[0].state,'error');
 engine.add({url:'https://example.test/another',title:'another',kind:'VIDEO'});await idle(engine);assert.equal(attempts.fail,33);
 }finally{engine.shutdown();await idle(engine);await fs.rm(dir,{recursive:true,force:true});}
});
test('paused and canceled jobs are not restarted',()=>{
 const engine=new Engine({retryWait:async()=>{},notify:()=>{}});engine.jobs=[{state:'paused'},{state:'canceled'},{state:'error',completionRetryUsed:true},{state:'error'}];engine.requeueFailedAfterSuccess();assert.deepEqual(engine.jobs.map(j=>j.state),['paused','canceled','queued','queued']);assert.equal(engine.jobs[3].completionRetryUsed,true);
});
