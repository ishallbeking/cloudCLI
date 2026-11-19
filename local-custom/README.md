# CloudCLI 本地定制版

这是基于 **CloudCLI 1.37.7** 的可复现定制部署。保留仓库根目录的上游源码；本目录包含已部署版本的源码差异、后端运行文件、可读前端补丁、主题和测试。

[仓库首页](../README.md) · [上游项目说明](../README.upstream.md)

前端修改最初针对官方预构建资源完成，因此使用独立部署入口，不依赖根目录的前端重新编译。**根目录的 `npm run build` 仍构建上游版本；要运行这里的完整定制版，请使用下面的入口。**

## 包含的功能

- Codex 双向 App Server 连接、终端模型列表同步和 Approve for me 模式。
- 网页重命名同步到 Codex / Claude Code 原生会话名称；同步失败时明确报错。
- 左侧“组”支持跨项目整理对话、批量加入、移出、组重命名和删除；同一对话可属于多个组。
- `request_user_input_async` 可选择选项、自由输入、多题回答、跳过和回答后自动关闭。
- 紧凑人工审核卡片，优先显示 `reason`，支持恢复待审核请求。
- 消息稳定 ID、回合关联和断线恢复，避免实时流与刷新后的历史记录错位。
- Codex 压缩历史补载、历史搜索和对话快速导航。
- 简洁主题和侧栏，隐藏社区、问题反馈、GitHub 推广与版本标识，设置位于底部。
- 输入框旁的上下文占用圆环，使用最近请求的上下文计数，独立于累计消耗。
- 大目录按需展开、加载失败重试、刷新后恢复展开状态。
- 文件/文件夹右键复制粘贴及 Ctrl+C / Ctrl+V；重名自动生成副本，不覆盖原内容。
- 点击名称、大小、修改时间表头排序，支持升降序、子目录及刷新后保留。
- 可选 Claude CLI/provider 启动适配器，读取用户已有的私有配置。

## 部署

推荐 Linux、Node.js 22 或更高版本、npm、curl 和 tar。Codex 交互能力需要支持共享 App Server daemon 的 CLI；原部署验证版本为 0.160.0。已有官方 Claude 登录的用户直接使用正常安装的 Claude CLI。

```bash
git clone https://github.com/ishallbeking/cloudCLI.git
cd cloudCLI
node local-custom/scripts/prepare.mjs
cp local-custom/.env.example local-custom/env.local
# 根据服务器情况编辑 local-custom/env.local
./local-custom/webui start
```

默认访问 `http://127.0.0.1:3001`。需要直接从局域网电脑访问时，在 `env.local` 中配置 `HOST=0.0.0.0` 或服务器内网 IP，再访问 `http://服务器内网IP:3001`。首次进入创建自己的网页账号；账号、CLI 登录和会话数据不随仓库提供。

仅通过 SSH 访问时，可在电脑运行：

```bash
ssh -N -L 3001:127.0.0.1:3001 用户名@服务器地址
```

然后打开 `http://127.0.0.1:3001`。如果服务绑定的是指定内网 IP，把隧道目标中的 `127.0.0.1` 换为该 IP。

```bash
./local-custom/webui status
./local-custom/webui stop
./local-custom/webui restart
```

数据默认位于 `local-custom/data/`，日志位于 `local-custom/logs/server.log`。通过 `DATABASE_PATH` 可显式指定已有数据库。复制已有数据库前应停止对应服务并完整备份，避免多个实例同时写入。

系统 Node 不兼容旧 Linux 时，通过 `CLOUDCLI_NODE_BIN` 指向已有的兼容启动器；准备运行环境时也使用同一个 Node。机器专用的 Node、glibc、浏览器或原生依赖不存入 Git。

### CLI 配置

在 `env.local` 中按需设置 `CODEX_CLI_PATH`、`CODEX_HOME`。不设置时从 PATH 查找 Codex，并使用当前用户的 `~/.codex`。WebUI 会连接现有 daemon，在 daemon 不存在时用 CLI 的正常 `daemon start` 命令启动，不重启已有 daemon，也不绕过正在写入会话的锁。

如果终端的 `claude` 是 shell 函数，网页后端不会自动执行该函数。可明确指定实际 CLI 二进制和现有私有 provider 配置：

```bash
CLOUDCLI_CLAUDE_BINARY=/absolute/path/to/real/claude
CLOUDCLI_CLAUDE_PROVIDER_ENV=/absolute/path/to/private-provider-env.sh
```

配置文件由包装器 `source`，应为自己信任的文件；其中的凭据保留在服务器上，不复制进仓库。兼容 provider 需要在私有配置中指定 `ANTHROPIC_MODEL`；默认模型映射到该值，显式模型选择保持原样。不设置这两个变量时沿用 CLI 正常认证。

## 如何复现当前版本

`upstream.json` 固定官方 npm 安装包版本、Git 提交、SHA-512 完整性和逐文件覆盖清单。准备脚本校验安装包和覆盖文件哈希，展开原版、应用最终覆盖文件，然后从原始前端资源重新生成定制 bundle。后端覆盖文件已包含最终补丁，不再重复执行历史增量安装器。

目录说明：

| 路径 | 用途 |
| --- | --- |
| `overlay/server/` | 定制后端源码差异，保留当前部署实现 |
| `overlay/dist-server/` | 与源码对应的已验证后端运行文件差异 |
| `overlay/public/`、`overlay/dist/index.html` | 主题与页面入口 |
| `patches/` | 可读前端补丁和历史后端增量安装器 |
| `tests/`、`design/test-*.mjs` | 使用临时数据的回归测试 |
| `package/` | 准备后生成的独立运行目录，Git 忽略 |
| `package.runtime*.json` | 运行依赖及锁文件 |

