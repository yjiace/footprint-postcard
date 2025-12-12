// pages/plan-detail/plan-detail.js
const util = require('../../utils/util.js')
const storage = require('../../utils/storage.js')

// 类型映射配置
const TYPE_CONFIG = {
    'breakfast': { label: '早餐', emoji: '🌅', category: 'meal', color: '#f97316' },
    'lunch': { label: '午餐', emoji: '☀️', category: 'meal', color: '#eab308' },
    'dinner': { label: '晚餐', emoji: '🌙', category: 'meal', color: '#8b5cf6' },
    'attraction': { label: '景点', emoji: '🗺️', category: 'attraction', color: '#3b82f6' },
    'hotel': { label: '住宿', emoji: '🏨', category: 'hotel', color: '#ec4899' }
}

// 交通方式图标映射
const TRANSPORT_ICONS = {
    '左转': '↰',
    '右转': '↱',
    '直行': '↑',
    '靠左': '↖',
    '靠右': '↗',
    '调头': '↩',
    '左转调头': '↩',
    '向左前方行驶': '↖',
    '向右前方行驶': '↗',
    '向左后方行驶': '↙',
    '向右后方行驶': '↘'
}

Page({
    data: {
        currentDay: 0,
        plan: null,
        loading: true,
        currentDayData: null,
        currentWeather: null,
        currentRouteInfo: null,  // 当天路径信息
        currentDayMapUrl: null,  // 当天静态地图URL
        expandedRoutes: {}       // 展开的路径段索引
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
            const currentDayData = this.processDayData(plan.schedule[0], 0)
            const currentWeather = this.getWeatherForDay(plan, 0)
            const currentRouteInfo = this.getRouteInfoForDay(plan, 0)
            const currentDayMapUrl = this.getStaticMapForDay(plan, 0)

            this.setData({
                plan: plan,
                loading: false,
                currentDay: 0,
                currentDayData: currentDayData,
                currentWeather: currentWeather,
                currentRouteInfo: currentRouteInfo,
                currentDayMapUrl: currentDayMapUrl,
                expandedRoutes: {}
            })
        } else {
            this.setData({
                loading: false,
                plan: null
            })
        }
    },

    // 加载行程详情
    async loadPlanDetail(planId) {
        const api = require('../../utils/api.js')

        // 先尝试从本地存储获取
        const plans = storage.getPlanList()
        const localPlan = plans.find(p => p.id === planId)

        // 如果本地有完整数据（包含schedule），直接使用
        if (localPlan && localPlan.schedule && localPlan.schedule.length > 0) {
            const currentDayData = this.processDayData(localPlan.schedule[0], 0)
            const currentWeather = this.getWeatherForDay(localPlan, 0)
            const currentRouteInfo = this.getRouteInfoForDay(localPlan, 0)
            const currentDayMapUrl = this.getStaticMapForDay(localPlan, 0)

            this.setData({
                plan: localPlan,
                loading: false,
                currentDay: 0,
                currentDayData: currentDayData,
                currentWeather: currentWeather,
                currentRouteInfo: currentRouteInfo,
                currentDayMapUrl: currentDayMapUrl,
                expandedRoutes: {}
            })
            return
        }

        // 本地没有完整数据，从服务器获取
        try {
            const plan = await api.getPlanDetail(planId)

            if (plan && plan.schedule && plan.schedule.length > 0) {
                const currentDayData = this.processDayData(plan.schedule[0], 0)
                const currentWeather = this.getWeatherForDay(plan, 0)
                const currentRouteInfo = this.getRouteInfoForDay(plan, 0)
                const currentDayMapUrl = this.getStaticMapForDay(plan, 0)

                this.setData({
                    plan: plan,
                    loading: false,
                    currentDay: 0,
                    currentDayData: currentDayData,
                    currentWeather: currentWeather,
                    currentRouteInfo: currentRouteInfo,
                    currentDayMapUrl: currentDayMapUrl,
                    expandedRoutes: {}
                })
            } else {
                this.setData({
                    loading: false,
                    plan: null
                })
                util.showError('行程数据不存在')
            }
        } catch (err) {
            console.error('获取行程详情失败:', err)
            this.setData({
                loading: false,
                plan: null
            })
            util.showError('获取行程失败')
        }
    },

    // 处理单日数据，添加必要的展示字段
    // 支持V2的 planning 数组结构，也兼容原有的 attractions/meals/hotel 分离结构
    processDayData(dayData, dayIndex) {
        if (!dayData) return null

        // 检查是否为V2结构（有planning数组）
        if (dayData.planning && Array.isArray(dayData.planning)) {
            // V2新结构：planning数组，按时间顺序包含所有类型
            const processedPlanning = dayData.planning.map((item, index) => {
                const typeConfig = TYPE_CONFIG[item.type] || { label: item.type, emoji: '📍', category: 'other', color: '#6b7280' }
                return {
                    ...item,
                    index: index,
                    typeLabel: typeConfig.label,
                    typeEmoji: typeConfig.emoji,
                    typeCategory: typeConfig.category,
                    typeColor: typeConfig.color,
                    // 格式化时长
                    durationText: item.visit_duration ? `${item.visit_duration}分钟` : '',
                    // 格式化价格
                    priceText: this.formatPrice(item.ticket_price, item.type)
                }
            })

            return {
                ...dayData,
                planning: processedPlanning,
                isV2: true
            }
        }

        // 原有结构：attractions, meals, hotel 分离
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
            meals: processedMeals,
            isV2: false
        }
    },

    // 格式化价格显示
    formatPrice(price, type) {
        if (price === undefined || price === null) return ''
        if (price === 0) {
            if (type === 'attraction') return '免费'
            return ''
        }
        if (type === 'hotel') return `¥${price}/晚`
        if (['breakfast', 'lunch', 'dinner'].includes(type)) return `人均¥${price}`
        return `¥${price}`
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

    // 获取指定天的路径信息
    getRouteInfoForDay(plan, dayIndex) {
        if (!plan || !plan.routeInfo) return null

        // routeInfo 是数组，按 day_index 查找
        const routeInfo = plan.routeInfo.find(r => r.day_index === dayIndex)
        if (!routeInfo) return null

        // 处理路径段，添加图标
        const processedSegments = (routeInfo.segments || []).map((segment, index) => ({
            ...segment,
            actionIcon: TRANSPORT_ICONS[segment.action] || '→',
            distanceText: this.formatDistance(segment.distance),
            durationText: segment.duration > 0 ? `${segment.duration}分钟` : ''
        }))

        return {
            ...routeInfo,
            segments: processedSegments,
            totalDistanceText: this.formatDistance(routeInfo.total_distance),
            totalDurationText: routeInfo.total_duration > 0 ? `约${routeInfo.total_duration}分钟` : ''
        }
    },

    // 格式化距离
    formatDistance(meters) {
        if (!meters) return ''
        if (meters < 1000) return `${meters}米`
        return `${(meters / 1000).toFixed(1)}公里`
    },

    // 切换天数
    onDayChange(e) {
        const index = e.currentTarget.dataset.index
        const plan = this.data.plan

        if (plan && plan.schedule && plan.schedule[index]) {
            const currentDayData = this.processDayData(plan.schedule[index], index)
            const currentWeather = this.getWeatherForDay(plan, index)
            const currentRouteInfo = this.getRouteInfoForDay(plan, index)
            const currentDayMapUrl = this.getStaticMapForDay(plan, index)

            this.setData({
                currentDay: index,
                currentDayData: currentDayData,
                currentWeather: currentWeather,
                currentRouteInfo: currentRouteInfo,
                currentDayMapUrl: currentDayMapUrl,
                expandedRoutes: {}  // 切换天数时重置展开状态
            })
        }
    },

    // 切换路径详情展开/折叠
    toggleRouteDetail(e) {
        const index = e.currentTarget.dataset.index
        const key = `expandedRoutes.${index}`
        const currentValue = this.data.expandedRoutes[index] || false
        this.setData({
            [key]: !currentValue
        })
    },

    // 获取指定天的静态地图URL
    getStaticMapForDay(plan, dayIndex) {
        if (!plan || !plan.dayStaticMaps) return null
        return plan.dayStaticMaps[dayIndex] || null
    },

    // 查看路线静态地图
    onViewRouteMap() {
        const mapUrl = this.data.currentDayMapUrl
        if (mapUrl) {
            wx.previewImage({
                urls: [mapUrl],
                current: mapUrl
            })
        } else {
            wx.showToast({
                title: '地图加载中...',
                icon: 'none'
            })
        }
    },

    // 返回（直接跳转到列表页）
    onBack() {
        wx.switchTab({
            url: '/pages/plan-list/plan-list'
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
