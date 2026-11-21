const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const {Engine}=require('../lib/engine.cjs');
const checkpoint=require('../lib/checkpoint.cjs');
const queue=require('../lib/queue.cjs');
const {localPlaylist}=require('../lib/force-merge.cjs');
const ffmpeg=require('ffmpeg-static');
const hasFFmpeg=spawnSync(ffmpeg,['-version'],{windowsHide:true}).status===0;
async function setup(t,state='error'){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vidporter-force-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
 const engine=new Engine({directory:dir,queueFile:path.join(dir,'app-data','queue.json'),ffmpeg,notify:()=>{},fetch:()=>assert.fail('force merge must remain offline')});engine.closed=true;
 const id=engine.add({url:'https://example.test/video.m3u8',title:'video',kind:'HLS'});const job=engine.jobs[0];job.state=state;
 await checkpoint.prepare(job);const folder=path.join(dir,job.stem+'_parts');await fs.mkdir(folder);
 const playlist='#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\nt0_s0.bin\n#EXTINF:2,\nt0_s1.bin\n#EXTINF:1,\nt0_s2.bin\n#EXT-X-ENDLIST';
 await fs.writeFile(path.join(folder,'track0.m3u8'),playlist);
 async function segment(i){const data=await fs.readFile(path.join(__dirname,'fixtures','segment0'+i+'.ts'));await fs.writeFile(path.join(folder,'t0_s'+i+'.bin'),data);await fs.writeFile(path.join(folder,'t0_s'+i+'.bin.sha256'),checkpoint.digest(data));}
 return {dir,engine,id,job,folder,segment};
}
for(const state of ['paused','error','canceled'])test('force merge '+state+' task preserves resume data and permits later full completion',{skip:!hasFFmpeg},async t=>{
 const {engine,id,job,folder,segment}=await setup(t,state);await segment(0);await segment(2);
 const before=await fs.readFile(job.checkpoint);const original=await fs.readFile(path.join(folder,'t0_s0.bin'));
 const merging=engine.forceMerge(id);
 assert.equal(job.forceMerging,true);engine.control(id,'resume');assert.equal(job.state,state);
 await assert.rejects(engine.forceMerge(id),/正在操作中/);
 assert.throws(()=>engine.add(job.resource),/正在删除或合并/);
 if(state==='error'){engine.requeueFailedAfterSuccess();assert.equal(job.state,'error');}
 const output=await merging;
 assert.match(output,/\.incomplete-[a-f0-9]{8}\.mkv$/);assert.equal(job.partialOutput,output);assert.equal(job.output,'');assert.equal(job.state,state);
 assert.deepEqual(await fs.readFile(job.checkpoint),before);assert.deepEqual(await fs.readFile(path.join(folder,'t0_s0.bin')),original);
 assert.ok(!(await fs.readdir(folder)).some(n=>n.startsWith('.force-merge-')));
 const check=spawnSync(ffmpeg,['-v','error','-i',output,'-f','null','-'],{windowsHide:true});assert.equal(check.status,0,check.stderr.toString());
 const restored=queue.read(engine.queueFile);assert.equal(restored[0].partialOutput,output);
 // Completing the missing segment still allows the normal merge and final JSON cleanup.
 await segment(1);job.abort=new AbortController();job.threads=1;
 job.tracks=[{segments:[0,1,2].map(i=>({url:'https://example.test/seg'+i,duration:i===2?1:2,sequence:i}))}];job.fingerprint=checkpoint.digest(JSON.stringify(job.tracks));
 await engine.downloadHLS(job);await checkpoint.save(job);await checkpoint.complete(job);
 assert.equal((await fs.stat(output)).isFile(),true);assert.notEqual(job.output,output);assert.equal((await fs.stat(job.output)).isFile(),true);
 await assert.rejects(fs.stat(job.checkpoint),{code:'ENOENT'});
});
test('missing or corrupt segments never become input',async t=>{
 const {engine,id,folder,segment}=await setup(t);await segment(0);await fs.writeFile(path.join(folder,'t0_s0.bin'),'corrupted');
 await assert.rejects(engine.forceMerge(id),/没有可合并/);assert.equal(engine.jobs[0].state,'error');assert.equal(engine.jobs[0].forceMerging,false);
});
test('restored task uses its checkpoint stem rather than a changed title',{skip:!hasFFmpeg},async t=>{
 const {engine,id,job,segment,dir}=await setup(t);await segment(0);job.title='changed';engine.report(job,true);
 const restored=new Engine({directory:dir,queueFile:engine.queueFile,ffmpeg,notify:()=>{}});
 assert.notEqual(restored.jobs[0].stem,job.stem);const result=await restored.forceMerge(id);assert.ok(result.startsWith(path.join(dir,job.stem+'.incomplete-')));
});
test('ffmpeg failure leaves segments and checkpoint intact',async t=>{
 const {engine,id,job,folder,segment}=await setup(t);await segment(0);engine.ffmpeg=path.join(folder,'missing-ffmpeg.exe');
 const before=await fs.readFile(job.checkpoint);await assert.rejects(engine.forceMerge(id));
 assert.deepEqual(await fs.readFile(job.checkpoint),before);assert.ok(!(await fs.readdir(folder)).some(n=>n.startsWith('.force-merge-')));assert.equal(job.forceMerging,false);
});
test('initialization maps must pass checksum and unsafe playlist paths are rejected',async t=>{
 const {folder,segment}=await setup(t);await segment(0);
 const file=path.join(folder,'track0.m3u8');await fs.writeFile(file,'#EXTM3U\n#EXT-X-MAP:URI="t0_init0.mp4"\n#EXTINF:2,\nt0_s0.bin\n#EXT-X-ENDLIST');
 assert.equal(await localPlaylist(folder,0),null);
 await fs.writeFile(path.join(folder,'t0_init0.mp4'),'init');await fs.writeFile(path.join(folder,'t0_init0.mp4.sha256'),checkpoint.digest(Buffer.from('init')));
 assert.match(await localPlaylist(folder,0),/URI="\.\.\/t0_init0.mp4"/);
 await fs.writeFile(file,'#EXTM3U\n#EXTINF:2,\nhttps://example.test/private');await assert.rejects(localPlaylist(folder,0),/清单无效/);
});
test('only stopped HLS jobs can be force merged',async t=>{
 const {engine,id,job}=await setup(t);job.state='running';await assert.rejects(engine.forceMerge(id),/请先暂停/);
 job.state='paused';job.resource.kind='VIDEO';await assert.rejects(engine.forceMerge(id),/HLS/);
});

