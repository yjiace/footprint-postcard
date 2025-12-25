/**
 * EdgeOne Pages Functions - 捕获所有 /api/* 请求
 * 
 * 文件位置：functions/api/[[path]].js
 * 
 * 环境变量在 EdgeOne Pages 控制台配置
 */

// ==================== 工具函数 ====================

async function generateToken(payload, secret) {
    const header = { alg: 'HS256', typ: 'JWT' }
    const encodedHeader = btoa(JSON.stringify(header))
    const encodedPayload = btoa(JSON.stringify(payload))

    const data = `${encodedHeader}.${encodedPayload}`
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
        'raw', encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    )

    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
    const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
    return `${data}.${encodedSignature}`
}

// 统一的中国城市中英文映射表
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
    '泰安': 'Taian', '威海': 'Weihai', '烟台': 'Yantai', '秦皇岛': 'Qinhuangdao',
    '珠海': 'Zhuhai', '汕头': 'Shantou', '佛山': 'Foshan', '东莞': 'Dongguan',
    '宁波': 'Ningbo', '温州': 'Wenzhou', '绍兴': 'Shaoxing', '嘉兴': 'Jiaxing',
    '香港': 'Hong Kong', '澳门': 'Macau', '台北': 'Taipei', '高雄': 'Kaohsiung'
}

// 路段颜色配置
const SEGMENT_COLORS = [
    '#8b5cf6', '#10b981', '#f59e0b', '#ef4444',
    '#6366f1', '#ec4899', '#14b8a6', '#f97316'
]

async function verifyToken(token, secret) {
    try {
        const [encodedHeader, encodedPayload, encodedSignature] = token.split('.')
        const data = `${encodedHeader}.${encodedPayload}`
        const encoder = new TextEncoder()
        const key = await crypto.subtle.importKey(
            'raw', encoder.encode(secret),
            { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
        )
        const signature = Uint8Array.from(atob(encodedSignature), c => c.charCodeAt(0))
        const isValid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(data))
        if (!isValid) return null
        return JSON.parse(atob(encodedPayload))
    } catch { return null }
}

function jsonResponse(data, code = 200, message = 'success') {
    return new Response(JSON.stringify({ code, message, data }), {
        status: code >= 400 ? code : 200,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
    })
}

function errorResponse(message, code = 400) {
    return jsonResponse(null, code, message)
}

function generateId(prefix = '') {
    return `${prefix}${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

async function getUserFromRequest(request, env) {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) return null
    return await verifyToken(authHeader.substring(7), env.JWT_SECRET)
}

// ==================== COS 存储 ====================

async function sha1Hash(message) {
    const data = new TextEncoder().encode(message)
    const hashBuffer = await crypto.subtle.digest('SHA-1', data)
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function uploadToCOS(env, path, data, contentType = 'image/jpeg') {
    const bucket = env.COS_BUCKET || 'footprint-postcard-1362392854'
    const region = env.COS_REGION || 'ap-guangzhou'
    const host = `${bucket}.cos.${region}.myqcloud.com`

    const now = Math.floor(Date.now() / 1000)
    const keyTime = `${now};${now + 3600}`
    const encoder = new TextEncoder()

    // 简化签名
    const signKeyHmac = await crypto.subtle.importKey('raw', encoder.encode(env.COS_SECRET_KEY), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
    const signKeyBuffer = await crypto.subtle.sign('HMAC', signKeyHmac, encoder.encode(keyTime))
    const signKey = Array.from(new Uint8Array(signKeyBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')

    const httpString = `put\n/${path}\n\nhost=${host}\n`
    const httpStringHash = await sha1Hash(httpString)
    const stringToSign = `sha1\n${keyTime}\n${httpStringHash}\n`

    const signKeyHmac2 = await crypto.subtle.importKey('raw', encoder.encode(signKey), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
    const signatureBuffer = await crypto.subtle.sign('HMAC', signKeyHmac2, encoder.encode(stringToSign))
    const signature = Array.from(new Uint8Array(signatureBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')

    const authorization = `q-sign-algorithm=sha1&q-ak=${env.COS_SECRET_ID}&q-sign-time=${keyTime}&q-key-time=${keyTime}&q-header-list=host&q-url-param-list=&q-signature=${signature}`

    const response = await fetch(`https://${host}/${path}`, {
        method: 'PUT',
        headers: { 'Host': host, 'Content-Type': contentType, 'Authorization': authorization },
        body: data
    })

    if (!response.ok) throw new Error('COS上传失败')

    // 修复：检查 COS_DOMAIN 是否已包含协议
    let publicUrl
    if (env.COS_DOMAIN) {
        // 如果已经包含协议（http:// 或 https://），直接使用
        if (env.COS_DOMAIN.startsWith('http://') || env.COS_DOMAIN.startsWith('https://')) {
            publicUrl = `${env.COS_DOMAIN}/${path}`
        } else {
            // 否则添加 https://
            publicUrl = `https://${env.COS_DOMAIN}/${path}`
        }
    } else {
        // 使用默认的 COS host
        publicUrl = `https://${host}/${path}`
    }

    return publicUrl
}

function getThumbnailUrl(url, width = 400, quality = 80) {
    const sep = url.includes('?') ? '&' : '?'
    return `${url}${sep}imageMogr2/thumbnail/${width}x/format/jpg/quality/${quality}`
}

// ==================== 数据常量 ====================

const HOT_CITIES = [
    { name: '北京', keywords: '故宫', description: '千年古都' },
    { name: '上海', keywords: '外滩', description: '魔都风情' },
    { name: '西安', keywords: '兵马俑', description: '历史名城' },
    { name: '成都', keywords: '大熊猫基地', description: '天府之国' },
    { name: '杭州', keywords: '西湖', description: '人间天堂' },
    { name: '丽江', keywords: '丽江古城', description: '浪漫古镇' },
]

// ==================== 微信和高德 API ====================

async function wechatLogin(code, env) {
    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${env.WECHAT_APP_ID}&secret=${env.WECHAT_APP_SECRET}&js_code=${code}&grant_type=authorization_code`
    const res = await fetch(url)
    const data = await res.json()
    if (data.errcode) throw new Error(data.errmsg || '微信登录失败')
    return { openid: data.openid, sessionKey: data.session_key }
}

async function getCityByLocation(lng, lat, env) {
    const url = `https://restapi.amap.com/v3/geocode/regeo?location=${lng},${lat}&key=${env.AMAP_KEY}&extensions=base&output=json`
    const res = await fetch(url)
    const data = await res.json()
    if (data.status !== '1') throw new Error(data.info || '获取城市失败')
    const addr = data.regeocode?.addressComponent
    return {
        province: addr?.province || '',
        city: addr?.city || addr?.province || '',
        district: addr?.district || '',
        formattedAddress: data.regeocode?.formatted_address || '',
        location: { longitude: lng, latitude: lat }
    }
}

async function searchNearbyPOI(lng, lat, radius, keywords, env, types = '风景名胜|公园广场', page = 1, pageSize = 20) {
    const params = new URLSearchParams({
        location: `${lng},${lat}`, keywords, types, radius: String(radius),
        offset: String(pageSize), page: String(page), key: env.AMAP_KEY, extensions: 'all', output: 'json'
    })
    const res = await fetch(`https://restapi.amap.com/v3/place/around?${params}`)
    const data = await res.json()
    if (data.status !== '1') throw new Error(data.info || 'POI搜索失败')
    return { pois: data.pois || [], total: parseInt(data.count) || 0 }
}

async function downloadAndSaveCityImage(city, planId, env) {
    try {
        // 1. 获取图片 URL
        let imageUrl = await searchCityImage(city, env)
        if (!imageUrl) {
            // 回退到 Picsum
            imageUrl = `https://picsum.photos/seed/${encodeURIComponent(city)}/800/600`
        }

        // 2. 下载图片
        const res = await fetch(imageUrl)
        if (!res.ok) throw new Error('图片下载失败')
        const buffer = await res.arrayBuffer()

        // 3. 上传到 COS
        // path: city-covers/{planId}_{timestamp}.jpg
        const timestamp = Date.now()
        const path = `city-covers/${planId}_${timestamp}.jpg`

        // uploadToCOS 参数: env, path, data, contentType
        const cosUrl = await uploadToCOS(env, path, buffer, 'image/jpeg')
        return cosUrl
    } catch (err) {
        console.error('下载保存城市图片失败:', err)
        // 失败返回 Picsum URL 作为兜底
        return `https://picsum.photos/seed/${encodeURIComponent(city)}/800/600`
    }
}

