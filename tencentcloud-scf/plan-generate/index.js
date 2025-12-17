/**
 * 腾讯云云函数 - 行程规划生成服务
 * 
 * 完整复制 N8N 工作流 3.0 的所有逻辑：
 * 1. 调用高德API获取景点、天气、酒店信息
 * 2. 使用DeepSeek AI生成行程规划
 * 3. 调用高德路径规划API
 * 4. 回调EdgeOne
 * 
 * 运行环境：Node.js 18.x
 */

'use strict';

const https = require('https');
const http = require('http');

/**
 * 云函数入口
 */
exports.main_handler = async function (event, context) {
    console.log('=== 行程规划云函数启动 ===');

    try {
        // 解析请求参数
        let body;
        if (typeof event.body === 'string') {
            body = JSON.parse(event.body);
        } else {
            body = event.body || {};
        }

        const {
            city,
            start_date,
            end_date,
            travel_days,
            transportation,
            accommodation,
            preferences,
            free_text_input,
            user_location,
            callback,
            // EdgeOne 传递的 keys
            amapKey,
            deepseekKey
        } = body;

        // 参数验证
        if (!city || !start_date || !travel_days || !callback) {
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body: JSON.stringify({
                    success: false,
                    error: '缺少必要参数',
                    message: 'city, start_date, travel_days 和 callback 都是必需的'
                })
            };
        }

        if (!amapKey || !deepseekKey) {
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body: JSON.stringify({
                    success: false,
                    error: '缺少API密钥',
                    message: 'amapKey 和 deepseekKey 都是必需的'
                })
            };
        }

        console.log('参数验证通过');
        console.log('目的地:', city);
        console.log('出发日期:', start_date);
        console.log('旅行天数:', travel_days);

        // 步骤1: 并行调用高德API获取数据
        console.log('步骤1: 调用高德API...');
        const [attractionsData, weatherData, hotelsData] = await Promise.all([
            searchAttractions(city, preferences, amapKey),
            getWeather(city, amapKey),
            searchHotels(city, accommodation, amapKey)
        ]);

        console.log('高德API调用完成');
        console.log('景点数量:', attractionsData.length);
        console.log('天气数据:', weatherData.length);
        console.log('酒店数量:', hotelsData.length);

        // 步骤2: 准备AI提示词
        const aiPrompt = buildAIPrompt({
            city,
            start_date,
            end_date,
            travel_days,
            transportation,
            accommodation,
            preferences,
            free_text_input,
            user_location,
            attractions: attractionsData,
            weather: weatherData,
            hotels: hotelsData
        });

        console.log('步骤2: 调用DeepSeek AI...');
        const aiResponse = await callDeepSeekAI(aiPrompt, deepseekKey);
        console.log('DeepSeek AI调用成功');

        // 步骤3: 解析AI响应
        const tripPlan = parseAIResponse(aiResponse, {
            city,
            start_date,
            end_date,
            travel_days
        });

        if (!tripPlan) {
            throw new Error('AI响应解析失败');
        }

        console.log('行程解析成功，天数:', tripPlan.days?.length);

        // 步骤4: 调用高德路径规划API
        console.log('步骤3: 调用路径规划...');
        const routeInfo = await planRoutes(tripPlan.days, user_location, amapKey);
        console.log('路径规划完成');

        // 步骤5: 整合最终数据
        const finalData = {
            ...tripPlan,
            route_info: routeInfo.routes,
            route_summary: routeInfo.summary
        };

        // 步骤6: 回调EdgeOne
        console.log('步骤6: 回调EdgeOne...');
        await callbackEdgeOne(callback.url, {
            planId: callback.planId,
            openid: callback.openid,
            success: true,
            message: '旅行计划生成成功',
            data: finalData
        });
        console.log('EdgeOne回调成功');

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({
                success: true,
                message: '行程规划生成成功',
                planId: callback.planId
            })
        };

    } catch (error) {
        console.error('云函数执行失败:', error);
        console.error('错误堆栈:', error.stack);

        // 失败回调
        try {
            if (event.body) {
                const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
                if (body && body.callback) {
                    await callbackEdgeOne(body.callback.url, {
                        planId: body.callback.planId,
                        openid: body.callback.openid,
                        success: false,
                        message: error.message
                    });
                }
            }
        } catch (callbackError) {
            console.error('回调EdgeOne失败:', callbackError);
        }

        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({
                success: false,
                error: error.message
            })
        };
    }
};

