// pages/postcard/postcard.js
const storage = require('../../utils/storage.js')
const util = require('../../utils/util.js')
const api = require('../../utils/api.js')

Page({
    data: {
        postcardList: [],
        isLoggedIn: false,
        loading: true,
        // 分页相关
        page: 1,
        pageSize: 10,
        hasMore: true,
        loadingMore: false
    },

    onLoad() {
        this.loadPostcardList(true)
    },

    onShow() {
        // 每次显示时刷新列表（从缓存或服务器）
        this.loadPostcardList(true)
    },

    onPullDownRefresh() {
        this.loadPostcardList(true).then(() => {
            wx.stopPullDownRefresh()
        })
    },

    // 上拉加载更多
    onReachBottom() {
        if (this.data.loadingMore || !this.data.hasMore || !this.data.isLoggedIn) {
            return
        }
        this.setData({ loadingMore: true })
        this.loadPostcardList(false)
    },

    // 加载明信片列表
    async loadPostcardList(reset = false) {
        const isLoggedIn = storage.isLoggedIn()
        this.setData({ isLoggedIn })

        if (!isLoggedIn) {
            console.log('用户未登录，直接显示空内容')
            this.setData({
                postcardList: [],
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

            // 先从缓存快速显示
            const cachedData = storage.getPostcardListCache()
            if (cachedData && cachedData.list && cachedData.list.length > 0) {
                this.setData({
                    postcardList: cachedData.list,
                    loading: false
                })
            }
        }

        if (!reset && !this.data.hasMore) {
            return
        }

        try {
            const result = await api.getPostcardList(this.data.page, this.data.pageSize)
            const serverList = result.list || []
            const hasMore = result.hasMore !== undefined ? result.hasMore : serverList.length >= this.data.pageSize

            if (reset) {
                this.setData({
                    postcardList: serverList,
                    loading: false,
                    hasMore,
                    page: this.data.page + 1
                })
                // 缓存第一页数据
                storage.setPostcardListCache({ list: serverList, timestamp: Date.now() })
            } else {
                const newList = [...this.data.postcardList, ...serverList]
                this.setData({
                    postcardList: newList,
                    loadingMore: false,
                    hasMore,
                    page: this.data.page + 1
                })
            }
        } catch (err) {
            console.error('加载明信片列表失败', err)
            this.setData({
                loading: false,
                loadingMore: false
            })
        }
    },





    // 点击明信片
    onPostcardTap(e) {
        const item = e.currentTarget.dataset.item
        console.log('查看明信片详情', item)

        // TODO: 跳转到明信片详情页
        // 显示预览
        wx.previewImage({
            current: item.image,
            urls: this.data.postcardList.map(p => p.image)
        })
    },

    // 生成明信片
    async onGenerate() {
        // 先检查用户是否已登录
        if (!storage.isLoggedIn()) {
            console.log('用户未登录，不显示任何提示')
            return
        }

        // 检查是否有足迹或行程
        const trackList = storage.getTrackList()
        const planList = storage.getPlanList()

        if (trackList.length === 0 && planList.length === 0) {
            wx.showModal({
                title: '提示',
                content: '请先完成一次旅行或创建行程',
                showCancel: false
            })
            return
        }

        // 显示选择对话框
        wx.showActionSheet({
            itemList: ['从足迹生成', '从行程生成'],
            success: (res) => {
                if (res.tapIndex === 0) {
                    this.generateFromTrack()
                } else if (res.tapIndex === 1) {
                    this.generateFromPlan()
                }
            }
        })
    },

    // 从足迹生成明信片
    async generateFromTrack() {
        const trackList = storage.getTrackList()
        if (trackList.length === 0) {
            util.showError('暂无足迹记录')
            return
        }

        try {
            util.showLoading('生成中...')

            // 调用实际API生成明信片
            const result = await api.generatePostcard({ type: 'track', data: trackList[0] })

            if (result && result.success) {
                util.hideLoading()
                util.showSuccess('生成成功')

                // 刷新列表
                this.loadPostcardList()
            } else {
                throw new Error('生成失败')
            }
        } catch (err) {
            console.error('生成明信片失败', err)
            util.hideLoading()

            if (err.statusCode === 401) {
                util.showError('请先登录')
            } else if (err.statusCode >= 500) {
                util.showError('服务器繁忙，请稍后重试')
            } else {
                util.showError('生成失败，请重试')
            }
        }
    },

    // 从行程生成明信片
    async generateFromPlan() {
        const planList = storage.getPlanList()
        if (planList.length === 0) {
            util.showError('暂无行程记录')
            return
        }

        try {
            util.showLoading('生成中...')

            // 调用实际API生成明信片
            const result = await api.generatePostcard({ type: 'plan', data: planList[0] })

            if (result && result.success) {
                util.hideLoading()
                util.showSuccess('生成成功')

                // 刷新列表
                this.loadPostcardList()
            } else {
                throw new Error('生成失败')
            }
        } catch (err) {
            console.error('生成明信片失败', err)
            util.hideLoading()

            if (err.statusCode === 401) {
                util.showError('请先登录')
            } else if (err.statusCode >= 500) {
                util.showError('服务器繁忙，请稍后重试')
            } else {
                util.showError('生成失败，请重试')
            }
        }
    },

    // 跳转登录
    goLogin() {
        wx.navigateTo({
            url: '/pages/login/login?redirect=/pages/postcard/postcard'
        })
    },

    // 分享
    onShareAppMessage() {
        return util.shareToWeChat(
            '我的旅行明信片',
            '/images/share.jpg',
            '/pages/postcard/postcard'
        )
    }
})