async function searchCityLandmark(city, keywords, env) {
    if (!env.AMAP_KEY) return null
    try {
        const params = new URLSearchParams({
            key: env.AMAP_KEY, keywords, city, citylimit: 'true', types: '风景名胜',
            offset: '1', page: '1', extensions: 'base', output: 'json'
        })
        const res = await fetch(`https://restapi.amap.com/v3/place/text?${params}`)
        const data = await res.json()
        if (data.status !== '1' || !data.pois?.length) return null
        const poi = data.pois[0]
        const loc = poi.location ? poi.location.split(',') : null
        return {
            poiName: poi.name, address: poi.address || '',
            latitude: loc ? parseFloat(loc[1]) : null, longitude: loc ? parseFloat(loc[0]) : null
        }
    } catch { return null }
}

async function searchCityImage(city, env) {
    if (!env.UNSPLASH_ACCESS_KEY) return null
    try {
        const englishName = CITY_NAME_MAP[city] || city
        const query = `${englishName} city landmark skyline`
        const res = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=3&orientation=landscape`, {
            headers: { 'Authorization': `Client-ID ${env.UNSPLASH_ACCESS_KEY}`, 'Accept-Version': 'v1' }
        })
        if (!res.ok) return null
        const data = await res.json()
        if (!data.results?.length) return null
        return data.results[Math.floor(Math.random() * Math.min(3, data.results.length))].urls.small
    } catch { return null }
}

function parsePolyline(str) {
    if (!str) return []
    return str.split(';').map(p => {
        const [lng, lat] = p.split(',')
        return { latitude: parseFloat(lat), longitude: parseFloat(lng) }
    }).filter(p => !isNaN(p.latitude))
}

async function getRouteDriving(origin, destination, env) {
    const params = new URLSearchParams({ key: env.AMAP_KEY, origin, destination, extensions: 'all', strategy: '10', output: 'json' })
    const res = await fetch(`https://restapi.amap.com/v3/direction/driving?${params}`)
    const data = await res.json()
    if (data.status !== '1' || !data.route?.paths?.length) throw new Error('路径规划失败')
    const path = data.route.paths[0]
    let polyline = []
    const steps = (path.steps || []).map(s => {
        if (s.polyline) polyline = polyline.concat(parsePolyline(s.polyline))
        return { instruction: s.instruction || '', distance: parseInt(s.distance) || 0, duration: Math.round((parseInt(s.duration) || 0) / 60) }
    })
    return { distance: parseInt(path.distance) || 0, duration: Math.round((parseInt(path.duration) || 0) / 60), polyline, steps }
}

async function getRouteWalking(origin, destination, env) {
    const params = new URLSearchParams({ key: env.AMAP_KEY, origin, destination, output: 'json' })
    const res = await fetch(`https://restapi.amap.com/v3/direction/walking?${params}`)
    const data = await res.json()
    if (data.status !== '1' || !data.route?.paths?.length) throw new Error('步行路径规划失败')
    const path = data.route.paths[0]
    let polyline = []
    const steps = (path.steps || []).map(s => {
        if (s.polyline) polyline = polyline.concat(parsePolyline(s.polyline))
        return { instruction: s.instruction || '', distance: parseInt(s.distance) || 0, duration: Math.round((parseInt(s.duration) || 0) / 60) }
    })
    return { distance: parseInt(path.distance) || 0, duration: Math.round((parseInt(path.duration) || 0) / 60), polyline, steps }
}

async function getRouteTransit(origin, destination, city, env) {
    const params = new URLSearchParams({ key: env.AMAP_KEY, origin, destination, city, cityd: city, strategy: '0', output: 'json' })
    const url = `https://restapi.amap.com/v3/direction/transit/integrated?${params}`

    console.log('[公交路径] 请求参数:', { origin, destination, city })

    const res = await fetch(url)
    const data = await res.json()

    console.log('[公交路径] 高德API响应status:', data.status)
    console.log('[公交路径] 高德API响应info:', data.info)

    if (data.status !== '1') {
        console.error('[公交路径] 高德API错误:', data.info || data.infocode)
        throw new Error(`公交路径规划失败: ${data.info || '高德API返回错误'}`)
    }

    if (!data.route?.transits?.length) {
        console.error('[公交路径] 无可用公交方案')
        throw new Error('公交路径规划失败: 无可用公交方案')
    }

    const transit = data.route.transits[0]
    let polyline = []
    const steps = []
    for (const seg of (transit.segments || [])) {
        if (seg.walking?.steps) {
            for (const s of seg.walking.steps) {
                if (s.polyline) polyline = polyline.concat(parsePolyline(s.polyline))
                steps.push({ type: 'walking', instruction: s.instruction || '步行', distance: parseInt(s.distance) || 0 })
            }
        }
        if (seg.bus?.buslines?.[0]) {
            const bus = seg.bus.buslines[0]
            if (bus.polyline) polyline = polyline.concat(parsePolyline(bus.polyline))
            steps.push({ type: 'bus', instruction: `乘坐 ${bus.name}`, lineName: bus.name, distance: parseInt(bus.distance) || 0, duration: Math.round((parseInt(bus.duration) || 0) / 60) })
        }
        // 处理火车/高铁段
        if (seg.railway) {
            if (seg.railway.polyline) polyline = polyline.concat(parsePolyline(seg.railway.polyline))
            steps.push({ type: 'railway', instruction: `乘坐 ${seg.railway.name || '火车'}`, lineName: seg.railway.name, distance: parseInt(seg.railway.distance) || 0, duration: Math.round((parseInt(seg.railway.time) || 0) / 60) })
        }
    }
    return { distance: parseInt(transit.distance) || 0, duration: Math.round((parseInt(transit.duration) || 0) / 60), polyline, steps }
}

// ==================== API 处理函数 ====================

async function handleLogin(request, env) {
    const { code } = await request.json()
    if (!code) return errorResponse('缺少code参数', 400)
    try {
        const { openid, sessionKey } = await wechatLogin(code, env)
        const token = await generateToken({ openid }, env.JWT_SECRET)
        await KV.put(`user:${openid}`, JSON.stringify({ openid, sessionKey, createdAt: Date.now() }))
        return jsonResponse({ token, openid, sessionKey })
    } catch (err) { return errorResponse(err.message, 500) }
}

async function handleGetCityByLocation(request, env) {
    const url = new URL(request.url)
    const lat = parseFloat(url.searchParams.get('latitude'))
    const lng = parseFloat(url.searchParams.get('longitude'))
    if (!lat || !lng) return errorResponse('缺少经纬度参数', 400)
    try {
        return jsonResponse(await getCityByLocation(lng, lat, env))
    } catch (err) { return errorResponse(err.message, 500) }
}

async function handleGetHotDestinations(request, env) {
    try {
        if (typeof KV === 'undefined') return errorResponse('KV未配置', 500)

        const cached = await KV.get('hot_destinations')
        if (cached) return jsonResponse(JSON.parse(cached))

        const destinationPromises = HOT_CITIES.map(async (c, i) => {
            const [landmark, imageUrl] = await Promise.all([
                searchCityLandmark(c.name, c.keywords, env),
                searchCityImage(c.name, env)
            ])
            return {
                id: i + 1, name: c.name,
                image: imageUrl || `https://picsum.photos/seed/${c.name}/800/400`,
                description: c.description,
                landmark: landmark ? landmark.poiName : c.keywords,
                latitude: landmark ? landmark.latitude : null,
                longitude: landmark ? landmark.longitude : null
            }
        })

        const destinations = await Promise.all(destinationPromises)
        await KV.put('hot_destinations', JSON.stringify(destinations), { expirationTtl: 604800 })
        return jsonResponse(destinations)
    } catch (err) {
        // 降级策略
        console.error('获取热门目的地失败:', err)
        const fallback = HOT_CITIES.map((c, i) => ({
            id: i + 1, name: c.name, image: `https://picsum.photos/seed/${c.name}/800/400`,
            description: c.description, landmark: c.keywords
        }))
        return jsonResponse(fallback)
    }
}

async function handleGetNearbyAttractions(request, env) {
    const url = new URL(request.url)
    const lat = parseFloat(url.searchParams.get('latitude'))
    const lng = parseFloat(url.searchParams.get('longitude'))
    if (!lat || !lng) return errorResponse('缺少经纬度参数', 400)

    // 参数获取
    const radius = parseInt(url.searchParams.get('radius') || '10')
    const keywords = url.searchParams.get('keywords') || '景点'
    const types = url.searchParams.get('types') || '风景名胜|公园广场'
    const page = parseInt(url.searchParams.get('page') || '1')
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20')

    try {
        const result = await searchNearbyPOI(lng, lat, radius * 1000, keywords, env, types, page, pageSize)
        const list = result.pois.map((p, i) => {
            const loc = p.location?.split(',') || ['0', '0']
            return {
                id: p.id || String(i + 1), name: p.name || '未知景点',
                image: p.photos?.[0]?.url || 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=400',
                tags: p.type || '景点', distance: p.distance ? `${(p.distance / 1000).toFixed(1)}km` : '未知',
                address: p.address || '',
                rating: p.biz_ext?.rating || null, tel: p.tel || '',
                latitude: parseFloat(loc[1]), longitude: parseFloat(loc[0])
            }
        })
        return jsonResponse({ list, total: result.total, page, pageSize, hasMore: list.length >= pageSize })
    } catch (err) {
        console.error('获取周边景点失败:', err)
        // Mock 兜底数据
        const mockData = [{
            id: 'mock_1', name: '通过 Mock 返回的模拟景点',
            image: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=400',
            tags: '5A级景区', distance: '1.0km', address: '模拟地址',
            latitude: lat + 0.01, longitude: lng + 0.01
        }]
        return jsonResponse({ list: mockData, total: 1, page: 1, pageSize, hasMore: false })
    }
}

async function handleRouteDriving(request, env) {
    const url = new URL(request.url)
    const origin = url.searchParams.get('origin')
    const destination = url.searchParams.get('destination')
    if (!origin || !destination) return errorResponse('缺少参数', 400)
    try { return jsonResponse(await getRouteDriving(origin, destination, env)) }
    catch (err) { return errorResponse(err.message, 500) }
}

async function handleRouteWalking(request, env) {
    const url = new URL(request.url)
    const origin = url.searchParams.get('origin')
    const destination = url.searchParams.get('destination')
    if (!origin || !destination) return errorResponse('缺少参数', 400)
    try { return jsonResponse(await getRouteWalking(origin, destination, env)) }
    catch (err) { return errorResponse(err.message, 500) }
}

async function handleRouteTransit(request, env) {
    const url = new URL(request.url)
    const origin = url.searchParams.get('origin')
    const destination = url.searchParams.get('destination')
    const city = url.searchParams.get('city')
    if (!origin || !destination || !city) return errorResponse('缺少参数', 400)
    try { return jsonResponse(await getRouteTransit(origin, destination, city, env)) }
    catch (err) { return errorResponse(err.message, 500) }
}

async function handleGetDayPath(request, env) {
    const user = await getUserFromRequest(request, env)
    if (!user) return errorResponse('未登录', 401)

    const url = new URL(request.url)
    const planId = url.searchParams.get('planId')
    const dayIndex = parseInt(url.searchParams.get('dayIndex') || '0')
    const mode = url.searchParams.get('mode') || 'driving'
    if (!planId) return errorResponse('缺少planId', 400)

    // 缓存检查
    // EdgeOne 使用全局 KV
    const cacheKey = `day_path:${planId}:${dayIndex}:${mode}`
    const cached = await KV.get(cacheKey)
    if (cached) return jsonResponse(JSON.parse(cached))

    try {
        const planData = await KV.get(`plan:${user.openid}:${planId}`)
        if (!planData) return errorResponse('行程不存在', 404)
        const plan = JSON.parse(planData)
        const schedule = plan.schedule || []
        if (dayIndex >= schedule.length) return errorResponse('天数索引超出范围', 400)

        const planning = schedule[dayIndex].planning || []
        const locations = []

        // 起点
        if (dayIndex === 0 && plan.userLocation) {
            locations.push({
                id: 0, name: '出发点', type: 'start',
                latitude: plan.userLocation.latitude, longitude: plan.userLocation.longitude
            })
        }
        // 途经点
        planning.forEach((item, idx) => {
            if (item.location?.latitude && item.location?.longitude) {
                locations.push({
                    id: locations.length, name: item.name || `地点${idx + 1}`, type: item.type || 'attraction',
                    latitude: item.location.latitude, longitude: item.location.longitude
                })
            }
        })
        // 终点
        if (dayIndex === schedule.length - 1 && plan.userLocation) {
            locations.push({
                id: locations.length, name: '返回起点', type: 'end',
                latitude: plan.userLocation.latitude, longitude: plan.userLocation.longitude
            })
        }

        if (locations.length < 2) {
            return jsonResponse({
                markers: locations.map((loc, idx) => ({ ...loc, label: loc.type === 'start' ? '起' : loc.type === 'end' ? '终' : String(idx) })),
                polylines: [], totalDistance: 0, totalDuration: 0, mode, message: '坐标点不足'
            })
        }

        const polylines = []
        let totalDistance = 0, totalDuration = 0

        for (let i = 0; i < locations.length - 1; i++) {
            const from = locations[i]
            const to = locations[i + 1]
            try {
                let routeRes
                if (mode === 'walking') routeRes = await getRouteWalking(`${from.longitude},${from.latitude}`, `${to.longitude},${to.latitude}`, env)
                else if (mode === 'transit') routeRes = await getRouteTransit(`${from.longitude},${from.latitude}`, `${to.longitude},${to.latitude}`, plan.city || '', env)
                else routeRes = await getRouteDriving(`${from.longitude},${from.latitude}`, `${to.longitude},${to.latitude}`, env)

                const dist = routeRes.distance || 0
                polylines.push({
                    fromId: from.id, toId: to.id, fromName: from.name, toName: to.name,
                    points: routeRes.polyline || [], distance: dist, duration: routeRes.duration || 0,
                    distanceText: dist >= 1000 ? `${(dist / 1000).toFixed(1)}km` : `${dist}m`,
                    color: SEGMENT_COLORS[i % SEGMENT_COLORS.length], width: 6, arrowLine: true
                })
                totalDistance += dist
                totalDuration += routeRes.duration || 0
            } catch (e) {
                console.error(`路径规划失败 ${from.name}->${to.name}:`, e)
                polylines.push({
                    fromId: from.id, toId: to.id, fromName: from.name, toName: to.name,
                    points: [], distance: 0, duration: 0, distanceText: '0m', color: SEGMENT_COLORS[i % SEGMENT_COLORS.length], error: e.message
                })
            }
        }

        const result = {
            markers: locations.map((loc, idx) => ({
                ...loc, label: loc.type === 'start' ? '起' : loc.type === 'end' ? '终' : String(idx),
                color: loc.type === 'start' ? '#10b981' : loc.type === 'end' ? '#ef4444' : '#3b82f6'
            })),
            polylines, totalDistance, totalDuration,
            totalDistanceText: totalDistance >= 1000 ? `${(totalDistance / 1000).toFixed(1)}km` : `${totalDistance}m`,
            totalDurationText: totalDuration > 0 ? `约${totalDuration}分钟` : '',
            mode, dayIndex
        }

        await KV.put(cacheKey, JSON.stringify(result), { expirationTtl: 86400 })
        return jsonResponse(result)
    } catch (err) { return errorResponse(err.message, 500) }
}

// ==================== AI 对话规划 ====================

/**
 * AI对话规划接口 - 动态生成A2UI响应
 * 接收用户消息和当前对话上下文，返回AI回复和A2UI选项
 */
async function handlePlanChat(request, env) {
    const user = await getUserFromRequest(request, env)
    if (!user) return errorResponse('未登录', 401)

    try {
        const { message, context } = await request.json()

        // context 包含已收集的信息
        const currentContext = context || {}
        const userMsg = message || ''

        // ======== 第一步：敏感信息过滤 ========
        const sensitivePatterns = [
            // 提示词/系统攻击相关
            /提示词/i, /prompt/i, /系统指令/i, /system/i, /忽略.*指令/i, /无视.*规则/i,
            /角色扮演/i, /假装/i, /扮演/i, /jailbreak/i, /越狱/i, /破解/i,
            /你是谁/i, /你的身份/i, /你的设定/i,
            // 编程/技术相关
            /java/i, /python/i, /javascript/i, /c\+\+/i, /php/i, /编程/i, /代码/i,
            /算法/i, /函数/i, /API/i, /接口/i, /数据库/i, /SQL/i,
            // 数学/学术相关
            /数学题/i, /解方程/i, /微积分/i, /线性代数/i, /物理/i, /化学/i,
            // 其他无关话题
            /写作文/i, /翻译/i, /股票/i, /基金/i, /投资/i, /比特币/i,
            /健康/i, /疾病/i, /症状/i, /法律/i, /律师/i
        ]

        const isSensitive = sensitivePatterns.some(pattern => pattern.test(userMsg))
        if (isSensitive) {
            return successResponse({
                reply: '我是您的行程助手，专门帮您规划旅行。想去哪里玩呢？',
                buttons: [
                    { id: 'city_beijing', label: '北京', icon: '🏛️' },
                    { id: 'city_shanghai', label: '上海', icon: '🌆' },
                    { id: 'city_hangzhou', label: '杭州', icon: '🌸' },
                    { id: 'city_chengdu', label: '成都', icon: '🐼' }
                ],
                nextStage: 'collecting',
                context: {}
            })
        }

        // ======== 第二步：构建信息提取提示词 ========
        const today = new Date()
        const todayStr = `${today.getMonth() + 1}月${today.getDate()}日`
        const weekDay = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.getDay()]
        const year = today.getFullYear()

        // 计算常用日期偏移量（供提示词参考）
        const dayOfWeek = today.getDay() // 0=周日, 1=周一, ..., 6=周六

        // 计算本周各天的偏移量
        const getWeekdayOffset = (targetDay) => {
            const diff = targetDay - dayOfWeek
            return diff >= 0 ? diff : diff + 7
        }

        // 本周各天偏移量
        const thisWeekOffsets = {
            '周一': getWeekdayOffset(1),
            '周二': getWeekdayOffset(2),
            '周三': getWeekdayOffset(3),
            '周四': getWeekdayOffset(4),
            '周五': getWeekdayOffset(5),
            '周六': getWeekdayOffset(6),
            '周日': getWeekdayOffset(0) || 7  // 如果今天是周日，则为下周日=7
        }

        // 周末偏移量（取最近的周六）
        const weekendOffset = thisWeekOffsets['周六'] === 0 ? 7 : thisWeekOffsets['周六']

        // 生成简洁的日期映射表
        const dateMapping = `今天=0, 明天=1, 后天=2, 大后天=3, 周末=${weekendOffset}, 周六=${thisWeekOffsets['周六']}, 周日=${thisWeekOffsets['周日']}, 下周末=${weekendOffset + 7}`

        const systemPrompt = `# 行程规划助手

## 当前状态
- 今天：${year}年${todayStr}（${weekDay}）
- 已收集：${JSON.stringify(currentContext)}

## 字段说明
- city: 目的地城市名（必填）
- daysOffset: 出发日期偏移量，0=今天，1=明天...（必填）
- days: 游玩天数（必填）
- transport: 交通方式 public/drive/walk（默认public）
- accommodation: 住宿 budget/comfort/luxury（默认budget）
- poiTypes: 景点类型数组（默认[]）

## 日期识别（用户表达→daysOffset）
常用映射：${dateMapping}
规则：
- "X天后"→X，"一周后"→7
- "周X"表示本周，"下周X"表示+7天
- 具体日期如"12月28日"，计算与今天(${todayStr})的天数差
- 用户说"本周末"且今天已是周六/周日，指下周末

## 偏好识别
- transport: 自驾/开车→drive, 步行/徒步→walk, 其他→public
- accommodation: 豪华/五星→luxury, 舒适/商务→comfort, 其他→budget
- poiTypes: 自然/风景→nature, 历史/古迹→history, 博物馆→museum, 游乐园→amusement, 美食→food

## 处理流程

### 1. 判断场景（重要！）
检查已收集信息：
- city有值 且 daysOffset有值（数字类型，含0） 且 days有值 → **修改计划模式**
- 否则 → **收集信息模式**

### 2. 修改计划模式（已有完整信息时）
**关键规则**：
- 用户输入是对现有计划的调整（偏好、景点类型等）
- 识别要修改的字段并更新（如"喜欢自然风光"→poiTypes加nature）
- **保持所有已有字段不变**，只更新用户提到的字段
- nextStage = "summary"
- **只返回"开始规划"按钮，不提供城市/日期/天数选择**
- **missing必须为空数组[]**，因为必填信息已完整
- 回复要确认用户的调整，如"好的，加上自然风光！🌲"

### 3. 收集信息模式（缺少必填信息时）
按优先级收集：city → daysOffset → days
- 缺city：询问目的地，提供热门城市按钮
- 缺daysOffset：询问出发时间，提供日期按钮
- 缺days：询问天数，提供天数按钮
- 全部收集完成：nextStage=summary，提供"开始规划"按钮

## 回复要求
- 自然亲切，像朋友聊天
- 控制在50字以内
- 可用emoji增加亲和力
- 不说"已记录"、"收到"等机械用语
- 修改计划时，确认已做的调整

## 输出格式（严格JSON）
{
  "reply": "回复文本",
  "buttons": [{"id":"xxx","label":"文字","icon":"emoji","action":{"name":"动作名"}}],
  "nextStage": "collecting或summary",
  "context": {"city":null,"daysOffset":null,"days":null,"transport":"public","accommodation":"budget","poiTypes":[]},
  "missing": []
}

## 按钮action说明
- 开始规划按钮必须包含："action":{"name":"confirmPlan"}
- 调整偏好按钮："action":{"name":"adjustPrefs"}
- 重新选择按钮："action":{"name":"restart"}
- 其他按钮可省略action

## 按钮选项示例
- 城市按钮：{"id":"北京","label":"北京","icon":"🏛️"}
- 日期按钮：{"id":"明天","label":"明天","icon":"📅"}
- 天数按钮：{"id":"3天","label":"3天","icon":"3️⃣"}
- 开始规划：{"id":"confirm","label":"开始规划","icon":"✅","action":{"name":"confirmPlan"}}
- 调整偏好：{"id":"adjust","label":"调整偏好","icon":"⚙️","action":{"name":"adjustPrefs"}}`

        // 调用DeepSeek API
        const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMsg || '开始规划' }
                ],
                temperature: 0.3,
                max_tokens: 600,
                response_format: { type: 'json_object' }
            })
        })

        if (!response.ok) {
            throw new Error(`DeepSeek API错误: ${response.status}`)
        }

        const data = await response.json()
        const aiContent = data.choices?.[0]?.message?.content

        if (!aiContent) {
            throw new Error('AI返回内容为空')
        }

        // 解析AI返回的JSON
        let aiResponse
        try {
            aiResponse = JSON.parse(aiContent)
        } catch (e) {
            console.error('AI响应解析失败:', aiContent)
            aiResponse = getFallbackResponse('collecting', currentContext)
        }

        // ======== 第三步：合并上下文并验证 ========
        const aiContext = aiResponse.context || {}

        // 获取daysOffset（AI提取的优先，否则用已有的）
        // 注意：AI可能返回字符串，需要转换为数字
        let daysOffset = null
        if (aiContext.daysOffset !== null && aiContext.daysOffset !== undefined) {
            daysOffset = parseInt(aiContext.daysOffset, 10)
            if (isNaN(daysOffset)) daysOffset = null
        } else if (currentContext.daysOffset !== null && currentContext.daysOffset !== undefined) {
            daysOffset = parseInt(currentContext.daysOffset, 10)
            if (isNaN(daysOffset)) daysOffset = null
        }

        // 根据daysOffset计算具体日期（标准格式 YYYY-MM-DD）
        let startDate = currentContext.startDate || null
        if (daysOffset !== null && daysOffset >= 0) {
            const targetDate = new Date(today)
            targetDate.setDate(targetDate.getDate() + daysOffset)
            // 使用标准ISO日期格式
            const yyyy = targetDate.getFullYear()
            const mm = String(targetDate.getMonth() + 1).padStart(2, '0')
            const dd = String(targetDate.getDate()).padStart(2, '0')
            startDate = `${yyyy}-${mm}-${dd}`
        }

        // 合并上下文（AI值优先 > 已有值 > 默认值）
        // 对days也做类型转换
        let days = null
        if (aiContext.days !== null && aiContext.days !== undefined) {
            days = parseInt(aiContext.days, 10)
            if (isNaN(days) || days <= 0) days = null
        } else if (currentContext.days !== null && currentContext.days !== undefined) {
            days = parseInt(currentContext.days, 10)
            if (isNaN(days) || days <= 0) days = null
        }

        // 辅助函数：优先取AI值，否则取已有值，最后取默认值
        const mergeField = (aiVal, existingVal, defaultVal) => {
            if (aiVal !== null && aiVal !== undefined && aiVal !== '') return aiVal
            if (existingVal !== null && existingVal !== undefined && existingVal !== '') return existingVal
            return defaultVal
        }

        // 处理数组类型的poiTypes
        const mergeArray = (aiVal, existingVal, defaultVal) => {
            if (Array.isArray(aiVal) && aiVal.length > 0) return aiVal
            if (Array.isArray(existingVal) && existingVal.length > 0) return existingVal
            return defaultVal
        }

        const mergedContext = {
            city: mergeField(aiContext.city, currentContext.city, null),
            startDate: startDate,
            daysOffset: daysOffset,
            days: days,
            transport: mergeField(aiContext.transport, currentContext.transport, 'public'),
            accommodation: mergeField(aiContext.accommodation, currentContext.accommodation, 'budget'),
            poiTypes: mergeArray(aiContext.poiTypes, currentContext.poiTypes, [])
        }

        // 验证必填字段是否完整
        const hasCity = mergedContext.city && typeof mergedContext.city === 'string' && mergedContext.city.length > 0
        const hasDate = mergedContext.startDate && typeof mergedContext.startDate === 'string'
        const hasDays = mergedContext.days && typeof mergedContext.days === 'number' && mergedContext.days > 0

        // 强制判断阶段
        let nextStage = (hasCity && hasDate && hasDays) ? 'summary' : 'collecting'

        const result = {
            reply: aiResponse.reply || '请告诉我您的旅行计划~',
            buttons: aiResponse.buttons || [],
            nextStage: nextStage,
            context: mergedContext,
            missing: aiResponse.missing || []
        }

        return jsonResponse(result)

    } catch (err) {
        console.error('AI对话失败:', err)
        const fallback = getFallbackResponse('collecting', context || {})
        return jsonResponse(fallback)
    }
}

