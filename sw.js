/* Offline support: serve the app from cache, refresh the cache in the background when online */
var CACHE="memjournal-v16";
var FILES=["./","index.html","manifest.webmanifest","icons/icon-192.png","icons/icon-512.png","icons/apple-touch-icon.png"];
/* Mimi's voice clips are cached too, so reminders sound the same offline; a missing voice folder is fine */
function cacheVoice(c,lang){return fetch("voice/"+lang+"/index.json").then(function(r){return r.ok?r.json():{}}).then(function(m){
 var files=Object.keys(m).map(function(k){return "voice/"+lang+"/"+m[k]});return files.length?c.addAll(["voice/"+lang+"/index.json"].concat(files)):null}).catch(function(){})}
self.addEventListener("install",function(e){e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(FILES).then(function(){return cacheVoice(c,"zh")})}));self.skipWaiting()});
self.addEventListener("activate",function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k!==CACHE}).map(function(k){return caches.delete(k)}))}));self.clients.claim()});
self.addEventListener("fetch",function(e){
 if(e.request.method!=="GET"||new URL(e.request.url).origin!==location.origin)return;
 e.respondWith(caches.match(e.request).then(function(hit){
  var net=fetch(e.request).then(function(r){if(r&&r.ok){var copy=r.clone();caches.open(CACHE).then(function(c){c.put(e.request,copy)})}return r}).catch(function(){return hit});
  return hit||net}))});
