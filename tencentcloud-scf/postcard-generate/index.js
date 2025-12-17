/**
 * 腾讯云云函数 - 明信片生成服务
 * 
 * 完整复制 Worker 的明信片生成逻辑：
 * 1. 查询行程详情
 * 2. 构建提示词
 * 3. 调用 kuai.host Google AI API
 * 4. 提取 base64 图片
 * 5. 上传到腾讯云COS
 * 6. 回调EdgeOne更新状态
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
    console.log('=== 明信片生成云函数启动 ===');

    try {
        // 解析请求参数
        let body;
        if (typeof event.body === 'string') {
            body = JSON.parse(event.body);
        } else {
            body = event.body || {};
        }

        const {
            planId,
            openid,
            planData,
            kuaiApiKey,
            kuaiApiBase,
            kuaiModel,
            cosConfig
        } = body;

        // 参数验证
        if (!planId || !openid || !planData) {
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body: JSON.stringify({
                    success: false,
                    error: '缺少必要参数',
                    message: 'planId, openid 和 planData 都是必需的'
                })
            };
        }

        if (!kuaiApiKey || !cosConfig) {
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body: JSON.stringify({
                    success: false,
                    error: '缺少配置',
                    message: 'kuaiApiKey 和 cosConfig 都是必需的'
                })
            };
        }

        console.log('参数验证通过');
        console.log('行程ID:', planId);
        console.log('城市:', planData.city);

        // 步骤1: 构建提示词
        const prompt = buildPostcardPrompt(planData);
        console.log('构建提示词完成，长度:', prompt.length);

        // 步骤2: 调用 kuai.host API (Google AI格式)
        const apiBase = kuaiApiBase || 'https://api.kuai.host';
        const modelName = kuaiModel || 'gemini-3-pro-image-preview';
        const aiResponse = await callKuaiHostAPI(apiBase, modelName, prompt, kuaiApiKey);
        console.log('AI API调用成功');

        // 步骤3: 提取图片数据
        const imageData = extractImageData(aiResponse);
        if (!imageData) {
            throw new Error('未能从AI响应中提取到图片数据');
        }
        console.log('提取图片数据成功，长度:', imageData.length);

        // 步骤4: 上传到COS
        const timestamp = Date.now();
        const postcardId = generateId('postcard_');
        const imagePath = `postcards/${openid}/${timestamp}.png`;

        const imageBuffer = Buffer.from(imageData, 'base64');
        const imageUrl = await uploadToCOS(cosConfig, imagePath, imageBuffer, 'image/png');
        console.log('原图上传成功:', imageUrl);

        // 步骤5: 构建明信片数据
        const postcard = {
            id: postcardId,
            planId: planId,
            title: `${planData.city}之旅`,
            image: imageUrl,
            thumbnail: null,
            city: planData.city,
            date: planData.date,
            endDate: planData.endDate,
            days: planData.days,
            description: `${planData.city} ${planData.days}天${planData.days - 1}晚精彩旅程`,
            status: 'completed',
            createdAt: timestamp
        };

        console.log('明信片生成完成:', postcardId);

        // 步骤6: 回调EdgeOne
        if (body.callback && body.callback.url) {
            console.log('开始回调EdgeOne:', body.callback.url);
            try {
                await callbackEdgeOne(body.callback.url, {
                    postcardId: body.callback.postcardId,
                    openid: body.callback.openid,
                    success: true,
                    data: postcard
                });
                console.log('EdgeOne回调成功');
            } catch (callbackError) {
                console.error('EdgeOne回调失败:', callbackError);
            }
        }

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({
                success: true,
                data: postcard
            })
        };

    } catch (error) {
        console.error('云函数执行失败:', error);
        console.error('错误堆栈:', error.stack);

        // 失败时回调EdgeOne
        try {
            if (event.body) {
                const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
                if (body && body.callback && body.callback.url) {
                    await callbackEdgeOne(body.callback.url, {
                        postcardId: body.callback.postcardId,
                        openid: body.callback.openid,
                        success: false,
                        error: error.message
                    });
                    console.log('失败回调成功');
                }
            }
        } catch (callbackError) {
            console.error('失败回调异常:', callbackError);
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
 * 构建明信片提示词 - 与 Worker 版本完全一致
 * 生成手绘蜡笔风、童趣手账式明信片
 */
