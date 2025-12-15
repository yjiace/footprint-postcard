/**
 * 足迹明信片 - EdgeOne 边缘函数 API
 * 
 * 从 Cloudflare Worker 迁移的版本
 * 
 * 环境变量配置:
 * - JWT_SECRET: JWT密钥
 * - WECHAT_APP_ID: 微信小程序AppID
 * - WECHAT_APP_SECRET: 微信小程序AppSecret
 * - AMAP_KEY: 高德地图API密钥
 * - N8N_WORKFLOW_URL: N8N工作流webhook地址
 * - KV: KV命名空间绑定
 * - COS_SECRET_ID: 腾讯云COS SecretId
 * - COS_SECRET_KEY: 腾讯云COS SecretKey
 * - COS_BUCKET: COS存储桶名称 (footprint-postcard-1362392854)
 * - COS_REGION: COS区域
 * - COS_DOMAIN: COS公开访问域名
 */

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

// ==================== COS 存储适配（替代 R2）====================

/**
 * 生成 COS 签名
 */
async function generateCOSSignature(secretId, secretKey, method, path, headers = {}, params = {}) {
    const now = Math.floor(Date.now() / 1000)
    const expireTime = now + 3600

    // 构建签名参数
    const keyTime = `${now};${expireTime}`
    
    const encoder = new TextEncoder()
    
    // 计算 SignKey
    const keyData = encoder.encode(secretKey)
    const keyTimeData = encoder.encode(keyTime)
    const signKeyHmac = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
    const signKeyBuffer = await crypto.subtle.sign('HMAC', signKeyHmac, keyTimeData)
    const signKey = Array.from(new Uint8Array(signKeyBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')

    // 构建 HttpString
    const httpString = `${method.toLowerCase()}\n${path}\n\nhost=${headers.Host || ''}\n`
    
    // 计算 StringToSign
    const httpStringHash = await sha1Hash(httpString)
    const stringToSign = `sha1\n${keyTime}\n${httpStringHash}\n`
    
    // 计算签名
    const signKeyData = encoder.encode(signKey)
    const signKeyHmac2 = await crypto.subtle.importKey('raw', signKeyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
    const signatureBuffer = await crypto.subtle.sign('HMAC', signKeyHmac2, encoder.encode(stringToSign))
    const signature = Array.from(new Uint8Array(signatureBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')

    return `q-sign-algorithm=sha1&q-ak=${secretId}&q-sign-time=${keyTime}&q-key-time=${keyTime}&q-header-list=host&q-url-param-list=&q-signature=${signature}`
}

async function sha1Hash(message) {
    const encoder = new TextEncoder()
    const data = encoder.encode(message)
    const hashBuffer = await crypto.subtle.digest('SHA-1', data)
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 上传文件到 COS
 */
async function uploadToCOS(env, path, data, contentType = 'image/jpeg') {
    const bucket = env.COS_BUCKET || 'footprint-postcard-1362392854'
    const region = env.COS_REGION || 'ap-guangzhou'
    const host = `${bucket}.cos.${region}.myqcloud.com`
    const url = `https://${host}/${path}`

    const signature = await generateCOSSignature(
        env.COS_SECRET_ID,
        env.COS_SECRET_KEY,
        'PUT',
        `/${path}`,
        { Host: host }
    )

    const response = await fetch(url, {
        method: 'PUT',
        headers: {
            'Host': host,
            'Content-Type': contentType,
            'Authorization': signature
        },
        body: data
    })

    if (!response.ok) {
        console.error('COS上传失败:', response.status, await response.text())
        throw new Error('COS上传失败')
    }

    // 返回公开访问 URL
    const publicDomain = env.COS_DOMAIN || `https://${host}`
    return `${publicDomain}/${path}`
}

// ==================== 图片处理（使用数据万象）====================

/**
 * 获取图片缩略图 URL (使用腾讯云数据万象处理)
 * @param {string} originalUrl 原图 URL
 * @param {number} width 目标宽度
 * @param {number} quality JPEG 质量
 */
function getThumbnailUrl(originalUrl, width = 400, quality = 80) {
    // 腾讯云数据万象 URL 参数处理
    // 格式: ?imageMogr2/thumbnail/400x/format/jpg/quality/80
    const separator = originalUrl.includes('?') ? '&' : '?'
    return `${originalUrl}${separator}imageMogr2/thumbnail/${width}x/format/jpg/quality/${quality}`
}

// ==================== 城市映射和地标数据 ====================

const CITY_NAME_MAP = {
    '北京': 'Beijing', '上海': 'Shanghai', '天津': 'Tianjin', '重庆': 'Chongqing',
    '广州': 'Guangzhou', '深圳': 'Shenzhen', '杭州': 'Hangzhou', '南京': 'Nanjing',
    '成都': 'Chengdu', '武汉': 'Wuhan', '西安': 'Xian', '长沙': 'Changsha',
    '郑州': 'Zhengzhou', '济南': 'Jinan', '青岛': 'Qingdao', '大连': 'Dalian',
    '沈阳': 'Shenyang', '哈尔滨': 'Harbin', '长春': 'Changchun', '福州': 'Fuzhou',
    '厦门': 'Xiamen', '南昌': 'Nanchang', '合肥': 'Hefei', '石家庄': 'Shijiazhuang',
    '太原': 'Taiyuan', '昆明': 'Kunming', '贵阳': 'Guiyang', '南宁': 'Nanning',
    '海口': 'Haikou', '三亚': 'Sanya', '拉萨': 'Lhasa', '乌鲁木齐': 'Urumqi',
    '兰州': 'Lanzhou', '西宁': 'Xining', '银川': 'Yinchuan', '呼和浩特': 'Hohhot',
    '桂林': 'Guilin', '丽江': 'Lijiang', '大理': 'Dali', '苏州': 'Suzhou',
    '无锡': 'Wuxi', '扬州': 'Yangzhou', '黄山': 'Huangshan', '张家界': 'Zhangjiajie',
    '九寨沟': 'Jiuzhaigou', '敦煌': 'Dunhuang', '洛阳': 'Luoyang', '开封': 'Kaifeng',
    '香港': 'Hong Kong', '澳门': 'Macau', '台北': 'Taipei', '高雄': 'Kaohsiung'
}

const HOT_DESTINATION_CITIES = [
    { name: '北京', keywords: '故宫', description: '千年古都' },
    { name: '上海', keywords: '外滩', description: '魔都风情' },
    { name: '西安', keywords: '兵马俑', description: '历史名城' },
    { name: '成都', keywords: '大熊猫基地', description: '天府之国' },
    { name: '杭州', keywords: '西湖', description: '人间天堂' },
    { name: '丽江', keywords: '丽江古城', description: '浪漫古镇' },
]

// ==================== 微信登录 ====================

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

async function getCityByLocation(longitude, latitude, env) {
    if (!env.AMAP_KEY) {
        throw new Error('服务配置错误：未配置高德地图API密钥')
    }

    const params = new URLSearchParams({
        location: `${longitude},${latitude}`,
        key: env.AMAP_KEY,
        radius: '1000',
        extensions: 'base',
        output: 'json'
    })
    const url = `https://restapi.amap.com/v3/geocode/regeo?${params.toString()}`

    const response = await fetch(url, {
        headers: { 'Accept': 'application/json' }
    })

    if (!response.ok) {
        throw new Error(`高德API请求失败: ${response.status}`)
    }

    const data = await response.json()
    if (data.status !== '1') {
        throw new Error(data.info || '获取城市信息失败')
    }

    const addressComponent = data.regeocode?.addressComponent
    if (!addressComponent) {
        throw new Error('无法解析地理位置信息')
    }

    return {
        province: addressComponent.province || '',
        city: addressComponent.city || addressComponent.province || '',
        district: addressComponent.district || '',
        township: addressComponent.township || '',
        adcode: addressComponent.adcode || '',
        cityCode: addressComponent.citycode || '',
        formattedAddress: data.regeocode.formatted_address || '',
        location: { longitude, latitude }
    }
}

async function searchNearbyPOI(longitude, latitude, radius, keywords, env, types = '风景名胜|公园广场', page = 1, pageSize = 20) {
    if (!env.AMAP_KEY) {
        throw new Error('服务配置错误：未配置高德地图API密钥')
    }

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
    const url = `https://restapi.amap.com/v3/place/around?${params.toString()}`

    const response = await fetch(url, {
        headers: { 'Accept': 'application/json' }
    })

    if (!response.ok) {
        throw new Error(`高德API请求失败: ${response.status}`)
    }

    const data = await response.json()
    if (data.status !== '1') {
        throw new Error(data.info || '搜索周边POI失败')
    }

    return {
        pois: data.pois || [],
        total: parseInt(data.count) || 0
    }
}

// ==================== 路径规划 ====================

function parsePolyline(polylineStr) {
    if (!polylineStr) return []
    return polylineStr.split(';').map(point => {
        const [lng, lat] = point.split(',')
        return {
            latitude: parseFloat(lat),
            longitude: parseFloat(lng)
        }
    }).filter(p => !isNaN(p.latitude) && !isNaN(p.longitude))
}

async function getRouteDriving(origin, destination, env) {
    if (!env.AMAP_KEY) {
        throw new Error('服务配置错误：未配置高德地图API密钥')
    }

    const params = new URLSearchParams({
        key: env.AMAP_KEY,
        origin: origin,
        destination: destination,
        extensions: 'all',
        strategy: '10',
        output: 'json'
    })

    const url = `https://restapi.amap.com/v3/direction/driving?${params.toString()}`
    const response = await fetch(url, { headers: { 'Accept': 'application/json' } })

    if (!response.ok) {
        throw new Error(`高德API请求失败: ${response.status}`)
    }

    const data = await response.json()
    if (data.status !== '1') {
        throw new Error(data.info || '驾车路径规划失败')
    }

    const route = data.route
    if (!route || !route.paths || route.paths.length === 0) {
        throw new Error('未找到有效路线')
    }

    const path = route.paths[0]
    let allPolyline = []
    const steps = (path.steps || []).map(step => {
        if (step.polyline) {
            allPolyline = allPolyline.concat(parsePolyline(step.polyline))
        }
        return {
            instruction: step.instruction || '',
            road: step.road || '',
            distance: parseInt(step.distance) || 0,
            duration: Math.round((parseInt(step.duration) || 0) / 60),
            action: step.action || ''
        }
    })

    return {
        distance: parseInt(path.distance) || 0,
        duration: Math.round((parseInt(path.duration) || 0) / 60),
        polyline: allPolyline,
        steps: steps,
        strategy: path.strategy || '',
        tolls: parseFloat(path.tolls) || 0,
        trafficLights: parseInt(path.traffic_lights) || 0
    }
}

async function getRouteWalking(origin, destination, env) {
    if (!env.AMAP_KEY) {
        throw new Error('服务配置错误：未配置高德地图API密钥')
    }

    const params = new URLSearchParams({
        key: env.AMAP_KEY,
        origin: origin,
        destination: destination,
        output: 'json'
    })

    const url = `https://restapi.amap.com/v3/direction/walking?${params.toString()}`
    const response = await fetch(url, { headers: { 'Accept': 'application/json' } })

    if (!response.ok) {
        throw new Error(`高德API请求失败: ${response.status}`)
    }

    const data = await response.json()
    if (data.status !== '1') {
        throw new Error(data.info || '步行路径规划失败')
    }

    const route = data.route
    if (!route || !route.paths || route.paths.length === 0) {
        throw new Error('未找到有效路线')
    }

    const path = route.paths[0]
    let allPolyline = []
    const steps = (path.steps || []).map(step => {
        if (step.polyline) {
            allPolyline = allPolyline.concat(parsePolyline(step.polyline))
        }
        return {
            instruction: step.instruction || '',
            road: step.road || '',
            distance: parseInt(step.distance) || 0,
            duration: Math.round((parseInt(step.duration) || 0) / 60),
            action: step.action || ''
        }
    })

    return {
        distance: parseInt(path.distance) || 0,
        duration: Math.round((parseInt(path.duration) || 0) / 60),
        polyline: allPolyline,
        steps: steps
    }
}

async function getRouteTransit(origin, destination, city, env) {
    if (!env.AMAP_KEY) {
        throw new Error('服务配置错误：未配置高德地图API密钥')
    }

    const params = new URLSearchParams({
        key: env.AMAP_KEY,
        origin: origin,
        destination: destination,
        city: city,
        cityd: city,
        strategy: '0',
        output: 'json'
    })

    const url = `https://restapi.amap.com/v3/direction/transit/integrated?${params.toString()}`
    const response = await fetch(url, { headers: { 'Accept': 'application/json' } })

    if (!response.ok) {
        throw new Error(`高德API请求失败: ${response.status}`)
    }

    const data = await response.json()
    if (data.status !== '1') {
        throw new Error(data.info || '公交路径规划失败')
    }

    const route = data.route
    if (!route || !route.transits || route.transits.length === 0) {
        throw new Error('未找到有效公交路线')
    }

    const transit = route.transits[0]
    let allPolyline = []
    const steps = []

    for (const segment of (transit.segments || [])) {
        if (segment.walking && segment.walking.steps) {
            for (const step of segment.walking.steps) {
                if (step.polyline) {
                    allPolyline = allPolyline.concat(parsePolyline(step.polyline))
                }
                steps.push({
                    type: 'walking',
                    instruction: step.instruction || '步行',
                    distance: parseInt(step.distance) || 0,
                    duration: 0
                })
            }
        }

        if (segment.bus && segment.bus.buslines && segment.bus.buslines.length > 0) {
            const busline = segment.bus.buslines[0]
            if (busline.polyline) {
                allPolyline = allPolyline.concat(parsePolyline(busline.polyline))
            }
            steps.push({
                type: 'bus',
                instruction: `乘坐 ${busline.name}`,
                lineName: busline.name,
                departureStop: busline.departure_stop?.name || '',
                arrivalStop: busline.arrival_stop?.name || '',
                viaStops: parseInt(busline.via_num) || 0,
                distance: parseInt(busline.distance) || 0,
                duration: Math.round((parseInt(busline.duration) || 0) / 60)
            })
        }
    }

    return {
        distance: parseInt(transit.distance) || parseInt(route.distance) || 0,
        duration: Math.round((parseInt(transit.duration) || 0) / 60),
        cost: parseFloat(transit.cost) || 0,
        walkingDistance: parseInt(transit.walking_distance) || 0,
        polyline: allPolyline,
        steps: steps
    }
}

// ==================== API 处理函数 ====================

async function handleLogin(request, env) {
    const body = await request.json()
    const { code } = body

    if (!code) {
        return errorResponse('缺少code参数', 400)
    }

    try {
        const { openid, sessionKey } = await wechatLogin(code, env)
        const token = await generateToken({ openid }, env.JWT_SECRET)

        await env.KV.put(`user:${openid}`, JSON.stringify({
            openid,
            sessionKey,
            createdAt: Date.now()
        }))

        return jsonResponse({ token, openid, sessionKey })
    } catch (err) {
        return errorResponse(err.message, 500)
    }
}

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

async function handleGetHotDestinations(request, env) {
    const cached = await env.KV.get('hot_destinations')
    if (cached) {
        return jsonResponse(JSON.parse(cached))
    }

    const destinations = HOT_DESTINATION_CITIES.map((city, index) => ({
        id: index + 1,
        name: city.name,
        image: `https://picsum.photos/seed/${city.name}/800/400`,
        description: city.description,
        landmark: city.keywords
    }))

    await env.KV.put('hot_destinations', JSON.stringify(destinations), { expirationTtl: 604800 })
    return jsonResponse(destinations)
}

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
        const attractions = result.pois.map((poi, index) => {
            const location = poi.location ? poi.location.split(',') : ['0', '0']
            return {
                id: poi.id || String(index + 1),
                name: poi.name || '未知景点',
                image: poi.photos && poi.photos.length > 0 ? poi.photos[0].url : 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=400',
                tags: poi.type || '景点',
                distance: poi.distance ? `${(poi.distance / 1000).toFixed(1)}km` : '未知',
                address: poi.address || '',
                rating: (poi.biz_ext && poi.biz_ext.rating) ? poi.biz_ext.rating : null,
                latitude: parseFloat(location[1]) || 0,
                longitude: parseFloat(location[0]) || 0
            }
        })

        return jsonResponse({
            list: attractions,
            total: result.total,
            page: page,
            pageSize: pageSize,
            hasMore: attractions.length >= pageSize
        })
    } catch (err) {
        return errorResponse(err.message, 500)
    }
}

async function handleRouteDriving(request, env) {
    const url = new URL(request.url)
    const origin = url.searchParams.get('origin')
    const destination = url.searchParams.get('destination')

    if (!origin || !destination) {
        return errorResponse('缺少 origin 或 destination 参数', 400)
    }

    try {
        const result = await getRouteDriving(origin, destination, env)
        return jsonResponse(result)
    } catch (err) {
        return errorResponse(err.message, 500)
    }
}

async function handleRouteWalking(request, env) {
    const url = new URL(request.url)
    const origin = url.searchParams.get('origin')
    const destination = url.searchParams.get('destination')

    if (!origin || !destination) {
        return errorResponse('缺少 origin 或 destination 参数', 400)
    }

    try {
        const result = await getRouteWalking(origin, destination, env)
        return jsonResponse(result)
    } catch (err) {
        return errorResponse(err.message, 500)
    }
}

async function handleRouteTransit(request, env) {
    const url = new URL(request.url)
    const origin = url.searchParams.get('origin')
    const destination = url.searchParams.get('destination')
    const city = url.searchParams.get('city')

    if (!origin || !destination) {
        return errorResponse('缺少 origin 或 destination 参数', 400)
    }

    if (!city) {
        return errorResponse('公交路径规划需要 city 参数', 400)
    }

    try {
        const result = await getRouteTransit(origin, destination, city, env)
        return jsonResponse(result)
    } catch (err) {
        return errorResponse(err.message, 500)
    }
}

// ==================== 行程相关处理函数 ====================

async function handleGeneratePlan(request, env) {
    const user = await getUserFromRequest(request, env)
    if (!user) {
        return errorResponse('未登录', 401)
    }

    const body = await request.json()
    const { city, date, days, poiTypes, notes, transportation, accommodation, apiVersion, userLocation } = body

    if (!city || !date || !days) {
        return errorResponse('缺少必要参数', 400)
    }

    if (!env.N8N_WORKFLOW_URL) {
        return errorResponse('服务配置错误：未配置N8N工作流地址', 500)
    }

    const startDate = new Date(date)
    const endDate = new Date(startDate)
    endDate.setDate(endDate.getDate() + days - 1)
    const endDateStr = endDate.toISOString().split('T')[0]

    const planId = generateId('plan_')

    const preferenceMap = {
        'any': '不限', 'nature': '自然风光', 'history': '历史古迹',
        'museum': '博物馆', 'amusement': '游乐园', 'food': '美食探店'
    }
    const translatedPoiTypes = (poiTypes || []).filter(type => type !== 'any').map(type => preferenceMap[type] || type)

    const transportMap = { 'public': '公共交通', 'drive': '自驾', 'walk': '步行为主' }
    const translatedTransport = transportMap[transportation] || transportation || '公共交通'

    const accommodationMap = { 'budget': '经济型酒店', 'comfort': '舒适型酒店', 'luxury': '豪华型酒店' }
    const translatedAccommodation = accommodationMap[accommodation] || accommodation || '经济型酒店'

    const pendingPlan = {
        id: planId,
        openid: user.openid,
        city: city,
        date: date,
        endDate: endDateStr,
        days: days,
        transportation: translatedTransport,
        accommodation: translatedAccommodation,
        poiTypes: translatedPoiTypes,
        notes: notes,
        apiVersion: apiVersion || null,
        status: 'generating',
        statusMessage: '正在生成行程，请稍候...',
        schedule: [],
        weatherInfo: [],
        budget: {},
        overallSuggestions: '',
        routeInfo: [],
        routeSummary: null,
        userLocation: userLocation || null,
        createdAt: Date.now()
    }

    try {
        await env.KV.put(`plan:${user.openid}:${planId}`, JSON.stringify(pendingPlan))

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
            transportation: translatedTransport,
            accommodation: translatedAccommodation,
            poiTypes: translatedPoiTypes,
            createdAt: pendingPlan.createdAt
        })
        await env.KV.put(listKey, JSON.stringify(planList))

        const preferences = translatedPoiTypes.length > 0 ? translatedPoiTypes : ['休闲']
        const callbackUrl = new URL(request.url)
        callbackUrl.pathname = '/api/plan/callback'

        const n8nRequest = {
            city: city,
            start_date: date,
            end_date: endDateStr,
            travel_days: days,
            transportation: transportation || '公共交通',
            accommodation: accommodation || '经济型酒店',
            preferences: preferences,
            free_text_input: notes || '',
            user_location: userLocation || null,
            callback: {
                url: callbackUrl.toString(),
                planId: planId,
                openid: user.openid
            }
        }

        let n8nWorkflowUrl = env.N8N_WORKFLOW_URL
        if (apiVersion) {
            n8nWorkflowUrl = n8nWorkflowUrl.replace(/\/$/, '') + '/' + apiVersion
        }

        // EdgeOne 使用 FetchEvent.waitUntil
        fetch(n8nWorkflowUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(n8nRequest)
        }).catch(err => console.error('N8N请求失败:', err))

        return jsonResponse(pendingPlan)

    } catch (err) {
        return errorResponse('创建行程失败: ' + err.message, 500)
    }
}

async function handlePlanCallback(request, env) {
    try {
        const body = await request.json()
        const { planId, openid, success, data, message } = body

        if (!planId || !openid) {
            return errorResponse('缺少必要参数', 400)
        }

        if (!success) {
            await updatePlanStatus(env, openid, planId, 'failed', message || 'AI生成失败')
            return jsonResponse({ received: true, status: 'failed' })
        }

        const planKey = `plan:${openid}:${planId}`
        const existingData = await env.KV.get(planKey)

        if (!existingData) {
            return errorResponse('行程不存在', 404)
        }

        const existingPlan = JSON.parse(existingData)
        const tripPlan = data

        const completedPlan = {
            ...existingPlan,
            city: tripPlan.city || existingPlan.city,
            date: tripPlan.start_date || existingPlan.date,
            endDate: tripPlan.end_date || existingPlan.endDate,
            status: 'completed',
            statusMessage: '',
            schedule: tripPlan.days || [],
            weatherInfo: tripPlan.weather_info || [],
            budget: tripPlan.budget || {},
            overallSuggestions: tripPlan.overall_suggestions || '',
            routeInfo: tripPlan.route_info || body.route_info || [],
            routeSummary: tripPlan.route_summary || body.summary || null,
            completedAt: Date.now()
        }

        await env.KV.put(planKey, JSON.stringify(completedPlan))
        await updatePlanListStatus(env, openid, planId, 'completed')

        return jsonResponse({ received: true, status: 'completed' })

    } catch (err) {
        return errorResponse('回调处理失败: ' + err.message, 500)
    }
}

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
        await updatePlanListStatus(env, openid, planId, status)
    } catch (err) {
        console.error('更新行程状态失败:', err)
    }
}

