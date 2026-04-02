# XYZW Token Manager

一个基于 **Vue 3 + Vite + Express** 的前后端分离项目，用于管理 XYZW 游戏 Token、建立 WebSocket 通信、执行单账号/批量任务，以及查看任务日志与统计数据。

> 当前仓库以 `frontend/` 和 `backend/` 两个子项目为主。
> 旧版 README 已不再适配当前结构，本文件已按现状重新整理，并补充了服务器部署说明。

## 当前维护范围

- **当前有效主线**：`frontend/` + `backend/`
- **当前主要入口**：`frontend/src/main.js`、`backend/src/index.js`
- **遗留目录**：`server/`（早期 Flask 方案）、`source/`（协议/逆向参考材料）

> 除非是在做历史排查或迁移，日常开发请优先修改 `frontend/` 和 `backend/`。

---

## 1. 项目概览

### 前端（`frontend/`）
- Vue 3 + Vite
- Pinia 状态管理
- Vue Router
- Element Plus / Arco Design / Naive UI 混合 UI 方案
- Token 导入、账号管理、任务配置、批量调度、日志查看
- 开发环境通过 Vite 代理 `/api` 到后端 `3001`

### 后端（`backend/`）
- Node.js + Express
- SQLite（基于 `sql.js` 的本地数据库文件）
- `ws` WebSocket 通信
- `node-cron` 定时调度
- 提供认证、账号、任务、日志、统计、批量调度等 API

### 当前默认端口
- 前端开发服务：`http://localhost:3000`
- 后端开发服务：`http://localhost:3001`
- 后端健康检查：`http://localhost:3001/api/health`

---

## 2. 主要功能

### Token / 账号管理
- 手动导入 Token
- 支持 URL 来源 Token 刷新
- 本地保存账号与备注信息
- 管理多个游戏账号

### WebSocket / 协议能力
- 对接游戏 WebSocket 服务
- 内置 BON 协议相关处理能力
- 支持消息发送、响应匹配、自动重连、心跳维护

### 自动化任务
- 单账号任务执行
- 批量任务调度
- 定时任务
- 任务日志与执行状态记录

### 后台数据能力
- 用户认证
- 账号加密存储
- 任务配置持久化
- 统计接口
- 邀请码相关接口

---

## 3. 项目结构

```text
.
├─ frontend/                 # Vue 3 前端
│  ├─ src/
│  ├─ public/
│  ├─ package.json
│  └─ vite.config.js
├─ backend/                  # Express 后端
│  ├─ src/
│  │  ├─ routes/
│  │  ├─ scheduler/
│  │  ├─ batchScheduler/
│  │  ├─ database/
│  │  ├─ middleware/
│  │  └─ utils/
│  ├─ data/                  # 本地数据库目录（运行后自动生成）
│  └─ package.json
├─ server/                   # 遗留 Flask 服务，仅保留历史参考
├─ source/                   # 遗留协议/逆向分析产物，仅供参考
├─ docker/                   # 现有 Docker / Nginx 相关资源
├─ AGENTS.md                 # 仓库开发说明
└─ README.md
```

---

## 4. 运行环境要求

建议环境：

- Node.js `>= 18`
- npm `>= 9` 或 pnpm `>= 9`
- Windows / Linux / macOS 均可

> 本项目当前没有根目录 `package.json`，因此需要分别安装 `frontend` 和 `backend` 的依赖。

---

## 5. 本地开发

### 5.1 克隆项目

```bash
git clone <你的仓库地址>
cd <仓库目录>
```

### 5.2 安装依赖

#### 方式一：使用 npm

```bash
cd backend
npm install

cd ../frontend
npm install
```

#### 方式二：使用 pnpm

```bash
cd backend
pnpm install

cd ../frontend
pnpm install
```

---

## 6. 启动项目

### 6.1 分别启动

#### 启动后端

```bash
cd backend
npm run dev
```

#### 启动前端

```bash
cd frontend
npm run dev
```

启动成功后访问：
- 前端：`http://localhost:3000`
- 后端：`http://localhost:3001`

### 6.2 Windows 一键启动（可选）

如果你本地保留了根目录的 `start-dev.bat`，可以双击它分别拉起前后端开发服务。

---

