/**
 * 登录工具函数
 * 提供统一的登录跳转逻辑
 */

/**
 * 跳转到登录页面
 * @param {string} from - 来源页面标识
 * @param {string} redirect - 登录成功后跳转的页面
 */
function navigateToLogin(from = '', redirect = '') {
  let url = '/pages/login/login'
  
  const params = []
  if (from) {
    params.push(`from=${from}`)
  }
  if (redirect) {
    params.push(`redirect=${encodeURIComponent(redirect)}`)
  }
  
  if (params.length > 0) {
    url += '?' + params.join('&')
  }
  
  wx.navigateTo({
    url: url,
    fail: (err) => {
      console.error('跳转登录页面失败', err)
      // 如果跳转失败，尝试使用redirectTo
      wx.redirectTo({
        url: url
      })
    }
  })
}

/**
 * 检查登录状态，未登录则跳转到登录页面
 * @param {string} from - 来源页面标识
 * @param {string} redirect - 登录成功后跳转的页面
 * @returns {boolean} 是否已登录
 */
function checkLogin(from = '', redirect = '') {
  const storage = require('./storage.js')
  
  if (storage.isLoggedIn()) {
    return true
  }
  
  navigateToLogin(from, redirect)
  return false
}

module.exports = {
  navigateToLogin,
  checkLogin
}