function buildPostcardPrompt(plan) {
    const city = plan.city || '未知城市';
    const days = plan.days || 1;

    // 提取所有景点信息
    const attractions = [];
    if (plan.schedule && Array.isArray(plan.schedule)) {
        plan.schedule.forEach((day) => {
            if (day.planning && Array.isArray(day.planning)) {
                day.planning.forEach(item => {
                    if (item.type === 'attraction' && item.name) {
                        attractions.push({
                            name: item.name,
                            description: item.description || ''
                        });
                    }
                });
            }
        });
    }

    // 构建旅行站点列表
    let stationsText = '';
    attractions.slice(0, 8).forEach((attraction, index) => {
        stationsText += `- "第 ${index + 1} 站：{${attraction.name} + ${attraction.description}}"\n\n`;
    });
    stationsText += `- "最终站：{当地招牌美食/纪念品 + 温馨结束语}"`;

    // 根据城市生成地标
    const landmarks = getCityLandmarks(city);
    const foods = getCityFoods(city);

    return `请绘制一张色彩鲜艳、竖版（3:4）手绘风格的《${city}旅行明信片》，画风仿佛由一位充满好奇心的孩子用蜡笔创作，整体使用柔和温暖的浅色背景（如浅黄色），搭配红色、蓝色、绿色等明亮色调，营造温馨、童趣、满满旅行气息的氛围。

一、主画面：手账式旅行路线

在插画中央绘制一条"蜿蜒曲折的旅行路线"，路线用箭头 + 虚线连接多个地点，由 ${days} 日行程自动生成推荐景点：

${stationsText}

> 旅程站点数量随天数自动生成：
> 若用户未输入天数，则按默认 1 日 / 精华线路生成。

二、周围趣味元素（全部根据城市自动替换）

在路线周围加入大量充满童趣的小元素，例如：

- 可爱的旅行角色： "拿着当地特色小吃的小朋友"、 "背着旅行包的冒险小孩"等。

- 当地标志性建筑的童趣 Q 版手绘： 如 "${landmarks[0]}"、"${landmarks[1]}"、"${landmarks[2]}"。

- 有趣的提示牌： "小心迷路！"、"注意人流！"、"前方好吃的！"（可根据城市语境调整）。

- 贴纸式小标语： "${city}旅行记忆已解锁！" "${city}美食大冒险！" "下一站去哪儿？"

- 当地美食的可爱小图标： 如 "${foods[0]}"、"${foods[1]}"、"${foods[2]}"。

- 感叹句（保持童真风）： "原来${city}这么好玩！" "我要再来一次！"

三、整体风格要求

- 手绘蜡笔风 / 儿童旅行日志风格
- 色彩鲜艳、构图饱满但温暖
- 强调旅行的欢乐与探索感
- 所有文字采用可爱的手写字体
- 让整个画面像一本童趣满满的旅行手账页面
- 手账中的文字内容必须使用中文

请直接生成图片，不需要文字描述。`;
}

/**
 * 获取城市地标（可扩展为数据库查询）
 */