## 7. 常用命令

### 前端

```bash
cd frontend
npm run dev         # 启动开发服务
npm run build       # 构建生产包
npm run preview     # 本地预览构建结果
npm run typecheck   # TypeScript 类型检查
```

### 后端

```bash
cd backend
npm run dev         # 开发模式（watch）
npm run start       # 生产模式启动
npm run test        # 后端测试
```

---

## 8. 配置说明

### 后端配置

后端配置位于：
- `backend/src/config/index.js`

默认配置包括：
- `PORT`：后端端口，默认 `3001`
- `HOST`：监听地址，默认 `0.0.0.0`
- `JWT_SECRET`
- `ENCRYPTION_KEY`
- `DB_PATH`
- `GAME_CLIENT_VERSION`
- `GAME_BATTLE_VERSION`
- `MAX_CONCURRENT_ACCOUNTS`

如果要部署到服务器，建议通过环境变量覆盖这些配置，而不是直接修改源码。

### 前端代理

前端开发代理位于：
- `frontend/vite.config.js`

默认会将 `/api` 代理到：
- `http://localhost:3001`

---

## 9. 数据与存储说明

### 前端
前端主要使用浏览器本地存储：
- `localStorage`
- IndexedDB

### 后端
后端默认将数据库写入：
- `backend/data/xyzw.db`

> 该数据库文件属于运行时数据，不建议提交到 GitHub。
> 仓库发布时应忽略数据库文件，首次启动后端时会自动创建。

---

## 10. 发布到 GitHub 的建议

为了让仓库更干净、体积更小，**不要把依赖目录和运行产物提交到 GitHub**。

### 不建议提交的内容
- `node_modules/`
- `frontend/dist/`
- `backend/data/*.db`
- 日志文件
- 本地调试文件
- 本机生成的缓存文件

### 建议保留的内容
- 源代码
- `package.json`
- 锁文件（如 `pnpm-lock.yaml` / `package-lock.json`）
- README
- 配置文件
- Docker 文件

### 为什么不提交依赖目录
1. `node_modules` 体积大，仓库会非常臃肿
2. 很多包包含平台相关二进制，跨系统容易出问题
3. CI/CD、服务器部署时一般都会重新执行安装命令
4. 团队协作时，依赖应通过 `package.json` + lockfile 还原，而不是直接传整个依赖目录

---

## 11. 部署到服务器时的推荐流程

### 推荐做法
把代码上传到服务器后，再安装依赖：

```bash
# 后端
cd backend
npm install
npm run start

# 前端（如果前后端分离部署）
cd frontend
npm install
npm run build
```

### 是否“去掉依赖目录”更方便部署？
**是的，通常更方便。**

更准确地说：
- 不是删除 `package.json`
- 而是**不要把 `node_modules` 提交到仓库**
- 服务器在拉取代码后，再根据 `package.json` / lockfile 自动安装依赖

这样做的好处：
- 仓库更小
- 拉取更快
- 减少平台兼容问题
- 更符合 Node.js 项目的标准部署方式

---

## 12. 新用户拿到项目后的使用方式

新用户克隆仓库后，只需要执行：

```bash
cd backend
npm install

cd ../frontend
npm install
```

然后分别启动：

```bash
cd backend
npm run dev

cd ../frontend
npm run dev
```

也就是说：
- 仓库里不放依赖目录
- 用户第一次使用时自行安装
- 后续部署服务器时也按同样方式处理

---

## 13. 建议的 Git 提交策略

发布前建议确认以下内容：

```bash
git status
```

重点检查不要提交：
- 数据库文件
- 本地缓存
- 日志
- `node_modules`
- `dist`
- 个人调试文件

如果你已经误提交过数据库或构建产物，需要先从 Git 追踪中移除，再提交新的 `.gitignore` 规则。

---

## 14. 服务器部署指南

这一节补充适合当前项目的实际部署方式。当前项目比较适合两种部署思路：

### 方案 A：一体化部署（推荐上手）
即：
- 先构建前端 `frontend/dist`
- 再启动后端 `backend`
- 后端直接托管前端构建产物

这套方案适合：
- 单台 VPS
- 个人项目
- 快速上线
- 不想把前后端拆开维护