历史后端安装器只用于审阅原实现过程。维护者应修改 `overlay/` 并更新清单哈希，再运行准备脚本；不要在最终覆盖文件上反复执行所有历史安装器。前端修改更新 `patches/` 后运行 `node local-custom/patches/file-tree-lazy-client.mjs` 即可。升级上游时必须重新核对覆盖清单及前端锚点。

已有安装包可通过 `CLOUDCLI_UPSTREAM_ARCHIVE=/path/to/cloudcli-1.37.7.tgz` 供准备脚本使用；仍会校验完整性。`--skip-deps` 只供已装好运行依赖的离线检查，不是首次部署方式。

## 内存占用修复（2026-11-11）

Codex 流式消息的重放缓存按稳定消息 ID 合并完整快照，避免保存不断增长的重复全文。单回合缓冲最多 8 MiB、共享缓冲最多 64 MiB；被裁剪的重放通过历史接口恢复。真实内容和会话文件不截断。替换回合会取消旧清理定时器并释放缓冲，关闭网页会立即移除连接，慢速连接超过 8 MiB 发送队列后重连恢复。历史缓存同时限制磁盘与规范化内容体积，超预算结果不驻留缓存。

独立 128 MiB 堆测试中，原实现约 400 次累积更新后 OOM；修复后完成 800 次更新，回收后约 21 MiB。连续模拟 2000 次回合替换，回收后约 20 MiB，未随批次增长。这些是有限压力测试结果，不能代替长期运行观察。

## 会话重命名同步（2026-11-17）

网页重命名现在先保存到 CLI 的原生记录：Codex 使用 `thread/name/set`，Claude Code 在已有会话文件中追加 `custom-title` 元数据。成功后才更新网页名称；同步失败返回错误并保留网页旧名称。同一会话的并发改名按顺序执行，不重写历史消息，也不启动模型生成。未发送过消息的网页会话尚无原生历史，暂存于网页数据库。

修复前的网页名称没有独立的“手工改名”标记，不能与自动标题可靠区分，因此不会批量覆盖原生名称。对需要补同步的旧名称，在左侧会话菜单中重新进入重命名并保存一次即可。已打开的终端历史选择器可能需要关闭重开以刷新列表。

## 跨项目对话组（2026-11-17）

左侧“项目 / 对话 / 组”切换到“组”，点击“创建组”，再通过组内“加入对话”搜索所有项目中的会话并批量选择。搜索和分页使用全局数据库，不局限于侧栏已经加载的会话。也可在项目或对话列表的会话菜单中点击“加入组”，选择已有组或创建新组。

组与成员关系按网页账号保存在服务器数据库，刷新或重启后保留。同一会话允许加入多个组；移出对话或删除组只改变分组，不删除历史，不更改所属项目，也不调用模型。归档的会话或项目暂时隐藏，恢复后会重新出现在原组中。组名称不可为空，最多 100 个字符，同一账号不允许同名组；一次最多加入 100 条对话。

前端兼容层的可读源码为 `patches/session-groups-client.tsx`，预编译的 `.js` 与 `.css` 由现有构建器注入。后端源码与对应运行文件位于 `overlay/`；修改它们后需同步覆盖清单哈希。专项测试覆盖持久化、跨项目及 provider、多组关系、账号隔离、搜索分页、无效批次原子性、归档恢复和删除清理。浏览器已在隔离分组数据库中验证桌面、手机、深色主题、刷新、导航、失败重试、会话菜单和重命名；没有发送模型消息。

## 验证

```bash
node local-custom/scripts/test.mjs
```

导出时从官方安装包独立重建，**173 项测试通过**；前端生成资源与当前部署一致。覆盖异步提问、审核、模型同步、消息关联、压缩历史、上下文占用、数据库锁以及文件树和复制 API。

浏览器用例 `design/review-file-copy.mjs` 和 `design/review-file-sort.mjs` 使用 Playwright。需要时自行安装 `playwright-core` 并将 Chromium 放在 `design/chromium`；通过 `CLOUDCLI_TEST_URL`、`CLOUDCLI_TEST_PROJECT_PATH`、`CLOUDCLI_TEST_PROJECT_NAME` 指定测试服务和已有项目。复制用例只修改其自行创建的临时目录，排序用例只读页面并注入固定元数据；不发送模型消息。

## 上传范围

仅包含代码、主题、配置模板、依赖锁文件和测试。未包含 `.env`、`env.local`、账号/认证数据库、CLI 凭据、会话记录、日志、截图、`node_modules` 或平台运行二进制。许可证沿用上游 AGPL-3.0-or-later，见仓库根目录 LICENSE。

## 聊天文件链接修复（2026-11-19）

本地 Markdown 链接在进入文件打开流程时只解码一次，修复中文目录、中文文件名和空格被重复编码后返回 404 的问题；文件树路径及外部网址保持原有处理。CSV、Markdown 继续在编辑器查看，PDF 使用已有预览。ZIP、Word、Excel 等二进制文件提示中增加认证下载按钮，保留原文件名与原始字节，下载失败显示原因。

回归：`tests/chat-file-links.test.mjs`；只读浏览器验证：`design/review-chat-file-links.mjs`。
