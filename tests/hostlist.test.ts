import { describe, it, expect } from 'vitest';
import { parseHostList } from '@/utils/hostlist';

describe('parseHostList', () => {
  it('按换行/逗号/空格/中文逗号分隔并去重空白', () => {
    expect(parseHostList('youtube.com\nbilibili.com, douyin.com  taobao.com，jd.com')).toEqual([
      'youtube.com', 'bilibili.com', 'douyin.com', 'taobao.com', 'jd.com',
    ]);
  });
  it('去空行与小写化', () => {
    expect(parseHostList('  YouTube.COM \n\n  ')).toEqual(['youtube.com']);
  });
  it('空输入返回空数组', () => {
    expect(parseHostList('   \n ')).toEqual([]);
  });
});