/**
 * 降级策略：当AI调用失败时返回预设响应
 */
function getFallbackResponse(stage, context) {
    // 检查必填字段是否完整
    const hasCity = context.city && typeof context.city === 'string' && context.city.length > 0
    const hasDate = context.startDate && typeof context.startDate === 'string'
    const hasDays = context.days && typeof context.days === 'number' && context.days > 0

    // 如果信息完整，进入summary阶段
    if (hasCity && hasDate && hasDays) {
        return {
            reply: `${context.city}${context.days}天之旅，${context.startDate}出发！确认开始规划吗？`,
            buttons: [
                { id: 'confirm', label: '开始规划', icon: '✅', action: { name: 'confirmPlan' } },
                { id: 'modify_transport', label: '改交通', icon: '🚗' },
                { id: 'modify_accommodation', label: '改住宿', icon: '🏨' },
                { id: 'restart', label: '重新选择', icon: '🔄', action: { name: 'restart' } }
            ],
            nextStage: 'summary',
            context: {
                ...context,
                transport: context.transport || 'public',
                accommodation: context.accommodation || 'budget',
                poiTypes: context.poiTypes || []
            },
            missing: []
        }
    }

    // 根据缺失的信息提供不同的选项
    const missing = []
    if (!hasCity) missing.push('city')
    if (!hasDate) missing.push('startDate')
    if (!hasDays) missing.push('days')

    // 优先询问城市
    if (!hasCity) {
        return {
            reply: '👋 你好！想去哪个城市玩呢？',
            buttons: [
                { id: 'city_beijing', label: '北京', icon: '�️' },
                { id: 'city_shanghai', label: '上海', icon: '�' },
                { id: 'city_hangzhou', label: '杭州', icon: '🌸' },
                { id: 'city_chengdu', label: '成都', icon: '🐼' },
                { id: 'city_xian', label: '西安', icon: '🏯' }
            ],
            nextStage: 'collecting',
            context: context,
            missing: missing
        }
    }

    // 已有城市，询问时间
    if (!hasDate) {
        return {
            reply: `好的，去${context.city}！什么时候出发呢？`,
            buttons: [
                { id: 'date_tomorrow', label: '明天出发', icon: '📅' },
                { id: 'date_weekend', label: '本周末', icon: '🗓️' },
                { id: 'date_nextweek', label: '下周', icon: '📆' }
            ],
            nextStage: 'collecting',
            context: context,
            missing: missing
        }
    }

    // 已有城市和时间，询问天数
    return {
        reply: `${context.city}，${context.startDate}出发，玩几天呢？`,
        buttons: [
            { id: 'days_2', label: '2天', icon: '2️⃣' },
            { id: 'days_3', label: '3天', icon: '3️⃣' },
            { id: 'days_5', label: '5天', icon: '5️⃣' },
            { id: 'days_7', label: '7天', icon: '7️⃣' }
        ],
        nextStage: 'collecting',
        context: context,
        missing: missing
    }
}

