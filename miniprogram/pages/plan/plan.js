// pages/plan/plan.js - A2UI协议聊天式行程规划
const app = getApp()
const api = require('../../utils/api.js')
const storage = require('../../utils/storage.js')
const util = require('../../utils/util.js')
const mapUtil = require('../../utils/map.js')

// 消息ID生成器
let msgIdCounter = 0
const genMsgId = () => `msg_${++msgIdCounter}_${Date.now()}`

// ================ A2UI 组件目录 ================
// 定义客户端支持渲染的安全组件类型
const COMPONENT_CATALOG = {
    'Button': true,      // 按钮组件
    'Text': true,        // 文本组件
    'ButtonGroup': true, // 按钮组
    'Card': true,        // 卡片组件
    'DatePicker': true   // 日期选择器
}

Page({
    data: {
        // ===== 消息列表 =====
        messages: [],
        scrollToView: '',
        isLoading: false,
        isGenerating: false,  // 行程生成中状态
        showDatePicker: false,  // 自定义日期选择器

        // ===== 对话状态 =====
        stage: 'city',  // city -> date -> summary -> confirm

        // ===== 对话上下文（A2UI DataModel）=====
        conversationContext: {
            city: '',
            dateChoice: '',
            days: 0,
            startDate: '',
            endDate: ''
        },

        // ===== 对话历史（发送给AI）=====
        chatHistory: [],

        // ===== 预设数据 =====
        hotCities: [
            { id: 'beijing', label: '北京', icon: '🏛️' },
            { id: 'shanghai', label: '上海', icon: '🏙️' },
            { id: 'hangzhou', label: '杭州', icon: '🌸' },
            { id: 'chengdu', label: '成都', icon: '🐼' },
            { id: 'xiamen', label: '厦门', icon: '🏝️' },
            { id: 'xian', label: '西安', icon: '🏯' },
            { id: 'suzhou', label: '苏州', icon: '🏞️' },
            { id: 'nanjing', label: '南京', icon: '🍂' }
        ],

        // 今日日期
        todayDate: '',

        // 偏好设置
        transportTypes: [
            { id: 'public', name: '公共交通', icon: '🚇', selected: true },
            { id: 'drive', name: '自驾', icon: '🚗', selected: false },
            { id: 'walk', name: '步行为主', icon: '🚶', selected: false }
        ],
        accommodationTypes: [
            { id: 'budget', name: '经济型', icon: '💰', selected: true },
            { id: 'comfort', name: '舒适型', icon: '🏨', selected: false },
            { id: 'luxury', name: '豪华型', icon: '✨', selected: false }
        ],
        poiTypes: [
            { id: 'any', name: '不限', icon: '🎯', selected: true },
            { id: 'nature', name: '自然风光', icon: '🌄', selected: false },
            { id: 'history', name: '历史古迹', icon: '🏛️', selected: false },
            { id: 'museum', name: '博物馆', icon: '🖼️', selected: false },
            { id: 'food', name: '美食探店', icon: '🍜', selected: false }
        ],

        // 偏好弹窗
        showPrefsPopup: false
    },

    onLoad() {
        // 设置今天日期
        const today = new Date()
        const todayStr = util.formatDate(today)
        this.setData({ todayDate: todayStr })

        // 从全局获取当前城市
        if (app.globalData.location && app.globalData.location.city) {
            this.setData({
                'conversationContext.city': app.globalData.location.city
            })
        }

        // 初始化欢迎消息（本地，不调用AI）
        this.initWelcomeLocal()
    },

    // ================ 初始化欢迎消息（本地）================
    initWelcomeLocal() {
        // A2UI格式：组件描述 + 数据模型
        const welcomeMsg = {
            id: genMsgId(),
            role: 'ai',
            content: '👋 你好！我是行程规划助手。\n想去哪个城市玩呢？点击选择或输入城市名~',
            // A2UI组件数组
            components: this.data.hotCities.map((city, idx) => ({
                id: `city_${city.id}`,
                component: {
                    Button: {
                        label: city.label,
                        icon: city.icon,
                        action: { name: 'selectCity', payload: { cityId: city.id, cityName: city.label } }
                    }
                }
            }))
        }

        this.setData({ messages: [welcomeMsg] })
    },

    // ================ 滚动到底部 ================
    scrollToBottom() {
        setTimeout(() => {
            this.setData({ scrollToView: 'chat-bottom' })
        }, 100)
    },

    // ================ 消息管理 ================
    addMessage(msg) {
        const messages = [...this.data.messages, msg]
        this.setData({ messages }, () => this.scrollToBottom())
    },

    addUserMessage(content) {
        const msg = {
            id: genMsgId(),
            role: 'user',
            content
        }
        this.addMessage(msg)

        // 添加到对话历史
        const chatHistory = [...this.data.chatHistory, { role: 'user', content }]
        this.setData({ chatHistory })

        return msg.id
    },

    addLoadingMessage() {
        const msg = {
            id: genMsgId(),
            role: 'loading'
        }
        this.addMessage(msg)
        return msg.id
    },

    removeMessage(msgId) {
        const messages = this.data.messages.filter(m => m.id !== msgId)
        this.setData({ messages })
    },

    // ================ A2UI 渲染器 ================
    // 解析AI返回的A2UI组件描述，转换为小程序可渲染格式
    parseA2UIResponse(response) {
        // 从AI响应中提取组件
        const components = response.buttons || response.components || []

        // 验证组件是否在目录中
        const validComponents = components.filter(comp => {
            const type = comp.component ? Object.keys(comp.component)[0] : 'Button'
            return COMPONENT_CATALOG[type] || COMPONENT_CATALOG['Button']
        })

        return {
            content: response.reply || '',
            components: validComponents.length > 0 ? validComponents : components,
            dataModel: response.context || response.dataModel || {}
        }
    },

    // ================ AI 对话调用 ================
    async callAI(userMessage) {
        if (this.data.isLoading) return

        this.setData({ isLoading: true })
        const loadingId = this.addLoadingMessage()

        try {
            // 构建请求参数
            const requestData = {
                message: userMessage,
                context: this.data.conversationContext,
                stage: this.data.stage,
                history: this.data.chatHistory.slice(-6) // 最近6条对话
            }

            const response = await api.planChat(
                requestData.message,
                requestData.context,
                requestData.stage
            )

            console.log('=== AI响应 ===', response)

            // 移除加载状态
            this.removeMessage(loadingId)

            // 解析A2UI响应
            const parsed = this.parseA2UIResponse(response)

            // 更新对话上下文
            if (response.context) {
                const newContext = { ...this.data.conversationContext, ...response.context }
                this.setData({ conversationContext: newContext })
            }

            // 判断是否进入summary阶段
            const nextStage = response.nextStage || this.data.stage
            const shouldShowSummary = nextStage === 'summary' ||
                (this.data.conversationContext.city && response.context?.days)

            // 构建AI消息
            const aiMsg = {
                id: genMsgId(),
                role: 'ai',
                content: parsed.content,
                components: parsed.components,
                summary: shouldShowSummary ? this.buildSummary() : null
            }
            this.addMessage(aiMsg)

            // 更新阶段
            if (nextStage !== this.data.stage) {
                this.setData({ stage: nextStage })
            }

            // 添加到对话历史
            const chatHistory = [...this.data.chatHistory, { role: 'assistant', content: parsed.content }]
            this.setData({ chatHistory })

        } catch (err) {
            console.error('AI调用失败:', err)
            this.removeMessage(loadingId)
            this.showLocalFallback()
        } finally {
            this.setData({ isLoading: false })
        }
    },

    // ================ 本地降级响应 ================
    showLocalFallback() {
        const stage = this.data.stage
        const ctx = this.data.conversationContext

        let content = '请选择一个选项继续~'
        let components = []

        if (stage === 'date' && ctx.city) {
            content = `去${ctx.city}！选择出行时间和天数：`
            components = [
                { id: 'date_weekend_3', label: '本周末3天', icon: '📅' },
                { id: 'date_nextweek_5', label: '下周5天', icon: '🗓️' },
                { id: 'date_3days', label: '3天行程', icon: '🎯' },
                { id: 'date_5days', label: '5天行程', icon: '✨' }
            ]
        } else if (stage === 'summary') {
            content = `${ctx.city}${ctx.days || 3}天之旅，确认开始规划？`
            components = [
                { id: 'confirm', label: '开始规划', icon: '✅', action: { name: 'confirmPlan' } },
                { id: 'restart', label: '重新选择', icon: '🔄', action: { name: 'restart' } }
            ]
        }

        const aiMsg = {
            id: genMsgId(),
            role: 'ai',
            content,
            components,
            summary: stage === 'summary' ? this.buildSummary() : null
        }
        this.addMessage(aiMsg)
    },

    // ================ 构建行程概要 ================
    buildSummary() {
        const ctx = this.data.conversationContext
        const transport = this.data.transportTypes.find(t => t.selected)
        const accommodation = this.data.accommodationTypes.find(a => a.selected)
        const poiTypesSelected = this.data.poiTypes.filter(p => p.selected).map(p => p.name).join('、')

        return {
            city: ctx.city || '未选择',
            days: ctx.days || 3,
            dateChoice: ctx.dateChoice || '待定',
            startDate: ctx.startDate,
            endDate: ctx.endDate,
            transport: transport ? transport.name : '公共交通',
            accommodation: accommodation ? accommodation.name : '经济型',
            poiTypes: poiTypesSelected || '不限'
        }
    },

    // ================ 按钮点击处理 ================
    onButtonTap(e) {
        const dataset = e.currentTarget.dataset
        const { msgId, btnIndex, label, icon, action } = dataset

        console.log('按钮点击:', dataset)

        // 解析action
        let actionName = ''
        let payload = {}

        if (action) {
            try {
                const actionObj = typeof action === 'string' ? JSON.parse(action) : action
                actionName = actionObj.name || ''
                payload = actionObj.payload || {}
            } catch (e) {
                actionName = action
            }
        }

        // 允许通过的action（即使isLoading也可执行）
        const allowedWhenLoading = ['goToList', 'restart', 'adjustPrefs']
        if (this.data.isLoading && !allowedWhenLoading.includes(actionName)) {
            console.log('正在加载中，忽略按钮点击')
            return
        }

        // 根据action分发处理
        switch (actionName) {
            case 'selectCity':
                this.handleCitySelect(payload.cityId, payload.cityName || label)
                break
            case 'useLocation':
                this.useCurrentLocation()
                break
            case 'confirmPlan':
                this.onGenerate()
                break
            case 'restart':
                this.onRestart()
                break
            case 'adjustPrefs':
                this.onShowPrefsPopup()
                break
            case 'goToList':
                this.goToList()
                break
            case 'customDate':
            case 'selectCustomDate':
                // 触发日期选择器
                this.showCustomDatePicker()
                break
            default:
                // 检查是否是自定义日期/时间相关的按钮
                const customDateKeywords = ['其他时间', '其他日期', '自定义', '自定义日期', '自定义天数', 'custom']
                const isCustomDate = customDateKeywords.some(kw =>
                    label?.toLowerCase().includes(kw.toLowerCase())
                )

                if (isCustomDate) {
                    this.showCustomDatePicker()
                } else if (label) {
                    // 通用处理：将按钮文本作为用户输入发送给AI
                    const displayText = `${icon || ''} ${label}`.trim()
                    this.addUserMessage(displayText)
                    this.callAI(label)
                }
        }
    },

    // ================ 城市选择 ================
    handleCitySelect(cityId, cityName) {
        const city = this.data.hotCities.find(c => c.id === cityId)
        const name = cityName || (city ? city.label : cityId)
        const iconEmoji = city ? city.icon : '📍'

        // 更新上下文
        this.setData({
            'conversationContext.city': name,
            stage: 'date'
        })

        // 添加用户消息
        this.addUserMessage(`${iconEmoji} ${name}`)

        // 调用AI获取日期选择
        this.callAI(`我想去${name}旅行`)
    },

    // ================ 使用当前位置 ================
    async useCurrentLocation() {
        util.showLoading('获取位置中...')

        try {
            const location = await mapUtil.getCurrentLocation()
            const cityInfo = await api.getCityByLocation(location.latitude, location.longitude)

            util.hideLoading()

            if (cityInfo && cityInfo.city) {
                const cityName = cityInfo.city.replace('市', '')
                this.setData({
                    'conversationContext.city': cityName,
                    stage: 'date'
                })
                this.addUserMessage(`📍 ${cityName}（当前位置）`)
                this.callAI(`我想去${cityName}旅行`)
            } else {
                util.showError('无法获取城市信息')
            }
        } catch (err) {
            util.hideLoading()
            util.showError('获取位置失败')
            console.error('定位失败:', err)
        }
    },

    // 城市选择器变化
    onCityPickerChange(e) {
        if (this.data.isLoading) return  // 防止重复发送

        const region = e.detail.value  // [省, 市, 区] 或 [省, 市]
        // 取市级名称，去掉"市"后缀
        let cityName = region[1] || region[0]
        cityName = cityName.replace('市', '').replace('地区', '').replace('自治州', '')

        this.setData({
            'conversationContext.city': cityName,
            stage: 'date'
        })
        this.addUserMessage(`🏙️ ${cityName}`)
        this.callAI(`我想去${cityName}旅行`)
    },

    // ================ 输入框处理 ================
    onInputChange(e) {
        this.setData({ inputValue: e.detail.value })
    },

    onInputConfirm(e) {
        if (this.data.isLoading) return  // 防止重复发送

        const value = this.data.inputValue?.trim() || e?.detail?.value?.trim()
        if (!value) return

        this.setData({ inputValue: '' })

        if (this.data.stage === 'city') {
            // 城市输入
            this.setData({
                'conversationContext.city': value,
                stage: 'date'
            })
            this.addUserMessage(`📍 ${value}`)
            this.callAI(`我想去${value}旅行`)
        } else if (this.data.stage === 'date') {
            // 日期/天数阶段 - 解析用户输入的天数
            const daysMatch = value.match(/(\d+)\s*(天|日)/)
            if (daysMatch) {
                const days = parseInt(daysMatch[1])
                this.setData({
                    'conversationContext.days': days,
                    'conversationContext.dateChoice': value
                })
            }
            this.addUserMessage(value)
            this.callAI(value)
        } else {
            // 其他阶段，直接发送给AI
            this.addUserMessage(value)
            this.callAI(value)
        }
    },

    // 日期选择器变化
    onDatePickerChange(e) {
        if (this.data.isLoading) return  // 防止重复发送

        const selectedDate = e.detail.value
        this.setData({
            'conversationContext.startDate': selectedDate
        })
        this.addUserMessage(`📅 ${selectedDate}`)
        this.callAI(`我选择${selectedDate}出发`)
    },

    // 显示自定义日期选择器
    showCustomDatePicker() {
        this.setData({ showDatePicker: true })
    },

    // 自定义日期确认
    onCustomDateConfirm(e) {
        if (this.data.isLoading) return  // 防止重复发送

        const selectedDate = e.detail.value
        this.setData({
            showDatePicker: false,
            'conversationContext.startDate': selectedDate
        })
        this.addUserMessage(`📅 自定义日期：${selectedDate}`)
        this.callAI(`我选择${selectedDate}出发，请问多少天？`)
    },

    // 取消日期选择
    onCustomDateCancel() {
        this.setData({ showDatePicker: false })
    },

    // ================ 重新开始 ================
    onRestart() {
        this.setData({
            messages: [],
            stage: 'city',
            conversationContext: {
                city: '',
                dateChoice: '',
                days: 0,
                startDate: '',
                endDate: ''
            },
            chatHistory: []
        })
        this.initWelcomeLocal()
    },

    // ================ 偏好设置弹窗 ================
    onShowPrefsPopup() {
        this.setData({ showPrefsPopup: true })
    },

    onClosePrefsPopup() {
        this.setData({ showPrefsPopup: false })
        // 更新概要卡片中的数据
        this.updateSummaryCard()
    },

    // 更新概要卡片
    updateSummaryCard() {
        const messages = this.data.messages.map(msg => {
            if (msg.summary) {
                return {
                    ...msg,
                    summary: this.buildSummary()
                }
            }
            return msg
        })
        this.setData({ messages })
    },

    // 阻止事件冒泡
    preventBubble() {
        // 空函数，用于阻止catchtap冒泡到遮罩层
    },

    onTransportSelect(e) {
        const id = e.currentTarget.dataset.id
        const transportTypes = this.data.transportTypes.map(t => ({
            ...t,
            selected: t.id === id
        }))
        this.setData({ transportTypes })
    },

    onAccommodationSelect(e) {
        const id = e.currentTarget.dataset.id
        const accommodationTypes = this.data.accommodationTypes.map(a => ({
            ...a,
            selected: a.id === id
        }))
        this.setData({ accommodationTypes })
    },

    onPoiTypeSelect(e) {
        const id = e.currentTarget.dataset.id
        let poiTypes

        if (id === 'any') {
            // 选择"不限"，取消所有其他选择
            poiTypes = this.data.poiTypes.map(p => ({
                ...p,
                selected: p.id === 'any'
            }))
        } else {
            // 选择其他类型，取消"不限"
            poiTypes = this.data.poiTypes.map(p => {
                if (p.id === 'any') {
                    return { ...p, selected: false }
                }
                return {
                    ...p,
                    selected: p.id === id ? !p.selected : p.selected
                }
            })
            // 如果没有选中任何类型，自动选中"不限"
            const hasSelected = poiTypes.some(p => p.selected && p.id !== 'any')
            if (!hasSelected) {
                poiTypes = poiTypes.map(p => ({
                    ...p,
                    selected: p.id === 'any'
                }))
            }
        }
        this.setData({ poiTypes })
    },

    // ================ 生成行程 ================
    async onGenerate() {
        const ctx = this.data.conversationContext

        if (!ctx.city) {
            util.showError('请先选择目的地城市')
            return
        }

        // 构建行程参数 - 参数名需与后端一致
        const transport = this.data.transportTypes.find(t => t.selected)
        const accommodation = this.data.accommodationTypes.find(a => a.selected)
        const poiTypesSelected = this.data.poiTypes.filter(p => p.selected && p.id !== 'any').map(p => p.id)

        // 后端需要: city, date, days, transportation, accommodation, poiTypes
        const params = {
            city: ctx.city,
            date: ctx.startDate || this.data.todayDate,
            days: ctx.days || 3,
            transportation: transport?.id || 'public',
            accommodation: accommodation?.id || 'budget',
            poiTypes: poiTypesSelected.length > 0 ? poiTypesSelected : ['any'],
            notes: ''
        }

        console.log('生成行程参数:', params)

        // 显示加载
        this.addUserMessage('✅ 开始规划行程')
        const loadingId = this.addLoadingMessage()

        try {
            const result = await api.generatePlan(params)
            this.removeMessage(loadingId)

            if (result && (result.id || result.planId)) {
                // 设置生成中状态，禁用所有交互
                this.setData({ isGenerating: true })

                // 添加生成中提示消息
                const generatingMsg = {
                    id: genMsgId(),
                    role: 'ai',
                    content: `⏳ ${ctx.city}${params.days}天行程正在生成中...\n\n⚠️ 预计需要2-3分钟，请耐心等待。\n\n生成完成后可在行程列表中查看。`,
                    components: [
                        { id: 'goToList', label: '查看行程列表', icon: '📋', action: { name: 'goToList' } },
                        { id: 'restart', label: '重新选择', icon: '🔄', action: { name: 'restart' } }
                    ]
                }
                this.addMessage(generatingMsg)
            } else {
                throw new Error('生成失败')
            }
        } catch (err) {
            this.removeMessage(loadingId)
            console.error('生成行程失败:', err)

            const errorMsg = {
                id: genMsgId(),
                role: 'ai',
                content: '😔 抱歉，行程生成失败，请重试。',
                components: [
                    { id: 'retry', label: '重试', icon: '🔄', action: { name: 'confirmPlan' } },
                    { id: 'restart', label: '重新选择', icon: '↩️', action: { name: 'restart' } }
                ]
            }
            this.addMessage(errorMsg)
        }
    },

    // 跳转到行程列表
    goToList() {
        console.log('goToList被调用')
        wx.reLaunch({
            url: '/pages/plan-list/plan-list',
            fail: (err) => {
                console.error('reLaunch失败:', err)
            }
        })
    }
})