/**
 * 搜索景点 - 复制N8N逻辑
 */
async function searchAttractions(city, preferences, amapKey) {
    const keywords = preferences && preferences.length > 0 ? preferences[0] : '景点';

    const params = new URLSearchParams({
        key: amapKey,
        keywords: keywords,
        city: city,
        citylimit: 'true',
        output: 'json',
        extensions: 'all'
    });

    const data = await httpRequest('https://restapi.amap.com/v3/place/text?' + params.toString());

    const pois = data.pois || [];
    return pois.slice(0, 10).map(poi => ({
        name: poi.name,
        address: poi.address,
        location: poi.location,
        type: poi.type,
        tel: poi.tel || '',
        rating: poi.biz_ext?.rating || '',
        photos: poi.photos || []
    }));
}

/**
 * 查询天气 - 复制N8N逻辑
 */
async function getWeather(city, amapKey) {
    const params = new URLSearchParams({
        key: amapKey,
        city: city,
        extensions: 'all',
        output: 'json'
    });

    const data = await httpRequest('https://restapi.amap.com/v3/weather/weatherInfo?' + params.toString());

    const forecasts = data.forecasts?.[0]?.casts || [];
    return forecasts.map(cast => ({
        date: cast.date,
        dayweather: cast.dayweather,
        nightweather: cast.nightweather,
        daytemp: cast.daytemp,
        nighttemp: cast.nighttemp,
        daywind: cast.daywind,
        nightwind: cast.nightwind,
        daypower: cast.daypower,
        nightpower: cast.nightpower
    }));
}

/**
 * 搜索酒店 - 复制N8N逻辑
 */
async function searchHotels(city, accommodation, amapKey) {
    const keywords = accommodation ? accommodation + '酒店' : '酒店';

    const params = new URLSearchParams({
        key: amapKey,
        keywords: keywords,
        city: city,
        citylimit: 'true',
        output: 'json'
    });

    const data = await httpRequest('https://restapi.amap.com/v3/place/text?' + params.toString());

    const pois = data.pois || [];
    return pois.slice(0, 5).map(poi => ({
        name: poi.name,
        address: poi.address,
        location: poi.location,
        type: poi.type,
        tel: poi.tel || '',
        rating: poi.biz_ext?.rating || ''
    }));
}

/**
 * 构建AI提示词 - 复制N8N逻辑
 */
function buildAIPrompt(params) {
    const { city, start_date, end_date, travel_days, transportation, accommodation, preferences, free_text_input, attractions, weather, hotels } = params;

    let prompt = `请根据以下信息生成${city}的${travel_days}天旅行计划:\n\n`;
    prompt += `**基本信息:**\n`;
    prompt += `- 城市: ${city}\n`;
    prompt += `- 日期: ${start_date} 至 ${end_date}\n`;
    prompt += `- 天数: ${travel_days}天\n`;
    prompt += `- 交通方式: ${transportation}\n`;
    prompt += `- 住宿: ${accommodation}\n`;
    prompt += `-偏好: ${preferences?.join(', ') || '无特别偏好'}\n\n`;

    prompt += `**景点信息(共${attractions.length}个):**\n`;
    prompt += JSON.stringify(attractions, null, 2) + '\n\n';

    prompt += `**天气信息:**\n`;
    prompt += JSON.stringify(weather, null, 2) + '\n\n';

    prompt += `**酒店信息(共${hotels.length}个):**\n`;
    prompt += JSON.stringify(hotels, null, 2) + '\n\n';

    if (free_text_input) {
        prompt += `**额外要求:** ${free_text_input}\n\n`;
    }

    return prompt;
}

/**
 * 调用DeepSeek AI - 复制N8N逻辑
 */
