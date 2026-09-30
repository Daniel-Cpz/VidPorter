const {setTimeout:delay}=require('node:timers/promises');
const MAX_RETRIES=10;
function transient(error) {
  return /下载请求提前关闭|下载请求在响应前关闭|下载响应中断|ERR_(CONNECTION_(CLOSED|RESET|ABORTED)|TIMED_OUT|NETWORK_CHANGED|EMPTY_RESPONSE|CACHE_READ_FAILURE)|terminated|fetch failed|ECONNRESET|ETIMEDOUT|TimeoutError/i.test(String(error?.message)+' '+String(error?.name));
}
async function retry(operation,{signal,maxRetries=MAX_RETRIES,onRetry=()=>{},wait=ms=>delay(ms,undefined,{signal})}={}) {
  const limit=()=>{const n=Number(typeof maxRetries==='function'?maxRetries():maxRetries);return Number.isFinite(n)?Math.max(0,Math.min(20,Math.floor(n))):MAX_RETRIES;};
  let lastError;
  for(let attempt=0;;attempt++) {
    signal?.throwIfAborted();
    if(attempt>limit()){lastError.retriesExhausted=true;throw lastError;}
    try{return await operation();}catch(error){
      if(signal?.aborted||error?.retriesExhausted)throw error;
      lastError=error;
      if(attempt>=limit()){error.retriesExhausted=true;throw error;}
      const ms=Math.min(8000,1000*2**attempt);
      onRetry(attempt+1,ms,error);await wait(ms);
    }
  }
}
module.exports={retry,transient,MAX_RETRIES};
