# TodoCheckpointDraft

## Current todo

- [x] 核对仓库状态、隔离发布分支和活动 bundle 映射。
- [x] 验证旧活动脚本均可通过 `node --check`。
- [x] 用字符串集合相似度确认三个桌面文件与三个活动目标的一一对应关系。
- [x] 替换三个活动脚本并核对哈希。
- [x] 运行更新后的语法检查、前端类型检查和生产构建。
- [x] 提交并推送 GitHub `main`。
- [x] 部署三台服务器并验证。

## Active slice

完成最终证据记录并检查工作树，随后清理隔离 worktree。

## Evidence refs

- 当前活动版本：`TEST_REMOTE_MODULE=94bfb`、`game=365f3`、`launcher=f71b7`。
- 基线语法检查：三个旧活动脚本的 `node --check` 均退出 0。
- 字符串集合相似度：对应目标 Jaccard 分别为 0.5253、0.6325、0.7863；非对应目标均低于 0.007。
- Git 隔离路径：`E:/yh-main/.worktrees/update-slim-game-bundles`，分支 `codex/update-slim-game-bundles` 基于 `origin/main`。
- 更新后 SHA-256：`3EE2BD6F...67453A5`、`D0196C9C...40BC68C`、`3CB62093...1E0B33`，均与桌面源文件一致。
- 更新后语法：三个 `node --check` 均退出 0。
- 前端：`pnpm 10.19.0 typecheck` 退出 0；Vite 生产构建转换 5674 个模块并在 35.16 秒完成。
- GitHub：游戏 bundle 提交 `978ecb8` 已快进推送到 `main`。
- 三台服务器均返回 `FINAL_VERIFY_OK`；磁盘哈希和 `/slim-game/...` HTTP 响应哈希与三项预期值一致。
- 三台 `/api/health` 均为 `ok`，database、scheduler、batchScheduler 均为 `ready`；PM2 PID 保持在线。

## ResumeStateHint

若需恢复，可使用各服务器 `.deploy-backups/slim-bundles-20260726-111635-978ecb8/` 下的三个旧文件。

## DriftCheckDraft

- Scope: 与用户要求一致。
- Compatibility: 保持活动 bundle 文件名和配置不变。
- New branches/adapters: 仅新增隔离发布分支，无运行时分支。
- Evidence growth: 已覆盖文件身份、语法、类型检查、生产构建、GitHub 推送、Linux 磁盘、真实 HTTP 响应与服务健康。
- Decision: `continue` 至清理完成。

## Risk / Unknown

- 本机 Node 24 无 `better-sqlite3` 预编译包且没有 Visual Studio C++ 工具链，后端依赖安装失败；后端代码未改动，运行验证转移到服务器既有 Linux/Node 环境。
- 独立 code-reviewer 多代理接口返回 `unsupported call`，改为按相同清单做自审；不把自审视作独立批准。
- 三台生产仓库原本均有本地提交、已修改文件或生产数据；为避免 `git reset --hard` 破坏现场，本次按范围仅热替换三个静态 bundle。服务器 Git HEAD 未强制对齐 `978ecb8`，但实际文件与 HTTP 内容已直接验证一致。
