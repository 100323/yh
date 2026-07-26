# TodoCheckpointDraft

## Current todo

- [x] 核对仓库状态、隔离发布分支和活动 bundle 映射。
- [x] 验证旧活动脚本均可通过 `node --check`。
- [x] 用字符串集合相似度确认三个桌面文件与三个活动目标的一一对应关系。
- [x] 替换三个活动脚本并核对哈希。
- [x] 运行更新后的语法检查、前端类型检查和生产构建。
- [ ] 提交并推送 GitHub `main`。
- [ ] 部署三台服务器并验证。

## Active slice

提交经过复核的三个活动 bundle 脚本和任务证据，然后推送 GitHub `main`。

## Evidence refs

- 当前活动版本：`TEST_REMOTE_MODULE=94bfb`、`game=365f3`、`launcher=f71b7`。
- 基线语法检查：三个旧活动脚本的 `node --check` 均退出 0。
- 字符串集合相似度：对应目标 Jaccard 分别为 0.5253、0.6325、0.7863；非对应目标均低于 0.007。
- Git 隔离路径：`E:/yh-main/.worktrees/update-slim-game-bundles`，分支 `codex/update-slim-game-bundles` 基于 `origin/main`。
- 更新后 SHA-256：`3EE2BD6F...67453A5`、`D0196C9C...40BC68C`、`3CB62093...1E0B33`，均与桌面源文件一致。
- 更新后语法：三个 `node --check` 均退出 0。
- 前端：`pnpm 10.19.0 typecheck` 退出 0；Vite 生产构建转换 5674 个模块并在 35.16 秒完成。

## ResumeStateHint

继续前先运行提交前自审与 `git diff --check`；随后提交并推送 `origin/main`。

## DriftCheckDraft

- Scope: 与用户要求一致。
- Compatibility: 保持活动 bundle 文件名和配置不变。
- New branches/adapters: 仅新增隔离发布分支，无运行时分支。
- Evidence growth: 已覆盖文件身份、语法、类型检查和生产构建；Linux 运行与 HTTP 验证待部署阶段完成。
- Decision: `continue`。

## Risk / Unknown

- 本机 Node 24 无 `better-sqlite3` 预编译包且没有 Visual Studio C++ 工具链，后端依赖安装失败；后端代码未改动，运行验证转移到服务器既有 Linux/Node 环境。
- 独立 code-reviewer 多代理接口返回 `unsupported call`，改为按相同清单做自审；不把自审视作独立批准。
