# EvidenceBundleDraft

## File identity

| Source | Active target | SHA-256 |
| --- | --- | --- |
| `Desktop/TEST_REMOTE_MODULE.js` | `assets/TEST_REMOTE_MODULE/index.94bfb.js` | `3EE2BD6F42EE54730EC96D3F7EE3038F598B269A10509D0C48B26DB0F67453A5` |
| `Desktop/game.js` | `assets/game/index.365f3.js` | `D0196C9CFAA06E4C206AAA2A910EC9FC9B442011E0B77A745AD9B26B240BC68C` |
| `Desktop/main.js` | `assets/launcher/index.f71b7.js` | `3CB6209390CED0DA6D5B30B0B2503FA764C938283A7D577616236D89771E0B33` |

每组源文件与目标文件哈希相同。

## Local verification

- `node --check`：三个更新目标均退出 0。
- `corepack pnpm@10.19.0 typecheck`：退出 0。
- `corepack pnpm@10.19.0 build`：Vite 转换 5674 个模块，`built in 35.16s`，退出 0；仅有既存的大 chunk 警告。
- 依赖缓存使用 `D:/CodexTools/pnpm-store`；首次误用 pnpm 11 产生的两个未跟踪 `pnpm-workspace.yaml` 已删除。

## Pending release evidence

- GitHub `main` 推送提交 ID。
- 三台服务器的 HEAD、活动文件哈希、PM2 状态与 `/api/health`。

## Evidence boundary

- 未加载三个大型脚本的完整 diff 正文；使用完整文件哈希、文件大小、语法解析和字符串集合摘要判断。
- 未读取或输出 Token、JWT、API Key、数据库内容或服务器生产环境变量。
- 本机后端测试未运行，原因是 Node 24 对 `better-sqlite3@11.10.0` 无预编译包且缺少 C++ 编译链；部署后以服务器运行与健康检查补足。
