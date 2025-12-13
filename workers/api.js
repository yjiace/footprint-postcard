/**
 * 足迹明信片 - Cloudflare Worker API
 *
 * 环境变量配置:
 * - JWT_SECRET: JWT密钥
 * - WECHAT_APP_ID: 微信小程序AppID
 * - WECHAT_APP_SECRET: 微信小程序AppSecret
 * - AMAP_KEY: 高德地图API密钥(Web服务API Key)
 * - N8N_WORKFLOW_URL: N8N智能旅行规划工作流webhook地址
 * - KV: KV命名空间(用于数据存储)
 * - R2_BUCKET: R2存储桶
 * - R2_PUBLIC_DOMAIN: R2公开访问域名
 */

import { PhotonImage, resize, SamplingFilter } from '@cf-wasm/photon';

// ==================== 工具函数 ====================

/**
 * 生成JWT Token
 */
async function generateToken(payload, secret) {
    const header = { alg: 'HS256', typ: 'JWT' }
    const encodedHeader = btoa(JSON.stringify(header))
    const encodedPayload = btoa(JSON.stringify(payload))

    const data = `${encodedHeader}.${encodedPayload}`
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    )

    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
    const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))

    return `${data}.${encodedSignature}`
}

/**
 * 验证JWT Token
 */
async function verifyToken(token, secret) {
    try {
        const [encodedHeader, encodedPayload, encodedSignature] = token.split('.')
        const data = `${encodedHeader}.${encodedPayload}`

        const encoder = new TextEncoder()
        const key = await crypto.subtle.importKey(
            'raw',
            encoder.encode(secret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['verify']
        )

        const signature = Uint8Array.from(atob(encodedSignature), c => c.charCodeAt(0))
        const isValid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(data))

        if (!isValid) return null

        const payload = JSON.parse(atob(encodedPayload))
        return payload
    } catch (err) {
        return null
    }
}

/**
 * 统一响应格式
 */
function jsonResponse(data, code = 200, message = 'success') {
    return new Response(JSON.stringify({ code, message, data }), {
        status: code === 200 ? 200 : code >= 400 ? code : 200,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
    })
}

/**
 * 错误响应
 */
function errorResponse(message, code = 400) {
    return jsonResponse(null, code, message)
}

/**
 * 生成唯一ID
 */
function generateId(prefix = '') {
    const timestamp = Date.now()
    const random = Math.random().toString(36).substr(2, 9)
    return `${prefix}${timestamp}_${random}`
}

/**
 * 从请求中获取用户信息
 */
async function getUserFromRequest(request, env) {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null
    }

    const token = authHeader.substring(7)
    const payload = await verifyToken(token, env.JWT_SECRET)
    return payload
}


// ==================== 图片和地图相关 ====================

/**
 * 下载城市封面图片并保存到R2
 * 优先使用Unsplash API根据城市名称搜索特色图片，失败时回退到Picsum
 * @param {String} city 城市名称
 * @param {String} planId 行程ID（用于生成唯一文件名）
 * @param {Object} env 环境变量（包含R2_BUCKET、R2_PUBLIC_DOMAIN、UNSPLASH_ACCESS_KEY）
 * @returns {Promise<String>} 保存后的图片URL
 */
// 中国热门城市中英文映射表（用于 Unsplash 搜索）
const CITY_NAME_MAP = {
    // 直辖市
    '北京': 'Beijing', '上海': 'Shanghai', '天津': 'Tianjin', '重庆': 'Chongqing',
    // 省会城市
    '广州': 'Guangzhou', '深圳': 'Shenzhen', '杭州': 'Hangzhou', '南京': 'Nanjing',
    '成都': 'Chengdu', '武汉': 'Wuhan', '西安': 'Xian', '长沙': 'Changsha',
    '郑州': 'Zhengzhou', '济南': 'Jinan', '青岛': 'Qingdao', '大连': 'Dalian',
    '沈阳': 'Shenyang', '哈尔滨': 'Harbin', '长春': 'Changchun', '福州': 'Fuzhou',
    '厦门': 'Xiamen', '南昌': 'Nanchang', '合肥': 'Hefei', '石家庄': 'Shijiazhuang',
    '太原': 'Taiyuan', '昆明': 'Kunming', '贵阳': 'Guiyang', '南宁': 'Nanning',
    '海口': 'Haikou', '三亚': 'Sanya', '拉萨': 'Lhasa', '乌鲁木齐': 'Urumqi',
    '兰州': 'Lanzhou', '西宁': 'Xining', '银川': 'Yinchuan', '呼和浩特': 'Hohhot',
    // 热门旅游城市
    '桂林': 'Guilin', '丽江': 'Lijiang', '大理': 'Dali', '苏州': 'Suzhou',
    '无锡': 'Wuxi', '扬州': 'Yangzhou', '黄山': 'Huangshan', '张家界': 'Zhangjiajie',
    '九寨沟': 'Jiuzhaigou', '敦煌': 'Dunhuang', '洛阳': 'Luoyang', '开封': 'Kaifeng',
    '泰安': 'Taian', '威海': 'Weihai', '烟台': 'Yantai', '秦皇岛': 'Qinhuangdao',
    '珠海': 'Zhuhai', '汕头': 'Shantou', '佛山': 'Foshan', '东莞': 'Dongguan',
    '宁波': 'Ningbo', '温州': 'Wenzhou', '绍兴': 'Shaoxing', '嘉兴': 'Jiaxing',
    // 港澳台
    '香港': 'Hong Kong', '澳门': 'Macau', '台北': 'Taipei', '高雄': 'Kaohsiung'
}

async function downloadAndSaveCityImage(city, planId, env) {
    try {
        let imageUrl = null
        let imageBuffer = null

        // 优先尝试 Unsplash API（需要配置 UNSPLASH_ACCESS_KEY）
        if (env.UNSPLASH_ACCESS_KEY) {
            // 尝试搜索图片的辅助函数
            const searchUnsplash = async (query) => {
                const searchQuery = encodeURIComponent(query)
                const unsplashApiUrl = `https://api.unsplash.com/search/photos?query=${searchQuery}&per_page=5&orientation=landscape`

                const unsplashResponse = await fetch(unsplashApiUrl, {
                    headers: {
                        'Authorization': `Client-ID ${env.UNSPLASH_ACCESS_KEY}`,
                        'Accept-Version': 'v1'
                    }
                })

                if (unsplashResponse.ok) {
                    const unsplashData = await unsplashResponse.json()
                    return unsplashData.results || []
                }
                return []
            }

            try {
                let results = []

                // 策略1: 如果在映射表中，使用英文名搜索
                if (CITY_NAME_MAP[city]) {
                    const englishCity = CITY_NAME_MAP[city]
                    console.log('Unsplash搜索(映射):', city, '->', englishCity)
                    results = await searchUnsplash(`${englishCity} city landmark skyline`)
                }

                // 策略2: 如果策略1没找到或不在映射表中，使用 "城市名 + China travel" 搜索
                if (results.length === 0) {
                    console.log('Unsplash搜索(通用):', city, '+ China travel')
                    results = await searchUnsplash(`${city} China travel landscape`)
                }

                // 策略3: 如果还是没找到，使用 "China travel" 通用搜索
                if (results.length === 0) {
                    console.log('Unsplash搜索(兜底): China travel landscape')
                    results = await searchUnsplash('China travel landscape beautiful')
                }

                if (results.length > 0) {
                    // 随机选择前5张中的一张，增加多样性
                    const randomIndex = Math.floor(Math.random() * Math.min(5, results.length))
                    const photo = results[randomIndex]

                    // 使用 small 尺寸 (400px宽)，适合列表展示，减小体积
                    imageUrl = photo.urls.small

                    console.log('Unsplash找到图片:', imageUrl.substring(0, 80) + '...')
                    console.log('摄影师:', photo.user.name)

                    // 下载图片
                    const imgResponse = await fetch(imageUrl)
                    if (imgResponse.ok) {
                        imageBuffer = await imgResponse.arrayBuffer()
                    }
                } else {
                    console.log('Unsplash所有搜索策略均未找到图片，使用备用方案')
                }
            } catch (unsplashErr) {
                console.error('Unsplash API异常:', unsplashErr.message)
            }
        } else {
            console.log('未配置 UNSPLASH_ACCESS_KEY，使用备用图片源')
        }

        // 回退方案：使用 Picsum 随机风景图片
        if (!imageBuffer) {
            const cityHash = city.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
            const seed = cityHash % 1000
            const picsumUrl = `https://picsum.photos/seed/${seed}/800/400`

            console.log('使用Picsum备用图片:', picsumUrl)

            const response = await fetch(picsumUrl, {
                headers: {
                    'User-Agent': 'Cloudflare-Worker/1.0'
                }
            })

            if (!response.ok) {
                console.error('Picsum下载失败:', response.status)
                return null
            }

            imageBuffer = await response.arrayBuffer()
        }

        // 保存到R2
        const timestamp = Date.now()
        const imagePath = `city-covers/${planId}_${timestamp}.jpg`

        if (env.R2_BUCKET) {
            await env.R2_BUCKET.put(imagePath, imageBuffer, {
                httpMetadata: {
                    contentType: 'image/jpeg'
                }
            })

            const publicUrl = `https://${env.R2_PUBLIC_DOMAIN || 'r2.smallyoung.cn'}/${imagePath}`
            console.log('城市图片已保存:', publicUrl)
            return publicUrl
        }

        return null
    } catch (err) {
        console.error('下载保存城市图片失败:', err)
        return null
    }
}

