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
  $('#btnHost').addEventListener('click', startHost);
  $('#btnJoin').addEventListener('click', () => {
    const c = $('#joinCode').value.replace(/\D/g, '');
    if (c.length !== 6) return toast('코드 6자리를 입력하세요');
    startJoin(c);
  });
  $('#btnCancelHost').addEventListener('click', () => { App.net && App.net.close(); show('lobby'); });

  // 테이블 클릭 위임
  $('#myHand').addEventListener('click', onHandClick);
  $('#floor').addEventListener('click', onFloorClick);
  $('#bombBtn').addEventListener('click', onBombClick);
  $('#muteBtn').addEventListener('click', () => {
    const m = window.SFX ? SFX.toggleMute() : false;
    $('#muteBtn').textContent = m ? '🔇' : '🔊';
  });
}

function nickname() {
  const n = ($('#nickname').value || '').trim() || '플레이어';
  LS.set('matgo_nick', n);
  return n.slice(0, 8);
}
function show(id) {
  ['lobby', 'waiting', 'table'].forEach(s => $('#' + s).hidden = (s !== id));
}

/* ---------------- 게임 시작 ---------------- */
function startSingle() {
  App.mode = 'single'; App.myIdx = 0; App.nick = nickname();
  window.SFX && SFX.init();
  const seed = (Math.random() * 1e9) | 0;
  App.state = window.Engine.newGame({
    seed, names: [App.nick, 'AI'], aiFlags: [false, true], mode: App.diff,
  });
  App._seq = 0; App._cap = [0, 0]; App._go = [0, 0]; App._freshDeal = true;
  show('table'); dealTicks(); afterChange();
}

/* 딜링 효과음 */
function dealTicks() {
  if (!window.SFX) return;
  for (let i = 0; i < 6; i++) setTimeout(() => SFX.deal(), i * 70);
}

function startHost() {
  App.mode = 'host'; App.myIdx = 0; App.nick = nickname();
  window.SFX && SFX.init();
  show('waiting'); $('#roomCode').textContent = '------'; $('#waitMsg').textContent = '방 여는 중…';
  App.net = window.Net.host({
    onReady: code => { $('#roomCode').textContent = code; $('#waitMsg').textContent = '상대 접속을 기다리는 중…'; },
    onGuestJoin: () => {
      App.net.send({ t: 'whoami', name: App.nick }); // 게스트 닉네임 요청
      hostStartGame();
    },
    onData: onHostData,
    onClose: () => { toast('상대 연결이 끊겼어요'); setTimeout(() => show('lobby'), 1500); },
    onError: e => { toast('연결 오류: ' + (e.type || e.message || e)); show('lobby'); },
  });
}

function startJoin(code) {
  App.mode = 'guest'; App.myIdx = 1; App.nick = nickname();
  window.SFX && SFX.init();
  App._seq = 0; App._cap = [0, 0]; App._go = [0, 0]; App._freshDeal = true;
  toast('접속 중…');
  App.net = window.Net.join(code, {
    onConnected: () => { App.net.send({ t: 'whoami', name: App.nick }); },
    onData: onGuestData,
    onClose: () => { toast('상대 연결이 끊겼어요'); setTimeout(() => show('lobby'), 1500); },
    onError: e => { toast('접속 실패: 코드를 확인하세요'); show('lobby'); },
  });
}

/* ---------------- 네트워크 수신 ---------------- */
function onHostData(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'whoami') {
    if (App.state) { App.state.players[1].name = (msg.name || '상대').slice(0, 8); render(); broadcast(); }
    return;
  }
  if (msg.t === 'rematch') { hostStartGame(); return; }
  if (msg.t === 'intent') applyGuestIntent(msg.intent);
}
function onGuestData(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'whoami') { App._hostName = (msg.name || '상대').slice(0, 8); return; }
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
    render();
    applyJuice(Array.isArray(msg.events) ? msg.events : []);
    postRender();
  }
}

