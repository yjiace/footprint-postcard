// pages/login/login.js
const storage = require('../../utils/storage.js')
const util = require('../../utils/util.js')
const api = require('../../utils/api.js')

Page({
    data: {
        agreementChecked: false, // 协议复选框状态,默认未勾选
        showBackButton: false // 是否显示返回按钮
    },

    onLoad(options) {
        console.log('登录页面加载', options)

        // 保存来源页面信息
        const pages = getCurrentPages()
        if (pages.length > 1) {
            // 从页面堆栈获取来源页面
            const prevPage = pages[pages.length - 2]
            if (prevPage && prevPage.route) {
                const fromPage = '/' + prevPage.route
                wx.setStorageSync('login_from_page', fromPage)
                console.log('保存来源页面:', fromPage)
            }
        }

        // 如果有回调页面,保存到本地
        if (options.redirect) {
            wx.setStorageSync('login_redirect', options.redirect)
        }

        // 判断是否显示返回按钮
        // 只要不是从首页直接进入的，都显示返回按钮
        const showBack = pages.length > 0 && (pages.length > 1 || options.from || options.redirect)
        this.setData({
            showBackButton: showBack
        })
    },

    onShow() {
        // 检查是否已经登录
        if (storage.isLoggedIn()) {
            this.redirectAfterLogin()
        }
    },

    // 协议复选框状态改变
    onAgreementChange(e) {
        const checked = e.detail.value.length > 0
        console.log('onAgreementChange:', checked)
        this.setData({
            agreementChecked: checked
        })
    },

    // 手动切换复选框状态
    toggleAgreement(e) {
        // 阻止事件冒泡，避免触发链接点击
        if (e && e.target && e.target.dataset && e.target.dataset.link) {
            return
        }

        const newState = !this.data.agreementChecked
        console.log('toggleAgreement:', newState)
        this.setData({
            agreementChecked: newState
        })
    },

    // 微信登录
    async onGetUserInfo(e) {
        console.log('微信登录', e)

        // 检查是否同意协议
        if (!this.data.agreementChecked) {
            util.showError('请先同意服务条款和隐私政策')
            return
        }

        // 检查用户信息授权状态
        if (!e.detail.userInfo) {
            // 用户拒绝授权，需要引导用户重新授权
            wx.showModal({
                title: '授权提示',
                content: '需要获取您的头像和昵称信息来完善个人资料',
                confirmText: '重新授权',
                cancelText: '取消',
                success: (res) => {
                    if (res.confirm) {
                        // 重新触发授权
                        this.triggerUserInfoAuth()
                    }
                }
            })
            return
        }

        try {
            util.showLoading('登录中...')

            // 获取微信code
            const loginRes = await new Promise((resolve, reject) => {
                wx.login({
                    success: resolve,
                    fail: reject
                })
            })

            if (!loginRes.code) {
                throw new Error('获取微信code失败')
            }

            // 调用登录API
            const result = await api.login(loginRes.code)

            if (result && result.token) {
                // 保存用户信息，确保包含微信头像和昵称
                const userInfo = {
                    // 微信用户信息
                    avatarUrl: e.detail.userInfo.avatarUrl,
                    nickName: e.detail.userInfo.nickName,
                    // API返回的token和用户ID
                    token: result.token,
                    userId: result.userId || result.id || result.openid,
                    openid: result.openid
                }

                console.log('保存的用户信息:', userInfo)
                storage.setUserInfo(userInfo)

                // 同时更新全局用户信息
                const app = getApp()
                app.globalData.userInfo = userInfo

                util.hideLoading()
                util.showSuccess('登录成功')

                // 强制刷新个人中心页面数据
                const pages = getCurrentPages()
                for (let i = 0; i < pages.length; i++) {
                    const page = pages[i]
                    if (page.route && page.route.includes('profile') && page.loadUserInfo) {
                        page.loadUserInfo()
                        console.log('已刷新个人中心页面数据')
                    }
                }

                // 延迟跳转，确保数据更新完成
                setTimeout(() => {
                    this.redirectAfterLogin()
                }, 500)
            } else {
                // 更详细的错误信息
                throw new Error(`登录失败：API返回数据异常，缺少token字段，返回数据：${JSON.stringify(result)}`)
            }
        } catch (err) {
            console.error('微信登录失败', err)
            util.hideLoading()

            // 检查错误类型，提供具体的错误提示
            if (err.data && err.data.message) {
                if (err.data.message.includes('invalid code')) {
                    util.showError('登录失败：微信授权码无效，请重新尝试登录')
                } else if (err.data.message.includes('code expired')) {
                    util.showError('登录失败：微信授权码已过期，请重新登录')
                } else {
                    util.showError(`登录失败：${err.data.message}`)
                }
            } else if (err.statusCode && err.statusCode >= 500) {
                util.showError('服务器繁忙，请稍后重试')
            } else if (err.errMsg && err.errMsg.includes('network')) {
                util.showError('网络连接失败，请检查网络设置')
            } else if (err.message && err.message.includes('登录失败')) {
                // 处理自定义错误消息
                util.showError(err.message)
            } else {
                util.showError('登录失败，请重试')
            }
        }
    },

    // 服务条款
    onAgreement() {
        wx.navigateTo({
            url: '/pages/agreement/agreement'
        })
    },

    // 隐私政策
    onPrivacy() {
        wx.navigateTo({
            url: '/pages/privacy/privacy'
        })
    },



    // 返回按钮点击事件
    onBack() {
        wx.navigateBack({
            fail: () => {
                // 如果无法返回，跳转到首页
                wx.switchTab({
                    url: '/pages/index/index'
                })
            }
        })
    },

    // 触发用户信息授权
    triggerUserInfoAuth() {
        // 使用微信的授权按钮重新触发授权
        wx.showModal({
            title: '授权提示',
            content: '请点击页面中的"微信一键登录"按钮，并同意授权您的头像和昵称',
            showCancel: false,
            confirmText: '知道了'
        })
    },

    // 登录成功后跳转
    redirectAfterLogin() {
        // 获取回调页面
        const redirect = wx.getStorageSync('login_redirect')
        const fromPage = wx.getStorageSync('login_from_page')

        console.log('登录后跳转信息:', { redirect, fromPage })

        // 清除存储的跳转信息
        wx.removeStorageSync('login_redirect')
        wx.removeStorageSync('login_from_page')

        if (redirect) {
            // 跳转到指定页面
            wx.redirectTo({
                url: redirect,
                fail: () => {
                    console.log('跳转指定页面失败，尝试返回来源页面')
                    this.fallbackToFromPage(fromPage)
                }
            })
        } else if (fromPage) {
            // 返回来源页面
            this.fallbackToFromPage(fromPage)
        } else {
            // 返回上一页或首页
            const pages = getCurrentPages()
            if (pages.length > 1) {
                console.log('返回上一页')
                wx.navigateBack()
            } else {
                console.log('跳转到首页')
                wx.switchTab({
                    url: '/pages/index/index'
                })
            }
        }
    },

    // 回退到来源页面
    fallbackToFromPage(fromPage) {
        if (fromPage) {
            console.log('尝试返回来源页面:', fromPage)
            // 检查页面类型，如果是tab页使用switchTab，否则使用redirectTo
            const tabPages = ['/pages/index/index', '/pages/plan-list/plan-list', '/pages/postcard/postcard', '/pages/profile/profile']

            if (tabPages.includes(fromPage)) {
                wx.switchTab({
                    url: fromPage
                })
            } else {
                wx.redirectTo({
                    url: fromPage,
                    fail: () => {
                        // 如果redirectTo失败，尝试navigateBack
                        wx.navigateBack({
                            fail: () => {
                                // 最后的回退：返回首页
                                wx.switchTab({
                                    url: '/pages/index/index'
                                })
                            }
                        })
                    }
                })
            }
        } else {
            // 没有来源页面，返回首页
            console.log('没有来源页面，返回首页')
            wx.switchTab({
                url: '/pages/index/index'
            })
        }
    }
})