function getCityLandmarks(city) {
    const landmarkMap = {
        '石家庄市': ['正定古城', '赵州桥', '西柏坡'],
        '石家庄': ['正定古城', '赵州桥', '西柏坡'],
        '北京': ['天安门', '故宫', '长城'],
        '北京市': ['天安门', '故宫', '长城'],
        '上海': ['东方明珠', '外滩', '城隍庙'],
        '上海市': ['东方明珠', '外滩', '城隍庙'],
        '广州': ['广州塔', '陈家祠', '白云山'],
        '广州市': ['广州塔', '陈家祠', '白云山'],
        '深圳': ['世界之窗', '华强北', '大梅沙'],
        '深圳市': ['世界之窗', '华强北', '大梅沙'],
        '杭州': ['西湖', '雷峰塔', '灵隐寺'],
        '杭州市': ['西湖', '雷峰塔', '灵隐寺'],
        '成都': ['宽窄巷子', '武侯祠', '大熊猫基地'],
        '成都市': ['宽窄巷子', '武侯祠', '大熊猫基地'],
        '西安': ['兵马俑', '大雁塔', '钟楼'],
        '西安市': ['兵马俑', '大雁塔', '钟楼'],
        '重庆': ['洪崖洞', '解放碑', '朝天门'],
        '重庆市': ['洪崖洞', '解放碑', '朝天门'],
        '南京': ['中山陵', '夫子庙', '玄武湖'],
        '南京市': ['中山陵', '夫子庙', '玄武湖'],
        '桂林': ['漓江', '象鼻山', '阳朔'],
        '桂林市': ['漓江', '象鼻山', '阳朔'],
        '天津': ['天津之眼', '五大道', '古文化街'],
        '天津市': ['天津之眼', '五大道', '古文化街'],
        '呼和浩特': ['大召寺', '内蒙古博物院', '昭君墓'],
        '呼和浩特市': ['大召寺', '内蒙古博物院', '昭君墓']
    };
    return landmarkMap[city] || ['城市地标1', '城市地标2', '城市地标3'];
}

/**
 * 获取城市美食（可扩展为数据库查询）
 */
function getCityFoods(city) {
    const foodMap = {
        '石家庄市': ['驴肉火烧', '正定八大碗', '缸炉烧饼'],
        '石家庄': ['驴肉火烧', '正定八大碗', '缸炉烧饼'],
        '北京': ['北京烤鸭', '炸酱面', '豆汁焦圈'],
        '北京市': ['北京烤鸭', '炸酱面', '豆汁焦圈'],
        '上海': ['小笼包', '生煎', '蟹壳黄'],
        '上海市': ['小笼包', '生煎', '蟹壳黄'],
        '广州': ['早茶点心', '肠粉', '白切鸡'],
        '广州市': ['早茶点心', '肠粉', '白切鸡'],
        '深圳': ['潮汕牛肉丸', '肠粉', '烧鹅'],
        '深圳市': ['潮汕牛肉丸', '肠粉', '烧鹅'],
        '杭州': ['东坡肉', '西湖醋鱼', '龙井虾仁'],
        '杭州市': ['东坡肉', '西湖醋鱼', '龙井虾仁'],
        '成都': ['火锅', '担担面', '龙抄手'],
        '成都市': ['火锅', '担担面', '龙抄手'],
        '西安': ['肉夹馍', '羊肉泡馍', '凉皮'],
        '西安市': ['肉夹馍', '羊肉泡馍', '凉皮'],
        '重庆': ['重庆火锅', '重庆小面', '酸辣粉'],
        '重庆市': ['重庆火锅', '重庆小面', '酸辣粉'],
        '南京': ['盐水鸭', '鸭血粉丝汤', '汤包'],
        '南京市': ['盐水鸭', '鸭血粉丝汤', '汤包'],
        '桂林': ['桂林米粉', '啤酒鱼', '油茶'],
        '桂林市': ['桂林米粉', '啤酒鱼', '油茶'],
        '天津': ['狗不理包子', '煎饼果子', '麻花'],
        '天津市': ['狗不理包子', '煎饼果子', '麻花'],
        '呼和浩特': ['烤全羊', '手把肉', '奶茶'],
        '呼和浩特市': ['烤全羊', '手把肉', '奶茶']
    };
    return foodMap[city] || ['当地特色小吃', '传统美食', '网红小吃'];
}

