/* =========================================================================
 * main.js — 컨트롤러 + 렌더링
 * 모드: single(AI) / host(온라인 방장) / guest(온라인 입장)
 * 호스트·싱글은 엔진 권위를 가지고, 게스트는 스냅샷을 받아 그린다.
 * ======================================================================= */
(function () {
const $ = s => document.querySelector(s);
const App = {
  state: null,        // 엔진 상태(host/single) 또는 스냅샷(guest)
  mode: null,         // 'single' | 'host' | 'guest'
  myIdx: 0,
  diff: 'normal',
  net: null,
  nick: '나',
  busy: false,        // 게스트 입력 잠금(스냅샷 대기)
};

/* localStorage 안전 래퍼 (샌드박스 iframe 대응) */
const LS = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

/* ---------------- 로비 ---------------- */
function initLobby() {
  $('#nickname').value = LS.get('matgo_nick') || '';
  $('#diffSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $('#diffSeg').querySelectorAll('button').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); App.diff = b.dataset.diff;
  });
  $('#btnHelp').addEventListener('click', () => {
    const h = $('#help');
    h.hidden = !h.hidden;
    if (!h.innerHTML) h.innerHTML = HELP_HTML;
  });
  $('#btnSingle').addEventListener('click', startSingle);
  $('#btnHost').addEventListener('click', showCreateRoom);
  $('#btnReady').addEventListener('click', onReadyClick);
  $('#btnStart').addEventListener('click', onStartClick);
  $('#btnCancelHost').addEventListener('click', leaveToLobby);

  // 테이블 클릭 위임
  $('#myHand').addEventListener('click', onHandClick);
  $('#floor').addEventListener('click', onFloorClick);
  $('#bombBtn').addEventListener('click', onBombClick);
  $('#chatSend').addEventListener('click', sendChat);
  $('#chatText').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
  $('#muteBtn').addEventListener('click', () => {
    const m = window.SFX ? SFX.toggleMute() : false;
    $('#muteBtn').textContent = m ? '🔇' : '🔊';
  });
  $('#leaveBtn').addEventListener('click', onLeaveClick);
  $('#fpCards').addEventListener('click', onFirstPickClick); // 선 정하기
  subscribeRooms(); // 공개 방 목록(Firebase)

  // 창 크기 변경 시 바닥패 위치를 현재 화면에 맞춰 재배치
  window.addEventListener('resize', () => {
    clearTimeout(App._rzTo);
    App._rzTo = setTimeout(() => {
      if (!$('#table').hidden && App.state && !App._animating) scatterFloor();
      clampChat();
    }, 100);
  });

  makeChatDraggable(); // 채팅창 헤더 잡고 자유 이동
}

/* 채팅창: 헤더 잡고 이동 + 접기/펼치기 + 우하단 크기조절 */
function makeChatDraggable() {
  const chat = $('#chat'), head = chat && chat.querySelector('.chat-head');
  if (!head) return;
  const title = head.querySelector('.chat-title') || head;
  title.style.cursor = 'move';
  head.style.userSelect = 'none';
  title.title = '드래그해서 옮기기';

  // 위치 고정(드래그 시작): bottom 앵커 → top 앵커로 전환
  function anchorTopLeft() {
    const r = chat.getBoundingClientRect();
    chat.style.left = r.left + 'px';
    chat.style.top = r.top + 'px';
    chat.style.bottom = 'auto';
    chat.style.right = 'auto';
    return r;
  }

  // ── 이동(헤더 드래그) ──
  let drag = null;
  head.addEventListener('pointerdown', e => {
    if (e.target.closest('.chat-toggle')) return; // 접기 버튼은 제외
    const r = anchorTopLeft();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    try { head.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });
  head.addEventListener('pointermove', e => {
    if (!drag) return;
    const w = chat.offsetWidth, h = chat.offsetHeight;
    chat.style.left = Math.max(0, Math.min(innerWidth - w, e.clientX - drag.dx)) + 'px';
    chat.style.top = Math.max(0, Math.min(innerHeight - h, e.clientY - drag.dy)) + 'px';
  });
  const endDrag = e => { if (drag) { drag = null; try { head.releasePointerCapture(e.pointerId); } catch (_) {} } };
  head.addEventListener('pointerup', endDrag);
  head.addEventListener('pointercancel', endDrag);

  // ── 접기/펼치기 ──
  const toggle = $('#chatToggle');
  if (toggle) toggle.addEventListener('click', () => {
    const collapsed = chat.classList.toggle('collapsed');
    toggle.textContent = collapsed ? '▸' : '▾';
    toggle.title = collapsed ? '펼치기' : '접기';
  });

  // ── 크기 조절(우하단 그립) ──
  const grip = $('#chatResize');
  if (grip) {
    let rz = null;
    grip.addEventListener('pointerdown', e => {
      const r = anchorTopLeft();           // 좌상단 기준으로 고정 후 크기 변경
      rz = { left: r.left, top: r.top };
      try { grip.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault(); e.stopPropagation();
    });
    grip.addEventListener('pointermove', e => {
      if (!rz) return;
      const w = Math.max(150, Math.min(innerWidth * 0.7, e.clientX - rz.left));
      const h = Math.max(110, Math.min(innerHeight * 0.85, e.clientY - rz.top));
      chat.style.width = w + 'px';
      chat.style.height = h + 'px';
    });
    const endRz = e => { if (rz) { rz = null; try { grip.releasePointerCapture(e.pointerId); } catch (_) {} } };
    grip.addEventListener('pointerup', endRz);
    grip.addEventListener('pointercancel', endRz);
  }
}
/* 리사이즈 시 채팅창이 화면 밖으로 나가지 않게 보정 */
function clampChat() {
  const chat = $('#chat'); if (!chat || chat.hidden || chat.style.left === '') return;
  const w = chat.offsetWidth, h = chat.offsetHeight;
  const x = Math.max(0, Math.min(innerWidth - w, parseFloat(chat.style.left) || 0));
  const y = Math.max(0, Math.min(innerHeight - h, parseFloat(chat.style.top) || 0));
  chat.style.left = x + 'px'; chat.style.top = y + 'px';
}

function nickname() {
  const n = ($('#nickname').value || '').trim() || '플레이어';
  LS.set('matgo_nick', n);
  return n.slice(0, 8);
}
function show(id) {
  ['lobby', 'waiting', 'firstpick', 'table'].forEach(s => $('#' + s).hidden = (s !== id));
  const chat = $('#chat'); if (chat) chat.hidden = !(id === 'table' && App.mode !== 'single'); // 온라인에서만
  const lv = $('#leaveBtn'); if (lv) lv.hidden = (id !== 'table');
}

/* ---------------- 공개 방 목록(Firebase) ---------------- */
function subscribeRooms() {
  if (!window.Rooms) { renderRooms(null); return; }
  Rooms.subscribe(renderRooms);
}
function renderRooms(list) {
  const wrap = $('#prList'), cnt = $('#prCount'); if (!wrap) return;
  if (list === null) { wrap.innerHTML = '<div class="pr-empty">공개 방 목록을 불러올 수 없어요</div>'; if (cnt) cnt.textContent = ''; return; }
  const rooms = list.filter(r => r.code !== App._myRoomCode); // 내 방은 숨김
  if (cnt) cnt.textContent = rooms.length ? '(' + rooms.length + ')' : '';
  if (!rooms.length) { wrap.innerHTML = '<div class="pr-empty">열린 방이 없어요.<br>방을 만들어보세요!</div>'; return; }
  wrap.innerHTML = '';
  rooms.forEach(r => {
    const players = r.players || 1;
    const playing = r.status === 'playing';
    const full = !playing && (players >= 2 || r.status === 'full');
    const joinable = !playing && !full; // 기다리는 중(1/2)만 입장 가능

    const row = document.createElement('div'); row.className = 'pr-row' + (joinable ? '' : ' busy');
    const info = document.createElement('div'); info.className = 'pr-info';
    const title = document.createElement('div'); title.className = 'pr-title'; title.textContent = r.title || (r.host + '님의 방');
    const sub = document.createElement('div'); sub.className = 'pr-sub';
    let badge = '';
    if (playing) badge = '<span class="pr-badge playing">게임 중</span>';
    else if (full) badge = '<span class="pr-badge full">가득 참 2/2</span>';
    else badge = '<span class="pr-badge open">기다리는 중 1/2</span>';
    sub.innerHTML = `<span class="pr-host">${escapeHtml(r.host)}</span> ${badge}`;
    info.appendChild(title); info.appendChild(sub);
    row.appendChild(info);

    const btn = document.createElement('button'); btn.className = 'pr-join';
    if (joinable) { btn.textContent = '입장'; btn.onclick = () => startJoin(r.code); }
    else { btn.textContent = playing ? '게임 중' : '2/2'; btn.disabled = true; btn.classList.add('off'); }
    row.appendChild(btn);
    wrap.appendChild(row);
  });
}
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* 게임 중 나가기 — 온라인 진행 중이면 패배 처리 경고 */
function onLeaveClick() {
  const s = App.state;
  const forfeit = App.mode !== 'single' && s && s.phase !== 'ended'; // 온라인 + 게임 진행 중
  const box = $('#modalBox');
  box.innerHTML = `<h2>나가기</h2>
    <p class="muted">${forfeit ? '나가면 이 게임은 <b>패배</b>로 처리돼요.<br>(상대가 이긴 것으로 종료됩니다)' : '게임에서 나갈까요?'}</p>
    <div class="leave-actions">
      <button class="btn-leave-now" id="lvNow">${forfeit ? '그래도 나간다 (패배)' : '나가기'}</button>
      <button class="btn-cancel" id="lvCancel">취소</button>
    </div>`;
  $('#modal').hidden = false;
  $('#lvNow').onclick = () => { $('#modal').hidden = true; leaveToLobby(); };
  $('#lvCancel').onclick = () => { $('#modal').hidden = true; };
}

/* 라운드 상태 리셋(연출 카운터 등) */
function resetRoundState() {
  App._seq = 0; App._cap = [0, 0]; App._go = [0, 0]; App._freshDeal = true;
  App._animSeq = -1; App._animating = false; App._inFlightCapIds = null;
  App._floorPos = {}; App._monthSlot = {}; App._flyingFloorIds = null;
}

/* ---------------- 게임 시작 ---------------- */
function startSingle() {
  App.mode = 'single'; App.myIdx = 0; App.nick = nickname();
  window.SFX && SFX.init();
  beginFirstPick();            // 첫 게임은 선(先) 정하기부터
}

/* 실제 딜링 (starter = 선) */
function dealSingle(starter) {
  const seed = (Math.random() * 1e9) | 0;
  App.state = window.Engine.newGame({
    seed, names: [App.nick, 'AI'], aiFlags: [false, true], mode: App.diff, starter: starter || 0,
  });
  resetRoundState();
  clearFx();
  show('table'); dealTicks(); afterChange();
}

/* 다음 판 선(先): 이긴 사람. 나가리면 이전 선 유지 */
function nextStarter() {
  const s = App.state;
  if (!s || !s.result) return 0;
  if (s.result.draw) return (s.starter != null ? s.starter : 0);
  return s.result.winner;
}

/* 딜링 효과음 */
function dealTicks() {
  if (!window.SFX) return;
  for (let i = 0; i < 6; i++) setTimeout(() => SFX.deal(), i * 70);
}

/* 방 만들기 — 제목 입력 팝업 */
function showCreateRoom() {
  const nick = nickname();
  const box = $('#modalBox');
  box.innerHTML = `<h2>방 만들기</h2>
    <label class="field" style="text-align:left"><span>방 제목</span>
      <input id="roomTitleInput" type="text" maxlength="16" placeholder="${nick}님의 방"></label>
    <div class="modal-actions">
      <button class="btn-go" id="crGo">만들기</button>
      <button class="btn-stop" id="crCancel">취소</button>
    </div>`;
  $('#modal').hidden = false;
  const inp = $('#roomTitleInput'); setTimeout(() => inp && inp.focus(), 60);
  const go = () => { const t = ((inp.value || '').trim() || (nick + '님의 방')).slice(0, 16); $('#modal').hidden = true; startHost(t); };
  $('#crGo').onclick = go;
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  $('#crCancel').onclick = () => { $('#modal').hidden = true; };
}

function startHost(title) {
  App.mode = 'host'; App.myIdx = 0; App.nick = nickname();
  App._guestJoined = false; App._leaving = false; App._oppLeftHandled = false; App._rematchWant = [false, false];
  App._myRoomCode = null; App._roomTitle = title || (App.nick + '님의 방');
  App._guestName = null; App._guestReady = false; App.state = null;
  window.SFX && SFX.init();
  showRoomWait();
  App.net = window.Net.host({
    onReady: code => { App._myRoomCode = code; window.Rooms && Rooms.register(code, App._roomTitle, App.nick); },
    onGuestJoin: () => {
      if (App._guestJoined) return;
      App._guestJoined = true; App._guestReady = false;
      App.net.send({ t: 'whoami', name: App.nick });
      App.net.send({ t: 'roominfo', title: App._roomTitle, host: App.nick });
      window.Rooms && Rooms.update(App._myRoomCode, { status: 'full', players: 2 });
      chatSystem('상대가 입장했어요!');
      showRoomWait();
    },
    onData: onHostData,
    onClose: handleOppLeft,
    onError: e => { toast('연결 오류'); leaveToLobby(); },
  });
}

function startJoin(code) {
  App.mode = 'guest'; App.myIdx = 1; App.nick = nickname();
  App._leaving = false; App._oppLeftHandled = false; App._rematchWant = [false, false];
  App._iReady = false; App._roomTitle = '대전 방'; App._hostName = null; App._myRoomCode = null; App.state = null;
  window.SFX && SFX.init();
  resetRoundState();
  toast('접속 중…');
  App.net = window.Net.join(code, {
    onConnected: () => { App.net.send({ t: 'whoami', name: App.nick }); showRoomWait(); chatSystem('연결됐어요!'); },
    onData: onGuestData,
    onClose: handleOppLeft,
    onError: e => { toast('접속 실패'); show('lobby'); },
  });
}

/* 방 대기 화면 (호스트=시작 / 게스트=준비) */
function showRoomWait() {
  show('waiting');
  $('#roomTitleView').textContent = App._roomTitle || '대전 방';
  const isHost = App.mode === 'host';
  $('#rpHostName').textContent = isHost ? App.nick : (App._hostName || '방장');
  $('#rpGuestName').textContent = (isHost ? App._guestName : App.nick) || '대기 중…';
  const readyBtn = $('#btnReady'), startBtn = $('#btnStart'), msg = $('#waitMsg'), grole = $('#rpGuestRole');
  if (isHost) {
    readyBtn.hidden = true; startBtn.hidden = false;
    const hasGuest = !!App._guestName, canStart = hasGuest && App._guestReady;
    startBtn.disabled = !canStart;
    startBtn.textContent = canStart ? '시작' : (hasGuest ? '상대 준비 대기' : '상대 입장 대기');
    msg.textContent = !hasGuest ? '상대 입장을 기다리는 중…' : (App._guestReady ? '상대 준비 완료! 시작하세요' : '상대가 준비 중…');
    grole.textContent = hasGuest ? (App._guestReady ? '준비완료' : '입장') : '';
  } else {
    startBtn.hidden = true; readyBtn.hidden = false;
    readyBtn.disabled = !!App._iReady;
    readyBtn.textContent = App._iReady ? '준비완료 ✓' : '준비';
    msg.textContent = App._iReady ? '방장이 시작하길 기다려요…' : '준비 버튼을 눌러주세요';
    grole.textContent = App._iReady ? '준비완료' : '';
  }
}

function onReadyClick() { // 게스트 준비
  if (App.mode !== 'guest' || App._iReady) return;
  App._iReady = true;
  App.net && App.net.send({ t: 'ready' });
  showRoomWait();
}
function onStartClick() { // 호스트 시작
  if (App.mode !== 'host') return;
  if (!App._guestName || !App._guestReady) { toast('상대가 준비해야 시작할 수 있어요'); return; }
  window.Rooms && Rooms.update(App._myRoomCode, { status: 'playing' });
  beginFirstPick();
}

/* 상대가 연결을 끊음(나가기 포함) */
function handleOppLeft() {
  if (App._leaving) return;
  if (App.mode === 'host') {
    // 게스트 이탈 → 방 유지(새 상대 대기). 게임 중이었으면 부전승
    const wasInGame = App.state && App.state.phase !== 'ended' && !$('#table').hidden;
    if (wasInGame) { window.SFX && SFX.win && SFX.win(); toast('상대가 나가서 승리! 🎉', 'gold'); }
    App._guestJoined = false; App._guestName = null; App._guestReady = false; App.state = null;
    App._rematchWant = [false, false];
    stopTimer(); $('#modal').hidden = true; clearFx();
    window.Rooms && Rooms.update(App._myRoomCode, { status: 'waiting', players: 1, guest: null });
    chatSystem('상대가 나갔어요 — 새 상대를 기다려요');
    showRoomWait();
    return;
  }
  // 게스트: 방장이 끊음/나감
  if (App._oppLeftHandled) return;
  App._oppLeftHandled = true;
  stopTimer();
  const net = App.net; App.net = null; if (net) { try { net.close(); } catch (_) {} }
  const wasInGame = App.state && App.state.phase !== 'ended' && !$('#table').hidden;
  if (wasInGame) {
    window.SFX && SFX.win && SFX.win();
    const box = $('#modalBox');
    box.innerHTML = `<h2>🎉 승리!</h2><p class="muted">상대가 게임에서 나갔어요.</p>
      <div class="modal-actions"><button class="btn-home" id="mHome">메인으로</button></div>`;
    $('#modal').hidden = false; $('#mHome').onclick = leaveToLobby;
  } else {
    toast('방장이 방을 닫았어요'); setTimeout(() => leaveToLobby(), 1200);
  }
}

/* ---------------- 네트워크 수신 ---------------- */
function onHostData(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'whoami') {
    App._guestName = (msg.name || '상대').slice(0, 8);
    window.Rooms && Rooms.update(App._myRoomCode, { guest: App._guestName });
    if (App.state) { App.state.players[1].name = App._guestName; render(); broadcast(); }
    else if (!$('#waiting').hidden) showRoomWait();
    return;
  }
  if (msg.t === 'ready') { App._guestReady = true; chatSystem('상대가 준비했어요'); showRoomWait(); return; }
  if (msg.t === 'rematchWant') { // 게스트가 다시하기 원함
    if (!App._rematchWant) App._rematchWant = [false, false];
    App._rematchWant[1] = true; oppWantsRematch(); checkRematch(); return;
  }
  if (msg.t === 'chat') { addChatMessage(msg.name, msg.text, false); return; }
  if (msg.t === 'intent' && msg.intent && msg.intent.type === 'pickFirst') { hostReceivePick(msg.intent.slot); return; }
  if (msg.t === 'intent') applyGuestIntent(msg.intent);
}
function onGuestData(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'whoami') { App._hostName = (msg.name || '상대').slice(0, 8); if (!$('#waiting').hidden) showRoomWait(); return; }
  if (msg.t === 'roominfo') { App._roomTitle = msg.title || '대전 방'; if (msg.host) App._hostName = msg.host; if (!$('#waiting').hidden) showRoomWait(); return; }
  if (msg.t === 'rematchWant') { oppWantsRematch(); return; } // 호스트가 다시하기 원함(피드백)
  if (msg.t === 'chat') { addChatMessage(msg.name, msg.text, false); return; }
  if (msg.t === 'draw') { guestShowDraw(msg); return; }
  if (msg.t === 'drawResult') { guestShowDrawResult(msg); return; }
  if (msg.t === 'state') {
    App.busy = false;
    const snap = msg.snap;
    // 새 게임(재대국) 감지 → 카운터 리셋 + 결과 모달 닫기
    const fresh = (!snap.playSeq) && snap.phase === 'await_play'
      && snap.players[0].captured.length === 0 && snap.players[1].captured.length === 0;
    if (fresh) { App._seq = 0; App._cap = [0, 0]; App._go = [0, 0]; App._freshDeal = true; }
    if (snap.phase !== 'ended') $('#modal').hidden = true;
    App.state = snap;
    if (App._hostName) App.state.players[0].name = App._hostName;
    show('table');
    markInflight(App.state);
    // 상대(호스트) 회수가 들어오면 렌더 전에 미리 잠금 — 턴 일찍 넘어와 보이는 것 방지
    const glc = App.state.lastCapture;
    if (glc && glc.seq !== App._animSeq && App.state.lastPlay && App.state.lastPlay.by !== App.myIdx && App.state.lastPlay.seq === glc.seq) lockInput(true);
    render();
    applyJuice(Array.isArray(msg.events) ? msg.events : []);
    postRender();
  }
}

function applyGuestIntent(intent) {
  const s = App.state; if (!s || s.phase === 'ended') return;
  // 게스트는 players[1]. 그의 차례일 때만 허용
  if (s.turn !== 1) return;
  if (intent.type === 'play' && s.phase === 'await_play') window.Engine.playCard(s, intent.cardId, intent.shake);
  else if (intent.type === 'bomb' && s.phase === 'await_play') window.Engine.playBomb(s, intent.month);
  else if (intent.type === 'deckPlay' && s.phase === 'await_play') window.Engine.playFromDeck(s);
  else if (intent.type === 'match' && s.phase === 'await_match') window.Engine.resolveMatch(s, intent.chosenId);
  else if (intent.type === 'goStop' && s.phase === 'await_go_stop') window.Engine.decideGoStop(s, intent.decision);
  else if (intent.type === 'kukjinChoose' && s.phase === 'await_kukjin') window.Engine.resolveKukjin(s, intent.asPi);
  else return;
  afterChange();
}

function sanitizeForGuest(state) {
  const snap = window.Engine.clone(state);
  snap.players[0].hand = snap.players[0].hand.map(() => null); // 호스트 손패 숨김
  snap.deck = new Array(snap.deck.length).fill(null);          // 더미 순서 숨김
  snap.turnCtx = null;
  return snap;
}
function broadcast(ev) {
  if (App.mode !== 'host' || !App.net) return;
  App.net.send({ t: 'state', snap: sanitizeForGuest(App.state), events: ev || [] });
}

/* ---------------- 상태 변경 후 처리 ---------------- */
function markInflight(s) {
  const lc = s.lastCapture;
  if (!lc || lc.seq === App._animSeq) return;
  // 회수 카드: 쓸어담기 전까지 스트립에서 숨김
  App._inFlightCapIds = (lc.allIds && lc.allIds.length) ? new Set(lc.allIds) : new Set();
  // 뺏어온 피: 슬라이드 연출 끝나기 전까지 새 주인 더미에서 숨김
  if (lc.stolenIds && lc.stolenIds.length) lc.stolenIds.forEach(id => App._inFlightCapIds.add(id));
  // 바닥에 새로 깔리는(안 먹힌) 패: 날아가는 카드가 착지하기 전까지 바닥에서 숨김
  const fset = new Set();
  const lp = s.lastPlay;
  if (lp && lp.seq === lc.seq) {
    if (lp.hand && !lc.handCaptured) fset.add(lp.hand.id);
    if (lp.deck && !lc.deckCaptured) fset.add(lp.deck.id);
  }
  App._flyingFloorIds = fset;
}
function afterChange() {
  const s = App.state;
  const ev = (s.events || []).slice();
  markInflight(s);
  // 상대 행위로 새 회수가 생기면 렌더 전에 미리 입력 잠금
  // → 턴이 일찍 내게 넘어와 보이거나, 정리 중 내가 패를 내는 걸 방지
  const lc = s.lastCapture;
  if (lc && lc.seq !== App._animSeq && s.lastPlay && s.lastPlay.by !== App.myIdx && s.lastPlay.seq === lc.seq) lockInput(true);
  render();
  applyJuice(ev);
  if (App.mode === 'host') broadcast(ev);
  s.events = [];
  postRender();
}

// 렌더 후 다음 행위자(AI/모달) 처리 — host/single 전용. guest는 onGuestData에서 postRender 호출
function postRender() {
  const s = App.state;
  if (s.phase === 'ended') { setTimeout(() => showResult(s.result), 600); return; }

  const isMine = s.turn === App.myIdx;

  if (App.mode === 'single') {
    const cur = s.players[s.turn];
    if (s.phase === 'await_kukjin') { if (cur.isAI) setTimeout(aiStep, 800); else showKukjinSoon(); return; }
    if (cur.isAI) { setTimeout(aiStep, aiDelay(s.phase)); return; }
    if (s.phase === 'await_go_stop' && isMine) showGoStopSoon();
    return;
  }
  if (App.mode === 'host') {
    if (s.phase === 'await_kukjin') { if (s.kukjinPending.player === 0) showKukjinSoon(); return; }
    if (s.phase === 'await_go_stop' && s.turn === 0) showGoStopSoon();
    return;
  }
  if (App.mode === 'guest') {
    if (s.phase === 'await_kukjin') { if (s.kukjinPending.player === 1) showKukjinSoon(); return; }
    if (s.phase === 'await_go_stop' && s.turn === 1) showGoStopSoon();
    return;
  }
}

// 내 카드 낙하 연출이 끝난 뒤 고/스톱 모달
function showGoStopSoon() { setTimeout(showGoStop, 1950); }

function aiDelay(phase) {
  if (phase === 'await_go_stop') return 1100;
  if (phase === 'await_match') return 700;
  return 2050; // await_play — 사람 턴 연출(엎기→리빌→쓸어담기)이 끝난 뒤 AI가 움직임
}

function aiStep() {
  const s = App.state; if (!s || s.phase === 'ended') return;
  const cur = s.players[s.turn]; if (!cur.isAI) return;
  if (s.phase === 'await_kukjin') { // AI 국진 선택: 열끗 4장+ 이면 열끗, 아니면 쌍피
    const p = s.players[s.kukjinPending.player];
    const animals = p.captured.filter(c => c.type === 'animal' && !c.kukjin).length;
    window.Engine.resolveKukjin(s, animals < 4); afterChange(); return;
  }
  if (s.phase === 'await_play') {
    if (cur.hand.length === 0 && (cur.deckDebt || 0) > 0) { // 손패 없음 → 더미패로 침(폭탄 빚)
      window.Engine.playFromDeck(s);
    } else {
      const bombs = window.Engine.bombableMonths(s);
      if (bombs.length && App.diff !== 'easy') {              // AI 폭탄
        window.Engine.playBomb(s, bombs[0]);
      } else {
        let id = window.AI.chooseCard(s);
        if (App.diff === 'easy' && Math.random() < 0.4) {     // 쉬움: 가끔 랜덤
          const h = cur.hand[(Math.random() * cur.hand.length) | 0]; id = h.id;
        }
        // AI 흔들기: 어려움은 항상, 보통은 절반, 쉬움은 안 함
        const shake = window.Engine.canShake(s, id) && (App.diff === 'hard' || (App.diff === 'normal' && Math.random() < 0.5));
        window.Engine.playCard(s, id, shake);
      }
    }
  } else if (s.phase === 'await_match') {
    window.Engine.resolveMatch(s, window.AI.chooseMatch(s));
  } else if (s.phase === 'await_go_stop') {
    let d = window.AI.chooseGoStop(s);
    if (App.diff === 'hard' && d === 'stop' && s.players[s.turn].scoreInfo.total < 9 && Math.random() < 0.5) d = 'go';
    window.Engine.decideGoStop(s, d);
  }
  afterChange();
}

/* ---------------- 입력 ---------------- */
function onHandClick(e) {
  if (App._animating) return; // 연출 중 입력 잠금
  const el = e.target.closest('.card'); if (!el) return;
  const s = App.state;
  if (!s || s.phase !== 'await_play' || s.turn !== App.myIdx) return;
  // 폭탄 빚: 💣 더미패 카드 클릭 → 더미에서 까서 침
  if (el.dataset.deckPlay) {
    if (!el.dataset.active) return; // 손패 남았거나 첫 장 아님 → 아직 못 침
    App._playSrcRect = null;
    if (App.mode === 'guest') { App.busy = true; App.net.send({ t: 'intent', intent: { type: 'deckPlay' } }); return; }
    window.Engine.playFromDeck(s); afterChange(); return;
  }
  if (!el.dataset.cardId) return;
  const id = el.dataset.cardId;
  App._playSrcRect = el.getBoundingClientRect(); // 낙하 애니메이션 출발점(클릭한 카드)
  if (window.Engine.canShake(s, id)) { askShake(id); return; } // 흔들기 가능 → 물어봄
  doPlay(id, false);
}
/* 흔들기 확인 팝업 */
function askShake(cardId) {
  const box = $('#modalBox');
  box.innerHTML = `<h2>흔들기?</h2>
    <p class="muted">같은 월 3장을 들고 있어요!<br>흔들면 점수 <b>×2</b> — 단, <b>지면 상대 점수도 ×2</b>예요.</p>
    <div class="modal-actions">
      <button class="btn-go" id="shYes">🃏 흔들기 (×2)</button>
      <button class="btn-stop" id="shNo">그냥 내기</button>
    </div>`;
  $('#modal').hidden = false;
  $('#shYes').onclick = () => { $('#modal').hidden = true; doPlay(cardId, true); };
  $('#shNo').onclick = () => { $('#modal').hidden = true; doPlay(cardId, false); };
}
function doPlay(cardId, shake) {
  const s = App.state; if (!s) return;
  if (App.mode === 'guest') { App.busy = true; App.net.send({ t: 'intent', intent: { type: 'play', cardId, shake } }); return; }
  window.Engine.playCard(s, cardId, shake); afterChange();
}
/* 국진 먹은 직후 선택 팝업 (한 번만, 변경 불가) */
function showKukjinSoon() { setTimeout(showKukjin, 1950); }
function showKukjin() {
  const s = App.state;
  if (!s || s.phase !== 'await_kukjin') return;
  const box = $('#modalBox');
  box.innerHTML = `<h2>국진(9월) 획득!</h2>
    <p class="muted">국진을 무엇으로 쓸까요?<br><b>한 번 정하면 바꿀 수 없어요.</b></p>
    <div class="modal-actions">
      <button class="btn-go" id="kjPi">🪙 쌍피 (피 2장)</button>
      <button class="btn-stop" id="kjAni">🦌 열끗</button>
    </div>`;
  $('#modal').hidden = false;
  $('#kjPi').onclick = () => decideKukjin(true);
  $('#kjAni').onclick = () => decideKukjin(false);
}
function decideKukjin(asPi) {
  $('#modal').hidden = true;
  const s = App.state; if (!s) return;
  if (App.mode === 'guest') { App.busy = true; App.net.send({ t: 'intent', intent: { type: 'kukjinChoose', asPi } }); return; }
  window.Engine.resolveKukjin(s, asPi); afterChange();
}
function onBombClick() {
  if (App._animating) return;
  const s = App.state;
  if (!s || s.phase !== 'await_play' || s.turn !== App.myIdx) return;
  const month = Number($('#bombBtn').dataset.month);
  $('#bombBtn').hidden = true;
  if (App.mode === 'guest') { App.busy = true; App.net.send({ t: 'intent', intent: { type: 'bomb', month } }); return; }
  window.Engine.playBomb(s, month); afterChange();
}
function onFloorClick(e) {
  const el = e.target.closest('.card'); if (!el || !el.dataset.cardId) return;
  const s = App.state;
  if (!s || s.phase !== 'await_match' || s.turn !== App.myIdx) return;
  if (!s.choice || !s.choice.options.includes(el.dataset.cardId)) return;
  const id = el.dataset.cardId;
  if (App.mode === 'guest') { App.busy = true; App.net.send({ t: 'intent', intent: { type: 'match', chosenId: id } }); return; }
  window.Engine.resolveMatch(s, id); afterChange();
}

/* ---------------- 고/스톱 모달 ---------------- */
function showGoStop() {
  const s = App.state;
  if (!s || s.phase !== 'await_go_stop') return; // 지연 호출 사이 상태가 바뀌었으면 무시
  const me = s.players[s.turn];
  const sc = (me.scoreInfo || window.Rules.scoreOf(me.captured)).total;
  const box = $('#modalBox');
  box.innerHTML = `
    <h2>${me.goCount > 0 ? `${me.goCount}고 진행 중` : '7점 달성!'}</h2>
    <div class="score-big">${sc}점</div>
    <div class="parts">${scoreParts(me.captured)}</div>
    <p class="muted">더 키울까요, 여기서 끝낼까요?</p>
    <div class="modal-actions">
      <button class="btn-go" id="mGo">고 (GO)</button>
      <button class="btn-stop" id="mStop">스톱 (STOP)</button>
    </div>`;
  $('#modal').hidden = false;
  $('#mGo').onclick = () => decideGoStop('go');
  $('#mStop').onclick = () => decideGoStop('stop');
}
function decideGoStop(d) {
  $('#modal').hidden = true;
  if (d === 'go' && window.SFX) SFX.go();
  const s = App.state;
  if (App.mode === 'guest') { App.busy = true; App.net.send({ t: 'intent', intent: { type: 'goStop', decision: d } }); return; }
  window.Engine.decideGoStop(s, d); afterChange();
}

/* ---------------- 결과 모달 ---------------- */
function showResult(result) {
  const box = $('#modalBox');
  if (!result) return;
  if (window.SFX) {
    if (result.draw) SFX.flip();
    else if (result.winner === App.myIdx) SFX.win();
    else SFX.lose();
  }
  const actions = `<div class="modal-actions">
      <button class="btn-again" id="mAgain">다시하기</button>
      <button class="btn-home" id="mHome">${App.mode === 'single' ? '메인' : '게임방 나가기'}</button>
    </div>`;
  if (result.draw) {
    box.innerHTML = `<h2>나가리 😶</h2><p class="muted">둘 다 점수를 못 냈어요</p>${actions}`;
  } else {
    const iWon = result.winner === App.myIdx;
    const w = App.state.players[result.winner];
    // 진 사람에게: 점당 100원이었으면 얼마 잃었나 드립
    const lostWon = (result.final * 100).toLocaleString();
    const moneyJab = iWon ? '' : `<div class="money-jab">💸 이게 <b>점당 100원</b>짜리 판이었다면<br>당신은 방금 <b class="lost-amount">${lostWon}원</b>을 잃었습니다.<br><span class="kkk">ㅋㅋㅋ</span></div>`;
    box.innerHTML = `
      <h2>${iWon ? '🎉 승리!' : '😢 패배'}</h2>
      <p class="muted">${w.name} 승리</p>
      <div class="score-big">${result.final}점</div>
      <div class="flags">${(result.flags || []).map(f => `<span class="flag">${f}</span>`).join('')}</div>
      <div class="parts">
        기본 ${result.base}점${result.goCount ? ` · ${result.goCount}고 → ${result.withGo}점` : ''}${result.multiplier > 1 ? ` · ×${result.multiplier}` : ''}
        <br>${scoreParts(w.captured)}
      </div>${moneyJab}${actions}`;
  }
  App._rematchWant = [false, false]; // 새 게임 결과 → 다시하기 동의 초기화
  $('#modal').hidden = false;
  $('#mAgain').onclick = rematch;
  $('#mHome').onclick = leaveToLobby;
}

/* 잔여 연출/모달 정리 (새 판 시작 시) */
function clearFx() {
  $('#modal').hidden = true;
  document.querySelectorAll('.fly-card, .impact').forEach(e => e.remove());
  const tw = $('#toasts'); if (tw) tw.innerHTML = '';
  const bc = $('#bigcut'); if (bc) bc.hidden = true;
  const rv = $('#reveal'); if (rv) rv.hidden = true;
  App._animating = false;
  App._flyingFloorIds = null;
  clearTimeout(App._lockTo);
}

/* 다시하기 — 싱글은 즉시, 온라인은 양쪽 동의해야 시작 */
function rematch() {
  if (App.mode === 'single') { stopTimer(); clearFx(); dealSingle(nextStarter()); return; }
  // 온라인: 내 동의 표시 + 상대에게 알림
  if (!App._rematchWant) App._rematchWant = [false, false];
  App._rematchWant[App.myIdx] = true;
  App.net && App.net.send({ t: 'rematchWant' });
  const btn = $('#mAgain'); if (btn) { btn.disabled = true; btn.textContent = '상대 동의 대기 중…'; }
  toast('다시하기 — 상대 동의를 기다려요', 'gold');
  chatSystem('내가 다시하기를 원해요');
  if (App.mode === 'host') checkRematch();
}
/* 호스트: 양쪽 다 동의했으면 새 게임 시작 */
function checkRematch() {
  if (App.mode !== 'host' || !App._rematchWant) return;
  if (App._rematchWant[0] && App._rematchWant[1]) {
    App._rematchWant = [false, false];
    stopTimer(); clearFx();
    hostStartGame(nextStarter());
  }
}
/* 상대가 다시하기를 원함(피드백) */
function oppWantsRematch() {
  chatSystem('상대가 다시하기를 원해요 👀');
  toast('상대가 다시하기를 원해요', 'gold');
}
function leaveToLobby() {
  stopTimer();
  App._leaving = true;       // 내가 나가는 중 → 내 onClose에선 승리 모달 안 뜨게
  App._rematchWant = [false, false];
  window.Rooms && Rooms.unregister(App._myRoomCode); App._myRoomCode = null; // 혹시 남은 방 제거
  $('#modal').hidden = true;
  if (App.net) { App.net.close(); App.net = null; }
  const cm = $('#chatMsgs'); if (cm) cm.innerHTML = '';
  show('lobby');
}
/* 시스템 채팅 메시지 */
function chatSystem(text) {
  const box = $('#chatMsgs'); if (!box) return;
  const el = document.createElement('div'); el.className = 'chat-msg sys'; el.textContent = text;
  box.appendChild(el); box.scrollTop = box.scrollHeight;
}
function hostStartGame(starter) {
  const names = App.state ? [App.state.players[0].name, App.state.players[1].name]
                          : [App.nick, App._guestName || '상대'];
  const seed = (Math.random() * 1e9) | 0;
  App.state = window.Engine.newGame({ seed, names, aiFlags: [false, false], mode: 'classic', starter: starter || 0 });
  resetRoundState();
  clearFx();
  show('table'); dealTicks(); afterChange();
}

/* ---------------- 선(先) 정하기 ---------------- */
const FP_N = 6; // 중앙에 까는 카드 수

/* 서로 다른 월 6장 뽑기(무승부 없음) */
function pickDrawCards(rng) {
  const deck = window.Hwatu.shuffle(window.Hwatu.createDeck(), rng);
  const seen = new Set(), out = [];
  for (const c of deck) { if (!seen.has(c.month)) { seen.add(c.month); out.push(c); if (out.length === FP_N) break; } }
  return out;
}

/* 권위(single/host)가 선 정하기 시작 */
function beginFirstPick() {
  const seed = (Math.random() * 1e9) | 0;
  App._draw = { cards: pickDrawCards(window.Hwatu.makeRng(seed)), picks: [null, null], starter: null, revealed: false };
  show('firstpick');
  renderFirstPick();
  $('#fpStatus').className = 'fp-status';
  $('#fpStatus').textContent = (App.mode === 'single') ? '카드를 한 장 고르세요' : '카드를 고르세요 · 상대도 고르는 중';
  if (App.mode === 'host') broadcastDraw();
}

/* 카드에 표시할 앞면(공개된 픽만) */
function fpFace(d, slot) {
  if (!d.revealed) return null;
  if (slot !== d.picks[0] && slot !== d.picks[1]) return null;
  if (Array.isArray(d.cards)) return d.cards[slot];   // 권위측
  if (d.revealCards) return d.revealCards[slot];      // 게스트측
  return null;
}

function renderFirstPick() {
  const d = App._draw; if (!d) return;
  const n = Array.isArray(d.cards) ? d.cards.length : (d.n || FP_N);
  const wrap = $('#fpCards'); wrap.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const face = fpFace(d, i);
    const mine = d.picks[App.myIdx] === i, opp = d.picks[1 - App.myIdx] === i;
    const slot = document.createElement('div');
    slot.className = 'fp-slot'; slot.dataset.slot = i;
    const canPick = !d.revealed && d.picks[App.myIdx] == null && !d.picks.includes(i);
    if (canPick) slot.classList.add('pickable');
    if ((mine || opp) && !d.revealed) slot.classList.add('taken');
    if (d.revealed && (mine || opp)) slot.classList.add('flip');
    slot.appendChild(window.Hwatu.makeCardEl(face, { faceUp: !!face }));
    const tag = document.createElement('span');
    tag.className = 'fp-tag' + (mine ? ' me' : opp ? ' opp' : '');
    tag.textContent = mine ? '나' : (opp ? '상대' : '');
    slot.appendChild(tag);
    if (d.revealed && face) {
      const mo = document.createElement('span'); mo.className = 'fp-month';
      const th = window.Hwatu.MONTH_THEME[face.month];
      mo.textContent = face.month + '월' + (th ? ' ' + th.name : '');
      slot.appendChild(mo);
    }
    wrap.appendChild(slot);
  }
}

