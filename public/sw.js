/* Control de Tapas — service worker: only handles push notifications.
   Does not cache anything (the app already re-fetches /api/state on load
   and on its own poll interval, so an offline cache would risk showing
   stale data — not worth it for this app). */

self.addEventListener('install', function(event){
  self.skipWaiting();
});
self.addEventListener('activate', function(event){
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function(event){
  var data = {};
  try{ data = event.data ? event.data.json() : {}; }catch(e){ data = { title:'Control de Tapas', body: event.data ? event.data.text() : '' }; }
  var title = data.title || 'Control de Tapas';
  var options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/' },
    tag: data.tag || undefined
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event){
  event.notification.close();
  var targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type:'window', includeUncontrolled:true }).then(function(clientList){
      for (var i=0; i<clientList.length; i++){
        var c = clientList[i];
        if('focus' in c){ c.focus(); return; }
      }
      if(self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
