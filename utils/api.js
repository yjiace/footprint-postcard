// utils/api.js
// API请求工具类

// 根据环境配置不同的API地址
let BASE_URL = 'https://footprint-postcard-api.smallyoung.cn/api'

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
 */
function request(url, data = {}, method = 'GET', header = {}) {
    return new Promise((resolve, reject) => {
        // 开发环境使用完整URL
        let requestUrl = BASE_URL + url
        
        // 如果是开发环境且BASE_URL是相对路径，使用完整URL
        try {
            const accountInfo = wx.getAccountInfoSync()
            if ((accountInfo.miniProgram.envVersion === 'develop' || accountInfo.miniProgram.envVersion === 'trial') && BASE_URL.startsWith('/')) {
                requestUrl = 'https://footprint-postcard-api.smallyoung.cn/api' + url
            }
        } catch (error) {
            // 保持默认配置
        }
        
        // 获取token并添加到请求头
        const storage = require('./storage.js')
        const token = storage.getToken()
        
        console.log('API请求:', requestUrl, data)
        
        wx.request({
            url: requestUrl,
            data,
            method,
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
 */
function getNearbyAttractions(latitude, longitude, radius = 10) {
    return get('/attractions/nearby', { latitude, longitude, radius })
}

/**
 * 根据位置获取城市信息
 */
function getCityByLocation(latitude, longitude) {
    return get('/location/city', { latitude, longitude })
}

/**
 * 生成行程
 */
function generatePlan(params) {
    return post('/plan/generate', params)
}

/**
 * 保存行程
 */
function savePlan(plan) {
    return post('/plan/save', plan)
}

/**
 * 获取行程列表
 */
function getPlanList() {
    return get('/plan/list')
}

/**
 * 获取行程详情
 */
function getPlanDetail(id) {
    return get('/plan/detail', { id })
}

/**
 * 保存足迹
 */
function saveTrack(track) {
    return post('/track/save', track)
}

/**
 * 获取足迹列表
 */
function getTrackList() {
    return get('/track/list')
}

/**
 * 获取足迹详情
 */
function getTrackDetail(id) {
    return get('/track/detail', { id })
}

/**
 * 生成明信片
 */
function generatePostcard(params) {
    return post('/postcard/generate', params)
}

/**
 * 获取明信片列表
 */
function getPostcardList() {
    return get('/postcard/list')
}

/**
 * 获取明信片详情
 */
function getPostcardDetail(id) {
    return get('/postcard/detail', { id })
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
    savePlan,
    getPlanList,
    getPlanDetail,
    saveTrack,
    getTrackList,
    getTrackDetail,
    generatePostcard,
    getPostcardList,
    getPostcardDetail,
    uploadImage
}