/* 카드 클릭 (모든 모드 공통) */
function onFirstPickClick(e) {
  const slotEl = e.target.closest('.fp-slot'); if (!slotEl) return;
  const d = App._draw; if (!d || d.revealed) return;
  const slot = Number(slotEl.dataset.slot);
  if (d.picks[App.myIdx] != null) return;     // 이미 고름
  if (d.picks.includes(slot)) return;         // 이미 누가 가져간 슬롯
  if (App.mode === 'guest') {
    d.myPick = slot;                          // 내 선택 기억(호스트 draw 갱신에 덮이지 않게)
    d.picks[App.myIdx] = slot;                // 낙관적 표시(호스트가 확정/거부)
    renderFirstPick();
    $('#fpStatus').textContent = '상대를 기다리는 중…';
    App.net && App.net.send({ t: 'intent', intent: { type: 'pickFirst', slot } });
    return;
  }
  authorityPick(App.myIdx, slot);             // single / host
}

/* 권위측: 한쪽 픽 확정 */
function authorityPick(idx, slot) {
  const d = App._draw; if (!d || d.revealed) return;
  if (d.picks[idx] != null || d.picks.includes(slot)) return;
  d.picks[idx] = slot;
  window.SFX && SFX.flip && SFX.flip();
  renderFirstPick();
  if (App.mode === 'host') broadcastDraw();
  // single: 사람이 골랐으면 AI가 곧 고름
  if (App.mode === 'single' && idx === App.myIdx && d.picks[1 - App.myIdx] == null) {
    $('#fpStatus').textContent = 'AI가 고르는 중…';
    setTimeout(() => {
      const free = []; for (let i = 0; i < FP_N; i++) if (!d.picks.includes(i)) free.push(i);
      authorityPick(1 - App.myIdx, free[(Math.random() * free.length) | 0]);
    }, 750);
  }
  if (d.picks[0] != null && d.picks[1] != null) resolveFirstPick();
}

