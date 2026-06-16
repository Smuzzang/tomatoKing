# 🍅 토마토 맞고 (Tomato Matgo)

웹에서 즐기는 2인 맞고(고스톱). PC 가로 화면. **AI 싱글플레이 + 서버 없는 P2P 온라인 1:1 대전.**
순수 HTML/CSS/JS — 빌드 과정 없음. 화투는 실제 화투패 이미지(`cards/`)를 사용.

## 폴더 구조
```
matgo/
├─ index.html        # 진입점
├─ css/style.css
├─ js/
│  ├─ cards.js       # 화투 48장 데이터 + 이미지 매핑
│  ├─ rules.js       # 점수 계산
│  ├─ engine.js      # 룰 엔진(턴 상태머신, 특수이벤트, 고/스톱, 박)
│  ├─ ai.js          # 싱글플레이 AI
│  ├─ net.js         # PeerJS P2P
│  ├─ sfx.js         # Web Audio 합성 효과음
│  └─ main.js        # 컨트롤러 + 렌더링
├─ cards/            # 화투 이미지 48장 + back.png (파일명 MMI.png, MM=월 I=1~4)
├─ cover.html        # 썸네일 생성용
└─ thumbnail.png     # 등록용 썸네일(600×400)
```

## 화투 이미지 출처 / 라이선스 ⚠️
- 카드 이미지는 오픈소스 저장소 [aaronrwang/HwaTu](https://github.com/aaronrwang/HwaTu)의 화투 PNG를 내려받아 280px로 다운스케일해 `cards/`에 포함(총 ~2MB).
- 화투 도안 자체는 전통(퍼블릭 도메인)이지만 **이 디지털 렌더링의 권리는 원작자에게 있을 수 있음**. 개인/비상업 아케이드 등록엔 대개 무방하나, 공식 배포 전 라이선스 확인 또는 직접 보유한 이미지로 교체 권장.

## 규칙 요약
- 광 3장 3점(비광 포함 2점)/4장 4점/5장 15점, 고도리 5점, 홍·청·초단 각 3점
- 열끗·띠 5장부터 +1점, 피 10장부터 +1점(쌍피=2장)
- 특수: 쪽·뻑·따닥·싹쓸이 → 상대 피 1장
- 폭탄: 같은 월 3장+바닥 매칭 → 한 번에 털고 한 번 더, ×2
- 흔들기: 손에 같은 월 3장 보유 후 그 월 내면 ×2
- 7점 이상부터 고/스톱, 3고부터 ×2, 고박·피박·광박 배수
- 턴 제한 20초(초과 시 자동 진행)

## 로컬 실행
```
python -m http.server 8000
# http://localhost:8000
```

## GitHub Pages 배포
1. GitHub에 새 저장소 생성 (예: `tomato-matgo`)
2. 이 폴더 전체 업로드 (index.html이 루트에 오도록)
3. Settings → Pages → Source: `main` 브랜치 `/ (root)` → Save
4. 1~2분 뒤 `https://<아이디>.github.io/tomato-matgo/` 로 접속 가능

> 온라인 대전은 PeerJS 공개 브로커를 쓰므로 **HTTPS(=github.io)** 에서만 정상 동작합니다.

## Tomato Arcade 등록
https://tomato-arcade.vercel.app/submit 에서 Google 로그인 후:
- 제목: `토마토 맞고`
- 한줄 소개: `화투 한 판, 고냐 스톱이냐 — AI·온라인 맞고`
- 게임 URL: 위 GitHub Pages 주소
- 썸네일: `thumbnail.png`
