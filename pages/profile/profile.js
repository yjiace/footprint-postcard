// pages/profile/profile.js
const app = getApp()
const storage = require('../../utils/storage.js')
const util = require('../../utils/util.js')
const loginUtils = require('../../utils/login.js')

Page({
    data: {
        userInfo: {},
        isLoggedIn: false
    },

    onLoad() {
        this.loadUserInfo()
    },

    onShow() {
        // 每次显示时刷新用户信息
        this.loadUserInfo()
    },

    // 加载用户信息
    loadUserInfo() {
        const isLoggedIn = storage.isLoggedIn()
        this.setData({
            isLoggedIn: isLoggedIn
        })
        
        if (isLoggedIn) {
            // 从全局数据获取
            if (app.globalData.userInfo) {
                this.setData({
                    userInfo: app.globalData.userInfo
                })
            } else {
                // 从本地存储获取
                const userInfo = storage.getUserInfo()
                if (userInfo) {
                    this.setData({
                        userInfo
                    })
                }
            }
        } else {
            this.setData({
                userInfo: {}
            })
        }
    },

    // 登录区域点击
    onLoginAreaTap() {
        if (!this.data.isLoggedIn) {
            // 未登录时跳转到登录页面
            loginUtils.navigateToLogin('profile', '/pages/profile/profile')
        }
        // 已登录时无反应
    },

    // 菜单点击
    onMenuTap(e) {
        const type = e.currentTarget.dataset.type

        switch (type) {
            case 'settings':
                this.showSettings()
                break
            case 'about':
                this.showAbout()
                break
            case 'logout':
                this.logout()
                break
        }
    },

    // 我的行程
    showMyPlans() {
        const planList = storage.getPlanList()
        if (planList.length === 0) {
            util.showError('暂无行程记录')
            return
        }

        const itemList = planList.map(plan => `${plan.city} - ${plan.date}`)
        wx.showActionSheet({
            itemList: itemList.slice(0, 6) // 最多显示6条
        })
    },

    // 设置
    showSettings() {
        wx.showActionSheet({
            itemList: ['清除缓存', '检查更新'],
            success: (res) => {
                if (res.tapIndex === 0) {
                    this.clearCache()
                } else if (res.tapIndex === 1) {
                    this.checkUpdate()
                }
            }
        })
    },

    // 清除缓存
    clearCache() {
        util.showConfirm('确定清除所有缓存数据?').then(confirm => {
            if (confirm) {
                storage.clear()
                app.globalData.userInfo = null
                this.setData({
                    userInfo: {}
                })
                util.showSuccess('清除成功')
            }
        })
    },

    // 检查更新
    checkUpdate() {
        if (wx.canIUse('getUpdateManager')) {
            const updateManager = wx.getUpdateManager()

            updateManager.onCheckForUpdate((res) => {
                if (res.hasUpdate) {
                    updateManager.onUpdateReady(() => {
                        wx.showModal({
                            title: '更新提示',
                            content: '新版本已经准备好,是否重启应用?',
                            success: (res) => {
                                if (res.confirm) {
                                    updateManager.applyUpdate()
                                }
                            }
                        })
                    })

                    updateManager.onUpdateFailed(() => {
                        util.showError('新版本下载失败')
                    })
                } else {
                    util.showSuccess('已是最新版本')
                }
            })
        } else {
            util.showError('当前微信版本过低,无法使用该功能')
        }
    },

    // 关于我们
    showAbout() {
        wx.showModal({
            title: '关于我们',
            content: '足迹明信片 v1.0.0\n\n一款结合智能规划、实时追踪与AI生成明信片的旅行记录小程序。\n\n让每一次旅行都值得被记录。',
            showCancel: false
        })
    },

    // 分享
    onShareAppMessage() {
        return util.shareToWeChat(
            '足迹明信片 - 记录你的旅行',
            '/images/share.jpg',
            '/pages/profile/profile'
        )
    },

    // 退出登录
    logout() {
        util.showConfirm('确定要退出登录吗?').then(confirm => {
            if (confirm) {
                // 清除用户信息
                storage.removeUserInfo()
                app.globalData.userInfo = null
                
                // 更新页面状态
                this.setData({
                    userInfo: {},
                    isLoggedIn: false
                })
                
                util.showSuccess('退出成功')
                
                // 可选：跳转到首页或保持当前页面
                // wx.switchTab({
                //     url: '/pages/index/index'
                // })
            }
        })
    }
})
