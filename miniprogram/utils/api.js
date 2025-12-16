// utils/api.js
// API请求工具类

// 根据环境配置不同的API地址
let BASE_URL = 'https://fp.smallyoung.cn/api'

// 开发环境使用本地代理
// 微信小程序环境判断：使用 wx.getAccountInfoSync() 获取环境信息
try {
    const accountInfo = wx.getAccountInfoSync()
    // 开发环境：使用微信开发者工具或体验版
    if (accountInfo.miniProgram.envVersion === 'develop' || accountInfo.miniProgram.envVersion === 'trial') {
        BASE_URL = '/api'
        console.log('使用开发环境API配置')
    }
} catch (error) {
    // 保持默认配置
    console.log('使用生产环境API配置')
}

/**
 * 封装wx.request
 * @param {String} url 请求地址
 * @param {Object} data 请求参数
 * @param {String} method 请求方法
 * @param {Object} header 请求头
 * @param {Number} timeout 超时时间（毫秒），默认60000，最大180000
 */
function request(url, data = {}, method = 'GET', header = {}, timeout = 60000) {
    return new Promise((resolve, reject) => {
        // 开发环境使用完整URL
        let requestUrl = BASE_URL + url

        // 如果是开发环境且BASE_URL是相对路径，使用完整URL
        try {
            const accountInfo = wx.getAccountInfoSync()
            if ((accountInfo.miniProgram.envVersion === 'develop' || accountInfo.miniProgram.envVersion === 'trial') && BASE_URL.startsWith('/')) {
                requestUrl = 'https://fp.smallyoung.cn/api' + url
            }
        } catch (error) {
            // 保持默认配置
        }

        // 获取token并添加到请求头
        const storage = require('./storage.js')
        const token = storage.getToken()

        console.log('API请求:', requestUrl, data, '超时:', timeout)

        wx.request({
            url: requestUrl,
            data,
            method,
            timeout: timeout,  // 设置超时时间
            header: {
                'content-type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : '',
                ...header
            },
            success: res => {
                console.log('API响应:', res)
                if (res.statusCode === 200) {
                    // 处理嵌套的API响应结构
                    if (res.data && res.data.code === 200) {
                        resolve(res.data.data || res.data)
                    } else if (res.data && res.data.code) {
                        // API返回业务错误
                        reject(res.data)
                    } else {
                        // 直接返回数据
                        resolve(res.data)
                    }
                } else if (res.statusCode === 401) {
                    // 401错误：未登录，触发登录引导
                    console.error('用户未登录，需要重新登录')

                    // 获取当前页面路径，用于登录后跳转
                    const pages = getCurrentPages()
                    const currentPage = pages[pages.length - 1]
                    const currentRoute = currentPage.route

                    wx.showModal({
                        title: '登录提示',
                        content: '您需要登录后才能继续操作',
                        confirmText: '去登录',
                        cancelText: '取消',
                        success: (modalRes) => {
                            if (modalRes.confirm) {
                                // 跳转到登录页面，并传递当前页面路径用于回调
                                wx.redirectTo({
                                    url: `/pages/login/login?redirect=/${currentRoute}`
                                })
                            }
                        }
                    })
                    reject(res)
                } else {
                    console.error('API请求失败:', res)
                    wx.showToast({
                        title: '请求失败',
                        icon: 'none'
                    })
                    reject(res)
                }
            },
            fail: err => {
                console.error('API网络错误:', err)
                wx.showToast({
                    title: '网络错误',
                    icon: 'none'
                })
                reject(err)
            }
        })
    })
}

/**
 * GET请求
 */
function get(url, data = {}) {
    return request(url, data, 'GET')
}

/**
 * POST请求
 */
function post(url, data = {}) {
    return request(url, data, 'POST')
}

/**
 * PUT请求
 */
function put(url, data = {}) {
    return request(url, data, 'PUT')
}

/**
 * DELETE请求
 */
function del(url, data = {}) {
    return request(url, data, 'DELETE')
}

// ========== 具体业务接口 ==========

/**
 * 用户登录
 */
function login(code) {
    return post('/user/login', { code })
}

/**
 * 获取热门目的地
 */
function getHotDestinations() {
    return get('/destinations/hot')
}

/**
 * 获取周边景点
 * @param {Number} latitude 纬度
 * @param {Number} longitude 经度
 * @param {Number} radius 搜索半径（公里）
 * @param {String} types POI类型，默认"风景名胜|公园广场"
 * @param {Number} page 页码，默认1
 * @param {Number} pageSize 每页数量，默认20
 * @param {String} keywords 搜索关键字，可选
 */
function getNearbyAttractions(latitude, longitude, radius = 10, types = '风景名胜|公园广场', page = 1, pageSize = 20, keywords = '') {
    const params = { latitude, longitude, radius, types, page, pageSize }
    if (keywords) {
        params.keywords = keywords
    }
    return get('/attractions/nearby', params)
}

/**
 * 根据位置获取城市信息
 */
function getCityByLocation(latitude, longitude) {
    return get('/location/city', { latitude, longitude })
}

/**
 * 生成行程（使用180秒超时，等待AI生成）
 * @param {Object} params 行程参数
 * @param {String} params.apiVersion API版本，可选，如 'v2'，默认 'v2'
 */
