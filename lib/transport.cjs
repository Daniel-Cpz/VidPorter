function chromiumFetch(net, session, url, options={}) {
  return new Promise((resolve,reject)=>{
    const signal=options.signal;
    if(signal?.aborted){reject(signal.reason||new Error('请求已取消'));return;}
    const request=net.request({url,method:'GET',session,credentials:'include',redirect:'manual',referrerPolicy:'unsafe-url',headers:options.headers||{}});
    let settled=false, incoming, closeTimer, controller, bodyEnded=false;
    const events=['创建'];
    const mark=value=>{events.push(value);};
    const cleanup=()=>signal?.removeEventListener('abort',abort);
    const fail=error=>{clearTimeout(closeTimer);if(!settled){settled=true;reject(error);}else if(controller&&!bodyEnded){bodyEnded=true;controller.error(error);cleanup();if(incoming&&!incoming.destroyed)incoming.destroy();}};
    const abort=()=>{fail(signal.reason||new Error('请求已取消'));request.abort();};
    signal?.addEventListener('abort',abort,{once:true});
    request.on('error',error=>{mark('error');fail(error);});
    request.on('abort',()=>mark('abort'));
    request.on('finish',()=>mark('finish'));
    request.on('login',(_info,callback)=>{mark('需要网络认证');callback();});
    request.on('close',()=>{
      mark('close');
      if(incoming&&!bodyEnded)fail(new Error('下载响应中断：连接关闭但正文未结束'));
      if(bodyEnded)cleanup();
      // Preserve a concrete network error delivered just after close.
      if(!settled)closeTimer=setTimeout(()=>fail(new Error('下载请求提前关闭 · '+new URL(url).hostname+' · 事件：'+events.join(' → '))),100);
    });
    request.on('redirect',(status,_method,target,raw)=>{
      const headers=new Headers();for(const [k,v] of Object.entries(raw||{}))for(const x of [].concat(v))headers.append(k,x);
      headers.set('location',target);
      clearTimeout(closeTimer);mark('redirect '+status);settled=true;resolve(new Response(null,{status,headers}));cleanup();request.abort();
    });
    request.on('response',response=>{
      clearTimeout(closeTimer);mark('response '+response.statusCode);incoming=response;
      const headers=new Headers();for(const [k,v] of Object.entries(response.headers||{}))for(const x of [].concat(v))headers.append(k,x);
      response.pause();
      const body=new ReadableStream({
        start(c){
          controller=c;
          response.on('data',chunk=>{if(bodyEnded)return;c.enqueue(new Uint8Array(chunk));if(c.desiredSize<=0)response.pause();});
          response.on('end',()=>{if(bodyEnded)return;bodyEnded=true;c.close();cleanup();});
          response.on('error',fail);
          response.on('aborted',()=>fail(new Error('下载响应中断')));
          response.on('close',()=>{if(!bodyEnded)fail(new Error('下载响应中断：正文提前关闭'));});
        },
        pull(){response.resume();},
        cancel(){bodyEnded=true;cleanup();response.destroy();request.abort();}
      });
      settled=true;
      resolve({ok:response.statusCode>=200&&response.statusCode<300,status:response.statusCode,headers,body});
    });
    request.end();
  });
}
module.exports={chromiumFetch};
