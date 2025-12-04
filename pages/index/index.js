// pages/index/index.js
const app = getApp()
const api = require('../../utils/api.js')
const storage = require('../../utils/storage.js')
const util = require('../../utils/util.js')
const mapUtil = require('../../utils/map.js')

Page({
    data: {
        currentCity: '定位中...',
        latitude: 0,
        longitude: 0,
        hotDestinations: [],
        nearbyAttractions: []
    },

    onLoad() {
        // 后台静默定位，不阻塞页面
        this.getCurrentLocationSilent()
        this.loadHotDestinations()
    },

    onShow() {
        // 页面显示时无需刷新景点，getCurrentLocationSilent已处理
    },

    onPullDownRefresh() {
        Promise.all([
            this.getCurrentLocationSilent(),
            this.loadHotDestinations()
        ]).finally(() => {
            wx.stopPullDownRefresh()
        })
    },

    // 静默获取当前位置（后台进行，不阻塞页面）
    async getCurrentLocationSilent() {
        try {
            // 先尝试从缓存读取位置信息
            const cachedLocation = storage.getLocation()
            const cachedAttractions = storage.getHomeAttractions()

            if (cachedLocation) {
                this.setData({
                    currentCity: cachedLocation.city,
                    latitude: cachedLocation.latitude,
                    longitude: cachedLocation.longitude
                })

                // 如果有缓存的景点数据，立即显示
                if (cachedAttractions && cachedAttractions.attractions) {
                    this.setData({
                        nearbyAttractions: cachedAttractions.attractions
                    })
                }
            }

            // 检查定位权限
            const authSetting = await new Promise((resolve) => {
                wx.getSetting({
                    success: resolve
                })
            })

            // 如果用户未授权定位权限，则静默请求授权
            if (!authSetting.authSetting['scope.userLocation']) {
                const authResult = await new Promise((resolve) => {
                    wx.authorize({
                        scope: 'scope.userLocation',
                        success: () => resolve(true),
                        fail: () => resolve(false)
                    })
                })

                if (!authResult) {
                    console.log('用户拒绝定位权限，使用缓存或默认位置')
                    // 如果没有缓存，设置默认城市
                    if (!cachedLocation) {
                        this.setData({
                            currentCity: '上海',
                            latitude: 31.2304,
                            longitude: 121.4737
                        })
                    }
                    return
                }
            }

            // 使用小程序getLocation API获取位置信息
            const location = await new Promise((resolve, reject) => {
                wx.getLocation({
                    type: 'gcj02',
                    success: resolve,
                    fail: reject
                })
            })

            console.log('静默获取位置成功', location)

            // ====== 距离和缓存判断逻辑 ======
            let shouldUpdateCity = true      // 是否需要更新城市
            let shouldUpdateAttractions = true  // 是否需要更新景点

            // ====== 距离判断逻辑 ======
            // 如果有缓存位置，计算距离
            if (cachedLocation && cachedLocation.latitude && cachedLocation.longitude) {
                const distance = mapUtil.calculateDistance(
                    cachedLocation.latitude,
                    cachedLocation.longitude,
                    location.latitude,
                    location.longitude
                )
                console.log('位置变化距离:', mapUtil.formatDistance(distance))

                // 距离小于3000米(3公里)，使用缓存数据，不调用API
                if (distance < 3000) {
                    console.log('位置变化小于3km，使用缓存城市')
                    shouldUpdateCity = false

                    // 更新本地坐标（微调）
                    this.setData({
                        latitude: location.latitude,
                        longitude: location.longitude
                    })

                    // 更新全局数据
                    app.globalData.location = {
                        latitude: location.latitude,
                        longitude: location.longitude,
                        city: cachedLocation.city
                    }

                    return // 直接返回，不调用API
                }

                console.log('位置变化超过3km，重新获取城市和景点数据')
            }

            // 判断景点缓存是否有效（cachedAttractions 已经通过 getHomeAttractions 进行了日期判断）
            if (cachedAttractions && cachedAttractions.attractions) {
                console.log('景点缓存有效（今天的数据），无需重新获取')
                shouldUpdateAttractions = false
            } else {
                console.log('景点缓存无效或已过期，需要重新获取')
            }

            // 如果城市和景点都不需要更新，直接返回
            if (!shouldUpdateCity && !shouldUpdateAttractions) {
                console.log('城市和景点数据均使用缓存，无需调用API')

                // 更新本地坐标（微调）
                this.setData({
                    latitude: location.latitude,
                    longitude: location.longitude
                })

                // 更新全局数据
                app.globalData.location = {
                    latitude: location.latitude,
                    longitude: location.longitude,
                    city: cachedLocation.city
                }

                return // 直接返回，不调用API
            }

            // ====== 需要更新数据时才执行以下逻辑 ======
            this.setData({
                latitude: location.latitude,
                longitude: location.longitude
            })

            // 只在需要更新城市时调用城市API
            if (shouldUpdateCity) {
                // 更新全局数据
                app.globalData.location = {
                    latitude: location.latitude,
                    longitude: location.longitude,
                    city: '定位中...'
                }

                // 调用后端API获取城市信息
                try {
                    const cityInfo = await api.getCityByLocation(location.latitude, location.longitude)
                    console.log('城市信息API返回:', cityInfo)

                    // 根据新的API数据结构适配
                    const cityData = cityInfo.data || cityInfo || {}
                    let cityName = '未知城市'

                    // 尝试多种可能的字段名
                    if (cityData.city) {
                        cityName = cityData.city
                    } else if (cityData.name) {
                        cityName = cityData.name
                    } else if (cityData.formattedAddress) {
                        cityName = cityData.formattedAddress
                    } else if (cityData.address) {
                        cityName = cityData.address
                    }

                    console.log('解析后的城市名称:', cityName)

                    this.setData({
                        currentCity: cityName
                    })

                    // 保存完整定位信息
                    storage.setLocation({
                        latitude: location.latitude,
                        longitude: location.longitude,
                        city: cityName,
                        province: cityData.province,
                        district: cityData.district,
                        township: cityData.township,
                        street: cityData.street,
                        streetNumber: cityData.streetNumber,
                        adcode: cityData.adcode,
                        cityCode: cityData.cityCode,
                        formattedAddress: cityData.formattedAddress,
                        location: cityData.location
                    })
                    app.globalData.location.city = cityName
                    app.globalData.location.detail = cityData

                    // 根据判断决定是否更新景点
                    if (shouldUpdateAttractions) {
                        await this.loadNearbyAttractions()
                    }
                } catch (apiError) {
                    console.warn('获取城市信息失败', apiError)
                    // 降级处理: 显示默认城市
                    this.setData({
                        currentCity: '上海'
                    })
                }
            } else {
                // 不需要更新城市，但需要更新景点
                if (shouldUpdateAttractions) {
                    console.log('位置未变化，但景点缓存已过期，重新获取景点')

                    // 更新全局数据
                    app.globalData.location = {
                        latitude: location.latitude,
                        longitude: location.longitude,
                        city: cachedLocation.city
                    }

                    await this.loadNearbyAttractions()
                }
            }
        } catch (err) {
            console.error('静默定位失败', err)
            // 尝试从缓存读取
            const cachedLocation = storage.getLocation()
            const cachedAttractions = storage.getHomeAttractions()

            if (cachedLocation) {
                this.setData({
                    currentCity: cachedLocation.city,
                    latitude: cachedLocation.latitude,
                    longitude: cachedLocation.longitude
                })

                // 如果有缓存的景点，也显示出来
                if (cachedAttractions && cachedAttractions.attractions) {
                    this.setData({
                        nearbyAttractions: cachedAttractions.attractions
                    })
                }
            } else {
                // 设置默认城市
                this.setData({
                    currentCity: '上海',
                    latitude: 31.2304,
                    longitude: 121.4737
                })
            }
        }
    },

    // 手动获取当前位置（用户主动触发时使用）
    async getCurrentLocation() {
        try {
            util.showLoading('定位中...')

            // 检查定位权限
            const authSetting = await new Promise((resolve) => {
                wx.getSetting({
                    success: resolve
                })
            })

            // 如果用户未授权定位权限，则请求授权
            if (!authSetting.authSetting['scope.userLocation']) {
                const authResult = await new Promise((resolve) => {
                    wx.authorize({
                        scope: 'scope.userLocation',
                        success: () => resolve(true),
                        fail: () => resolve(false)
                    })
                })

                if (!authResult) {
                    // 用户拒绝授权，显示提示
                    wx.showModal({
                        title: '定位权限申请',
                        content: '需要获取您的位置信息来显示周边景点和推荐路线',
                        confirmText: '去设置',
                        cancelText: '取消',
                        success: (res) => {
                            if (res.confirm) {
                                wx.openSetting()
                            }
                        }
                    })
                    throw new Error('用户拒绝定位权限')
                }
            }

            // 使用小程序getLocation API获取位置信息
            const location = await new Promise((resolve, reject) => {
                wx.getLocation({
                    type: 'gcj02',
                    success: resolve,
                    fail: reject
                })
            })

            console.log('手动获取位置成功', location)

            this.setData({
                latitude: location.latitude,
                longitude: location.longitude
            })

            // 更新全局数据
            app.globalData.location = {
                latitude: location.latitude,
                longitude: location.longitude,
                city: '定位中...'
            }

            // 调用后端API获取城市信息
            try {
                const cityInfo = await api.getCityByLocation(location.latitude, location.longitude)
                console.log('城市信息API返回:', cityInfo)

                // 根据新的API数据结构适配
                const cityData = cityInfo.data || cityInfo || {}
                let cityName = '未知城市'

                // 尝试多种可能的字段名
                if (cityData.city) {
                    cityName = cityData.city
                } else if (cityData.name) {
                    cityName = cityData.name
                } else if (cityData.formattedAddress) {
                    cityName = cityData.formattedAddress
                } else if (cityData.address) {
                    cityName = cityData.address
                }

                console.log('解析后的城市名称:', cityName)

                this.setData({
                    currentCity: cityName
                })

                // 保存完整定位信息
                storage.setLocation({
                    latitude: location.latitude,
                    longitude: location.longitude,
                    city: cityName,
                    province: cityData.province,
                    district: cityData.district,
                    township: cityData.township,
                    street: cityData.street,
                    streetNumber: cityData.streetNumber,
                    adcode: cityData.adcode,
                    cityCode: cityData.cityCode,
                    formattedAddress: cityData.formattedAddress,
                    location: cityData.location
                })
                app.globalData.location.city = cityName
                app.globalData.location.detail = cityData
            } catch (apiError) {
                console.warn('获取城市信息失败', apiError)
                // 降级处理: 显示默认城市
                this.setData({
                    currentCity: '上海'
                })
                wx.showToast({
                    title: '获取城市信息失败,使用默认城市',
                    icon: 'none'
                })
            }

            // 加载周边景点
            this.loadNearbyAttractions()
        } catch (err) {
            console.error('定位失败', err)
            this.setData({
                currentCity: '定位失败'
            })
            // 尝试从缓存读取
            const cachedLocation = storage.getLocation()
            if (cachedLocation) {
                this.setData({
                    currentCity: cachedLocation.city,
                    latitude: cachedLocation.latitude,
                    longitude: cachedLocation.longitude
                })
                this.loadNearbyAttractions()
            }
        } finally {
            util.hideLoading()
        }
    },

    // 加载热门目的地
    async loadHotDestinations() {
        try {
            // 先尝试从缓存读取
            const cachedDestinations = storage.getHotDestinations()
            if (cachedDestinations) {
                console.log('使用缓存的热门目的地数据')
                this.setData({
                    hotDestinations: cachedDestinations
                })
                return // 缓存有效，直接返回
            }

            console.log('开始加载热门目的地...')
            const data = await api.getHotDestinations()
            console.log('热门目的地数据:', data)

            // 确保数据格式正确，适配API返回的数据结构
            let destinations = []
            if (Array.isArray(data)) {
                destinations = data
            } else if (data && data.list) {
                destinations = data.list
            } else if (data && data.data) {
                destinations = data.data
            }

            // 确保每个项目都有必要的字段
            destinations = destinations.map(item => ({
                id: item.id || item._id || Math.random().toString(36).substr(2, 9),
                name: item.name || item.title || '未知地点',
                image: item.image || item.cover || item.picture || '/images/default-destination.jpg',
                tags: item.tags || item.category || '',
                distance: item.distance || ''
            }))

            this.setData({
                hotDestinations: destinations
            })

            // 缓存热门目的地数据
            storage.setHotDestinations(destinations)

            console.log('热门目的地渲染完成:', destinations.length)
        } catch (err) {
            console.error('加载热门目的地失败', err)
            // 显示空数据，不进行模拟
            this.setData({
                hotDestinations: []
            })
            util.showError('加载热门目的地失败')
        }
    },

    // 加载周边景点
    async loadNearbyAttractions() {
        try {
            // ====== 优先读取缓存 ======
            const cachedAttractions = storage.getHomeAttractions()

            // 如果有有效缓存（日期和位置都符合要求）
            if (cachedAttractions && cachedAttractions.attractions) {
                const cachedLat = cachedAttractions.latitude
                const cachedLon = cachedAttractions.longitude
                const currentLat = this.data.latitude
                const currentLon = this.data.longitude

                // 检查位置是否变化
                if (cachedLat && cachedLon && currentLat && currentLon) {
                    const distance = mapUtil.calculateDistance(
                        cachedLat,
                        cachedLon,
                        currentLat,
                        currentLon
                    )
                    console.log('景点缓存位置距离:', mapUtil.formatDistance(distance))

                    // 距离小于3km，使用缓存
                    if (distance < 3000) {
                        console.log('使用缓存的景点数据（距离<3km且今天的数据）')
                        this.setData({
                            nearbyAttractions: cachedAttractions.attractions
                        })
                        return // 直接返回，不调用API
                    } else {
                        console.log('位置变化超过3km，重新获取景点数据')
                    }
                }
            }

            // ====== 缓存无效，调用API获取数据 ======
            console.log('开始加载周边景点...', this.data.latitude, this.data.longitude)
            const data = await api.getNearbyAttractions(this.data.latitude, this.data.longitude)
            console.log('周边景点数据:', data)

            // 确保数据格式正确，适配API返回的数据结构
            let attractions = []
            if (Array.isArray(data)) {
                attractions = data
            } else if (data && data.list) {
                attractions = data.list
            } else if (data && data.data) {
                attractions = data.data
            }

            // 确保每个项目都有必要的字段
            attractions = attractions.map(item => ({
                id: item.id || item._id || Math.random().toString(36).substr(2, 9),
                name: item.name || item.title || '未知景点',
                image: item.image || item.cover || item.picture || '/images/default-attraction.jpg',
                tags: item.tags || item.category || '',
                distance: item.distance || ''
            }))

            this.setData({
                nearbyAttractions: attractions
            })

            // 缓存景点数据和位置信息
            storage.setHomeAttractions({
                latitude: this.data.latitude,
                longitude: this.data.longitude,
                attractions: attractions
            })

            console.log('周边景点渲染完成:', attractions.length)
        } catch (err) {
            console.error('加载周边景点失败', err)
            // 显示空数据，不进行模拟
            this.setData({
                nearbyAttractions: []
            })
            util.showError('加载周边景点失败')
        }
    },

    // 点击目的地
    onDestinationTap(e) {
        const item = e.currentTarget.dataset.item
        console.log('点击目的地', item)
        // TODO: 跳转到目的地详情页
    },

    // 点击快捷功能
    onActionTap(e) {
        const action = e.currentTarget.dataset.action
        switch (action) {
            case 'plan':
                wx.switchTab({
                    url: '/pages/plan/plan'
                })
                break
            case 'share':
                util.showError('功能开发中')
                break
            case 'food':
                util.showError('功能开发中')
                break
            case 'favorite':
                util.showError('功能开发中')
                break
        }
    },

    // 点击景点
    onAttractionTap(e) {
        const item = e.currentTarget.dataset.item
        console.log('点击景点', item)
        // TODO: 跳转到景点详情页
    },

    // 查看更多景点
    onMoreAttractions() {
        util.showError('功能开发中')
    },

    // 分享
    onShareAppMessage() {
        return util.shareToWeChat(
            '足迹明信片 - 记录你的旅行',
            '/images/share.jpg',
            '/pages/index/index'
        )
    }
})
