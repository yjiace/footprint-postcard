# EdgeOne Pages 部署指南

本目录包含适配腾讯云 **EdgeOne Pages** 的边缘函数代码。

## 目录结构

```
edgeone/
├── functions/
│   └── api/
│       └── [[path]].js   # 捕获所有 /api/* 请求 ← 主代码
├── public/               # 静态文件目录（可为空）
├── config/
│   └── env.example.js    # 环境变量示例
└── README.md
```

## 部署步骤

### 1. 创建 Pages 项目

1. 访问 [EdgeOne Pages 控制台](https://console.cloud.tencent.com/edgeone/pages)
2. 点击「新建项目」
3. 选择「直接上传」或连接 Git 仓库

### 2. 上传代码

如果选择直接上传：
- 将 `edgeone` 目录内容打包上传
- 确保 `functions/api/[[path]].js` 文件存在

### 3. 配置环境变量

在项目设置 → 环境变量中添加：

| 变量名 | 说明 |
|-------|------|
| `JWT_SECRET` | JWT 签名密钥 |
| `WECHAT_APP_ID` | 微信小程序 AppID |
| `WECHAT_APP_SECRET` | 微信小程序 AppSecret |
| `AMAP_KEY` | 高德地图 Web服务 API Key |
| `N8N_WORKFLOW_URL` | N8N 工作流 Webhook 地址 |
| `COS_SECRET_ID` | 腾讯云 SecretId |
| `COS_SECRET_KEY` | 腾讯云 SecretKey |
| `COS_BUCKET` | `footprint-postcard-1362392854` |
| `COS_REGION` | `ap-guangzhou` |
| `COS_DOMAIN` | COS 公开访问域名 |
| `KUAI_API_KEY` | AI 图片生成 API Key |

### 4. 配置 KV 命名空间

1. 在项目设置中创建 KV 命名空间
2. 绑定变量名为 `KV`

### 5. 部署

点击「部署」按钮，等待构建完成。

## API 接口

部署后可通过 `https://your-project.pages.dev/api/xxx` 访问：

| 方法 | 路径 | 说明 |
|-----|------|------|
| POST | `/api/user/login` | 微信登录 |
| GET | `/api/location/city` | 坐标查城市 |
| GET | `/api/destinations/hot` | 热门目的地 |
| GET | `/api/attractions/nearby` | 周边景点 |
| GET | `/api/route/driving` | 驾车路径 |
| GET | `/api/route/walking` | 步行路径 |
| GET | `/api/route/transit` | 公交路径 |
| POST | `/api/plan/generate` | 生成行程 |
| GET | `/api/plan/list` | 行程列表 |
| GET | `/api/plan/detail` | 行程详情 |
| POST | `/api/postcard/generate` | 生成明信片 |
| GET | `/api/postcard/list` | 明信片列表 |

## 免费额度

EdgeOne Pages 免费版包含：
- **300万次** Edge Functions 请求/月
- **1GB** KV 存储
- **500次** 构建
