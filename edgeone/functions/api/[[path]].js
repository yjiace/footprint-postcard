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
        // 检查 KV 是否可用（EdgeOne 中 KV 是全局变量）
        if (typeof KV === 'undefined') {
            return errorResponse('KV 存储未配置，请在 EdgeOne 控制台绑定 KV 命名空间', 500)
        }
        const cached = await KV.get('hot_destinations')
        if (cached) return jsonResponse(JSON.parse(cached))
        const destinations = HOT_CITIES.map((c, i) => ({
            id: i + 1, name: c.name, image: `https://picsum.photos/seed/${c.name}/800/400`, description: c.description, landmark: c.keywords
        }))
        await KV.put('hot_destinations', JSON.stringify(destinations), { expirationTtl: 604800 })
        return jsonResponse(destinations)
    } catch (err) {
        return errorResponse(`热门目的地获取失败: ${err.message}`, 500)
    }
}

async function handleGetNearbyAttractions(request, env) {
    const url = new URL(request.url)
    const lat = parseFloat(url.searchParams.get('latitude'))
    const lng = parseFloat(url.searchParams.get('longitude'))
    const radius = parseInt(url.searchParams.get('radius') || '10')
    const keywords = url.searchParams.get('keywords') || '景点'
    const types = url.searchParams.get('types') || '风景名胜|公园广场'
    const page = parseInt(url.searchParams.get('page') || '1')
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20')
    if (!lat || !lng) return errorResponse('缺少经纬度参数', 400)
    try {
        const result = await searchNearbyPOI(lng, lat, radius * 1000, keywords, env, types, page, pageSize)
        const list = result.pois.map((p, i) => {
            const loc = p.location?.split(',') || ['0', '0']
            return {
                id: p.id || String(i + 1), name: p.name || '未知景点',
                image: p.photos?.[0]?.url || 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=400',
                tags: p.type || '景点', distance: p.distance ? `${(p.distance / 1000).toFixed(1)}km` : '未知',
                address: p.address || '', latitude: parseFloat(loc[1]), longitude: parseFloat(loc[0])
            }
        })
        return jsonResponse({ list, total: result.total, page, pageSize, hasMore: list.length >= pageSize })
    } catch (err) { return errorResponse(err.message, 500) }
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

// ==================== 行程相关 ====================

async function handleGeneratePlan(request, env) {
    const user = await getUserFromRequest(request, env)
    if (!user) return errorResponse('未登录', 401)

    const { city, date, days, poiTypes, notes, transportation, accommodation, apiVersion, userLocation } = await request.json()
    if (!city || !date || !days) return errorResponse('缺少必要参数', 400)
    if (!env.N8N_WORKFLOW_URL) return errorResponse('服务配置错误', 500)

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

        let n8nUrl = env.N8N_WORKFLOW_URL
        if (apiVersion) n8nUrl = n8nUrl.replace(/\/$/, '') + '/' + apiVersion

        fetch(n8nUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                city, start_date: date, end_date: endDateStr, travel_days: days,
                transportation: transportation || '公共交通', accommodation: accommodation || '经济型酒店',
                preferences: translatedPoiTypes.length > 0 ? translatedPoiTypes : ['休闲'],
                free_text_input: notes || '', user_location: userLocation,
                callback: { url: callbackUrl.toString(), planId, openid: user.openid }
            })
        }).catch(e => console.error('N8N请求失败:', e))

        return jsonResponse(pendingPlan)
    } catch (err) { return errorResponse('创建行程失败: ' + err.message, 500) }
}