/* 호스트가 게스트 픽 수신 */
function hostReceivePick(slot) {
  const d = App._draw; if (!d || d.revealed) return;
  if (d.picks[1] != null || d.picks.includes(slot)) { broadcastDraw(); return; } // 충돌 → 재동기화
  authorityPick(1, slot);
}

/* 양쪽 완료 → 비교 → 선 결정 → 게임 시작 */
function resolveFirstPick() {
  const d = App._draw;
  const c0 = d.cards[d.picks[0]], c1 = d.cards[d.picks[1]];
  d.starter = (c1.month > c0.month) ? 1 : 0; // 높은 월이 선 (월 중복 없음)
  d.revealed = true;
  if (App.mode === 'host') broadcastDrawResult();
  renderFirstPickReveal();
  setTimeout(() => {
    if (App.mode === 'single') dealSingle(d.starter);
    else if (App.mode === 'host') hostStartGame(d.starter);
  }, 2200);
}

function renderFirstPickReveal() {
  const d = App._draw; if (!d) return;
  renderFirstPick();
  const iWon = d.starter === App.myIdx;
  const st = $('#fpStatus');
  st.className = 'fp-status win';
  st.textContent = iWon ? '🎉 내가 선(先)! 먼저 시작합니다' : '상대가 선(先) — 상대가 먼저 시작해요';
  if (window.SFX) { SFX.flip && SFX.flip(); if (iWon && SFX.sparkle) setTimeout(() => SFX.sparkle(), 250); }
}

