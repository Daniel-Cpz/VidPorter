const test=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');const {Readable}=require('node:stream');
const {chromiumFetch}=require('../lib/transport.cjs');
function fake(action){return {request(options){const r=new EventEmitter();r.abort=()=>r.emit('close');r.end=()=>queueMicrotask(()=>action(r,options));return r;}};}
test('transport streams response with the browser session',async()=>{
 const session={};const response=await chromiumFetch(fake((r,o)=>{assert.equal(o.session,session);assert.equal(o.credentials,'include');assert.equal(o.referrerPolicy,'unsafe-url');const body=Readable.from([Buffer.from('video')]);body.statusCode=200;body.headers={'content-type':['video/mp4']};r.emit('response',body);body.on('end',()=>r.emit('close'));}),session,'https://example.test');
 assert.equal(await new Response(response.body).text(),'video');
});
test('transport exposes redirect without following it',async()=>{
 const response=await chromiumFetch(fake(r=>r.emit('redirect',302,'GET','https://other.test/v',{})),{},'https://example.test');assert.equal(response.status,302);assert.equal(response.headers.get('location'),'https://other.test/v');
});
test('transport propagates client errors and cancellation',async()=>{
 await assert.rejects(chromiumFetch(fake(r=>r.emit('error',new Error('net::ERR_BLOCKED_BY_CLIENT'))),{},'https://example.test'),/ERR_BLOCKED/);
 const abort=new AbortController();abort.abort();await assert.rejects(chromiumFetch(fake(()=>{}),{},'https://example.test',{signal:abort.signal}));
});

test('late network error after close is not masked',async()=>{
 await assert.rejects(chromiumFetch(fake(r=>{r.emit('close');setTimeout(()=>r.emit('error',new Error('net::ERR_BLOCKED_BY_CLIENT')),5);}),{},'https://example.test'),/ERR_BLOCKED_BY_CLIENT/);
});
test('close without network error reports lifecycle',async()=>{
 await assert.rejects(chromiumFetch(fake(r=>r.emit('close')),{},'https://example.test'),/事件：.*close/);
});

test('request close after headers rejects a pending body read',async()=>{
 let req;const response=await chromiumFetch(fake(r=>{req=r;const stream=new Readable({read(){}});stream.statusCode=200;stream.headers={};r.emit('response',stream);}),{},'https://example.test');
 const pending=response.body.getReader().read();req.emit('close');await assert.rejects(pending,/下载响应中断/);
});
test('abort after headers rejects a stalled body read immediately',async()=>{
 const abort=new AbortController();const response=await chromiumFetch(fake(r=>{const stream=new Readable({read(){}});stream.statusCode=200;stream.headers={};r.emit('response',stream);}),{},'https://example.test',{signal:abort.signal});
 const pending=response.body.getReader().read();abort.abort(new Error('用户暂停'));await assert.rejects(pending,/用户暂停/);
});
