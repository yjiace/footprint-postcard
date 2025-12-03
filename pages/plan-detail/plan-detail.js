// pages/plan-detail/plan-detail.js
const storage = require('../../utils/storage.js')
const util = require('../../utils/util.js')

Page({
    data: {
        currentDay: 0,
        schedule: [],
        planInfo: null
    },

    onLoad(options) {
        this.loadPlanDetail()
    },

    // 加载行程详情
    loadPlanDetail() {
        const plan = storage.getCurrentPlan()
        if (plan && plan.schedule) {
            this.setData({
                planInfo: plan,
                schedule: plan.schedule
            })
        } else {
            util.showError('未找到行程信息')
            setTimeout(() => {
                wx.navigateBack()
            }, 1500)
        }
    },

    // 切换天数
    onDayChange(e) {
        const index = e.currentTarget.dataset.index
        this.setData({
            currentDay: index
        })
    },

    // 返回
    onBack() {
        wx.navigateBack()
    },

    // 分享
    onShare() {
        wx.showShareMenu({
            withShareTicket: true,
            menus: ['shareAppMessage', 'shareTimeline']
        })
    },

    // 添加活动
    onAddActivity() {
        util.showError('功能开发中')
    },

    // 获取节点样式类
    getNodeClass(type) {
        return type || 'museum'
    },

    // 获取节点图标
    getNodeIcon(type) {
        const iconMap = {
            museum: '/images/icons/museum.png',
            park: '/images/icons/park.png',
            restaurant: '/images/icons/restaurant.png',
            street: '/images/icons/street.png'
        }
        return iconMap[type] || '/images/icons/museum.png'
    },

    // 分享
    onShareAppMessage() {
        const plan = this.data.planInfo
        return util.shareToWeChat(
            `我的${plan.city}${plan.days}日游行程`,
            '/images/share.jpg',
            '/pages/plan-detail/plan-detail'
        )
    }
})
