export default {
  // 定义配置
  config: {
    // 监控用户配置
    monitor_users: [
      {
        nickname: '目标用户',
        uid: '7817017460'
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
  },

  // 处理定时任务
  async scheduled(event, env, ctx) {
    await this.init(env);
    await this.checkWeibo();
  },

  // 处理 HTTP 请求
  async fetch(request, env, ctx) {
    await this.init(env);
    await this.checkWeibo();
    return new Response('OK');
  },

  // 获取微博数据
  async getWeiboData(uid) {
    try {
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
      if (!data.data?.cards) {
        throw new Error('获取微博列表失败');
      }

      return data.data.cards
        .filter(card => card.mblog)
        .map(card => ({
          id: card.mblog.id,
          text: this.stripTags(card.mblog.text),
          created_at: this.formatTime(card.mblog.created_at),
          bid: card.mblog.bid
        }));
    } catch (error) {
      console.error('获取微博失败:', error);
      return [];
    }
  },

  // 格式化时间
  formatTime(weiboTime) {
    const now = new Date();
    
    if (weiboTime === '刚刚') {
      return now.toISOString().replace('T', ' ').substring(0, 19);
    }

    const minutesAgo = weiboTime.match(/(\d+)分钟前/);
    if (minutesAgo) {
      const date = new Date(now - minutesAgo[1] * 60000);
      return date.toISOString().replace('T', ' ').substring(0, 19);
    }

    const hoursAgo = weiboTime.match(/(\d+)小时前/);
    if (hoursAgo) {
      const date = new Date(now - hoursAgo[1] * 3600000);
      return date.toISOString().replace('T', ' ').substring(0, 19);
    }

    if (weiboTime.includes('今天')) {
      const time = weiboTime.match(/(\d{2}:\d{2})/)[1];
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${time}:00`;
    }

    const thisYear = weiboTime.match(/(\d{2}-\d{2})\s*(\d{2}:\d{2})/);
    if (thisYear) {
      return `${now.getFullYear()}-${thisYear[1]} ${thisYear[2]}:00`;
    }

    const fullDate = weiboTime.match(/(\d{4}-\d{2}-\d{2})\s*(\d{2}:\d{2})/);
    if (fullDate) {
      return `${fullDate[1]} ${fullDate[2]}:00`;
    }

    return now.toISOString().replace('T', ' ').substring(0, 19);
  },

  // 去除HTML标签
  stripTags(html) {
    return html.replace(/<[^>]*>/g, '');
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
      throw new Error('获取微信token失败');
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
        throw new Error(`发送消息失败: ${data.errmsg}`);
      }
    } catch (error) {
      console.error('发送微信消息失败:', error);
    }
  },

  // 检查微博更新
  async checkWeibo() {
    for (const user of this.config.monitor_users) {
      const weibos = await this.getWeiboData(user.uid);
      if (weibos.length === 0) continue;

      const lastId = await this.KV.get(`last_weibo_${user.uid}`);
      let foundLast = false;
      
      for (const weibo of weibos) {
        if (weibo.id === lastId) {
          foundLast = true;
          break;
        }

        if (!lastId || !foundLast) {
          const message = `【${user.nickname}】发布了新微博：\n\n${weibo.text}\n\n发布时间：${weibo.created_at}\n\n原文链接：https://m.weibo.cn/detail/${weibo.id}`;
          await this.sendWeixin(message);
        }
      }

      if (weibos.length > 0) {
        await this.KV.put(`last_weibo_${user.uid}`, weibos[0].id);
      }
    }
  }
};