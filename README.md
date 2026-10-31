# Rich Go - 임대료 납부 관리 (PWA)

폰 홈 화면에 설치해서 쓰는 웹앱입니다. 데이터는 **이 폰의 브라우저에만** 저장되며, 서버로 전송되지 않습니다.

## 파일 구성
- `index.html`, `style.css`, `app.js` : 앱 본체
- `manifest.webmanifest`, `sw.js`, `icon-*.png` : 홈 화면 설치 / 오프라인 지원
- 모두 같은 폴더(맨 위 경로)에 올려야 합니다.

## 배포 방법 (GitHub Pages, 무료)
1. github.com 가입 → 우측 상단 `+` → **New repository**
   - 이름: `richgo` (아무거나 가능), **Public** 선택 → Create
2. 만들어진 저장소 화면에서 **uploading an existing file** 클릭
3. 이 폴더의 파일 **8개를 전부 끌어다 놓기**(zip이 아니라 풀어서 파일 자체를) → **Commit changes**
4. 저장소 **Settings → Pages** → Source: `Deploy from a branch`, Branch: `main` / `(root)` → Save
5. 1~2분 뒤 `https://내아이디.github.io/richgo/` 주소가 생깁니다.

> 코드만 공개되고, 입력한 세입자 정보는 올라가지 않습니다. (데이터는 폰 안에만 저장)

## 폰에 설치 (Android Chrome)
1. 위 주소를 Chrome으로 열기
2. 메뉴(⋮) → **홈 화면에 추가** 또는 **앱 설치**
3. 홈 화면의 **Rich Go** 아이콘으로 실행

## 꼭 알아둘 점
- 설정 → **백업 파일 저장**을 정기적으로(월 1회 이상) 해 두세요. 브라우저 데이터를 지우거나 폰을 바꾸면 기록이 사라집니다.
- 설치 후 **한 번 접속**하면 이후엔 인터넷 없이도 열립니다.
- 앱을 고쳐서 다시 올리면, 폰에서 앱을 닫았다 열 때(또는 새로고침) 새 버전이 반영됩니다.
- 연체/납부 알림은 푸시가 아니라, 앱을 열면 홈 화면 상단에 **연체 N건**으로 표시됩니다.