// ==================== 行程相关 ====================

async function handleGeneratePlan(request, env, context) {
    const user = await getUserFromRequest(request, env)
    if (!user) return errorResponse('未登录', 401)

    const { city, date, days, poiTypes, notes, transportation, accommodation, apiVersion, userLocation } = await request.json()
    if (!city || !date || !days) return errorResponse('缺少必要参数', 400)

    // 检查云函数配置
    if (!env.PLAN_SERVICE_URL) return errorResponse('服务配置错误：未配置行程规划服务地址', 500)

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
        // 用户起点坐标（用于导航）
        userLocation: userLocation || null,
        createdAt: Date.now()
    }

    try {
        // 下载并保存城市封面图片到COS（在创建时就保存，避免列表无图）
        const cityImage = await downloadAndSaveCityImage(city, planId, env)
        pendingPlan.cityImage = cityImage

        // 立即保存"生成中"状态的记录
        await KV.put(`plan:${user.openid}:${planId}`, JSON.stringify(pendingPlan))

        // 更新用户的行程列表（带状态）
        const listKey = `plan_list:${user.openid}`
        const existingList = await KV.get(listKey)
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
        await KV.put(listKey, JSON.stringify(planList))


        // 用于云函数的偏好参数（使用翻译后的景点类型）
        const preferences = translatedPoiTypes.length > 0 ? translatedPoiTypes : ['休闲']


        // 构建回调URL（云函数完成后调用此接口更新状态）
        const callbackUrl = new URL(request.url)
        callbackUrl.pathname = '/api/plan/callback'

        // 构建云函数请求参数（包含回调信息）
        const cloudFunctionRequest = {
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
            // 传递敏感数据（EdgeOne传递）
            amapKey: env.AMAP_KEY,
            deepseekKey: env.DEEPSEEK_API_KEY,
            // 回调信息
            callback: {
                url: callbackUrl.toString(),
                planId: planId,
                openid: user.openid
            }
        }

        // 根据版本参数构建云函数URL（如果需要）
        let cloudFunctionUrl = env.PLAN_SERVICE_URL
        if (apiVersion) {
            cloudFunctionUrl = cloudFunctionUrl.replace(/\/$/, '') + '/' + apiVersion
        }
        console.log('发送云函数请求，回调模式，URL:', cloudFunctionUrl)

        // 发送请求到云函数（fire-and-forget，不等待响应）
        // EdgeOne 不支持 waitUntil，直接使用 fetch 并 catch 错误
        fetch(cloudFunctionUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'EdgeOne-Function/1.0'
            },
            body: JSON.stringify(cloudFunctionRequest)
        }).then(response => {
            console.log('云函数请求已发送，状态码:', response.status)
            return response.text().then(text => {
                console.log('云函数响应:', text.substring(0, 200))
            })
        }).catch(err => {
            console.error('发送云函数请求失败:', err)
        })

        // 立即返回"生成中"的行程
        return jsonResponse(pendingPlan)

    } catch (err) {
        console.error('创建行程记录失败:', err)
        return errorResponse('创建行程失败: ' + err.message, 500)
    }
}

