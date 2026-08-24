/**
 * 域名列表解析：支持换行、逗号、中文逗号、空白分隔。
 */
export function parseHostList(text: string): string[] {
  return text
    .split(/[\n,，\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
