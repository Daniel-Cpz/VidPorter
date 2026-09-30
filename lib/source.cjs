function parseSources(value) {
  const tokens=String(value||'').trim().split(/[\s,，;；]+/).filter(Boolean);
  if(tokens.length>50) throw new Error('来源最多填写 50 个域名');
  return [...new Set(tokens.map(token=>{
    try {
      const u=new URL(token.includes('://')?token:'https://'+token);
      if(!['http:','https:'].includes(u.protocol)||u.username||u.password||!u.hostname) throw new Error();
      return u.hostname.toLowerCase().replace(/\.$/,'');
    } catch {throw new Error('无效来源：'+token);}
  }))];
}
function matchesSource(url, sources=[], subdomains=false) {
  if(!sources.length)return true;
  const host=new URL(url).hostname.toLowerCase().replace(/\.$/,'');
  return sources.some(s=>host===s||(subdomains&&host.endsWith('.'+s)));
}
module.exports={parseSources,matchesSource};