function broadcastDraw() {
  if (App.mode !== 'host' || !App.net) return;
  App.net.send({ t: 'draw', n: FP_N, picks: App._draw.picks });
}
function broadcastDrawResult() {
  if (App.mode !== 'host' || !App.net) return;
  const d = App._draw;
  App.net.send({ t: 'drawResult', picks: d.picks, starter: d.starter, c0: d.cards[d.picks[0]], c1: d.cards[d.picks[1]] });
}

/* 게스트: 선 정하기 화면 표시/갱신 */
function guestShowDraw(msg) {
  if (!App._draw || App._draw.revealed) App._draw = { n: msg.n, picks: [null, null], revealed: false, myPick: null };
  App._draw.n = msg.n;
  const me = App.myIdx, opp = 1 - me;
  const auth = msg.picks.slice();
  // 내 낙관적 픽 보존: 권위에 아직 내 픽이 반영 안 됐어도 유지.
  // 단, 호스트가 그 슬롯을 먼저 가져갔으면(충돌) 무효화 → 다시 고르기.
  if (auth[me] == null && App._draw.myPick != null) {
    if (auth[opp] === App._draw.myPick) App._draw.myPick = null;
    else auth[me] = App._draw.myPick;
  } else if (auth[me] != null) {
    App._draw.myPick = auth[me]; // 호스트 확정
  }
  App._draw.picks = auth;
  show('firstpick');
  renderFirstPick();
  const d = App._draw;
  const st = $('#fpStatus'); st.className = 'fp-status';
  if (d.picks[me] == null) st.textContent = '카드를 고르세요';
  else if (d.picks[opp] == null) st.textContent = '상대를 기다리는 중…';
  else st.textContent = '공개 중…';
}
function guestShowDrawResult(msg) {
  const d = App._draw || (App._draw = { n: FP_N, picks: [null, null] });
  d.picks = msg.picks.slice(); d.starter = msg.starter; d.revealed = true;
  d.revealCards = {}; d.revealCards[msg.picks[0]] = msg.c0; d.revealCards[msg.picks[1]] = msg.c1;
  show('firstpick');
  renderFirstPickReveal();
}