// ==================== 两步规划流程：步骤一 - 生成3套方案 ====================

/**
 * 生成行程方案（步骤一）
 * POST /api/plan/generate-options
 * 异步调用云函数生成3套方案，前端轮询结果
 */
async function handleGeneratePlanOptions(request, env) {
    const user = await getUserFromRequest(request, env)
    if (!user) return errorResponse('未登录', 401)

    const params = await request.json()
    const { city, date, days, transportation, accommodation, poiTypes, notes } = params

    if (!city || !date || !days) {
        return errorResponse('缺少必要参数', 400)
    }

    if (!env.PLAN_SERVICE_URL) {
        return errorResponse('服务配置错误：未配置行程规划服务地址', 500)
    }

    // 生成方案ID
    const optionsId = generateId('options_')

    // 计算结束日期
    const startDate = new Date(date)
    const endDate = new Date(startDate)
    endDate.setDate(endDate.getDate() + days - 1)
    const endDateStr = endDate.toISOString().split('T')[0]

    // 翻译偏好设置
    const preferenceMap = {
        'any': '不限', 'nature': '自然风光', 'history': '历史古迹',
        'museum': '博物馆', 'amusement': '游乐园', 'food': '美食探店'
    }
    const translatedPoiTypes = (poiTypes || [])
        .filter(type => type !== 'any')
        .map(type => preferenceMap[type] || type)

    const transportMap = { 'public': '公共交通', 'drive': '自驾', 'walk': '步行为主' }
    const translatedTransport = transportMap[transportation] || transportation || '公共交通'

    const accommodationMap = { 'budget': '经济型酒店', 'comfort': '舒适型酒店', 'luxury': '豪华型酒店' }
    const translatedAccommodation = accommodationMap[accommodation] || accommodation || '经济型酒店'

    // 创建临时方案记录（12小时TTL）
    const optionsRecord = {
        id: optionsId,
        openid: user.openid,
        city,
        date,
        endDate: endDateStr,
        days,
        transportation: translatedTransport,
        accommodation: translatedAccommodation,
        poiTypes: translatedPoiTypes,
        notes,
        status: 'generating',
        statusMessage: '正在生成方案...',
        options: [],
        createdAt: Date.now()
    }

    try {
        // 存入独立的命名空间（与行程列表完全分离），12小时TTL
        await KV.put(
            `plan_options:${user.openid}:${optionsId}`,
            JSON.stringify(optionsRecord),
            { expirationTtl: 43200 }  // 12小时 = 43200秒
        )

        // 构建回调URL
        const callbackUrl = new URL(request.url)
        callbackUrl.pathname = '/api/plan/options-callback'

        // 异步调用云函数（fire-and-forget）
        fetch(env.PLAN_SERVICE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'EdgeOne-Function/1.0' },
            body: JSON.stringify({
                generateType: 'options',
                city,
                start_date: date,
                end_date: endDateStr,
                travel_days: days,
                transportation: translatedTransport,
                accommodation: translatedAccommodation,
                preferences: translatedPoiTypes.length > 0 ? translatedPoiTypes : ['休闲'],
                free_text_input: notes || '',
                amapKey: env.AMAP_KEY,
                deepseekKey: env.DEEPSEEK_API_KEY,
                callback: {
                    url: callbackUrl.toString(),
                    optionsId,
                    openid: user.openid
                }
            })
        }).then(res => {
            console.log('云函数请求已发送，状态码:', res.status)
        }).catch(err => {
            console.error('云函数调用失败:', err)
        })

        return jsonResponse({ optionsId, status: 'generating' })

    } catch (err) {
        console.error('创建方案记录失败:', err)
        return errorResponse('创建方案失败: ' + err.message, 500)
    }
}

