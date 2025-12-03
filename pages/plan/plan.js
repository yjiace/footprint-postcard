// pages/plan/plan.js
const app = getApp()
const api = require('../../utils/api.js')
const storage = require('../../utils/storage.js')
const util = require('../../utils/util.js')

Page({
    data: {
        // 城市
        cityRegion: [],
        city: '',

        // 日期
        date: '',
        todayDate: '',

        // 天数
        dayOptions: ['1天', '2天', '3天', '4天', '5天', '6天', '7天', '8天以上'],
        dayIndex: 2,

        // 景点类型
        poiTypes: [
            { id: 'any', name: '不限', selected: true },
            { id: 'nature', name: '自然风光', selected: false },
            { id: 'history', name: '历史古迹', selected: false },
            { id: 'museum', name: '博物馆', selected: false },
            { id: 'amusement', name: '游乐园', selected: false },
            { id: 'food', name: '美食探店', selected: false }
        ],

        // 备注
        notes: ''
    },

    onLoad() {
        // 设置今天的日期
        const today = new Date()
        const todayStr = util.formatDate(today)
        this.setData({
            todayDate: todayStr
        })

        // 从全局数据获取当前城市
        if (app.globalData.location && app.globalData.location.city) {
            this.setData({
                city: app.globalData.location.city
            })
        }
    },

    // 使用当前位置
    async useCurrentLocation() {
        try {
            // 检查定位权限
            const authSetting = await new Promise((resolve) => {
                wx.getSetting({
                    success: resolve
                })
            })
            
            // 如果用户未授权定位权限，则请求授权
            if (!authSetting.authSetting['scope.userLocation']) {
                const authResult = await new Promise((resolve) => {
                    wx.authorize({
                        scope: 'scope.userLocation',
                        success: () => resolve(true),
                        fail: () => resolve(false)
                    })
                })
                
                if (!authResult) {
                    // 用户拒绝授权，显示提示
                    wx.showModal({
                        title: '定位权限申请',
                        content: '需要获取您的位置信息来为您推荐合适的行程路线',
                        confirmText: '去设置',
                        cancelText: '取消',
                        success: (res) => {
                            if (res.confirm) {
                                wx.openSetting()
                            }
                        }
                    })
                    return
                }
            }
            
            // 获取位置信息
            const location = await new Promise((resolve, reject) => {
                wx.getLocation({
                    type: 'gcj02',
                    success: resolve,
                    fail: reject
                })
            })
            
            // 调用后端API获取城市信息
            const cityInfo = await api.getCityByLocation(location.latitude, location.longitude)
            
            // 根据新的API数据结构适配
            const cityData = cityInfo.data || {}
            const cityName = cityData.city || cityData.formattedAddress || '未知城市'
            
            this.setData({
                city: cityName
            })
            
            wx.showToast({
                title: '已使用当前位置',
                icon: 'success'
            })
            
        } catch (err) {
            console.error('获取位置失败:', err)
            if (err.message && err.message.includes('权限')) {
                wx.showToast({
                    title: '请授权定位权限',
                    icon: 'none'
                })
            } else {
                wx.showToast({
                    title: '获取位置失败',
                    icon: 'none'
                })
            }
        }
    },

    // 选择城市
    onCityChange(e) {
        const region = e.detail.value
        const city = region[1] // 取市级
        this.setData({
            cityRegion: region,
            city: city
        })
    },

    // 选择日期
    onDateChange(e) {
        this.setData({
            date: e.detail.value
        })
    },

    // 选择天数
    onDayChange(e) {
        this.setData({
            dayIndex: e.detail.value
        })
    },

    // 切换景点类型
    onPoiTypeToggle(e) {
        const index = e.currentTarget.dataset.index
        const poiTypes = this.data.poiTypes

        // 如果点击的是"不限",取消其他选项
        if (index === 0) {
            poiTypes.forEach((item, i) => {
                item.selected = i === 0
            })
        } else {
            // 取消"不限"选项
            poiTypes[0].selected = false
            // 切换当前选项
            poiTypes[index].selected = !poiTypes[index].selected

            // 如果没有任何选项,自动选中"不限"
            const hasSelected = poiTypes.slice(1).some(item => item.selected)
            if (!hasSelected) {
                poiTypes[0].selected = true
            }
        }

        this.setData({
            poiTypes
        })
    },

    // 备注输入
    onNotesChange(e) {
        this.setData({
            notes: e.detail.value
        })
    },

    // 生成行程
    async onGenerate() {
        // 检查用户是否已登录
        if (!storage.isLoggedIn()) {
            console.log('用户未登录，显示登录提示')
            this.showLoginGuide('生成行程')
            return
        }

        // 验证表单
        if (!this.data.city) {
            util.showError('请选择城市')
            return
        }

        if (!this.data.date) {
            util.showError('请选择出行日期')
            return
        }

        // 获取选中的景点类型
        const selectedTypes = this.data.poiTypes
            .filter(item => item.selected)
            .map(item => item.id)

        // 构建请求参数
        const params = {
            city: this.data.city,
            date: this.data.date,
            days: parseInt(this.data.dayOptions[this.data.dayIndex]),
            poiTypes: selectedTypes,
            notes: this.data.notes
        }

        try {
            util.showLoading('正在生成行程...')

            // 调用实际API生成行程
            const result = await api.generatePlan(params)
            
            // 保存行程到本地存储
            const plan = {
                id: util.generateId(),
                city: params.city,
                date: params.date,
                days: params.days,
                poiTypes: params.poiTypes,
                notes: params.notes,
                schedule: result.data || [],
                createdAt: Date.now()
            }
            
            // 保存到本地存储
            storage.savePlan(plan)

            util.hideLoading()
            util.showSuccess('行程生成成功')

            // 跳转到行程详情页
            setTimeout(() => {
                wx.navigateTo({
                    url: `/pages/plan-detail/plan-detail?id=${plan.id}`
                })
            }, 1000)

        } catch (err) {
            console.error('生成行程失败', err)
            util.hideLoading()
            
            // 显示具体的错误信息
            if (err.errMsg && err.errMsg.includes('fail')) {
                util.showError('网络连接失败，请检查网络后重试')
            } else if (err.statusCode && err.statusCode >= 500) {
                util.showError('服务器繁忙，请稍后重试')
            } else {
                util.showError('生成行程失败，请重试')
            }
        }
    },

    // 显示登录引导
    showLoginGuide(action = '生成行程') {
        wx.showModal({
            title: '登录提示',
            content: `您需要登录后才能${action}`,
            confirmText: '去登录',
            cancelText: '稍后再说',
            success: (res) => {
                if (res.confirm) {
                    // 跳转到登录页面，并传递回调页面
                    wx.redirectTo({
                        url: '/pages/login/login?redirect=/pages/plan/plan'
                    })
                }
            }
        })
    },

    // 分享
    onShareAppMessage() {
        return util.shareToWeChat(
            '来一起规划旅行吧',
            '/images/share.jpg',
            '/pages/plan/plan'
        )
    }
})
