#!/usr/bin/env bash
# 自动发布：打 tag + 创建 GitHub Release + 上传 zip
# 用法：
#   GH_TOKEN=ghp_xxx bash scripts/release.sh
#   或先把令牌写入 .github-release-token（该文件已被 gitignore）
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
REMOTE=$(git remote get-url origin)
REPO=$(echo "$REMOTE" | sed -E 's#(git@|https://)[^:/]+[:/]([^/]+/[^/]+)\.git#\2#')
ZIP="dist/li-web-interceptor-${VERSION}-chrome.zip"

if [ ! -f "$ZIP" ]; then
  echo "缺少 $ZIP，先运行 npm run zip"
  exit 1
fi

TOKEN="${GH_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f .github-release-token ]; then
  TOKEN=$(tr -d ' \n' < .github-release-token)
fi
if [ -z "$TOKEN" ]; then
  echo "请设置 GH_TOKEN 环境变量，或把令牌写入 .github-release-token（已 gitignore）"
  exit 1
fi

TAG="v${VERSION}"
BODY="下载 ${ZIP##*/}，解压后在 chrome://extensions 开发者模式 → 加载已解压 → 选择 chrome-mv3 文件夹。
使用说明见 USAGE.md，隐私政策见 PRIVACY.md。"

echo "发布到 $REPO，tag=$TAG"

# 创建 Release（若 tag 不存在会自动创建）
RELEASE_JSON=$(curl -sS -X POST \
  -H "Authorization: token $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$REPO/releases" \
  -d "$(node -e "console.log(JSON.stringify({tag_name:process.argv[1],name:process.argv[1],body:process.argv[2]}))" "$TAG" "$BODY")")

RELEASE_ID=$(echo "$RELEASE_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);console.log(j.id||'')}catch(e){console.log('')}})")
if [ -z "$RELEASE_ID" ]; then
  echo "创建 Release 失败："
  echo "$RELEASE_JSON"
  exit 1
fi
echo "✔ Release 已创建：https://github.com/$REPO/releases/tag/$TAG"

# 上传附件
UPLOAD=$(curl -sS -X POST \
  -H "Authorization: token $TOKEN" \
  -H "Content-Type: application/zip" \
  "https://uploads.github.com/repos/$REPO/releases/$RELEASE_ID/assets?name=${ZIP##*/}" \
  --data-binary "@$ZIP")
if echo "$UPLOAD" | grep -q '"name"'; then
  echo "✔ 附件已上传：${ZIP##*/}"
else
  echo "上传附件可能失败：$UPLOAD"
fi
