# 足迹明信片 (Footprint Postcard)

一款基于微信小程序的智能旅行规划与 AI 明信片生成应用。

## ✨ 功能特性

### 🗺️ 智能行程规划
- **AI 生成行程**：输入目的地、日期、偏好，自动生成详细旅行计划
- **景点推荐**：基于高德地图 POI 搜索，推荐周边热门景点
- **天气预报**：集成实时天气数据，智能调整行程建议
- **住宿推荐**：根据预算和偏好推荐合适酒店

### 🖼️ AI 明信片生成
- **一键生成明信片**：根据行程自动生成专属明信片图片
- **AI 图像生成**：使用 Gemini Pro 多模态模型生成精美图片
- **明信片管理**：保存、浏览、删除个人明信片收藏

### 📍 位置服务
- **当前位置识别**：自动获取用户当前城市
- **周边景点发现**：展示附近热门景点和美食

## 🏗️ 项目架构

```
footprint-postcard/
├── miniprogram/              # 微信小程序前端
│   ├── pages/                # 页面目录
│   │   ├── index/            # 首页
│   │   ├── login/            # 登录页
│   │   ├── plan/             # 创建行程页
│   │   ├── plan-list/        # 行程列表页
│   │   ├── plan-detail/      # 行程详情页
│   │   ├── postcard/         # 明信片页
│   │   └── profile/          # 个人中心页
│   ├── components/           # 自定义组件
│   ├── utils/                # 工具类
│   │   ├── api.js            # API 请求封装
│   │   └── storage.js        # 本地存储工具
│   └── app.json              # 小程序配置
├── workers/                  # Cloudflare Workers 后端 API
│   ├── api.js                # API 主入口
│   └── wrangler.toml         # Wrangler 配置
└── n8n-workflows/            # N8N 自动化工作流
    └── 智能旅行规划工作流.json
```

## 🛠️ 技术栈

### 前端
- **微信小程序原生框架**
- **WXML + WXSS + JavaScript**
- **自定义组件化开发**

### 后端
- **Cloudflare Workers** - Serverless API 服务
- **Cloudflare KV** - 用户数据存储
- **Cloudflare R2** - 图片文件存储

### AI & 第三方服务
- **N8N** - 智能行程规划工作流引擎
- **DeepSeek** - AI 大语言模型（行程规划）
- **Gemini Pro** - 多模态 AI（明信片图片生成）
- **高德地图 API** - 地理位置、POI 搜索、天气服务

## 📡 API 接口

### 用户相关
| 接口 | 方法 | 说明 |
|------|------|------|
| `/user/login` | POST | 微信登录，获取 JWT Token |

### 地图相关
| 接口 | 方法 | 说明 |
|------|------|------|
| `/location/city` | GET | 根据坐标获取城市信息 |
| `/destinations/hot` | GET | 获取热门目的地 |
| `/attractions/nearby` | GET | 获取周边景点 |

### 行程相关
| 接口 | 方法 | 说明 |
|------|------|------|
| `/plan/generate` | POST | AI 生成行程计划 |
| `/plan/list` | GET | 获取行程列表（分页） |
| `/plan/detail` | GET | 获取行程详情 |
| `/plan/delete` | DELETE | 删除行程 |

### 明信片相关
| 接口 | 方法 | 说明 |
|------|------|------|
| `/postcard/generate` | POST | AI 生成明信片 |
| `/postcard/list` | GET | 获取明信片列表（分页） |
| `/postcard/detail` | GET | 获取明信片详情 |
| `/postcard/delete` | DELETE | 删除明信片 |

### 工具接口
| 接口 | 方法 | 说明 |
|------|------|------|
| `/upload/image` | POST | 上传图片 |
| `/proxy/image` | GET | 图片代理（解决域名限制） |

## 🔧 环境配置

### Cloudflare Workers 环境变量

在 Cloudflare Workers 控制台设置以下加密变量：

| 变量名 | 说明 |
|--------|------|
| `JWT_SECRET` | JWT 签名密钥 |
| `WECHAT_APP_ID` | 微信小程序 AppID |
| `WECHAT_APP_SECRET` | 微信小程序 AppSecret |
| `AMAP_KEY` | 高德地图 Web 服务 API Key |
| `N8N_WORKFLOW_URL` | N8N 工作流 Webhook 地址 |
| `KUAI_API_KEY` | kuai.host API Key（Gemini 代理） |
| `R2_PUBLIC_DOMAIN` | R2 公开访问域名 |

### 资源绑定

```toml
# KV 命名空间
[[kv_namespaces]]
binding = "KV"
id = "your-kv-namespace-id"

# R2 存储桶
[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "footprint-postcard"
```

## 🚀 部署指南

### 1. 部署 Cloudflare Workers API

```bash
cd workers

# 安装依赖
npm install

# 部署到 Cloudflare
npx wrangler deploy
```

### 2. 配置 N8N 工作流

1. 导入 `n8n-workflows/智能旅行规划工作流.json` 到 N8N
2. 配置 DeepSeek API 凭证
3. 修改高德地图 API Key
4. 激活工作流

### 3. 微信小程序配置

1. 在微信公众平台注册小程序
2. 配置服务器域名白名单：
   - `https://footprint-postcard-api.smallyoung.cn`
   - `https://restapi.amap.com`
3. 修改 `miniprogram/utils/api.js` 中的 API 地址
4. 使用微信开发者工具上传代码

## 📦 N8N 工作流说明

智能旅行规划工作流处理流程：

1. **Webhook 触发器** - 接收行程生成请求
2. **数据预处理** - 保存请求参数和 API 配置
3. **并行数据获取**：
   - 景点搜索（高德 POI）
   - 天气查询（高德天气）
   - 酒店搜索（高德 POI）
4. **数据合并** - 整合所有查询结果
5. **AI Agent** - DeepSeek 生成详细行程
6. **响应处理** - 解析 AI 响应并返回 JSON

## 📄 License

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！