/**
 * 生成高德静态地图URL（仅标注地点，不含路径）
 * @param {Array} planning 当日行程数组，每项包含location对象
 * @param {String} amapKey 高德地图API密钥
 * @returns {String|null} 静态地图URL，无有效坐标时返回null
 */
function generateStaticMapUrl(planning, amapKey) {
    if (!planning || planning.length === 0 || !amapKey) {
        return null
    }

    // 根据类型设置不同颜色
    const typeColorMap = {
        'attraction': '0xFF5722',  // 景点 - 橙色
        'restaurant': '0x4CAF50',  // 餐厅 - 绿色
        'hotel': '0x9C27B0',       // 酒店 - 紫色
        'breakfast': '0x4CAF50',   // 早餐 - 绿色
        'lunch': '0x4CAF50',       // 午餐 - 绿色
        'dinner': '0x4CAF50',      // 晚餐 - 绿色
        'default': '0x2196F3'      // 默认 - 蓝色
    }

    // 提取有效坐标点（最多10个，受API限制）
    const locations = planning
        .filter(item => item.location && item.location.longitude && item.location.latitude)
        .slice(0, 10)
        .map((item, index) => ({
            name: item.name,
            type: item.type || 'default',
            lng: item.location.longitude,
            lat: item.location.latitude,
            label: String(index + 1),
            color: typeColorMap[item.type] || typeColorMap['default']
        }))

    if (locations.length < 1) {
        return null // 至少需要1个点
    }

    // 构建markers参数（使用中等大小标注，根据类型显示不同颜色）
    const markers = locations.map(loc => `mid,${loc.color},${loc.label}:${loc.lng},${loc.lat}`).join('|')

    // 构建静态地图URL（自动计算中心点和缩放级别，不含路径折线）
    const params = new URLSearchParams({
        key: amapKey,
        size: '600*400',
        scale: '2', // 高清图
        markers: markers
    })

    return `https://restapi.amap.com/v3/staticmap?${params.toString()}`
}

// ==================== 微信相关 ====================

/**
 * 微信登录 - 换取session_key和openid
 */
async function wechatLogin(code, env) {
    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${env.WECHAT_APP_ID}&secret=${env.WECHAT_APP_SECRET}&js_code=${code}&grant_type=authorization_code`

    const response = await fetch(url)
    const data = await response.json()

    if (data.errcode) {
        throw new Error(data.errmsg || '微信登录失败')
    }

    return {
        openid: data.openid,
        sessionKey: data.session_key
    }
}

// ==================== 高德地图相关 ====================

/**
 * 根据坐标查询城市信息
 * 高德地图逆地理编码API
 */
async function getCityByLocation(longitude, latitude, env) {
    // 检查 AMAP_KEY 是否配置
    if (!env.AMAP_KEY) {
        console.error('AMAP_KEY 未配置')
        throw new Error('服务配置错误：未配置高德地图API密钥')
    }

    // 使用 URLSearchParams 构建请求
    const baseUrl = 'https://restapi.amap.com/v3/geocode/regeo'
    const params = new URLSearchParams({
        location: `${longitude},${latitude}`,
        key: env.AMAP_KEY,
        radius: '1000',
        extensions: 'base',
        output: 'json'
    })
    const url = `${baseUrl}?${params.toString()}`

    console.log('高德地图API请求:', url.replace(env.AMAP_KEY, '***'))

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (compatible; CloudflareWorker/1.0)'
        }
    })

    // 检查 HTTP 状态
    if (!response.ok) {
        console.error('高德API HTTP错误:', response.status, response.statusText)
        throw new Error(`高德API请求失败: ${response.status}`)
    }

    // 读取响应文本
    const text = await response.text()
    if (!text || text.length === 0) {
        console.error('高德API返回空响应')
        throw new Error('高德API返回空响应')
    }

    // 解析 JSON
    let data
    try {
        data = JSON.parse(text)
    } catch (e) {
        console.error('高德API返回非JSON:', text.substring(0, 200))
        throw new Error('高德API返回格式错误')
    }

    console.log('高德地图API响应:', JSON.stringify(data).substring(0, 200))

    if (data.status !== '1') {
        console.error('高德地图API错误:', data.info, data.infocode)
        throw new Error(data.info || '获取城市信息失败')
    }

    // 处理响应数据
    if (!data.regeocode || !data.regeocode.addressComponent) {
        throw new Error('无法解析地理位置信息')
    }

    const addressComponent = data.regeocode.addressComponent

    return {
        province: addressComponent.province || '',
        city: addressComponent.city || addressComponent.province || '', // 直辖市没有city,用province代替
        district: addressComponent.district || '',
        township: addressComponent.township || '',
        street: addressComponent.streetNumber?.street || '',
        streetNumber: addressComponent.streetNumber?.number || '',
        adcode: addressComponent.adcode || '',
        cityCode: addressComponent.citycode || '',
        formattedAddress: data.regeocode.formatted_address || '',
        location: {
            longitude: longitude,
            latitude: latitude
        }
    }
}

/**
 * 搜索周边POI(景点)
 * 高德地图周边搜索API
 * @param {Number} longitude 经度
 * @param {Number} latitude 纬度
 * @param {Number} radius 搜索半径（米）
 * @param {String} keywords 关键词
 * @param {Object} env 环境变量
 * @param {String} types POI类型，默认"风景名胜|公园广场"
 * @param {Number} page 页码，默认1
 * @param {Number} pageSize 每页数量，默认20
 */
async function searchNearbyPOI(longitude, latitude, radius, keywords, env, types = '风景名胜|公园广场', page = 1, pageSize = 20) {
    if (!env.AMAP_KEY) {
        console.error('searchNearbyPOI: AMAP_KEY 未配置')
        throw new Error('服务配置错误：未配置高德地图API密钥')
    }

    // 使用 URL 对象构建请求，自动处理编码
    const baseUrl = 'https://restapi.amap.com/v3/place/around'
    const params = new URLSearchParams({
        location: `${longitude},${latitude}`,
        keywords: keywords,
        types: types,
        radius: String(radius),
        offset: String(pageSize),
        page: String(page),
        key: env.AMAP_KEY,
        extensions: 'all',
        output: 'json'
    })
    const url = `${baseUrl}?${params.toString()}`

    console.log('周边POI搜索请求:', url.replace(env.AMAP_KEY, '***'))

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (compatible; CloudflareWorker/1.0)'
        }
    })

    // 检查 HTTP 状态
    if (!response.ok) {
        console.error('高德API HTTP错误:', response.status, response.statusText)
        throw new Error(`高德API请求失败: ${response.status}`)
    }

    // 读取响应文本
    const text = await response.text()
    console.log('高德API响应长度:', text.length)

    if (!text || text.length === 0) {
        console.error('高德API返回空响应')
        throw new Error('高德API返回空响应')
    }

    // 解析 JSON
    let data
    try {
        data = JSON.parse(text)
    } catch (e) {
        console.error('高德API返回非JSON:', text.substring(0, 500))
        throw new Error('高德API返回格式错误')
    }

    console.log('周边POI搜索响应:', 'status=' + data.status, 'count=' + data.count, 'info=' + data.info)

    if (data.status !== '1') {
        console.error('周边POI搜索失败:', data.info, data.infocode)
        throw new Error(data.info || '搜索周边POI失败')
    }

    return {
        pois: data.pois || [],
        total: parseInt(data.count) || 0
    }
}

// ==================== 路由处理器 ====================

/**
 * 1. 用户登录
 */
async function handleLogin(request, env) {
    const body = await request.json()
    const { code } = body

    if (!code) {
        return errorResponse('缺少code参数', 400)
    }

    try {
        const { openid, sessionKey } = await wechatLogin(code, env)

        // 生成JWT token
        const token = await generateToken({ openid }, env.JWT_SECRET)

        // 保存用户信息到KV
        await env.KV.put(`user:${openid}`, JSON.stringify({
            openid,
            sessionKey,
            createdAt: Date.now()
        }))

        return jsonResponse({
            token,
            openid,
            sessionKey
        })
    } catch (err) {
        return errorResponse(err.message, 500)
    }
}

/**
 * 2. 根据坐标查询城市
 */
async function handleGetCityByLocation(request, env) {
    const url = new URL(request.url)
    const latitude = parseFloat(url.searchParams.get('latitude'))
    const longitude = parseFloat(url.searchParams.get('longitude'))

    if (!latitude || !longitude) {
        return errorResponse('缺少经纬度参数', 400)
    }

    try {
        const cityInfo = await getCityByLocation(longitude, latitude, env)
        return jsonResponse(cityInfo)
    } catch (err) {
        return errorResponse(err.message, 500)
    }
}

// 预定义热门旅游城市列表
const HOT_DESTINATION_CITIES = [
    { name: '北京', keywords: '故宫', description: '千年古都' },
    { name: '上海', keywords: '外滩', description: '魔都风情' },
    { name: '西安', keywords: '兵马俑', description: '历史名城' },
    { name: '成都', keywords: '大熊猫基地', description: '天府之国' },
    { name: '杭州', keywords: '西湖', description: '人间天堂' },
    { name: '丽江', keywords: '丽江古城', description: '浪漫古镇' },
]

/**
 * 使用高德API搜索城市地标景点
 */
async function searchCityLandmark(city, keywords, env) {
    if (!env.AMAP_KEY) {
        return null
    }

    try {
        const params = new URLSearchParams({
            key: env.AMAP_KEY,
            keywords: keywords,
            city: city,
            citylimit: 'true',
            types: '风景名胜',
            offset: '1',
            page: '1',
            extensions: 'base',
            output: 'json'
        })

        const url = `https://restapi.amap.com/v3/place/text?${params.toString()}`
        console.log('查询城市地标:', city, keywords)

        const response = await fetch(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (compatible; CloudflareWorker/1.0)'
            }
        })

        if (!response.ok) {
            console.error('高德API请求失败:', response.status)
            return null
        }

        const data = await response.json()
        if (data.status !== '1' || !data.pois || data.pois.length === 0) {
            console.log('未找到城市地标:', city)
            return null
        }

        const poi = data.pois[0]
        const location = poi.location ? poi.location.split(',') : null

        return {
            poiName: poi.name,
            address: poi.address || '',
            latitude: location ? parseFloat(location[1]) : null,
            longitude: location ? parseFloat(location[0]) : null
        }
    } catch (err) {
        console.error('搜索城市地标失败:', city, err.message)
        return null
    }
}