function applyGuestIntent(intent) {
  const s = App.state; if (!s || s.phase === 'ended') return;
  // 게스트는 players[1]. 그의 차례일 때만 허용
  if (s.turn !== 1) return;
  if (intent.type === 'play' && s.phase === 'await_play') window.Engine.playCard(s, intent.cardId);
  else if (intent.type === 'bomb' && s.phase === 'await_play') window.Engine.playBomb(s, intent.month);
  else if (intent.type === 'match' && s.phase === 'await_match') window.Engine.resolveMatch(s, intent.chosenId);
  else if (intent.type === 'goStop' && s.phase === 'await_go_stop') window.Engine.decideGoStop(s, intent.decision);
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
function afterChange() {
  const s = App.state;
  const ev = (s.events || []).slice();
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
    if (cur.isAI) { setTimeout(aiStep, aiDelay(s.phase)); return; }
    if (s.phase === 'await_go_stop' && isMine) showGoStopSoon();
    return;
  }
  if (App.mode === 'host') {
    if (s.phase === 'await_go_stop' && s.turn === 0) showGoStopSoon();
    return;
  }
  if (App.mode === 'guest') {
    if (s.phase === 'await_go_stop' && s.turn === 1) showGoStopSoon();
    return;
  }
}

// 내 카드 낙하 연출이 끝난 뒤 고/스톱 모달
function showGoStopSoon() { setTimeout(showGoStop, 1050); }

function aiDelay(phase) {
  if (phase === 'await_go_stop') return 1100;
  if (phase === 'await_match') return 650;
  return 1100; // await_play — 사람 낙하 연출이 끝난 뒤 AI가 움직이도록
}

