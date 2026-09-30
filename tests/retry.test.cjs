const test=require('node:test');const assert=require('node:assert/strict');const {retry}=require('../lib/retry.cjs');
test('transient interruption recovers with bounded backoff',async()=>{let calls=0;const waits=[];assert.equal(await retry(async()=>{if(++calls<3)throw new Error('下载请求提前关闭');return 'ok';},{wait:async ms=>waits.push(ms)}),'ok');assert.deepEqual(waits,[1000,2000]);});
test('persistent interruption stops after ten retries',async()=>{let calls=0;await assert.rejects(retry(async()=>{calls++;throw new Error('下载响应中断');},{wait:async()=>{}}));assert.equal(calls,11);});
test('HTTP refusal retries ten times',async()=>{let calls=0;await assert.rejects(retry(async()=>{calls++;throw new Error('HTTP 403');},{wait:async()=>{}}));assert.equal(calls,11);});
test('pause or cancel interrupts retry wait',async()=>{const controller=new AbortController();let calls=0;await assert.rejects(retry(async()=>{calls++;throw new Error('下载请求提前关闭');},{signal:controller.signal,onRetry:()=>controller.abort()}));assert.equal(calls,1);});

test('cache read failure retries ten times before surfacing failure',async()=>{
 let calls=0;const waits=[];await assert.rejects(retry(async()=>{calls++;throw new Error('net::ERR_CACHE_READ_FAILURE');},{wait:async ms=>waits.push(ms)}),/ERR_CACHE_READ_FAILURE/);
 assert.equal(calls,11);assert.deepEqual(waits,[1000,2000,4000,8000,8000,8000,8000,8000,8000,8000]);
});
test('cache read failure can recover without failing the task',async()=>{
 let calls=0;const result=await retry(async()=>{if(++calls<4)throw new Error('net::ERR_CACHE_READ_FAILURE');return 'ok';},{wait:async()=>{}});assert.equal(result,'ok');assert.equal(calls,4);
});
test('retry count supports zero and twenty',async()=>{
 for(const maxRetries of [0,20]){let calls=0;await assert.rejects(retry(async()=>{calls++;throw new Error('failure');},{maxRetries,wait:async()=>{}}));assert.equal(calls,maxRetries+1);}
});
test('reducing retry limit during backoff prevents the next retry',async()=>{
 let max=10,calls=0;await assert.rejects(retry(async()=>{calls++;throw new Error('failure');},{maxRetries:()=>max,wait:async()=>{max=0;}}));assert.equal(calls,1);
});