#### 为什么可以这样做
当前后端代码中已经包含静态资源托管逻辑，会读取：
- `frontend/dist`

也就是说，你在服务器上把前端构建出来以后，后端可以直接把它一起对外提供。

#### 一体化部署步骤

```bash
# 1) 拉代码
git clone <你的仓库地址>
cd <仓库目录>

# 2) 安装后端依赖
cd backend
npm install

# 3) 安装前端依赖并构建
cd ../frontend
npm install
npm run build

# 4) 回到后端启动生产服务
cd ../backend
npm run start
```

启动后默认监听：
- `http://0.0.0.0:3001`

对外通常再配合 Nginx 做反向代理。

---

### 方案 B：前后端分离部署
即：
- 前端构建后交给 Nginx 托管
- 后端单独运行在 `3001`
- Nginx 把 `/api` 转发给后端

这套方案适合：
- 想把静态资源交给 Nginx
- 访问性能更稳定
- 后续准备接 HTTPS / CDN

---

## 15. 使用 PM2 部署后端

如果你在 Linux 服务器上部署 Node.js 服务，推荐使用 PM2 托管后端进程。

### 15.1 安装 PM2

```bash
npm install -g pm2
```

### 15.2 首次部署

```bash
git clone <你的仓库地址>
cd <仓库目录>

cd backend
npm install

cd ../frontend
npm install
npm run build

cd ../backend
pm2 start src/index.js --name xyzw-backend
```

### 15.3 常用 PM2 命令

```bash
pm2 list
pm2 logs xyzw-backend
pm2 restart xyzw-backend
pm2 stop xyzw-backend
pm2 delete xyzw-backend
pm2 save
pm2 startup
```

### 15.4 推荐使用环境变量启动

```bash
cd backend
PORT=3001 HOST=0.0.0.0 JWT_SECRET=your_jwt_secret ENCRYPTION_KEY=your_encrypt_key pm2 start src/index.js --name xyzw-backend
```

如果你是 Ubuntu / Debian，常见写法也可以这样：

```bash
export PORT=3001
export HOST=0.0.0.0
export JWT_SECRET=your_jwt_secret
export ENCRYPTION_KEY=your_encrypt_key
pm2 start src/index.js --name xyzw-backend
```

### 15.5 推荐的 PM2 ecosystem 配置

你也可以在仓库根目录自行创建 `ecosystem.config.cjs`：

```js
module.exports = {
  apps: [
    {
      name: 'xyzw-backend',
      cwd: './backend',
      script: 'src/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: 3001,
        JWT_SECRET: 'replace_me',
        ENCRYPTION_KEY: 'replace_me',
        DB_PATH: './data/xyzw.db',
        MAX_CONCURRENT_ACCOUNTS: 5,
      },
    },
  ],
};
```

启动方式：

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

> 建议把敏感配置改为服务器环境变量，不要把真实密钥直接提交到仓库。

---

## 16. 使用 Nginx 部署

Nginx 一般承担两个职责：
- 反向代理后端 API
- 托管前端静态文件或把流量转发给后端

### 16.1 方式一：Nginx 反代后端（一体化部署推荐）

这种模式下：
- 前端先构建到 `frontend/dist`
- 后端负责同时提供页面和 API
- Nginx 只需要把 80/443 转给后端 `3001`

示例配置：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

适用场景：
- 简单
- 改动少
- 上线快

### 16.2 方式二：Nginx 托管前端静态文件 + 反代后端 API

这种模式下：
- `frontend/dist` 复制到 Nginx 站点目录
- 后端继续跑在 `3001`
- `/api` 代理到后端

示例配置：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    root /var/www/xyzw/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 16.3 Nginx + HTTPS（Let's Encrypt）

如果你已经绑定域名，建议使用 Certbot：

```bash
sudo apt update
sudo apt install nginx certbot python3-certbot-nginx -y
sudo certbot --nginx -d your-domain.com
```

续期测试：

```bash
sudo certbot renew --dry-run
```

---

## 17. 使用 Docker 部署

### 17.1 当前仓库里的 Docker 资源说明

当前仓库中已有：
- `docker/dockerfile`
- `docker/nginx.conf`
- `docker/install.sh`
- `docker/install.cmd`

