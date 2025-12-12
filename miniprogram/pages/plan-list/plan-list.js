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
        loadingMore: false,
        // 回到顶部
        showBackTop: false,
        scrollTop: 0
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

    // 监听滚动
    onScroll(e) {
        const scrollTop = e.detail.scrollTop
        const showBackTop = scrollTop > 300 // 滚动超过 300px 显示
        if (this.data.showBackTop !== showBackTop) {
            this.setData({ showBackTop })
        }
    },

    // 回到顶部
    scrollToTop() {
        this.setData({ scrollTop: 0 })
        // 需要先设置非 0 值再设置 0，确保触发滚动
        setTimeout(() => {
            this.setData({ scrollTop: 0 })
        }, 50)
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
        const status = e.currentTarget.dataset.status

        // 根据状态处理
        if (status === 'generating') {
            wx.showToast({
                title: '行程正在生成中，请稍后刷新',
                icon: 'none',
                duration: 2000
            })
            return
        }

        if (status === 'failed') {
            wx.showModal({
                title: '生成失败',
                content: '该行程生成失败，是否删除并重新规划？',
                confirmText: '重新规划',
                cancelText: '取消',
                success: (res) => {
                    if (res.confirm) {
                        // 删除失败的行程并跳转到规划页
                        this.deletePlanById(id)
                        wx.navigateTo({
                            url: '/pages/plan/plan'
                        })
                    }
                }
            })
            return
        }

        wx.navigateTo({
            url: `/pages/plan-detail/plan-detail?id=${id}`
        })
    },

    // 根据ID删除行程（辅助函数）
    async deletePlanById(id) {
        try {
            if (storage.isLoggedIn()) {
                await api.deletePlan(id)
            }
            storage.removePlan(id)
            const newList = this.data.planList.filter(item => item.id !== id)
            this.setData({ planList: newList })
        } catch (err) {
            console.error('删除行程失败:', err)
        }
    },

    // 切换下拉菜单显示
    onToggleMenu(e) {
        const index = e.currentTarget.dataset.index
        const planList = this.data.planList

        // 先关闭所有其他菜单
        planList.forEach((item, i) => {
            if (i !== index) {
                item.menuOpen = false
            }
        })

        // 切换当前菜单状态
        planList[index].menuOpen = !planList[index].menuOpen

        this.setData({ planList })

        // 5秒后自动关闭菜单
        if (planList[index].menuOpen) {
            if (this.menuTimer) {
                clearTimeout(this.menuTimer)
            }
            this.menuTimer = setTimeout(() => {
                this.closeAllMenus()
            }, 5000)
        }
    },

    // 关闭所有菜单
    closeAllMenus() {
        if (this.menuTimer) {
            clearTimeout(this.menuTimer)
            this.menuTimer = null
        }

        const planList = this.data.planList
        let hasChange = false

        planList.forEach(item => {
            if (item.menuOpen) {
                item.menuOpen = false
                hasChange = true
            }
        })

        if (hasChange) {
            this.setData({ planList })
        }
    },

    // 点击空白处关闭菜单
    onPageTap() {
        this.closeAllMenus()
    },

    // 删除规划
    onDelete(e) {
        this.closeAllMenus()
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

    // 生成明信片
    async onGeneratePostcard(e) {
        const id = e.currentTarget.dataset.id
        const city = e.currentTarget.dataset.city

        // 关闭菜单
        this.closeAllMenus()

        wx.showModal({
            title: '生成明信片',
            content: `确定要为「${city}」的行程生成明信片吗？`,
            confirmText: '生成',
            success: async (res) => {
                if (res.confirm) {
                    try {
                        util.showLoading('正在生成明信片...')

                        // 调用生成明信片API
                        const result = await api.generatePostcardFromPlan(id)

                        util.hideLoading()

                        if (result && result.id) {
                            wx.showModal({
                                title: '生成成功',
                                content: '明信片已生成，是否立即查看？',
                                confirmText: '查看',
                                cancelText: '稍后',
                                success: (modalRes) => {
                                    if (modalRes.confirm) {
                                        wx.switchTab({
                                            url: '/pages/postcard/postcard'
                                        })
                                    }
                                }
                            })
                        }
                    } catch (err) {
                        console.error('生成明信片失败:', err)
                        util.hideLoading()
                        util.showError('生成失败，请稍后重试')
                    }
                }
            }
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
