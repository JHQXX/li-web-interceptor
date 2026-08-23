/**
 * 常用分心网站模板（纯数据，可单测）。显示名/描述通过 i18n key 提供。
 */
export interface SiteTemplate {
  id: string;
  nameKey: string;
  descKey: string;
  hosts: string[];
}

export const SITE_TEMPLATES: SiteTemplate[] = [
  { id: 'video', nameKey: 'tplVideo', descKey: 'tplVideoDesc', hosts: ['youtube.com', 'bilibili.com', 'douyin.com', 'iqiyi.com', 'youku.com', 'mgtv.com'] },
  { id: 'social', nameKey: 'tplSocial', descKey: 'tplSocialDesc', hosts: ['weibo.com', 'zhihu.com', 'xiaohongshu.com', 'douban.com', 'baijiahao.baidu.com'] },
  { id: 'shop', nameKey: 'tplShop', descKey: 'tplShopDesc', hosts: ['taobao.com', 'tmall.com', 'jd.com', 'pinduoduo.com', 'vip.com'] },
  { id: 'news', nameKey: 'tplNews', descKey: 'tplNewsDesc', hosts: ['toutiao.com', 'news.qq.com', 'sohu.com', '163.com', 'thepaper.cn'] },
  { id: 'game', nameKey: 'tplGame', descKey: 'tplGameDesc', hosts: ['steampowered.com', '4399.com', '7k7k.com', 'uuu9.com'] },
];

export function findTemplate(id: string): SiteTemplate | undefined {
  return SITE_TEMPLATES.find((tpl) => tpl.id === id);
}
