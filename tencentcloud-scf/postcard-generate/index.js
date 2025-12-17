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
 * 构建明信片提示词 - 复制Worker逻辑
 */
function buildPostcardPrompt(plan) {
    const city = plan.city || '';
    const days = plan.days || 1;
    const schedule = plan.schedule || [];

    const attractions = [];
    for (const day of schedule) {
        const planning = day.planning || [];
        for (const item of planning) {
            if (item.type === 'attraction') {
                attractions.push(item.name);
            }
        }
    }

    const attractionsList = attractions.slice(0, 5).join('、');

    let prompt = `请为我生成一张${city}旅行明信片。\n\n`;
    prompt += `行程信息：\n`;
    prompt += `- 目的地：${city}\n`;
    prompt += `- 天数：${days}天\n`;

    if (attractionsList) {
        prompt += `- 主要景点：${attractionsList}\n`;
    }

    prompt += `\n要求：\n`;
    prompt += `1. 图片风格：扁平化插画风格（Flat illustration style）\n`;
    prompt += `2. 色彩：明亮、温暖、充满活力\n`;
    prompt += `3. 内容：展现${city}的标志性建筑或风景\n`;
    prompt += `4. 构图：简洁大气，适合作为明信片\n`;
    prompt += `5. 尺寸：竖版（3:4比例），2K分辨率\n`;
    prompt += `\n请直接生成图片，不要包含任何文字或标题。`;

    return prompt;
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
