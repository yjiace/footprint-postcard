// utils/map.js
// 基础位置工具类（已移除腾讯地图相关功能）

/**
 * 获取当前位置
 */
function getLocation() {
    return new Promise((resolve, reject) => {
        wx.getLocation({
            type: 'gcj02',
            success: res => {
                resolve({
                    latitude: res.latitude,
                    longitude: res.longitude
                })
            },
            fail: err => {
                console.error('获取位置失败', err)
                // 如果用户拒绝授权,引导用户打开设置
                wx.showModal({
                    title: '提示',
                    content: '需要获取您的位置信息,请前往设置页面授权',
                    confirmText: '去设置',
                    success: modalRes => {
                        if (modalRes.confirm) {
                            wx.openSetting()
                        }
                    }
                })
                reject(err)
            }
        })
    })
}

/**
 * 计算两点之间的距离(米)
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000 // 地球半径(米)
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLon = (lon2 - lon1) * Math.PI / 180
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
}

/**
 * 格式化距离显示
 */
function formatDistance(distance) {
    if (distance < 1000) {
        return distance.toFixed(0) + 'm'
    } else {
        return (distance / 1000).toFixed(1) + 'km'
    }
}

/**
 * 计算轨迹总距离
 */
function calculateTrackDistance(points) {
    let totalDistance = 0
    for (let i = 0; i < points.length - 1; i++) {
        const distance = calculateDistance(
            points[i].latitude,
            points[i].longitude,
            points[i + 1].latitude,
            points[i + 1].longitude
        )
        totalDistance += distance
    }
    return totalDistance
}

/**
 * 计算轨迹时长(秒)
 */
function calculateTrackDuration(points) {
    if (points.length < 2) return 0
    const startTime = points[0].timestamp
    const endTime = points[points.length - 1].timestamp
    return Math.floor((endTime - startTime) / 1000)
}

/**
 * 格式化时长显示
 */
function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60

    if (hours > 0) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    } else {
        return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }
}

/**
 * 计算平均速度(km/h)
 */
function calculateAverageSpeed(distance, duration) {
    if (duration === 0) return 0
    return (distance / 1000) / (duration / 3600)
}

/**
 * 开始持续定位
 */
function startLocationUpdate(callback) {
    wx.startLocationUpdate({
        success: () => {
            wx.onLocationChange(callback)
        },
        fail: err => {
            console.error('开始定位失败', err)
        }
    })
}

/**
 * 停止持续定位
 */
function stopLocationUpdate() {
    wx.stopLocationUpdate({
        success: () => {
            wx.offLocationChange()
        }
    })
}

/**
 * 打开地图选择位置
 */
function chooseLocation() {
    return new Promise((resolve, reject) => {
        wx.chooseLocation({
            success: res => {
                resolve(res)
            },
            fail: err => {
                reject(err)
            }
        })
    })
}

/**
 * 打开地图查看位置
 */
function openLocation(latitude, longitude, name = '', address = '') {
    wx.openLocation({
        latitude,
        longitude,
        name,
        address,
        scale: 15
    })
}

module.exports = {
    getLocation,
    calculateDistance,
    formatDistance,
    calculateTrackDistance,
    calculateTrackDuration,
    formatDuration,
    calculateAverageSpeed,
    startLocationUpdate,
    stopLocationUpdate,
    chooseLocation,
    openLocation
}
