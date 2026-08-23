/**
 * 常用分心网站模板（纯数据，可单测）。
 */
export interface SiteTemplate {
  id: string;
  name: string;
  desc: string;
  hosts: string[];
}

export const SITE_TEMPLATES: SiteTemplate[] = [
  {
    id: 'video',
    name: '视频网站',
    desc: 'youtube / bilibili / 抖音 等',
    hosts: ['youtube.com', 'bilibili.com', 'douyin.com', 'iqiyi.com', 'youku.com', 'mgtv.com'],
  },
  {
    id: 'social',
    name: '社交网络',
    desc: '微博 / 知乎 / 小红书 等',
    hosts: ['weibo.com', 'zhihu.com', 'xiaohongshu.com', 'douban.com', 'baijiahao.baidu.com'],
  },
  {
    id: 'shop',
    name: '购物网站',
    desc: '淘宝 / 京东 / 拼多多 等',
    hosts: ['taobao.com', 'tmall.com', 'jd.com', 'pinduoduo.com', 'vip.com'],
  },
  {
    id: 'news',
    name: '资讯阅读',
    desc: '今日头条 / 腾讯新闻 等',
    hosts: ['toutiao.com', 'news.qq.com', 'sohu.com', '163.com', 'thepaper.cn'],
  },
  {
    id: 'game',
    name: '游戏网站',
    desc: 'Steam / 4399 等',
    hosts: ['steampowered.com', '4399.com', '7k7k.com', 'uuu9.com'],
  },
];

export function findTemplate(id: string): SiteTemplate | undefined {
  return SITE_TEMPLATES.find((t) => t.id === id);
}
