const test=require('node:test');const assert=require('node:assert/strict');const {Engine}=require('../lib/engine.cjs');
test('batch pause and cancel preserve done tasks and stop running work',()=>{
 const e=new Engine({retryWait:async()=>{},notify:()=>{}});const abort=new AbortController();e.jobs=['running','queued','paused','error','done','canceled'].map((state,i)=>({id:String(i),state,abort,resource:{}}));e.active=e.jobs[0];
 e.controlAll('pause');assert.equal(abort.signal.aborted,true);assert.deepEqual(e.jobs.map(j=>j.stop||j.state),['paused','paused','paused','paused','done','canceled']);
 e.controlAll('cancel');assert.deepEqual(e.jobs.map(j=>j.stop||j.state),['canceled','canceled','canceled','canceled','done','canceled']);
});
test('batch start queues paused and failed tasks without reviving canceled tasks',()=>{
 const e=new Engine({retryWait:async()=>{},notify:()=>{}});e.closed=true;e.jobs=['paused','error','done','canceled'].map((state,i)=>({id:String(i),state,resource:{}}));e.controlAll('resume');assert.deepEqual(e.jobs.map(j=>j.state),['queued','queued','done','canceled']);
});
test('explicit restore requeues canceled task while bulk start leaves it canceled',()=>{
 const e=new Engine({retryWait:async()=>{},notify:()=>{}});e.closed=true;e.jobs=[{id:'c',state:'canceled',done:1024,resource:{}}];e.controlAll('resume');assert.equal(e.jobs[0].state,'canceled');e.control('c','restore');assert.equal(e.jobs[0].state,'queued');assert.equal(e.jobs[0].done,1024);
});
test('restore all requeues only canceled jobs and clears canceled stop marker',()=>{
 const e=new Engine({notify:()=>{}});e.closed=true;e.jobs=['canceled','paused','done'].map((state,i)=>({id:String(i),state,stop:state==='canceled'?'canceled':null,resource:{}}));e.controlAll('restore');assert.deepEqual(e.jobs.map(j=>j.state),['queued','paused','done']);assert.equal(e.jobs[0].stop,null);
});
