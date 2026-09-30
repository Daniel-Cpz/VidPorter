const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');const {createRequire}=require('node:module');const {EventEmitter}=require('node:events');
test('tabs isolate same-URL resources, filters and closing a tab',()=>{
 let serial=0;class View{constructor(){this.webContents=new EventEmitter();Object.assign(this.webContents,{id:++serial,setWindowOpenHandler(){},loadURL:async()=>{},close(){},isDestroyed:()=>false});}setVisible(v){this.visible=v;}setBounds(){}}
 const electron={app:{whenReady:()=>({then(){}}),on(){}},WebContentsView:View};
 const filename=path.join(__dirname,'../main.cjs');const native=createRequire(filename);const ctx=vm.createContext({require:name=>name==='electron'?electron:native(name),console,setTimeout,clearTimeout,URL,AbortController,Buffer,__dirname:path.dirname(filename)});
 vm.runInContext(fs.readFileSync(filename,'utf8'),ctx);
 vm.runInContext(`win={isDestroyed:()=>false,webContents:{send(){}},contentView:{addChildView(){},removeChildView(){}}};
 const first=createTab('https://one.test');addResource({tabId:first,url:'https://cdn.test/v.mp4',kind:'VIDEO',title:'one'});
 config.minimum=50;const second=createTab('https://two.test');config.minimum=0;
 addResource({tabId:second,url:'https://cdn.test/v.mp4',kind:'VIDEO',title:'two'});`,ctx);
 assert.equal(vm.runInContext('publicResources()[0].title',ctx),'two');assert.equal(vm.runInContext('resources.size',ctx),2);
 vm.runInContext('activateTab(first)',ctx);assert.equal(vm.runInContext('config.minimum',ctx),50);assert.equal(vm.runInContext('publicResources()[0].title',ctx),'one');
 vm.runInContext('closeTab(first)',ctx);assert.equal(vm.runInContext('publicResources()[0].title',ctx),'two');assert.equal(vm.runInContext('resources.size',ctx),1);
 vm.runInContext('closeTab(second)',ctx);assert.equal(vm.runInContext('tabs.size',ctx),1);assert.equal(vm.runInContext('publicResources().length',ctx),0);
});