这套资源更偏向于：
- **把前端静态构建产物打进 Nginx 镜像进行发布**

也就是说，它更适合“纯前端静态部署”，**不是完整的前后端一体 Docker 编排方案**。

### 17.2 仅部署前端静态页面

先在本地或服务器构建前端：

```bash
cd frontend
npm install
npm run build
```

然后把 `frontend/dist` 按你的镜像构建方式放入 Docker 构建上下文，再基于现有 `docker/dockerfile` 构建 Nginx 镜像。

如果你要直接使用当前仓库里的文件，可以参考这种思路：

```bash
# 假设你把 frontend/dist 复制到 docker/dist
cd docker
docker build -t xyzw-frontend -f dockerfile .
docker run -d -p 8080:80 --name xyzw-frontend xyzw-frontend
```

> 注意：当前 `docker/dockerfile` 默认 `COPY ./dist /app/web`，因此它要求 Docker 构建上下文里存在 `dist` 目录。

### 17.3 推荐的完整 Docker Compose 方案（前后端一起）

如果你希望以后更标准地用 Docker 部署，推荐增加一个 `docker-compose.yml`，思路如下：

```yaml
version: '3.9'
services:
  backend:
    image: node:20-alpine
    working_dir: /app/backend
    volumes:
      - ./:/app
    command: sh -c "npm install && npm run start"
    environment:
      HOST: 0.0.0.0
      PORT: 3001
      JWT_SECRET: your_jwt_secret
      ENCRYPTION_KEY: your_encrypt_key
      DB_PATH: ./data/xyzw.db
    ports:
      - "3001:3001"

  frontend-build:
    image: node:20-alpine
    working_dir: /app/frontend
    volumes:
      - ./:/app
    command: sh -c "npm install && npm run build"

  nginx:
    image: nginx:stable-alpine
    depends_on:
      - backend
    ports:
      - "80:80"
    volumes:
      - ./frontend/dist:/usr/share/nginx/html:ro
      - ./deploy/nginx.full.conf:/etc/nginx/conf.d/default.conf:ro
```

> 说明：上面只是一个部署思路示例。若使用 Docker Compose 做完整前后端部署，建议单独准备一个支持 `/api` 反向代理的 Nginx 配置，而不是直接复用当前仓库里偏静态站点用途的 `docker/nginx.conf`。

不过对于当前项目，**Docker Compose 更适合作为后续优化项**。如果你现在只是想快速上线，一般优先推荐：
- **PM2 + Nginx**

因为更直接，也更容易排查问题。

### 17.4 更实用的 Docker 思路

对于当前仓库，Docker 更推荐拆成两步：
1. 构建前端静态资源
2. 用 Node 容器跑后端，或继续用 PM2 跑后端

如果你后面需要，我可以继续帮你补：
- `docker-compose.yml`
- 后端专用 `Dockerfile`
- 前端专用 `Dockerfile`
- 适配当前项目的 `nginx.conf`

---

## 18. 生产环境部署建议

### 推荐组合
对于当前项目，优先推荐：
- **Node.js + PM2 + Nginx**

这是因为：
- 配置简单
- 适合单机部署
- 后端日志、重启、守护都比较方便
- 后续接 HTTPS 也方便

### 推荐目录结构
服务器上可以这样放：

```text
/var/www/xyzw/
├─ backend/
├─ frontend/
├─ docker/
└─ README.md
```

### 推荐上线流程

```bash
git pull
cd backend && npm install
cd ../frontend && npm install && npm run build
cd ../backend && pm2 restart xyzw-backend
```

### 更新代码后的最小操作
如果只是前端改动：

```bash
cd frontend
npm install
npm run build
```

如果后端也改了：

```bash
cd backend
npm install
pm2 restart xyzw-backend
```

---

## 19. 后续可继续优化的方向

- 在根目录增加统一的 `package.json`，做 workspace 管理
- 增加 `.env.example`
- 增加 Linux 启动脚本（如 `start-dev.sh`）
- 增加 GitHub Actions 自动构建/发布流程
- 为当前项目补齐完整 `docker-compose.yml`
- 补充生产环境变量模板与部署脚本

---

## 20. License

当前仓库许可信息请以根目录 `LICENSE` 为准。