/* ---------------- 렌더링 ---------------- */
function render() {
  const s = App.state; if (!s) return;
  // 직전 바닥 카드 위치 스냅샷 (낙하 애니메이션 타겟용 — innerHTML 교체 전에)
  const pf = {};
  $('#floor').querySelectorAll('.card').forEach(c => {
    const id = c.dataset.cardId; if (!id) return;
    const r = c.getBoundingClientRect();
    pf[id] = r;
    const mm = id.slice(1, id.indexOf('_'));
    if (mm && !pf['M' + mm]) pf['M' + mm] = r;
  });
  App._prevFloorRects = pf;

  const me = s.players[App.myIdx], opp = s.players[1 - App.myIdx];
  const myTurn = s.turn === App.myIdx && s.phase !== 'ended';

  $('#myName').textContent = me.name;
  $('#oppName').textContent = opp.name;
  $('#myScore').textContent = window.Rules.scoreOf(me.captured).total + '점';
  $('#oppScore').textContent = window.Rules.scoreOf(opp.captured).total + '점';
  badge('#myGo', me.goCount);
  badge('#oppGo', opp.goCount);

  // 상대 손패(뒷면) + 폭탄 빚(더미패) 표시
  const oh = $('#oppHand'); oh.innerHTML = '';
  opp.hand.forEach(() => oh.appendChild(window.Hwatu.makeCardEl(null, { faceUp: false, small: true })));
  for (let i = 0; i < (opp.deckDebt || 0); i++) {
    const el = window.Hwatu.makeCardEl(null, { faceUp: false, small: true });
    el.classList.add('deck-play');
    oh.appendChild(el);
  }

  // 내 손패
  const mh = $('#myHand'); mh.innerHTML = '';
  // 연출(상대 회수·쓸어담기·피뺏기) 중에는 아직 못 냄 → 정리 끝나면 finishSweep가 다시 렌더
  const canPlay = myTurn && s.phase === 'await_play' && !App._animating;
  me.hand.forEach(c => {
    const el = window.Hwatu.makeCardEl(c, { faceUp: true });
    if (canPlay) {
      el.classList.add('playable');
      if (window.Engine.floorOfMonth(s, c.month).length > 0) el.classList.add('hint');
    }
    mh.appendChild(el);
  });
  // 폭탄 빚: 손패 끝에 💣 더미패 카드. 내 턴이면 언제든 손패 대신 골라 쓸 수 있음(첫 장만 활성)
  const debt = me.deckDebt || 0;
  for (let i = 0; i < debt; i++) {
    const el = window.Hwatu.makeCardEl(null, { faceUp: false });
    el.classList.add('deck-play');
    el.dataset.deckPlay = '1';
    el.title = '손패 대신 더미에서 까서 치기';
    if (canPlay && i === 0 && s.deck.length > 0) { el.classList.add('playable', 'hint'); el.dataset.active = '1'; }
    else el.classList.add('dim');
    mh.appendChild(el);
  }

  // 바닥
  const fl = $('#floor'); fl.innerHTML = '';
  const choosing = s.phase === 'await_match' && myTurn && s.choice;
  s.floor.forEach(c => {
    const el = window.Hwatu.makeCardEl(c, { faceUp: true });
    if (choosing) {
      if (s.choice.options.includes(c.id)) el.classList.add('choose');
      else el.classList.add('dim');
    }
    // 날아가는 중인 카드는 착지 전까지 바닥에서 숨김
    if (App._flyingFloorIds && App._flyingFloorIds.has(c.id)) el.style.opacity = '0';
    fl.appendChild(el);
  });
  scatterFloor(); // 슬롯 배치(같은 월 겹침)

  // 더미
  const dk = $('#deck'); dk.innerHTML = '';
  if (s.deck.length) dk.appendChild(window.Hwatu.makeCardEl(null, { faceUp: false }));
  $('#deckN').textContent = s.deck.length;

  // 획득패
  renderCaptured($('#myCap'), me.captured, true);
  renderCaptured($('#oppCap'), opp.captured, false);
  renderShakes(s); // 흔든 패 공개

  // 차례 표시 / 상태
  const myDeckPlay = myTurn && s.phase === 'await_play' && me.hand.length === 0 && (me.deckDebt || 0) > 0;
  let tag = '';
  if (s.phase === 'ended') tag = '게임 종료';
  else if (s.phase === 'await_match' && myTurn) tag = '가져갈 패를 고르세요';
  else if (s.phase === 'await_go_stop') tag = (myTurn ? '고/스톱 선택' : '상대 고민 중…');
  else if (myDeckPlay) tag = '💣 더미패를 치세요';
  else if (myTurn && App._animating) tag = '잠깐만…'; // 상대 정리 중
  else tag = myTurn ? '내 차례' : '상대 차례';
  const tagEl = $('#turnTag'); tagEl.textContent = tag;
  tagEl.classList.toggle('mine', myTurn && s.phase !== 'ended' && !App._animating);
  $('#statusbar').textContent = choosing ? '같은 월 2장 중 하나를 선택!' : '';

  // 폭탄 버튼
  const bombEl = $('#bombBtn');
  if (myTurn && s.phase === 'await_play') {
    const bombs = window.Engine.bombableMonths(s);
    if (bombs.length) { bombEl.hidden = false; bombEl.dataset.month = bombs[0]; bombEl.textContent = `💣 ${bombs[0]}월 폭탄`; }
    else bombEl.hidden = true;
  } else bombEl.hidden = true;

  // 첫 딜링: 카드 일제히 팝인
  if (App._freshDeal) {
    App._freshDeal = false;
    const cards = [...$('#floor').querySelectorAll('.card'), ...$('#myHand').querySelectorAll('.card')];
    cards.forEach((c, i) => { c.style.animationDelay = (i * 35) + 'ms'; c.classList.add('pop'); });
  }

  manageTimer(s); // 20초 턴 제한
}

/* ---------------- 턴 타이머(20초) ---------------- */
const TURN_LIMIT = 20;
function manageTimer(s) {
  if (App._dev) { stopTimer(); return; } // 테스트 모드: 자동진행 끔
  const actionable = ['await_play', 'await_match', 'await_go_stop', 'await_kukjin'].includes(s.phase);
  if (!actionable || s.phase === 'ended' || s.turn !== App.myIdx || App._animating) { stopTimer(); return; }
  const key = `${s.playSeq || 0}-${s.phase}-${s.turn}`;
  if (key === App._timerKey) return; // 같은 결정점 → 유지
  restartTimer(key);
}
function restartTimer(key) {
  stopTimer();
  App._timerKey = key;
  App._timerLeft = TURN_LIMIT;
  renderTimer();
  App._timerInt = setInterval(() => {
    App._timerLeft--;
    renderTimer();
    if (App._timerLeft <= 0) { stopTimer(); autoAct(); }
  }, 1000);
}
function stopTimer() {
  if (App._timerInt) { clearInterval(App._timerInt); App._timerInt = null; }
  App._timerKey = null;
  const el = $('#timer'); if (el) el.hidden = true;
}
function renderTimer() {
  const el = $('#timer'); if (!el) return;
  el.hidden = false;
  el.textContent = App._timerLeft;
  el.classList.toggle('urgent', App._timerLeft <= 5);
}
function autoAct() {
  const s = App.state; if (!s || s.turn !== App.myIdx) return;
  $('#modal').hidden = true; // 흔들기/고스톱 등 미응답 팝업 닫고 자동 진행
  const guest = App.mode === 'guest';
  if (s.phase === 'await_kukjin') { // 국진 미선택 → 쌍피로 자동
    if (guest) App.net.send({ t: 'intent', intent: { type: 'kukjinChoose', asPi: true } });
    else { window.Engine.resolveKukjin(s, true); afterChange(); }
    return;
  }
  if (s.phase === 'await_play') {
    const cur = s.players[s.turn];
    if (cur.hand.length === 0 && (cur.deckDebt || 0) > 0) { // 손패 없음 → 더미패로 침
      if (guest) App.net.send({ t: 'intent', intent: { type: 'deckPlay' } });
      else { window.Engine.playFromDeck(s); afterChange(); }
      return;
    }
    const bombs = window.Engine.bombableMonths(s);
    if (bombs.length) {
      if (guest) App.net.send({ t: 'intent', intent: { type: 'bomb', month: bombs[0] } });
      else { window.Engine.playBomb(s, bombs[0]); afterChange(); }
      return;
    }
    const id = window.AI.chooseCard(s);
    App._playSrcRect = null;
    if (guest) App.net.send({ t: 'intent', intent: { type: 'play', cardId: id } });
    else { window.Engine.playCard(s, id); afterChange(); }
  } else if (s.phase === 'await_match') {
    const id = window.AI.chooseMatch(s);
    if (guest) App.net.send({ t: 'intent', intent: { type: 'match', chosenId: id } });
    else { window.Engine.resolveMatch(s, id); afterChange(); }
  } else if (s.phase === 'await_go_stop') {
    $('#modal').hidden = true;
    if (guest) App.net.send({ t: 'intent', intent: { type: 'goStop', decision: 'stop' } });
    else { window.Engine.decideGoStop(s, 'stop'); afterChange(); }
  }
}

function badge(sel, n) {
  const el = $(sel);
  if (n > 0) { el.hidden = false; el.textContent = n + '고'; } else el.hidden = true;
}

/* 바닥 슬롯 기하 — 현재 화면 크기 기준 (리사이즈마다 재계산) */
function floorGeom(W, H, cw, chh) {
  const cx = W / 2, cy = H / 2;
  const rxA = Math.min(W / 2 - cw / 2 - 8, cw * 2.7), ryA = Math.min(H / 2 - chh / 2 - 8, chh * 1.3);
  return { cx, cy, rxA, ryA, rxB: rxA * 0.6, ryB: ryA * 0.6 };
}
/* 슬롯 정체성('A3'=바깥 14각 중 3, 'B5'=안쪽 8각 중 5) → 현재 기하의 좌표 */
function slotCoordById(id, g) {
  const k = parseInt(id.slice(1), 10);
  if (id[0] === 'A') { const a = -Math.PI / 2 + k * (2 * Math.PI / 14); return { x: g.cx + Math.cos(a) * g.rxA, y: g.cy + Math.sin(a) * g.ryA }; }
  const a = -Math.PI / 2 + (k + 0.5) * (2 * Math.PI / 8); return { x: g.cx + Math.cos(a) * g.rxB, y: g.cy + Math.sin(a) * g.ryB };
}

/* 바닥의 비어있는 슬롯 1개를 화면 좌표(rect)로 반환 — 쪽 연출에서 낸 패를 깔 자리 */
function freeFloorSlotScreen() {
  const fl = $('#floor');
  const fr = fl.getBoundingClientRect();
  const cardEl = fl.querySelector('.card');
  const cw = (cardEl && cardEl.offsetWidth) || 64, chh = (cardEl && cardEl.offsetHeight) || 105;
  const W = fl.clientWidth || 500, H = fl.clientHeight || 280;
  const g = floorGeom(W, H, cw, chh);
  const ex = cw * 1.05, ey = chh * 0.9;
  const cand = [];
  for (let k = 0; k < 14; k++) cand.push('A' + k);
  for (let k = 0; k < 8; k++) { const c = slotCoordById('B' + k, g); const dx = c.x - g.cx, dy = c.y - g.cy; if ((dx * dx) / (ex * ex) + (dy * dy) / (ey * ey) >= 1) cand.push('B' + k); }
  const used = Object.values(App._monthSlot || {});
  const occ = used.map(id => slotCoordById(id, g));
  let best = cand[0], bestScore = -1;
  cand.forEach(id => {
    if (used.includes(id)) return;
    const c = slotCoordById(id, g);
    let md = 1e9; occ.forEach(o => { const d = Math.hypot(c.x - o.x, c.y - o.y); if (d < md) md = d; });
    if (md > bestScore) { bestScore = md; best = id; }
  });
  const c = slotCoordById(best, g);
  return { left: fr.left + c.x - cw / 2, top: fr.top + c.y - chh / 2, width: cw, height: chh };
}

/* 바닥패 배치: 중앙 덱을 중심으로 한 원형 슬롯에 배치.
 * 월별 슬롯은 "정체성(id)"으로 고정 저장 → 화면 크기가 바뀌어도 현재 크기에 맞춰 재배치.
 * 같은 월(月) 카드는 한 슬롯에 비스듬히 겹쳐 쌓음. */
