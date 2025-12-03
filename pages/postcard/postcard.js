// pages/postcard/postcard.js
const storage = require('../../utils/storage.js')
const util = require('../../utils/util.js')
const api = require('../../utils/api.js')

Page({
    data: {
        postcardList: []
    },

    onLoad() {
        this.loadPostcardList()
    },

    onShow() {
        // 每次显示时刷新列表
        this.loadPostcardList()
    },

    onPullDownRefresh() {
        this.loadPostcardList().then(() => {
            wx.stopPullDownRefresh()
        })
    },

    // 加载明信片列表
    async loadPostcardList() {
        // 先检查用户是否已登录
        if (!storage.isLoggedIn()) {
            console.log('用户未登录，直接显示空内容')
            this.setData({
                postcardList: []
            })
            return
        }
        
        try {
            console.log('开始加载明信片列表...')
            // 调用实际API获取明信片列表
            const result = await api.getPostcardList()
            console.log('明信片列表数据:', result)
            
            // 处理多种数据格式
            const postcardList = result.list || result.data || []
            
            if (postcardList.length > 0) {
                this.setData({
                    postcardList: postcardList
                })
                // 保存到本地存储
                storage.setPostcardList(postcardList)
                console.log('明信片列表渲染完成:', postcardList.length)
            } else {
                // 如果API返回空数据，显示空状态
                this.setData({
                    postcardList: []
                })
                console.log('暂无明信片数据')
            }
        } catch (err) {
            console.error('加载明信片列表失败', err)
            // 如果是401错误，直接显示空内容
            if (err.statusCode === 401) {
                this.setData({
                    postcardList: []
                })
                return
            }
            
            // 降级处理：使用本地存储数据
            const cachedPostcards = storage.getPostcardList()
            if (cachedPostcards && cachedPostcards.length > 0) {
                this.setData({
                    postcardList: cachedPostcards
                })
                console.log('使用缓存的明信片列表:', cachedPostcards.length)
            } else {
                // 没有缓存数据时显示空内容
                this.setData({
                    postcardList: []
                })
                console.log('暂无明信片数据')
            }
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

    // 分享
    onShareAppMessage() {
        return util.shareToWeChat(
            '我的旅行明信片',
            '/images/share.jpg',
            '/pages/postcard/postcard'
        )
    }
})
