# AIFlow Studio Demo

爱玩 AI 品牌下的本地 AI 工作流构建平台 Demo。界面样式复用参考站的 CSS 令牌、导航、卡片、按钮和品牌 Logo，编辑器使用 React Flow 实现节点拖拽与连线。

## 当前能力

- 可拖拽的开始、大模型、图像生成、条件、HTTP、代码和结束节点
- 节点选择、配置编辑、连接、缩放、小地图和运行状态
- 节点删除、结构撤销、左右面板折叠、运行中止
- 通用前端 DAG 执行器与条件节点 true/false 双出口
- HTTP 请求节点：服务端代理、15 秒超时、私网 SSRF 拦截
- JavaScript 代码节点：独立 Web Worker、5 秒超时
- 本地运行记录、版本发布与版本恢复
- 800ms 防抖保存到浏览器 `localStorage`
- 基础模型真实调用：OpenAI 兼容 `/chat/completions`
- GPT Image 2 标准调用：OpenAI 兼容 `/images/generations`
- 节点级运行日志、最终输出、错误状态和品牌演示素材回退
- 在模型配置弹窗中手动填写、替换和清除基础模型与图像模型 Key
- Key 暂时只保存在当前浏览器的 `localStorage`，服务端不落盘

## 运行

项目已经构建，可以直接运行：

```powershell
cd D:\code\CodeX\workflow\ai-flow-studio-demo
node server.mjs
```

打开 <http://127.0.0.1:14590>。

如需开发模式，先安装依赖，再执行 `pnpm dev`。生产构建使用 `pnpm build`。

## Docker 部署

公开仓库的 GitHub Actions 自动发布多架构镜像 `ghcr.io/cdllang/ai-flow-studio:latest`。Ubuntu 24 服务器可直接执行：

```bash
mkdir -p /www/wwwroot/ai-flow-studio
cd /www/wwwroot/ai-flow-studio
curl -fsSL https://raw.githubusercontent.com/cdllang/ai-flow-studio/main/compose.ghcr.yaml -o compose.yaml
docker compose pull
docker compose up -d
```

服务监听 `14590`，完整说明见 `DEPLOYMENT.md`。

## 配置

启动后打开右上角“模型配置”，分别填写基础模型与 GPT Image 2 API Key，然后点击“保存配置”。输入框留空会保留现有值；需要删除时点击对应的“清除已保存 Key”再保存。

Base URL 与模型名默认沿用 `.env.local` 中的原配置，无需在界面重复填写。API Key 由用户在页面填写并保存到当前浏览器 `localStorage`；正式生产建议改用 Secret Manager。

当前网关实际图像路由为 `gpt-image-2-count`。新测试 Key 已成功真实出图，但上游渠道存在间歇性“无可用渠道”；Demo 会有限重试，仍失败时明确标记并回退到现有品牌演示图片。渠道可用时真实图片会自动替代回退素材。

## 安全

- `.env.local` 与旧版 `user-config.json` 均已加入 `.gitignore`
- `.env.local` 不再保存 API Key
- 浏览器保存完整 Key，并仅在模型调用时通过同源请求发送给本地网关
- 服务端错误响应不会回显 Key
- 原测试 Key 曾在聊天中出现，正式使用前必须在服务商后台撤销并重新生成
