/* =========================================================================
 * rooms.js — Firebase Realtime DB로 "공개 방 목록"만 공유.
 * 게임 플레이 자체는 그대로 PeerJS P2P. Firebase는 대기실 게시판 역할만 한다.
 * 방 데이터: { title, host, guest, status:'waiting'|'full'|'playing', players, ts }
 * (Firebase 미로드/실패 시에도 코드 입장은 정상 동작 — 공개 목록만 비활성)
 * ======================================================================= */
(function () {
  const firebaseConfig = {
    apiKey: "AIzaSyAGw_deogUOOXl1WgPmxanVaWSBfxuUUec",
    authDomain: "tomato-matgo.firebaseapp.com",
    databaseURL: "https://tomato-matgo-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "tomato-matgo",
    storageBucket: "tomato-matgo.firebasestorage.app",
    messagingSenderId: "287631883371",
    appId: "1:287631883371:web:9517536f27280fdecd852e",
  };

  let db = null, ready = false;
  try {
    if (window.firebase && firebase.initializeApp) {
      firebase.initializeApp(firebaseConfig);
      db = firebase.database();
      ready = true;
    }
  } catch (e) { console.warn('[rooms] Firebase 초기화 실패(공개 방 비활성):', e); }

  function available() { return ready && !!db; }

  /* 방 등록(호스트). 접속 끊기면 onDisconnect로 자동 삭제 */
  function register(code, title, hostName) {
    if (!available() || !code) return;
    try {
      const ref = db.ref('rooms/' + code);
      ref.set({
        title: (title || '대전 방').slice(0, 16),
        host: (hostName || '플레이어').slice(0, 8),
        guest: null,
        status: 'waiting',
        players: 1,
        ts: firebase.database.ServerValue.TIMESTAMP,
      });
      ref.onDisconnect().remove(); // 호스트가 끊기면 방 자동 제거
    } catch (e) { console.warn('[rooms] register 실패:', e); }
  }

  /* 방 상태 일부 갱신 (status/players/guest 등) */
  function update(code, fields) {
    if (!available() || !code || !fields) return;
    try { db.ref('rooms/' + code).update(fields); } catch (_) {}
  }

  function unregister(code) {
    if (!available() || !code) return;
    try { db.ref('rooms/' + code).remove(); } catch (_) {}
  }

  /* 열린 방 실시간 구독 → cb(list|null). 반환값: 구독 해제 함수 */
  function subscribe(cb) {
    if (!available()) { cb(null); return function () {}; }
    const ref = db.ref('rooms');
    const handler = ref.on('value', snap => {
      const now = Date.now();
      const list = [];
      snap.forEach(c => {
        const v = c.val(); if (!v) return;
        if (v.ts && (now - v.ts) > 30 * 60 * 1000) return; // 30분 넘은 유령 방 제외
        list.push({
          code: c.key, title: v.title || '대전 방', host: v.host || '플레이어',
          guest: v.guest || null, status: v.status || 'waiting', players: v.players || 1, ts: v.ts || 0,
        });
      });
      list.sort((a, b) => b.ts - a.ts); // 최신 먼저
      cb(list);
    }, err => { console.warn('[rooms] 구독 오류:', err); cb(null); });
    return function () { try { ref.off('value', handler); } catch (_) {} };
  }

  window.Rooms = { available, register, update, unregister, subscribe };
})();
