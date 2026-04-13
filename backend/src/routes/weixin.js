import express from 'express';
import fetch from 'node-fetch';

const router = express.Router();

router.use('/comb-login-server/api/v1/login', express.text({ type: 'text/plain' }));
router.use('/ucenter-app-server/api/v1/login/verify/code', express.json());

const weixinHeaders = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 7.0; Mi-4c Build/NRD90M; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/53.0.2785.49 Mobile MQQBrowser/6.2 TBS/043632 Safari/537.36 MicroMessenger/6.6.1.1220(0x26060135) NetType/WIFI Language/zh_CN',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Referer': 'https://open.weixin.qq.com/'
};

const weixinLongHeaders = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 7.0; Mi-4c Build/NRD90M; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/53.0.2785.49 Mobile MQQBrowser/6.2 TBS/043632 Safari/537.36 MicroMessenger/6.6.1.1220(0x26060135) NetType/WIFI Language/zh_CN',
  'Accept': '*/*',
  'Referer': 'https://open.weixin.qq.com/'
};

const phoneVerifyHeaders = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 12; 22081212C Build/SKQ1.220303.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/136.0.7103.60 Mobile Safari/537.36',
  'Accept': '*/*',
  'Host': 'ucenter-app-server.hortorgames.com',
  'Connection': 'Keep-Alive',
  'Content-Type': 'application/json; charset=utf-8',
  'Accept-Encoding': 'gzip',
};

const phoneLoginHeaders = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 12; 22081212C Build/SKQ1.220303.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/136.0.7103.60 Mobile Safari/537.36',
  'Accept': '*/*',
  'Host': 'comb-platform.hortorgames.com',
  'Connection': 'keep-alive',
  'Content-Type': 'text/plain; charset=utf-8',
};

const wechatLoginHeaders = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 12; 23117RK66C Build/V417IR; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/95.0.4638.74 Mobile Safari/537.36',
  'Accept': '*/*',
  'Host': 'comb-platform.hortorgames.com',
  'Connection': 'keep-alive',
  'Content-Type': 'text/plain; charset=utf-8',
  'Origin': 'https://open.weixin.qq.com',
  'Referer': 'https://open.weixin.qq.com/'
};

async function relayJsonResponse(response, res, fallbackErrorMessage) {
  const text = await response.text();
  let parsed;

  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = {
      success: false,
      error: fallbackErrorMessage,
      raw: text,
    };
  }

  res.status(response.status).json(parsed);
}

router.get('/connect/app/qrconnect', async (req, res) => {
  try {
    const { appid, bundleid, scope, state } = req.query;
    
    const url = `https://open.weixin.qq.com/connect/app/qrconnect?appid=${appid}&bundleid=${bundleid}&scope=${scope}&state=${state}`;
    
    const response = await fetch(url, {
      headers: weixinHeaders
    });
    
    const html = await response.text();
    
    res.send(html);
  } catch (error) {
    console.error('微信二维码获取失败:', error);
    res.status(500).json({
      success: false,
      error: '获取微信二维码失败'
    });
  }
});

router.get('/connect/l/qrconnect', async (req, res) => {
  try {
    const { uuid, f } = req.query;
    
    const url = `https://open.weixin.qq.com/connect/l/qrconnect?uuid=${uuid}&f=${f}&_=${Date.now()}`;
    
    const response = await fetch(url, {
      headers: weixinHeaders
    });
    
    const text = await response.text();
    
    res.send(text);
  } catch (error) {
    console.error('微信扫码状态检查失败:', error);
    res.status(500).json({
      success: false,
      error: '检查扫码状态失败'
    });
  }
});

router.post('/ucenter-app-server/api/v1/login/verify/code', async (req, res) => {
  try {
    const url = 'https://ucenter-app-server.hortorgames.com/ucenter-app-server/api/v1/login/verify/code';

    const response = await fetch(url, {
      method: 'POST',
      headers: phoneVerifyHeaders,
      body: JSON.stringify(req.body || {})
    });

    await relayJsonResponse(response, res, '验证码接口返回了非 JSON 数据');
  } catch (error) {
    console.error('手机号验证码发送失败:', error);
    res.status(500).json({
      success: false,
      error: '发送验证码失败'
    });
  }
});

router.post('/comb-login-server/api/v1/login', async (req, res) => {
  try {
    const queryString = req._parsedUrl ? req._parsedUrl.query : '';
    const url = `https://comb-platform.hortorgames.com/comb-login-server/api/v1/login?${queryString}`;
    const loginMode = String(req.headers['x-hortor-login-mode'] || '').trim().toLowerCase();
    const upstreamHeaders = loginMode === 'phone' ? phoneLoginHeaders : wechatLoginHeaders;
    const body = typeof req.body === 'string' ? req.body : String(req.body);

    console.log('Hortor登录请求体长度:', body.length);

    const response = await fetch(url, {
      method: 'POST',
      headers: upstreamHeaders,
      body: body
    });

    await relayJsonResponse(response, res, '登录接口返回了非 JSON 数据');
  } catch (error) {
    console.error('Hortor登录失败:', error);
    res.status(500).json({
      success: false,
      error: '登录失败'
    });
  }
});

export default router;