async function updatePlanListStatus(env, openid, planId, status, extraInfo = null) {
    try {
        const listKey = `plan_list:${openid}`
        const listData = await env.KV.get(listKey)
        if (listData) {
            const planList = JSON.parse(listData)
            const item = planList.find(p => p.id === planId)
            if (item) {
                item.status = status
                if (extraInfo && typeof extraInfo === 'object') {
                    Object.assign(item, extraInfo)
                }
                await env.KV.put(listKey, JSON.stringify(planList))
            }
        }
    } catch (err) {
        console.error('更新行程列表状态失败:', err)
    }
}

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

        const total = allList.length
        const totalPages = Math.ceil(total / pageSize)
        const start = (page - 1) * pageSize
        const list = allList.slice(start, start + pageSize)

        return jsonResponse({
            list,
            total,
            page,
            pageSize,
            totalPages,
            hasMore: page < totalPages
        })
    } catch (err) {
        return errorResponse('获取失败', 500)
    }
}

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
        await env.KV.delete(`plan:${user.openid}:${id}`)

        const listKey = `plan_list:${user.openid}`
        const existingList = await env.KV.get(listKey)
        if (existingList) {
            const planList = JSON.parse(existingList)
            const newList = planList.filter(item => item.id !== id)
            await env.KV.put(listKey, JSON.stringify(newList))
        }

        return jsonResponse({ id, deleted: true })
    } catch (err) {
        return errorResponse('删除失败', 500)
    }
}

