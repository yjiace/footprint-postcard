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

    const url = `https://restapi.amap.com/v3/geocode/regeo?location=${longitude},${latitude}&key=${env.AMAP_KEY}&radius=1000&extensions=base&output=json`

    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; CloudflareWorker/1.0)'
        }
    })
    const data = await response.json()

    if (data.status !== '1') {
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
 */
async function searchNearbyPOI(longitude, latitude, radius, keywords, env) {

    const url = `https://restapi.amap.com/v3/place/around?location=${longitude},${latitude}&keywords=${keywords}&types=风景名胜|公园广场&radius=${radius}&offset=20&page=1&key=${env.AMAP_KEY}&extensions=all&output=json`

    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; CloudflareWorker/1.0)'
        }
    })
    const data = await response.json()

    if (data.status !== '1') {
        throw new Error(data.info || '搜索周边POI失败')
    }

    return data.pois || []
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

/**
 * 3. 获取热门目的地
 */
async function handleGetHotDestinations(request, env) {
    // 从KV获取或返回默认数据
    const cached = await env.KV.get('hot_destinations')
    if (cached) {
        return jsonResponse(JSON.parse(cached))
    }

    // 默认数据
    const destinations = [
        {
            id: 1,
            name: '桂林',
            image: 'https://images.unsplash.com/photo-1570168007204-dfb528c6958f?w=800',
            description: '山水甲天下'
        },
        {
            id: 2,
            name: '西安',
            image: 'https://images.unsplash.com/photo-1547981609-4b6bfe67ca0b?w=800',
            description: '千年古都'
        },
        {
            id: 3,
            name: '元阳梯田',
            image: 'https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=800',
            description: '云南美景'
        }
    ]

    // 缓存1天
    await env.KV.put('hot_destinations', JSON.stringify(destinations), { expirationTtl: 86400 })

    return jsonResponse(destinations)
}

/**
 * 4. 获取周边景点 (改用高德地图)
 */
async function handleGetNearbyAttractions(request, env) {
    const url = new URL(request.url)
    const latitude = parseFloat(url.searchParams.get('latitude'))
    const longitude = parseFloat(url.searchParams.get('longitude'))
    const radius = parseInt(url.searchParams.get('radius') || '10')
    const keywords = url.searchParams.get('keywords') || '景点'

    if (!latitude || !longitude) {
        return errorResponse('缺少经纬度参数', 400)
    }

    try {
        const pois = await searchNearbyPOI(longitude, latitude, radius * 1000, keywords, env)

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

        return jsonResponse(attractions)
    } catch (err) {
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
        return jsonResponse(mockData)
    }
}

/**
 * 5. AI生成行程 - 调用N8N智能旅行规划工作流
 */
async function handleGeneratePlan(request, env) {
    const user = await getUserFromRequest(request, env)
    if (!user) {
        return errorResponse('未登录', 401)
    }

    const body = await request.json()
    const { city, date, days, poiTypes, notes, transportation, accommodation } = body

    if (!city || !date || !days) {
        return errorResponse('缺少必要参数', 400)
    }

    // 检查N8N工作流URL是否配置
    if (!env.N8N_WORKFLOW_URL) {
        return errorResponse('服务配置错误：未配置N8N工作流地址', 500)
    }

    try {
        // 计算结束日期
        const startDate = new Date(date)
        const endDate = new Date(startDate)
        endDate.setDate(endDate.getDate() + days - 1)
        const endDateStr = endDate.toISOString().split('T')[0]

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

        // 调用N8N工作流
        const n8nResponse = await fetch(env.N8N_WORKFLOW_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Cloudflare-Worker/1.0'
            },
            body: JSON.stringify(n8nRequest)
        })

        if (!n8nResponse.ok) {
            console.error('N8N工作流返回错误:', n8nResponse.status)
            return errorResponse('AI生成行程失败，请稍后重试', 500)
        }

        const n8nResult = await n8nResponse.json()
        console.log('N8N工作流响应:', JSON.stringify(n8nResult).substring(0, 500))

        // 处理N8N返回的数据（可能是数组或对象）
        let planData = Array.isArray(n8nResult) ? n8nResult[0] : n8nResult

        // 检查是否生成成功
        if (!planData.success) {
            console.error('N8N工作流生成失败:', planData.message)
            return errorResponse(planData.message || 'AI生成行程失败', 500)
        }

        // 提取行程数据
        const tripPlan = planData.data

        // 生成行程ID
        const planId = generateId('plan_')

        // 构建最终返回的行程对象
        const plan = {
            id: planId,
            city: tripPlan.city || city,
            date: tripPlan.start_date || date,
            endDate: tripPlan.end_date || endDateStr,
            days: days,
            transportation: transportation || '公共交通',
            accommodation: accommodation || '经济型酒店',
            poiTypes: poiTypes,
            notes: notes,
            // N8N返回的详细数据
            schedule: tripPlan.days || [],
            weatherInfo: tripPlan.weather_info || [],
            budget: tripPlan.budget || {},
            overallSuggestions: tripPlan.overall_suggestions || '',
            createdAt: Date.now()
        }

        // 保存到KV
        await env.KV.put(`plan:${user.openid}:${planId}`, JSON.stringify(plan))

        // 更新用户的行程列表
        const listKey = `plan_list:${user.openid}`
        const existingList = await env.KV.get(listKey)
        const planList = existingList ? JSON.parse(existingList) : []
        planList.unshift({
            id: planId,
            city: plan.city,
            date: plan.date,
            endDate: plan.endDate,
            days: plan.days,
            createdAt: plan.createdAt
        })
        await env.KV.put(listKey, JSON.stringify(planList))

        return jsonResponse(plan)
    } catch (err) {
        console.error('生成行程失败:', err)
        return errorResponse('生成行程失败: ' + err.message, 500)
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
 * 12. AI生成明信片
 */
async function handleGeneratePostcard(request, env) {
    const user = await getUserFromRequest(request, env)
    if (!user) {
        return errorResponse('未登录', 401)
    }

    const body = await request.json()
    const { type, sourceId, photos } = body

    if (!type || !sourceId) {
        return errorResponse('缺少必要参数', 400)
    }

    try {
        // TODO: 调用AI API生成明信片
        const postcardId = generateId('postcard_')
        const postcard = {
            id: postcardId,
            title: '美好的旅行回忆',
            image: photos && photos[0] ? photos[0] : 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600',
            date: new Date().toISOString().split('T')[0],
            description: '这是一段美好的旅行回忆...',
            createdAt: Date.now()
        }

        return jsonResponse(postcard)
    } catch (err) {
        return errorResponse('生成失败', 500)
    }
}

/**
 * 13. 获取明信片列表（支持分页）
 */
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
 * 15. 上传图片
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
    'GET /plan/list': handleGetPlanList,
    'GET /plan/detail': handleGetPlanDetail,
    'DELETE /plan/delete': handleDeletePlan,

    // 明信片相关
    'POST /postcard/generate': handleGeneratePostcard,
    'GET /postcard/list': handleGetPostcardList,
    'GET /postcard/detail': handleGetPostcardDetail,

    // 文件上传
    'POST /upload/image': handleUploadImage
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

            const handler = routes[routeKey]

            if (handler) {
                return await handler(request, env)
            }

            return errorResponse('接口不存在', 404)
        } catch (err) {
            console.error('Worker错误:', err)
            return errorResponse('服务器内部错误', 500)
        }
    }
}