export default {
  // 定义配置
  config: {
    // 监控用户配置
    monitor_users: [
      {
        nickname: '目标用户',
        uid: '7795649284'
      }
    ],
    // 企业微信配置
    wecom: {
      corpid: 'wwa012ff6ca1feea41',
      agentid: '1000002',
      corpsecret: 'U-XtJCdJgVKOht8AFy2CXXMLGXeSGuAP1OJk_JbVGUs',
      touser: '@all'
    }
  },

  // 定义 KV 命名空间
  async init(env) {
    this.KV = env.WEIBO_KV;
    this.env = env;
    console.log('初始化完成');
  },

  // 处理定时任务
  async scheduled(event, env, ctx) {
    await this.init(env);
    await this.checkWeibo();
  },

  // 处理 HTTP 请求
  async fetch(request, env, ctx) {
    await this.init(env);
    
    // 获取URL参数
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    if (action === 'test') {
      // 测试企业微信推送
      await this.sendWeixin('测试消息：' + new Date().toISOString());
      return new Response('测试消息已发送');
    } else if (action === 'check') {
      // 测试微博检查
      await this.checkWeibo();
      return new Response('微博检查完成');
    }

    // 默认检查
    await this.checkWeibo();
    return new Response('OK');
  },

  // 获取微博数据
  async getWeiboData(uid) {
    try {
      console.log(`开始获取用户 ${uid} 的微博数据`);
      const response = await fetch(
        `https://m.weibo.cn/api/container/getIndex?type=uid&value=${uid}&containerid=107603${uid}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'Referer': 'https://m.weibo.cn/'
          }
        }
      );

      const data = await response.json();
      console.log('微博API响应:', JSON.stringify(data).substring(0, 500) + '...');

      if (!data.data?.cards) {
        throw new Error('获取微博列表失败: ' + JSON.stringify(data));
      }

      const weibos = data.data.cards
        .filter(card => card.mblog)
        .map(card => ({
          id: card.mblog.id,
          text: this.stripTags(card.mblog.text),
          created_at: this.formatTime(card.mblog.created_at),
          bid: card.mblog.bid
        }));

      console.log(`获取到 ${weibos.length} 条微博`);
      return weibos;
    } catch (error) {
      console.error('获取微博失败:', error);
      return [];
    }
  },

  // 格式化时间
  formatTime(weiboTime) {
    // 设置为中国时区
    const now = new Date(new Date().getTime() + 8 * 3600 * 1000);
    
    if (weiboTime === '刚刚') {
      return now.toISOString().replace('T', ' ').slice(0, 19);
    }

    const minutesAgo = weiboTime.match(/(\d+)分钟前/);
    if (minutesAgo) {
      const date = new Date(now - minutesAgo[1] * 60000);
      return new Date(date.getTime() + 8 * 3600 * 1000)
        .toISOString()
        .replace('T', ' ')
        .slice(0, 19);
    }

    const hoursAgo = weiboTime.match(/(\d+)小时前/);
    if (hoursAgo) {
      const date = new Date(now - hoursAgo[1] * 3600000);
      return new Date(date.getTime() + 8 * 3600 * 1000)
        .toISOString()
        .replace('T', ' ')
        .slice(0, 19);
    }

    if (weiboTime.includes('今天')) {
      const time = weiboTime.match(/(\d{2}:\d{2})/)[1];
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      return `${year}-${month}-${day} ${time}:00`;
    }

    const thisYear = weiboTime.match(/(\d{2}-\d{2})\s*(\d{2}:\d{2})/);
    if (thisYear) {
      return `${now.getFullYear()}-${thisYear[1]} ${thisYear[2]}:00`;
    }

    const fullDate = weiboTime.match(/(\d{4}-\d{2}-\d{2})\s*(\d{2}:\d{2})/);
    if (fullDate) {
      return `${fullDate[1]} ${fullDate[2]}:00`;
    }

    return now.toISOString().replace('T', ' ').slice(0, 19);
  },

  // 去除HTML标签
  stripTags(html) {
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  },

  // 获取企业微信 access_token
  async getWeixinToken() {
    const key = 'weixin_token';
    let token = await this.KV.get(key);
    
    if (token) {
      return token;
    }

    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${this.config.wecom.corpid}&corpsecret=${this.config.wecom.corpsecret}`
    );
    
    const data = await response.json();
    if (data.errcode !== 0) {
      throw new Error('获取微信token失败: ' + JSON.stringify(data));
    }

    token = data.access_token;
    await this.KV.put(key, token, { expirationTtl: 7000 });
    
    return token;
  },

  // 发送企业微信消息
  async sendWeixin(message) {
    try {
      const token = await this.getWeixinToken();
      const response = await fetch(
        `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
        {
          method: 'POST',
          body: JSON.stringify({
            touser: this.config.wecom.touser,
            msgtype: 'text',
            agentid: this.config.wecom.agentid,
            text: { content: message }
          })
        }
      );

      const data = await response.json();
      if (data.errcode !== 0) {
        throw new Error(`发送消息失败: ${JSON.stringify(data)}`);
      }
      console.log('消息发送成功');
    } catch (error) {
      console.error('发送微信消息失败:', error);
    }
  },

  // 检查微博更新
  async checkWeibo() {
    console.log('开始检查微博更新');
    for (const user of this.config.monitor_users) {
      console.log(`检查用户 ${user.nickname} (${user.uid}) 的微博`);
      const weibos = await this.getWeiboData(user.uid);
      if (weibos.length === 0) {
        console.log('未获取到微博数据');
        continue;
      }

      const lastId = await this.KV.get(`last_weibo_${user.uid}`);
      console.log('上次检查的微博ID:', lastId);
      
      let foundLast = false;
      let newWeiboCount = 0;
      
      for (const weibo of weibos) {
        if (weibo.id === lastId) {
          foundLast = true;
          break;
        }

        if (!lastId || !foundLast) {
          newWeiboCount++;
          const message = `【${user.nickname}】发布了新微博：\n\n${weibo.text}\n\n发布时间：${weibo.created_at}\n\n原文链接：https://m.weibo.cn/detail/${weibo.id}`;
          console.log('发送新微博通知:', message);
          await this.sendWeixin(message);
        }
      }

      if (weibos.length > 0) {
        console.log(`更新最新微博ID: ${weibos[0].id}`);
        await this.KV.put(`last_weibo_${user.uid}`, weibos[0].id);
      }

      console.log(`检查完成，发现 ${newWeiboCount} 条新微博`);
    }
  }
};