/**
 * 方案生成回调（云函数完成后调用）
 * POST /api/plan/options-callback
 */
async function handleOptionsCallback(request, env) {
    try {
        const { optionsId, openid, success, data, message } = await request.json()

        if (!optionsId || !openid) {
            return errorResponse('缺少必要参数', 400)
        }

        const key = `plan_options:${openid}:${optionsId}`
        const recordData = await KV.get(key)

        if (!recordData) {
            return errorResponse('方案不存在或已过期', 404)
        }

        const record = JSON.parse(recordData)

        if (success) {
            record.status = 'completed'
            record.statusMessage = ''
            record.options = data?.options || []
        } else {
            record.status = 'failed'
            record.statusMessage = message || '方案生成失败'
        }

        // 更新记录，保持12小时TTL
        await KV.put(key, JSON.stringify(record), { expirationTtl: 43200 })

        return jsonResponse({ received: true, status: record.status })

    } catch (err) {
        console.error('处理方案回调失败:', err)
        return errorResponse('回调处理失败: ' + err.message, 500)
    }
}

/**
 * 查询方案生成状态
 * GET /api/plan/options-status?optionsId=xxx
 */
async function handleGetOptionsStatus(request, env) {
    const user = await getUserFromRequest(request, env)
    if (!user) return errorResponse('未登录', 401)

    const optionsId = new URL(request.url).searchParams.get('optionsId')
    if (!optionsId) return errorResponse('缺少optionsId参数', 400)

    const key = `plan_options:${user.openid}:${optionsId}`
    const data = await KV.get(key)

    if (!data) {
        return errorResponse('方案不存在或已过期', 404)
    }

    const record = JSON.parse(data)
    return jsonResponse({
        status: record.status,
        options: record.options || [],
        message: record.statusMessage
    })
}

/**
 * 确认选择的方案（步骤二）
 * POST /api/plan/confirm-option
 * 根据用户选择的方案，创建正式行程并调用云函数规划详细路线
 */
async function handleConfirmOption(request, env) {
    const user = await getUserFromRequest(request, env)
    if (!user) return errorResponse('未登录', 401)

    const { optionsId, selectedOptionId } = await request.json()

    if (!optionsId || !selectedOptionId) {
        return errorResponse('缺少必要参数', 400)
    }

    if (!env.PLAN_SERVICE_URL) {
        return errorResponse('服务配置错误', 500)
    }

    // 读取临时方案数据
    const optionsKey = `plan_options:${user.openid}:${optionsId}`
    const optionsData = await KV.get(optionsKey)

    if (!optionsData) {
        return errorResponse('方案不存在或已过期', 404)
    }

    const optionsRecord = JSON.parse(optionsData)

    if (optionsRecord.status !== 'completed') {
        return errorResponse('方案尚未生成完成', 400)
    }

    // 找到用户选择的方案
    const selectedOption = optionsRecord.options.find(o => o.id === selectedOptionId)
    if (!selectedOption) {
        return errorResponse('未找到选中的方案', 400)
    }

    // 生成正式行程ID
    const planId = generateId('plan_')

    try {
        // 下载城市封面图
        const cityImage = await downloadAndSaveCityImage(optionsRecord.city, planId, env)

        // 创建正式行程记录
        const pendingPlan = {
            id: planId,
            openid: user.openid,
            city: optionsRecord.city,
            date: optionsRecord.date,
            endDate: optionsRecord.endDate,
            days: optionsRecord.days,
            transportation: optionsRecord.transportation,
            accommodation: optionsRecord.accommodation,
            poiTypes: optionsRecord.poiTypes,
            notes: optionsRecord.notes,
            // 选定方案信息
            selectedOptionId: selectedOption.id,
            selectedOptionName: selectedOption.name,
            // 状态字段
            status: 'generating',
            statusMessage: '正在生成详细行程...',
            // 空的详情数据（等待云函数回填）
            schedule: [],
            weatherInfo: [],
            budget: {},
            overallSuggestions: '',
            routeInfo: [],
            routeSummary: null,
            cityImage,
            createdAt: Date.now()
        }

        // 保存正式行程记录
        await KV.put(`plan:${user.openid}:${planId}`, JSON.stringify(pendingPlan))

        // 更新用户的行程列表
        const listKey = `plan_list:${user.openid}`
        const existingList = await KV.get(listKey)
        const planList = existingList ? JSON.parse(existingList) : []
        planList.unshift({
            id: planId,
            city: pendingPlan.city,
            date: pendingPlan.date,
            endDate: pendingPlan.endDate,
            days: pendingPlan.days,
            status: 'generating',
            cityImage,
            transportation: pendingPlan.transportation,
            accommodation: pendingPlan.accommodation,
            poiTypes: pendingPlan.poiTypes,
            selectedOptionName: selectedOption.name,
            createdAt: pendingPlan.createdAt
        })
        await KV.put(listKey, JSON.stringify(planList))

        // 删除临时方案数据
        await KV.delete(optionsKey)

        // 构建回调URL
        const callbackUrl = new URL(request.url)
        callbackUrl.pathname = '/api/plan/callback'

        // 异步调用云函数规划详细路线
        fetch(env.PLAN_SERVICE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'EdgeOne-Function/1.0' },
            body: JSON.stringify({
                generateType: 'route',
                city: optionsRecord.city,
                start_date: optionsRecord.date,
                end_date: optionsRecord.endDate,
                travel_days: optionsRecord.days,
                transportation: optionsRecord.transportation,
                accommodation: optionsRecord.accommodation,
                preferences: optionsRecord.poiTypes,
                selectedOption,
                amapKey: env.AMAP_KEY,
                deepseekKey: env.DEEPSEEK_API_KEY,
                callback: {
                    url: callbackUrl.toString(),
                    planId,
                    openid: user.openid
                }
            })
        }).then(res => {
            console.log('云函数路线规划请求已发送，状态码:', res.status)
        }).catch(err => {
            console.error('云函数调用失败:', err)
        })

        return jsonResponse({ planId, status: 'generating', selectedOptionName: selectedOption.name })

    } catch (err) {
        console.error('确认方案失败:', err)
        return errorResponse('确认方案失败: ' + err.message, 500)
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
            // 生成失败
            const planKey = `plan:${openid}:${planId}`
            const planData = await KV.get(planKey)
            if (planData) {
                const plan = JSON.parse(planData)
                plan.status = 'failed'
                plan.statusMessage = message || 'AI生成失败'
                await KV.put(planKey, JSON.stringify(plan))
            }

            // 更新列表状态
            const listKey = `plan_list:${openid}`
            const listData = await KV.get(listKey)
            if (listData) {
                const list = JSON.parse(listData)
                const item = list.find(p => p.id === planId)
                if (item) {
                    item.status = 'failed'
                    await KV.put(listKey, JSON.stringify(list))
                }
            }

            return jsonResponse({ received: true, status: 'failed' })
        }

        // 生成成功，更新行程数据
        const planKey = `plan:${openid}:${planId}`
        const existingData = await KV.get(planKey)

        if (!existingData) {
            return errorResponse('行程不存在', 404)
        }

        const existingPlan = JSON.parse(existingData)
        const tripPlan = data

        // 使用创建时已保存的城市封面图片
        const cityName = tripPlan.city || existingPlan.city
        const cityImage = existingPlan.cityImage || `https://picsum.photos/seed/${encodeURIComponent(cityName)}/800/600`

        // EdgeOne 不需要静态地图，已删除 generateStaticMapUrl 调用
        const days = tripPlan.days || []

        // 更新行程记录为完成状态
        const completedPlan = {
            ...existingPlan,
            city: cityName,
            date: tripPlan.start_date || existingPlan.date,
            endDate: tripPlan.end_date || existingPlan.endDate,
            // 城市封面图片
            cityImage: cityImage,
            // 状态更新为已完成
            status: 'completed',
            statusMessage: '',
            // 云函数返回的详细数据
            schedule: days,
            weatherInfo: tripPlan.weather_info || [],
            budget: tripPlan.budget || {},
            overallSuggestions: tripPlan.overall_suggestions || '',
            routeInfo: tripPlan.route_info || body.route_info || [],
            routeSummary: tripPlan.route_summary || body.summary || null,
            completedAt: Date.now()
        }

        // 保存完成的行程
        await KV.put(planKey, JSON.stringify(completedPlan))

        // 构建列表项额外信息（用于显示标签）
        const listItemInfo = {
            cityImage: cityImage,
            transportation: existingPlan.transportation || '公共交通',
            accommodation: existingPlan.accommodation || '经济型酒店',
            poiTypes: existingPlan.poiTypes || []
        }

        // 更新列表中的状态和额外信息
        const listKey = `plan_list:${openid}`
        const listData = await KV.get(listKey)
        if (listData) {
            const list = JSON.parse(listData)
            const item = list.find(p => p.id === planId)
            if (item) {
                item.status = 'completed'
                // 添加额外信息
                Object.assign(item, listItemInfo)
                await KV.put(listKey, JSON.stringify(list))
            }
        }

        return jsonResponse({ received: true, status: 'completed' })

    } catch (err) {
        console.error('处理回调失败:', err)
        return errorResponse('回调处理失败: ' + err.message, 500)
    }
}

