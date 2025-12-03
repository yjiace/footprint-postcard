// utils/storage.js
// 本地存储工具类

/**
 * 存储数据
 * @param {String} key 键名
 * @param {Any} value 值
 */
function set(key, value) {
    try {
        wx.setStorageSync(key, value)
        return true
    } catch (e) {
        console.error('存储失败', e)
        return false
    }
}

/**
 * 获取数据
 * @param {String} key 键名
 * @param {Any} defaultValue 默认值
 */
function get(key, defaultValue = null) {
    try {
        const value = wx.getStorageSync(key)
        return value || defaultValue
    } catch (e) {
        console.error('获取失败', e)
        return defaultValue
    }
}

/**
 * 删除数据
 * @param {String} key 键名
 */
function remove(key) {
    try {
        wx.removeStorageSync(key)
        return true
    } catch (e) {
        console.error('删除失败', e)
        return false
    }
}

/**
 * 清空所有数据
 */
function clear() {
    try {
        wx.clearStorageSync()
        return true
    } catch (e) {
        console.error('清空失败', e)
        return false
    }
}

/**
 * 获取所有键名
 */
function getKeys() {
    try {
        const res = wx.getStorageInfoSync()
        return res.keys
    } catch (e) {
        console.error('获取键名失败', e)
        return []
    }
}

// ========== 业务数据存储 ==========

const KEYS = {
    USER_INFO: 'userInfo',
    LOCATION: 'location',
    PLAN_LIST: 'planList',
    TRACK_LIST: 'trackList',
    POSTCARD_LIST: 'postcardList',
    CURRENT_PLAN: 'currentPlan',
    CURRENT_TRACK: 'currentTrack'
}

/**
 * 保存用户信息
 */
function setUserInfo(userInfo) {
    return set(KEYS.USER_INFO, userInfo)
}

/**
 * 获取用户信息
 */
function getUserInfo() {
    return get(KEYS.USER_INFO)
}

/**
 * 删除用户信息
 */
function removeUserInfo() {
    return remove(KEYS.USER_INFO)
}

/**
 * 检查用户是否已登录
 */
function isLoggedIn() {
    const userInfo = getUserInfo()
    return !!(userInfo && userInfo.token)
}

/**
 * 获取用户token
 */
function getToken() {
    const userInfo = getUserInfo()
    return userInfo ? userInfo.token : null
}

/**
 * 保存定位信息
 */
function setLocation(location) {
    return set(KEYS.LOCATION, location)
}

/**
 * 获取定位信息
 */
function getLocation() {
    return get(KEYS.LOCATION)
}

/**
 * 获取详细定位信息（适配新的API数据结构）
 */
function getDetailedLocation() {
    const location = getLocation()
    if (!location) return null
    
    // 返回完整的定位信息，包括新的数据结构字段
    return {
        latitude: location.latitude,
        longitude: location.longitude,
        city: location.city,
        province: location.province,
        district: location.district,
        township: location.township,
        street: location.street,
        streetNumber: location.streetNumber,
        adcode: location.adcode,
        cityCode: location.cityCode,
        formattedAddress: location.formattedAddress,
        location: location.location
    }
}

/**
 * 保存行程列表
 */
function setPlanList(planList) {
    return set(KEYS.PLAN_LIST, planList)
}

/**
 * 获取行程列表
 */
function getPlanList() {
    return get(KEYS.PLAN_LIST, [])
}

/**
 * 添加行程
 */
function addPlan(plan) {
    const planList = getPlanList()
    planList.unshift(plan)
    return setPlanList(planList)
}

/**
 * 保存足迹列表
 */
function setTrackList(trackList) {
    return set(KEYS.TRACK_LIST, trackList)
}

/**
 * 获取足迹列表
 */
function getTrackList() {
    return get(KEYS.TRACK_LIST, [])
}

/**
 * 添加足迹
 */
function addTrack(track) {
    const trackList = getTrackList()
    trackList.unshift(track)
    return setTrackList(trackList)
}

/**
 * 保存明信片列表
 */
function setPostcardList(postcardList) {
    return set(KEYS.POSTCARD_LIST, postcardList)
}

/**
 * 获取明信片列表
 */
function getPostcardList() {
    return get(KEYS.POSTCARD_LIST, [])
}

/**
 * 添加明信片
 */
function addPostcard(postcard) {
    const postcardList = getPostcardList()
    postcardList.unshift(postcard)
    return setPostcardList(postcardList)
}

/**
 * 保存当前行程
 */
function setCurrentPlan(plan) {
    return set(KEYS.CURRENT_PLAN, plan)
}

/**
 * 获取当前行程
 */
function getCurrentPlan() {
    return get(KEYS.CURRENT_PLAN)
}

/**
 * 保存当前足迹
 */
function setCurrentTrack(track) {
    return set(KEYS.CURRENT_TRACK, track)
}

/**
 * 获取当前足迹
 */
function getCurrentTrack() {
    return get(KEYS.CURRENT_TRACK)
}

module.exports = {
    set,
    get,
    remove,
    clear,
    getKeys,
    KEYS,
    setUserInfo,
    getUserInfo,
    removeUserInfo,
    isLoggedIn,
    getToken,
    setLocation,
    getLocation,
    setPlanList,
    getPlanList,
    addPlan,
    setTrackList,
    getTrackList,
    addTrack,
    setPostcardList,
    getPostcardList,
    addPostcard,
    setCurrentPlan,
    getCurrentPlan,
    setCurrentTrack,
    getCurrentTrack
}
