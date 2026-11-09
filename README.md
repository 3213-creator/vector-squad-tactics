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


## 현재 게임: VECTOR DUEL 1 대 1

각 플레이어가 오퍼레이터 한 명을 조작하는 턴제 결투입니다. FPS 스타일 HUD를 사용하며 시점은 3인칭 전술 시점입니다. 조준점은 화면 중앙 표시이고 적을 클릭/터치하여 공격합니다. 미니맵에는 모든 위치가 공개됩니다.

| 무기 | 데미지 | 연사 속도 | 탄창 | 사거리 |
|---|---|---|---|---|
| 주무기 라이플 | 35 | 600 RPM | 30발 | 6칸 |
| 보조무기 권총 | 25 | 300 RPM | 12발 | 4칸 |
| 근접무기 칼 | 60 | 90 RPM | 소모 없음 | 1.5칸 |

무기 카드를 클릭/터치하면 장착합니다. 내 턴에 무기 교체는 무료입니다. 이동/공격/재장전은 각각 1 AP, 매 턴 총 2 AP입니다. RPM은 서버의 최소 공격 간격이며 자동 연사는 아닙니다. 다른 무기로 바꿔도 직전 공격 이후 선택 무기의 간격을 충족해야 합니다. 예비 탄약은 무제한이며 재장전하면 탄창이 채워집니다.

중앙 조준점, 좌측 하단 실시간 미니맵, 하단 체력/AP 및 선택 무기의 탄약 HUD를 제공합니다. 회전은 드래그, 확대/축소는 휠 또는 +/− 버튼입니다.

서버는 정적 파일을 시작 시 메모리에 캐시하고 Three.js에 브라우저 캐시를 사용합니다. 상태는 명령이 발생할 때만 전송하며 압축은 사용하지 않습니다. 클라이언트 최대 200개, 방 최대 100개, 메시지 최대 4KB, 참가 대기 30초, 25초 ping/pong, 64KB 이상 송신 적체 연결 종료를 적용합니다. 40ms 미만 요청은 명시적으로 거절합니다. Render PORT 및 0.0.0.0 바인딩, SIGTERM 종료 처리를 지원합니다.

현재 Render는 무료 단일 인스턴스입니다. 무료 절전/첫 접속 지연은 코드 최적화로 제거할 수 없으며 상시 가동은 유료 플랜 선택이 필요합니다. render.yaml은 Blueprint용 설정이고 직접 생성한 서비스는 별도 설정입니다. 배포된 서비스는 기본 TCP 헬스 체크를 사용하며 /healthz는 수동 HTTP 검증용으로 제공됩니다.

로컬 실행: Node.js 22에서 `npm ci`, `npm start`. http://localhost:3000에 두 브라우저로 접속해 같은 방 코드를 입력하세요. `npm test`로 규칙 및 두 WebSocket 상태 동기화를 확인합니다.
