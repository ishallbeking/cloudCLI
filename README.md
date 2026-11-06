# CloudCLI 定制版

基于 [siteboon/claudecodeui](https://github.com/siteboon/claudecodeui) **1.37.7**，为服务器上的 Codex 和 Claude Code 提供网页聊天、历史会话、项目文件及终端界面。支持电脑和手机访问。

本仓库包含目前实际部署使用的本地定制功能。**请使用下方的 `local-custom` 部署流程，才能得到这套定制界面与功能。**

[完整部署与配置说明](local-custom/README.md) · [定制代码与补丁](local-custom/) · [上游项目说明](README.upstream.md)

## 定制功能

| 功能 | 说明 |
| --- | --- |
| 界面与侧栏 | 简洁主题，设置置底，移除社区、问题反馈、GitHub 推广及版本标识 |
| Codex 模型与模式 | 同步终端可见模型及推理强度，增加 Approve for me 模式 |
| 交互式提问 | 支持 `request_user_input_async` 选项选择、自由文本、多题回答、跳过及提交后关闭 |
| 人工审核 | 输入框上方的紧凑审核卡片，优先显示请求的 `reason`，支持待审核请求恢复 |
| 消息与会话历史 | 修复实时消息关联和顺序，支持断线恢复、压缩历史补载及搜索 |
| 对话快速导航 | 快速阅览并跳转到历史消息 |
| 上下文占用 | 定时发送按钮旁显示上下文占用圆环，悬停查看用量，达到阈值变色 |
| 项目文件 | 大目录按需展开，复制粘贴文件及文件夹，同名自动生成副本 |
| 文件排序 | 点击名称、大小、修改时间表头切换升降序，刷新后保留偏好 |
| Claude 配置 | 可选启动适配器，复用已有 CLI 和私有 provider 配置 |

## 快速部署

需要 Linux、**Node.js 22 或更高版本**、npm、curl 和 tar，并配置好需要使用的 Codex 或 Claude CLI。Codex 交互功能需要支持共享 App Server daemon 的 CLI，原部署验证版本为 0.160.0。

```bash
git clone https://github.com/ishallbeking/cloudCLI.git
cd cloudCLI

# 下载并校验固定版本的官方发布包，应用定制代码，安装运行依赖
node local-custom/scripts/prepare.mjs

# 根据需要编辑服务监听地址、端口和 CLI 路径
cp local-custom/.env.example local-custom/env.local

./local-custom/webui start
```

默认打开 **http://127.0.0.1:3001**，首次访问创建自己的网页账号。

需要从局域网电脑直接访问时，在 `local-custom/env.local` 中设置 `HOST=0.0.0.0` 或服务器内网 IP，然后访问 `http://服务器内网IP:3001`。也可以通过 SSH 隧道访问，具体见[完整部署说明](local-custom/README.md#部署)。

```bash
./local-custom/webui status
./local-custom/webui stop
./local-custom/webui restart
```

账号、历史会话、CLI 登录与 API 配置需要在部署机器上自行配置。数据库、凭据、会话记录和日志均不包含在仓库中。

## 源码与部署结构

| 目录 | 用途 |
| --- | --- |
| `local-custom/` | 本定制版的部署入口、补丁、主题、源码差异及测试 |
| `local-custom/overlay/` | 已部署版本的最终后端源码与运行文件差异 |
| `local-custom/patches/` | 可读前端补丁及历史后端增量安装器 |
| 根目录 `src/`、`server/` 等 | fork 保留的上游开发源码与工具配置 |

定制前端目前是在 **1.37.7 官方预构建资源上应用补丁**，尚未全部整合回根目录 `src/`。因此，根目录的 `npm run build` 构建上游版本；运行本定制版应使用 `local-custom` 入口。

准备脚本会校验官方安装包完整性及覆盖文件哈希，生成独立运行目录；它使用固定版本，不会自动跟随上游升级。维护和升级说明见 [local-custom/README.md](local-custom/README.md#如何复现当前版本)。

## 验证

完成准备后运行：

```bash
node local-custom/scripts/test.mjs
```

当前导出版本 **98 项回归测试通过**，并已在独立端口验证启动、页面访问、主题加载与关闭。具体测试范围和浏览器验证方式见[验证说明](local-custom/README.md#验证)。

## 上游与许可证

原项目：[siteboon/claudecodeui](https://github.com/siteboon/claudecodeui)。原版功能、开发方式及文档见 [README.upstream.md](README.upstream.md)。

本项目沿用上游 **AGPL-3.0-or-later** 许可证，详见 [LICENSE](LICENSE)。
