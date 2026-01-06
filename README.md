# Smart Tab Cleaner 🧹

Chrome 侧边栏标签管理扩展。

## 快速开始

### 1. 加载扩展

```bash
# 图标已生成，直接加载即可
```

1. 打开 `chrome://extensions/`
2. 开启 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择 `browser_tab_cleaner` 文件夹

### 2. 使用

- 点击扩展图标打开侧边栏
- 或右键图标 → "打开侧边面板"

## 功能

| 功能 | 状态 |
|------|------|
| 侧边栏标签列表 | ✅ |
| 多窗口支持 | ✅ |
| Tab Groups 显示 | ✅ |
| 搜索过滤 | ✅ |
| 拖拽排序/跨窗口移动 | ✅ |
| **多选操作** (Cmd/Shift) | ✅ |
| **创建 Tab Group** | ✅ |
| 自定义窗口名称 | ✅ |
| LLM 智能整理 | 🚧 待开发 |

## 操作指南

### 多选
- `Cmd/Ctrl + 点击` - 切换选中
- `Shift + 点击` - 范围选择
- 普通点击 - 清除选择

### 右键菜单
- 单选：常规操作 + 创建分组
- 多选：批量操作 + 创建/加入分组

## 文档

详细设计文档见 [PRODUCT_SPEC.md](./PRODUCT_SPEC.md)

## 项目结构

```
browser_tab_cleaner/
├── manifest.json
├── PRODUCT_SPEC.md        # 产品说明书
└── src/
    ├── background/
    │   └── service-worker.js
    └── sidepanel/
        ├── sidepanel.html
        ├── sidepanel.css
        └── sidepanel.js
```

## License

MIT