async function handleGetPlanList(request, env) {
    const user = await getUserFromRequest(request, env)
    if (!user) return errorResponse('未登录', 401)

    const url = new URL(request.url)
    const page = parseInt(url.searchParams.get('page')) || 1
    const pageSize = parseInt(url.searchParams.get('pageSize')) || 10

    const data = await KV.get(`plan_list:${user.openid}`)
    const allList = data ? JSON.parse(data) : []
    const total = allList.length
    const start = (page - 1) * pageSize
    const list = allList.slice(start, start + pageSize)

    return jsonResponse({ list, total, page, pageSize, totalPages: Math.ceil(total / pageSize), hasMore: page < Math.ceil(total / pageSize) })
}

async function handleGetPlanDetail(request, env) {
    const user = await getUserFromRequest(request, env)
    if (!user) return errorResponse('未登录', 401)
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return errorResponse('缺少id参数', 400)
    const data = await KV.get(`plan:${user.openid}:${id}`)
    if (!data) return errorResponse('行程不存在', 404)
    return jsonResponse(JSON.parse(data))
}

async function handleDeletePlan(request, env) {
    const user = await getUserFromRequest(request, env)
    if (!user) return errorResponse('未登录', 401)
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return errorResponse('缺少id参数', 400)

    await KV.delete(`plan:${user.openid}:${id}`)
    const listKey = `plan_list:${user.openid}`
    const existing = await KV.get(listKey)
    if (existing) {
        const list = JSON.parse(existing).filter(item => item.id !== id)
        await KV.put(listKey, JSON.stringify(list))
    }
    return jsonResponse({ id, deleted: true })
}

// ==================== 明信片相关 ====================

const POSTCARD_WHITELIST = ['orBRy14EIyMRaE6VgyAsGd3nYmMY']

/**
 * AI生成明信片 - 异步模式（通过腾讯云函数）
 * 完整复制Worker逻辑：云函数完成所有处理，直接返回结果
 */
async function handleGeneratePostcard(request, env, context) {
    const user = await getUserFromRequest(request, env)
    if (!user) return errorResponse('未登录', 401)

    const body = await request.json()
    const { planId } = body

    if (!planId) return errorResponse('缺少行程ID参数', 400)

    // 检查云函数配置
    if (!env.POSTCARD_SERVICE_URL) {
        return errorResponse('服务配置错误：未配置明信片生成服务地址', 500)
    }

    // 检查是否为白名单用户
    const isWhitelisted = POSTCARD_WHITELIST.includes(user.openid)

    // 非白名单用户需要检查每日生成次数
    if (!isWhitelisted) {
        const today = new Date().toISOString().split('T')[0]
        const countKey = `postcard_count:${user.openid}:${today}`
        const countStr = await KV.get(countKey)
        const currentCount = countStr ? parseInt(countStr, 10) : 0

        if (currentCount >= 3) {
            return errorResponse('今日生成次数已达上限（每天最多3次），请明天再试', 429)
        }

        await KV.put(countKey, String(currentCount + 1), { expirationTtl: 86400 })
    }

    try {
        // 1. 根据 planId 查询行程详情
        const planData = await KV.get(`plan:${user.openid}:${planId}`)
        if (!planData) return errorResponse('行程不存在', 404)
        const plan = JSON.parse(planData)

        // 2. 创建pending状态的明信片记录
        const postcardId = generateId('postcard_')
        const pendingPostcard = {
            id: postcardId,
            planId: planId,
            title: `${plan.city}之旅`,
            city: plan.city,
            date: plan.date,
            endDate: plan.endDate,
            days: plan.days,
            description: `${plan.city} ${plan.days}天${plan.days - 1}晚精彩旅程`,
            status: 'generating',
            statusMessage: '正在生成明信片...',
            createdAt: Date.now()
        }

        // 3. 保存明信片详情到 KV
        await KV.put(`postcard:${user.openid}:${postcardId}`, JSON.stringify(pendingPostcard))

        // 4. 更新用户明信片列表
        const listKey = `postcard_list:${user.openid}`
        const existingList = await KV.get(listKey)
        const postcardList = existingList ? JSON.parse(existingList) : []
        postcardList.unshift({
            id: postcardId,
            title: pendingPostcard.title,
            city: pendingPostcard.city,
            date: pendingPostcard.date,
            status: 'generating',
            createdAt: pendingPostcard.createdAt
        })
        await KV.put(listKey, JSON.stringify(postcardList))

        // 5. 异步调用云函数（fire-and-forget，不等待响应）
        const callbackUrl = new URL(request.url)
        callbackUrl.pathname = '/api/postcard/callback'

        fetch(env.POSTCARD_SERVICE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                planId, openid: user.openid, planData: plan,
                kuaiApiKey: env.KUAI_API_KEY,
                kuaiApiBase: env.KUAI_API_BASE || 'https://api.kuai.host',
                kuaiModel: env.KUAI_MODEL || 'gemini-3-pro-image-preview',
                cosConfig: {
                    bucket: env.COS_BUCKET, region: env.COS_REGION,
                    secretId: env.COS_SECRET_ID, secretKey: env.COS_SECRET_KEY,
                    domain: env.COS_DOMAIN
                },
                callback: {
                    url: callbackUrl.toString(),
                    postcardId, openid: user.openid
                }
            })
        }).catch(e => console.error('云函数请求失败:', e))


        // 6. 立即返回pending状态
        return jsonResponse(pendingPostcard)

    } catch (err) {
        console.error('创建明信片失败:', err)
        return errorResponse('创建明信片失败: ' + err.message, 500)
    }
}



/**
 * 明信片生成回调接口（云函数完成后调用）
 * 云函数直接传递完整的明信片数据
 */
