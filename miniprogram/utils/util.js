// utils/util.js
// 通用工具函数

/**
 * 格式化时间
 */
function formatTime(date) {
    const year = date.getFullYear()
    const month = date.getMonth() + 1
    const day = date.getDate()
    const hour = date.getHours()
    const minute = date.getMinutes()
    const second = date.getSeconds()

    return `${[year, month, day].map(formatNumber).join('-')} ${[hour, minute, second].map(formatNumber).join(':')}`
}

/**
 * 格式化日期
 */
function formatDate(date) {
    const year = date.getFullYear()
    const month = date.getMonth() + 1
    const day = date.getDate()

    return `${[year, month, day].map(formatNumber).join('-')}`
}

/**
 * 数字补零
 */
function formatNumber(n) {
    n = n.toString()
    return n[1] ? n : `0${n}`
}

/**
 * 防抖函数
 */
function debounce(fn, delay = 500) {
    let timer = null
    return function (...args) {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
            fn.apply(this, args)
        }, delay)
    }
}

/**
 * 节流函数
 */
function throttle(fn, delay = 500) {
    let lastTime = 0
    return function (...args) {
        const now = Date.now()
        if (now - lastTime >= delay) {
            fn.apply(this, args)
            lastTime = now
        }
    }
}

/**
 * 深拷贝
 */
function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj
    if (obj instanceof Date) return new Date(obj)
    if (obj instanceof Array) {
        return obj.map(item => deepClone(item))
    }
    const cloneObj = {}
    for (let key in obj) {
        if (obj.hasOwnProperty(key)) {
            cloneObj[key] = deepClone(obj[key])
        }
    }
    return cloneObj
}

/**
 * 生成唯一ID
 */
function generateId() {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * 显示加载提示
 */
function showLoading(title = '加载中...') {
    wx.showLoading({
        title,
        mask: true
    })
}

/**
 * 隐藏加载提示
 */
function hideLoading() {
    wx.hideLoading()
}

/**
 * 显示成功提示
 */
function showSuccess(title = '操作成功') {
    wx.showToast({
        title,
        icon: 'success',
        duration: 2000
    })
}

/**
 * 显示失败提示
 */
function showError(title = '操作失败') {
    wx.showToast({
        title,
        icon: 'none',
        duration: 2000
    })
}

/**
 * 显示确认对话框
 */
function showConfirm(content, title = '提示') {
    return new Promise((resolve, reject) => {
        wx.showModal({
            title,
            content,
            success: res => {
                if (res.confirm) {
                    resolve(true)
                } else {
                    resolve(false)
                }
            },
            fail: reject
        })
    })
}

/**
 * 保存图片到相册
 */
function saveImageToAlbum(filePath) {
    return new Promise((resolve, reject) => {
        wx.saveImageToPhotosAlbum({
            filePath,
            success: resolve,
            fail: err => {
                if (err.errMsg.includes('auth deny')) {
                    wx.showModal({
                        title: '提示',
                        content: '需要您授权保存相册',
                        confirmText: '去设置',
                        success: modalRes => {
                            if (modalRes.confirm) {
                                wx.openSetting()
                            }
                        }
                    })
                }
                reject(err)
            }
        })
    })
}

/**
 * 分享到微信
 */
function shareToWeChat(title, imageUrl, path) {
    return {
        title,
        imageUrl,
        path
    }
}

/**
 * 预览图片
 */
function previewImage(current, urls) {
    wx.previewImage({
        current,
        urls
    })
}

/**
 * 拨打电话
 */
function makePhoneCall(phoneNumber) {
    wx.makePhoneCall({
        phoneNumber
    })
}

/**
 * 复制文本
 */
function setClipboardData(data) {
    return new Promise((resolve, reject) => {
        wx.setClipboardData({
            data,
            success: () => {
                showSuccess('复制成功')
                resolve()
            },
            fail: reject
        })
    })
}

module.exports = {
    formatTime,
    formatDate,
    formatNumber,
    debounce,
    throttle,
    deepClone,
    generateId,
    showLoading,
    hideLoading,
    showSuccess,
    showError,
    showConfirm,
    saveImageToAlbum,
    shareToWeChat,
    previewImage,
    makePhoneCall,
    setClipboardData
}
