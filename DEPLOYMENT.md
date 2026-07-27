# AIFlow Studio Docker 部署

服务默认监听 `0.0.0.0:14590`，模型 Base URL 与模型名称保持项目原配置。API Key 不包含在镜像或发布包中，首次打开页面时由用户手动填写并保存在当前浏览器的 `localStorage`。

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

## API Key 保存位置

当前内测版本把两类 API Key 保存在访问该站点的浏览器 `localStorage`：

```text
aiflow.demo.apiKeys
```

服务端不创建 Key 配置文件。模型调用时，浏览器将对应 Key 通过同源请求发送给网关，网关只在该次请求内使用并转发，不落盘。不同浏览器、设备和域名端口之间不会共享配置；清理浏览器站点数据会删除 Key。

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

## 自定义配置

可在 `compose.yaml` 的 `environment` 中调整以下非敏感配置：

| 变量 | 默认值 |
|---|---|
| `PORT` | `14590` |
| `HOST` | `0.0.0.0` |
| `AIWANAI_BASE_URL` | `https://ai.aiwanai.com.cn/v1` |
| `AIWANAI_DEFAULT_CHAT_MODEL` | `gpt-5.4-mini` |
| `AIWANAI_IMAGE_MODEL` | `gpt-image-2-count` |
| `IMAGE_DEMO_FALLBACK` | `false` |

不要通过 Compose 明文填写 API Key。当前版本使用平台页面写入浏览器 `localStorage`，正式生产再接入专用密钥服务。
