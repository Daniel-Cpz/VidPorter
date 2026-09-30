const test = require('node:test');
const assert = require('node:assert/strict');
const hls = require('../lib/hls.cjs');
const media = require('../lib/media.cjs');
test('successful-response media classification does not include segments', () => {
  assert.equal(media.kind('https://example.test/stream','application/vnd.apple.mpegurl'),'HLS');
  assert.equal(media.kind('https://example.test/clip.ts','video/mp2t'),'');
  assert.equal(media.kind('blob:https://example.test/x','video/mp4'),'');
});
test('range responses report total file size, not chunk size', () => {
  assert.equal(media.sizeFromHeaders({'Content-Range':['bytes 0-99/9000'],'Content-Length':['100']},206),9000);
  assert.equal(media.sizeFromHeaders({'Content-Length':['100']},206),null);
});
test('cross-origin requests never replay captured cookies or credentials', () => {
  const headers = {Cookie:'secret',Authorization:'token','X-Auth':'private',Referer:'https://page.test/',Range:'bytes=1-','User-Agent':'ua'};
  const same = media.requestHeaders(headers,'https://a.test/a','https://a.test/b');
  const other = media.requestHeaders(headers,'https://a.test/a','https://b.test/b');
  assert.equal(same.Authorization,'token'); assert.equal(same.Cookie,undefined); assert.equal(same.Range,undefined);
  assert.equal(other.Authorization,undefined); assert.equal(other['X-Auth'],undefined); assert.equal(other.Referer,'https://page.test/');
});
test('known-size threshold and unknown-size policy', () => {
  assert.equal(media.visible(9*1024*1024,10,false),false);
  assert.equal(media.visible(10*1024*1024,10,false),true);
  assert.equal(media.visible(null,10,false),true);
  assert.equal(media.visible(null,10,true),false);
});
test('HLS AES IV derives from media sequence', () => {
  const parsed=hls.parse('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:42\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:2,\na.ts\n#EXT-X-ENDLIST','https://a.test/video/list.m3u8');
  assert.equal(parsed.segments[0].sequence,42);
  assert.equal(parsed.segments[0].key.url,'https://a.test/video/key');
  assert.equal(hls.ivBytes(null,42).toString('hex'),'0000000000000000000000000000002a');
});
test('HLS byte ranges and initialization maps', () => {
  const parsed=hls.parse('#EXTM3U\n#EXT-X-MAP:URI="init.mp4",BYTERANGE="20@0"\n#EXTINF:2,\n#EXT-X-BYTERANGE:100@0\nfile.mp4\n#EXTINF:2,\n#EXT-X-BYTERANGE:100\nfile.mp4\n#EXT-X-ENDLIST','https://a.test/list');
  assert.deepEqual(parsed.segments[1].range,{offset:100,length:100});
  assert.equal(parsed.segments[0].map.range.length,20);
});
test('master chooses highest bandwidth and its default audio track', async () => {
  const pages={
    'https://a.test/master':'#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",DEFAULT=YES,URI="audio"\n#EXT-X-STREAM-INF:BANDWIDTH=100\nlow\n#EXT-X-STREAM-INF:BANDWIDTH=200,AUDIO="aud"\nhigh',
    'https://a.test/high':'#EXTM3U\n#EXTINF:2,\nh.ts\n#EXT-X-ENDLIST',
    'https://a.test/audio':'#EXTM3U\n#EXTINF:2,\na.ts\n#EXT-X-ENDLIST'};
  const tracks=await hls.resolve('https://a.test/master',async url=>({text:pages[url],url}));
  assert.equal(tracks.length,2);assert.equal(tracks[0].segments[0].url,'https://a.test/h.ts');
});
test('live, DRM and invalid manifests are rejected', () => {
  assert.throws(()=>hls.parse('<html>challenge</html>','https://a.test/'));
  assert.throws(()=>hls.parse('#EXTM3U\n#EXTINF:2,\na.ts','https://a.test/'),/直播/);
  assert.throws(()=>hls.parse('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"','https://a.test/'),/DRM/);
});

test('referrer replay preserves captured HTTPS value but strips downgrade and invalid credentials',()=>{
 const {requestHeaders}=require('../lib/media.cjs');
 const headers={Referer:'https://page.test/watch/123'};
 assert.equal(requestHeaders(headers,'https://cdn.test/v','https://cdn.test/seg').Referer,headers.Referer);
 assert.equal(requestHeaders(headers,'https://cdn.test/v','http://cdn.test/seg').Referer,undefined);
 assert.equal(requestHeaders({Referer:'https://user:secret@page.test/'},'https://cdn.test/v','https://cdn.test/seg').Referer,undefined);
});