function generatePlan(params) {
    // 默认使用v2版本API
    const requestParams = {
        ...params,
        apiVersion: params.apiVersion || 'v2'
    }
    // 使用180秒超时（微信小程序最大允许值），因为AI生成行程需要较长时间
    return request('/plan/generate', requestParams, 'POST', {}, 180000)
}

/**
 * 获取行程列表（支持分页）
 */
function getPlanList(page = 1, pageSize = 10) {
    return get('/plan/list', { page, pageSize })
}

/**
 * 获取行程详情
 */
function getPlanDetail(id) {
    return get('/plan/detail', { id })
}

/**
 * 删除行程
 */
function deletePlan(id) {
    return del(`/plan/delete?id=${id}`)
}

/**
 * 生成明信片（使用300秒超时，等待AI生成图片）
 */
function generatePostcard(params) {
    return request('/postcard/generate', params, 'POST', {}, 300000)
}

/**
 * 获取明信片列表（支持分页）
 */
function getPostcardList(page = 1, pageSize = 10) {
    return get('/postcard/list', { page, pageSize })
}

/**
 * 获取明信片详情
 */
function getPostcardDetail(id) {
    return get('/postcard/detail', { id })
}

/**
 * 删除明信片
 */
function deletePostcard(id) {
    return del(`/postcard/delete?id=${id}`)
}

/**
 * 根据行程ID生成明信片（异步模式，立即返回 pending 状态）
 */
function generatePostcardFromPlan(planId) {
    // 异步模式下，服务器会立即返回 pending 状态，60秒足够
    return request('/postcard/generate', { planId }, 'POST', {}, 60000)
}

/**
 * 获取明信片生成状态（用于轮询）
 * @param {String} postcardId 明信片ID
 */
function getPostcardStatus(postcardId) {
    return get('/postcard/status', { id: postcardId })
}

/**
 * 上传图片
 */
function uploadImage(filePath) {
    return new Promise((resolve, reject) => {
        wx.uploadFile({
            url: BASE_URL + '/upload/image',
            filePath,
            name: 'file',
            success: res => {
                const data = JSON.parse(res.data)
                resolve(data)
            },
            fail: err => {
                wx.showToast({
                    title: '上传失败',
                    icon: 'none'
                })
                reject(err)
            }
        })
    })
}

/**
 * 获取代理后的图片URL
 * 将第三方图片URL转换为通过Worker代理的URL，解决微信小程序域名限制
 * @param {String} imageUrl 原始图片URL
 * @returns {String} 代理后的图片URL
 */
function getProxiedImageUrl(imageUrl) {
    // 如果是空值或本地图片，直接返回
    if (!imageUrl || imageUrl.startsWith('/')) {
        return imageUrl
    }

    // 构建代理URL
    const proxyBaseUrl = 'https://fp.smallyoung.cn/api/proxy/image'
    return `${proxyBaseUrl}?url=${encodeURIComponent(imageUrl)}`
}

/**
 * 批量处理图片URL代理
 * @param {Array} items 包含 image 字段的对象数组
 * @returns {Array} 处理后的对象数组
 */
function proxyImageUrls(items) {
    if (!Array.isArray(items)) return items
    return items.map(item => ({
        ...item,
        image: getProxiedImageUrl(item.image)
    }))
}

// ========== 路径规划接口 ==========

/**
 * 驾车路径规划
 * @param {String} origin 起点坐标 "lng,lat"
 * @param {String} destination 终点坐标 "lng,lat"
 */
function getRouteDriving(origin, destination) {
    return get('/route/driving', { origin, destination })
}

/**
 * 步行路径规划
 * @param {String} origin 起点坐标 "lng,lat"
 * @param {String} destination 终点坐标 "lng,lat"
 */
function getRouteWalking(origin, destination) {
    return get('/route/walking', { origin, destination })
}

/**
 * 公交路径规划
 * @param {String} origin 起点坐标 "lng,lat"
 * @param {String} destination 终点坐标 "lng,lat"
 * @param {String} city 城市名称
 */
function getRouteTransit(origin, destination, city) {
    return get('/route/transit', { origin, destination, city })
}

/**
 * 获取当天全程路径（支持缓存）
 * @param {String} planId 行程ID
 * @param {Number} dayIndex 天数索引（从0开始）
 * @param {String} mode 交通方式: driving | walking | transit
 */
function getDayPath(planId, dayIndex, mode = 'driving') {
    // 使用较长超时时间（120秒），因为需要为多个景点调用路径规划 API
    return request('/route/day-path', { planId, dayIndex, mode }, 'GET', {}, 120000)
}

module.exports = {
    request,
    get,
    post,
    put,
    del,
    login,
    getHotDestinations,
    getNearbyAttractions,
    getCityByLocation,
    generatePlan,
    getPlanList,
    getPlanDetail,
    deletePlan,

    generatePostcard,
    getPostcardList,
    getPostcardDetail,
    deletePostcard,
    generatePostcardFromPlan,
    getPostcardStatus,
    uploadImage,

    // 图片代理工具
    getProxiedImageUrl,
    proxyImageUrls,

    // 路径规划
    getRouteDriving,
    getRouteWalking,
    getRouteTransit,
    getDayPath
}


