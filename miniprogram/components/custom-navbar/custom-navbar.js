// components/custom-navbar/custom-navbar.js
Component({
  options: {
    multipleSlots: true // 启用多插槽支持
  },

  properties: {
    // 页面标题（居中显示）
    title: {
      type: String,
      value: ''
    },
    // 是否显示返回按钮
    showBack: {
      type: Boolean,
      value: false
    },
    // 背景色（用于固定导航栏）
    bgColor: {
      type: String,
      value: ''
    }
  },

  data: {
    statusBarHeight: 20,
    navBarContentHeight: 44,
    totalNavBarHeight: 64
  },

  lifetimes: {
    attached() {
      this.initNavBar()
    }
  },

  methods: {
    initNavBar() {
      try {
        // 获取系统信息
        const systemInfo = wx.getSystemInfoSync()
        const statusBarHeight = systemInfo.statusBarHeight || 20

        // 获取胶囊按钮信息
        const menuButton = wx.getMenuButtonBoundingClientRect()

        // 导航栏内容区高度 = 胶囊按钮高度 + 上下边距
        const menuButtonMarginTop = menuButton.top - statusBarHeight
        const navBarContentHeight = menuButton.height + menuButtonMarginTop * 2

        // 总高度 = 状态栏 + 导航栏内容区
        const totalNavBarHeight = statusBarHeight + navBarContentHeight

        this.setData({
          statusBarHeight,
          navBarContentHeight,
          totalNavBarHeight
        })

        // 触发事件让页面获取高度
        this.triggerEvent('navbarInit', {
          statusBarHeight,
          navBarContentHeight,
          totalNavBarHeight
        })
      } catch (e) {
        console.error('初始化导航栏失败', e)
        this.setData({
          statusBarHeight: 20,
          navBarContentHeight: 44,
          totalNavBarHeight: 64
        })
      }
    },

    onBack() {
      const pages = getCurrentPages()
      if (pages.length > 1) {
        wx.navigateBack({
          fail: () => {
            wx.switchTab({ url: '/pages/index/index' })
          }
        })
      } else {
        wx.switchTab({ url: '/pages/index/index' })
      }
    }
  }
})