/**
 * 使用Unsplash搜索城市图片
 */
async function searchCityImage(city, env) {
    if (!env.UNSPLASH_ACCESS_KEY) {
        return null
    }

    try {
        // 优先使用英文城市名搜索
        const englishName = CITY_NAME_MAP[city] || city
        const query = `${englishName} city landmark skyline`

        const params = new URLSearchParams({
            query: query,
            per_page: '3',
            orientation: 'landscape'
        })

        const url = `https://api.unsplash.com/search/photos?${params.toString()}`

        const response = await fetch(url, {
            headers: {
                'Authorization': `Client-ID ${env.UNSPLASH_ACCESS_KEY}`,
                'Accept-Version': 'v1'
            }
        })

        if (!response.ok) {
            console.error('Unsplash API请求失败:', response.status)
            return null
        }

        const data = await response.json()
        if (!data.results || data.results.length === 0) {
            console.log('Unsplash未找到城市图片:', city)
            return null
        }

        // 随机选择前3张中的一张，使用 small 尺寸 (约400px) 减小体积
        const randomIndex = Math.floor(Math.random() * Math.min(3, data.results.length))
        return data.results[randomIndex].urls.small
    } catch (err) {
        console.error('搜索城市图片失败:', city, err.message)
        return null
    }
}

/**
 * 3. 获取热门目的地
 * 使用高德API查询热门城市地标,Unsplash获取城市图片
 */
async function handleGetHotDestinations(request, env) {
    // 从KV获取缓存数据(7天有效)
    const cached = await env.KV.get('hot_destinations')
    if (cached) {
        console.log('使用缓存的热门目的地数据')
        return jsonResponse(JSON.parse(cached))
    }

    console.log('开始获取热门目的地真实数据...')

    // 并发查询所有热门城市
    const destinationPromises = HOT_DESTINATION_CITIES.map(async (cityConfig, index) => {
        const { name, keywords, description } = cityConfig

        // 并发获取地标信息和城市图片
        const [landmark, imageUrl] = await Promise.all([
            searchCityLandmark(name, keywords, env),
            searchCityImage(name, env)
        ])

        return {
            id: index + 1,
            name: name,
            image: imageUrl || `https://picsum.photos/seed/${name}/800/400`,
            description: description,
            landmark: landmark ? landmark.poiName : keywords,
            latitude: landmark ? landmark.latitude : null,
            longitude: landmark ? landmark.longitude : null
        }
    })

    try {
        const destinations = await Promise.all(destinationPromises)
        console.log('热门目的地数据获取完成:', destinations.length)

        // 缓存7天 (604800秒)
        await env.KV.put('hot_destinations', JSON.stringify(destinations), { expirationTtl: 604800 })

        return jsonResponse(destinations)
    } catch (err) {
        console.error('获取热门目的地失败:', err.message)

        // 降级返回默认数据
        const fallbackDestinations = HOT_DESTINATION_CITIES.map((city, index) => ({
            id: index + 1,
            name: city.name,
            image: `https://picsum.photos/seed/${city.name}/800/400`,
            description: city.description,
            landmark: city.keywords
        }))

        return jsonResponse(fallbackDestinations)
    }
}

/**
 * 4. 获取周边景点 (改用高德地图)
 * 支持分页和类型筛选
 */
async function handleGetNearbyAttractions(request, env) {
    const url = new URL(request.url)
    const latitude = parseFloat(url.searchParams.get('latitude'))
    const longitude = parseFloat(url.searchParams.get('longitude'))
    const radius = parseInt(url.searchParams.get('radius') || '10')
    const keywords = url.searchParams.get('keywords') || '景点'
    const types = url.searchParams.get('types') || '风景名胜|公园广场'
    const page = parseInt(url.searchParams.get('page') || '1')
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20')

    if (!latitude || !longitude) {
        return errorResponse('缺少经纬度参数', 400)
    }

    try {
        const result = await searchNearbyPOI(longitude, latitude, radius * 1000, keywords, env, types, page, pageSize)
        const pois = result.pois
        const total = result.total

        // 转换数据格式
        const attractions = pois.map((poi, index) => {
            const location = poi.location ? poi.location.split(',') : ['0', '0']
            return {
                id: poi.id || String(index + 1),
                name: poi.name || '未知景点',
                image: poi.photos && poi.photos.length > 0
                    ? poi.photos[0].url
                    : 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=400',
                tags: poi.type || '景点',
                distance: poi.distance ? `${(poi.distance / 1000).toFixed(1)}km` : '未知',
                address: poi.address || '',
                rating: (poi.biz_ext && poi.biz_ext.rating) ? poi.biz_ext.rating : null,
                tel: poi.tel || '',
                latitude: parseFloat(location[1]) || 0,
                longitude: parseFloat(location[0]) || 0
            }
        })

        return jsonResponse({
            list: attractions,
            total: total,
            page: page,
            pageSize: pageSize,
            hasMore: attractions.length >= pageSize
        })
    } catch (err) {
        // 打印错误日志
        console.error('获取周边景点失败:', err.message, err.stack)

        // 返回模拟数据
        const mockData = [
            {
                id: 1,
                name: '城市森林公园',
                image: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=400',
                tags: '5A级景区,亲子游',
                distance: '5.2km',
                address: '示例地址',
                latitude: latitude + 0.01,
                longitude: longitude + 0.01
            }
        ]
        return jsonResponse({
            list: mockData,
            total: 1,
            page: 1,
            pageSize: pageSize,
            hasMore: false
        })
    }
}

/**
 * 5. AI生成行程 - 调用N8N智能旅行规划工作流
 * 支持版本参数：apiVersion 可选值如 'v2'，将拼接到工作流URL后
 * 
 * 回调模式：发送请求后立即返回，N8N完成后回调Worker更新状态
 * 状态值：generating(生成中), completed(已完成), failed(失败)
 */
