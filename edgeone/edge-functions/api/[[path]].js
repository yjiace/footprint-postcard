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
    return `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
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
    return `https://${env.COS_DOMAIN || host}/${path}`
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
    const res = await fetch(`https://restapi.amap.com/v3/direction/transit/integrated?${params}`)
    const data = await res.json()
    if (data.status !== '1' || !data.route?.transits?.length) throw new Error('公交路径规划失败')
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

        console.log('开始获取热门目的地真实数据...')
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

// ==================== 行程相关 ====================

async function handleGeneratePlan(request, env, context) {
    const user = await getUserFromRequest(request, env)
    if (!user) return errorResponse('未登录', 401)

    const { city, date, days, poiTypes, notes, transportation, accommodation, apiVersion, userLocation } = await request.json()
    if (!city || !date || !days) return errorResponse('缺少必要参数', 400)
    if (!env.PLAN_SERVICE_URL) return errorResponse('服务配置错误：未配置行程规划服务地址', 500)

    const startDate = new Date(date)
    const endDate = new Date(startDate)
    endDate.setDate(endDate.getDate() + days - 1)
    const endDateStr = endDate.toISOString().split('T')[0]

    const planId = generateId('plan_')
    const prefMap = { 'any': '不限', 'nature': '自然风光', 'history': '历史古迹', 'museum': '博物馆', 'amusement': '游乐园', 'food': '美食探店' }
    const transMap = { 'public': '公共交通', 'drive': '自驾', 'walk': '步行为主' }
    const accomMap = { 'budget': '经济型酒店', 'comfort': '舒适型酒店', 'luxury': '豪华型酒店' }

    const translatedPoiTypes = (poiTypes || []).filter(t => t !== 'any').map(t => prefMap[t] || t)
    const translatedTransport = transMap[transportation] || transportation || '公共交通'
    const translatedAccom = accomMap[accommodation] || accommodation || '经济型酒店'

    const pendingPlan = {
        id: planId, openid: user.openid, city, date, endDate: endDateStr, days,
        transportation: translatedTransport, accommodation: translatedAccom, poiTypes: translatedPoiTypes,
        notes, status: 'generating', statusMessage: '正在生成行程...', schedule: [], userLocation, createdAt: Date.now()
    }

    try {
        await KV.put(`plan:${user.openid}:${planId}`, JSON.stringify(pendingPlan))

        const listKey = `plan_list:${user.openid}`
        const existing = await KV.get(listKey)
        const planList = existing ? JSON.parse(existing) : []
        planList.unshift({ id: planId, city, date, endDate: endDateStr, days, status: 'generating', transportation: translatedTransport, accommodation: translatedAccom, poiTypes: translatedPoiTypes, createdAt: pendingPlan.createdAt })
        await KV.put(listKey, JSON.stringify(planList))

        const callbackUrl = new URL(request.url)
        callbackUrl.pathname = '/api/plan/callback'

        // 异步调用腾讯云函数
        // 异步调用腾讯云函数 使用 waitUntil 防止被中断
        context.waitUntil(
            fetch(env.PLAN_SERVICE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    city, start_date: date, end_date: endDateStr, travel_days: days,
                    transportation: transportation || '公共交通', accommodation: accommodation || '经济型酒店',
                    preferences: translatedPoiTypes.length > 0 ? translatedPoiTypes : ['休闲'],
                    free_text_input: notes || '', user_location: userLocation,
                    // 传递所有必要的keys
                    amapKey: env.AMAP_KEY,
                    deepseekKey: env.DEEPSEEK_API_KEY,
                    callback: { url: callbackUrl.toString(), planId, openid: user.openid }
                })
            }).catch(e => console.error('云函数请求失败:', e))
        )

        return jsonResponse(pendingPlan)
    } catch (err) { return errorResponse('创建行程失败: ' + err.message, 500) }
}

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

        // 下载并保存城市封面图片到COS
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

        console.log('行程生成完成(回调):', planId, '城市图片:', cityImage)
        return jsonResponse({ received: true, status: 'completed' })

    } catch (err) {
        console.error('处理N8N回调失败:', err)
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
        '桂林市': ['漓江', '象鼻山', '阳朔'],
        '天津': ['天津之眼', '五大道', '古文化街'],
        '天津市': ['天津之眼', '五大道', '古文化街'],
        '呼和浩特': ['大召寺', '内蒙古博物院', '昭君墓'],
        '呼和浩特市': ['大召寺', '内蒙古博物院', '昭君墓']
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
        '桂林市': ['桂林米粉', '啤酒鱼', '油茶'],
        '天津': ['狗不理包子', '煎饼果子', '麻花'],
        '天津市': ['狗不理包子', '煎饼果子', '麻花'],
        '呼和浩特': ['烤全羊', '手把肉', '奶茶'],
        '呼和浩特市': ['烤全羊', '手把肉', '奶茶']
    }
    return foodMap[city] || ['当地特色小吃', '传统美食', '网红小吃']
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

    // 根据城市生成地标
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
- 手账中的文字内容必须使用中文

