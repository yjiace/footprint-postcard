// pages/plan-list/plan-list.js
const api = require('../../utils/api.js')
const storage = require('../../utils/storage.js')
const util = require('../../utils/util.js')

Page({
    data: {
        planList: [],
        loading: true,
        refreshing: false,
        isLoggedIn: false,
        // 分页相关
        page: 1,
        pageSize: 10,
        hasMore: true,
        loadingMore: false
    },

    onShow() {
        this.loadPlanList(true) // 首次加载，重置分页
    },

    // 加载规划列表
    async loadPlanList(reset = false) {
        const isLoggedIn = storage.isLoggedIn()
        this.setData({ isLoggedIn })

        // 未登录时不加载数据
        if (!isLoggedIn) {
            this.setData({
                planList: [],
                loading: false
            })
            return
        }

        // 如果是重置，重新从第一页开始
        if (reset) {
            this.setData({
                page: 1,
                hasMore: true,
                loading: true
            })
        }

        // 如果没有更多数据且不是重置，直接返回
        if (!reset && !this.data.hasMore) {
            return
        }

        try {
            // 首次加载时，先从本地缓存快速显示
            if (reset) {
                const cachedData = storage.getPlanListCache()
                if (cachedData && cachedData.list && cachedData.list.length > 0) {
                    this.setData({
                        planList: cachedData.list,
                        loading: false
                    })
                }
            }

            // 从服务器获取数据
            const result = await api.getPlanList(this.data.page, this.data.pageSize)
            const serverList = result.list || []
            const hasMore = result.hasMore !== undefined ? result.hasMore : serverList.length >= this.data.pageSize

            if (reset) {
                // 重置时直接替换列表
                this.setData({
                    planList: serverList,
                    loading: false,
                    hasMore,
                    page: this.data.page + 1
                })
                // 缓存第一页数据
                storage.setPlanListCache({ list: serverList, timestamp: Date.now() })
            } else {
                // 追加数据
                const newList = [...this.data.planList, ...serverList]
                this.setData({
                    planList: newList,
                    loadingMore: false,
                    hasMore,
                    page: this.data.page + 1
                })
            }
        } catch (err) {
            console.error('加载规划列表失败:', err)
            this.setData({
                loading: false,
                loadingMore: false
            })
        }
    },

    // 上拉加载更多
    onReachBottom() {
        if (this.data.loadingMore || !this.data.hasMore || !this.data.isLoggedIn) {
            return
        }
        this.setData({ loadingMore: true })
        this.loadPlanList(false)
    },

    // 跳转登录
    goLogin() {
        wx.navigateTo({
            url: '/pages/login/login?redirect=/pages/plan-list/plan-list'
        })
    },

    // 下拉刷新
    async onRefresh() {
        this.setData({ refreshing: true })
        await this.loadPlanList(true) // 重置分页
        this.setData({ refreshing: false })
    },

    // 查看详情
    onViewDetail(e) {
        const index = e.currentTarget.dataset.index
        const item = this.data.planList[index]

        // 如果正在滑动状态，则不跳转
        if (item && item.swiped) {
            return
        }

        const id = e.currentTarget.dataset.id
        wx.navigateTo({
            url: `/pages/plan-detail/plan-detail?id=${id}`
        })
    },

    // 触摸开始
    onTouchStart(e) {
        this.touchStartX = e.touches[0].clientX
        this.touchStartY = e.touches[0].clientY
    },

    // 触摸移动
    onTouchMove(e) {
        // 计算移动距离
        const moveX = e.touches[0].clientX - this.touchStartX
        const moveY = e.touches[0].clientY - this.touchStartY

        // 如果是水平滑动
        if (Math.abs(moveX) > Math.abs(moveY)) {
            e.preventDefault && e.preventDefault()
        }
    },

    // 触摸结束
    onTouchEnd(e) {
        const moveX = e.changedTouches[0].clientX - this.touchStartX
        const index = e.currentTarget.dataset.index
        const planList = this.data.planList

        // 清除之前的定时器
        if (this.hideTimer) {
            clearTimeout(this.hideTimer)
            this.hideTimer = null
        }

        // 先重置所有其他项的滑动状态
        planList.forEach((item, i) => {
            if (i !== index) {
                item.swiped = false
            }
        })

        // 根据滑动方向设置当前项状态
        if (moveX < -50) {
            // 向左滑动，显示删除按钮
            planList[index].swiped = true

            // 5秒后自动隐藏
            this.hideTimer = setTimeout(() => {
                this.hideAllSwiped()
            }, 5000)
        } else if (moveX > 50) {
            // 向右滑动，隐藏删除按钮
            planList[index].swiped = false
        }

        this.setData({ planList })
    },

    // 隐藏所有滑动状态
    hideAllSwiped() {
        if (this.hideTimer) {
            clearTimeout(this.hideTimer)
            this.hideTimer = null
        }

        const planList = this.data.planList
        let hasChange = false

        planList.forEach(item => {
            if (item.swiped) {
                item.swiped = false
                hasChange = true
            }
        })

        if (hasChange) {
            this.setData({ planList })
        }
    },

    // 点击空白处隐藏删除按钮
    onPageTap() {
        this.hideAllSwiped()
    },

    // 删除规划
    onDelete(e) {
        const id = e.currentTarget.dataset.id
        const city = e.currentTarget.dataset.city

        wx.showModal({
            title: '确认删除',
            content: `确定要删除「${city}」的行程规划吗？`,
            confirmColor: '#ef4444',
            success: async (res) => {
                if (res.confirm) {
                    try {
                        util.showLoading('删除中...')

                        // 调用API删除
                        if (storage.isLoggedIn()) {
                            await api.deletePlan(id)
                        }

                        // 从本地存储删除
                        storage.removePlan(id)

                        // 更新列表
                        const newList = this.data.planList.filter(item => item.id !== id)
                        this.setData({ planList: newList })

                        util.hideLoading()
                        util.showSuccess('删除成功')
                    } catch (err) {
                        console.error('删除失败:', err)
                        util.hideLoading()
                        util.showError('删除失败')
                    }
                }
            }
        })
    },

    // 新增规划
    onAdd() {
        wx.navigateTo({
            url: '/pages/plan/plan'
        })
    },

    // 分享
    onShareAppMessage() {
        return util.shareToWeChat(
            '来一起规划旅行吧',
            '/images/share.jpg',
            '/pages/plan-list/plan-list'
        )
    }
})