async function handleGeneratePlan(request, env, ctx) {
    const user = await getUserFromRequest(request, env)
    if (!user) {
        return errorResponse('未登录', 401)
    }

    const body = await request.json()
    const { city, date, days, poiTypes, notes, transportation, accommodation, apiVersion, userLocation } = body

    if (!city || !date || !days) {
        return errorResponse('缺少必要参数', 400)
    }

    // 检查N8N工作流URL是否配置
    if (!env.N8N_WORKFLOW_URL) {
        return errorResponse('服务配置错误：未配置N8N工作流地址', 500)
    }

    // 计算结束日期
    const startDate = new Date(date)
    const endDate = new Date(startDate)
    endDate.setDate(endDate.getDate() + days - 1)
    const endDateStr = endDate.toISOString().split('T')[0]

    // 生成行程ID
    const planId = generateId('plan_')

    // ====== 翻译偏好设置（在创建pendingPlan之前，确保所有地方使用相同的翻译值）======

    // 翻译景点类型
    const preferenceMap = {
        'any': '不限',
        'nature': '自然风光',
        'history': '历史古迹',
        'museum': '博物馆',
        'amusement': '游乐园',
        'food': '美食探店'
    }
    // 翻译后的景点类型（过滤掉"不限"）
    const translatedPoiTypes = (poiTypes || [])
        .filter(type => type !== 'any')
        .map(type => preferenceMap[type] || type)

    // 翻译交通方式
    const transportMap = {
        'public': '公共交通',
        'drive': '自驾',
        'walk': '步行为主'
    }
    const translatedTransport = transportMap[transportation] || transportation || '公共交通'

    // 翻译住宿偏好
    const accommodationMap = {
        'budget': '经济型酒店',
        'comfort': '舒适型酒店',
        'luxury': '豪华型酒店'
    }
    const translatedAccommodation = accommodationMap[accommodation] || accommodation || '经济型酒店'

    // 创建"生成中"状态的行程记录（使用翻译后的值）
    const pendingPlan = {
        id: planId,
        openid: user.openid,  // 用于回调时识别用户
        city: city,
        date: date,
        endDate: endDateStr,
        days: days,
        transportation: translatedTransport,
        accommodation: translatedAccommodation,
        poiTypes: translatedPoiTypes,  // 翻译后的景点类型
        notes: notes,
        apiVersion: apiVersion || null,
        // 状态字段
        status: 'generating',  // generating | completed | failed
        statusMessage: '正在生成行程，请稍候...',
        // 空的详情数据
        schedule: [],
        weatherInfo: [],
        budget: {},
        overallSuggestions: '',
        routeInfo: [],
        routeSummary: null,
        createdAt: Date.now()
    }

    try {
        // 下载并保存城市封面图片到R2（在创建时就保存，避免列表无图）
        const cityImage = await downloadAndSaveCityImage(city, planId, env)
        pendingPlan.cityImage = cityImage

        // 立即保存"生成中"状态的记录
        await env.KV.put(`plan:${user.openid}:${planId}`, JSON.stringify(pendingPlan))

        // 更新用户的行程列表（带状态）
        const listKey = `plan_list:${user.openid}`
        const existingList = await env.KV.get(listKey)
        const planList = existingList ? JSON.parse(existingList) : []
        planList.unshift({
            id: planId,
            city: pendingPlan.city,
            date: pendingPlan.date,
            endDate: pendingPlan.endDate,
            days: pendingPlan.days,
            status: 'generating',
            cityImage: cityImage,  // 创建时就有封面图
            transportation: translatedTransport,
            accommodation: translatedAccommodation,
            poiTypes: translatedPoiTypes,
            createdAt: pendingPlan.createdAt
        })
        await env.KV.put(listKey, JSON.stringify(planList))


        // 用于N8N的偏好参数（使用翻译后的景点类型）
        const preferences = translatedPoiTypes.length > 0 ? translatedPoiTypes : ['休闲']


        // 构建回调URL（N8N完成后调用此接口更新状态）
        const callbackUrl = new URL(request.url)
        callbackUrl.pathname = '/api/plan/callback'

        // 构建N8N工作流请求参数（包含回调信息）
        const n8nRequest = {
            city: city,
            start_date: date,
            end_date: endDateStr,
            travel_days: days,
            transportation: transportation || '公共交通',
            accommodation: accommodation || '经济型酒店',
            preferences: preferences.length > 0 ? preferences : ['休闲'],
            free_text_input: notes || '',
            // 用户起点坐标（用于规划起点到第一个景点、最后一个景点回起点的路线）
            user_location: userLocation || null,
            // 回调信息
            callback: {
                url: callbackUrl.toString(),
                planId: planId,
                openid: user.openid
            }
        }

        // 根据版本参数构建N8N工作流URL
        let n8nWorkflowUrl = env.N8N_WORKFLOW_URL
        if (apiVersion) {
            n8nWorkflowUrl = n8nWorkflowUrl.replace(/\/$/, '') + '/' + apiVersion
        }
        console.log('发送N8N请求，回调模式，URL:', n8nWorkflowUrl)

        // 发送请求到N8N（使用 ctx.waitUntil 确保请求在 Worker 返回后继续执行）
        // N8N 工作流配置为：接收请求后处理完成，然后调用回调接口
        ctx.waitUntil(
            fetch(n8nWorkflowUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Cloudflare-Worker/1.0'
                },
                body: JSON.stringify(n8nRequest)
            }).then(response => {
                console.log('N8N请求已发送，状态码:', response.status)
                return response.text().then(text => {
                    console.log('N8N响应:', text.substring(0, 200))
                })
            }).catch(err => {
                console.error('发送N8N请求失败:', err)
            })
        )

        // 立即返回"生成中"的行程
        return jsonResponse(pendingPlan)

    } catch (err) {
        console.error('创建行程记录失败:', err)
        return errorResponse('创建行程失败: ' + err.message, 500)
    }
}

/**
 * 5.1 N8N回调接口 - 接收N8N工作流完成后的回调
 */
async function handlePlanCallback(request, env) {
    try {
        const body = await request.json()
        const { planId, openid, success, data, message } = body

        if (!planId || !openid) {
            return errorResponse('缺少必要参数', 400)
        }

        console.log('收到N8N回调, planId:', planId, 'success:', success)

        if (!success) {
            // 生成失败
            await updatePlanStatus(env, openid, planId, 'failed', message || 'AI生成失败')
            return jsonResponse({ received: true, status: 'failed' })
        }

        // 生成成功，更新行程数据
        const planKey = `plan:${openid}:${planId}`
        const existingData = await env.KV.get(planKey)

        if (!existingData) {
            return errorResponse('行程不存在', 404)
        }

        const existingPlan = JSON.parse(existingData)
        const tripPlan = data

        // 下载并保存城市封面图片到R2
        const cityName = tripPlan.city || existingPlan.city
        const cityImage = await downloadAndSaveCityImage(cityName, planId, env)

        // 为每天生成静态地图URL
        const dayStaticMaps = []
        const days = tripPlan.days || []
        for (const day of days) {
            const planning = day.planning || []
            const mapUrl = generateStaticMapUrl(planning, env.AMAP_KEY)
            dayStaticMaps.push(mapUrl)
        }

        // 更新行程记录为完成状态
        const completedPlan = {
            ...existingPlan,
            city: cityName,
            date: tripPlan.start_date || existingPlan.date,
            endDate: tripPlan.end_date || existingPlan.endDate,
            // 新增：城市封面图片和静态地图
            cityImage: cityImage,
            dayStaticMaps: dayStaticMaps,
            // 状态更新为已完成
            status: 'completed',
            statusMessage: '',
            // N8N返回的详细数据
            schedule: days,
            weatherInfo: tripPlan.weather_info || [],
            budget: tripPlan.budget || {},
            overallSuggestions: tripPlan.overall_suggestions || '',
            routeInfo: tripPlan.route_info || body.route_info || [],
            routeSummary: tripPlan.route_summary || body.summary || null,
            completedAt: Date.now()
        }

        // 保存完成的行程
        await env.KV.put(planKey, JSON.stringify(completedPlan))

        // 构建列表项额外信息（用于显示标签）
        const listItemInfo = {
            cityImage: cityImage,
            transportation: existingPlan.transportation || '公共交通',
            accommodation: existingPlan.accommodation || '经济型酒店',
            poiTypes: existingPlan.poiTypes || []
        }

        // 更新列表中的状态和额外信息
        await updatePlanListStatus(env, openid, planId, 'completed', listItemInfo)

        console.log('行程生成完成(回调):', planId, '城市图片:', cityImage)
        return jsonResponse({ received: true, status: 'completed' })

    } catch (err) {
        console.error('处理N8N回调失败:', err)
        return errorResponse('回调处理失败: ' + err.message, 500)
    }
}

/**
 * 后台处理 N8N 请求（异步）
 */