请直接生成图片，不需要文字描述。`
}

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

        // 5. 异步调用云函数（不等待）- 避免超时
        const callbackUrl = new URL(request.url)
        callbackUrl.pathname = '/api/postcard/callback'

        // 6. 异步调用云函数（不等待）- 使用 waitUntil
        context.waitUntil(
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
        )

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

        console.log('明信片回调处理完成:', postcardId)
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

/**
 * 测试超时接口
 * 用于验证 EdgeOne 超时配置（300秒）是否能够解决15秒超时问题
 * 使用内部延时测试 EdgeOne 函数能否运行超过默认的 15 秒限制
 */
async function handleTestTimeout(request, env) {
    const url = new URL(request.url)
    const sleepSeconds = parseInt(url.searchParams.get('sleep') || '60')
    const maxSleep = 300 // 最大允许休眠 300 秒

    if (sleepSeconds > maxSleep) {
        return errorResponse(`休眠时间不能超过 ${maxSleep} 秒`, 400)
    }

    const startTime = Date.now()

    try {
        console.log(`开始测试超时：休眠 ${sleepSeconds} 秒`)
        console.log(`开始时间: ${new Date(startTime).toISOString()}`)

        // 使用内部延时测试 EdgeOne 函数能否运行超过 15 秒
        await new Promise(resolve => setTimeout(resolve, sleepSeconds * 1000))

        const endTime = Date.now()
        const elapsedSeconds = ((endTime - startTime) / 1000).toFixed(2)

        console.log(`测试完成`)
        console.log(`结束时间: ${new Date(endTime).toISOString()}`)
        console.log(`实际耗时: ${elapsedSeconds} 秒`)

        return jsonResponse({
            success: true,
            message: `成功完成 ${sleepSeconds} 秒的超时测试`,
            sleepSeconds,
            elapsedSeconds: parseFloat(elapsedSeconds),
            startTime: new Date(startTime).toISOString(),
            endTime: new Date(endTime).toISOString(),
            description: 'EdgeOne 函数成功运行超过默认 15 秒超时限制'
        })


    } catch (err) {
        const endTime = Date.now()
        const elapsedSeconds = ((endTime - startTime) / 1000).toFixed(2)

        console.error('测试超时失败:', err.message)
        console.error(`失败时间: ${new Date(endTime).toISOString()}`)
        console.error(`已耗时: ${elapsedSeconds} 秒`)

        return jsonResponse({
            success: false,
            message: '超时测试失败',
            error: err.message,
            errorStack: err.stack,
            sleepSeconds,
            elapsedSeconds: parseFloat(elapsedSeconds),
            startTime: new Date(startTime).toISOString(),
            endTime: new Date(endTime).toISOString()
        }, 500, '测试失败')
    }
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
    'GET /route/day-path': handleGetDayPath, // 新增排期路线接口
    'POST /plan/generate': handleGeneratePlan,
    'POST /plan/callback': handlePlanCallback,
    'GET /plan/list': handleGetPlanList,
    'GET /plan/detail': handleGetPlanDetail,
    'DELETE /plan/delete': handleDeletePlan,
    'POST /postcard/generate': handleGeneratePostcard,
    'POST /postcard/callback': handlePostcardCallback,
    'GET /postcard/status': handleGetPostcardStatus,
    'GET /postcard/list': handleGetPostcardList,
    'GET /postcard/detail': handleGetPostcardDetail,
    'DELETE /postcard/delete': handleDeletePostcard,
    'GET /proxy/image': handleProxyImage,
    'GET /test/timeout': handleTestTimeout  // 测试超时配置接口
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

        console.log(`[Router] Request: ${request.url}, RouteKey: ${routeKey}`)

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
