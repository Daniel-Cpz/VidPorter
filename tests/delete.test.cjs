const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const {Engine}=require('../lib/engine.cjs');const checkpoint=require('../lib/checkpoint.cjs');
test('delete canceled removes only its partials and record, preserving completed and unrelated files',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'delete-task-'));try{
 const e=new Engine({directory:dir,notify:()=>{}});e.closed=true;const id=e.add({url:'https://example.test/v',title:'video',kind:'HLS'});const j=e.jobs[0];j.state='canceled';await checkpoint.prepare(j);
 const parts=path.join(dir,j.stem+'_parts');await fs.mkdir(parts);await fs.writeFile(path.join(parts,'t0_s0.bin'),'part');await fs.writeFile(path.join(dir,j.stem+'.mp4.part'),'partial');await fs.writeFile(path.join(dir,j.stem+'.mkv'),'complete');await fs.writeFile(path.join(dir,'other.part'),'other');
 await e.deleteCanceled(id);assert.equal(e.jobs.length,0);await assert.rejects(fs.stat(parts),{code:'ENOENT'});await assert.rejects(fs.stat(j.checkpoint),{code:'ENOENT'});assert.equal(await fs.readFile(path.join(dir,j.stem+'.mkv'),'utf8'),'complete');assert.equal(await fs.readFile(path.join(dir,'other.part'),'utf8'),'other');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
