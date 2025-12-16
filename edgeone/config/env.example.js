/**
 * EdgeOne 边缘函数环境变量配置示例
 * 
 * 在 EdgeOne 控制台配置这些环境变量
 */

// JWT 密钥 - 用于用户认证
const JWT_SECRET = 'your-jwt-secret-key-here'

// 微信小程序配置
const WECHAT_APP_ID = 'your-wechat-app-id'
const WECHAT_APP_SECRET = 'your-wechat-app-secret'

// 高德地图 API 密钥 (Web服务API)
const AMAP_KEY = 'your-amap-web-service-key'

// N8N 智能旅行规划工作流 webhook 地址
const N8N_WORKFLOW_URL = 'https://your-n8n-domain/webhook/travel-plan'

// N8N 明信片生成工作流 webhook 地址 (此处配置为Worker代理地址)
const N8N_POSTCARD_WORKFLOW_URL = 'https://footprint-postcard-api.smallyoung.workers.dev/postcard/proxy'

// 腾讯云 COS 配置（替代 Cloudflare R2）
const COS_SECRET_ID = 'your-tencent-cloud-secret-id'
const COS_SECRET_KEY = 'your-tencent-cloud-secret-key'
const COS_BUCKET = 'footprint-postcard-1362392854'
const COS_REGION = 'ap-guangzhou'  // 根据实际区域修改
const COS_DOMAIN = 'https://footprint-postcard-1362392854.cos.ap-guangzhou.myqcloud.com'

// AI 图片生成 API (kuai.host)
const KUAI_API_KEY = 'your-kuai-api-key'
const KUAI_API_BASE = 'https://api.kuai.host'
const KUAI_MODEL = 'gemini-3-pro-image-preview'

// Unsplash API (可选，用于城市图片)
const UNSPLASH_ACCESS_KEY = 'your-unsplash-access-key'

// KV 存储 - 在 EdgeOne 控制台绑定 KV 命名空间后自动可用
// const KV = <EdgeOne 自动注入>
