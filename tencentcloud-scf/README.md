# 腾讯云云函数部署指南

本目录包含两个云函数，用于替代 N8N + Worker 架构：

1. **postcard-generate**: 明信片生成服务
2. **plan-generate**: 行程规划生成服务

## 目录结构

```
tencentcloud-scf/
├── postcard-generate/      # 明信片生成云函数
│   ├── index.js           # 云函数代码
│   └── package.json       # 依赖配置
├── plan-generate/         # 行程规划生成云函数
│   ├── index.js           # 云函数代码
│   └── package.json       # 依赖配置
├── README.md              # 本文件
└── DEPLOYMENT.md          # 详细部署说明
```

## 快速开始

### 1. 登录腾讯云控制台

访问 [腾讯云云函数控制台](https://console.cloud.tencent.com/scf)

### 2. 创建云函数

#### 明信片生成云函数

1. 点击 **"新建"** → **"从头开始"**
2. 填写基本信息：
   - **函数名称**: `footprint-postcard-generate`
   - **地域**: 广州（或选择靠近你的地域）
   - **运行环境**: `Node.js 18.x`
   - **函数类型**: **事件函数**（推荐，部署更简单）
3. 函数代码：
   - 选择 **"在线编辑"**
   - 删除默认代码
   - 复制 `postcard-generate/index.js` 的全部内容
   - 粘贴到在线代码编辑器
4. 高级配置：
   - **执行方法**: `index.main_handler`（默认值）
   - **执行超时时间**: `900` 秒
   - **内存**: `512` MB
5. 环境变量（可选，EdgeOne 会传递）：
   - 暂不配置，EdgeOne 会将 API Key 传递给云函数
6. 触发器配置：
   - 暂不添加触发器（稍后配置）
7. 点击 **"完成"**
8. **配置公网访问（重要）**：
   
   创建完成后，点击 **"触发管理"** 标签，选择以下任一方式：
   
   **方式 A：函数 URL（强烈推荐）**
   - 如果看到 **"开启公网访问"** 或 **"函数 URL"** 选项
   - 点击启用，选择 **"免鉴权"**
   - 复制生成的 URL（格式：`https://service-xxx.tencentscf.com/`）
   - ✅ **优势**：长期稳定，腾讯云官方推荐
   
   **方式 B：API 网关触发器（临时方案）**
   - 点击 **"创建触发器"** → 选择 **"API 网关触发"**
   - 鉴权方式：**免鉴权**
   - 复制生成的 URL（格式：`https://service-xxx.apigw.tencentcs.com/...`）
   - ⚠️ **注意**：API 网关将于 2025年6月30日停止服务
   
   **记录生成的公网访问 URL**（稍后配置到 EdgeOne 环境变量）

#### 行程规划生成云函数

1. 重复上述步骤
2. 函数名称改为: `footprint-plan-generate`
3. 复制粘贴 `plan-generate/index.js` 的内容
4. **必须配置环境变量**：
   - 在 **"环境变量"** 区域添加：
   - **键**: `AI_API_KEY`
   - **值**: 你的 AI API 密钥（如 `sk-xxxxx`）
5. 其他配置相同

### 3. 获取云函数 URL

创建完成后，在 **"触发管理"** 标签页，复制 **访问路径**（URL），格式如：

```
明信片生成: https://service-xxxx-xxxxxxxx.gz.tencentscf.com/
行程规划: https://service-yyyy-yyyyyyyy.gz.tencentscf.com/
```

> **⚠️ 重要说明：网络访问方式**
> 
> - 云函数 URL 是**公网 HTTPS 地址**（不是内网地址）
> - EdgeOne 必须通过**公网**访问云函数
> - 虽然是公网调用，但腾讯云内部会走优化路径，延迟很低（10-100ms）
> - 安全性：HTTPS 加密 + 可选鉴权保障

### 4. 配置 EdgeOne 环境变量

在 EdgeOne Pages 控制台，添加环境变量：

> **⚠️ 重要：避免使用 `SCF_` 前缀**
> 
> `SCF_` 是腾讯云系统预留前缀，会导致配置冲突。请使用以下变量名：

```env
POSTCARD_SERVICE_URL=https://service-xxxx-xxxxxxxx.gz.tencentscf.com/
PLAN_SERVICE_URL=https://service-yyyy-yyyyyyyy.gz.tencentscf.com/
```

### 5. 修改 EdgeOne 代码

参考 `DEPLOYMENT.md` 中的详细说明，修改 EdgeOne 代码中的调用地址。

### 6. 测试

使用 Postman 或 curl 测试云函数是否正常工作：

```bash
# 测试明信片生成云函数
curl -X POST https://service-xxxx-xxxxxxxx.gz.tencentscf.com/ \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "一张美丽的明信片",
    "apiKey": "your-api-key",
    "callback": {
      "url": "https://your-callback-url.com",
      "postcardId": "test_123",
      "openid": "test_user"
    }
  }'
```

## 注意事项

1. **超时时间**: 确保设置为 900秒，因为 AI 生成可能需要较长时间
2. **内存配置**: 512MB通常足够，如果遇到内存不足可以增加到 1024MB
3. **网络访问**: 
   - 云函数 URL 是公网地址，EdgeOne 通过公网 HTTPS 调用
   - 腾讯云服务间调用会走内部优化路径，延迟很低（10-100ms）
   - 比调用国外 N8N 服务快 5-20 倍
4. **日志查看**: 在云函数控制台的 **"日志查询"** 标签页查看执行日志
5. **监控告警**: 建议配置云监控，当失败率超过 5% 时发送告警

## 成本预估

- **免费额度**: 
  - 调用次数: 100万次/月
  - 资源使用量: 40万GBs/月
- **预计成本**: 
  - 每月 100 次生成任务
  - 每次执行 30-60秒
  - **完全在免费额度内**，几乎零成本

## 故障排查

如果遇到问题，请查看：

1. **云函数日志**: 控制台 → 日志查询
2. **EdgeOne 日志**: EdgeOne 控制台 → 函数日志
3. **常见问题**: 查看 `DEPLOYMENT.md` 中的故障排查章节

## 下一步

- 查看 `DEPLOYMENT.md` 了解详细部署步骤
- 修改 EdgeOne 代码以调用云函数
- 进行端到端测试
- 监控运行状况

## 技术支持

如有问题，请查看：
- [腾讯云云函数文档](https://cloud.tencent.com/document/product/583)
- [Node.js 18.x 运行环境说明](https://cloud.tencent.com/document/product/583/11060)