async function callDeepSeekAI(prompt, apiKey) {
    // N8N使用的system message
    const systemMessage = `你是行程规划专家。你的任务是根据景点信息、天气信息和酒店信息，生成详细的旅行计划。

请严格按照以下JSON格式返回旅行计划（不要包含\`\`\`json标记，直接输出JSON）：

{
    "city": "城市名称",
    "start_date": "YYYY-MM-DD",
    "end_date": "YYYY-MM-DD",
    "days": [
        {
            "date": "YYYY-MM-DD",
            "day_index": 0,
            "description": "第1天行程概述",
            "transportation": "交通方式",
            "accommodation": "住宿类型",
            "planning": [
                {
                    "type": "breakfast",
                    "name": "早餐推荐",
                    "address": "餐馆地址",
                    "location": {
                        "longitude": 116.397128,
                        "latitude": 39.916527
                    },
                    "visit_duration": 30,
                    "description": "餐馆描述",
                    "category": "餐馆类别",
                    "ticket_price": 30
                },
                {
                    "type": "attraction",
                    "name": "景点名称1",
                    "address": "详细地址",
                    "location": {
                        "longitude": 116.397128,
                        "latitude": 39.916527
                    },
                    "visit_duration": 120,
                    "description": "景点描述",
                    "category": "景点类别",
                    "ticket_price": 60
                },
                {
                    "type": "lunch",
                    "name": "午餐推荐",
                    "address": "餐馆地址",
                    "location": {
                        "longitude": 116.397128,
                        "latitude": 39.916527
                    },
                    "visit_duration": 60,
                    "description": "餐馆描述",
                    "category": "餐馆类别",
                    "ticket_price": 50
                },
                {
                    "type": "attraction",
                    "name": "景点名称2",
                    "address": "详细地址",
                    "location": {
                        "longitude": 116.397128,
                        "latitude": 39.916527
                    },
                    "visit_duration": 120,
                    "description": "景点描述",
                    "category": "景点类别",
                    "ticket_price": 60
                },
                {
                    "type": "dinner",
                    "name": "晚餐推荐",
                    "address": "餐馆地址",
                    "location": {
                        "longitude": 116.397128,
                        "latitude": 39.916527
                    },
                    "visit_duration": 60,
                    "description": "餐馆描述",
                    "category": "餐馆类别",
                    "ticket_price": 80
                },
                {
                    "type": "hotel",
                    "name": "酒店推荐",
                    "address": "酒店地址",
                    "location": {
                        "longitude": 116.397128,
                        "latitude": 39.916527
                    },
                    "visit_duration": 0,
                    "description": "酒店描述",
                    "category": "酒店类别",
                    "ticket_price": 300
                }
            ]
        }
    ],
    "weather_info": [
        {
            "date": "YYYY-MM-DD",
            "day_weather": "晴",
            "night_weather": "多云",
            "day_temp": 25,
            "night_temp": 15,
            "wind_direction": "南风",
            "wind_power": "1-3级"
        }
    ],
    "overall_suggestions": "总体建议",
    "budget": {
        "total_attractions": 180,
        "total_hotels": 1200,
        "total_meals": 480,
        "total_transportation": 200,
        "total": 2060
    }
}

重要提示：
1. 每天安排2-4个景点
2. 第一天不含早餐；最后一天不含晚餐，其余的每天必须包含早中晚三餐
3. 按照时间推断对应景点的酒店
4. 考虑景点之间的距离和交通方式
5. 提供实用的旅行建议和预算估算
6. 使用真实的景点和酒店信息
7. 只输出JSON，不要有任何其他文字说明
8. 确保景点、饭店和酒店的地点是线性的，避免一个在城西下一个在城东，下一个又回到了城西`;

    const postData = JSON.stringify({
        model: "deepseek-chat",
        messages: [
            { role: "system", content: systemMessage },
            { role: "user", content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 4000
    });

    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.deepseek.com',
            port: 443,
            path: '/v1/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'Content-Length': Buffer.byteLength(postData)
            },
            timeout: 120000
        };

        console.log('发送DeepSeek API请求');

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', chunk => {
                data += chunk;
            });

            res.on('end', () => {
                console.log('DeepSeek API响应状态码:', res.statusCode);

                if (res.statusCode === 200) {
                    try {
                        const response = JSON.parse(data);
                        resolve(response);
                    } catch (e) {
                        reject(new Error('解析DeepSeek响应失败: ' + e.message));
                    }
                } else {
                    reject(new Error(`DeepSeek API返回错误: ${res.statusCode} - ${data.substring(0, 200)}`));
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('DeepSeek API请求超时'));
        });

        req.write(postData);
        req.end();
    });
}

