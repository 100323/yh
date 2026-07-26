# 更新 XYZW Slim 游戏脚本

## Requested outcome

将桌面提供的 `TEST_REMOTE_MODULE.js`、`game.js`、`main.js` 更新到 `xyzw-web-slim` 的实际运行时资源，完成本地验证、GitHub `main` 发布，并部署到三台 Ubuntu 服务器。

## Scope

- 根据 `vers.959c24357b0f55b7117b1161a34eafaf.js` 的活动版本映射更新三个脚本。
- 验证 JavaScript 语法、源文件与目标文件哈希、前端构建和后端回归测试。
- 提交独立发布提交并推送 `origin/main`。
- 通过仓库部署脚本更新三台服务器，检查提交、文件哈希、PM2 与 `/api/health`。

## Non-goals

- 不修改三个脚本的内容。
- 不更新 bundle config、版本清单或其他游戏资源。
- 不带入原工作区 `codex/tower-floor-limits` 上的三个未推送提交和未跟踪目录。
- 不改服务器生产环境变量或数据库内容。

## Baseline read set

- 用户提供的 `AGENTS.md` 仓库说明。
- `xyzw-web-slim/vers.959c24357b0f55b7117b1161a34eafaf.js`。
- `xyzw-web-slim/jsc-loader.js` 与 `xyzw-web-slim/bootstrap.js` 的 bundle 加载路径。
- `scripts/update-server.sh` 与 `README.md` 的部署说明。
- 当前 `origin/main` 记录：`d452e13`。

## Impact and risks

- 活动加载目标为 `assets/TEST_REMOTE_MODULE/index.94bfb.js`、`assets/game/index.365f3.js`、`assets/launcher/index.f71b7.js`。
- 三个文件是大型压缩/混淆产物，验证以完整文件哈希、`node --check`、应用构建和线上 HTTP/健康检查为主。
- GitHub 或服务器网络不可用会阻塞对应发布阶段；本地代码更新可独立完成。
