# AIFlow Studio Demo

爱玩 AI 品牌下的本地 AI 工作流构建平台 Demo。界面样式复用参考站的 CSS 令牌、导航、卡片、按钮和品牌 Logo，编辑器使用 React Flow 实现节点拖拽与连线。

## 当前能力

- 可拖拽的开始、大模型、图像生成、条件、HTTP、代码和结束节点
- 节点选择、配置编辑、连接、缩放、小地图和运行状态
- 左侧节点库支持单击快速添加，也支持拖到画布落点创建；拖拽过程提供落点反馈
- 顶部纯图标操作提供悬停/键盘聚焦说明和无障碍名称
- 节点删除、结构撤销、左右面板折叠、运行中止
- 通用前端 DAG 执行器与条件节点 true/false 双出口
- HTTP 请求节点：服务端代理、15 秒超时、私网 SSRF 拦截
- JavaScript 代码节点：独立 Web Worker、5 秒超时
- 本地运行记录、版本发布与版本恢复
- 800ms 防抖保存到浏览器 `localStorage`
- 基础模型真实调用：同时兼容 OpenAI `/chat/completions` 与 `/responses`
- 大模型节点支持 `low / medium / high / xhigh / max` 五档思考强度，默认 `high`；网关分别转换为 `reasoning_effort` 或 `reasoning.effort`
- 大模型节点支持多选 Skill；当前服务器白名单内置 `GPT Image 2` Advisor，用于生成可交给下游图像节点的结构化提示词
- 独立“Skill 中心”：平台指定 Skill 由服务器托管，用户自建 Skill 仅保存在当前浏览器 `localStorage`
- 本地 Skill 只在被节点选中并运行时随该次请求临时发送，服务端只做校验和内存组合，不写入磁盘或公共 Skill 注册表
- GPT Image 2 标准调用：OpenAI 兼容 `/images/generations`
- 节点级运行日志、最终输出、错误状态和品牌演示素材回退
- 独立“模型服务”页面：可新增多个供应商连接，并将 Base URL、API Key 与用户维护的模型清单成组保存
- 同一供应商 Key 可声明多个文本/图像模型；文本模型逐个绑定 Chat Completions 或 Responses 协议，每个大模型与图像节点可分别选择供应商连接和模型
- 旧版基础模型/图像模型配置自动迁移为两条供应商连接
- 供应商连接与 Key 暂时只保存在当前浏览器的 `localStorage`，服务端不落盘
- 多输出结果集合：同一次运行可同时保留多份文案、多张图片、JSON 和文件
- 图像节点支持一次生成 1–4 张图片，结果卡按 1:1、16:9、4:3、3:4、9:16 等实际比例展示
- 多图片图库预览、方向键切换、逐张下载、文案逐项/全部复制和完整结果 JSON 导出
- 多结束节点独立分组，预设输出使用稳定业务 Key，避免最后结果覆盖前序结果
- 分支级失败隔离：单节点失败不会清空其他分支输出；相关下游标记为阻断，运行记录显示“部分成功”
- 详细错误日志包含节点 ID/类型、错误代码、HTTP 状态、请求 ID、耗时、时间与上游节点
- 工作流 JSON 复制、下载导出、导入校验以及发布前图结构校验
- 变量聚合节点与同层并行 DAG 调度
- 商品主图、营销套图、详情页文案包、活动条件分流 4 个电商预设
- 右侧“AI 构建 Session”：用户可选择 Builder 与独立 Critic 模型，用自然语言新建或调整工作流
- 服务器自动加载私有系统 Skill `guard-workflow-intent`，先固化目标、边界、输入输出、权限、预算与验收标准；信息不足时只提问、不生成草案
- 用户确认只针对 AI 识别出的输入与输出，界面提供“是 / 否 / 其他”；范围、验收标准、权限与预算由系统按安全默认值内部推断，不再要求用户逐项确认
- 输入输出使用稳定签名记录确认状态；选择“其他”后先重新识别输入输出，再要求用户确认更新后的结果
- AI 模型请求遇到瞬时网络错误或超时会自动重试一次；连续超时返回中文 504 诊断，不再暴露底层 `The operation was aborted due to timeout`
- 超时后当前校验阶段立即停止转圈并标记失败，错误卡提供“重新尝试”和“切换模型”；重试不会把同一条消息重复写入 Session
- 草案依次经过确定性图校验、隔离上下文 Critic 和最多两轮修复；未通过或未经用户确认时绝不覆盖当前画布
- AI 先生成唯一的 `WorkflowPlan`；确认区由该 Plan 同时派生流程图、逐节点说明、数据流向和画布结构
- 服务端忽略 AI 提供的节点坐标与额外边，只按 `WorkflowPlan.connections` 自动布局并编译画布连线，客户端应用前再次校验 Plan/画布一致性
- 严格阻断重复连线、跨级冗余连线、普通处理节点多个主上游、未聚合的多分支输出及无法到达输出的节点
- 对话中再次调整工作流时，上一版流程图、校验结果和应用按钮立即锁定；只有本轮校验链完成并返回最新草案后才重新允许应用
- AI Session、任务契约、候选草案与最近消息保存在浏览器；超过 12 轮或上下文窗口 70% 时压缩较早历史，并校验边界完整性

