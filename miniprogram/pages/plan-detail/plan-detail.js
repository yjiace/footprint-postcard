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

// 路程图标映射（根据交通方式）
const ROUTE_TRANSPORT_ICONS = {
    '自驾': '🚗',
    '公共交通': '🚌',
    '步行为主': '🚶'
}

// 短距离阈值（米），距离小于该值时使用步行图标
const WALK_DISTANCE_THRESHOLD = 500

Page({
    data: {
        currentDay: 0,
        plan: null,
        loading: true,
        currentDayData: null,
        currentWeather: null,
        currentRouteInfo: null,  // 当天路径信息
        expandedRoutes: {},      // 展开的路径段索引
        routeSummaryIcon: '🚗',  // 路程概况卡片图标
        routeSegmentIcons: {},   // 各路段图标 { itemIndex: icon }
        isLastDay: false,        // 是否为最后一天
        returnHomeName: '',      // 返回起点名称
        // 路线地图弹框
        showRouteMapPopup: false,
        routeMapDisplayMode: 'segment',   // segment | day
        routeMapPlanId: '',               // 全天模式需要
        routeMapDayIndex: 0,              // 全天模式需要
        routeMapOrigin: null,
        routeMapDestination: null,
        routeMapOriginName: '',
        routeMapDestinationName: '',
        routeMapDefaultMode: 'driving'
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
            const routeSummaryIcon = this.getRouteSummaryIcon(plan)
            const routeSegmentIcons = this.getRouteSegmentIcons(plan, currentRouteInfo)

            const isLastDay = plan.schedule.length === 1
            const returnHomeInfo = this.getReturnHomeInfo(plan)

            this.setData({
                plan: plan,
                loading: false,
                currentDay: 0,
                currentDayData: currentDayData,
                currentWeather: currentWeather,
                currentRouteInfo: currentRouteInfo,
                expandedRoutes: {},
                routeSummaryIcon: routeSummaryIcon,
                routeSegmentIcons: routeSegmentIcons,
                isLastDay: isLastDay,
                returnHomeName: returnHomeInfo.name
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
            const routeSummaryIcon = this.getRouteSummaryIcon(localPlan)
            const routeSegmentIcons = this.getRouteSegmentIcons(localPlan, currentRouteInfo)

            const isLastDay = localPlan.schedule.length === 1
            const returnHomeInfo = this.getReturnHomeInfo(localPlan)

            this.setData({
                plan: localPlan,
                loading: false,
                currentDay: 0,
                currentDayData: currentDayData,
                currentWeather: currentWeather,
                currentRouteInfo: currentRouteInfo,
                expandedRoutes: {},
                routeSummaryIcon: routeSummaryIcon,
                routeSegmentIcons: routeSegmentIcons,
                isLastDay: isLastDay,
                returnHomeName: returnHomeInfo.name
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
                const routeSummaryIcon = this.getRouteSummaryIcon(plan)
                const routeSegmentIcons = this.getRouteSegmentIcons(plan, currentRouteInfo)

                const isLastDay = plan.schedule.length === 1
                const returnHomeInfo = this.getReturnHomeInfo(plan)

                this.setData({
                    plan: plan,
                    loading: false,
                    currentDay: 0,
                    currentDayData: currentDayData,
                    currentWeather: currentWeather,
                    currentRouteInfo: currentRouteInfo,
                    expandedRoutes: {},
                    routeSummaryIcon: routeSummaryIcon,
                    routeSegmentIcons: routeSegmentIcons,
                    isLastDay: isLastDay,
                    returnHomeName: returnHomeInfo.name
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
            const routeSegmentIcons = this.getRouteSegmentIcons(plan, currentRouteInfo)

            const isLastDay = index === plan.schedule.length - 1
            const returnHomeInfo = this.getReturnHomeInfo(plan)

            this.setData({
                currentDay: index,
                currentDayData: currentDayData,
                currentWeather: currentWeather,
                currentRouteInfo: currentRouteInfo,
                expandedRoutes: {},  // 切换天数时重置展开状态
                routeSegmentIcons: routeSegmentIcons,
                isLastDay: isLastDay,
                returnHomeName: returnHomeInfo.name
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



    // 获取路程概况卡片的图标（根据交通方式）
    getRouteSummaryIcon(plan) {
        const transportation = plan?.transportation || '公共交通'
        return ROUTE_TRANSPORT_ICONS[transportation] || '🚗'
    },

    // 获取各路段的图标（根据交通方式和距离）
    // 距离小于阈值时显示步行图标，否则显示对应交通工具图标
    getRouteSegmentIcons(plan, routeInfo) {
        const icons = {}
        if (!routeInfo || !routeInfo.location_names) return icons

        const transportation = plan?.transportation || '公共交通'
        const defaultIcon = ROUTE_TRANSPORT_ICONS[transportation] || '🚗'
        const locationCount = routeInfo.location_names.length

        // 累计距离用于估算每段距离
        // 如果路径信息中包含 segments，可以用来估算每段距离
        const totalDistance = routeInfo.total_distance || 0
        const segmentCount = locationCount - 1
        const avgDistance = segmentCount > 0 ? totalDistance / segmentCount : 0

        for (let i = 1; i < locationCount; i++) {
            // 使用平均距离估算，或者如果有更细粒度的段距离数据可以使用
            const estimatedDistance = avgDistance
            // 距离很近时使用步行图标，否则使用配置的交通工具图标
            icons[i] = estimatedDistance < WALK_DISTANCE_THRESHOLD ? '🚶' : defaultIcon
        }

        return icons
    },

    // 查看路线地图（使用map组件全天模式）
    onViewRouteMap() {
        const { plan, currentDay } = this.data

        if (!plan || !plan.id) {
            wx.showToast({
                title: '行程数据不存在',
                icon: 'none'
            })
            return
        }

        // 根据交通方式设置默认模式
        let defaultMode = 'driving'
        if (plan.transportation === '公共交通') {
            defaultMode = 'transit'
        } else if (plan.transportation === '步行为主') {
            defaultMode = 'walking'
        }

        this.setData({
            showRouteMapPopup: true,
            routeMapDisplayMode: 'day',
            routeMapPlanId: plan.id,
            routeMapDayIndex: currentDay,
            routeMapDefaultMode: defaultMode
        })
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
    },

    // 显示路线段地图弹框
    // fromIndex 和 toIndex 对应 location_names 数组的索引
    // location_names[0] = 起点，location_names[i+1] = planning[i]
    onShowRouteSegment(e) {
        // 将 dataset 中的字符串转换为数字
        const fromIndex = parseInt(e.currentTarget.dataset.fromIndex, 10)
        const toIndex = parseInt(e.currentTarget.dataset.toIndex, 10)
        const { currentDayData, currentRouteInfo, plan, currentDay } = this.data

        if (!currentDayData || !currentDayData.planning || !currentRouteInfo) {
            wx.showToast({ title: '无法获取位置信息', icon: 'none' })
            return
        }

        let fromLocation = null
        let fromName = currentRouteInfo.location_names[fromIndex] || '起点'

        let toLocation = null
        let toName = currentRouteInfo.location_names[toIndex] || '终点'

        // 获取起点坐标
        if (fromIndex === 0) {
            // fromIndex = 0 表示从起点出发
            // 第一天的起点是用户位置，其他天的起点是前一天的酒店（也在 planning 中的某个位置）
            if (currentDay === 0) {
                // 第一天：使用用户起点位置
                if (plan.userLocation && plan.userLocation.latitude && plan.userLocation.longitude) {
                    fromLocation = {
                        longitude: plan.userLocation.longitude,
                        latitude: plan.userLocation.latitude
                    }
                } else {
                    // 尝试从缓存获取当前位置
                    const cachedLocation = storage.getLocation()
                    if (cachedLocation && cachedLocation.latitude && cachedLocation.longitude) {
                        fromLocation = {
                            longitude: cachedLocation.longitude,
                            latitude: cachedLocation.latitude
                        }
                    } else {
                        // 备用方案：使用第一个景点的坐标作为临时起点
                        const firstItem = currentDayData.planning[0]
                        if (firstItem?.location) {
                            fromLocation = {
                                longitude: firstItem.location.longitude,
                                latitude: firstItem.location.latitude
                            }
                            fromName = '起点(位置未知)'
                        } else {
                            wx.showToast({ title: '无法获取起点位置', icon: 'none' })
                            return
                        }
                    }
                }
            } else {
                // 非第一天：起点是前一天的酒店，这种情况不应该显示路线
                // 但如果到达这里，尝试使用当天第一个景点的位置
                const firstItem = currentDayData.planning[0]
                if (firstItem?.location) {
                    fromLocation = {
                        longitude: firstItem.location.longitude,
                        latitude: firstItem.location.latitude
                    }
                } else {
                    wx.showToast({ title: '无法获取起点位置', icon: 'none' })
                    return
                }
            }
        } else {
            // fromIndex > 0：使用 planning[fromIndex - 1] 的位置
            const fromItem = currentDayData.planning[fromIndex - 1]
            if (!fromItem?.location) {
                wx.showToast({ title: '缺少起点坐标', icon: 'none' })
                return
            }
            fromLocation = {
                longitude: fromItem.location.longitude,
                latitude: fromItem.location.latitude
            }
        }

        // 获取终点坐标：使用 planning[toIndex - 1] 的位置
        const toItem = currentDayData.planning[toIndex - 1]
        if (!toItem?.location) {
            wx.showToast({ title: '缺少终点坐标', icon: 'none' })
            return
        }
        toLocation = {
            longitude: toItem.location.longitude,
            latitude: toItem.location.latitude
        }

        // 根据交通方式设置默认模式
        let defaultMode = 'driving'
        if (plan.transportation === '公共交通') {
            defaultMode = 'transit'
        } else if (plan.transportation === '步行为主') {
            defaultMode = 'walking'
        }

        this.setData({
            showRouteMapPopup: true,
            routeMapDisplayMode: 'segment',
            routeMapOrigin: fromLocation,
            routeMapDestination: toLocation,
            routeMapOriginName: fromName,
            routeMapDestinationName: toName,
            routeMapDefaultMode: defaultMode
        })
    },

    // 关闭路线地图弹框
    onCloseRouteMapPopup() {
        this.setData({
            showRouteMapPopup: false
        })
    },

    // 获取返回起点信息
    // @param {Object} plan 行程数据
    // @param {Object} fallbackLocation 可选，备用坐标（用于无法获取用户位置时）
    getReturnHomeInfo(plan, fallbackLocation = null) {
        let location = null
        let name = '返回起点'

        if (plan.userLocation && plan.userLocation.latitude && plan.userLocation.longitude) {
            location = {
                longitude: plan.userLocation.longitude,
                latitude: plan.userLocation.latitude
            }
            name = plan.userLocation.name || '返回起点'
        } else {
            // 尝试从缓存获取当前位置
            const cachedLocation = storage.getLocation()
            if (cachedLocation && cachedLocation.latitude && cachedLocation.longitude) {
                location = {
                    longitude: cachedLocation.longitude,
                    latitude: cachedLocation.latitude
                }
                name = cachedLocation.city ? (cachedLocation.city + '(当前位置)') : '返回当前位置'
            } else if (fallbackLocation) {
                // 使用备用坐标
                location = fallbackLocation
                name = '终点(位置未知)'
            }
        }

        return { location, name }
    },

    // 显示返回起点的路线地图
    onShowReturnRoute() {
        const { currentDayData, plan } = this.data

        if (!currentDayData || !currentDayData.planning || currentDayData.planning.length === 0) {
            wx.showToast({ title: '无法获取位置信息', icon: 'none' })
            return
        }

        // 获取最后一个景点
        const lastItem = currentDayData.planning[currentDayData.planning.length - 1]
        if (!lastItem?.location) {
            wx.showToast({ title: '缺少起点坐标', icon: 'none' })
            return
        }

        // 获取返回起点位置（使用最后一个景点坐标作为备用）
        const returnHomeInfo = this.getReturnHomeInfo(plan, {
            longitude: lastItem.location.longitude,
            latitude: lastItem.location.latitude
        })
        if (!returnHomeInfo.location) {
            wx.showToast({ title: '无法获取终点位置', icon: 'none' })
            return
        }

        // 根据交通方式设置默认模式
        let defaultMode = 'driving'
        if (plan.transportation === '公共交通') {
            defaultMode = 'transit'
        } else if (plan.transportation === '步行为主') {
            defaultMode = 'walking'
        }

        this.setData({
            showRouteMapPopup: true,
            routeMapDisplayMode: 'segment',
            routeMapOrigin: {
                longitude: lastItem.location.longitude,
                latitude: lastItem.location.latitude
            },
            routeMapDestination: returnHomeInfo.location,
            routeMapOriginName: lastItem.name || '最后一站',
            routeMapDestinationName: returnHomeInfo.name,
            routeMapDefaultMode: defaultMode
        })
    }
})
