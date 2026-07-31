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
- 可分别修改基础模型 Base URL、图像模型 Base URL 与各自模型名，支持同时接入不同供应商
- 连接参数与 Key 暂时只保存在当前浏览器的 `localStorage`，服务端不落盘
- 多输出结果集合：同一次运行可同时保留多份文案、多张图片、JSON 和文件
- 图像节点支持一次生成 1–4 张图片，结果卡按 1:1、16:9、4:3、3:4、9:16 等实际比例展示
- 多图片图库预览、方向键切换、逐张下载、文案逐项/全部复制和完整结果 JSON 导出
- 多结束节点独立分组，预设输出使用稳定业务 Key，避免最后结果覆盖前序结果
- 工作流 JSON 复制、下载导出、导入校验以及发布前图结构校验
- 变量聚合节点与同层并行 DAG 调度
- 商品主图、营销套图、详情页文案包、活动条件分流 4 个电商预设

## 测试

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm verify:multi-output
```

单元测试覆盖多输出规范化、业务绑定、条件多值、DAG 校验、导入导出和预设 ID 重映射。浏览器回归覆盖多图与对应文案、复制/下载、图库键盘操作、图片比例、删除/撤销、停止运行和条件分支。

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

两类 Base URL 与模型名默认沿用原配置，也可在页面分别修改并保存到当前浏览器 `localStorage`。文字请求只使用基础模型供应商配置，生图请求只使用图像供应商配置；服务端分别校验后转发。旧版浏览器中保存的单一 `baseUrl` 会自动迁移到两类地址。API Key 同样由用户在页面填写；正式生产建议改用 Secret Manager。

当前网关实际图像路由为 `gpt-image-2-count`。新测试 Key 已成功真实出图，但上游渠道存在间歇性“无可用渠道”；Demo 会有限重试，仍失败时明确标记并回退到现有品牌演示图片。渠道可用时真实图片会自动替代回退素材。

## 安全

- `.env.local` 与旧版 `user-config.json` 均已加入 `.gitignore`
- `.env.local` 不再保存 API Key
- 浏览器保存完整 Key，并仅在模型调用时通过同源请求发送给本地网关
- 服务端错误响应不会回显 Key
- 原测试 Key 曾在聊天中出现，正式使用前必须在服务商后台撤销并重新生成
