# Coze Loop → DSH 插件适配

这个仓库现在包含一个标准 DSH bundle。DSH 负责 Coze Loop 的生命周期，Coze Loop 本体仍使用官方 Docker Compose 部署，不改业务代码。

## 安装前提

- DSH / Node.js 22.19+
- Docker Engine 或 Docker Desktop
- Docker Compose v2（命令为 `docker compose`）
- 如果 DSH 跑在 WSL2：开启 Docker Desktop 对该 Ubuntu 发行版的 WSL Integration

## 安装

当前适配分支：

```bash
dsh plugin --profile web add github:wangbingquan1991/coze-loop#feat/dsh-plugin-adapter
```

重启对应的 DSH profile。合并到 `main` 后可直接安装：

```bash
dsh plugin --profile web add github:wangbingquan1991/coze-loop
```

本地仓库也可以：

```bash
dsh plugin --profile web add file:/path/to/coze-loop
```

## 安装后的行为

插件默认 `autoStart: true`。激活时会把仓库内官方 Compose 资源首次复制到持久目录：

```text
$DSH_HOME/apps/coze-loop
```

未设置 `DSH_HOME` 时为：

```text
~/.dsh/apps/coze-loop
```

之后 DSH 自动执行等价于：

```bash
docker compose -f docker-compose.yml --env-file .env --profile "*" up -d
```

所以日常不需要再手工运行 Docker Compose 命令。

## DSH 内置管理命令

| 命令 | 作用 |
| --- | --- |
| `/cozeloop-status` | 查看所有 Compose 服务状态、访问地址和运行目录 |
| `/cozeloop-start` | 启动 Coze Loop |
| `/cozeloop-stop` | 停止 Coze Loop，不删除 volume |
| `/cozeloop-restart` | 重启 Coze Loop |
| `/cozeloop-update` | 拉取配置中的镜像并重新应用 |
| `/cozeloop-logs` | 查看最近日志 |
| `/cozeloop-logs app` | 只看 app 服务日志 |
| `/cozeloop-open` | 显示 Web 地址 |

默认访问：

```text
http://127.0.0.1:8082
```

DSH 在 WSL2、浏览器在 Windows 时，通常可直接访问 `http://localhost:8082`。

## 模型配置

首次启动后编辑持久目录中的：

```text
~/.dsh/apps/coze-loop/conf/model_config.yaml
```

配置 Coze Loop 使用的 LLM API Key / Endpoint。不要去改 DSH 的 pnpm/node_modules 包缓存。

## 可选配置

如需覆盖默认值，在 profile 的 `cordis.patch.yml` 中按同一个 id 覆盖：

```yaml
- id: coze-loop
  config:
    autoStart: true
    pullOnStart: false
    stopOnDispose: false
    webPort: 8082
    dockerBin: docker
    runtimeDir: ""
    logTail: 80
    commandTimeoutMs: 900000
```

- `autoStart`: DSH 插件激活时自动启动 Coze Loop。
- `pullOnStart`: 自动启动前先拉镜像。
- `stopOnDispose`: DSH 卸载/停止该插件时是否同时停止 Coze Loop；默认 false。
- `runtimeDir`: 持久 Compose/配置目录；空值使用 `$DSH_HOME/apps/coze-loop`。
- `webPort`: `/cozeloop-open` 和状态信息显示的端口。

## 数据安全

插件的停止/重启只使用 `docker compose down`，不会执行 `down -v`。MySQL、Redis、ClickHouse、MinIO 等命名卷不会因为 DSH 重启而被删除。

插件故意不提供删除 volumes 的命令；需要清数据时应先备份，再人工执行破坏性操作。

## 常见问题

如果自动启动失败，在 DSH 中执行 `/cozeloop-status`。重点检查 Docker Desktop 是否运行、WSL Integration 是否开启、8082 等端口是否冲突，以及 Docker Hub 镜像是否能正常拉取。
