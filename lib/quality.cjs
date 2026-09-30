const {attributes}=require('./hls.cjs');
function dimensions(text) {
  const m=/(?:^|[^a-z0-9])(\d{2,5})\s*[x×]\s*(\d{2,5})(?![a-z0-9])/i.exec(text);
  if(!m)return null;
  const w=Number(m[1]),h=Number(m[2]);
  return w>=64&&h>=64&&w<=16384&&h<=16384?`${w}×${h}`:null;
}
function fromURL(address) {
  let u;try{u=new URL(address);}catch{return null;}
  let text=u.pathname+' '+u.search;
  try{text=decodeURIComponent(text);}catch{}
  const size=dimensions(text);if(size)return {label:size,source:'网址推测'};
  const m=/(?:^|[^a-z0-9])(\d{3,4})p(?![a-z0-9])/i.exec(text);
  return m&&Number(m[1])>=100&&Number(m[1])<=8640?{label:m[1]+'p',source:'网址推测'}:null;
}
function fromManifest(text) {
  if(!text.trimStart().startsWith('#EXTM3U'))return null;
  const sizes=[];
  for(const line of text.split(/\r?\n/)) {
    if(!line.trim().startsWith('#EXT-X-STREAM-INF:'))continue;
    const a=attributes(line.trim().slice(18));const size=dimensions(a.RESOLUTION||'');
    if(size&&!sizes.includes(size))sizes.push(size);
  }
  sizes.sort((a,b)=>Number(b.split('×')[1])-Number(a.split('×')[1]));
  return sizes.length?{label:sizes.join(' / '),source:sizes.length>1?'HLS 声明 · 多清晰度':'HLS 声明'}:null;
}
module.exports={fromURL,fromManifest};
