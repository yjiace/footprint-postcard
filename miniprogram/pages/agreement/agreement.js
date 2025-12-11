// pages/agreement/agreement.js
Page({
    data: {
        updateDate: '2025年12月11日'
    },

    onLoad(options) {
        // 页面加载
    },

    // 返回上一页
    onBack() {
        wx.navigateBack({
            fail: () => {
                wx.switchTab({
                    url: '/pages/index/index'
                })
            }
        })
    }
})