/**
 * 解析AI响应 - 复制N8N逻辑
 */
function parseAIResponse(aiResponse, requestParams) {
    try {
        const content = aiResponse.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error('AI响应内容为空');
        }

        console.log('AI响应内容长度:', content.length);

        // 清理JSON字符串
        let cleanContent = content.trim();

        // 移除markdown代码块标记
        if (cleanContent.startsWith('```json')) {
            cleanContent = cleanContent.slice(7);
        } else if (cleanContent.startsWith('```')) {
            cleanContent = cleanContent.slice(3);
        }
        if (cleanContent.endsWith('```')) {
            cleanContent = cleanContent.slice(0, -3);
        }
        cleanContent = cleanContent.trim();

        // 尝试找到JSON对象
        const jsonStart = cleanContent.indexOf('{');
        const jsonEnd = cleanContent.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) {
            cleanContent = cleanContent.slice(jsonStart, jsonEnd + 1);
        }

        const tripPlan = JSON.parse(cleanContent);
        console.log('成功解析行程数据，天数:', tripPlan.days?.length);

        return tripPlan;
    } catch (error) {
        console.error('解析AI响应失败:', error);
        // 返回默认行程
        return generateDefaultSchedule(requestParams);
    }
}

/**
 * 生成默认行程
 */
function generateDefaultSchedule(params) {
    const { city, start_date, travel_days } = params;
    const days = [];

    for (let i = 0; i < travel_days; i++) {
        const date = new Date(start_date);
        date.setDate(date.getDate() + i);

        days.push({
            date: date.toISOString().split('T')[0],
            day_index: i,
            description: `第${i + 1}天行程`,
            transportation: '公共交通',
            accommodation: '经济型酒店',
            planning: [{
                type: 'attraction',
                name: `${city}经典景点${i + 1}`,
                address: `${city}市区`,
                location: { longitude: 0, latitude: 0 },
                visit_duration: 180,
                description: '待规划详细行程',
                category: '景点',
                ticket_price: 0
            }]
        });
    }

    return {
        city,
        start_date,
        end_date: days[days.length - 1].date,
        days,
        weather_info: [],
        overall_suggestions: '请重新生成详细行程',
        budget: { total: 0 }
    };
}

/**
 * 路径规划 - 复制N8N逻辑
 */
async function planRoutes(days, userLocation, amapKey) {
    const routes = [];
    let previousDayLastLocation = null;

    const userStartPoint = userLocation ? {
        name: userLocation.name || '起点',
        type: 'user_start',
        coord: `${userLocation.longitude},${userLocation.latitude}`
    } : null;

    for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
        const day = days[dayIndex];
        const planning = day.planning || [];

        const locations = planning
            .filter(p => p.location && p.location.longitude && p.location.latitude)
            .map(p => ({
                name: p.name,
                type: p.type,
                coord: `${p.location.longitude},${p.location.latitude}`
            }));

        // 第一天添加用户起点
        if (dayIndex === 0 && userStartPoint) {
            locations.unshift(userStartPoint);
        }
        // 非第一天从前一天最后地点开始
        else if (previousDayLastLocation && dayIndex > 0) {
            locations.unshift(previousDayLastLocation);
        }

        // 最后一天添加用户终点
        if (dayIndex === days.length - 1 && userStartPoint) {
            locations.push(userStartPoint);
        }

        if (locations.length >= 2) {
            try {
                const route = await planDrivingRoute(locations, amapKey);
                routes.push({
                    day_index: dayIndex,
                    date: day.date,
                    location_names: locations.map(l => l.name),
                    ...route
                });
            } catch (error) {
                console.error(`第${dayIndex + 1}天路径规划失败:`, error.message);
                routes.push({
                    day_index: dayIndex,
                    date: day.date,
                    error: error.message
                });
            }
        }

        // 保存当天最后地点
        const actualLocations = locations.filter(l => l.type !== 'user_start');
        if (actualLocations.length > 0) {
            previousDayLastLocation = actualLocations[actualLocations.length - 1];
        }
    }

    const summary = {
        total_days: routes.length,
        total_distance: routes.reduce((sum, r) => sum + (r.total_distance || 0), 0),
        total_duration: routes.reduce((sum, r) => sum + (r.total_duration || 0), 0),
        total_toll_cost: routes.reduce((sum, r) => sum + (r.toll_cost || 0), 0),
        total_traffic_lights: routes.reduce((sum, r) => sum + (r.traffic_lights || 0), 0)
    };

    return { routes, summary };
}

