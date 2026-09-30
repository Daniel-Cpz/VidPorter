const test=require('node:test');const assert=require('node:assert/strict');const {matchesURL}=require('../lib/url-filter.cjs');const {resolve}=require('../lib/hls.cjs');
test('URL includes any keyword and excludes any forbidden keyword',()=>{
 assert(matchesURL('https://cdn.test/1280x720/video.m3u8','720,1080','preview'));
 assert(!matchesURL('https://cdn.test/720/preview.m3u8','720','preview'));
 assert(!matchesURL('https://cdn.test/480/video.m3u8','720,1080',''));
 assert(matchesURL('https://cdn.test/%E6%AD%A3%E7%89%87/VIDEO.m3u8','正片','PREVIEW'));
 assert(matchesURL('https://cdn.test/video','', ''));
});
test('resolved segment totals include selected video and external audio',async()=>{
 const docs={
 'https://test/master':'#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",DEFAULT=YES,URI="audio"\n#EXT-X-STREAM-INF:BANDWIDTH=100,AUDIO="a"\nvideo',
 'https://test/video':'#EXTM3U\n#EXTINF:4\nv1.ts\n#EXTINF:4\nv2.ts\n#EXT-X-ENDLIST',
 'https://test/audio':'#EXTM3U\n#EXTINF:8\na1.aac\n#EXT-X-ENDLIST'};
 const tracks=await resolve('https://test/master',async url=>({url,text:docs[url]}));assert.equal(tracks.length,2);assert.equal(tracks.reduce((n,t)=>n+t.segments.length,0),3);
});