async function processN8NRequest(env, openid, planId, params) {
    const { city, date, endDateStr, days, poiTypes, notes, transportation, accommodation, apiVersion } = params

    try {
        // 转换偏好类型名称
        const preferenceMap = {
            'any': '不限',
            'nature': '自然风光',
            'history': '历史古迹',
            'museum': '博物馆',
            'amusement': '游乐园',
            'food': '美食探店'
        }
        const preferences = (poiTypes || [])
            .filter(type => type !== 'any')
            .map(type => preferenceMap[type] || type)

        // 构建N8N工作流请求参数
        const n8nRequest = {
            city: city,
            start_date: date,
            end_date: endDateStr,
            travel_days: days,
            transportation: transportation || '公共交通',
            accommodation: accommodation || '经济型酒店',
            preferences: preferences.length > 0 ? preferences : ['休闲'],
            free_text_input: notes || ''
        }

        // 根据版本参数构建N8N工作流URL
        let n8nWorkflowUrl = env.N8N_WORKFLOW_URL
        if (apiVersion) {
            n8nWorkflowUrl = n8nWorkflowUrl.replace(/\/$/, '') + '/' + apiVersion
        }
        console.log('后台调用N8N工作流URL:', n8nWorkflowUrl)

        // 调用N8N工作流
        const n8nResponse = await fetch(n8nWorkflowUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Cloudflare-Worker/1.0'
            },
            body: JSON.stringify(n8nRequest)
        })

        if (!n8nResponse.ok) {
            console.error('N8N工作流返回错误:', n8nResponse.status)
            await updatePlanStatus(env, openid, planId, 'failed', 'AI生成失败，请重试')
            return
        }

        const n8nResult = await n8nResponse.json()
        console.log('N8N工作流响应:', JSON.stringify(n8nResult).substring(0, 500))

        // 处理N8N返回的数据
        let planData = Array.isArray(n8nResult) ? n8nResult[0] : n8nResult

        if (!planData.success) {
            console.error('N8N工作流生成失败:', planData.message)
            await updatePlanStatus(env, openid, planId, 'failed', planData.message || 'AI生成失败')
            return
        }

        // 提取行程数据
        const tripPlan = planData.data

        // 更新行程记录为完成状态
        const completedPlan = {
            id: planId,
            city: tripPlan.city || city,
            date: tripPlan.start_date || date,
            endDate: tripPlan.end_date || endDateStr,
            days: days,
            transportation: transportation || '公共交通',
            accommodation: accommodation || '经济型酒店',
            poiTypes: poiTypes,
            notes: notes,
            apiVersion: apiVersion || null,
            // 状态更新为已完成
            status: 'completed',
            statusMessage: '',
            // N8N返回的详细数据
            schedule: tripPlan.days || [],
            weatherInfo: tripPlan.weather_info || [],
            budget: tripPlan.budget || {},
            overallSuggestions: tripPlan.overall_suggestions || '',
            routeInfo: tripPlan.route_info || planData.route_info || [],
            routeSummary: tripPlan.route_summary || planData.summary || null,
            createdAt: Date.now()
        }

        // 保存完成的行程
        await env.KV.put(`plan:${openid}:${planId}`, JSON.stringify(completedPlan))

        // 更新列表中的状态
        await updatePlanListStatus(env, openid, planId, 'completed')

        console.log('行程生成完成:', planId)

    } catch (err) {
        console.error('后台处理N8N请求失败:', err)
        await updatePlanStatus(env, openid, planId, 'failed', '生成失败: ' + err.message)
    }
}

/**
 * 更新行程状态
 */
async function updatePlanStatus(env, openid, planId, status, message) {
    try {
        const planKey = `plan:${openid}:${planId}`
        const planData = await env.KV.get(planKey)
        if (planData) {
            const plan = JSON.parse(planData)
            plan.status = status
            plan.statusMessage = message || ''
            await env.KV.put(planKey, JSON.stringify(plan))
        }
        // 同时更新列表状态
        await updatePlanListStatus(env, openid, planId, status)
    } catch (err) {
        console.error('更新行程状态失败:', err)
    }
}

/**
 * 更新行程列表中的状态
 * @param {Object} env 环境变量
 * @param {String} openid 用户openid
 * @param {String} planId 行程ID
 * @param {String} status 状态
 * @param {Object|String} extraInfo 可选，额外信息对象或城市图片URL（兼容旧调用）
 */
async function updatePlanListStatus(env, openid, planId, status, extraInfo = null) {
    try {
        const listKey = `plan_list:${openid}`
        const listData = await env.KV.get(listKey)
        if (listData) {
            const planList = JSON.parse(listData)
            const item = planList.find(p => p.id === planId)
            if (item) {
                item.status = status

                // 处理额外信息（支持对象或字符串）
                if (extraInfo) {
                    if (typeof extraInfo === 'object') {
                        // 新格式：对象包含多个字段
                        if (extraInfo.cityImage) item.cityImage = extraInfo.cityImage
                        if (extraInfo.transportation) item.transportation = extraInfo.transportation
                        if (extraInfo.accommodation) item.accommodation = extraInfo.accommodation
                        if (extraInfo.poiTypes) item.poiTypes = extraInfo.poiTypes
                    } else {
                        // 旧格式：仅城市图片URL字符串
                        item.cityImage = extraInfo
                    }
                }

                await env.KV.put(listKey, JSON.stringify(planList))
            }
        }
    } catch (err) {
        console.error('更新行程列表状态失败:', err)
    }
}


/**
 * 6. 获取行程列表（支持分页）
 */
async function handleGetPlanList(request, env) {
    const user = await getUserFromRequest(request, env)
    if (!user) {
        return errorResponse('未登录', 401)
    }

    const url = new URL(request.url)
    const page = parseInt(url.searchParams.get('page')) || 1
    const pageSize = parseInt(url.searchParams.get('pageSize')) || 10

    try {
        const listKey = `plan_list:${user.openid}`
        const data = await env.KV.get(listKey)
        const allList = data ? JSON.parse(data) : []

        // 计算分页
        const total = allList.length
        const totalPages = Math.ceil(total / pageSize)
        const start = (page - 1) * pageSize
        const end = start + pageSize
        const list = allList.slice(start, end)
        const hasMore = page < totalPages

        return jsonResponse({
            list,
            total,
            page,
            pageSize,
            totalPages,
            hasMore
        })
    } catch (err) {
        return errorResponse('获取失败', 500)
    }
}

/**
 * 8. 获取行程详情
 */
async function handleGetPlanDetail(request, env) {
    const user = await getUserFromRequest(request, env)
    if (!user) {
        return errorResponse('未登录', 401)
    }

    const url = new URL(request.url)
    const id = url.searchParams.get('id')

    if (!id) {
        return errorResponse('缺少id参数', 400)
    }

    try {
        const data = await env.KV.get(`plan:${user.openid}:${id}`)
        if (!data) {
            return errorResponse('行程不存在', 404)
        }

        return jsonResponse(JSON.parse(data))
    } catch (err) {
        return errorResponse('获取失败', 500)
    }
}

/**
 * 9. 删除行程
 */
async function handleDeletePlan(request, env) {
    const user = await getUserFromRequest(request, env)
    if (!user) {
        return errorResponse('未登录', 401)
    }

    const url = new URL(request.url)
    const id = url.searchParams.get('id')

    if (!id) {
        return errorResponse('缺少id参数', 400)
    }

    try {
        // 删除行程详情
        await env.KV.delete(`plan:${user.openid}:${id}`)

        // 更新行程列表
        const listKey = `plan_list:${user.openid}`
        const existingList = await env.KV.get(listKey)
        if (existingList) {
            const planList = JSON.parse(existingList)
            const newList = planList.filter(item => item.id !== id)
            await env.KV.put(listKey, JSON.stringify(newList))
        }

        return jsonResponse({ id, deleted: true })
    } catch (err) {
        console.error('删除行程失败:', err)
        return errorResponse('删除失败', 500)
    }
}

/**
 * 12. AI生成明信片 - 使用 kuai.host Nano Banana Pro API
 * 支持异步后台生成缩略图
 * 限制：同一用户每天最多生成3次（白名单用户不受限制）
 */
// 白名单用户列表（这些用户不受每日生成次数限制）
const POSTCARD_WHITELIST = [
    'orBRy14EIyMRaE6VgyAsGd3nYmMY',  // 示例白名单用户2
    // 添加更多白名单 openid...
]

// 每日生成次数限制
const DAILY_POSTCARD_LIMIT = 3