async function handlePostcardCallback(request, env) {
    try {
        const { postcardId, openid, success, data, error } = await request.json()
        if (!postcardId || !openid) return errorResponse('缺少参数', 400)

        const postcardKey = `postcard:${openid}:${postcardId}`
        const postcardData = await KV.get(postcardKey)
        if (!postcardData) return errorResponse('明信片不存在', 404)

        const postcard = JSON.parse(postcardData)

        if (!success) {
            // 生成失败
            postcard.status = 'failed'
            postcard.statusMessage = error || 'AI生成失败'
            await KV.put(postcardKey, JSON.stringify(postcard))
            await updatePostcardListStatus(openid, postcardId, 'failed')
            return jsonResponse({ received: true, status: 'failed' })
        }

        // 生成成功，云函数已上传COS并返回URL
        const imageUrl = data.image
        const thumbnailUrl = getThumbnailUrl(imageUrl, 400, 80) // 使用COS图片处理生成缩略图

        // 更新明信片详情（保存提示词，但不返回给前端）
        const completedPostcard = {
            ...postcard,
            ...data,
            thumbnail: thumbnailUrl,
            status: 'completed',
            statusMessage: '',
            completedAt: Date.now()
        }

        await KV.put(postcardKey, JSON.stringify(completedPostcard))

        // 更新列表
        const listKey = `postcard_list:${openid}`
        const listData = await KV.get(listKey)
        if (listData) {
            const list = JSON.parse(listData)
            const item = list.find(p => p.id === postcardId)
            if (item) {
                item.status = 'completed'
                item.image = imageUrl
                item.thumbnail = thumbnailUrl
            }
            await KV.put(listKey, JSON.stringify(list))
        }

        return jsonResponse({ received: true, status: 'completed', imageUrl, thumbnailUrl })

    } catch (err) {
        console.error('回调处理失败:', err)
        return errorResponse('回调处理失败: ' + err.message, 500)
    }
}

/**
 * 更新明信片状态
 */
async function updatePostcardStatus(openid, postcardId, status, message) {
    try {
        const postcardKey = `postcard:${openid}:${postcardId}`
        const postcardData = await KV.get(postcardKey)
        if (postcardData) {
            const postcard = JSON.parse(postcardData)
            postcard.status = status
            postcard.statusMessage = message || ''
            await KV.put(postcardKey, JSON.stringify(postcard))
        }
        await updatePostcardListStatus(openid, postcardId, status)
    } catch (err) {
        // 忽略错误
    }
}

/**
 * 更新明信片列表状态
 */
async function updatePostcardListStatus(openid, postcardId, status) {
    try {
        const listKey = `postcard_list:${openid}`
        const listData = await KV.get(listKey)
        if (listData) {
            const list = JSON.parse(listData)
            const item = list.find(p => p.id === postcardId)
            if (item) item.status = status
            await KV.put(listKey, JSON.stringify(list))
        }
    } catch (err) {
        // 忽略错误
    }
}

async function handleGetPostcardStatus(request, env) {
    const user = await getUserFromRequest(request, env)
    if (!user) return errorResponse('未登录', 401)
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return errorResponse('缺少id参数', 400)
    const data = await KV.get(`postcard:${user.openid}:${id}`)
    if (!data) return errorResponse('明信片不存在', 404)
    const postcard = JSON.parse(data)
    return jsonResponse({ id: postcard.id, status: postcard.status || 'completed', statusMessage: postcard.statusMessage || '', image: postcard.image, thumbnail: postcard.thumbnail })
}

async function handleGetPostcardList(request, env) {
    const user = await getUserFromRequest(request, env)
    if (!user) return errorResponse('未登录', 401)

    const url = new URL(request.url)
    const page = parseInt(url.searchParams.get('page')) || 1
    const pageSize = parseInt(url.searchParams.get('pageSize')) || 10

    try {
        const listKey = `postcard_list:${user.openid}`
        const data = await KV.get(listKey)
        const allList = data ? JSON.parse(data) : []
        const total = allList.length
        const list = allList.slice((page - 1) * pageSize, page * pageSize)

        // 自动修复缺失缩略图逻辑 (利用 COS 动态参数)
        let needUpdate = false
        list.forEach(item => {
            if (!item.thumbnail && item.image && item.status === 'completed') {
                // 如果没有缩略图，但有原图，且原图是COS地址，则尝试构造缩略图
                if (item.image.includes('.myqcloud.com')) {
                    item.thumbnail = getThumbnailUrl(item.image, 400, 80)
                    needUpdate = true
                }
            }
        })

        if (needUpdate) {
            // 异步更新回 KV，不阻塞当前响应
            const updatedAllList = allList.map(item => {
                if (!item.thumbnail && item.image && item.status === 'completed' && item.image.includes('.myqcloud.com')) {
                    return { ...item, thumbnail: getThumbnailUrl(item.image, 400, 80) }
                }
                return item
            })
            // 这里不 await，让它在后台跑（EdgeOne 可能需要用 ctx.waitUntil，但此处简化处理直接发起）
            KV.put(listKey, JSON.stringify(updatedAllList)).catch(console.error)
        }

        return jsonResponse({ list, total, page, pageSize, totalPages: Math.ceil(total / pageSize), hasMore: page < Math.ceil(total / pageSize) })
    } catch { return errorResponse('获取明信片列表失败', 500) }
}

async function handleGetPostcardDetail(request, env) {
    const user = await getUserFromRequest(request, env)
    if (!user) return errorResponse('未登录', 401)
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return errorResponse('缺少id参数', 400)
    const data = await KV.get(`postcard:${user.openid}:${id}`)
    if (!data) return errorResponse('明信片不存在', 404)
    return jsonResponse(JSON.parse(data))
}

async function handleDeletePostcard(request, env) {
    const user = await getUserFromRequest(request, env)
    if (!user) return errorResponse('未登录', 401)
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return errorResponse('缺少id参数', 400)
    await KV.delete(`postcard:${user.openid}:${id}`)
    const listKey = `postcard_list:${user.openid}`
    const existing = await KV.get(listKey)
    if (existing) {
        const list = JSON.parse(existing).filter(item => item.id !== id)
        await KV.put(listKey, JSON.stringify(list))
    }
    return jsonResponse({ id, deleted: true })
}

async function handleProxyImage(request) {
    const imageUrl = new URL(request.url).searchParams.get('url')
    if (!imageUrl) return errorResponse('缺少url参数', 400)
    try {
        const res = await fetch(imageUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': new URL(imageUrl).origin } })
        if (!res.ok) return errorResponse('获取图片失败', res.status)
        return new Response(await res.arrayBuffer(), {
            headers: { 'Content-Type': res.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' }
        })
    } catch { return errorResponse('图片代理失败', 500) }
}

// ==================== 路由表 ====================

const routes = {
    'POST /user/login': handleLogin,
    'GET /location/city': handleGetCityByLocation,
    'GET /destinations/hot': handleGetHotDestinations,
    'GET /attractions/nearby': handleGetNearbyAttractions,
    'GET /route/driving': handleRouteDriving,
    'GET /route/walking': handleRouteWalking,
    'GET /route/transit': handleRouteTransit,
    'GET /route/day-path': handleGetDayPath,
    'POST /plan/chat': handlePlanChat,
    'POST /plan/generate': handleGeneratePlan,
    'POST /plan/callback': handlePlanCallback,
    // 两步规划流程新增接口
    'POST /plan/generate-options': handleGeneratePlanOptions,
    'POST /plan/options-callback': handleOptionsCallback,
    'GET /plan/options-status': handleGetOptionsStatus,
    'POST /plan/confirm-option': handleConfirmOption,
    'GET /plan/list': handleGetPlanList,
    'GET /plan/detail': handleGetPlanDetail,
    'DELETE /plan/delete': handleDeletePlan,
    'POST /postcard/generate': handleGeneratePostcard,
    'POST /postcard/callback': handlePostcardCallback,
    'GET /postcard/status': handleGetPostcardStatus,
    'GET /postcard/list': handleGetPostcardList,
    'GET /postcard/detail': handleGetPostcardDetail,
    'DELETE /postcard/delete': handleDeletePostcard,
    'GET /proxy/image': handleProxyImage
}

// ==================== Pages Functions 入口 ====================

export async function onRequest(context) {
    const { request, env } = context

    // CORS 预检
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
        // 1. 从 /api/xxx 中提取 /xxx
        let path = url.pathname.replace(/^\/api/, '')

        // 2. 去除末尾斜杠 (Normalize path)
        if (path.length > 1 && path.endsWith('/')) {
            path = path.slice(0, -1)
        }

        const routeKey = `${request.method} ${path}`

        const handler = routes[routeKey]
        if (handler) {
            return await handler(request, env, context)
        }

        // 返回包含调试信息的 404
        return errorResponse(`接口不存在 (Route: ${routeKey})`, 404)
    } catch (err) {
        console.error('函数错误:', err)
        return errorResponse('服务器内部错误: ' + err.message, 500)
    }
}
