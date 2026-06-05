# Claude Code Studio Next

Claude Code Studio Next 是一个基于 Tauri 的跨平台桌面工作台，用于管理 Claude Code 的 Provider、模型预设、身份、Skills、MCP 服务、项目历史、诊断信息和任务运行器。它面向高频使用 Claude Code 的用户，重点解决体验混乱、进程残留、内存占用和发布交付不清晰的问题。

## 解决的问题

Claude Code 很强，但长期使用时会出现一些实际负担：Provider 配置分散、Skills 和身份难管理、MCP 服务状态不直观、项目历史难查、诊断信息不集中，以及任务结束后 Claude Code 或 Node 进程仍然残留。

这个项目把这些能力整理到一个桌面应用里。界面保持克制和稳定，底层使用 Tauri 控制窗口和系统能力，Node 后端负责数据、索引、诊断和任务编排。Claude Code 默认只在任务运行时启动，任务结束后会进行清理，减少无意义的内存占用。

## 核心功能

- Provider 与模型预设管理。
- 基于身份的 Skills 组织和同步。
- MCP 服务管理。
- Claude Code 项目和对话导航。
- 以低内存为目标的 Claude Code 任务运行器。
- 带缓存的使用统计，避免反复扫描 JSONL。
- 诊断导出，包含路径、版本、进程、数量和近期错误。
- 修改 Claude 设置或 Skills 前自动备份。
- Tauri 桌面打包，Node 后端隐藏运行，不显示命令行窗口。

## 平台支持

项目面向 Windows、macOS 和 Linux。当前本地已验证 Windows x64 成品。GitHub Actions 会在对应架构 runner 上构建 Windows x64、Windows ARM64、macOS Intel、macOS Apple Silicon、Linux x64 和 Linux ARM64 成品。

## 安装

普通用户应从 GitHub Releases 下载成品。Windows 用户可以选择安装包或便携版 zip；macOS 用户使用 DMG；Linux 用户使用 AppImage 或 Debian 包。

打包版本会包含桌面后端运行时。Claude Code 如果没有安装，应用会显示安装引导；系统 Node.js/npm 仍可用于安装或更新 Claude Code。

## 开发

```powershell
npm install
npm run dev
```

验证：

```powershell
npm run check
npm test
cargo check --manifest-path src-tauri\Cargo.toml
```

## 发布

生成的 exe、安装包、zip、DMG、AppImage 和 Debian 包不提交到 Git 仓库，而是上传到 GitHub Releases。推送 `v*` 标签时，GitHub Actions 会自动构建跨平台成品。本地 Windows 维护者也可以运行 `npm run build`、`npm run build:exe` 和 `npm run build:portable`。

## 当前状态

`1.0.0` 已整理为可以发布到 GitHub 的正式版本。打包版本会包含后端运行时。代码签名和自动更新还没有启用。
