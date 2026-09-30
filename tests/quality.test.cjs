const test=require('node:test');const assert=require('node:assert/strict');
const {fromURL,fromManifest}=require('../lib/quality.cjs');
test('URL dimensions and p labels are explicitly guesses',()=>{
 assert.deepEqual(fromURL('https://cdn.test/1920x1080/video.mp4'),{label:'1920×1080',source:'网址推测'});
 assert.equal(fromURL('https://cdn.test/video?quality=720p').label,'720p');
 assert.equal(fromURL('https://cdn.test/1920%20x%201080/v').label,'1920×1080');
 assert.equal(fromURL('https://1080p.test/video'),null);
 assert.equal(fromURL('https://cdn.test/id1231080pabc'),null);
 assert.equal(fromURL('https://cdn.test/video.mp4'),null);
});
test('HLS declared resolutions are deduplicated and sorted',()=>{
 const q=fromManifest('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1280x720\na\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080,BANDWIDTH=2\nb\n#EXT-X-STREAM-INF:RESOLUTION=1280x720\nc');
 assert.equal(q.label,'1920×1080 / 1280×720');assert.match(q.source,/HLS/);
 assert.equal(fromManifest('#EXTM3U\n#EXTINF:5\n1080p.ts\n#EXT-X-ENDLIST'),null);
 assert.equal(fromManifest('<html>1920x1080</html>'),null);
});
