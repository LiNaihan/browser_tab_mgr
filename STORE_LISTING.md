# Chrome Web Store 发布信息

> 更新此文件后，同步到 Chrome Web Store Developer Dashboard

## 基本信息

- **名称**: Tabar - Vertical Tab Manager
- **版本**: 0.2.0
- **类别**: Productivity (生产力工具)
- **语言**: English

## 简短描述 (manifest.json)

```
Manage tabs in sidebar with drag & drop, tab groups, and session saving
```

## 详细描述 (商店页面)

```
Tabar - Vertical Tab Manager

Manage all your browser tabs from a convenient sidebar. Perfect for users who work with many tabs across multiple windows.

🎯 Key Features:

📑 Vertical Tab List
• View all tabs in a clean sidebar layout
• See tabs from all windows in one place
• Quick search to find any tab instantly

🖱️ Drag & Drop
• Reorder tabs by dragging
• Move tabs between windows
• Drag tabs into groups

📁 Tab Groups
• Create and manage Chrome tab groups
• Rename groups with double-click
• Move entire groups between windows
• Collapse/expand groups

🪟 Window Management
• Custom window names (double-click to rename)
• Reorder windows in sidebar
• Collapse/expand windows
• Close entire windows or groups via right-click

💾 Session Saving
• Auto-save every 10 minutes
• Manual save & restore
• Export sessions to JSON file
• Never lose your tabs again

⌨️ Keyboard Shortcut
• Alt+A (Option+A on Mac) to open sidebar

🎨 Clean Design
• Dark theme
• Minimal and intuitive UI
• Favicon display for each tab

Perfect for researchers, developers, and anyone who juggles many tabs!
```

## 权限说明 (隐私权规范)

### 单一用途
```
This extension manages browser tabs in a sidebar panel. It allows users to view, organize, drag-and-drop, group, and save/restore tabs across multiple windows.
```

### tabs
```
Required to list all open tabs, move tabs between windows, close tabs, and display tab information (title, favicon, URL) in the sidebar.
```

### tabGroups
```
Required to read and manage Chrome tab groups, allowing users to create, rename, move, and organize tab groups from the sidebar.
```

### storage
```
Used to save user preferences including custom window names, window order, collapsed states, and session snapshots for restoration.
```

### sidePanel
```
Required to display the vertical tab manager in Chrome's sidebar panel, which is the core UI of this extension.
```

### alarms
```
Used to automatically save tab sessions every 10 minutes, ensuring users don't lose their work if the browser crashes.
```

### 远程代码
```
This extension does not use any remote code. All code is bundled locally within the extension package.
```

## 隐私权政策

- **网址**: https://linaihan.github.io/browser_tab_mgr/privacy.html
- **文件**: docs/privacy.html

## 图片资源

### 图标
- 128x128: `icons/icon128.png`
- 48x48: `icons/icon48.png`
- 16x16: `icons/icon16.png`

### 截图 (1280x800)
- 存放于发布时的 Desktop/screenshots/ 文件夹
- 需要展示：侧边栏全貌、Tab Groups、拖拽操作、右键菜单

## 版本历史

### v0.2.0 (2026-01-11)
- 首次发布到 Chrome Web Store
- 核心功能：垂直标签列表、拖拽、Tab Groups、会话保存

### 待开发功能
- AI 智能分组
- 树形标签结构
- 云同步
- 书签管理集成