test('force merge includes a separately downloaded audio track',{skip:!hasFFmpeg},async t=>{
 const {engine,id,folder,segment}=await setup(t);await segment(0);
 const audio=path.join(folder,'t1_s0.bin');const make=spawnSync(ffmpeg,['-v','error','-f','lavfi','-i','sine=frequency=440:duration=2','-c:a','aac','-f','mpegts',audio],{windowsHide:true});assert.equal(make.status,0,make.stderr.toString());
 await fs.writeFile(audio+'.sha256',checkpoint.digest(await fs.readFile(audio)));await fs.writeFile(path.join(folder,'track1.m3u8'),'#EXTM3U\n#EXTINF:2,\nt1_s0.bin\n#EXT-X-ENDLIST');
 const output=await engine.forceMerge(id);for(const stream of ['0:v:0','0:a:0']){const result=spawnSync(ffmpeg,['-v','error','-i',output,'-map',stream,'-f','null','-'],{windowsHide:true});assert.equal(result.status,0,result.stderr.toString());}
});
test('duplicate jobs cannot resume while their shared segments are merging',async t=>{
 const {engine,id,job}=await setup(t,'canceled');const other={...job,id:'duplicate',state:'paused'};engine.jobs.push(other);job.forceMerging=true;
 engine.control(other.id,'resume');assert.equal(other.state,'paused');await assert.rejects(engine.forceMerge(other.id),/正在操作中/);
 await assert.rejects(engine.deleteCanceled(id),/正在强制合并/);job.forceMerging=false;
});
