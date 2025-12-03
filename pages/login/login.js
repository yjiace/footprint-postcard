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
        wx.showModal({
            title: '服务条款',
            content: `感谢您使用足迹明信片!请仔细阅读以下条款:

一、服务内容
1. 我们为您提供旅行足迹记录、明信片生成和分享服务
2. 您可以创建个性化的旅行明信片,记录美好时光
3. 我们提供云端同步功能,保障数据安全

二、用户权利与义务
1. 您有权使用本服务的所有功能
2. 您需保证上传内容的合法性,不侵犯他人权益
3. 禁止发布违法、暴力、色情等不良内容
4. 您应妥善保管账号信息,对账号行为负责

三、知识产权
1. 服务中的软件、界面等知识产权归我们所有
2. 您上传的内容知识产权归您所有
3. 您授权我们在服务范围内使用您的内容

四、隐私保护
1. 我们严格保护您的个人信息
2. 未经授权不会向第三方透露您的信息
3. 详见《隐私政策》

五、服务变更与终止
1. 我们有权随时修改、暂停或终止服务
2. 如有重大变更将提前通知您
3. 您可随时停止使用服务

六、免责声明
1. 因不可抗力导致的服务中断,我们不承担责任
2. 因用户违规使用造成的损失,由用户自行承担
3. 第三方服务问题不在我们责任范围内

七、法律适用
本协议适用中华人民共和国法律。如有争议,双方友好协商解决。

点击"同意"表示您已阅读并接受以上全部条款。`,
            confirmText: '同意',
            cancelText: '取消',
            success: (res) => {
                if (res.confirm) {
                    this.setData({
                        agreementChecked: true
                    })
                }
            }
        })
    },

    // 隐私政策
    onPrivacy() {
        wx.showModal({
            title: '隐私政策',
            content: `我们非常重视您的隐私保护,特制定本隐私政策:

一、信息收集
我们会收集以下信息以提供更好的服务:
1. 基本信息:微信头像、昵称
2. 位置信息:用于记录足迹和生成明信片
3. 设备信息:系统版本、设备型号等
4. 使用数据:行程记录、收藏内容等

二、信息使用目的
1. 提供个性化服务和功能
2. 改善用户体验和服务质量
3. 数据统计和分析(匿名化处理)
4. 必要的技术维护和安全保障
5. 符合法律法规的要求

三、信息存储与保护
1. 采用加密技术保护数据传输
2. 服务器设有多重安全防护
3. 严格的数据访问权限管理
4. 定期进行安全审计和更新
5. 数据存储符合国家相关规定

四、信息共享与披露
1. 未经您同意,不会向第三方共享个人信息
2. 以下情况除外:
   - 法律法规要求
   - 司法机关要求
   - 保护用户或公众安全
   - 经您明确授权

五、您的权利
1. 查询和修改个人信息
2. 删除账号和相关数据
3. 撤回已同意的授权
4. 投诉和举报违规行为
5. 要求我们更正错误信息

六、未成年人保护
1. 不满14周岁的未成年人需在监护人同意下使用
2. 我们不会故意收集未成年人的个人信息
3. 如发现请及时联系我们删除

七、政策更新
1. 我们可能会适时更新本政策
2. 重大变更会通过应用内通知
3. 继续使用即视为接受更新后的政策

八、联系我们
如对本政策有任何疑问或建议,可通过以下方式联系:
- 应用内客服
- 邮箱: privacy@footprints.com

最后更新日期: 2024年12月

点击"同意"表示您已阅读并接受本隐私政策。`,
            confirmText: '同意',
            cancelText: '取消',
            success: (res) => {
                if (res.confirm) {
                    this.setData({
                        agreementChecked: true
                    })
                }
            }
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
            const tabPages = ['/pages/index/index', '/pages/plan/plan', '/pages/postcard/postcard', '/pages/profile/profile']
            
            if (tabPages.includes(fromPage)) {
                wx.switchTab({
                    url: fromPage
                })
            } else {
                wx.redirectTo({
                    url: fromPage
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