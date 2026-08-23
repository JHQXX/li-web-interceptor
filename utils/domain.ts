/**
 * 域名/URL 解析工具（纯函数，可单测）。
 */

export function getHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** 规范化用户输入的域名：去掉协议、路径、端口、www 前缀 */
export function normalizeHost(input: string): string {
  let h = input.trim().toLowerCase();
  h = h.replace(/^[a-z]+:\/\//, '');
  h = h.replace(/^\/+/, '');
  h = h.split('/')[0] ?? h;
  h = h.split('?')[0] ?? h;
  h = h.split('#')[0] ?? h;
  h = h.replace(/:\d+$/, '');
  h = h.replace(/^www\./, '');
  h = h.replace(/\.$/, '');
  return h;
}

/** 常见复合公共后缀（简化版，用于衍生域名识别） */
export const COMPOUND_SUFFIXES = [
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
  'com.hk', 'com.tw', 'com.mo',
  'co.uk', 'org.uk', 'me.uk', 'ac.uk', 'gov.uk', 'ltd.uk', 'plc.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'com.br', 'com.mx', 'com.ar', 'com.pe', 'com.co', 'com.ec', 'com.ve', 'com.py', 'com.uy', 'com.cl',
  'co.in', 'net.in', 'org.in', 'com.sg', 'com.my', 'co.kr', 'com.ph', 'co.th', 'com.vn', 'com.tr', 'com.ua', 'co.id', 'com.eg', 'com.ng', 'co.za', 'com.ae', 'co.il',
];

/** 获取可注册域名（如 example.com、example.co.uk） */
export function getRegistrableDomain(host: string): string | null {
  const h = normalizeHost(host);
  if (!h) return null;
  const parts = h.split('.');
  if (parts.length < 2) return h;
  for (let i = 1; i < parts.length; i++) {
    const suffix = parts.slice(i).join('.');
    if (COMPOUND_SUFFIXES.includes(suffix)) {
      return parts.slice(i - 1).join('.');
    }
  }
  return parts.slice(-2).join('.');
}

/** 常见的 TLD 变体 */
export const COMMON_TLDS = ['com', 'cn', 'net', 'org', 'io', 'co', 'tv', 'me', 'info', 'biz', 'cc'];