// ==================== 明信片相关处理函数 ====================

const POSTCARD_WHITELIST = ['orBRy14EIyMRaE6VgyAsGd3nYmMY']
const DAILY_POSTCARD_LIMIT = 3

async function handleGeneratePostcard(request, env) {
    const user = await getUserFromRequest(request, env)
    if (!user) {
        return errorResponse('未登录', 401)
    }

    const body = await request.json()
    const { planId } = body

    if (!planId) {
        return errorResponse('缺少行程ID参数', 400)
    }

    const isWhitelisted = POSTCARD_WHITELIST.includes(user.openid)

    if (!isWhitelisted) {
        const today = new Date().toISOString().split('T')[0]
        const countKey = `postcard_count:${user.openid}:${today}`
        const countStr = await env.KV.get(countKey)
        const currentCount = countStr ? parseInt(countStr, 10) : 0

        if (currentCount >= DAILY_POSTCARD_LIMIT) {
            return errorResponse(`今日生成次数已达上限（每天最多${DAILY_POSTCARD_LIMIT}次）`, 429)
        }

        await env.KV.put(countKey, String(currentCount + 1), { expirationTtl: 86400 })
    }

    if (!env.KUAI_API_KEY) {
        return errorResponse('服务配置错误：未配置KUAI_API_KEY', 500)
    }

    try {
        const planData = await env.KV.get(`plan:${user.openid}:${planId}`)
        if (!planData) {
            return errorResponse('行程不存在', 404)
        }
        const plan = JSON.parse(planData)

        const prompt = buildPostcardPrompt(plan)
        const kuaiApiBase = env.KUAI_API_BASE || 'https://api.kuai.host'
        const modelName = env.KUAI_MODEL || 'gemini-3-pro-image-preview'
        const apiUrl = `${kuaiApiBase}/v1beta/models/${modelName}:generateContent`

        const imageResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${env.KUAI_API_KEY}`
            },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: {
                    responseModalities: ['TEXT', 'IMAGE'],
                    imageConfig: { aspectRatio: '3:4', imageSize: '2K' }
                }
            })
        })

        if (!imageResponse.ok) {
            return errorResponse('AI生成图片失败', 500)
        }

        const imageResult = await imageResponse.json()
        let imageUrl = null
        let imageData = null

        if (imageResult.candidates && imageResult.candidates[0]) {
            const parts = imageResult.candidates[0].content?.parts
            if (parts && Array.isArray(parts)) {
                for (const part of parts) {
                    if (part.inlineData?.data) {
                        imageData = part.inlineData.data
                        break
                    }
                    if (part.inline_data?.data) {
                        imageData = part.inline_data.data
                        break
                    }
                }
            }
        }

        const timestamp = Date.now()
        const postcardId = generateId('postcard_')

        if (imageData && env.COS_SECRET_ID) {
            const originalPath = `postcards/${user.openid}/${timestamp}.png`
            const imageBuffer = Uint8Array.from(atob(imageData), c => c.charCodeAt(0))
            imageUrl = await uploadToCOS(env, originalPath, imageBuffer, 'image/png')
        }

        if (!imageUrl) {
            imageUrl = 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600'
        }

        // 使用数据万象生成缩略图 URL
        const thumbnailUrl = getThumbnailUrl(imageUrl, 400, 80)

        const postcard = {
            id: postcardId,
            planId: planId,
            title: `${plan.city}之旅`,
            image: imageUrl,
            thumbnail: thumbnailUrl,
            city: plan.city,
            date: plan.date,
            endDate: plan.endDate,
            days: plan.days,
            description: `${plan.city} ${plan.days}天${plan.days - 1}晚精彩旅程`,
            createdAt: Date.now()
        }

        await env.KV.put(`postcard:${user.openid}:${postcardId}`, JSON.stringify(postcard))

        const listKey = `postcard_list:${user.openid}`
        const existingList = await env.KV.get(listKey)
        const postcardList = existingList ? JSON.parse(existingList) : []
        postcardList.unshift({
            id: postcardId,
            title: postcard.title,
            image: postcard.image,
            thumbnail: thumbnailUrl,
            city: postcard.city,
            date: postcard.date,
            createdAt: postcard.createdAt
        })
        await env.KV.put(listKey, JSON.stringify(postcardList))

        return jsonResponse(postcard)
    } catch (err) {
        return errorResponse('生成明信片失败: ' + err.message, 500)
    }
}

function buildPostcardPrompt(plan) {
    const city = plan.city || '未知城市'
    const days = plan.days || 1
    return `请绘制一张色彩鲜艳、竖版（3:4）手绘风格的《${city}旅行明信片》。请直接生成图片。`
}

async function handleGetPostcardList(request, env) {
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

        const total = allList.length
        const totalPages = Math.ceil(total / pageSize)
        const start = (page - 1) * pageSize
        const list = allList.slice(start, start + pageSize)

        return jsonResponse({
            list,
            total,
            page,
            pageSize,
            totalPages,
            hasMore: page < totalPages
        })
    } catch (err) {
        return errorResponse('获取失败', 500)
    }
}

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
        await env.KV.delete(`postcard:${user.openid}:${id}`)

        const listKey = `postcard_list:${user.openid}`
        const existingList = await env.KV.get(listKey)
        if (existingList) {
            const postcardList = JSON.parse(existingList)
            const newList = postcardList.filter(item => item.id !== id)
            await env.KV.put(listKey, JSON.stringify(newList))
        }

        return jsonResponse({ id, deleted: true })
    } catch (err) {
        return errorResponse('删除失败', 500)
    }
}

// ==================== 图片代理 ====================

async function handleProxyImage(request) {
    const url = new URL(request.url)
    const imageUrl = url.searchParams.get('url')

    if (!imageUrl) {
        return errorResponse('缺少 url 参数', 400)
    }

    try {
        const targetUrl = new URL(imageUrl)
        const imageResponse = await fetch(imageUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': targetUrl.origin
            }
        })

        if (!imageResponse.ok) {
            return errorResponse('获取图片失败', imageResponse.status)
        }

        const contentType = imageResponse.headers.get('content-type') || 'image/jpeg'
        const imageData = await imageResponse.arrayBuffer()

        return new Response(imageData, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=86400',
                'Access-Control-Allow-Origin': '*'
            }
        })
    } catch (err) {
        return errorResponse('图片代理失败', 500)
    }
}

// ==================== 路由映射 ====================

const routes = {
    'POST /user/login': handleLogin,
    'GET /location/city': handleGetCityByLocation,
    'GET /destinations/hot': handleGetHotDestinations,
    'GET /attractions/nearby': handleGetNearbyAttractions,
    'GET /route/driving': handleRouteDriving,
    'GET /route/walking': handleRouteWalking,
    'GET /route/transit': handleRouteTransit,
    'POST /plan/generate': handleGeneratePlan,
    'POST /plan/callback': handlePlanCallback,
    'GET /plan/list': handleGetPlanList,
    'GET /plan/detail': handleGetPlanDetail,
    'DELETE /plan/delete': handleDeletePlan,
    'POST /postcard/generate': handleGeneratePostcard,
    'GET /postcard/list': handleGetPostcardList,
    'GET /postcard/detail': handleGetPostcardDetail,
    'DELETE /postcard/delete': handleDeletePostcard,
    'GET /proxy/image': handleProxyImage
}

// ==================== EdgeOne 主入口 ====================

addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request, event))
})

async function handleRequest(request, event) {
    // 处理 CORS 预检请求
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
        const path = url.pathname.replace('/api', '')
        const method = request.method
        const routeKey = `${method} ${path}`

        // 获取环境变量 (EdgeOne 通过 event 获取)
        const env = {
            JWT_SECRET: JWT_SECRET,
            WECHAT_APP_ID: WECHAT_APP_ID,
            WECHAT_APP_SECRET: WECHAT_APP_SECRET,
            AMAP_KEY: AMAP_KEY,
            N8N_WORKFLOW_URL: N8N_WORKFLOW_URL,
            KV: KV,
            COS_SECRET_ID: COS_SECRET_ID,
            COS_SECRET_KEY: COS_SECRET_KEY,
            COS_BUCKET: COS_BUCKET || 'footprint-postcard-1362392854',
            COS_REGION: COS_REGION || 'ap-guangzhou',
            COS_DOMAIN: COS_DOMAIN,
            KUAI_API_KEY: KUAI_API_KEY,
            KUAI_API_BASE: KUAI_API_BASE,
            KUAI_MODEL: KUAI_MODEL,
            UNSPLASH_ACCESS_KEY: UNSPLASH_ACCESS_KEY
        }

        const handler = routes[routeKey]

        if (handler) {
            return await handler(request, env, event)
        }

        return errorResponse('接口不存在', 404)
    } catch (err) {
        console.error('Worker错误:', err)
        return errorResponse('服务器内部错误', 500)
    }
}