async function handleGeneratePostcard(request, env, ctx) {
    const user = await getUserFromRequest(request, env)
    if (!user) {
        return errorResponse('未登录', 401)
    }

    const body = await request.json()
    const { planId } = body

    if (!planId) {
        return errorResponse('缺少行程ID参数', 400)
    }

    // 检查是否为白名单用户
    const isWhitelisted = POSTCARD_WHITELIST.includes(user.openid)

    // 非白名单用户需要检查每日生成次数
    if (!isWhitelisted) {
        const today = new Date().toISOString().split('T')[0]  // 格式: 2025-12-11
        const countKey = `postcard_count:${user.openid}:${today}`

        // 获取今日已生成次数
        const countStr = await env.KV.get(countKey)
        const currentCount = countStr ? parseInt(countStr, 10) : 0

        if (currentCount >= DAILY_POSTCARD_LIMIT) {
            return errorResponse(`今日生成次数已达上限（每天最多${DAILY_POSTCARD_LIMIT}次），请明天再试`, 429)
        }

        // 增加计数（设置过期时间为24小时，确保次日自动重置）
        await env.KV.put(countKey, String(currentCount + 1), { expirationTtl: 86400 })
    }

    // 检查环境变量配置
    if (!env.KUAI_API_KEY) {
        return errorResponse('服务配置错误：未配置KUAI_API_KEY', 500)
    }

    try {
        // 1. 根据 planId 查询行程详情
        const planData = await env.KV.get(`plan:${user.openid}:${planId}`)
        if (!planData) {
            return errorResponse('行程不存在', 404)
        }
        const plan = JSON.parse(planData)

        // 2. 构建生成提示词
        const prompt = buildPostcardPrompt(plan)
        console.log('生成明信片提示词:', prompt)

        // 3. 调用 kuai.host API 生成图片 (Google AI generateContent 格式)
        const kuaiApiBase = env.KUAI_API_BASE || 'https://api.kuai.host'
        const modelName = env.KUAI_MODEL || 'gemini-3-pro-image-preview'
        const apiUrl = `${kuaiApiBase}/v1beta/models/${modelName}:generateContent`

        // 调试日志
        console.log('KUAI_API_KEY 存在:', !!env.KUAI_API_KEY)
        console.log('KUAI_API_KEY 前10位:', env.KUAI_API_KEY ? env.KUAI_API_KEY.substring(0, 10) + '...' : 'undefined')
        console.log('请求 URL:', apiUrl)

        const imageResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${env.KUAI_API_KEY}`
            },
            body: JSON.stringify({
                contents: [{
                    role: 'user',
                    parts: [{
                        text: prompt
                    }]
                }],
                generationConfig: {
                    responseModalities: ['TEXT', 'IMAGE'],
                    imageConfig: {
                        aspectRatio: '3:4',
                        imageSize: '2K'
                    }
                }
            })
        })

        if (!imageResponse.ok) {
            const errorText = await imageResponse.text()
            console.error('kuai.host API 错误:', imageResponse.status, errorText)
            return errorResponse('AI生成图片失败，请稍后重试', 500)
        }

        const imageResult = await imageResponse.json()
        console.log('kuai.host 响应:', JSON.stringify(imageResult).substring(0, 500))

        // 4. 解析响应获取图片数据 (Google AI generateContent 格式)
        let imageUrl = null
        let imageData = null

        // 处理 Google AI generateContent 格式的响应
        // 格式: { candidates: [{ content: { parts: [{ inlineData: { data, mimeType } }] } }] }
        if (imageResult.candidates && imageResult.candidates[0]) {
            const candidate = imageResult.candidates[0]
            const parts = candidate.content?.parts

            if (parts && Array.isArray(parts)) {
                for (const part of parts) {
                    // 检查 inlineData（base64 图片）
                    if (part.inlineData && part.inlineData.data) {
                        imageData = part.inlineData.data
                        console.log('获取到 inlineData 图片数据，长度:', imageData.length)
                        break
                    }
                    // 检查 inline_data（另一种命名格式）
                    if (part.inline_data && part.inline_data.data) {
                        imageData = part.inline_data.data
                        console.log('获取到 inline_data 图片数据，长度:', imageData.length)
                        break
                    }
                    // 检查文本中的 URL
                    if (part.text) {
                        const urlMatch = part.text.match(/(https?:\/\/[^\s"']+\.(png|jpg|jpeg|webp|gif))/i)
                        if (urlMatch) {
                            imageUrl = urlMatch[1]
                            console.log('从文本中提取到图片 URL:', imageUrl)
                        }
                    }
                }
            }
        }

        // 5. 如果有 base64 数据，上传原图到 R2（同步，快速响应）
        let thumbnailUrl = null
        const timestamp = Date.now()
        const postcardId = generateId('postcard_')  // 提前生成 ID，用于异步任务和保存

        if (imageData && env.R2_BUCKET) {
            const originalPath = `postcards/${user.openid}/${timestamp}.png`
            const imageBuffer = Uint8Array.from(atob(imageData), c => c.charCodeAt(0))

            await env.R2_BUCKET.put(originalPath, imageBuffer, {
                httpMetadata: {
                    contentType: 'image/png'
                }
            })

            // 构建 R2 公开访问 URL
            imageUrl = `https://${env.R2_PUBLIC_DOMAIN || 'r2.smallyoung.cn'}/${originalPath}`

            // 后台异步生成缩略图（不阻塞响应）
            if (ctx && ctx.waitUntil) {
                ctx.waitUntil(
                    generateThumbnailAsync(env, user.openid, postcardId, imageBuffer, timestamp)
                )
            }
        }

        // 如果没有获取到图片，使用默认图片
        if (!imageUrl) {
            console.warn('未获取到AI生成的图片，使用默认图片')
            imageUrl = 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600'
        }

        // 6. 生成明信片记录
        const postcard = {
            id: postcardId,
            planId: planId,
            title: `${plan.city}之旅`,
            image: imageUrl,
            thumbnail: null,  // 初始为空，后台异步生成后更新
            city: plan.city,
            date: plan.date,
            endDate: plan.endDate,
            days: plan.days,
            description: `${plan.city} ${plan.days}天${plan.days - 1}晚精彩旅程`,
            createdAt: Date.now()
        }

        // 7. 保存明信片详情到 KV
        await env.KV.put(`postcard:${user.openid}:${postcardId}`, JSON.stringify(postcard))

        // 8. 更新用户明信片列表
        const listKey = `postcard_list:${user.openid}`
        const existingList = await env.KV.get(listKey)
        const postcardList = existingList ? JSON.parse(existingList) : []
        postcardList.unshift({
            id: postcardId,
            title: postcard.title,
            image: postcard.image,
            thumbnail: null,  // 初始为空
            city: postcard.city,
            date: postcard.date,
            createdAt: postcard.createdAt
        })
        await env.KV.put(listKey, JSON.stringify(postcardList))

        return jsonResponse(postcard)
    } catch (err) {
        console.error('生成明信片失败:', err)
        return errorResponse('生成明信片失败: ' + err.message, 500)
    }
}

/**
 * 异步生成缩略图并更新 KV
 * 使用 ctx.waitUntil() 调用，不阻塞主请求
 */
async function generateThumbnailAsync(env, openid, postcardId, imageBuffer, timestamp) {
    try {
        console.log('开始异步生成缩略图:', postcardId)
        const thumbnailPath = `postcards/${openid}/${timestamp}_thumb.jpg`

        // 使用 photon 压缩图片
        const inputImage = PhotonImage.new_from_byteslice(imageBuffer)
        const originalWidth = inputImage.get_width()
        const originalHeight = inputImage.get_height()

        console.log('原始图片尺寸:', originalWidth, 'x', originalHeight)

        // 缩放到 400px 宽
        const maxWidth = 400
        const ratio = Math.min(1, maxWidth / originalWidth)
        const newWidth = Math.round(originalWidth * ratio)
        const newHeight = Math.round(originalHeight * ratio)

        let jpegBytes
        if (ratio < 1) {
            // 需要缩放 (SamplingFilter.Lanczos3 = 3)
            const resized = resize(inputImage, newWidth, newHeight, SamplingFilter.Lanczos3)
            jpegBytes = resized.get_bytes_jpeg(80)
            resized.free()
        } else {
            // 不需要缩放，直接转换为 JPEG
            jpegBytes = inputImage.get_bytes_jpeg(80)
        }
        inputImage.free()


        console.log('缩略图大小:', jpegBytes.length, 'bytes')

        // 上传缩略图到 R2
        await env.R2_BUCKET.put(thumbnailPath, jpegBytes, {
            httpMetadata: { contentType: 'image/jpeg' }
        })

        const thumbnailUrl = `https://${env.R2_PUBLIC_DOMAIN || 'r2.smallyoung.cn'}/${thumbnailPath}`

        // 更新 KV 中的明信片详情
        const postcardKey = `postcard:${openid}:${postcardId}`
        const postcardData = await env.KV.get(postcardKey)
        if (postcardData) {
            const postcard = JSON.parse(postcardData)
            postcard.thumbnail = thumbnailUrl
            await env.KV.put(postcardKey, JSON.stringify(postcard))
        }

        // 同时更新列表中的缩略图
        const listKey = `postcard_list:${openid}`
        const listData = await env.KV.get(listKey)
        if (listData) {
            const list = JSON.parse(listData)
            const item = list.find(p => p.id === postcardId)
            if (item) {
                item.thumbnail = thumbnailUrl
                await env.KV.put(listKey, JSON.stringify(list))
            }
        }

        console.log('缩略图生成完成:', thumbnailUrl)
    } catch (err) {
        console.error('异步生成缩略图失败:', err)
        // 失败不影响主流程，前端会降级显示原图
    }
}

