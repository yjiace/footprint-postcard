// pages/plan-detail/plan-detail.js
const util = require('../../utils/util.js')

Page({
    data: {
        currentDay: 0,
        plan: null,
        loading: true
    },

    onLoad(options) {
        this.loadPlanDetail()
    },

    // 加载行程详情
    loadPlanDetail() {
        // 模拟接口返回的数据
        const mockData = {
            "code": 200,
            "message": "success",
            "data": {
                "id": "plan_1764768889151_f5tmxpixm",
                "city": "石家庄市",
                "date": "2025-12-03",
                "days": 3,
                "poiTypes": ["any"],
                "notes": "",
                "schedule": [{
                    "day": 1,
                    "date": "2025-12-03",
                    "items": [{
                        "name": "石家庄市景点1",
                        "type": "attraction",
                        "time": "09:00 - 12:00",
                        "duration": "3小时",
                        "tips": "建议早上前往"
                    }]
                }, {
                    "day": 2,
                    "date": "2025-12-04",
                    "items": [{
                        "name": "石家庄市景点2",
                        "type": "attraction",
                        "time": "09:00 - 12:00",
                        "duration": "3小时",
                        "tips": "建议早上前往"
                    }]
                }, {
                    "day": 3,
                    "date": "2025-12-05",
                    "items": [{
                        "name": "石家庄市景点3",
                        "type": "attraction",
                        "time": "09:00 - 12:00",
                        "duration": "3小时",
                        "tips": "建议早上前往"
                    }]
                }],
                "createdAt": 1764768889151
            }
        }

        // 模拟网络请求延迟
        setTimeout(() => {
            if (mockData.code === 200) {
                this.setData({
                    plan: mockData.data,
                    loading: false
                })
            } else {
                util.showError('加载失败')
            }
        }, 500)
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
        // 触发分享
    },
    
    // 添加活动
    onAddActivity() {
        util.showError('功能开发中')
    },

    onShareAppMessage() {
        const plan = this.data.plan
        return {
            title: `我的${plan.city}行程`,
            path: '/pages/plan-detail/plan-detail'
        }
    }
})
