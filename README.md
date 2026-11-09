# GitHub → Render 배포

HTML/CSS/JavaScript + Three.js 클라이언트와 Node.js WebSocket 서버를 **하나의 Render Web Service**에서 제공합니다. 별도의 프런트엔드 배포나 WebSocket URL 설정이 필요 없습니다. HTTPS 페이지에서는 자동으로 같은 도메인의 WSS에 연결합니다.

## 1. GitHub에 소스 올리기

GitHub에서 새 저장소를 생성합니다. 첨부 화면의 **Public Git Repository** 방식이면 저장소를 Public으로 만들어야 합니다. Private 저장소는 Render의 **Git Provider → GitHub** 연결을 사용합니다.

아래 파일들이 저장소 최상위에 있도록 올리세요. `squad-tactics` 폴더 전체가 한 단계 안쪽에 들어가지 않도록 합니다.

```text
.github/workflows/test.yml
.gitignore
.node-version
.env.example
package.json
package-lock.json
render.yaml
server.js
game.js
game.test.js
network.test.js
public/
README.md
```

`node_modules`와 압축 파일은 올리지 않습니다. 압축을 풀어 Git을 사용할 경우 프로젝트 폴더에서:

```sh
git init
git add .
git commit -m "Add 5v5 tactical WebSocket game"
git branch -M main
git remote add origin https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git
git push -u origin main
```

위 URL은 본인의 실제 GitHub 저장소 주소로 바꾸세요. GitHub 웹 업로드 방식도 가능합니다. 숨김 파일 `.node-version`, `.gitignore`, `.github`도 포함하세요.

## 2. 첨부한 Render 화면에서 설정

1. Public Git Repository 입력란에 **실제 GitHub 저장소 URL**을 붙여넣고 **Connect**를 누릅니다. Render 예제 주소를 넣는 것이 아닙니다.
2. 다음 설정을 입력합니다.

| 항목 | 값 |
| --- | --- |
| Service type | Web Service (Static Site 아님) |
| Name | vector-squad-tactics 또는 원하는 이름 |
| Language / Runtime | Node |
| Branch | main |
| Region | 플레이어와 가까운 지역 |
| Root Directory | 비워 두기 (소스가 저장소 최상위인 경우) |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Instance Type | Free (테스트용) |
| Health Check Path | `/healthz` |
| Environment variable | `NODE_ENV` = `production` |

Node.js 22는 `.node-version`에 지정되어 있습니다. `PORT`는 Render가 제공하므로 직접 고정하지 마세요. 서버는 `0.0.0.0`과 제공된 포트를 사용합니다. 파일이 저장소의 `squad-tactics/` 하위에 있다면 Root Directory를 `squad-tactics`로 지정하세요.

3. **Deploy Web Service**를 누릅니다. 배포 로그에 `Server listening on port ...`가 나오고 상태가 Live가 되면 Render가 표시한 HTTPS 주소로 접속합니다.
4. 두 기기/브라우저에서 그 주소를 열고 동일한 방 코드(예: `ALPHA`)로 참가합니다. `localhost` 주소는 배포 후 친구에게 보내는 주소가 아닙니다.

## Blueprint 방식 (선택)

수동 입력 대신 Render의 **New → Blueprint**에서 GitHub 저장소를 연결하면 포함된 `render.yaml`을 읽습니다. 위 수동 Web Service 배포와 둘 중 한 방식만 사용하세요. GitHub 연동 및 요금제에 따라 자동 배포 동작이 달라질 수 있으므로 Render 대시보드의 Auto-Deploy 설정을 확인하세요.

## 운영 시 알아둘 점