async function handlePlanCallback(request, env) {
    const { planId, openid, success, data, message } = await request.json()
    if (!planId || !openid) return errorResponse('缺少参数', 400)

    if (!success) {
        const planKey = `plan:${openid}:${planId}`
        const planData = await KV.get(planKey)
        if (planData) {
            const plan = JSON.parse(planData)
            plan.status = 'failed'
            plan.statusMessage = message || 'AI生成失败'
            await KV.put(planKey, JSON.stringify(plan))
        }
        return jsonResponse({ received: true, status: 'failed' })
    }

    const planKey = `plan:${openid}:${planId}`
    const existingData = await KV.get(planKey)
    if (!existingData) return errorResponse('行程不存在', 404)

    const existingPlan = JSON.parse(existingData)
    const tripPlan = data

    const completedPlan = {
        ...existingPlan,
        city: tripPlan.city || existingPlan.city,
        date: tripPlan.start_date || existingPlan.date,
        endDate: tripPlan.end_date || existingPlan.endDate,
        status: 'completed', statusMessage: '',
        schedule: tripPlan.days || [],
        weatherInfo: tripPlan.weather_info || [],
        budget: tripPlan.budget || {},
        overallSuggestions: tripPlan.overall_suggestions || '',
        routeInfo: tripPlan.route_info || [],
        completedAt: Date.now()
    }

    await KV.put(planKey, JSON.stringify(completedPlan))

    const listKey = `plan_list:${openid}`
    const listData = await KV.get(listKey)
    if (listData) {
        const list = JSON.parse(listData)
        const item = list.find(p => p.id === planId)
        if (item) item.status = 'completed'
        await KV.put(listKey, JSON.stringify(list))
    }

    return jsonResponse({ received: true, status: 'completed' })
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

async function handleGeneratePostcard(request, env) {
    const user = await getUserFromRequest(request, env)
    if (!user) return errorResponse('未登录', 401)

    const { planId } = await request.json()
    if (!planId) return errorResponse('缺少行程ID', 400)

    // 检查每日限制
    const today = new Date().toISOString().split('T')[0]
    const countKey = `postcard_count:${user.openid}:${today}`
    const count = parseInt(await KV.get(countKey) || '0')
    if (count >= 3) return errorResponse('今日生成次数已达上限（3次）', 429)
    await KV.put(countKey, String(count + 1), { expirationTtl: 86400 })

    if (!env.KUAI_API_KEY) return errorResponse('服务配置错误', 500)

    const planData = await KV.get(`plan:${user.openid}:${planId}`)
    if (!planData) return errorResponse('行程不存在', 404)
    const plan = JSON.parse(planData)

    const apiUrl = `${env.KUAI_API_BASE || 'https://api.kuai.host'}/v1beta/models/${env.KUAI_MODEL || 'gemini-3-pro-image-preview'}:generateContent`
    const prompt = `请绘制一张色彩鲜艳、竖版（3:4）手绘风格的《${plan.city}旅行明信片》。请直接生成图片。`

    const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.KUAI_API_KEY}` },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '3:4', imageSize: '2K' } }
        })
    })

    if (!res.ok) return errorResponse('AI生成图片失败', 500)

    const result = await res.json()
    let imageUrl = 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600'
    let imageData = null

    const parts = result.candidates?.[0]?.content?.parts
    if (parts) {
        for (const p of parts) {
            if (p.inlineData?.data || p.inline_data?.data) {
                imageData = p.inlineData?.data || p.inline_data?.data
                break
            }
        }
    }

    const timestamp = Date.now()
    const postcardId = generateId('postcard_')

    if (imageData && env.COS_SECRET_ID) {
        const path = `postcards/${user.openid}/${timestamp}.png`
        const buffer = Uint8Array.from(atob(imageData), c => c.charCodeAt(0))
        imageUrl = await uploadToCOS(env, path, buffer, 'image/png')
    }

    const thumbnailUrl = getThumbnailUrl(imageUrl, 400, 80)
    const postcard = {
        id: postcardId, planId, title: `${plan.city}之旅`, image: imageUrl, thumbnail: thumbnailUrl,
        city: plan.city, date: plan.date, endDate: plan.endDate, days: plan.days,
        description: `${plan.city} ${plan.days}天${plan.days - 1}晚精彩旅程`, createdAt: Date.now()
    }

    await KV.put(`postcard:${user.openid}:${postcardId}`, JSON.stringify(postcard))

    const listKey = `postcard_list:${user.openid}`
    const existing = await KV.get(listKey)
    const list = existing ? JSON.parse(existing) : []
    list.unshift({ id: postcardId, title: postcard.title, image: imageUrl, thumbnail: thumbnailUrl, city: plan.city, date: plan.date, createdAt: postcard.createdAt })
    await KV.put(listKey, JSON.stringify(list))

    return jsonResponse(postcard)
}

async function handleGetPostcardList(request, env) {
    const user = await getUserFromRequest(request, env)
    if (!user) return errorResponse('未登录', 401)
    const url = new URL(request.url)
    const page = parseInt(url.searchParams.get('page')) || 1
    const pageSize = parseInt(url.searchParams.get('pageSize')) || 10
    const data = await KV.get(`postcard_list:${user.openid}`)
    const allList = data ? JSON.parse(data) : []
    const total = allList.length
    const list = allList.slice((page - 1) * pageSize, page * pageSize)
    return jsonResponse({ list, total, page, pageSize, totalPages: Math.ceil(total / pageSize), hasMore: page < Math.ceil(total / pageSize) })
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
        // 从 /api/xxx 中提取 /xxx
        const path = url.pathname.replace(/^\/api/, '')
        const routeKey = `${request.method} ${path}`

        const handler = routes[routeKey]
        if (handler) {
            return await handler(request, env, context)
        }

        return errorResponse('接口不存在', 404)
    } catch (err) {
        console.error('函数错误:', err)
        return errorResponse('服务器内部错误', 500)
    }
}
