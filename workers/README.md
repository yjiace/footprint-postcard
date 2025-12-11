# 足迹明信片 - Cloudflare Worker API

微信小程序后端 API，基于 Cloudflare Workers 构建。

## 技术栈

- **Cloudflare Workers** - 边缘计算平台
- **Cloudflare KV** - 键值存储
- **Cloudflare R2** - 对象存储
- **@cf-wasm/photon** - WASM 图片处理库

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 wrangler.toml

编辑 `wrangler.toml`，填入你的实际配置：

```toml
[[kv_namespaces]]
binding = "KV"
id = "你的KV命名空间ID"  # 从 Cloudflare 控制台获取

[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "你的R2桶名称"

[vars]
R2_PUBLIC_DOMAIN = "你的R2公开访问域名"
```

### 3. 配置环境变量（Secrets）

> **提示**：如果你已在 Cloudflare 控制台（Workers → 设置 → 变量）配置了 Secrets，**无需再执行命令**，wrangler deploy 会自动使用后台配置。

**方式一：使用控制台（推荐）**

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 Workers & Pages → 你的 Worker → 设置 → 变量
3. 在「加密变量」部分添加以下 Secrets：
   - `JWT_SECRET`
   - `WECHAT_APP_ID`
   - `WECHAT_APP_SECRET`
   - `AMAP_KEY`
   - `N8N_WORKFLOW_URL`
   - `KUAI_API_KEY`

**方式二：使用命令行**

```bash
wrangler secret put JWT_SECRET
wrangler secret put WECHAT_APP_ID
wrangler secret put WECHAT_APP_SECRET
wrangler secret put AMAP_KEY
wrangler secret put N8N_WORKFLOW_URL
wrangler secret put KUAI_API_KEY
```

### 4. 本地开发

```bash
npm run dev
# 或
wrangler dev
```

### 5. 部署

```bash
npm run deploy
# 或
wrangler deploy
```

### 6. 查看日志

```bash
npm run tail
# 或
wrangler tail
```

## 环境变量说明

### wrangler.toml 中配置（绑定）

| 配置项 | 说明 |
|--------|------|
| `KV` | KV 命名空间绑定，ID 从控制台获取 |
| `R2_BUCKET` | R2 存储桶绑定，桶名称 `footprint-postcard` |

### 后台控制台配置（Secrets）

以下变量需要在 **Cloudflare 控制台**（Workers & Pages → 设置 → 变量 → 加密变量）中设置：

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `JWT_SECRET` | ✅ | JWT 签名密钥 |
| `WECHAT_APP_ID` | ✅ | 微信小程序 AppID |
| `WECHAT_APP_SECRET` | ✅ | 微信小程序 AppSecret |
| `AMAP_KEY` | ✅ | 高德地图 Web 服务 API Key |
| `N8N_WORKFLOW_URL` | ✅ | N8N 智能旅行规划 Webhook 地址 |
| `KUAI_API_KEY` | ✅ | kuai.host API Key（AI 图片生成）|
| `R2_PUBLIC_DOMAIN` | ✅ | R2 公开访问域名（如 `r2.smallyoung.cn`）|
| `KUAI_API_BASE` | ❌ | kuai.host API 基础地址，默认 `https://api.kuai.host` |
| `KUAI_MODEL` | ❌ | AI 模型名称，默认 `gemini-3-pro-image-preview` |


## API 接口说明

基础地址：`https://footprint-postcard-api.smallyoung.cn/api`

### 用户认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/user/login` | 微信登录，返回 JWT Token |

### 地理位置

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/location/city` | 根据经纬度获取城市信息 |
| GET | `/destinations/hot` | 获取热门目的地 |
| GET | `/attractions/nearby` | 获取周边景点 |

### 行程管理

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/plan/generate` | AI 生成行程（需登录）|
| GET | `/plan/list` | 获取行程列表（需登录）|
| GET | `/plan/detail` | 获取行程详情（需登录）|
| DELETE | `/plan/delete` | 删除行程（需登录）|

### 明信片管理

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/postcard/generate` | AI 生成明信片（需登录）|
| GET | `/postcard/list` | 获取明信片列表（需登录）|
| GET | `/postcard/detail` | 获取明信片详情（需登录）|
| DELETE | `/postcard/delete` | 删除明信片（需登录）|

### 其他

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/proxy/image` | 图片代理（解决微信域名限制）|
| POST | `/upload/image` | 上传图片（需登录）|

## 请求认证

需要登录的接口需在请求头中携带 JWT Token：

```
Authorization: Bearer <token>
```

## 图片压缩功能

生成明信片时会自动：
1. 上传原图到 R2（PNG 格式）
2. 后台异步生成缩略图（400px 宽，JPEG 格式）
3. 更新 KV 中的 `thumbnail` 字段

前端使用 `item.thumbnail || item.image` 优雅降级。

## 目录结构

```
workers/
├── api.js          # Worker 主代码
├── package.json    # 依赖配置
├── wrangler.toml   # Wrangler 配置
└── README.md       # 本文档
```

## 注意事项

1. **WASM 依赖**：由于使用了 `@cf-wasm/photon`，必须通过 wrangler 打包部署，不能直接复制粘贴代码
2. **CPU 限制**：图片压缩使用 `ctx.waitUntil()` 异步执行，不受主请求 CPU 限制
3. **KV 命名空间**：首次部署前需在 Cloudflare 控制台创建 KV 命名空间
4. **R2 存储桶**：需创建 R2 存储桶并配置公开访问
