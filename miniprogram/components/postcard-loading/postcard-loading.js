// components/postcard-loading/postcard-loading.js
Component({
    /**
     * 组件属性
     */
    properties: {
        visible: {
            type: Boolean,
            value: false,
            observer(newVal) {
                if (newVal) {
                    this.startAnimation()
                } else {
                    this.stopAnimation()
                }
            }
        }
    },

    /**
     * 组件数据
     */
    data: {
        currentTip: '正在绘制你的旅行记忆...',
        progress: 0,
        isFlipping: true,
        showStamp: true,
        tips: [
            '正在绘制你的旅行记忆...',
            '为明信片选择最美的风景...',
            '添加可爱的小装饰...',
            '调色师正在认真配色...',
            '收集旅途中的美好瞬间...',
            '用画笔记录欢乐时光...',
            '贴上专属的旅行邮戳...',
            '即将完成，请稍候...'
        ],
        tipIndex: 0
    },

    /**
     * 组件生命周期
     */
    lifetimes: {
        detached() {
            this.stopAnimation()
        }
    },

    /**
     * 组件方法
     */
    methods: {
        // 开始动画
        startAnimation() {
            this.setData({
                progress: 0,
                tipIndex: 0,
                currentTip: this.data.tips[0],
                isFlipping: true,
                showStamp: true
            })

            // 提示语轮换定时器
            this.tipTimer = setInterval(() => {
                const nextIndex = (this.data.tipIndex + 1) % this.data.tips.length
                this.setData({
                    tipIndex: nextIndex,
                    currentTip: this.data.tips[nextIndex]
                })
            }, 3000)

            // 模拟进度条动画
            this.progressTimer = setInterval(() => {
                let newProgress = this.data.progress + Math.random() * 3 + 1
                // 进度最大到95%，最后由实际完成来触发100%
                if (newProgress > 95) {
                    newProgress = 95
                }
                this.setData({ progress: Math.floor(newProgress) })
            }, 800)
        },

        // 停止动画
        stopAnimation() {
            if (this.tipTimer) {
                clearInterval(this.tipTimer)
                this.tipTimer = null
            }
            if (this.progressTimer) {
                clearInterval(this.progressTimer)
                this.progressTimer = null
            }
        },

        // 完成动画（外部调用）
        complete() {
            this.setData({
                progress: 100,
                currentTip: '生成完成！'
            })
            this.stopAnimation()
        }
    }
})
