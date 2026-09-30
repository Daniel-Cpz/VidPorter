function terms(value){return String(value||'').split(/[,，\n]+/).map(x=>x.trim().toLowerCase()).filter(Boolean);}
function matchesURL(url,include='',exclude=''){
 let decoded=url;try{decoded=decodeURIComponent(url);}catch{}
 const text=(url+'\n'+decoded).toLowerCase(),yes=terms(include),no=terms(exclude);
 return (!yes.length||yes.some(t=>text.includes(t)))&&!no.some(t=>text.includes(t));
}
module.exports={matchesURL};