function aiStep() {
  const s = App.state; if (!s || s.phase === 'ended') return;
  const cur = s.players[s.turn]; if (!cur.isAI) return;
  if (s.phase === 'await_play') {
    const bombs = window.Engine.bombableMonths(s);
    if (bombs.length && App.diff !== 'easy') {              // AI 폭탄
      window.Engine.playBomb(s, bombs[0]);
    } else {
      let id = window.AI.chooseCard(s);
      if (App.diff === 'easy' && Math.random() < 0.4) {     // 쉬움: 가끔 랜덤
        const h = cur.hand[(Math.random() * cur.hand.length) | 0]; id = h.id;
      }
      window.Engine.playCard(s, id);
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
  const el = e.target.closest('.card'); if (!el || !el.dataset.cardId) return;
  const s = App.state;
  if (!s || s.phase !== 'await_play' || s.turn !== App.myIdx) return;
  const id = el.dataset.cardId;
  App._playSrcRect = el.getBoundingClientRect(); // 낙하 애니메이션 출발점(클릭한 카드)
  if (App.mode === 'guest') { App.busy = true; App.net.send({ t: 'intent', intent: { type: 'play', cardId: id } }); return; }
  window.Engine.playCard(s, id); afterChange();
}
function onBombClick() {
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
    box.innerHTML = `
      <h2>${iWon ? '🎉 승리!' : '😢 패배'}</h2>
      <p class="muted">${w.name} 승리</p>
      <div class="score-big">${result.final}점</div>
      <div class="flags">${(result.flags || []).map(f => `<span class="flag">${f}</span>`).join('')}</div>
      <div class="parts">
        기본 ${result.base}점${result.goCount ? ` · ${result.goCount}고 → ${result.withGo}점` : ''}${result.multiplier > 1 ? ` · ×${result.multiplier}` : ''}
        <br>${scoreParts(w.captured)}
      </div>${actions}`;
  }
  $('#modal').hidden = false;
  $('#mAgain').onclick = rematch;
  $('#mHome').onclick = leaveToLobby;
}

/* 다시하기 / 나가기 */
function rematch() {
  stopTimer();
  if (App.mode === 'single') { startSingle(); return; }
  if (App.mode === 'host') { hostStartGame(); return; }
  // guest → 호스트에 재대국 요청
  $('#modal').hidden = true;
  App.net && App.net.send({ t: 'rematch' });
  toast('재대국 요청을 보냈어요…');
}
function leaveToLobby() {
  stopTimer();
  $('#modal').hidden = true;
  if (App.net) { App.net.close(); App.net = null; }
  show('lobby');
}
function hostStartGame() {
  const names = App.state ? [App.state.players[0].name, App.state.players[1].name] : [App.nick, '상대'];
  const seed = (Math.random() * 1e9) | 0;
  App.state = window.Engine.newGame({ seed, names, aiFlags: [false, false], mode: 'classic' });
  App._seq = 0; App._cap = [0, 0]; App._go = [0, 0]; App._freshDeal = true;
  $('#modal').hidden = true;
  show('table'); dealTicks(); afterChange();
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

  // 상대 손패(뒷면)
  const oh = $('#oppHand'); oh.innerHTML = '';
  opp.hand.forEach(() => oh.appendChild(window.Hwatu.makeCardEl(null, { faceUp: false, small: true })));

  // 내 손패
  const mh = $('#myHand'); mh.innerHTML = '';
  const canPlay = myTurn && s.phase === 'await_play';
  me.hand.forEach(c => {
    const el = window.Hwatu.makeCardEl(c, { faceUp: true });
    if (canPlay) {
      el.classList.add('playable');
      if (window.Engine.floorOfMonth(s, c.month).length > 0) el.classList.add('hint');
    }
    mh.appendChild(el);
  });

  // 바닥
  const fl = $('#floor'); fl.innerHTML = '';
  const choosing = s.phase === 'await_match' && myTurn && s.choice;
  s.floor.forEach(c => {
    const el = window.Hwatu.makeCardEl(c, { faceUp: true });
    if (choosing) {
      if (s.choice.options.includes(c.id)) el.classList.add('choose');
      else el.classList.add('dim');
    }
    fl.appendChild(el);
  });

  // 더미
  const dk = $('#deck'); dk.innerHTML = '';
  if (s.deck.length) dk.appendChild(window.Hwatu.makeCardEl(null, { faceUp: false }));
  $('#deckN').textContent = s.deck.length;

  // 획득패
  renderCaptured($('#myCap'), me.captured);
  renderCaptured($('#oppCap'), opp.captured);

  // 차례 표시 / 상태
  let tag = '';
  if (s.phase === 'ended') tag = '게임 종료';
  else if (s.phase === 'await_match' && myTurn) tag = '가져갈 패를 고르세요';
  else if (s.phase === 'await_go_stop') tag = (myTurn ? '고/스톱 선택' : '상대 고민 중…');
  else tag = myTurn ? '내 차례' : '상대 차례';
  const tagEl = $('#turnTag'); tagEl.textContent = tag;
  tagEl.classList.toggle('mine', myTurn && s.phase !== 'ended');
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
  const actionable = ['await_play', 'await_match', 'await_go_stop'].includes(s.phase);
  if (!actionable || s.phase === 'ended' || s.turn !== App.myIdx) { stopTimer(); return; }
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
  const guest = App.mode === 'guest';
  if (s.phase === 'await_play') {
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

function renderCaptured(container, cards) {
  container.innerHTML = '';
  const groups = {
    gwang: cards.filter(c => c.type === 'gwang'),
    animal: cards.filter(c => c.type === 'animal'),
    ribbon: cards.filter(c => c.type === 'ribbon'),
    junk: cards.filter(c => c.type === 'junk'),
  };
  const labels = { gwang: '광', animal: '열', ribbon: '띠', junk: '피' };
  for (const k of ['gwang', 'animal', 'ribbon', 'junk']) {
    const arr = groups[k]; if (!arr.length) continue;
    const g = document.createElement('div'); g.className = 'cap-group';
    const lab = document.createElement('span'); lab.className = 'cap-label';
    const n = k === 'junk' ? arr.reduce((s, c) => s + (c.piValue || 1), 0) : arr.length;
    lab.textContent = `${labels[k]}${n}`; g.appendChild(lab);
    arr.forEach(c => g.appendChild(window.Hwatu.makeCardEl(c, { faceUp: true, small: true })));
    container.appendChild(g);
  }
}

function scoreParts(cards) {
  const info = window.Rules.scoreOf(cards);
  if (!info.parts.length) return '아직 점수 없음';
  return info.parts.map(p => `${p.label} ${p.pts}점`).join(' · ');
}

/* ---------------- 손맛(juice) 연출 ---------------- */
function applyJuice(ev) {
  const s = App.state; if (!s) return;

  // 내 턴이면 더 천천히(몰입감), 상대/AI 턴이면 빠르게
  const lp = s.lastPlay;
  const mine = !!(lp && lp.by === App.myIdx);
  const dur = mine ? 400 : 300;          // 카드 비행 시간
  const deckDelay = mine ? 560 : 240;    // 손패 착지 후 더미 뒤집기까지
  const capDelay = mine ? (lp && lp.deck ? 1000 : 560) : 260;
  const evBase = mine ? 900 : 220;

  // 카드 낙하 연출: 낸 패 → 바닥 매칭 위치로 촥! / 더미 → 매칭 위치로
  const seq = s.playSeq || 0;
  if (seq !== App._seq) {
    App._seq = seq;
    if (lp) {
      const handSrc = (mine && App._playSrcRect) ? App._playSrcRect : handAreaSrc(lp.by);
      App._playSrcRect = null;
      flyCard(handSrc, flyTarget(lp.hand), lp.hand, dur);
      window.SFX && SFX.play();
      if (lp.deck) {
        setTimeout(() => { flyCard(deckSrc(), flyTarget(lp.deck), lp.deck, dur); window.SFX && SFX.flip(); }, deckDelay);
      }
    }
  }

  // 획득 증가 → 소리 + 반짝 (낙하 애니메이션 끝난 뒤)
  const cc = [s.players[0].captured.length, s.players[1].captured.length];
  const prev = App._cap || cc;
  if (cc[0] > prev[0] || cc[1] > prev[1]) {
    setTimeout(() => window.SFX && SFX.capture(), capDelay);                 // 싹싹(쌓임)
    if (cc[App.myIdx] > prev[App.myIdx]) setTimeout(() => bump('#myCap'), capDelay);
    if (cc[1 - App.myIdx] > prev[1 - App.myIdx]) setTimeout(() => bump('#oppCap'), capDelay);
    setTimeout(() => window.SFX && SFX.tidy(), capDelay + (mine ? 480 : 260)); // 삭삭삭(정리)
  }
  App._cap = cc;

  // 고(GO) 선언 → 큰 금박 컷
  const go = [s.players[0].goCount || 0, s.players[1].goCount || 0];
  const pg = App._go || [0, 0];
  for (let i = 0; i < 2; i++) {
    if (go[i] > pg[i]) { showBigCut(go[i] + '고'); window.SFX && SFX.go(); }
  }
  App._go = go;

  // 이벤트별 토스트 + 효과 (우측 중앙) — 낙하 끝난 뒤 표시
  (ev || []).forEach((e, i) => setTimeout(() => fireEvent(e), evBase + i * 280));
}

function showBigCut(text, red) {
  const bc = $('#bigcut'); if (!bc) return;
  bc.innerHTML = `<div class="cut${red ? ' red' : ''}">${text}</div>`;
  bc.hidden = false;
  clearTimeout(App._cutTo);
  App._cutTo = setTimeout(() => { bc.hidden = true; }, 1150);
}

const EVENT_MAP = {
  '쪽': ['쪽! 🎯', 'gold'], '뻑': ['뻑! 💥', 'red'], '따닥': ['따닥! ⚡', 'gold'],
  '뻑먹기': ['뻑 회수! 🍱', 'gold'], '싹쓸이': ['싹쓸이! 🧹', 'gold'],
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
function flyCard(src, tgt, card, dur) {
  if (!src || !tgt) return;
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
  const anim = fly.animate([
    { transform: `translate(0px,0px) scale(1.35) rotate(${rot}deg)`, opacity: 0.7, offset: 0 },
    { transform: `translate(${dx * 0.82}px,${dy * 0.82}px) scale(1.14) rotate(${(rot / 2)}deg)`, opacity: 1, offset: 0.5 },
    { transform: `translate(${dx}px,${dy}px) scale(0.9) rotate(0deg)`, opacity: 1, offset: 0.78 }, // 촥! 찰싹
    { transform: `translate(${dx}px,${dy}px) scale(1) rotate(0deg)`, opacity: 1, offset: 1 },
  ], { duration: D, easing: 'cubic-bezier(.35,.85,.25,1)', fill: 'forwards' });
  anim.onfinish = () => fly.remove();
  setTimeout(() => impactAt(tgt), Math.round(D * 0.77)); // 착지 충격 효과
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

/* ---------------- 부팅 ---------------- */
window.addEventListener('DOMContentLoaded', initLobby);
})();
