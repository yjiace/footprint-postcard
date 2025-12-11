// app.js
App({
  onLaunch() {
    // 加载 Material Symbols 字体
    wx.loadFontFace({
      family: 'Material Symbols Outlined',
      source: 'url("/fonts/material-icons.woff2")',
      global: true,
      success: console.log,
      fail: console.error
    })

    // 展示本地存储能力
    const logs = wx.getStorageSync('logs') || []
    logs.unshift(Date.now())
    wx.setStorageSync('logs', logs)

    // 登录
    this.login()

    // 获取用户信息
    this.getUserInfo()

    // 获取系统信息
    this.getSystemInfo()
  },

  // 用户登录
  login() {
    wx.login({
      success: res => {
        console.log('登录成功', res.code)
        // 发送 res.code 到后台换取 openId, sessionKey, unionId
        // TODO: 调用后端登录接口
      },
      fail: err => {
        console.error('登录失败', err)
      }
    })
  },

  // 获取用户信息
  getUserInfo() {
    wx.getSetting({
      success: res => {
        if (res.authSetting['scope.userInfo']) {
          // 已经授权,可以直接调用 getUserInfo 获取头像昵称
          wx.getUserInfo({
            success: res => {
              this.globalData.userInfo = res.userInfo
              // 由于 getUserInfo 是网络请求,可能会在 Page.onLoad 之后才返回
              // 所以此处加入 callback 以防止这种情况
              if (this.userInfoReadyCallback) {
                this.userInfoReadyCallback(res)
              }
            }
          })
        }
      }
    })
  },

  // 获取系统信息
  getSystemInfo() {
    try {
      const res = wx.getSystemInfoSync()
      this.globalData.systemInfo = res
      // 计算状态栏高度
      this.globalData.statusBarHeight = res.statusBarHeight
      // 计算导航栏高度(状态栏高度 + 44)
      this.globalData.navBarHeight = res.statusBarHeight + 44
    } catch (e) {
      console.error('获取系统信息失败', e)
    }
  },

  // 全局数据
  globalData: {
    userInfo: null,
    systemInfo: null,
    statusBarHeight: 0,
    navBarHeight: 0,
    // 当前定位信息
    location: {
      latitude: 0,
      longitude: 0,
      city: '定位中...'
    },
    // 当前行程信息
    currentPlan: null,
    // 当前足迹信息
    currentTrack: null
  }
})