function scatterFloor() {
  const fl = $('#floor');
  const cards = [...fl.querySelectorAll('.card')];
  App._floorPos = {};
  if (!cards.length) { App._monthSlot = {}; return; }
  const W = fl.clientWidth || 500, H = fl.clientHeight || 280;
  const cw = cards[0].offsetWidth || 64, chh = cards[0].offsetHeight || 105;
  const g = floorGeom(W, H, cw, chh);
  const ex = cw * 1.05, ey = chh * 0.9; // 중앙 덱 회피 타원

  // 후보 슬롯 id: 바깥 14 + (덱 회피 통과한) 안쪽 8
  const cand = [];
  for (let k = 0; k < 14; k++) cand.push('A' + k);
  for (let k = 0; k < 8; k++) { const c = slotCoordById('B' + k, g); const dx = c.x - g.cx, dy = c.y - g.cy; if ((dx * dx) / (ex * ex) + (dy * dy) / (ey * ey) >= 1) cand.push('B' + k); }

  // 월별로 그룹화
  const byMonth = {};
  cards.forEach(el => { const id = el.dataset.cardId || 'x'; const m = id.slice(1, id.indexOf('_')); (byMonth[m] = byMonth[m] || []).push(el); });

  const ms = App._monthSlot || (App._monthSlot = {});
  // 쓸어담기 전인 회수 카드의 월 슬롯은 "예약 상태"로 유지 → 더미 패가 그 자리로 안 들어가게
  const reserved = new Set();
  if (App._inFlightCapIds) App._inFlightCapIds.forEach(id => { const idx = id.indexOf('_'); if (idx > 0) reserved.add(id.slice(1, idx)); });
  Object.keys(ms).forEach(m => { if (!byMonth[m] && !reserved.has(m)) delete ms[m]; }); // 사라진(예약 아닌) 월 슬롯 정리

  // 월마다 슬롯 배정(없으면 가장 빈 슬롯 id) — 사용자가 옮긴(고정) 슬롯이 있으면 그대로 둠
  const taken = () => Object.values(ms);
  Object.keys(byMonth).forEach(m => {
    if (ms[m] == null) {
      const occ = taken().map(id => slotCoordById(id, g));
      let best = cand[0], bestScore = -1;
      cand.forEach(id => {
        if (taken().includes(id)) return;
        const c = slotCoordById(id, g);
        let md = 1e9; occ.forEach(o => { const d = Math.hypot(c.x - o.x, c.y - o.y); if (d < md) md = d; });
        if (md > bestScore) { bestScore = md; best = id; }
      });
      ms[m] = best;
    }
  });

  // 같은 월 카드는 한 슬롯에 비스듬히 겹쳐 쌓기 (선택 상황이면 벌려서 클릭 쉽게)
  Object.keys(byMonth).forEach(m => {
    const slot = slotCoordById(ms[m], g);
    const group = byMonth[m].sort((a, b) => (a.dataset.cardId > b.dataset.cardId ? 1 : -1));
    const choosing = group.some(el => el.classList.contains('choose'));
    group.forEach((el, i) => {
      const ox = i * cw * (choosing ? 0.58 : 0.17);     // 선택 땐 옆으로 넓게
      const oy = -i * chh * (choosing ? 0.04 : 0.09);
      const rot = choosing ? 0 : i * 6.5 + (i ? 0 : -2); // 겹칠수록 더 비스듬히
      const x = slot.x + ox, y = slot.y + oy;
      el.style.left = (x - cw / 2) + 'px';
      el.style.top = (y - chh / 2) + 'px';
      el.style.transform = `rotate(${rot.toFixed(1)}deg)`;
      el.style.zIndex = el.classList.contains('choose') ? '25' : String(3 + i + Math.round((slot.y / H) * 6));
      App._floorPos[el.dataset.cardId] = { x, y, rot }; // 오버레이 연출용
    });
  });
}

function renderCaptured(container, cardsRaw, mine) {
  container.innerHTML = '';
  // 쓸어담기 애니메이션 중인 카드는 아직 스트립에 표시하지 않음
  const skip = App._inFlightCapIds;
  const cards = (skip && skip.size) ? cardsRaw.filter(c => !skip.has(c.id)) : cardsRaw;
  const asPi = c => c.type === 'animal' && c.kukjin && c.kukjinAsPi; // 쌍피로 쓰는 국진
  const groups = {
    gwang: cards.filter(c => c.type === 'gwang'),
    animal: cards.filter(c => c.type === 'animal' && !asPi(c)),
    ribbon: cards.filter(c => c.type === 'ribbon'),
    junk: cards.filter(c => c.type === 'junk' || asPi(c)),
  };
  const labels = { gwang: '광', animal: '열', ribbon: '띠', junk: '피' };
  for (const k of ['gwang', 'animal', 'ribbon', 'junk']) {
    const arr = groups[k]; if (!arr.length) continue;
    const g = document.createElement('div'); g.className = 'cap-group';
    const lab = document.createElement('span'); lab.className = 'cap-label';
    const n = k === 'junk' ? arr.reduce((s, c) => s + (c.kukjin ? 2 : (c.piValue || 1)), 0) : arr.length;
    lab.textContent = `${labels[k]}${n}`; g.appendChild(lab);
    arr.forEach(c => {
      const el = window.Hwatu.makeCardEl(c, { faceUp: true, small: true });
      if (c.kukjin) { // 국진: 먹을 때 정한 용도 표시(열/쌍피)
        el.classList.add('kukjin');
        const b = document.createElement('span'); b.className = 'kukjin-badge';
        b.textContent = c.kukjinAsPi ? '쌍피' : '열';
        el.appendChild(b);
      }
      g.appendChild(el);
    });
    container.appendChild(g);
  }
}

/* 흔든 패 공개: 우측 이벤트 영역에 양쪽이 흔든 3장씩 나란히 표시 */
function renderShakes(s) {
  const z = $('#shakeZone'); if (!z) return;
  z.innerHTML = '';
  [1 - App.myIdx, App.myIdx].forEach(i => { // 상대 먼저(위), 나중(아래)
    const p = s.players[i];
    (p.shaken || []).forEach(sh => {
      const row = document.createElement('div');
      row.className = 'shake-row' + (i === App.myIdx ? ' me' : ' opp');
      const lab = document.createElement('span'); lab.className = 'shake-lab';
      lab.textContent = (i === App.myIdx ? '🃏 내 흔들기' : '🃏 상대 흔들기');
      row.appendChild(lab);
      const cw = document.createElement('div'); cw.className = 'shake-cards';
      sh.cards.forEach(c => cw.appendChild(window.Hwatu.makeCardEl(c, { faceUp: true, small: true })));
      row.appendChild(cw);
      z.appendChild(row);
    });
  });
}

function scoreParts(cards) {
  const info = window.Rules.scoreOf(cards);
  if (!info.parts.length) return '아직 점수 없음';
  return info.parts.map(p => `${p.label} ${p.pts}점`).join(' · ');
}

/* ---------------- 손맛(juice) 연출 ---------------- */
function applyJuice(ev) {
  const s = App.state; if (!s) return;
  const lp = s.lastPlay;
  const lc = s.lastCapture;
  const mine = !!(lp && lp.by === App.myIdx);

  // 회수 정산(finalize)이 새로 생겼을 때 턴 애니메이션 (촥 엎고 → 잠깐 → 먹은패로 쓸어담기)
  let evDelay = 300;
  if (lc && lc.seq !== App._animSeq) {
    App._animSeq = lc.seq;
    if (lp && lp.seq === lc.seq) evDelay = animateTurn(s, lp, mine);
  }

  // 고(GO) 선언 → 큰 금박 컷
  const go = [s.players[0].goCount || 0, s.players[1].goCount || 0];
  const pg = App._go || [0, 0];
  for (let i = 0; i < 2; i++) {
    if (go[i] > pg[i]) { showBigCut(go[i] + '고'); window.SFX && SFX.go(); }
  }
  App._go = go;

  // 이벤트 토스트(우측 중앙) — 바닥 정산이 보인 뒤 표시
  (ev || []).forEach((e, i) => setTimeout(() => fireEvent(e), evDelay + i * 280));
}

/* 한 턴 연출 오케스트레이션. 반환값 = 이벤트 토스트 시작 시점(ms) */
function animateTurn(s, lp, mine) {
  const dur = mine ? 340 : 260;
  const deckDelay = mine ? 460 : 220;
  const deckExtra = mine ? 260 : 170;     // 더미 리빌 떠오름 hold
  const hold = mine ? 360 : 230;          // 정산 보여주는 멈춤
  const sweepDur = mine ? 400 : 300;

  const lc = (s.lastCapture && s.lastCapture.seq === lp.seq) ? s.lastCapture : null;
  const toStrip = lp.by === App.myIdx ? '#myCap' : '#oppCap';
  const persistent = []; // 쓸어담을 오버레이 {el, x, y, w, h}
  // 피 뺏기: 진 쪽 더미 → 이긴 쪽 더미로 슥 슬라이드(쓸어담기 직후)
  const steal = (lc && lc.stolen && lc.stolen.length)
    ? { cards: lc.stolen, fromSel: (lp.by === App.myIdx ? '#oppCap' : '#myCap'), toSel: toStrip }
    : null;

  // 쪽: 짝 없는 패를 냈는데 더미가 그 패와 맞아 둘 다 먹음
  // → 낸 패를 바닥에 깔고, 더미 깐 패가 그 위로 얹히게 (엔진이 둘 다 hcap에 넣어 deckCaptured=false라 이벤트로 감지)
  const isJjok = !!(s.events && s.events.includes('쪽') && lp.hand && lp.deck);
  const jjokTgt = isJjok ? freeFloorSlotScreen() : null;

  lockInput(true);

  // 1) 손패 → 바닥(맞는 패 위에 촥) — 더미패 치기(lp.hand 없음)면 생략
  if (lp.hand) {
    const handTgt = isJjok ? jjokTgt : flyTarget(lp.hand);
    const handSrc = (mine && App._playSrcRect) ? App._playSrcRect : handAreaSrc(lp.by);
    App._playSrcRect = null;
    window.SFX && SFX.slap();
    if (lc && lc.handCaptured) {
      if (isJjok) {
        // 쪽: 낸 패를 바닥 빈 슬롯에 깔기
        const el = flyCard(handSrc, jjokTgt, lp.hand, dur, { persist: true, landRot: 5 });
        if (el) { el.style.zIndex = '20'; persistent.push(rectObj(el, jjokTgt)); }
      } else {
        const off = pairOffset(handTgt, 8);  // 맞는 패 위에 비스듬히 겹침
        const el = flyCard(handSrc, off, lp.hand, dur, { persist: true, landRot: 8 });
        if (el) { el.style.zIndex = '22'; persistent.push(rectObj(el, off)); } // 먹힌 바닥패 위로
      }
    } else {
      flyCard(handSrc, handTgt, lp.hand, dur); // 못 먹으면 바닥에 깔림(자동 제거)
    }
  } else {
    App._playSrcRect = null;
  }

  // 1b) 바닥에서 먹힌 패들: 제자리에 오버레이로 띄워 보여줌(쓸어담기 대상)
  if (lc) addFloorOverlays(lc, persistent);

  // 2) 더미 패: 떠올라 공개 → 바닥에 떨어짐
  let deckLand = dur;
  if (lp.deck) {
    setTimeout(() => {
      window.SFX && SFX.flip();
      const deckTgt = isJjok ? jjokTgt : flyTarget(lp.deck);
      if ((lc && lc.deckCaptured) || isJjok) {
        const off = pairOffset(deckTgt, -7); // 비스듬히 겹침(반대 방향) — 쪽이면 낸 패 위로
        const el = flyDeck(deckSrc(), off, lp.deck, dur, { persist: true, landRot: -6 });
        if (el) { el.style.zIndex = isJjok ? '24' : '22'; persistent.push(rectObj(el, off)); } // 쪽: 낸 패(20) 위로
      } else {
        flyDeck(deckSrc(), deckTgt, lp.deck, dur); // 바닥에 떨어져 깔림
      }
    }, deckDelay);
    deckLand = deckDelay + dur + deckExtra + 120;
  }

  // 3) 모든 행위 끝 → 잠깐 멈춘 뒤 먹은패로 쓸어담기 → (있으면) 피 뺏기 슬라이드
  const sweepStart = (lp.deck ? deckLand : dur) + hold;
  setTimeout(() => sweepToStrip(persistent, toStrip, sweepDur, lp.by, steal), sweepStart);

  // 안전장치: 일정 시간 뒤 무조건 입력 잠금 해제 + 숨겨진 바닥패 노출 + 재렌더
  const stealMs = steal ? (440 + (steal.cards.length - 1) * 90 + 120) : 0;
  const total = sweepStart + sweepDur + persistent.length * 50 + 250 + stealMs;
  clearTimeout(App._lockTo);
  App._lockTo = setTimeout(() => { lockInput(false); revealAllFloor(); render(); }, total + 300);

  return sweepStart; // 이벤트 토스트는 정산 보인 시점에
}