## 测试

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm verify:config
pnpm verify:reasoning-drag
pnpm verify:skills
pnpm verify:partial-failure
pnpm verify:multi-output
pnpm verify:assistant
```

42 项自动测试覆盖 Chat Completions/Responses 协议转换、多供应商迁移/解析、服务器/本地 Skill 注册与指令组合、AI 输入输出确认签名、TaskContract、WorkflowPlan 编译与连线去歧义、系统 Skill 加载、Session 压缩、五分钟默认超时、确认超时重试、确定性校验、Critic/Repair 隔离、多输出规范化、业务绑定、条件多值、DAG 校验、导入导出和预设 ID 重映射。浏览器回归覆盖 AI 超时失败态与恢复、仅输入输出确认、Plan 流程图和流程说明预览、二次调整期间旧草案/旧校验/旧应用按钮锁定、确认前画布隔离、旧草案失效保护、AI 构建会话、Skill 中心及节点多选、供应商管理与节点绑定、部分失败保全、多图与对应文案、复制/下载、图库键盘操作、图片比例、删除/撤销、停止运行和条件分支。

“AI 辅助构建工作流”首期已经实现，架构、约束与后续增强见 [`AI_WORKFLOW_ASSISTANT_DESIGN.md`](AI_WORKFLOW_ASSISTANT_DESIGN.md)。

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

启动后打开顶部“模型服务”，新增或编辑供应商连接。每条连接同时保存 Base URL、API Key 和此 Key 支持的模型清单，模型需标注为“文本模型”或“图像模型”。新增文本模型时还需选择 `Chat Completions · /chat/completions` 或 `Responses · /responses`；旧配置默认使用 Chat Completions。回到编排页后，在每个大模型节点中选择供应商、模型与思考强度，在图像节点中选择供应商和模型。

文字和图像请求只携带该节点绑定连接的 Base URL、API Key 与模型。旧版浏览器中的基础模型/图像模型配置会自动迁移为两条供应商连接。正式生产建议将浏览器凭证迁移到 Secret Manager。

当前网关实际图像路由为 `gpt-image-2-count`。新测试 Key 已成功真实出图，但上游渠道存在间歇性“无可用渠道”；Demo 会有限重试，仍失败时明确标记并回退到现有品牌演示图片。渠道可用时真实图片会自动替代回退素材。

AI 构建 Session 可在顶部“AI 构建”打开。Builder Key 和可选的 Critic Key 仅通过请求头传给同源网关；请求正文中的供应商目录已移除 Key。系统级意图守卫只存在于 `system-skills/`，不会通过 `/api/skills` 暴露，也不能被用户关闭。

AI 模型单次请求默认超时为 300 秒，发生超时或网络连接错误时自动重试一次。可通过 `ASSISTANT_MODEL_TIMEOUT_MS` 调整单次超时（生产环境范围 30000–900000 毫秒），通过 `ASSISTANT_MODEL_RETRY_DELAY_MS` 调整重试前等待（0–5000 毫秒）。普通大模型节点没有该 90 秒限制。

## Skill 扩展

平台 Skill 使用服务器白名单目录，不会自动安装任意第三方 Skill。每个服务器 Skill 位于 `skills/<skill-id>/`，包含公开元数据 `skill.json` 与仅服务端读取的 `instructions.md`；Docker 镜像目前只打包管理员指定的 `gpt-image-2`。`GET /api/skills` 仅返回可选择的元数据，不返回完整指令。

用户可在顶部“Skills”页面创建自己的 Skill，数据保存在 `aiflow.demo.local-skills`。大模型节点可同时选择服务器 Skill 和本地 Skill；运行时请求分别携带服务器 Skill ID 与当前已选本地 Skill 定义，网关校验数量、长度和格式后临时追加到系统指令。删除或缺失的 Skill 会阻止对应节点运行并给出明确错误，不会被静默忽略。

`GPT Image 2` 在大模型节点内运行于 Advisor 模式，只负责整理图像生成/编辑提示词；实际出图仍由下游图像生成节点调用供应商模型。这一分层可继续接入代码审查、文案规范、数据提取等管理员白名单 Skill，而不需要把用户自建内容长期存到服务器。

## 安全

- `.env.local` 与旧版 `user-config.json` 均已加入 `.gitignore`
- `.env.local` 不再保存 API Key
- 浏览器保存完整 Key，并仅在模型调用时通过同源请求发送给本地网关
- 服务端错误响应不会回显 Key
- 原测试 Key 曾在聊天中出现，正式使用前必须在服务商后台撤销并重新生成
