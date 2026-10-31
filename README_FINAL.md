# Rich Go - 최종 확정 버전 (RichGo-fixed.zip 기반)

이 버전은 2026-10-31에 최종 확정된 버전입니다.

## 포함 파일
- index.html (개선版, description, icon 타입 명시)
- app.js (원본 로직 유지)
- style.css (원본 유지)
- sw.js (v2, CACHE='richgo-v2', network-first, offline fallback)
- manifest.webmanifest (신규, PWA 설치 필수)
- icon-192.png (안전영역 수정版)
- icon-512.png (안전영역 수정版)
- icon-maskable-512.png (안전영역 수정版, maskable purpose)

## 이전 버전(v1) 대비 수정사항
1. manifest.webmanifest 파일 추가 (설치 에러 해결)
2. sw.js CACHE v1 -> v2, navigation fallback 추가
3. index.html meta description, icon 링크 개선
4. 아이콘 maskable 안전영역 수정 (오렌지 점 잘림 해결)

## 설치 방법
GitHub Pages에 이 폴더 전체 업로드 후 캐시 삭제하면 정상 설치됨.