/* 바닥에서 먹힌 패들을 제자리에 오버레이로 띄움(쓸어담기 대상) */
function addFloorOverlays(lc, persistent) {
  const pf = App._prevFloorRects || {};
  const fpos = App._floorPos || {};
  (lc.floorCards || []).forEach(card => {
    const r = pf[card.id];
    if (!r) return; // 위치 모르면 생략(스트립에서 그냥 나타남)
    const rot = fpos[card.id] ? fpos[card.id].rot : 0; // 바닥에 놓였던 각도 유지
    const el = overlayCard(card, r);
    el.style.left = r.left + 'px'; el.style.top = r.top + 'px';
    el.style.transform = `rotate(${rot.toFixed ? rot.toFixed(1) : rot}deg)`;
    el.style.zIndex = '14'; // 낸 패(22)보다 아래
    el.dataset.landRot = rot;
    el.animate([{ transform: `scale(1) rotate(${rot}deg)` }, { transform: `scale(1.08) rotate(${rot}deg)` }, { transform: `scale(1) rotate(${rot}deg)` }],
      { duration: 280, easing: 'ease-out' });
    persistent.push({ el, x: r.left, y: r.top, w: r.width, h: r.height });
  });
}

function sweepToStrip(persistent, stripSel, sweepDur, byIdx, steal) {
  if (!persistent.length) { runStealThenFinish(steal, byIdx); return; }
  const strip = rectOf(stripSel);
  const tx = strip ? strip.left + strip.width / 2 : innerWidth / 2;
  const ty = strip ? strip.top + strip.height / 2 : innerHeight - 40;
  window.SFX && SFX.paper(); // 싹싹
  let last = 0;
  persistent.forEach((p, i) => {
    const dx = tx - (p.x + p.w / 2), dy = ty - (p.y + p.h / 2);
    const delay = i * 45; last = delay;
    const lr = parseFloat(p.el.dataset.landRot || 0); // 비스듬히 회전 유지
    const a = p.el.animate([
      { transform: `translate(0,0) scale(1) rotate(${lr}deg)`, opacity: 1 },
      { transform: `translate(${dx * 0.55}px,${dy * 0.55}px) scale(.9) rotate(${lr}deg)`, opacity: 1, offset: .6 },
      { transform: `translate(${dx}px,${dy}px) scale(.55) rotate(${lr}deg)`, opacity: .15 },
    ], { duration: sweepDur, delay, easing: 'cubic-bezier(.5,0,.7,1)', fill: 'forwards' });
    a.onfinish = () => p.el.remove();
  });
  setTimeout(() => { window.SFX && SFX.tidy(); runStealThenFinish(steal, byIdx); }, sweepDur + last + 80); // 삭삭삭 정리
}

/* 쓸어담기 끝 → 피 뺏기 슬라이드(있으면) → 마무리 */
function runStealThenFinish(steal, byIdx) {
  if (!steal || !steal.cards || !steal.cards.length) { finishSweep(byIdx); return; }
  stealSlide(steal, () => finishSweep(byIdx));
}

/* 진 쪽 더미에서 피를 뽑아 이긴 쪽 더미로 슥 가져오는 연출 */
function stealSlide(steal, done) {
  const from = rectOf(steal.fromSel), to = rectOf(steal.toSel);
  if (!from || !to) { done(); return; }
  const fx = from.left + from.width / 2 - 22, fy = from.top + from.height / 2 - 36;
  const tx = to.left + to.width / 2 - 22, ty = to.top + to.height / 2 - 36;
  const dx = tx - fx, dy = ty - fy;
  window.SFX && SFX.paper && SFX.paper(); // 슥
  let last = 0;
  steal.cards.forEach((c, i) => {
    const el = overlayCard(c, { width: 44, height: 72 });
    el.style.left = fx + 'px'; el.style.top = fy + 'px';
    el.style.zIndex = '40';
    const delay = i * 90; last = delay;
    const a = el.animate([
      { transform: 'translate(0,0) scale(.9) rotate(-10deg)', opacity: 0, offset: 0 },
      { transform: 'translate(0,-14px) scale(1.18) rotate(-6deg)', opacity: 1, offset: .18 },           // 쏙 뽑힘
      { transform: `translate(${dx * 0.55}px,${dy * 0.55 - 22}px) scale(1.05) rotate(8deg)`, opacity: 1, offset: .62 }, // 슥
      { transform: `translate(${dx}px,${dy}px) scale(.66) rotate(0deg)`, opacity: .2, offset: 1 },        // 더미에 안착
    ], { duration: 440, delay, easing: 'cubic-bezier(.4,0,.55,1)', fill: 'forwards' });
    a.onfinish = () => el.remove();
  });
  setTimeout(done, 440 + last + 80);
}

function finishSweep(byIdx) {
  const s = App.state; if (!s) { lockInput(false); return; }
  if (App._inFlightCapIds) App._inFlightCapIds.clear();
  if (App._flyingFloorIds) App._flyingFloorIds.clear();
  lockInput(false);
  render(); // 전체 재렌더 → 이제야 내 손패 playable/타이머 시작, 뺏은 피 새 더미에 표시
  bump(byIdx === App.myIdx ? '#myCap' : '#oppCap');
}

function lockInput(v) { App._animating = v; }
function rectObj(el, t) { return { el, x: t.left, y: t.top, w: t.width || 64, h: t.height || 105 }; }
/* 맞는 패 위에 비스듬히 겹치도록 약간 어긋난 착지 지점 */
function pairOffset(t, rotDeg) {
  const w = t.width || 64, h = t.height || 105;
  const dir = rotDeg >= 0 ? 1 : -1;
  return { left: t.left + dir * w * 0.2, top: t.top - h * 0.16, width: w, height: h };
}
function overlayCard(card, sizeRect) {
  const el = document.createElement('div');
  el.className = 'fly-card';
  el.innerHTML = window.Hwatu.cardFaceSVG(card);
  el.style.width = (sizeRect.width || 64) + 'px';
  el.style.height = (sizeRect.height || 105) + 'px';
  document.body.appendChild(el);
  return el;
}

function showBigCut(text, red) {
  const bc = $('#bigcut'); if (!bc) return;
  bc.innerHTML = `<div class="cut${red ? ' red' : ''}">${text}</div>`;
  bc.hidden = false;
  clearTimeout(App._cutTo);
  App._cutTo = setTimeout(() => { bc.hidden = true; }, 1150);
}

/* ---------------- 채팅 ---------------- */
function sendChat() {
  if (App.mode === 'single') return;
  const inp = $('#chatText');
  const text = (inp.value || '').trim().slice(0, 60);
  if (!text) return;
  inp.value = '';
  addChatMessage(App.nick, text, true);
  App.net && App.net.send({ t: 'chat', name: App.nick, text });
}
function addChatMessage(name, text, mine) {
  const box = $('#chatMsgs'); if (!box) return;
  const el = document.createElement('div');
  el.className = 'chat-msg' + (mine ? ' mine' : '');
  const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = (name || '상대') + ':';
  el.appendChild(nm);
  el.appendChild(document.createTextNode(' ' + text)); // XSS 방지 위해 textNode
  box.appendChild(el);
  while (box.children.length > 40) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
}

const EVENT_MAP = {
  '쪽': ['쪽! 🎯', 'gold'], '뻑': ['뻑! 💥', 'red'], '따닥': ['따닥! ⚡', 'gold'],
  '뻑먹기': ['뻑 회수! 🍱', 'gold'], '자뻑': ['자뻑! 💥💥', 'red'], '싹쓸이': ['싹쓸이! 🧹', 'gold'],
  '폭탄': ['폭탄! 💣', 'red'], '흔들기': ['흔들기! 🃏', 'gold'],
};
function fireEvent(e) {
  if (e.startsWith('피')) { toast(e, 'blue'); return; }
  const m = EVENT_MAP[e];
  if (!m) { toast(e); return; }
  const isRed = m[1] === 'red';
  toast(m[0], isRed ? '' : 'gold');
  flash(isRed ? 'go-red' : 'go-gold');
  shake();
  if (window.SFX) { isRed ? SFX.thud() : SFX.sparkle(); }
}

function toast(text, variant) {
  const wrap = $('#toasts'); if (!wrap) return;
  const t = document.createElement('div');
  t.className = 'toast' + (variant ? ' ' + variant : '');
  t.textContent = text;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 1600);
}

function flash(cls) {
  const f = $('#flash'); if (!f) return;
  f.className = 'flash'; void f.offsetWidth; f.className = 'flash ' + cls;
}
function shake() {
  const t = $('#table'); if (!t) return;
  t.classList.remove('shake'); void t.offsetWidth; t.classList.add('shake');
  setTimeout(() => t.classList.remove('shake'), 420);
}
function bump(sel) {
  const el = $(sel); if (!el) return;
  el.classList.remove('cap-bump'); void el.offsetWidth; el.classList.add('cap-bump');
  setTimeout(() => el.classList.remove('cap-bump'), 460);
}
function markPop(lastPlay) {
  const ids = [lastPlay.hand && lastPlay.hand.id, lastPlay.deck && lastPlay.deck.id].filter(Boolean);
  $('#floor').querySelectorAll('.card').forEach(c => {
    if (ids.includes(c.dataset.cardId)) c.classList.add('pop');
  });
}

/* ── 카드 낙하(촥!) 애니메이션 ── */
function rectOf(sel) { const el = $(sel); return el ? el.getBoundingClientRect() : null; }
function handAreaSrc(byIdx) {
  const r = rectOf(byIdx === App.myIdx ? '#myHand' : '#oppHand');
  if (!r) return { left: innerWidth / 2, top: innerHeight / 2, width: 64, height: 105 };
  return { left: r.left + r.width / 2 - 32, top: r.top, width: 64, height: 105 };
}
function deckSrc() {
  const r = rectOf('#deck') || rectOf('.deck-wrap');
  return { left: r.left, top: r.top, width: r.width || 64, height: r.height || 105 };
}
/* 낸/뒤집은 카드가 떨어질 바닥 지점 */
function flyTarget(card) {
  const pf = App._prevFloorRects || {};
  if (pf['M' + card.month]) return pf['M' + card.month];            // 매칭된 바닥 패 자리
  const el = $('#floor').querySelector(`.card[data-card-id="${card.id}"]`); // 그냥 깔린 자리
  if (el) return el.getBoundingClientRect();
  const fr = $('#floor').getBoundingClientRect();
  return { left: fr.left + fr.width / 2 - 32, top: fr.top + fr.height / 2 - 52, width: 64, height: 105 };
}
function flyCard(src, tgt, card, dur, opts) {
  if (!src || !tgt) return null;
  const persist = opts && opts.persist;
  const lr = (opts && opts.landRot) || 0; // 착지 회전(짝 맞은 패 비스듬히)
  const D = dur || 300;
  const fly = document.createElement('div');
  fly.className = 'fly-card';
  fly.innerHTML = window.Hwatu.cardFaceSVG(card);
  fly.style.left = src.left + 'px';
  fly.style.top = src.top + 'px';
  fly.style.width = (tgt.width || 64) + 'px';
  fly.style.height = (tgt.height || 105) + 'px';
  document.body.appendChild(fly);
  const dx = tgt.left - src.left, dy = tgt.top - src.top;
  const rot = (Math.random() * 16 - 8).toFixed(1);
  const raise = (tgt.height || 105) * 0.95; // 내려치기용 들어올림 높이
  const anim = fly.animate([
    // 손에서 들림
    { transform: `translate(0px,0px) scale(1.28) rotate(${rot}deg)`, opacity: 0.55, offset: 0, easing: 'ease-out' },
    // 타겟 바로 위로 높이 들어올림
    { transform: `translate(${dx}px,${dy - raise}px) scale(1.2) rotate(${rot / 2}deg)`, opacity: 1, offset: 0.5, easing: 'ease-in' },
    // 촥! 위에서 아래로 내려쳐 찰싹 (가로로 눌림)
    { transform: `translate(${dx}px,${dy}px) scale(1.05,0.78) rotate(${lr * 0.5}deg)`, opacity: 1, offset: 0.72, easing: 'ease-out' },
    // 살짝 반동
    { transform: `translate(${dx}px,${dy - raise * 0.13}px) scale(0.97,1.07) rotate(${lr}deg)`, offset: 0.85 },
    { transform: `translate(${dx}px,${dy}px) scale(1) rotate(${lr}deg)`, offset: 1 },
  ], { duration: D, fill: 'forwards' });
  anim.onfinish = persist ? () => commitOverlay(fly, anim, tgt, lr) : () => { revealFloorCard(card.id); fly.remove(); };
  setTimeout(() => impactAt(tgt), Math.round(D * 0.72)); // 착지 충격 효과
  return fly;
}

