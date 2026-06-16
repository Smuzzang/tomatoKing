/* =========================================================================
 * net.js — PeerJS 기반 서버리스 P2P 1:1 대전
 * 호스트가 6자리 코드로 방을 열면 게스트가 그 코드로 접속한다.
 * 호스트가 게임 엔진 권위를 가지며, 상태 스냅샷을 게스트에 전송한다.
 * ======================================================================= */

const PREFIX = 'tomato-matgo-'; // PeerJS id 충돌 완화용 네임스페이스

function randomCode() {
  // 6자리 숫자 (앞자리 0 방지)
  let s = '';
  for (let i = 0; i < 6; i++) s += Math.floor(Math.random() * 10);
  if (s[0] === '0') s = '1' + s.slice(1);
  return s;
}

function makePeer(id) {
  // 기본 PeerJS 클라우드 브로커 사용 (무료, 서버 불필요)
  return id ? new Peer(id) : new Peer();
}

/* 호스트: 방 열기
 * handlers: { onReady(code), onGuestJoin(), onData(msg), onClose(), onError(e) } */
function host(handlers) {
  const code = randomCode();
  const peer = makePeer(PREFIX + code);
  let conn = null;

  peer.on('open', () => handlers.onReady && handlers.onReady(code));
  peer.on('connection', c => {
    conn = c;
    c.on('open', () => handlers.onGuestJoin && handlers.onGuestJoin());
    c.on('data', d => handlers.onData && handlers.onData(d));
    c.on('close', () => handlers.onClose && handlers.onClose());
  });
  peer.on('error', e => {
    // id 충돌이면 코드 재발급
    if (e.type === 'unavailable-id') { peer.destroy(); return host(handlers); }
    handlers.onError && handlers.onError(e);
  });

  return {
    code,
    send: obj => { try { conn && conn.open && conn.send(obj); } catch (_) {} },
    close: () => { try { peer.destroy(); } catch (_) {} },
    isConnected: () => !!(conn && conn.open),
  };
}

/* 게스트: 코드로 접속
 * handlers: { onConnected(), onData(msg), onClose(), onError(e) } */
function join(code, handlers) {
  const peer = makePeer();
  let conn = null;

  peer.on('open', () => {
    conn = peer.connect(PREFIX + code, { reliable: true });
    conn.on('open', () => handlers.onConnected && handlers.onConnected());
    conn.on('data', d => handlers.onData && handlers.onData(d));
    conn.on('close', () => handlers.onClose && handlers.onClose());
    conn.on('error', e => handlers.onError && handlers.onError(e));
  });
  peer.on('error', e => handlers.onError && handlers.onError(e));

  return {
    send: obj => { try { conn && conn.open && conn.send(obj); } catch (_) {} },
    close: () => { try { peer.destroy(); } catch (_) {} },
    isConnected: () => !!(conn && conn.open),
  };
}

window.Net = { host, join, randomCode };
