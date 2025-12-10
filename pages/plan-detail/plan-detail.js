// pages/plan-detail/plan-detail.js
const util = require('../../utils/util.js')
const storage = require('../../utils/storage.js')

Page({
    data: {
        currentDay: 0,
        plan: null,
        loading: true,
        currentDayData: null,
        currentWeather: null
    },

    onLoad(options) {
        const planId = options.id
        if (planId) {
            this.loadPlanDetail(planId)
        } else {
            // 尝试从storage获取最新的plan
            const plans = storage.getPlanList()
            if (plans && plans.length > 0) {
                this.loadPlanFromStorage(plans[0].id)
            } else {
                this.setData({
                    loading: false,
                    plan: null
                })
            }
        }
    },

    // 从本地存储加载行程
    loadPlanFromStorage(planId) {
        const plans = storage.getPlanList()
        const plan = plans.find(p => p.id === planId)

        if (plan && plan.schedule && plan.schedule.length > 0) {
            const currentDayData = this.processDayData(plan.schedule[0])
            const currentWeather = this.getWeatherForDay(plan, 0)

            this.setData({
                plan: plan,
                loading: false,
                currentDay: 0,
                currentDayData: currentDayData,
                currentWeather: currentWeather
            })
        } else {
            this.setData({
                loading: false,
                plan: null
            })
        }
    },

    // 加载行程详情
    loadPlanDetail(planId) {
        // 先尝试从本地存储获取
        const plans = storage.getPlanList()
        const plan = plans.find(p => p.id === planId)

        if (plan && plan.schedule && plan.schedule.length > 0) {
            const currentDayData = this.processDayData(plan.schedule[0])
            const currentWeather = this.getWeatherForDay(plan, 0)

            this.setData({
                plan: plan,
                loading: false,
                currentDay: 0,
                currentDayData: currentDayData,
                currentWeather: currentWeather
            })
        } else {
            this.setData({
                loading: false,
                plan: null
            })
            util.showError('行程数据不存在')
        }
    },

    // 处理单日数据，添加必要的展示字段
    processDayData(dayData) {
        if (!dayData) return null

        // 处理餐饮数据，添加类型标签
        const mealTypeMap = {
            'breakfast': '早餐',
            'lunch': '午餐',
            'dinner': '晚餐'
        }

        const processedMeals = (dayData.meals || []).map(meal => ({
            ...meal,
            typeLabel: mealTypeMap[meal.type] || meal.type
        }))

        return {
            ...dayData,
            meals: processedMeals
        }
    },

    // 获取指定天的天气信息
    getWeatherForDay(plan, dayIndex) {
        if (!plan || !plan.weatherInfo || !plan.schedule) return null

        const dayData = plan.schedule[dayIndex]
        if (!dayData) return null

        const weather = plan.weatherInfo.find(w => w.date === dayData.date)
        if (!weather) return null

        // 根据天气添加emoji
        const weatherEmojiMap = {
            '晴': '☀️',
            '多云': '⛅',
            '阴': '☁️',
            '小雨': '🌧️',
            '中雨': '🌧️',
            '大雨': '🌧️',
            '雷阵雨': '⛈️',
            '小雪': '🌨️',
            '中雪': '❄️',
            '大雪': '❄️',
            '雾': '🌫️'
        }

        return {
            ...weather,
            emoji: weatherEmojiMap[weather.day_weather] || '🌤️'
        }
    },

    // 切换天数
    onDayChange(e) {
        const index = e.currentTarget.dataset.index
        const plan = this.data.plan

        if (plan && plan.schedule && plan.schedule[index]) {
            const currentDayData = this.processDayData(plan.schedule[index])
            const currentWeather = this.getWeatherForDay(plan, index)

            this.setData({
                currentDay: index,
                currentDayData: currentDayData,
                currentWeather: currentWeather
            })
        }
    },

    // 返回
    onBack() {
        wx.navigateBack({
            fail: () => {
                wx.switchTab({
                    url: '/pages/plan/plan'
                })
            }
        })
    },

    // 分享
    onShareAppMessage() {
        const plan = this.data.plan
        if (plan) {
            return {
                title: `我的${plan.city}${plan.days}天行程`,
                path: `/pages/plan-detail/plan-detail?id=${plan.id}`
            }
        }
        return {
            title: '我的旅行行程',
            path: '/pages/plan-detail/plan-detail'
        }
    }
})
