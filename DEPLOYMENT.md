# AIFlow Studio Docker 部署

服务默认监听 `0.0.0.0:14590`。用户在独立“模型服务”页面管理多个供应商连接；每条连接将 Base URL、API Key 和模型清单成组保存，节点可分别选择连接与模型。连接配置不包含在镜像或发布包中。

## 推荐部署：拉取 GitHub 预构建镜像

GitHub Actions 会在每次推送 `main` 分支后构建 `linux/amd64` 和 `linux/arm64` 镜像，并发布到：

```text
ghcr.io/cdllang/ai-flow-studio:latest
```

Ubuntu 24 服务器执行：

```bash
mkdir -p /www/wwwroot/ai-flow-studio
cd /www/wwwroot/ai-flow-studio
curl -fsSL https://raw.githubusercontent.com/cdllang/ai-flow-studio/main/compose.ghcr.yaml -o compose.yaml
docker compose pull
docker compose up -d
curl http://127.0.0.1:14590/api/health
```

这种方式不需要服务器访问 Docker Hub，也不需要在服务器构建 Node 基础镜像。

## 源码包本地构建

```bash
tar -xzf ai-flow-studio-server-14590.tar.gz
cd ai-flow-studio-server-14590
docker compose up -d --build
```

访问：`http://服务器IP:14590`

检查状态：

```bash
docker compose ps
curl http://127.0.0.1:14590/api/health
docker compose logs -f --tail=100
```

## 浏览器配置保存位置

当前内测版本把全部供应商连接保存在访问该站点的浏览器 `localStorage`：

```text
aiflow.demo.providers
```

每条记录包含供应商名称、Base URL、API Key 以及用户添加的文本/图像模型清单。每个文本模型还保存其接口协议：`chat-completions` 对应 `/chat/completions`，`responses` 对应官方小写 `/responses`；旧模型缺少该字段时自动回退到 `chat-completions`。旧键 `aiflow.demo.apiKeys` 会在首次加载时迁移并删除。服务端不创建 Key 配置文件；模型调用时，浏览器将节点选中连接的 Key 通过同源请求发送给网关，网关只在该次请求内使用并转发，不落盘。不同浏览器、设备和域名端口之间不会共享配置；清理浏览器站点数据会删除 Key。

> [!warning]
> `localStorage` 可被同源 JavaScript 读取，只适合当前受控内测。正式公网生产必须加强 CSP、避免第三方脚本，并优先迁移到服务端 Secret Manager 或加密凭证存储。

## 更新与停止

```bash
docker compose pull
docker compose up -d
docker image prune -f
```

停止或更新容器不会影响浏览器中已保存的 Key；但更换访问域名、协议或端口后需要重新填写。

## 反向代理

对公网提供服务时，建议通过 Nginx、Caddy 或云负载均衡配置 HTTPS，并只在防火墙中开放必要端口。反向代理的上游地址为：

```text
http://127.0.0.1:14590
```

AI 辅助构建可能包含多次长推理调用。`/api/workflow-assistant/turn` 使用 NDJSON 阶段流并每 15 秒发送心跳；Nginx 必须关闭响应缓冲，并把读取超时设为高于服务端允许的最长模型调用时间：

```nginx
location /api/workflow-assistant/ {
    proxy_pass http://127.0.0.1:14590;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    proxy_buffering off;
    proxy_cache off;
    gzip off;
    proxy_read_timeout 900s;
    proxy_send_timeout 900s;
}

location / {
    proxy_pass http://127.0.0.1:14590;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

如果前面还有 CDN、云负载均衡或面板代理，也要关闭该路径的响应缓冲并把空闲超时设为至少 900 秒。否则代理可能返回空 502/504；新版前端会显示 `ASSISTANT_EMPTY_RESPONSE` 和请求 ID，而不会再显示浏览器原生 JSON 解析错误。

## 自定义配置

可在 `compose.yaml` 的 `environment` 中调整以下非敏感配置：

| 变量 | 默认值 |
|---|---|
| `PORT` | `14590` |
| `HOST` | `0.0.0.0` |
| `AIWANAI_BASE_URL` | `https://ai.aiwanai.com.cn/v1` |
| `AIWANAI_CHAT_BASE_URL` | `https://ai.aiwanai.com.cn/v1`；基础模型默认地址，未设置时回退到 `AIWANAI_BASE_URL` |
| `AIWANAI_IMAGE_BASE_URL` | `https://ai.aiwanai.com.cn/v1`；图像模型默认地址，未设置时回退到 `AIWANAI_BASE_URL` |
| `AIWANAI_DEFAULT_CHAT_MODEL` | `gpt-5.4-mini` |
| `AIWANAI_IMAGE_MODEL` | `gpt-image-2-count` |
| `IMAGE_DEMO_FALLBACK` | `false` |
| `ALLOW_PRIVATE_MODEL_BASE_URL` | `false`；仅在明确需要连接可信内网模型服务时设为 `true` |

不要通过 Compose 明文填写 API Key。当前版本使用平台页面写入浏览器 `localStorage`，正式生产再接入专用密钥服务。为防止 SSRF，用户填写的两类 Base URL 都会独立校验，默认不能指向 localhost 或私网地址。旧版 `AIWANAI_BASE_URL` 继续作为两类地址的兼容回退值。
