// pages/attractions/attractions.js
const app = getApp()
const api = require('../../utils/api.js')
const util = require('../../utils/util.js')

Page({
    data: {
        // 位置信息
        latitude: 0,
        longitude: 0,

        // 景点数据
        attractions: [],
        totalCount: 0,

        // 分页
        page: 1,
        pageSize: 20,

        // 状态
        loading: false,
        refreshing: false,
        noMore: false,
        showBackTop: false,
        scrollToView: '',

        // 搜索条件
        keywords: '',

        // 景点类型选项
        filterTypeIndex: 0,
        filterTypes: [
            { name: '全部类型', shortName: '全部', value: 'all', types: '风景名胜|公园广场|博物馆|游乐场|主题公园' },
            { name: '风景名胜', shortName: '风景', value: 'scenic', types: '风景名胜' },
            { name: '公园广场', shortName: '公园', value: 'park', types: '公园广场' },
            { name: '博物馆', shortName: '博物馆', value: 'museum', types: '博物馆' },
            { name: '游乐场', shortName: '游乐', value: 'amusement', types: '游乐场' },
            { name: '主题公园', shortName: '主题', value: 'theme', types: '主题公园' },
            { name: '动物园', shortName: '动物', value: 'zoo', types: '动物园' },
            { name: '植物园', shortName: '植物', value: 'botanical', types: '植物园' },
            { name: '海洋馆', shortName: '海洋', value: 'aquarium', types: '水族馆' }
        ],

        // 搜索半径选项
        radiusIndex: 2,
        radiusOptions: [
            { name: '1公里内', shortName: '1km', value: 1 },
            { name: '5公里内', shortName: '5km', value: 5 },
            { name: '10公里内', shortName: '10km', value: 10 },
            { name: '20公里内', shortName: '20km', value: 20 },
            { name: '50公里内', shortName: '50km', value: 50 }
        ]
    },

    onLoad(options) {
        // 获取传递的位置参数
        const latitude = parseFloat(options.latitude) || 0
        const longitude = parseFloat(options.longitude) || 0

        console.log('attractions onLoad, 参数位置:', { latitude, longitude })
        console.log('attractions onLoad, 全局位置:', app.globalData.location)

        if (latitude > 0 && longitude > 0) {
            console.log('使用 URL 参数位置')
            this.setData({ latitude, longitude })
            this.loadAttractions(true)
        } else {
            // 尝试从全局数据获取位置
            const location = app.globalData.location
            if (location && location.latitude > 0 && location.longitude > 0) {
                console.log('使用全局数据位置')
                this.setData({
                    latitude: location.latitude,
                    longitude: location.longitude
                })
                this.loadAttractions(true)
            } else {
                // 都没有，主动获取位置
                console.log('无有效位置，主动获取定位')
                this.getCurrentLocation()
            }
        }
    },

    // 获取当前位置
    async getCurrentLocation() {
        try {
            // 检查定位权限
            const authSetting = await new Promise((resolve) => {
                wx.getSetting({ success: resolve })
            })

            if (!authSetting.authSetting['scope.userLocation']) {
                const authResult = await new Promise((resolve) => {
                    wx.authorize({
                        scope: 'scope.userLocation',
                        success: () => resolve(true),
                        fail: () => resolve(false)
                    })
                })

                if (!authResult) {
                    wx.showModal({
                        title: '位置权限',
                        content: '需要获取您的位置信息来显示周边景点',
                        confirmText: '去设置',
                        success: (res) => {
                            if (res.confirm) {
                                wx.openSetting()
                            }
                        }
                    })
                    // 使用默认位置
                    this.setData({ latitude: 31.2304, longitude: 121.4737 })
                    this.loadAttractions(true)
                    return
                }
            }

            // 获取位置
            const location = await new Promise((resolve, reject) => {
                wx.getLocation({
                    type: 'gcj02',
                    success: resolve,
                    fail: reject
                })
            })

            this.setData({
                latitude: location.latitude,
                longitude: location.longitude
            })
            this.loadAttractions(true)

        } catch (err) {
            console.error('获取位置失败:', err)
            // 使用默认位置（上海）
            this.setData({ latitude: 31.2304, longitude: 121.4737 })
            this.loadAttractions(true)
            wx.showToast({ title: '定位失败，使用默认位置', icon: 'none' })
        }
    },

    // 关键字输入
    onKeywordsInput(e) {
        this.setData({ keywords: e.detail.value })
    },

    // 清除关键字
    onClearKeywords() {
        this.setData({ keywords: '' })
    },

    // 景点类型选择
    onTypeChange(e) {
        this.setData({ filterTypeIndex: parseInt(e.detail.value) })
    },

    // 搜索半径选择
    onRadiusChange(e) {
        this.setData({ radiusIndex: parseInt(e.detail.value) })
    },

    // 执行搜索
    onSearch() {
        this.loadAttractions(true)
    },

    // 加载景点数据
    async loadAttractions(refresh = false) {
        if (this.data.loading) return

        // 确定当前页码
        let currentPage = this.data.page

        // 如果是刷新，重置分页
        if (refresh) {
            currentPage = 1
            this.setData({
                page: 1,
                noMore: false,
                attractions: []
            })
        }

        this.setData({ loading: true })

        try {
            const {
                latitude, longitude, pageSize,
                keywords, filterTypeIndex, filterTypes,
                radiusIndex, radiusOptions
            } = this.data

            // 获取当前筛选的类型
            const filterItem = filterTypes[filterTypeIndex]
            const types = filterItem ? filterItem.types : '风景名胜|公园广场'

            // 获取搜索半径
            const radius = radiusOptions[radiusIndex].value

            console.log('API请求参数:', { latitude, longitude, radius, types, page: currentPage, pageSize, keywords })

            // 调用 API（使用正确的 currentPage）
            const result = await api.getNearbyAttractions(
                latitude, longitude, radius, types, currentPage, pageSize, keywords
            )

            // 处理返回数据（适配后端新格式）
            let newAttractions = []
            let hasMore = true
            let total = 0

            if (result && result.list) {
                newAttractions = result.list
                hasMore = result.hasMore !== false
                total = result.total || 0
            } else if (Array.isArray(result)) {
                newAttractions = result
                total = result.length
            } else if (result && result.data) {
                newAttractions = result.data
            }

            // 格式化数据
            newAttractions = newAttractions.map(item => ({
                id: item.id || item._id || Math.random().toString(36).substr(2, 9),
                name: item.name || item.title || '未知景点',
                image: item.image || item.cover || item.picture || '/images/default-attraction.jpg',
                tags: item.tags || item.category || '',
                distance: item.distance || '',
                address: item.address || ''
            }))

            // 代理图片URL
            newAttractions = api.proxyImageUrls(newAttractions)

            // 判断是否还有更多
            const noMore = !hasMore || newAttractions.length < pageSize

            console.log('分页结果:', {
                currentPage,
                newCount: newAttractions.length,
                pageSize,
                hasMore,
                noMore,
                total
            })

            // 更新数据
            this.setData({
                attractions: refresh ? newAttractions : [...this.data.attractions, ...newAttractions],
                totalCount: refresh ? total : this.data.totalCount,
                page: currentPage + 1,
                noMore: noMore,
                loading: false,
                refreshing: false
            })

        } catch (err) {
            console.error('加载景点失败:', err)
            this.setData({
                loading: false,
                refreshing: false
            })
            util.showError('加载失败，请重试')
        }
    },

    // 下拉刷新
    onRefresh() {
        this.setData({ refreshing: true })
        this.loadAttractions(true)
    },

    // 上滑加载更多
    onLoadMore() {
        console.log('onLoadMore 触发, noMore:', this.data.noMore, 'loading:', this.data.loading, 'page:', this.data.page)
        if (this.data.noMore || this.data.loading) {
            console.log('跳过加载: noMore=', this.data.noMore, 'loading=', this.data.loading)
            return
        }
        this.loadAttractions(false)
    },

    // 点击景点
    onAttractionTap(e) {
        const item = e.currentTarget.dataset.item
        console.log('点击景点:', item)
        wx.showToast({
            title: item.name,
            icon: 'none'
        })
    },

    // 监听滚动
    onScroll(e) {
        const scrollTop = e.detail.scrollTop
        const showBackTop = scrollTop > 500
        if (showBackTop !== this.data.showBackTop) {
            this.setData({ showBackTop })
        }
    },

    // 回到顶部
    scrollToTop() {
        this.setData({ scrollToView: 'list-top' })
        // 重置以便下次可以再次触发
        setTimeout(() => {
            this.setData({ scrollToView: '' })
        }, 100)
    },

    // 清除关键字
    onClearKeywords() {
        this.setData({ keywords: '' })
    }
})