- 무료 인스턴스는 비활성 상태에서 절전될 수 있어 첫 접속이 지연될 수 있습니다. 계속 실행되는 서비스가 필요하면 적절한 유료 인스턴스를 선택하세요.
- 방과 게임은 메모리에 저장됩니다. 배포/재시작/절전으로 프로세스가 종료되면 진행 상황이 사라집니다.
- 이 버전은 단일 인스턴스로 실행하세요. 여러 인스턴스에서는 접속자가 서로 다른 서버에 배정될 수 있습니다.
- 서버 재시작 또는 상대 연결 종료 후에는 페이지를 새로 고치고 같은 방에 다시 참가해 새 경기를 시작합니다.
- `/healthz`에서 `{"status":"ok"}`가 반환되면 HTTP 서버가 실행 중입니다. 게임 연결 문제는 Render Logs와 브라우저 콘솔에서 확인하세요.
- GitHub Actions는 push/PR 시 `npm ci`와 `npm test`를 실행합니다. Render의 수동 배포 설정 자체를 테스트 성공 여부에 연동하지는 않습니다.
- 계정·데이터베이스·재접속 복구는 추가 구현이 필요합니다.

---

# VECTOR — 5 대 5 턴제 웹 게임 기본 뼈대

오리지널 도형을 사용하는 3D 전술 프로토타입입니다. 특정 게임의 상표·캐릭터·맵은 포함하지 않습니다.

## 실행
Node.js 20 이상에서:

```sh
npm install
npm start
```

두 브라우저 창에서 http://localhost:3000 에 접속한 뒤 같은 방 코드로 참가합니다. 각 플레이어가 5명을 지휘합니다. 다른 기기는 같은 네트워크에서 서버 컴퓨터의 IP:3000으로 접속합니다. 클라우드 배포에는 WebSocket을 지원하는 Node.js 호스팅과 HTTPS/WSS가 필요합니다.

## 규칙
- 첫 접속자 ALPHA, 두 번째 BRAVO. 두 명이 모이면 ALPHA부터 시작합니다.
- 대원 선택 후 상하좌우 인접 빈 칸으로 이동하거나 사거리 5칸 이내 적을 클릭해 공격합니다.
- 대원당 매 턴 행동력 2. 이동/공격 각 1 소모. 공격 피해 35, 초기 체력 100.
- 장애물과 살아 있는 대원이 있는 칸으로 이동할 수 없습니다. 장애물은 사격을 차단합니다.
- 턴 종료 버튼으로 상대에게 넘깁니다. 상대 전멸 시 승리합니다.
- 드래그로 카메라 회전, 휠로 확대/축소합니다.

## 구조
- public/index.html, style.css: 한국어 UI
- public/client.js: Three.js 3D 렌더링, 선택과 WebSocket 통신
- game.js: 초기 상태와 서버 권한 기반 규칙 검증
- server.js: HTTP 정적 파일과 WebSocket 방 관리
- game.test.js: 규칙 및 두 클라이언트 통합 검증

클라이언트는 join / move / attack / end 명령만 전송합니다. 서버가 소유권, 턴, 행동력, 좌표, 사거리, 장애물 및 승리를 검증한 뒤 전체 상태를 두 클라이언트에 전송합니다. joined로 팀 번호, state로 상태, error로 거절 이유를 받습니다. 방 코드 예: ALPHA. 방당 최대 2명이며 방 코드는 영문/숫자/_/- 1~24자입니다.

## 기본 뼈대의 한계
상태는 메모리에만 저장되며 재시작 시 사라집니다. 접속 종료 시 양쪽 연결을 닫고 방을 폐기합니다. 재접속·계정·매치메이킹·턴 제한시간·관전·영속 저장은 미구현입니다. 서버는 25초 간격의 WebSocket ping/pong으로 끊긴 연결을 감지합니다. 방 코드는 인증을 대신하지 않습니다. 모든 대원의 위치는 양쪽에 공개됩니다. 실제 서비스에는 인증, 연결 생존 감시, 더 정교한 요청 제한, 지속 저장 및 다중 서버 방 라우팅을 추가해야 합니다. 외부 Google Fonts가 차단되어도 시스템 글꼴로 동작합니다. Three.js는 npm 패키지에서 로컬 제공됩니다.
