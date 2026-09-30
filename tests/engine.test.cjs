const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {Engine} = require('../lib/engine.cjs');
const {ivBytes} = require('../lib/hls.cjs');
const fixtures = path.join(__dirname,'fixtures');
const data = Buffer.alloc(2*1024*1024, 77);
const key = Buffer.from('0123456789abcdef');
let ffmpeg;
try { ffmpeg=require('ffmpeg-static'); } catch { ffmpeg=process.env.FFMPEG_PATH || 'ffmpeg'; }
const hasFFmpeg = spawnSync(ffmpeg,['-version'],{windowsHide:true}).status===0;
async function until(fn, timeout=10000){const start=Date.now();while(!fn()){if(Date.now()-start>timeout)throw new Error('Timed out');await new Promise(r=>setTimeout(r,15));}}
async function setup(t){
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'streamcatch3-'));
  const ranges=[],calls=[];
  const server=http.createServer(async(req,res)=>{
    try{
      if(req.url==='/redirect'){res.writeHead(302,{Location:'/hls/index.m3u8'});res.end();return;}
      if(req.url==='/blocked'){res.writeHead(403);res.end('blocked');return;}
      if(req.url==='/hls/key'){res.end(key);return;}
      if(req.url.startsWith('/hls/')){
        let name=req.url.slice(5),content;
        if(name==='encrypted.m3u8'){
          content=(await fs.readFile(path.join(fixtures,'index.m3u8'),'utf8')).replace('#EXT-X-MEDIA-SEQUENCE:0','#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-KEY:METHOD=AES-128,URI="key"').replace(/segment(\d+)\.ts/g,'encrypted$1.ts');
        }else if(/^encrypted\d+\.ts$/.test(name)){
          const seq=Number(/\d+/.exec(name)[0]);const raw=await fs.readFile(path.join(fixtures,name.replace('encrypted','segment')));
          const cipher=crypto.createCipheriv('aes-128-cbc',key,ivBytes(null,seq));content=Buffer.concat([cipher.update(raw),cipher.final()]);
        }else content=await fs.readFile(path.join(fixtures,name));
        res.writeHead(200,{'Content-Type':name.endsWith('m3u8')?'application/vnd.apple.mpegurl':'video/mp2t'});res.end(content);return;
      }
      if(req.url==='/protected' && req.headers.authorization!=='demo'){res.writeHead(403);res.end();return;}
      const range=req.headers.range;
      if(range)ranges.push({range,ifRange:req.headers['if-range']});
      const offset=range && req.url!=='/ignore'?Number(/\d+/.exec(range)[0]):0;
      const status=range && req.url!=='/ignore'?206:200;
      const headers={'Content-Type':'video/mp4','Content-Length':data.length-offset,ETag:'"v1"'};
      if(status===206)headers['Content-Range']=`bytes ${offset}-${data.length-1}/${data.length}`;
      res.writeHead(status,headers);
      if(req.url==='/slow'||req.url==='/ignore'){
        let i=offset;const timer=setInterval(()=>{if(i>=data.length){clearInterval(timer);res.end();return;}res.write(data.subarray(i,i+32768));i+=32768;},8);
        res.on('close',()=>clearInterval(timer));
      }else res.end(data.subarray(offset));
    }catch(error){if(!res.headersSent)res.writeHead(500);res.end(error.message);}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port;
  const engine=new Engine({retryWait:async()=>{},directory:folder,ffmpeg,notify:()=>{},fetch:(url,opts)=>{calls.push({url,opts});return fetch(url,opts);}});
  t.after(async()=>{engine.shutdown();await until(()=>!engine.active);server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(folder,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
  return {engine,folder,base,ranges,calls};
}
test('plain download is byte-identical and uses credentials include',async t=>{
  const {engine,base,calls}=await setup(t);engine.add({url:base+'/video',kind:'VIDEO',title:'test',headers:{}});
  await until(()=>engine.jobs[0].state==='done'||engine.jobs[0].state==='error');
  assert.equal(engine.jobs[0].state,'done',engine.jobs[0].message);
  assert.deepEqual(await fs.readFile(engine.jobs[0].output),data);assert.equal(calls[0].opts.credentials,'include');
});
test('captured authorization is preserved for the same origin',async t=>{
  const {engine,base}=await setup(t);engine.add({url:base+'/protected',kind:'VIDEO',title:'test',headers:{Authorization:'demo'}});
  await until(()=>!engine.active);assert.equal(engine.jobs[0].state,'done',engine.jobs[0].message);
});
test('pause and resume requests a validated byte range',async t=>{
  const {engine,base,ranges}=await setup(t);const id=engine.add({url:base+'/slow',kind:'VIDEO',title:'test',headers:{}});
  await until(()=>engine.jobs[0].done>200000);engine.control(id,'pause');await until(()=>engine.jobs[0].state==='paused');
  const saved=engine.jobs[0].done;engine.control(id,'resume');await until(()=>['done','error'].includes(engine.jobs[0].state));
  assert.equal(engine.jobs[0].state,'done',engine.jobs[0].message);assert.deepEqual(await fs.readFile(engine.jobs[0].output),data);
  assert.ok(ranges.some(r=>r.range===`bytes=${saved}-`&&r.ifRange==='"v1"'));
});
test('server ignoring Range restarts without duplicate bytes',async t=>{
  const {engine,base}=await setup(t);const id=engine.add({url:base+'/ignore',kind:'VIDEO',title:'test',headers:{}});
  await until(()=>engine.jobs[0].done>200000);engine.control(id,'pause');await until(()=>engine.jobs[0].state==='paused');
  engine.control(id,'resume');await until(()=>['done','error'].includes(engine.jobs[0].state));
  assert.equal(engine.jobs[0].state,'done');assert.deepEqual(await fs.readFile(engine.jobs[0].output),data);
});
test('cancel never marks partial output complete',async t=>{
  const {engine,base,folder}=await setup(t);const id=engine.add({url:base+'/slow',kind:'VIDEO',title:'test',headers:{}});
  await until(()=>engine.jobs[0].done>100000);engine.control(id,'cancel');await until(()=>engine.jobs[0].state==='canceled');
  assert.equal(engine.jobs[0].output,'');assert.ok((await fs.readdir(folder)).some(n=>n.endsWith('.part')));
});
test('HTTP 403 stays an explicit error',async t=>{
  const {engine,base}=await setup(t);engine.add({url:base+'/blocked',kind:'VIDEO',title:'test',headers:{}});
  await until(()=>!engine.active);assert.equal(engine.jobs[0].state,'error');assert.match(engine.jobs[0].message,/403/);
});
for(const endpoint of ['/hls/index.m3u8','/hls/encrypted.m3u8','/redirect']){
  test('real HLS merge '+endpoint,{skip:!hasFFmpeg},async t=>{
    const {engine,base,calls}=await setup(t);engine.add({url:base+endpoint,kind:'HLS',title:'test',headers:{Referer:base+'/watch'}},3);
    await until(()=>!engine.active,20000);assert.equal(engine.jobs[0].state,'done',engine.jobs[0].message);
    assert.ok((await fs.stat(engine.jobs[0].output)).size>10000);
    assert.ok(engine.jobs[0].segmentsTotal>0);assert.equal(engine.jobs[0].segmentsDone,engine.jobs[0].segmentsTotal);
    const check=spawnSync(ffmpeg,['-v','error','-i',engine.jobs[0].output,'-f','null','-'],{windowsHide:true});
    assert.equal(check.status,0,check.stderr.toString());
    assert.ok(calls.every(c=>c.opts.credentials==='include'));
  });
}
test('new engine resumes saved file even when title changes',async t=>{
 const {engine,folder,base,ranges}=await setup(t);const resource={url:base+'/slow',kind:'VIDEO',title:'first',headers:{}};
 const id=engine.add(resource);await until(()=>engine.jobs[0].done>100000);engine.control(id,'pause');await until(()=>!engine.active);
 const saved=engine.jobs[0].done;
 const next=new Engine({retryWait:async()=>{},directory:folder,ffmpeg,notify:()=>{},fetch});
 try{next.add({...resource,title:'changed'});await until(()=>!next.active);assert.equal(next.jobs[0].state,'done',next.jobs[0].message);assert.deepEqual(await fs.readFile(next.jobs[0].output),data);assert.ok(ranges.some(r=>r.range===`bytes=${saved}-`));}
 finally{next.shutdown();await until(()=>!next.active);}
});
test('HLS restart reuses verified segments and skips completed output', {skip:!hasFFmpeg},async t=>{
 const {engine,folder,base}=await setup(t);const original=engine.fetch;
 engine.fetch=(url,opts)=>url.endsWith('segment01.ts')?Promise.resolve(new Response('',{status:403})):original(url,opts);
 const resource={url:base+'/hls/index.m3u8',kind:'HLS',title:'checkpoint',headers:{}};
 engine.add(resource,1);await until(()=>!engine.active);assert.equal(engine.jobs[0].state,'error');
 const requested=[];const next=new Engine({retryWait:async()=>{},directory:folder,ffmpeg,notify:()=>{},fetch:(url,opts)=>{requested.push(url);return fetch(url,opts);}});
 try{next.add(resource,1);await until(()=>!next.active);assert.equal(next.jobs[0].state,'done',next.jobs[0].message);assert.ok(!requested.some(u=>u.endsWith('segment00.ts')));
 const done=new Engine({retryWait:async()=>{},directory:folder,ffmpeg,notify:()=>{},fetch:()=>{throw new Error('must not download completed output');}});
 done.add(resource);await until(()=>!done.active);assert.equal(done.jobs[0].state,'done');done.shutdown();}
 finally{next.shutdown();await until(()=>!next.active);}
});