/**
 * 调用 kuai.host API (Google AI generateContent格式)
 */
async function callKuaiHostAPI(apiBase, modelName, prompt, apiKey) {
    const apiUrl = `${apiBase}/v1beta/models/${modelName}:generateContent`;

    const postData = JSON.stringify({
        contents: [{
            role: 'user',
            parts: [{
                text: prompt
            }]
        }],
        generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: {
                aspectRatio: '3:4',
                imageSize: '2K'
            }
        }
    });

    return new Promise((resolve, reject) => {
        const url = new URL(apiUrl);

        const options = {
            hostname: url.hostname,
            port: 443,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'Content-Length': Buffer.byteLength(postData)
            },
            timeout: 120000
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', chunk => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error('解析响应失败: ' + e.message));
                    }
                } else {
                    reject(new Error(`API返回错误: ${res.statusCode}`));
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('API请求超时'));
        });

        req.write(postData);
        req.end();
    });
}

/**
 * 从AI响应中提取图片数据
 */
function extractImageData(aiResponse) {
    if (!aiResponse.candidates || aiResponse.candidates.length === 0) {
        return null;
    }

    const candidate = aiResponse.candidates[0];
    const parts = candidate.content?.parts;

    if (!parts || !Array.isArray(parts)) {
        return null;
    }

    for (const part of parts) {
        if (part.inlineData && part.inlineData.data) {
            return part.inlineData.data;
        }
        if (part.inline_data && part.inline_data.data) {
            return part.inline_data.data;
        }
    }

    return null;
}

/**
 * 上传到腾讯云COS
 */
async function uploadToCOS(cosConfig, filePath, fileBuffer, contentType) {
    const { bucket, region, secretId, secretKey, domain } = cosConfig;
    const crypto = require('crypto');

    const host = `${bucket}.cos.${region}.myqcloud.com`;
    const pathname = `/${filePath}`;
    const method = 'PUT';

    const now = new Date();
    const expires = new Date(now.getTime() + 3600 * 1000);

    const signTime = Math.floor(now.getTime() / 1000) + ';' + Math.floor(expires.getTime() / 1000);
    const signKey = crypto.createHmac('sha1', secretKey).update(signTime).digest('hex');

    const httpString = `${method.toLowerCase()}\n${pathname}\n\nhost=${host}\n`;
    const sha1HttpString = crypto.createHash('sha1').update(httpString).digest('hex');

    const stringToSign = `sha1\n${signTime}\n${sha1HttpString}\n`;
    const signature = crypto.createHmac('sha1', signKey).update(stringToSign).digest('hex');

    const authorization = `q-sign-algorithm=sha1&q-ak=${secretId}&q-sign-time=${signTime}&q-key-time=${signTime}&q-header-list=host&q-url-param-list=&q-signature=${signature}`;

    return new Promise((resolve, reject) => {
        const options = {
            hostname: host,
            port: 443,
            path: pathname,
            method: 'PUT',
            headers: {
                'Content-Type': contentType,
                'Content-Length': fileBuffer.length,
                'Host': host,
                'Authorization': authorization
            }
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', chunk => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    const publicUrl = `https://${domain || host}/${filePath}`;
                    resolve(publicUrl);
                } else {
                    reject(new Error(`COS upload failed: ${res.statusCode}`));
                }
            });
        });

        req.on('error', reject);

        req.write(fileBuffer);
        req.end();
    });
}

/**
 * 生成唯一ID
 */
function generateId(prefix = '') {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 11);
    return `${prefix}${timestamp}_${random}`;
}

/**
 * 回调EdgeOne更新明信片状态
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

        const req = client.request(options, (res) => {
            let responseData = '';

            res.on('data', chunk => {
                responseData += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve(responseData);
                } else {
                    reject(new Error(`回调失败: ${res.statusCode}`));
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