/**
 * 构建明信片生成提示词
 * 根据行程数据动态生成详细的提示词
 */
function buildPostcardPrompt(plan) {
    const city = plan.city || '未知城市'
    const days = plan.days || 1

    // 提取所有景点信息
    const attractions = []
    if (plan.schedule && Array.isArray(plan.schedule)) {
        plan.schedule.forEach((day) => {
            if (day.attractions && Array.isArray(day.attractions)) {
                day.attractions.forEach(attraction => {
                    attractions.push({
                        name: attraction.name,
                        description: attraction.description || ''
                    })
                })
            }
        })
    }

    // 构建旅行站点列表
    let stationsText = ''
    attractions.slice(0, 8).forEach((attraction, index) => {
        stationsText += `- "第 ${index + 1} 站：{${attraction.name} + ${attraction.description}}"\n\n`
    })
    stationsText += `- "最终站：{当地招牌美食/纪念品 + 温馨结束语}"`

    // 根据城市生成地标（这里使用通用描述，实际可以扩展为城市数据库）
    const landmarks = getCityLandmarks(city)
    const foods = getCityFoods(city)

    return `请绘制一张色彩鲜艳、竖版（3:4）手绘风格的《${city}旅行明信片》，画风仿佛由一位充满好奇心的孩子用蜡笔创作，整体使用柔和温暖的浅色背景（如浅黄色），搭配红色、蓝色、绿色等明亮色调，营造温馨、童趣、满满旅行气息的氛围。

一、主画面：手账式旅行路线

在插画中央绘制一条"蜿蜒曲折的旅行路线"，路线用箭头 + 虚线连接多个地点，由 ${days} 日行程自动生成推荐景点：

${stationsText}

> 旅程站点数量随天数自动生成：
> 若用户未输入天数，则按默认 1 日 / 精华线路生成。

二、周围趣味元素（全部根据城市自动替换）

在路线周围加入大量充满童趣的小元素，例如：

- 可爱的旅行角色： "拿着当地特色小吃的小朋友"、 "背着旅行包的冒险小孩"等。

- 当地标志性建筑的童趣 Q 版手绘： 如 "${landmarks[0]}"、"${landmarks[1]}"、"${landmarks[2]}"。

- 有趣的提示牌： "小心迷路！"、"注意人流！"、"前方好吃的！"（可根据城市语境调整）。

- 贴纸式小标语： "${city}旅行记忆已解锁！" "${city}美食大冒险！" "下一站去哪儿？"

- 当地美食的可爱小图标： 如 "${foods[0]}"、"${foods[1]}"、"${foods[2]}"。

- 感叹句（保持童真风）： "原来${city}这么好玩！" "我要再来一次！"

三、整体风格要求

- 手绘蜡笔风 / 儿童旅行日志风格
- 色彩鲜艳、构图饱满但温暖
- 强调旅行的欢乐与探索感
- 所有文字采用可爱的手写字体
- 让整个画面像一本童趣满满的旅行手账页面

请直接生成图片，不需要文字描述。`
}

/**
 * 获取城市地标（可扩展为数据库查询）
 */
function getCityLandmarks(city) {
    const landmarkMap = {
        '石家庄市': ['正定古城', '赵州桥', '西柏坡'],
        '石家庄': ['正定古城', '赵州桥', '西柏坡'],
        '北京': ['天安门', '故宫', '长城'],
        '北京市': ['天安门', '故宫', '长城'],
        '上海': ['东方明珠', '外滩', '城隍庙'],
        '上海市': ['东方明珠', '外滩', '城隍庙'],
        '广州': ['广州塔', '陈家祠', '白云山'],
        '广州市': ['广州塔', '陈家祠', '白云山'],
        '深圳': ['世界之窗', '华强北', '大梅沙'],
        '深圳市': ['世界之窗', '华强北', '大梅沙'],
        '杭州': ['西湖', '雷峰塔', '灵隐寺'],
        '杭州市': ['西湖', '雷峰塔', '灵隐寺'],
        '成都': ['宽窄巷子', '武侯祠', '大熊猫基地'],
        '成都市': ['宽窄巷子', '武侯祠', '大熊猫基地'],
        '西安': ['兵马俑', '大雁塔', '钟楼'],
        '西安市': ['兵马俑', '大雁塔', '钟楼'],
        '重庆': ['洪崖洞', '解放碑', '朝天门'],
        '重庆市': ['洪崖洞', '解放碑', '朝天门'],
        '南京': ['中山陵', '夫子庙', '玄武湖'],
        '南京市': ['中山陵', '夫子庙', '玄武湖'],
        '桂林': ['漓江', '象鼻山', '阳朔'],
        '桂林市': ['漓江', '象鼻山', '阳朔']
    }
    return landmarkMap[city] || ['城市地标1', '城市地标2', '城市地标3']
}

/**
 * 获取城市美食（可扩展为数据库查询）
 */
function getCityFoods(city) {
    const foodMap = {
        '石家庄市': ['驴肉火烧', '正定八大碗', '缸炉烧饼'],
        '石家庄': ['驴肉火烧', '正定八大碗', '缸炉烧饼'],
        '北京': ['北京烤鸭', '炸酱面', '豆汁焦圈'],
        '北京市': ['北京烤鸭', '炸酱面', '豆汁焦圈'],
        '上海': ['小笼包', '生煎', '蟹壳黄'],
        '上海市': ['小笼包', '生煎', '蟹壳黄'],
        '广州': ['早茶点心', '肠粉', '白切鸡'],
        '广州市': ['早茶点心', '肠粉', '白切鸡'],
        '深圳': ['潮汕牛肉丸', '肠粉', '烧鹅'],
        '深圳市': ['潮汕牛肉丸', '肠粉', '烧鹅'],
        '杭州': ['东坡肉', '西湖醋鱼', '龙井虾仁'],
        '杭州市': ['东坡肉', '西湖醋鱼', '龙井虾仁'],
        '成都': ['火锅', '担担面', '龙抄手'],
        '成都市': ['火锅', '担担面', '龙抄手'],
        '西安': ['肉夹馍', '羊肉泡馍', '凉皮'],
        '西安市': ['肉夹馍', '羊肉泡馍', '凉皮'],
        '重庆': ['重庆火锅', '重庆小面', '酸辣粉'],
        '重庆市': ['重庆火锅', '重庆小面', '酸辣粉'],
        '南京': ['盐水鸭', '鸭血粉丝汤', '汤包'],
        '南京市': ['盐水鸭', '鸭血粉丝汤', '汤包'],
        '桂林': ['桂林米粉', '啤酒鱼', '油茶'],
        '桂林市': ['桂林米粉', '啤酒鱼', '油茶']
    }
    return foodMap[city] || ['当地特色小吃', '传统美食', '网红小吃']
}

/**
 * 13. 获取明信片列表（支持分页）
 * 同时检测并补生成缺失的缩略图
 */
async function handleGetPostcardList(request, env, ctx) {
    const user = await getUserFromRequest(request, env)
    if (!user) {
        return errorResponse('未登录', 401)
    }

    const url = new URL(request.url)
    const page = parseInt(url.searchParams.get('page')) || 1
    const pageSize = parseInt(url.searchParams.get('pageSize')) || 10

    try {
        const listKey = `postcard_list:${user.openid}`
        const data = await env.KV.get(listKey)
        const allList = data ? JSON.parse(data) : []

        // 计算分页
        const total = allList.length
        const totalPages = Math.ceil(total / pageSize)
        const start = (page - 1) * pageSize
        const end = start + pageSize
        const list = allList.slice(start, end)
        const hasMore = page < totalPages

        // 异步检测并补生成缺失的缩略图（不阻塞响应）
        if (ctx && ctx.waitUntil) {
            ctx.waitUntil(
                checkAndGenerateMissingThumbnails(env, user.openid, allList)
            )
        }

        return jsonResponse({
            list,
            total,
            page,
            pageSize,
            totalPages,
            hasMore
        })
    } catch (err) {
        return errorResponse('获取失败', 500)
    }
}

/**
 * 检测并补生成缺失的缩略图
 * 使用锁机制避免重复生成
 */
