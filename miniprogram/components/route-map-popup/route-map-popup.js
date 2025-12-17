// 路线地图弹框组件 - 增强版
// 支持两种模式：segment（单段路径）和 day（当天全程路径）
const api = require('../../utils/api.js')

Component({
    properties: {
        // 是否显示
        visible: {
            type: Boolean,
            value: false,
            observer: function (newVal) {
                if (newVal) {
                    this.onShow()
                }
            }
        },
        // 显示模式: segment | day
        displayMode: {
            type: String,
            value: 'segment' // segment: 单段路径, day: 当天全程
        },
        // ======= 单段模式属性 =======
        // 起点坐标 { longitude, latitude }
        origin: {
            type: Object,
            value: null
        },
        // 终点坐标 { longitude, latitude }
        destination: {
            type: Object,
            value: null
        },
        // 起点名称
        originName: {
            type: String,
            value: '起点'
        },
        // 终点名称
        destinationName: {
            type: String,
            value: '终点'
        },
        // ======= 全天模式属性 =======
        // 行程ID（全天模式必需）
        planId: {
            type: String,
            value: ''
        },
        // 天数索引（全天模式必需）
        dayIndex: {
            type: Number,
            value: 0
        },
        // ======= 通用属性 =======
        // 城市（公交路径规划必需）
        city: {
            type: String,
            value: ''
        },
        // 默认交通方式
        defaultMode: {
            type: String,
            value: 'driving' // driving | transit | walking
        }
    },

    data: {
        mode: 'driving',
        loading: false,
        error: '',
        routeData: null,
        mapCenter: { latitude: 39.9, longitude: 116.4 },
        mapScale: 14,
        markers: [],
        polyline: [],
        // 全天模式汇总信息
        totalDistanceText: '',
        totalDurationText: '',
        locationCount: 0,
        // 全屏模式
        isFullscreen: false,
        statusBarHeight: 20,
        fullscreenTop: 64,
        // 交通模式禁用控制
        walkingDisabled: false,
        walkingDisableReason: '',
        transitDisabled: false,
        transitDisableReason: '',
        // 地图折叠状态
        mapCollapsed: false
    },

    lifetimes: {
        attached() {
            this.setData({ mode: this.properties.defaultMode })

            // 获取状态栏高度用于全屏模式
            try {
                const systemInfo = wx.getWindowInfo()
                const statusBarHeight = systemInfo.statusBarHeight || 20
                this.setData({
                    statusBarHeight: statusBarHeight,
                    fullscreenTop: statusBarHeight + 44 // 状态栏 + 导航栏高度
                })
            } catch (e) {
                this.setData({
                    statusBarHeight: 20,
                    fullscreenTop: 64
                })
            }
        }
    },

    methods: {
        // 阻止滑动穿透
        preventTouchMove() {
            return false
        },

        // 关闭弹框
        onClose() {
            this.setData({ isFullscreen: false })
            this.triggerEvent('close')
        },

        // 切换全屏模式
        toggleFullscreen() {
            const isFullscreen = !this.data.isFullscreen
            this.setData({ isFullscreen })

            // 全屏后重新调整地图视野
            if (isFullscreen) {
                setTimeout(() => {
                    this.fitMapToRoute()
                }, 300)
            }
        },

        // 弹框显示时触发
        onShow() {
            const { displayMode, origin, destination, planId } = this.data
            if (displayMode === 'day' && planId) {
                // 全天模式
                this.fetchDayPath()
            } else if (displayMode === 'segment' && origin && destination) {
                // 单段模式
                this.fetchRoute()
            }
        },

        // 切换交通方式
        switchMode(e) {
            const mode = e.currentTarget.dataset.mode
            if (mode === this.data.mode) return

            this.setData({ mode })

            if (this.data.displayMode === 'day') {
                this.fetchDayPath()
            } else {
                this.fetchRoute()
            }
        },

        // 点击禁用的步行按钮时提示
        onWalkingDisabledTap() {
            wx.showToast({
                title: this.data.walkingDisableReason,
                icon: 'none',
                duration: 2000
            })
        },

        // 点击禁用的公交按钮时提示
        onTransitDisabledTap() {
            wx.showToast({
                title: this.data.transitDisableReason,
                icon: 'none',
                duration: 2000
            })
        },

        // 切换地图折叠状态
        toggleMapCollapse() {
            this.setData({
                mapCollapsed: !this.data.mapCollapsed
            })
        },

        // ======= 全天路径获取 =======
        async fetchDayPath() {
            const { planId, dayIndex, mode, city } = this.data

            if (!planId) {
                this.setData({ error: '缺少行程ID' })
                return
            }

            this.setData({
                loading: true,
                error: '',
                routeData: null
            })

            try {
                const result = await api.getDayPath(planId, dayIndex, mode)

                // 检测交通模式可用性（禁用不适合的模式）
                this.checkModeAvailability(result)

                // 检查是否有空路径段，如果有则前端重新请求
                await this.retryEmptyPolylines(result, mode, city || this.properties.city)

                // 为每个路段添加mode字段（如果后端没有提供）
                if (result.polylines) {
                    result.polylines = result.polylines.map(pl => ({
                        ...pl,
                        mode: pl.mode || mode  // 使用路段自带的mode或当前选择的mode
                    }))
                }

                // 生成地图数据
                const mapData = this.generateDayMapData(result)

                this.setData({
                    loading: false,
                    routeData: result,
                    totalDistanceText: result.totalDistanceText,
                    totalDurationText: result.totalDurationText,
                    locationCount: result.locationCount,
                    ...mapData
                })

                // 延迟调用 includePoints 让地图自动调整视野
                setTimeout(() => {
                    this.fitMapToRoute()
                }, 100)

            } catch (err) {
                console.error('获取全天路径失败:', err)
                this.setData({
                    loading: false,
                    error: err.message || '获取路径失败，请重试'
                })
            }
        },

        // 检测交通模式可用性
        checkModeAvailability(result) {
            if (!result.markers || result.markers.length < 2) return

            let maxDistance = 0
            let minDistance = Infinity
            let longSegmentInfo = ''
            let shortSegmentInfo = ''

            // 检查所有路径段的距离
            for (let i = 0; i < result.markers.length - 1; i++) {
                const from = result.markers[i]
                const to = result.markers[i + 1]

                const distance = this.calculateDistance(
                    from.latitude, from.longitude,
                    to.latitude, to.longitude
                )

                if (distance > maxDistance) {
                    maxDistance = distance
                    longSegmentInfo = `${from.name} → ${to.name}`
                }
                if (distance < minDistance) {
                    minDistance = distance
                    shortSegmentInfo = `${from.name} → ${to.name}`
                }
            }

            // 步行模式：如果有超过100km的路径段，禁用
            if (maxDistance > 100000) {
                this.setData({
                    walkingDisabled: true,
                    walkingDisableReason: `距离过远(${(maxDistance / 1000).toFixed(0)}km)，不适合步行`
                })
                console.log(`[步行禁用] ${longSegmentInfo}: ${(maxDistance / 1000).toFixed(1)}km`)
            } else {
                this.setData({
                    walkingDisabled: false,
                    walkingDisableReason: ''
                })
            }

            // 公交模式：如果所有路径段都小于1km，禁用
            // （全部都是短距离，步行更合适）
            if (maxDistance < 1500) {
                this.setData({
                    transitDisabled: true,
                    transitDisableReason: `距离过近(${maxDistance.toFixed(0)}m)，建议步行`
                })
                console.log(`[公交禁用] 最远路径段${shortSegmentInfo}: ${maxDistance.toFixed(0)}m`)
            } else {
                this.setData({
                    transitDisabled: false,
                    transitDisableReason: ''
                })
            }
        },

        // 重新请求空路径段
        async retryEmptyPolylines(result, mode, city) {
            if (!result.polylines || !result.markers) return

            const emptyPolylines = result.polylines
                .map((pl, idx) => ({ ...pl, index: idx }))
                .filter(pl => !pl.points || pl.points.length === 0)

            if (emptyPolylines.length === 0) return

            console.log(`[降级] 发现${emptyPolylines.length}条空路径，开始重新请求...`)
            console.log(`[降级] 当前模式: ${mode}, 城市: ${city || '未指定'}`)

            for (const pl of emptyPolylines) {
                try {
                    // 从markers中找到起点和终点
                    const fromMarker = result.markers.find(m => m.id === pl.fromId)
                    const toMarker = result.markers.find(m => m.id === pl.toId)

                    if (!fromMarker || !toMarker) {
                        console.error(`[降级] 无法找到marker: fromId=${pl.fromId}, toId=${pl.toId}`)
                        continue
                    }

                    // 计算直线距离估算
                    const distance = this.calculateDistance(
                        fromMarker.latitude, fromMarker.longitude,
                        toMarker.latitude, toMarker.longitude
                    )

                    console.log(`[降级] 重新请求路径: ${pl.fromName} -> ${pl.toName}, 估算距离: ${(distance / 1000).toFixed(1)}km`)

                    // ========= 智能模式自适应 =========
                    let actualMode = mode

                    // 1. 距离太远：步行不适用
                    if (distance > 100000 && mode === 'walking') {
                        console.warn(`  ⚠️ 距离过远(${(distance / 1000).toFixed(1)}km)，步行不适用，跳过`)
                        continue
                    }

                    // 2. 距离太近：公交自动改用步行
                    if (distance < 1000 && mode === 'transit') {
                        console.warn(`  ⚠️ 距离过近(${distance.toFixed(0)}m)，公交不适用，自动改用步行`)
                        actualMode = 'walking'
                    }

                    const originStr = `${fromMarker.longitude},${fromMarker.latitude}`
                    const destinationStr = `${toMarker.longitude},${toMarker.latitude}`

                    let routeResult
                    if (actualMode === 'driving') {
                        routeResult = await api.getRouteDriving(originStr, destinationStr)
                    } else if (actualMode === 'walking') {
                        routeResult = await api.getRouteWalking(originStr, destinationStr)
                    } else if (actualMode === 'transit') {
                        if (!city) {
                            console.error(`  ❌ 公交模式需要城市参数`)
                            continue
                        }
                        console.log(`  调用公交API，城市: "${city}"`)
                        routeResult = await api.getRouteTransit(originStr, destinationStr, city)
                    }

                    if (routeResult && routeResult.polyline && routeResult.polyline.length > 0) {
                        // 更新result中的polyline数据
                        result.polylines[pl.index].points = routeResult.polyline
                        result.polylines[pl.index].distance = routeResult.distance
                        result.polylines[pl.index].duration = routeResult.duration
                        result.polylines[pl.index].distanceText = routeResult.distance >= 1000
                            ? `${(routeResult.distance / 1000).toFixed(1)}km`
                            : `${routeResult.distance}m`
                        console.log(`  ✅ 成功获取路径，points数: ${routeResult.polyline.length}`)
                    } else {
                        console.warn(`  ⚠️ API返回空路径或无polyline`)
                    }

                } catch (err) {
                    console.error(`[降级] 重新请求失败: ${pl.fromName} -> ${pl.toName}`)
                    console.error(`  错误详情:`, err)
                }
            }
        },

        // 生成全天地图数据（多点多线）
        generateDayMapData(result) {
            const markers = (result.markers || []).map((marker, idx) => ({
                id: marker.id,
                latitude: marker.latitude,
                longitude: marker.longitude,
                title: marker.name,
                width: 30,
                height: 30,
                anchor: { x: 0.5, y: 1 },
                callout: {
                    content: marker.name,
                    color: '#ffffff',
                    bgColor: marker.color || '#3b82f6',
                    fontSize: 12,
                    borderRadius: 8,
                    padding: 8,
                    display: 'ALWAYS'
                },
                label: {
                    content: marker.label,
                    color: '#ffffff',
                    bgColor: marker.color || '#3b82f6',
                    fontSize: 10,
                    borderRadius: 12,
                    padding: 4,
                    anchorX: 0,
                    anchorY: -35
                }
            }))

            // 多条线段
            const polyline = (result.polylines || []).map((pl, idx) => {
                const hasPoints = pl.points && pl.points.length > 0
                console.log(`[调试] polyline[${idx}]: ${pl.fromName} -> ${pl.toName}, points: ${pl.points?.length || 0}`)
                if (!hasPoints) {
                    console.warn(`  ⚠️ 路径段仍然为空（前端重试可能也失败了）`)
                }

                // 获取交通方式（从数据中或使用当前模式）
                const mode = pl.mode || this.data.mode

                // 根据交通方式设置线条样式（保留原有颜色用于顺序区分）
                let lineStyle = {}
                if (mode === 'walking') {
                    lineStyle = { width: 4, dottedLine: true }
                } else if (mode === 'transit') {
                    lineStyle = { width: 5, dottedLine: false }
                } else { // driving
                    lineStyle = { width: 6, dottedLine: false }
                }

                return {
                    points: pl.points || [],
                    color: pl.color || '#8b5cf6',  // 保留原有颜色
                    width: lineStyle.width,
                    dottedLine: lineStyle.dottedLine,
                    arrowLine: pl.arrowLine !== false,
                    borderColor: this.darkenColor(pl.color || '#8b5cf6'),
                    borderWidth: 1
                }
            })

            console.log('[调试] 总polyline数量:', polyline.length)
            console.log('[调试] 有效polyline数量:', polyline.filter(p => p.points.length > 0).length)

            // 计算中心点
            let mapCenter = { latitude: 39.9, longitude: 116.4 }
            if (markers.length > 0) {
                const sumLat = markers.reduce((sum, m) => sum + m.latitude, 0)
                const sumLng = markers.reduce((sum, m) => sum + m.longitude, 0)
                mapCenter = {
                    latitude: sumLat / markers.length,
                    longitude: sumLng / markers.length
                }
            }

            return { markers, polyline, mapCenter, mapScale: 12 }
        },

        // 颜色加深（用于边框）
        darkenColor(hex) {
            // 简单的颜色加深处理
            const colorMap = {
                '#8b5cf6': '#7c3aed',
                '#10b981': '#059669',
                '#f59e0b': '#d97706',
                '#ef4444': '#dc2626',
                '#6366f1': '#4f46e5',
                '#ec4899': '#db2777',
                '#14b8a6': '#0d9488',
                '#f97316': '#ea580c',
                '#3b82f6': '#2563eb'
            }
            return colorMap[hex] || hex
        },

        // ======= 单段路径获取（原有逻辑）=======
        async fetchRoute() {
            const { origin, destination, city, mode } = this.data

            if (!origin || !destination) {
                this.setData({ error: '缺少起点或终点信息' })
                return
            }

            this.setData({
                loading: true,
                error: '',
                routeData: null
            })

            try {
                const originStr = `${origin.longitude},${origin.latitude}`
                const destinationStr = `${destination.longitude},${destination.latitude}`

                // ========= 计算距离并智能选择模式 =========
                const distance = this.calculateDistance(
                    origin.latitude, origin.longitude,
                    destination.latitude, destination.longitude
                )

                const fromName = this.properties.originName || '起点'
                const toName = this.properties.destinationName || '终点'

                // 创建临时result用于检测模式可用性
                const tempResult = {
                    markers: [
                        { id: 0, latitude: origin.latitude, longitude: origin.longitude, name: fromName },
                        { id: 1, latitude: destination.latitude, longitude: destination.longitude, name: toName }
                    ]
                }
                this.checkModeAvailability(tempResult)

                let actualMode = mode

                // 距离太远且选择步行：跳过（按钮已禁用）
                if (distance > 100000 && mode === 'walking') {
                    console.warn(`[单段路线] 距离过远，步行模式已禁用`)
                    this.setData({ loading: false })
                    return
                }

                // 距离太近：公交自动改用步行
                if (distance < 1000 && mode === 'transit') {
                    console.warn(`[单段路线] 距离过近(${distance.toFixed(0)}m)，公交不适用，自动改用步行`)
                    actualMode = 'walking'
                }

                let result
                if (actualMode === 'driving') {
                    result = await api.getRouteDriving(originStr, destinationStr)
                } else if (actualMode === 'walking') {
                    result = await api.getRouteWalking(originStr, destinationStr)
                } else if (actualMode === 'transit') {
                    if (!city) {
                        this.setData({
                            loading: false,
                            error: '公交路径规划需要城市信息'
                        })
                        return
                    }
                    result = await api.getRouteTransit(originStr, destinationStr, city)
                }

                // 格式化距离
                result.distanceText = result.distance >= 1000
                    ? `${(result.distance / 1000).toFixed(1)}公里`
                    : `${result.distance}米`

                // 为每个 step 添加 distanceText（WXML 不支持 .toFixed()）
                if (result.steps && result.steps.length > 0) {
                    result.steps = result.steps.map(step => ({
                        ...step,
                        distanceText: step.distance >= 1000
                            ? `${(step.distance / 1000).toFixed(1)}km`
                            : `${step.distance}m`
                    }))
                }

                // 生成地图数据（传入路线实际距离用于计算缩放级别）
                const mapData = this.generateMapData(result.polyline, result.distance)

                this.setData({
                    loading: false,
                    routeData: result,
                    ...mapData
                })

                // 延迟调用 includePoints 让地图自动调整视野
                setTimeout(() => {
                    this.fitMapToRoute()
                }, 100)

            } catch (err) {
                console.error('获取路线失败:', err)
                this.setData({
                    loading: false,
                    error: err.message || '获取路线失败，请重试'
                })
            }
        },

        // 生成单段地图数据（markers + polyline + center）
        generateMapData(polyline, routeDistance) {
            const { origin, destination, originName, destinationName } = this.data

            // 起点和终点 markers（使用内置样式）
            const markers = [
                {
                    id: 0,
                    latitude: origin.latitude,
                    longitude: origin.longitude,
                    title: originName,
                    width: 28,
                    height: 28,
                    anchor: { x: 0.5, y: 1 },
                    callout: {
                        content: originName,
                        color: '#ffffff',
                        bgColor: '#10b981',
                        fontSize: 12,
                        borderRadius: 8,
                        padding: 8,
                        display: 'ALWAYS'
                    }
                },
                {
                    id: 1,
                    latitude: destination.latitude,
                    longitude: destination.longitude,
                    title: destinationName,
                    width: 28,
                    height: 28,
                    anchor: { x: 0.5, y: 1 },
                    callout: {
                        content: destinationName,
                        color: '#ffffff',
                        bgColor: '#ef4444',
                        fontSize: 12,
                        borderRadius: 8,
                        padding: 8,
                        display: 'ALWAYS'
                    }
                }
            ]

            // 路线 polyline - 根据交通方式设置线条样式
            const mode = this.data.mode
            let lineStyle = {}
            if (mode === 'walking') {
                lineStyle = { width: 4, dottedLine: true }
            } else if (mode === 'transit') {
                lineStyle = { width: 5, dottedLine: false }
            } else { // driving
                lineStyle = { width: 6, dottedLine: false }
            }

            const polylineData = [{
                points: polyline || [],
                color: '#8b5cf6',  // 保留原有颜色
                width: lineStyle.width,
                dottedLine: lineStyle.dottedLine,
                arrowLine: true,
                borderColor: '#6366f1',
                borderWidth: 1
            }]

            // 计算地图中心点
            let mapCenter = {
                latitude: (origin.latitude + destination.latitude) / 2,
                longitude: (origin.longitude + destination.longitude) / 2
            }

            // 使用路线实际距离计算缩放级别（更准确）
            const distance = routeDistance || this.calculateDistance(
                origin.latitude, origin.longitude,
                destination.latitude, destination.longitude
            )

            let mapScale = 14
            if (distance > 100000) mapScale = 8       // 100km 以上
            else if (distance > 50000) mapScale = 9   // 50-100km
            else if (distance > 30000) mapScale = 10  // 30-50km
            else if (distance > 15000) mapScale = 11  // 15-30km
            else if (distance > 8000) mapScale = 12   // 8-15km
            else if (distance > 4000) mapScale = 13   // 4-8km
            else if (distance > 2000) mapScale = 14   // 2-4km
            else if (distance > 1000) mapScale = 15   // 1-2km
            else if (distance > 500) mapScale = 16    // 500m-1km
            else mapScale = 17                        // 500m 以内

            console.log('路线距离:', distance, '米, 缩放级别:', mapScale)

            return {
                markers,
                polyline: polylineData,
                mapCenter,
                mapScale
            }
        },

        // 自动调整地图视野以包含整条路线
        fitMapToRoute() {
            const { markers, polyline, displayMode } = this.data
            if (!markers || markers.length === 0) return

            // 获取地图上下文
            const mapCtx = wx.createMapContext('routeMap', this)

            // 收集所有需要包含的点
            const points = markers.map(m => ({
                latitude: m.latitude,
                longitude: m.longitude
            }))

            // 如果有 polyline 点，取一些关键点
            if (polyline && polyline.length > 0 && polyline[0].points && polyline[0].points.length > 0) {
                const routePoints = polyline[0].points
                // 取起点、中间点、终点确保路线在视野内
                if (routePoints.length > 2) {
                    const midIndex = Math.floor(routePoints.length / 2)
                    points.push(routePoints[midIndex])
                }
            }

            // 使用 includePoints 自动调整视野
            mapCtx.includePoints({
                points: points,
                padding: [80, 40, 80, 40], // 上右下左边距
                success: () => {
                    console.log('地图视野调整成功')
                },
                fail: (err) => {
                    console.error('地图视野调整失败:', err)
                }
            })
        },

        // 计算两点距离（米）- 备用
        calculateDistance(lat1, lon1, lat2, lon2) {
            const R = 6371000
            const dLat = (lat2 - lat1) * Math.PI / 180
            const dLon = (lon2 - lon1) * Math.PI / 180
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2)
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
            return R * c
        },

        // 打开导航
        openNavigation() {
            const { destination, destinationName, displayMode, markers } = this.data

            // 全天模式：导航到最后一个点
            let navDest = destination
            let navName = destinationName

            if (displayMode === 'day' && markers && markers.length > 0) {
                const lastMarker = markers[markers.length - 1]
                navDest = { latitude: lastMarker.latitude, longitude: lastMarker.longitude }
                navName = lastMarker.title || '终点'
            }

            if (!navDest) {
                wx.showToast({
                    title: '缺少目的地信息',
                    icon: 'none'
                })
                return
            }

            wx.openLocation({
                latitude: navDest.latitude,
                longitude: navDest.longitude,
                name: navName,
                scale: 15,
                success: () => {
                    console.log('打开导航成功')
                },
                fail: (err) => {
                    console.error('打开导航失败:', err)
                    wx.showToast({
                        title: '打开导航失败',
                        icon: 'none'
                    })
                }
            })
        }
    }
})