/**
 * 驾车路径规划
 */
async function planDrivingRoute(locations, amapKey) {
    const origin = locations[0].coord;
    const destination = locations[locations.length - 1].coord;
    const waypoints = locations.slice(1, -1).map(l => l.coord).join(';');

    const params = new URLSearchParams({
        key: amapKey,
        origin: origin,
        destination: destination,
        extensions: 'all',
        strategy: '10',
        show_fields: 'cost',
        output: 'json'
    });

    if (waypoints) {
        params.append('waypoints', waypoints);
    }

    const data = await httpRequest('https://restapi.amap.com/v3/direction/driving?' + params.toString());

    if (data.status !== '1' || !data.route || !data.route.paths || data.route.paths.length === 0) {
        throw new Error('路径规划失败');
    }

    const mainPath = data.route.paths[0];
    const cost = mainPath.cost || {};

    const steps = (mainPath.steps || []).map((step, index) => {
        const stepCost = step.cost || {};
        return {
            segment_index: index,
            instruction: step.instruction || '',
            road: step.road || '',
            distance: parseInt(step.distance) || 0,
            duration: Math.round((parseInt(stepCost.duration) || parseInt(step.duration) || 0) / 60),
            tolls: parseFloat(stepCost.tolls) || 0,
            toll_distance: parseInt(stepCost.toll_distance) || 0,
            action: step.action || ''
        };
    });

    return {
        location_count: locations.length,
        total_distance: parseInt(mainPath.distance) || 0,
        total_duration: Math.round((parseInt(cost.duration) || parseInt(mainPath.duration) || 0) / 60),
        toll_cost: parseFloat(cost.tolls) || parseFloat(mainPath.tolls) || 0,
        toll_distance: parseInt(cost.toll_distance) || parseInt(mainPath.toll_distance) || 0,
        traffic_lights: parseInt(cost.traffic_lights) || parseInt(mainPath.traffic_lights) || 0,
        segments: steps,
        strategy: mainPath.strategy || ''
    };
}

/**
 * HTTP请求辅助函数
 */
async function httpRequest(url) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const client = parsedUrl.protocol === 'https:' ? https : http;

        const req = client.get(url, (res) => {
            let data = '';

            res.on('data', chunk => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error('JSON解析失败'));
                    }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}`));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error('请求超时'));
        });
    });
}

/**
 * 回调EdgeOne
 */
async function callbackEdgeOne(callbackUrl, data) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(data);
        const url = new URL(callbackUrl);

        const isHttps = url.protocol === 'https:';
        const client = isHttps ? https : http;
        const port = url.port || (isHttps ? 443 : 80);

        const options = {
            hostname: url.hostname,
            port: port,
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            },
            timeout: 30000
        };

        console.log('发送EdgeOne回调请求');

        const req = client.request(options, (res) => {
            let responseData = '';

            res.on('data', chunk => {
                responseData += chunk;
            });

            res.on('end', () => {
                console.log('EdgeOne回调响应状态码:', res.statusCode);

                // 检查HTTP状态码,只有2xx才算成功
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    console.log('EdgeOne回调成功');
                    resolve(responseData);
                } else {
                    const errorMsg = `EdgeOne回调失败: HTTP ${res.statusCode}`;
                    console.error(errorMsg);
                    console.error('EdgeOne响应内容:', responseData.substring(0, 500));
                    reject(new Error(errorMsg));
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('回调超时'));
        });

        req.write(postData);
        req.end();
    });
}
