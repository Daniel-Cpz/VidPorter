const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const queue=require('../lib/queue.cjs');const {Engine}=require('../lib/engine.cjs');
test('unfinished queue restores paused without automatic network requests or saved credentials',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'queue-test-'));try{
 const file=path.join(dir,'queue.json');const job={id:'demo',title:'video',directory:dir,threads:4,done:100,state:'running',resource:{url:'https://example.test/v',title:'video',kind:'HLS',headers:{Cookie:'secret',Authorization:'secret',Referer:'https://example.test/watch'}}};
 queue.write(file,[job,{...job,id:'done',state:'done'},{...job,id:'cancel',state:'canceled'}]);
 assert.ok(!fs.readFileSync(file,'utf8').includes('secret'));
 const engine=new Engine({retryWait:async()=>{},directory:dir,queueFile:file,notify:()=>{},fetch:()=>assert.fail('must not start automatically')});
 assert.equal(engine.jobs.length,2);assert.equal(engine.jobs[0].state,'paused');assert.equal(engine.jobs[0].done,100);assert.equal(engine.jobs[0].directory,dir);assert.equal(engine.jobs[0].resource.headers.Referer,'https://example.test/watch');
 engine.control('demo','cancel');assert.ok(queue.read(file).every(j=>j.state==='canceled'));engine.shutdown();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