async function checkAndGenerateMissingThumbnails(env, openid, postcardList) {
    try {
        // 找出没有缩略图的明信片（排除正在生成中的）
        const missingThumbnails = []

        for (const item of postcardList) {
            if (!item.thumbnail) {
                // 检查是否正在生成中（使用锁机制）
                const lockKey = `thumbnail_lock:${item.id}`
                const isLocked = await env.KV.get(lockKey)

                if (!isLocked) {
                    missingThumbnails.push(item)
                }
            }
        }

        if (missingThumbnails.length === 0) {
            return
        }

        console.log('发现缺失缩略图的明信片:', missingThumbnails.length, '个')

        // 限制每次最多处理 3 个，避免 CPU 超限
        const toProcess = missingThumbnails.slice(0, 3)

        for (const item of toProcess) {
            try {
                // 设置锁，5分钟过期（避免死锁）
                const lockKey = `thumbnail_lock:${item.id}`
                await env.KV.put(lockKey, 'processing', { expirationTtl: 300 })

                // 获取原图并重新生成缩略图
                await regenerateThumbnailFromUrl(env, openid, item)

                // 生成完成后删除锁
                await env.KV.delete(lockKey)
            } catch (err) {
                console.error('补生成缩略图失败:', item.id, err)
                // 失败时也删除锁，允许下次重试
                await env.KV.delete(`thumbnail_lock:${item.id}`)
            }
        }
    } catch (err) {
        console.error('检测缺失缩略图失败:', err)
    }
}

/**
 * 从原图 URL 重新生成缩略图
 */
async function regenerateThumbnailFromUrl(env, openid, postcardItem) {
    const imageUrl = postcardItem.image
    if (!imageUrl) return

    console.log('开始从URL重新生成缩略图:', postcardItem.id)

    // 下载原图
    const response = await fetch(imageUrl)
    if (!response.ok) {
        throw new Error('下载原图失败: ' + response.status)
    }

    const imageBuffer = new Uint8Array(await response.arrayBuffer())

    // 从 URL 提取时间戳，或使用当前时间
    const timestamp = Date.now()
    const thumbnailPath = `postcards/${openid}/${timestamp}_thumb.jpg`

    // 使用 photon 压缩图片
    const inputImage = PhotonImage.new_from_byteslice(imageBuffer)
    const originalWidth = inputImage.get_width()
    const originalHeight = inputImage.get_height()

    const maxWidth = 400
    const ratio = Math.min(1, maxWidth / originalWidth)
    const newWidth = Math.round(originalWidth * ratio)
    const newHeight = Math.round(originalHeight * ratio)

    let jpegBytes
    if (ratio < 1) {
        const resized = resize(inputImage, newWidth, newHeight, SamplingFilter.Lanczos3)
        jpegBytes = resized.get_bytes_jpeg(80)
        resized.free()
    } else {
        jpegBytes = inputImage.get_bytes_jpeg(80)
    }
    inputImage.free()

    // 上传缩略图到 R2
    await env.R2_BUCKET.put(thumbnailPath, jpegBytes, {
        httpMetadata: { contentType: 'image/jpeg' }
    })

    const thumbnailUrl = `https://${env.R2_PUBLIC_DOMAIN || 'r2.smallyoung.cn'}/${thumbnailPath}`

    // 更新 KV 中的明信片详情
    const postcardKey = `postcard:${openid}:${postcardItem.id}`
    const postcardData = await env.KV.get(postcardKey)
    if (postcardData) {
        const postcard = JSON.parse(postcardData)
        postcard.thumbnail = thumbnailUrl
        await env.KV.put(postcardKey, JSON.stringify(postcard))
    }

    // 更新列表中的缩略图
    const listKey = `postcard_list:${openid}`
    const listData = await env.KV.get(listKey)
    if (listData) {
        const list = JSON.parse(listData)
        const item = list.find(p => p.id === postcardItem.id)
        if (item) {
            item.thumbnail = thumbnailUrl
            await env.KV.put(listKey, JSON.stringify(list))
        }
    }

    console.log('缩略图补生成完成:', thumbnailUrl)
}


/**
 * 14. 获取明信片详情
 */
async function handleGetPostcardDetail(request, env) {
    const user = await getUserFromRequest(request, env)
    if (!user) {
        return errorResponse('未登录', 401)
    }

    const url = new URL(request.url)
    const id = url.searchParams.get('id')

    if (!id) {
        return errorResponse('缺少id参数', 400)
    }

    try {
        const data = await env.KV.get(`postcard:${user.openid}:${id}`)
        if (!data) {
            return errorResponse('明信片不存在', 404)
        }

        return jsonResponse(JSON.parse(data))
    } catch (err) {
        return errorResponse('获取失败', 500)
    }
}

/**
 * 15. 删除明信片
 */
async function handleDeletePostcard(request, env) {
    const user = await getUserFromRequest(request, env)
    if (!user) {
        return errorResponse('未登录', 401)
    }

    const url = new URL(request.url)
    const id = url.searchParams.get('id')

    if (!id) {
        return errorResponse('缺少id参数', 400)
    }

    try {
        // 删除明信片详情
        await env.KV.delete(`postcard:${user.openid}:${id}`)

        // 更新明信片列表
        const listKey = `postcard_list:${user.openid}`
        const existingList = await env.KV.get(listKey)
        if (existingList) {
            const postcardList = JSON.parse(existingList)
            const newList = postcardList.filter(item => item.id !== id)
            await env.KV.put(listKey, JSON.stringify(newList))
        }

        return jsonResponse({ id, deleted: true })
    } catch (err) {
        console.error('删除明信片失败:', err)
        return errorResponse('删除失败', 500)
    }
}

/**
 * 16. 图片代理 - 解决微信小程序域名白名单限制
 * 通过 Worker 代理第三方图片，使小程序可以正常显示
 */
async function handleProxyImage(request, env) {
    const url = new URL(request.url)
    const imageUrl = url.searchParams.get('url')

    if (!imageUrl) {
        return errorResponse('缺少 url 参数', 400)
    }

    try {
        // 验证 URL 格式
        let targetUrl
        try {
            targetUrl = new URL(imageUrl)
        } catch (e) {
            return errorResponse('无效的图片 URL', 400)
        }

        // 请求远程图片
        const imageResponse = await fetch(imageUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': targetUrl.origin,
                'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8'
            }
        })

        if (!imageResponse.ok) {
            console.error('图片请求失败:', imageResponse.status, imageUrl)
            return errorResponse('图片请求失败', imageResponse.status)
        }

        // 获取图片内容类型
        const contentType = imageResponse.headers.get('Content-Type') || 'image/jpeg'

        // 返回图片，添加缓存头
        return new Response(imageResponse.body, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=86400', // 缓存1天
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            }
        })
    } catch (err) {
        console.error('图片代理失败:', err)
        return errorResponse('图片代理失败: ' + err.message, 500)
    }
}

/**
 * 17. 上传图片
 */
async function handleUploadImage(request, env) {
    const user = await getUserFromRequest(request, env)
    if (!user) {
        return errorResponse('未登录', 401)
    }

    try {
        const formData = await request.formData()
        const file = formData.get('file')

        if (!file) {
            return errorResponse('缺少文件', 400)
        }

        // TODO: 上传到对象存储(R2或其他)
        // 这里返回模拟URL
        const filename = `image_${Date.now()}.jpg`
        const url = `https://example.com/uploads/${filename}`

        return jsonResponse({
            url,
            filename,
            size: file.size
        })
    } catch (err) {
        return errorResponse('上传失败', 500)
    }
}

// ==================== 主路由 ====================

/**
 * 路由映射
 */
const routes = {
    // 用户相关
    'POST /user/login': handleLogin,

    // 地图相关
    'GET /location/city': handleGetCityByLocation,  // 新增: 根据坐标查询城市

    // 目的地相关
    'GET /destinations/hot': handleGetHotDestinations,

    // 景点相关
    'GET /attractions/nearby': handleGetNearbyAttractions,

    // 行程相关
    'POST /plan/generate': handleGeneratePlan,
    'POST /plan/callback': handlePlanCallback,  // N8N回调接口
    'GET /plan/list': handleGetPlanList,
    'GET /plan/detail': handleGetPlanDetail,
    'DELETE /plan/delete': handleDeletePlan,

    // 明信片相关
    'POST /postcard/generate': handleGeneratePostcard,
    'GET /postcard/list': handleGetPostcardList,
    'GET /postcard/detail': handleGetPostcardDetail,
    'DELETE /postcard/delete': handleDeletePostcard,

    // 文件上传
    'POST /upload/image': handleUploadImage,

    // 图片代理（解决微信小程序域名限制）
    'GET /proxy/image': handleProxyImage
}

/**
 * 主处理函数
 */
export default {
    async fetch(request, env, ctx) {
        // 处理CORS预检请求
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
                }
            })
        }

        try {
            const url = new URL(request.url)
            const path = url.pathname.replace('/api', '') // 移除/api前缀
            const method = request.method
            const routeKey = `${method} ${path}`

            console.log(`[Route Debug] ${method} ${url.pathname} -> routeKey: "${routeKey}"`)

            const handler = routes[routeKey]

            if (handler) {
                return await handler(request, env, ctx)
            }

            console.log(`[Route Debug] No handler found for: "${routeKey}"`)
            return errorResponse('接口不存在', 404)
        } catch (err) {
            console.error('Worker错误:', err)
            return errorResponse('服务器内部错误', 500)
        }
    }
}