/* 날아간 카드가 착지하면 바닥의 실제 카드를 나타냄 */
function revealFloorCard(id) {
  if (App._flyingFloorIds) App._flyingFloorIds.delete(id);
  const real = $('#floor').querySelector(`.card[data-card-id="${id}"]`);
  if (real) real.style.opacity = '1';
}
function revealAllFloor() {
  if (!App._flyingFloorIds) return;
  [...App._flyingFloorIds].forEach(id => revealFloorCard(id));
  App._flyingFloorIds = new Set();
}

/* persist 오버레이: 착지 후 위치를 inline에 고정(이후 쓸어담기 기준점) */
function commitOverlay(el, anim, tgt, lr) {
  el.style.left = tgt.left + 'px';
  el.style.top = tgt.top + 'px';
  el.style.transform = lr ? `rotate(${lr}deg)` : 'none';
  el.dataset.landRot = lr || 0;
  try { anim.cancel(); } catch (_) {}
}

/* 더미에서 뽑은 카드: 먼저 위로 떠올라 공개 → 매칭 위치로 내려침 */
function flyDeck(src, tgt, card, dur, opts) {
  if (!src || !tgt) return null;
  const persist = opts && opts.persist;
  const lr = (opts && opts.landRot) || 0;
  const D = dur || 300;
  const total = D + 300; // 리빌 hold 포함
  const fly = document.createElement('div');
  fly.className = 'fly-card';
  fly.innerHTML = window.Hwatu.cardFaceSVG(card);
  fly.style.left = src.left + 'px';
  fly.style.top = src.top + 'px';
  fly.style.width = (tgt.width || 64) + 'px';
  fly.style.height = (tgt.height || 105) + 'px';
  document.body.appendChild(fly);
  const dx = tgt.left - src.left, dy = tgt.top - src.top;
  const lift = (tgt.height || 105) * 0.75;  // 덱에서 위로 떠오르는 높이
  const raise = (tgt.height || 105) * 0.85;
  const anim = fly.animate([
    { transform: `translate(0px,0px) scale(0.86)`, opacity: 0.4, offset: 0, easing: 'ease-out' },
    { transform: `translate(0px,${-lift}px) scale(1.5)`, opacity: 1, offset: 0.2 },           // 위로 떠올라 공개
    { transform: `translate(0px,${-lift}px) scale(1.5)`, opacity: 1, offset: 0.42 },           // 잠깐 멈춰 보여줌
    { transform: `translate(${dx}px,${dy - raise}px) scale(1.22)`, opacity: 1, offset: 0.66, easing: 'ease-in' }, // 타겟 위로
    { transform: `translate(${dx}px,${dy}px) scale(1.05,0.78) rotate(${lr * 0.5}deg)`, opacity: 1, offset: 0.84, easing: 'ease-out' },   // 촥!
    { transform: `translate(${dx}px,${dy}px) scale(1) rotate(${lr}deg)`, opacity: 1, offset: 1 },
  ], { duration: total, fill: 'forwards' });
  anim.onfinish = persist ? () => commitOverlay(fly, anim, tgt, lr) : () => { revealFloorCard(card.id); fly.remove(); };
  setTimeout(() => impactAt(tgt), Math.round(total * 0.84));
  return fly;
}
function impactAt(tgt) {
  const d = document.createElement('div');
  d.className = 'impact';
  d.style.left = (tgt.left + (tgt.width || 64) / 2) + 'px';
  d.style.top = (tgt.top + (tgt.height || 105) / 2) + 'px';
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 380);
}

/* ---------------- 도움말 ---------------- */
const HELP_HTML = `
<b>맞고 기본</b><br>
· 손패 1장 내고, 더미 1장 뒤집어 같은 <b>월(月)</b>끼리 먹어요.<br>
· <b>광</b> 3장=3점(비광 포함 2점)·4장=4점·5장=15점<br>
· <b>고도리</b>(2·4·8월 새 3장)=5점, <b>홍단/청단/초단</b> 각 3점<br>
· <b>열끗·띠</b> 5장부터 1점씩, <b>피</b> 10장부터 1점씩(쌍피=2장)<br>
<b>특수</b> 쪽·뻑·따닥·싹쓸이 시 상대 피 1장씩 빼앗아요.<br>
<b>폭탄</b> 같은 월 3장+바닥 매칭이면 한 번에 털고 한 번 더! 점수 ×2<br>
<b>흔들기</b> 손에 같은 월 3장 들고 그 월을 내면 ×2<br>
<b>고/스톱</b> 7점 넘으면 선택! 고 하면 점수 ↑(3고부터 ×2), 진 사람이 고했으면 <b>고박</b>.<br>
<b>박</b> 피박(상대 피 7장 미만)·광박(상대 광 0장)으로 점수 ×2.<br>
<b>턴 제한</b> 한 턴 20초! 넘기면 자동으로 진행돼요.`;

/* ---------------- 테스트(dev) 모드: ?dev=1 (로컬에서만 작동, 라이브 배포본은 비활성) ---------------- */
function initDev() {
  if (!/[?&]dev\b/.test(location.search)) return;
  const local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)$/.test(location.hostname) || location.protocol === 'file:';
  if (!local) return; // 라이브(github.io 등)에선 테스트 모드 차단
  App._dev = true; // 타이머 자동진행 끔
  const DECK = window.Hwatu.createDeck();
  const C = id => JSON.parse(JSON.stringify(DECK.find(c => c.id === id)));

  function devStart(setup, hint) {
    App.mode = 'single'; App.myIdx = 0; App.nick = '테스트';
    window.SFX && SFX.init();
    const s = window.Engine.newGame({ seed: 1, names: ['나', 'AI'], aiFlags: [false, true], mode: 'normal', starter: 0 });
    s.players[0].hand = []; s.players[1].hand = [C('m12_3')];
    s.players[0].captured = []; s.players[1].captured = [C('m3_2'), C('m3_3'), C('m4_2'), C('m4_3')];
    s.floor = []; s.deck = []; s.phase = 'await_play'; s.turn = 0; s.turnCtx = null; s.ppeok = {}; s.events = []; s.playSeq = 0;
    setup(s);
    App.state = s; resetRoundState(); clearFx();
    show('table'); afterChange();
    toast('🧪 ' + hint, 'gold');
  }

  const SC = {
    '쪽': () => devStart(s => { s.players[0].hand = [C('m5_0'), C('m7_0')]; s.floor = [C('m1_0'), C('m2_0')]; s.deck = [C('m5_1'), C('m8_0')]; }, '5월(난초)을 내세요 → 쪽'),
    '따닥(4장)': () => devStart(s => { s.players[0].hand = [C('m5_0'), C('m7_0')]; s.floor = [C('m5_1'), C('m5_2'), C('m1_0')]; s.deck = [C('m5_3'), C('m8_0')]; }, '5월을 내세요 → 따닥(4장)'),
    '자뻑': () => devStart(s => { s.players[0].hand = [C('m5_0'), C('m7_0')]; s.floor = [C('m5_1'), C('m5_2'), C('m5_3')]; s.ppeok = { '5': 0 }; s.deck = [C('m8_0')]; }, '5월을 내세요 → 자뻑(피 2장)'),
    '2장폭탄': () => devStart(s => { s.players[0].hand = [C('m5_0'), C('m5_1')]; s.floor = [C('m5_2'), C('m5_3'), C('m1_0')]; s.deck = [C('m8_0'), C('m8_1'), C('m10_0'), C('m11_0')]; }, '💣 폭탄 → 손패 비면 빚1 → 💣 더미패 치기'),
    '3장폭탄': () => devStart(s => { s.players[0].hand = [C('m5_0'), C('m5_1'), C('m5_2')]; s.floor = [C('m5_3'), C('m1_0')]; s.deck = [C('m8_0'), C('m8_1'), C('m10_0'), C('m11_0'), C('m12_2')]; }, '💣 폭탄 → 손패 비면 빚2 → 💣 더미패 2번 치기'),
    '흔들기': () => devStart(s => { s.players[0].hand = [C('m5_0'), C('m5_1'), C('m5_2'), C('m7_0')]; s.floor = [C('m1_0'), C('m2_0')]; s.deck = [C('m8_0'), C('m8_1')]; }, '5월(난초)을 내세요 → 흔들기(×2, 이기면 점수 2배)'),
    '국진선택': () => devStart(s => { s.players[0].hand = [C('m9_0'), C('m1_0')]; s.floor = [C('m9_1'), C('m2_0')]; s.deck = [C('m8_0')]; }, '국진(술잔=9월)을 내세요 → 먹는 순간 열끗/쌍피 선택'),
    '마지막판쓸이': () => devStart(s => { s.players[0].hand = [C('m5_0')]; s.floor = [C('m5_1'), C('m8_1')]; s.deck = [C('m8_0')]; }, '마지막 5월을 내세요 → 판쓸이지만 피 안 뺏김(상대 피 변화X 확인)'),
    '폭탄빚(더미패)': () => devStart(s => { s.players[0].hand = [C('m7_0')]; s.players[0].deckDebt = 2; s.floor = [C('m5_1')]; s.deck = [C('m5_2'), C('m8_0'), C('m8_1')]; }, '손패가 있어도 💣 더미패를 골라 쓸 수 있음'),
    '패배결과': () => devStart(s => { s.phase = 'ended'; s.winner = 1; s.result = { winner: 1, base: 7, withGo: 8, multiplier: 2, final: 16, goCount: 1, goBak: false, flags: ['1고', '피박'] }; s.players[1].name = 'AI'; s.players[1].captured = [C('m1_0'), C('m3_0'), C('m8_0'), C('m1_2')]; }, '패배 결과 팝업(점당 100원 드립) 확인'),
  };

  const bar = document.createElement('div');
  bar.id = 'devbar';
  bar.style.cssText = 'position:fixed;top:3px;left:3px;z-index:99999;display:flex;flex-wrap:wrap;gap:3px;max-width:300px;background:rgba(0,0,0,.5);padding:4px;border-radius:6px;';
  Object.keys(SC).forEach(name => {
    const b = document.createElement('button');
    b.textContent = name;
    b.style.cssText = 'font-size:11px;padding:4px 6px;background:#2a2a2a;color:#ffd27a;border:1px solid #666;border-radius:5px;cursor:pointer;';
    b.onclick = SC[name];
    bar.appendChild(b);
  });
  document.body.appendChild(bar);
  toast('🧪 테스트 모드 — 위 버튼으로 상황을 불러오세요', 'gold');
}

/* ---------------- 부팅 ---------------- */
window.addEventListener('DOMContentLoaded', () => { initLobby(); initDev(); });
})();
