/**
 * Side Panel - 标签管理器主界面
 */

// State
let allTabs = [];
let allGroups = [];
let windowNames = {}; // 自定义窗口名称
let windowOrder = []; // 窗口排序顺序
let collapsedWindows = new Set(); // 折叠的窗口 ID
let collapsedGroups = new Set(); // 折叠的分组 ID
let searchQuery = '';
let draggedTab = null;
let draggedWindow = null; // 拖拽中的窗口
let draggedGroup = null; // 拖拽中的分组
let dragOverElement = null;
let windowsExpandedBeforeDrag = new Set(); // 拖拽窗口前展开的窗口
let selectedTabIds = new Set(); // 多选的标签 ID
let lastSelectedTabId = null;  // 上次选中的标签（用于 Shift 范围选择）

// DOM Elements
const elements = {
  searchInput: document.getElementById('searchInput'),
  tabList: document.getElementById('tabList'),
  tabStats: document.getElementById('tabStats'),
  collapseAllBtn: document.getElementById('collapseAllBtn'),
  collapseWindowsBtn: document.getElementById('collapseWindowsBtn'),
  sessionsBtn: document.getElementById('sessionsBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  syncSidebarBtn: document.getElementById('syncSidebarBtn'),
};

// ============ 统一 Move 操作 ============
// 
// 有效操作矩阵 (拖拽):
// | 源 \ 目标    | Tab      | Group      | Window     |
// |-------------|----------|------------|------------|
// | Tab(s)      | 插入位置  | ✅ 加入分组 | ✅ 移动     |
// | Group       | ❌       | ✅ 排序     | ✅ 移动     |
// | Window      | ❌       | ❌         | ✅ 排序     |
//
// 右键菜单额外支持: Tab(s) → New Group, Tab(s) → New Window, Group → New Window

const MoveOperations = {
  /**
   * Tab(s) → 已有 Group：加入分组
   * @param {number[]} tabIds - 要移动的 tab ID 数组
   * @param {number} targetGroupId - 目标分组 ID
   */
  async tabsToGroup(tabIds, targetGroupId) {
    if (!tabIds.length || !targetGroupId) return;
    
    // 获取目标 group 所在的 window
    const targetTab = allTabs.find(t => t.groupId === targetGroupId);
    if (!targetTab) {
      console.error('Target group not found');
      return;
    }
    
    try {
      // 先移动到目标窗口
      await chrome.tabs.move(tabIds, { windowId: targetTab.windowId, index: -1 });
      // 再加入分组
      await chrome.tabs.group({ tabIds, groupId: targetGroupId });
    } catch (err) {
      console.error('tabsToGroup failed:', err);
    }
  },

  /**
   * Tab(s) → Window：移动到窗口（不分组）
   * @param {number[]} tabIds - 要移动的 tab ID 数组
   * @param {number} targetWindowId - 目标窗口 ID
   */
  async tabsToWindow(tabIds, targetWindowId) {
    if (!tabIds.length || !targetWindowId) return;
    
    try {
      await chrome.tabs.move(tabIds, { windowId: targetWindowId, index: -1 });
    } catch (err) {
      console.error('tabsToWindow failed:', err);
    }
  },

  /**
   * Tab(s) → New Group：创建新分组
   * @param {number[]} tabIds - 要移动的 tab ID 数组
   * @param {number} windowId - 在哪个窗口创建分组
   * @param {string} [title] - 可选的分组名称
   */
  async tabsToNewGroup(tabIds, windowId, title = '') {
    if (!tabIds.length) return;
    
    try {
      // 先确保 tabs 在目标窗口
      const firstTab = allTabs.find(t => t.id === tabIds[0]);
      if (firstTab && firstTab.windowId !== windowId) {
        await chrome.tabs.move(tabIds, { windowId, index: -1 });
      }
      
      // 创建新分组
      const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
      
      // 设置分组名称（如果提供）
      if (title) {
        await chrome.tabGroups.update(groupId, { title });
      }
      
      return groupId;
    } catch (err) {
      console.error('tabsToNewGroup failed:', err);
    }
  },

  /**
   * Tab(s) → New Window：移动到新窗口
   * @param {number[]} tabIds - 要移动的 tab ID 数组
   */
  async tabsToNewWindow(tabIds) {
    if (!tabIds.length) return;
    
    try {
      // 用第一个 tab 创建新窗口
      const newWindow = await chrome.windows.create({ tabId: tabIds[0] });
      
      // 移动剩余 tabs
      if (tabIds.length > 1) {
        await chrome.tabs.move(tabIds.slice(1), { windowId: newWindow.id, index: -1 });
      }
      
      return newWindow.id;
    } catch (err) {
      console.error('tabsToNewWindow failed:', err);
    }
  },

  /**
   * Group → Group：排序（移动到目标 group 位置）
   * @param {number} sourceGroupId - 源分组 ID
   * @param {number} targetGroupId - 目标分组 ID（移动到此位置之前）
   */
  async groupToGroup(sourceGroupId, targetGroupId) {
    if (!sourceGroupId || !targetGroupId || sourceGroupId === targetGroupId) return;
    
    // 获取源分组和目标分组的信息
    const sourceTabs = allTabs.filter(t => t.groupId === sourceGroupId);
    const targetTabs = allTabs.filter(t => t.groupId === targetGroupId);
    
    if (!sourceTabs.length || !targetTabs.length) return;
    
    // 找到目标分组第一个 tab 的位置
    const targetIndex = Math.min(...targetTabs.map(t => t.index));
    const tabIds = sourceTabs.map(t => t.id);
    const targetWindowId = targetTabs[0].windowId;
    const sourceGroup = allGroups.find(g => g.id === sourceGroupId);
    
    try {
      // 移动到目标位置
      await chrome.tabs.move(tabIds, { windowId: targetWindowId, index: targetIndex });
      
      // 无论同窗口还是跨窗口，都需要重新创建分组（因为 move 会打散分组）
      const newGroupId = await chrome.tabs.group({ tabIds, createProperties: { windowId: targetWindowId } });
      if (sourceGroup) {
        await chrome.tabGroups.update(newGroupId, { title: sourceGroup.title || '', color: sourceGroup.color });
      }
    } catch (err) {
      console.error('groupToGroup failed:', err);
    }
  },

  /**
   * Group → Window：移动整个分组到窗口（保持分组属性）
   * @param {number} sourceGroupId - 源分组 ID
   * @param {number} targetWindowId - 目标窗口 ID
   */
  async groupToWindow(sourceGroupId, targetWindowId) {
    if (!sourceGroupId || !targetWindowId) return;
    
    // 获取源分组信息
    const sourceGroup = allGroups.find(g => g.id === sourceGroupId);
    const sourceTabs = allTabs.filter(t => t.groupId === sourceGroupId);
    
    if (!sourceTabs.length) return;
    
    const tabIds = sourceTabs.map(t => t.id);
    const sourceWindowId = sourceTabs[0].windowId;
    
    try {
      // 如果已在目标窗口，无需移动
      if (sourceWindowId === targetWindowId) return;
      
      // 移动 tabs 到目标窗口
      await chrome.tabs.move(tabIds, { windowId: targetWindowId, index: -1 });
      
      // 在新窗口创建分组（保持原属性）
      const newGroupId = await chrome.tabs.group({ 
        tabIds, 
        createProperties: { windowId: targetWindowId } 
      });
      
      // 恢复分组属性
      if (sourceGroup) {
        await chrome.tabGroups.update(newGroupId, {
          title: sourceGroup.title || '',
          color: sourceGroup.color
        });
      }
    } catch (err) {
      console.error('groupToWindow failed:', err);
    }
  },

  /**
   * Group → New Window：移动分组到新窗口（保持分组属性）
   * @param {number} sourceGroupId - 源分组 ID
   */
  async groupToNewWindow(sourceGroupId) {
    if (!sourceGroupId) return;
    
    // 获取源分组信息
    const sourceGroup = allGroups.find(g => g.id === sourceGroupId);
    const sourceTabs = allTabs.filter(t => t.groupId === sourceGroupId);
    
    if (!sourceTabs.length) return;
    
    const tabIds = sourceTabs.map(t => t.id);
    
    try {
      // 用第一个 tab 创建新窗口
      const newWindow = await chrome.windows.create({ tabId: tabIds[0] });
      
      // 移动剩余 tabs
      if (tabIds.length > 1) {
        await chrome.tabs.move(tabIds.slice(1), { windowId: newWindow.id, index: -1 });
      }
      
      // 创建分组（保持原属性）
      const newGroupId = await chrome.tabs.group({ 
        tabIds, 
        createProperties: { windowId: newWindow.id } 
      });
      
      // 恢复分组属性
      if (sourceGroup) {
        await chrome.tabGroups.update(newGroupId, {
          title: sourceGroup.title || '',
          color: sourceGroup.color
        });
      }
      
      return newWindow.id;
    } catch (err) {
      console.error('groupToNewWindow failed:', err);
    }
  }
};

// ============ 初始化 ============

async function init() {
  await loadWindowNames();
  await loadTabs();
  bindEvents();
  listenToTabChanges();
  setupScrollSync();
  setupSidebarSync();
  // 自动保存已移至 Service Worker，使用 Chrome Alarms API
}

// ============ 侧边栏同步 ============

// ============ 侧边栏同步 ============

let sidebarPort = null;

// 图标 SVG
const iconOpen = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
  <path d="M1 4h6v4H1zM9 4h6v4H9zM1 9h6v4H1zM9 9h6v4H9z"/>
</svg>`;
const iconClose = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
  <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="2" fill="none"/>
</svg>`;

// 更新按钮图标
function updateSyncButtonIcon(allConnected) {
  if (allConnected) {
    elements.syncSidebarBtn.innerHTML = iconClose;
    elements.syncSidebarBtn.title = 'Close all sidebars';
  } else {
    elements.syncSidebarBtn.innerHTML = iconOpen;
    elements.syncSidebarBtn.title = 'Open all sidebars';
  }
}

function connectToBackground() {
  // 连接到 background
  sidebarPort = chrome.runtime.connect({ name: 'sidepanel' });
  
  chrome.windows.getCurrent().then(win => {
    if (sidebarPort) {
      sidebarPort.postMessage({ type: 'register', windowId: win.id });
    }
  });
  
  // 监听来自 background 的消息
  sidebarPort.onMessage.addListener(async (msg) => {
    if (msg.type === 'close') {
      window.close();
      return;
    }
    
    if (msg.type === 'connectedCount') {
      const { connected, total } = msg;
      console.log(`[Sidebar Sync] Connected: ${connected}/${total}`);
      
      const allConnected = connected >= total;
      updateSyncButtonIcon(allConnected);
      
      if (allConnected) {
        // 所有窗口都已连接，关闭所有
        sidebarPort.postMessage({ type: 'closeAllSidebars' });
      } else {
        // 还有窗口未连接，打开它们
        const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
        const currentWindow = await chrome.windows.getCurrent();
        
        for (const win of windows) {
          if (win.id !== currentWindow.id) {
            try {
              await chrome.sidePanel.open({ windowId: win.id });
            } catch (err) {
              console.log(`Could not open window ${win.id}:`, err.message);
            }
          }
        }
        // 打开后只更新图标（不执行操作）
        setTimeout(() => {
          if (sidebarPort) {
            sidebarPort.postMessage({ type: 'getConnectedCountOnly' });
          }
        }, 500);
      }
    }
    
    // 仅更新图标状态（不执行操作）
    if (msg.type === 'connectedCountUpdate') {
      const { connected, total } = msg;
      updateSyncButtonIcon(connected >= total);
    }
  });
  
  // 初始化时查询状态以设置正确图标
  setTimeout(() => {
    if (sidebarPort) {
      sidebarPort.postMessage({ type: 'getConnectedCountOnly' });
    }
  }, 300);
  
  sidebarPort.onDisconnect.addListener(() => {
    console.log('[Sidebar Sync] Disconnected, will reconnect...');
    sidebarPort = null;
    // 1秒后尝试重连
    setTimeout(() => {
      connectToBackground();
    }, 1000);
  });
}

function setupSidebarSync() {
  connectToBackground();
  
  // 同步打开/关闭按钮（toggle：点击切换所有窗口侧边栏状态）
  elements.syncSidebarBtn.addEventListener('click', async () => {
    // 确保连接存在
    if (!sidebarPort) {
      connectToBackground();
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    if (sidebarPort) {
      // 查询当前连接状态
      sidebarPort.postMessage({ type: 'getConnectedCount' });
    }
  });
}

// ============ 窗口名称管理 ============

async function loadWindowNames() {
  try {
    const result = await chrome.storage.local.get([
      'windowNames', 
      'windowOrder', 
      'collapsedWindows', 
      'collapsedGroups'
    ]);
    windowNames = result.windowNames || {};
    windowOrder = result.windowOrder || [];
    collapsedWindows = new Set(result.collapsedWindows || []);
    collapsedGroups = new Set(result.collapsedGroups || []);
  } catch (error) {
    console.error('Failed to load window names:', error);
    windowNames = {};
    windowOrder = [];
    collapsedWindows = new Set();
    collapsedGroups = new Set();
  }
}

// 保存折叠状态
async function saveCollapsedState() {
  try {
    await chrome.storage.local.set({
      collapsedWindows: Array.from(collapsedWindows),
      collapsedGroups: Array.from(collapsedGroups)
    });
  } catch (error) {
    console.error('Failed to save collapsed state:', error);
  }
}

async function saveWindowOrder(order) {
  windowOrder = order;
  await chrome.storage.local.set({ windowOrder });
}

async function saveWindowName(windowId, name) {
  windowNames[windowId] = name;
  await chrome.storage.local.set({ windowNames });
}

// ============ 数据加载 ============

async function loadTabs() {
  try {
    // 获取所有标签
    allTabs = await chrome.tabs.query({});
    // 获取所有标签组
    allGroups = await chrome.tabGroups.query({});
    
    renderTabList();
    updateStats();
  } catch (error) {
    console.error('Failed to load tabs:', error);
  }
}

// ============ 渲染 ============

function renderTabList() {
  const filteredTabs = filterTabs(allTabs, searchQuery);
  
  if (filteredTabs.length === 0) {
    elements.tabList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <div>${searchQuery ? 'No tabs match your search' : 'No tabs open'}</div>
      </div>
    `;
    return;
  }
  
  // 按窗口分组
  const tabsByWindow = groupTabsByWindow(filteredTabs);
  
  // 按保存的顺序排序窗口
  const sortedWindows = sortWindowsByOrder(tabsByWindow);
  
  let html = '';
  for (const [windowId, windowTabs] of sortedWindows) {
    html += renderWindowSection(windowId, windowTabs);
  }
  
  elements.tabList.innerHTML = html;
  
  // 绑定拖拽事件
  bindDragEvents();
  
  // 绑定 favicon 错误处理
  bindFaviconErrorHandlers();
}

function bindFaviconErrorHandlers() {
  document.querySelectorAll('.tab-favicon').forEach(img => {
    if (img.tagName === 'IMG') {
      img.addEventListener('error', () => {
        // 替换为占位符
        const placeholder = document.createElement('div');
        placeholder.className = 'tab-favicon placeholder';
        placeholder.textContent = '🌐';
        img.replaceWith(placeholder);
      }, { once: true });
    }
  });
}

function renderWindowSection(windowId, tabs) {
  const isCurrentWindow = tabs.some(t => t.active);
  const defaultLabel = isCurrentWindow ? 'Current Window' : `Window ${windowId}`;
  const windowLabel = windowNames[windowId] || defaultLabel;
  const isCollapsed = collapsedWindows.has(windowId);
  
  // 按组和未分组整理标签
  const { groups, ungrouped } = organizeTabsByGroup(tabs);
  
  let html = `
    <div class="window-section${isCollapsed ? ' collapsed' : ''}" data-window-id="${windowId}">
      <div class="window-header" data-window-id="${windowId}" draggable="true">
        <span class="window-drag-handle" title="Drag to reorder">⋮⋮</span>
        <span class="window-collapse-icon">${isCollapsed ? '▶' : '▼'}</span>
        <span class="window-name" title="Double-click to rename">${escapeHtml(windowLabel)}</span>
        <span class="tab-count">${tabs.length} tabs</span>
      </div>
      <div class="window-tabs">
  `;
  
  // 渲染分组的标签
  for (const group of groups) {
    html += renderTabGroup(group);
  }
  
  // 渲染未分组的标签
  for (const tab of ungrouped) {
    html += renderTabItem(tab);
  }
  
  html += `
      </div>
    </div>
  `;
  
  return html;
}

function renderTabGroup(group) {
  const groupInfo = allGroups.find(g => g.id === group.id);
  const color = groupInfo?.color || 'grey';
  const title = groupInfo?.title || 'Unnamed Group';
  const isCollapsed = collapsedGroups.has(group.id);
  
  let html = `
    <div class="tab-group${isCollapsed ? ' collapsed' : ''}" data-group-id="${group.id}" data-color="${color}">
      <div class="group-header">
        <svg class="collapse-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M4 6l4 4 4-4"/>
        </svg>
        <span class="group-title">${escapeHtml(title)}</span>
        <span class="group-count">${group.tabs.length}</span>
      </div>
      <div class="group-tabs">
  `;
  
  for (const tab of group.tabs) {
    html += renderTabItem(tab);
  }
  
  html += `
      </div>
    </div>
  `;
  
  return html;
}

function renderTabItem(tab) {
  const favicon = tab.favIconUrl 
    ? `<img class="tab-favicon" src="${escapeHtml(tab.favIconUrl)}" alt="">`
    : `<div class="tab-favicon placeholder">🌐</div>`;
  
  const activeClass = tab.active ? 'active' : '';
  const pinnedClass = tab.pinned ? 'pinned' : '';
  const selectedClass = selectedTabIds.has(tab.id) ? 'selected' : '';
  
  return `
    <div class="tab-item ${activeClass} ${pinnedClass} ${selectedClass}" 
         data-tab-id="${tab.id}" 
         data-window-id="${tab.windowId}"
         data-index="${tab.index}"
         draggable="true">
      ${favicon}
      <span class="tab-title" title="${escapeHtml(tab.title)}">${escapeHtml(tab.title || 'New Tab')}</span>
      <button class="tab-close" data-tab-id="${tab.id}" title="Close tab">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <path d="M9.5 2.5l-7 7M2.5 2.5l7 7" stroke="currentColor" stroke-width="1.5" fill="none"/>
        </svg>
      </button>
    </div>
  `;
}

function updateStats() {
  const tabCount = allTabs.length;
  const windowCount = new Set(allTabs.map(t => t.windowId)).size;
  elements.tabStats.textContent = `${tabCount} tabs in ${windowCount} window${windowCount !== 1 ? 's' : ''}`;
}

// ============ 数据处理 ============

function filterTabs(tabs, query) {
  if (!query) return tabs;
  
  const lowerQuery = query.toLowerCase();
  return tabs.filter(tab => 
    tab.title?.toLowerCase().includes(lowerQuery) ||
    tab.url?.toLowerCase().includes(lowerQuery)
  );
}

function groupTabsByWindow(tabs) {
  const map = new Map();
  
  for (const tab of tabs) {
    if (!map.has(tab.windowId)) {
      map.set(tab.windowId, []);
    }
    map.get(tab.windowId).push(tab);
  }
  
  // 按 index 排序
  for (const [, windowTabs] of map) {
    windowTabs.sort((a, b) => a.index - b.index);
  }
  
  return map;
}

function sortWindowsByOrder(tabsByWindow) {
  const windowIds = Array.from(tabsByWindow.keys());
  
  // 如果没有保存的顺序，按原顺序返回
  if (!windowOrder || windowOrder.length === 0) {
    return tabsByWindow;
  }
  
  // 按保存的顺序排序
  windowIds.sort((a, b) => {
    const indexA = windowOrder.indexOf(a);
    const indexB = windowOrder.indexOf(b);
    
    // 如果窗口不在保存的顺序中，放到最后
    if (indexA === -1 && indexB === -1) return 0;
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    
    return indexA - indexB;
  });
  
  // 重新构建有序的 Map
  const sortedMap = new Map();
  for (const windowId of windowIds) {
    sortedMap.set(windowId, tabsByWindow.get(windowId));
  }
  
  return sortedMap;
}

function organizeTabsByGroup(tabs) {
  const groups = new Map();
  const ungrouped = [];
  
  for (const tab of tabs) {
    if (tab.groupId && tab.groupId !== -1) {
      if (!groups.has(tab.groupId)) {
        groups.set(tab.groupId, { id: tab.groupId, tabs: [] });
      }
      groups.get(tab.groupId).tabs.push(tab);
    } else {
      ungrouped.push(tab);
    }
  }
  
  return {
    groups: Array.from(groups.values()),
    ungrouped,
  };
}

// ============ 事件绑定 ============

function bindEvents() {
  // 搜索
  elements.searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderTabList();
  });
  
  // 折叠所有组
  elements.collapseAllBtn.addEventListener('click', () => {
    const groups = document.querySelectorAll('.tab-group');
    // 检查是否有任何展开的组
    const anyExpanded = Array.from(groups).some(g => !g.classList.contains('collapsed'));
    
    groups.forEach(group => {
      const groupId = parseInt(group.dataset.groupId);
      
      if (anyExpanded) {
        group.classList.add('collapsed');
        collapsedGroups.add(groupId);
      } else {
        group.classList.remove('collapsed');
        collapsedGroups.delete(groupId);
      }
    });
    saveCollapsedState();
  });
  
  // 折叠/展开所有窗口
  elements.collapseWindowsBtn.addEventListener('click', () => {
    const windowSections = document.querySelectorAll('.window-section');
    // 基于实际 DOM 状态判断是否有展开的窗口
    const anyExpanded = Array.from(windowSections).some(s => !s.classList.contains('collapsed'));
    
    windowSections.forEach(section => {
      const windowId = parseInt(section.dataset.windowId);
      const collapseIcon = section.querySelector('.window-collapse-icon');
      
      if (anyExpanded) {
        // 折叠所有
        section.classList.add('collapsed');
        collapsedWindows.add(windowId);
        if (collapseIcon) collapseIcon.textContent = '▶';
      } else {
        // 展开所有
        section.classList.remove('collapsed');
        collapsedWindows.delete(windowId);
        if (collapseIcon) collapseIcon.textContent = '▼';
      }
    });
    saveCollapsedState();
  });
  
  // 会话管理
  elements.sessionsBtn.addEventListener('click', showSessionsPanel);
  
  // 设置
  elements.settingsBtn.addEventListener('click', showSettingsPanel);
  
  // 标签列表点击事件（事件委托）
  elements.tabList.addEventListener('click', handleTabListClick);
  
  // 双击窗口名编辑
  elements.tabList.addEventListener('dblclick', handleWindowNameEdit);
  
  // 双击分组名编辑
  elements.tabList.addEventListener('dblclick', handleGroupNameEdit);
  
  // 右键菜单
  elements.tabList.addEventListener('contextmenu', handleContextMenu);
}

// ============ 窗口名编辑 ============

function handleWindowNameEdit(e) {
  const windowName = e.target.closest('.window-name');
  if (!windowName) return;
  
  const windowHeader = windowName.closest('.window-header');
  const windowId = parseInt(windowHeader.dataset.windowId);
  
  // 已经在编辑中
  if (windowName.querySelector('input')) return;
  
  const currentName = windowName.textContent;
  
  // 创建输入框
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'window-name-input';
  input.value = currentName;
  
  // 替换文字为输入框
  windowName.textContent = '';
  windowName.appendChild(input);
  input.focus();
  input.select();
  
  // 保存函数
  const saveName = async () => {
    const newName = input.value.trim();
    if (newName && newName !== currentName) {
      await saveWindowName(windowId, newName);
    }
    // 重新渲染
    renderTabList();
  };
  
  // 回车保存
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveName();
    } else if (e.key === 'Escape') {
      renderTabList(); // 取消编辑
    }
  });
  
  // 失焦保存
  input.addEventListener('blur', saveName);
}

// ============ 分组名编辑 ============

function handleGroupNameEdit(e) {
  const groupTitle = e.target.closest('.group-title');
  if (!groupTitle) return;
  
  const groupHeader = groupTitle.closest('.group-header');
  const tabGroup = groupHeader.closest('.tab-group');
  const groupId = parseInt(tabGroup.dataset.groupId);
  
  // 已经在编辑中
  if (groupTitle.querySelector('input')) return;
  
  const currentName = groupTitle.textContent || '';
  
  // 创建输入框
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'group-name-input';
  input.value = currentName;
  input.placeholder = 'Group name';
  
  // 替换文字为输入框
  groupTitle.textContent = '';
  groupTitle.appendChild(input);
  input.focus();
  input.select();
  
  // 阻止事件冒泡（避免触发折叠）
  input.addEventListener('click', (e) => e.stopPropagation());
  
  // 保存函数
  const saveName = async () => {
    const newName = input.value.trim();
    try {
      await chrome.tabGroups.update(groupId, { title: newName });
    } catch (err) {
      console.error('Failed to update group name:', err);
    }
    // 重新渲染
    renderTabList();
  };
  
  // 回车保存
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveName();
    } else if (e.key === 'Escape') {
      renderTabList(); // 取消编辑
    }
  });
  
  // 失焦保存
  input.addEventListener('blur', saveName);
  
  // 阻止双击事件继续冒泡
  e.stopPropagation();
}

function handleTabListClick(e) {
  // 有选中状态 + 不按 Cmd/Shift = 清除选择（类似遮罩效果）
  if (selectedTabIds.size > 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
    // 但关闭按钮仍然生效
    const closeBtn = e.target.closest('.tab-close');
    if (closeBtn) {
      e.stopPropagation();
      const tabId = parseInt(closeBtn.dataset.tabId);
      chrome.tabs.remove(tabId);
      selectedTabIds.delete(tabId);
      renderTabList();
      return;
    }
    
    // 其他任何点击都只清除选择
    selectedTabIds.clear();
    lastSelectedTabId = null;
    renderTabList();
    return;
  }
  
  // 关闭按钮
  const closeBtn = e.target.closest('.tab-close');
  if (closeBtn) {
    e.stopPropagation();
    const tabId = parseInt(closeBtn.dataset.tabId);
    chrome.tabs.remove(tabId);
    selectedTabIds.delete(tabId);
    return;
  }
  
  // 点击标签
  const tabItem = e.target.closest('.tab-item');
  if (tabItem) {
    const tabId = parseInt(tabItem.dataset.tabId);
    const windowId = parseInt(tabItem.dataset.windowId);
    
    // Cmd/Ctrl + 点击：切换选中状态
    if (e.metaKey || e.ctrlKey) {
      if (selectedTabIds.has(tabId)) {
        selectedTabIds.delete(tabId);
      } else {
        selectedTabIds.add(tabId);
      }
      lastSelectedTabId = tabId;
      renderTabList();
      return;
    }
    
    // Shift + 点击：范围选择
    if (e.shiftKey && lastSelectedTabId !== null) {
      const windowTabs = allTabs.filter(t => t.windowId === windowId).sort((a, b) => a.index - b.index);
      const lastTab = allTabs.find(t => t.id === lastSelectedTabId);
      
      if (lastTab && lastTab.windowId === windowId) {
        const currentIndex = windowTabs.findIndex(t => t.id === tabId);
        const lastIndex = windowTabs.findIndex(t => t.id === lastSelectedTabId);
        
        const startIndex = Math.min(currentIndex, lastIndex);
        const endIndex = Math.max(currentIndex, lastIndex);
        
        // 选中范围内的所有标签
        for (let i = startIndex; i <= endIndex; i++) {
          selectedTabIds.add(windowTabs[i].id);
        }
        renderTabList();
        return;
      }
    }
    
    // 普通点击（无选中状态）- 激活标签
    lastSelectedTabId = tabId;
    chrome.tabs.update(tabId, { active: true });
    chrome.windows.update(windowId, { focused: true });
    return;
  }
  
  // 点击窗口头 - 折叠/展开（但不是双击编辑名称时）
  const windowHeader = e.target.closest('.window-header');
  if (windowHeader && !e.target.closest('.window-name')) {
    const windowSection = windowHeader.closest('.window-section');
    const windowId = parseInt(windowSection.dataset.windowId);
    const collapseIcon = windowSection.querySelector('.window-collapse-icon');
    
    if (collapsedWindows.has(windowId)) {
      collapsedWindows.delete(windowId);
      windowSection.classList.remove('collapsed');
      if (collapseIcon) collapseIcon.textContent = '▼';
    } else {
      collapsedWindows.add(windowId);
      windowSection.classList.add('collapsed');
      if (collapseIcon) collapseIcon.textContent = '▶';
    }
    saveCollapsedState();
    return;
  }
  
  // 点击组头 - 折叠/展开
  const groupHeader = e.target.closest('.group-header');
  if (groupHeader && !e.target.closest('.group-title')) {
    const group = groupHeader.closest('.tab-group');
    const groupId = parseInt(group.dataset.groupId);
    
    if (collapsedGroups.has(groupId)) {
      collapsedGroups.delete(groupId);
      group.classList.remove('collapsed');
    } else {
      collapsedGroups.add(groupId);
      group.classList.add('collapsed');
    }
    saveCollapsedState();
    return;
  }
}

function handleContextMenu(e) {
  e.preventDefault();
  
  // 右键窗口标题
  const windowHeader = e.target.closest('.window-header');
  if (windowHeader) {
    const windowSection = windowHeader.closest('.window-section');
    const windowId = parseInt(windowSection.dataset.windowId);
    showWindowContextMenu(e.clientX, e.clientY, windowId);
    return;
  }
  
  // 右键分组标题
  const groupHeader = e.target.closest('.group-header');
  if (groupHeader) {
    const groupElement = groupHeader.closest('.tab-group');
    const groupId = parseInt(groupElement.dataset.groupId);
    const windowId = parseInt(groupElement.closest('.window-section').dataset.windowId);
    showGroupContextMenu(e.clientX, e.clientY, groupId, windowId);
    return;
  }
  
  // 右键标签
  const tabItem = e.target.closest('.tab-item');
  if (!tabItem) return;
  
  const tabId = parseInt(tabItem.dataset.tabId);
  const tab = allTabs.find(t => t.id === tabId);
  if (!tab) return;
  
  // 如果右键的标签不在选中列表中，清除选择并只选中当前标签
  if (!selectedTabIds.has(tabId)) {
    selectedTabIds.clear();
    selectedTabIds.add(tabId);
    renderTabList();
  }
  
  showContextMenu(e.clientX, e.clientY, tab);
}

// ============ 拖拽功能 ============

function bindDragEvents() {
  const tabItems = document.querySelectorAll('.tab-item');
  
  tabItems.forEach(item => {
    item.addEventListener('dragstart', handleDragStart);
    item.addEventListener('dragend', handleDragEnd);
    item.addEventListener('dragover', handleDragOver);
    item.addEventListener('dragleave', handleDragLeave);
    item.addEventListener('drop', handleDrop);
  });
  
  // 也允许拖放到窗口区域
  const windowSections = document.querySelectorAll('.window-tabs');
  windowSections.forEach(section => {
    section.addEventListener('dragover', handleDragOver);
    section.addEventListener('drop', handleDrop);
  });
  
  // Group 拖拽
  const groupHeaders = document.querySelectorAll('.group-header');
  groupHeaders.forEach(header => {
    header.setAttribute('draggable', 'true');
    header.addEventListener('dragstart', handleGroupDragStart);
    header.addEventListener('dragend', handleGroupDragEnd);
    header.addEventListener('dragover', handleDragOver);
    header.addEventListener('dragleave', handleDragLeave);
    header.addEventListener('drop', handleDrop);
  });
  
  // Tab Group 区域也接收拖放
  const tabGroups = document.querySelectorAll('.tab-group');
  tabGroups.forEach(group => {
    group.addEventListener('dragover', handleDragOver);
    group.addEventListener('drop', handleDrop);
  });
  
  // 窗口标题栏拖拽排序 + 接收 tab 拖放
  const windowHeaders = document.querySelectorAll('.window-header');
  windowHeaders.forEach(header => {
    header.addEventListener('dragstart', handleWindowDragStart);
    header.addEventListener('dragend', handleWindowDragEnd);
    header.addEventListener('dragover', (e) => {
      // 同时处理窗口拖拽和 tab 拖放
      if (draggedWindow) {
        handleWindowDragOver(e);
      } else if (draggedTab) {
        handleDragOver(e);
      }
    });
    header.addEventListener('dragleave', (e) => {
      if (draggedWindow) {
        handleWindowDragLeave(e);
      } else if (draggedTab) {
        handleDragLeave(e);
      }
    });
    header.addEventListener('drop', (e) => {
      if (draggedWindow) {
        handleWindowDrop(e);
      } else if (draggedTab) {
        handleDrop(e);
      }
    });
  });
}

function handleDragStart(e) {
  draggedTab = {
    id: parseInt(e.target.dataset.tabId),
    windowId: parseInt(e.target.dataset.windowId),
  };
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', draggedTab.id.toString());
}

function handleDragEnd(e) {
  e.target.classList.remove('dragging');
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  draggedTab = null;
  dragOverElement = null;
}

// ============ Group 拖拽 ============

function handleGroupDragStart(e) {
  const header = e.target.closest('.group-header');
  if (!header) return;
  
  const tabGroup = header.closest('.tab-group');
  const groupId = parseInt(tabGroup.dataset.groupId);
  const windowId = parseInt(tabGroup.closest('.window-section').dataset.windowId);
  
  draggedGroup = { id: groupId, windowId };
  tabGroup.classList.add('group-dragging');
  
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', `group:${groupId}`);
  e.stopPropagation();
}

function handleGroupDragEnd(e) {
  if (!draggedGroup) return;
  
  document.querySelectorAll('.group-dragging').forEach(el => el.classList.remove('group-dragging'));
  document.querySelectorAll('.group-drop-target').forEach(el => el.classList.remove('group-drop-target'));
  draggedGroup = null;
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  
  // 清除之前的高亮
  document.querySelectorAll('.drag-over, .window-drop-target, .group-drop-target').forEach(el => {
    el.classList.remove('drag-over', 'window-drop-target', 'group-drop-target');
  });
  
  const tabItem = e.target.closest('.tab-item');
  const groupHeader = e.target.closest('.group-header');
  const tabGroup = e.target.closest('.tab-group');
  const windowSection = e.target.closest('.window-section');
  
  if (groupHeader || (tabGroup && !tabItem)) {
    // 高亮 group（拖 tab 或 group 到另一个 group）
    if (tabGroup) {
      const groupId = parseInt(tabGroup.dataset.groupId);
      if (!draggedGroup || draggedGroup.id !== groupId) {
        tabGroup.classList.add('group-drop-target');
      }
    }
  } else if (tabItem) {
    tabItem.classList.add('drag-over');
    dragOverElement = tabItem;
  } else if (windowSection) {
    // 高亮整个窗口区域
    const windowId = parseInt(windowSection.dataset.windowId);
    const isDifferentWindow = (draggedTab && windowId !== draggedTab.windowId) || 
                              (draggedGroup && windowId !== draggedGroup.windowId);
    if (isDifferentWindow) {
      windowSection.classList.add('window-drop-target');
    }
  }
}

function handleDragLeave(e) {
  const tabItem = e.target.closest('.tab-item');
  const windowSection = e.target.closest('.window-section');
  
  if (tabItem) {
    tabItem.classList.remove('drag-over');
  }
  if (windowSection && !windowSection.contains(e.relatedTarget)) {
    windowSection.classList.remove('window-drop-target');
  }
}

async function handleDrop(e) {
  e.preventDefault();
  
  if (!draggedTab && !draggedGroup) return;
  
  const targetTabItem = e.target.closest('.tab-item');
  const targetGroupHeader = e.target.closest('.group-header');
  const targetGroup = e.target.closest('.tab-group');
  const windowSection = e.target.closest('.window-section');
  const windowHeader = e.target.closest('.window-header');
  
  try {
    if (draggedGroup) {
      // === Group 拖拽 ===
      const targetGroupId = targetGroup ? parseInt(targetGroup.dataset.groupId) : null;
      const targetWindowId = windowHeader 
        ? parseInt(windowHeader.dataset.windowId) 
        : (windowSection ? parseInt(windowSection.dataset.windowId) : null);
      
      if (targetGroupHeader || (targetGroup && targetGroupId !== draggedGroup.id)) {
        // Group → Group: 排序（移动到目标分组位置，保持属性）
        await MoveOperations.groupToGroup(draggedGroup.id, targetGroupId);
      } else if (targetWindowId && targetWindowId !== draggedGroup.windowId) {
        // Group → Window: 移动（保持分组属性）
        await MoveOperations.groupToWindow(draggedGroup.id, targetWindowId);
      }
      
    } else if (draggedTab) {
      // === Tab 拖拽 ===
      const tabIds = [draggedTab.id];
      
      if (targetGroupHeader || (targetGroup && !targetTabItem)) {
        // Tab → Group: 加入分组
        const targetGroupId = parseInt(targetGroup.dataset.groupId);
        await MoveOperations.tabsToGroup(tabIds, targetGroupId);
        
      } else if (targetTabItem) {
        // Tab → Tab 位置: 插入（特殊处理，不走 MoveOperations）
        const targetTabId = parseInt(targetTabItem.dataset.tabId);
        const targetTab = allTabs.find(t => t.id === targetTabId);
        if (targetTab && draggedTab.id !== targetTabId) {
          await chrome.tabs.move(draggedTab.id, {
            windowId: targetTab.windowId,
            index: targetTab.index,
          });
        }
        
      } else if (windowHeader || windowSection) {
        // Tab → Window: 移动到窗口（不分组）
        const targetWindowId = windowHeader 
          ? parseInt(windowHeader.dataset.windowId) 
          : parseInt(windowSection.dataset.windowId);
        await MoveOperations.tabsToWindow(tabIds, targetWindowId);
      }
    }
  } catch (err) {
    console.error('Failed to move:', err);
  }
  
  document.querySelectorAll('.drag-over, .window-drop-target, .group-drop-target').forEach(el => {
    el.classList.remove('drag-over', 'window-drop-target', 'group-drop-target');
  });
}

// ============ 窗口拖拽排序 ============

function handleWindowDragStart(e) {
  // 只从拖拽手柄开始拖拽
  const dragHandle = e.target.closest('.window-drag-handle');
  const header = e.target.closest('.window-header');
  
  if (!header) return;
  
  // 如果点击的是窗口名称区域，不启动拖拽（允许编辑）
  if (e.target.closest('.window-name')) {
    e.preventDefault();
    return;
  }
  
  const windowId = parseInt(header.dataset.windowId);
  draggedWindow = windowId;
  
  const windowSection = header.closest('.window-section');
  windowSection.classList.add('window-dragging');
  
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', `window:${windowId}`);
  
  // 记录拖拽前展开的窗口，然后折叠所有窗口
  windowsExpandedBeforeDrag.clear();
  const allWindowSections = document.querySelectorAll('.window-section');
  allWindowSections.forEach(section => {
    const wId = parseInt(section.dataset.windowId);
    if (!collapsedWindows.has(wId)) {
      windowsExpandedBeforeDrag.add(wId);
    }
    // 折叠所有窗口
    section.classList.add('collapsed');
    collapsedWindows.add(wId);
    const collapseIcon = section.querySelector('.window-collapse-icon');
    if (collapseIcon) collapseIcon.textContent = '▶';
  });
  
  // 停止事件冒泡，避免触发 tab 拖拽
  e.stopPropagation();
}

function handleWindowDragEnd(e) {
  if (!draggedWindow) return;
  
  document.querySelectorAll('.window-dragging').forEach(el => el.classList.remove('window-dragging'));
  document.querySelectorAll('.window-drag-over').forEach(el => el.classList.remove('window-drag-over'));
  
  // 恢复拖拽前展开的窗口
  const allWindowSections = document.querySelectorAll('.window-section');
  allWindowSections.forEach(section => {
    const wId = parseInt(section.dataset.windowId);
    if (windowsExpandedBeforeDrag.has(wId)) {
      section.classList.remove('collapsed');
      collapsedWindows.delete(wId);
      const collapseIcon = section.querySelector('.window-collapse-icon');
      if (collapseIcon) collapseIcon.textContent = '▼';
    }
  });
  windowsExpandedBeforeDrag.clear();
  
  draggedWindow = null;
}

function handleWindowDragOver(e) {
  if (!draggedWindow) return;
  
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  
  const header = e.target.closest('.window-header');
  if (header) {
    const targetWindowId = parseInt(header.dataset.windowId);
    if (targetWindowId !== draggedWindow) {
      document.querySelectorAll('.window-drag-over').forEach(el => el.classList.remove('window-drag-over'));
      header.closest('.window-section').classList.add('window-drag-over');
    }
  }
  
  e.stopPropagation();
}

function handleWindowDragLeave(e) {
  if (!draggedWindow) return;
  
  const header = e.target.closest('.window-header');
  if (header) {
    header.closest('.window-section').classList.remove('window-drag-over');
  }
}

async function handleWindowDrop(e) {
  if (!draggedWindow) return;
  
  e.preventDefault();
  e.stopPropagation();
  
  const header = e.target.closest('.window-header');
  if (!header) return;
  
  const targetWindowId = parseInt(header.dataset.windowId);
  if (targetWindowId === draggedWindow) return;
  
  // 获取当前窗口顺序
  const windowSections = document.querySelectorAll('.window-section');
  const currentOrder = Array.from(windowSections).map(s => parseInt(s.dataset.windowId));
  
  // 找到拖拽窗口和目标窗口的索引
  const dragIndex = currentOrder.indexOf(draggedWindow);
  const targetIndex = currentOrder.indexOf(targetWindowId);
  
  if (dragIndex === -1 || targetIndex === -1) return;
  
  // 移动窗口顺序
  currentOrder.splice(dragIndex, 1);
  currentOrder.splice(targetIndex, 0, draggedWindow);
  
  // 保存新顺序
  await saveWindowOrder(currentOrder);
  
  // 清理状态
  document.querySelectorAll('.window-drag-over').forEach(el => el.classList.remove('window-drag-over'));
  draggedWindow = null;
  
  // 重新渲染
  renderTabList();
}

// ============ 右键菜单 ============

// 窗口右键菜单
function showWindowContextMenu(x, y, windowId) {
  hideContextMenu();
  
  const windowTabs = allTabs.filter(t => t.windowId === windowId);
  const tabCount = windowTabs.length;
  
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.innerHTML = `
    <div class="context-menu-header">Window (${tabCount} tabs)</div>
    <div class="context-menu-separator"></div>
    <div class="context-menu-item" data-action="new-tab">➕ New Tab</div>
    <div class="context-menu-separator"></div>
    <div class="context-menu-item danger" data-action="close-window">🗑️ Close Window</div>
  `;
  
  menu.style.left = `${Math.min(x, window.innerWidth - 180)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - 120)}px`;
  
  menu.addEventListener('click', async (e) => {
    const item = e.target.closest('.context-menu-item');
    if (!item) return;
    
    const action = item.dataset.action;
    
    switch (action) {
      case 'new-tab':
        await chrome.tabs.create({ windowId });
        break;
      case 'close-window':
        await chrome.windows.remove(windowId);
        break;
    }
    
    hideContextMenu();
  });
  
  // 遮罩层
  const overlay = document.createElement('div');
  overlay.className = 'context-menu-overlay';
  overlay.addEventListener('click', hideContextMenu);
  overlay.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    hideContextMenu();
  });
  
  document.body.appendChild(overlay);
  document.body.appendChild(menu);
  
  menu._cleanup = () => overlay.remove();
}

// 分组右键菜单
function showGroupContextMenu(x, y, groupId, windowId) {
  hideContextMenu();
  
  const group = allGroups.find(g => g.id === groupId);
  const groupTabs = allTabs.filter(t => t.groupId === groupId);
  const tabCount = groupTabs.length;
  const groupName = group?.title || 'Group';
  const tabIds = groupTabs.map(t => t.id);
  
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  
  const menuHtml = `
    <div class="context-menu-header">${escapeHtml(groupName)} (${tabCount} tabs)</div>
    <div class="context-menu-separator"></div>
    <div class="context-menu-item" data-action="new-tab">➕ New Tab</div>
    <div class="context-menu-separator"></div>
    <div class="context-menu-item" data-action="ungroup">📂 Ungroup</div>
    <div class="context-menu-item has-submenu" data-action="move-to">📦 Move to... ▶</div>
    <div class="context-menu-separator"></div>
    <div class="context-menu-item danger" data-action="close-group">🗑️ Close Group</div>
  `;
  
  menu.innerHTML = menuHtml;
  
  menu.style.left = `${Math.min(x, window.innerWidth - 180)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - 200)}px`;
  
  menu.addEventListener('click', async (e) => {
    const item = e.target.closest('.context-menu-item');
    if (!item) return;
    
    const action = item.dataset.action;
    
    switch (action) {
      case 'new-tab':
        // 在该分组内创建新标签
        const newTab = await chrome.tabs.create({ windowId });
        await chrome.tabs.group({ tabIds: [newTab.id], groupId });
        hideContextMenu();
        break;
      case 'ungroup':
        await chrome.tabs.ungroup(tabIds);
        hideContextMenu();
        break;
      case 'close-group':
        await chrome.tabs.remove(tabIds);
        hideContextMenu();
        break;
    }
  });
  
  // 为 "Move to..." 添加悬停事件
  const moveToItem = menu.querySelector('[data-action="move-to"]');
  if (moveToItem) {
    moveToItem.addEventListener('mouseenter', () => {
      showGroupMoveToSubmenu(moveToItem, tabIds, group, windowId);
    });
  }
  
  // 悬停在其他项时关闭子菜单
  menu.querySelectorAll('.context-menu-item:not([data-action="move-to"])').forEach(item => {
    item.addEventListener('mouseenter', () => {
      document.querySelectorAll('.context-submenu').forEach(m => m.remove());
    });
  });
  
  // 遮罩层
  const overlay = document.createElement('div');
  overlay.className = 'context-menu-overlay';
  overlay.addEventListener('click', hideContextMenu);
  overlay.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    hideContextMenu();
  });
  
  document.body.appendChild(overlay);
  document.body.appendChild(menu);
  
  // Escape 键关闭
  function onKeyDown(e) {
    if (e.key === 'Escape') {
      hideContextMenu();
    }
  }
  document.addEventListener('keydown', onKeyDown);
  
  menu._cleanup = () => {
    document.removeEventListener('keydown', onKeyDown);
    overlay.remove();
  };
}

// Group 的 "Move to..." 子菜单（Group 只能移动到其他窗口，不再有合并选项）
function showGroupMoveToSubmenu(parentItem, tabIds, sourceGroup, currentWindowId) {
  document.querySelectorAll('.context-submenu').forEach(m => m.remove());
  
  const submenu = document.createElement('div');
  submenu.className = 'context-menu context-submenu';
  
  const windowIds = [...new Set(allTabs.map(t => t.windowId))];
  
  let html = `
    <div class="context-menu-item" data-action="new-window">🆕 New Window</div>
    <div class="context-menu-separator"></div>
  `;
  
  // 按窗口顺序排序
  const sortedWindowIds = windowOrder.length > 0 
    ? windowIds.sort((a, b) => {
        const iA = windowOrder.indexOf(a);
        const iB = windowOrder.indexOf(b);
        if (iA === -1 && iB === -1) return 0;
        if (iA === -1) return 1;
        if (iB === -1) return -1;
        return iA - iB;
      })
    : windowIds;
  
  for (const windowId of sortedWindowIds) {
    const windowLabel = windowNames[windowId] || `Window ${windowId}`;
    const isCurrent = windowId === currentWindowId;
    
    // Group 菜单的窗口项没有子菜单（不需要合并选项）
    html += `
      <div class="context-menu-item" data-action="window" data-window-id="${windowId}">
        🪟 ${escapeHtml(windowLabel)}${isCurrent ? ' ✓' : ''}
      </div>
    `;
  }
  
  submenu.innerHTML = html;
  
  // 定位
  const parentRect = parentItem.getBoundingClientRect();
  const menuWidth = 170;
  
  if (parentRect.right + menuWidth > window.innerWidth) {
    submenu.style.left = `${Math.max(5, parentRect.left - menuWidth + 5)}px`;
  } else {
    submenu.style.left = `${parentRect.right - 5}px`;
  }
  submenu.style.top = `${Math.min(parentRect.top, window.innerHeight - 300)}px`;
  
  // 点击处理
  submenu.addEventListener('click', async (e) => {
    const item = e.target.closest('.context-menu-item');
    if (!item) return;
    
    const action = item.dataset.action;
    
    if (action === 'new-window') {
      // Group → New Window
      await MoveOperations.groupToNewWindow(sourceGroup?.id);
      hideContextMenu();
    } else if (action === 'window') {
      // Group → Window（点击窗口名 = 移动整个分组，保持属性）
      const targetWindowId = parseInt(item.dataset.windowId);
      await MoveOperations.groupToWindow(sourceGroup?.id, targetWindowId);
      hideContextMenu();
    }
  });
  
  // Group 菜单不需要二级菜单（点击窗口名直接移动）
  // 悬停时关闭可能存在的其他子菜单
  submenu.querySelectorAll('[data-action="window"]').forEach(item => {
    item.addEventListener('mouseenter', () => {
      document.querySelectorAll('.context-submenu-level2').forEach(m => m.remove());
    });
  });
  
  // 悬停在 New Window 时关闭分组子菜单
  submenu.querySelectorAll('.context-menu-item:not(.has-submenu)').forEach(item => {
    item.addEventListener('mouseenter', () => {
      document.querySelectorAll('.context-submenu-level2').forEach(m => m.remove());
    });
  });
  
  // 鼠标离开逻辑
  let leaveTimeout;
  submenu.addEventListener('mouseleave', () => {
    leaveTimeout = setTimeout(() => {
      const level2 = document.querySelector('.context-submenu-level2');
      if (level2 && level2.matches(':hover')) return;
      if (parentItem.matches(':hover')) return;
      document.querySelectorAll('.context-submenu').forEach(m => m.remove());
    }, 100);
  });
  
  submenu.addEventListener('mouseenter', () => {
    clearTimeout(leaveTimeout);
  });
  
  document.body.appendChild(submenu);
}

// 标签右键菜单
function showContextMenu(x, y, tab) {
  // 移除已有菜单
  hideContextMenu();
  
  const isMultiSelect = selectedTabIds.size > 1;
  const selectedCount = selectedTabIds.size;
  const isInGroup = tab.groupId && tab.groupId !== -1;
  
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  
  let menuHtml = '';
  
  if (isMultiSelect) {
    menuHtml = `
      <div class="context-menu-header">${selectedCount} tabs selected</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-action="reload-selected">🔄 Reload All</div>
      <div class="context-menu-item" data-action="pin-selected">📌 Pin All</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item has-submenu" data-action="move-to">📦 Move to... ▶</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item danger" data-action="close-selected">✕ Close ${selectedCount} tabs</div>
    `;
  } else {
    menuHtml = `
      <div class="context-menu-item" data-action="reload">🔄 Reload</div>
      <div class="context-menu-item" data-action="duplicate">📋 Duplicate</div>
      <div class="context-menu-item" data-action="pin">${tab.pinned ? '📌 Unpin' : '📌 Pin'}</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item has-submenu" data-action="move-to">📦 Move to... ▶</div>
      ${isInGroup ? '<div class="context-menu-item" data-action="remove-from-group">📤 Remove from Group</div>' : ''}
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-action="close-others">Close other tabs</div>
      <div class="context-menu-item danger" data-action="close">✕ Close tab</div>
    `;
  }
  
  menu.innerHTML = menuHtml;
  
  // 定位
  menu.style.left = `${Math.min(x, window.innerWidth - 180)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - 250)}px`;
  
  // 事件处理
  menu.addEventListener('click', async (e) => {
    const item = e.target.closest('.context-menu-item');
    if (!item) return;
    
    const action = item.dataset.action;
    const selectedIds = Array.from(selectedTabIds);
    const tabIds = selectedIds.length > 0 ? selectedIds : [tab.id];
    
    switch (action) {
      // 单选操作
      case 'reload':
        await chrome.tabs.reload(tab.id);
        break;
      case 'duplicate':
        await chrome.tabs.duplicate(tab.id);
        break;
      case 'pin':
        await chrome.tabs.update(tab.id, { pinned: !tab.pinned });
        break;
      case 'close-others':
        const otherTabs = allTabs.filter(t => t.id !== tab.id && t.windowId === tab.windowId && !t.pinned);
        await chrome.tabs.remove(otherTabs.map(t => t.id));
        break;
      case 'close':
        await chrome.tabs.remove(tab.id);
        break;
      
      // 多选操作
      case 'reload-selected':
        for (const id of selectedIds) {
          await chrome.tabs.reload(id);
        }
        break;
      case 'pin-selected':
        for (const id of selectedIds) {
          await chrome.tabs.update(id, { pinned: true });
        }
        break;
      case 'close-selected':
        await chrome.tabs.remove(selectedIds);
        break;
      
      // 从分组移除
      case 'remove-from-group':
        await chrome.tabs.ungroup([tab.id]);
        break;
    }
    
    selectedTabIds.clear();
    hideContextMenu();
  });
  
  // 创建透明遮罩层
  const overlay = document.createElement('div');
  overlay.className = 'context-menu-overlay';
  overlay.addEventListener('click', hideContextMenu);
  overlay.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    hideContextMenu();
  });
  
  document.body.appendChild(overlay);
  document.body.appendChild(menu);
  
  // 为 "Move to..." 添加悬停事件
  const moveToItem = menu.querySelector('[data-action="move-to"]');
  if (moveToItem) {
    const tabIds = Array.from(selectedTabIds).length > 0 ? Array.from(selectedTabIds) : [tab.id];
    
    moveToItem.addEventListener('mouseenter', () => {
      showMoveToSubmenu(moveToItem, tabIds, tab.windowId);
    });
  }
  
  // 悬停在主菜单的其他项时，关闭所有子菜单
  menu.querySelectorAll('.context-menu-item:not([data-action="move-to"])').forEach(item => {
    item.addEventListener('mouseenter', () => {
      document.querySelectorAll('.context-submenu').forEach(m => m.remove());
    });
  });
  
  // Escape 键关闭
  function onKeyDown(e) {
    if (e.key === 'Escape') {
      hideContextMenu();
    }
  }
  document.addEventListener('keydown', onKeyDown);
  
  menu._cleanup = () => {
    document.removeEventListener('keydown', onKeyDown);
    overlay.remove();
  };
}

// 显示 "Move to..." 子菜单
function showMoveToSubmenu(parentItem, tabIds, currentWindowId) {
  // 移除已有子菜单
  document.querySelectorAll('.context-submenu').forEach(m => m.remove());
  
  const submenu = document.createElement('div');
  submenu.className = 'context-menu context-submenu';
  submenu._parentItem = parentItem;
  submenu._tabIds = tabIds;
  
  // 获取所有窗口
  const windowIds = [...new Set(allTabs.map(t => t.windowId))];
  
  let html = `
    <div class="context-menu-item" data-action="new-window">🆕 New Window</div>
    <div class="context-menu-separator"></div>
  `;
  
  // 按窗口顺序排序
  const sortedWindowIds = windowOrder.length > 0 
    ? windowIds.sort((a, b) => {
        const iA = windowOrder.indexOf(a);
        const iB = windowOrder.indexOf(b);
        if (iA === -1 && iB === -1) return 0;
        if (iA === -1) return 1;
        if (iB === -1) return -1;
        return iA - iB;
      })
    : windowIds;
  
  for (const windowId of sortedWindowIds) {
    const windowLabel = windowNames[windowId] || `Window ${windowId}`;
    const isCurrent = windowId === currentWindowId;
    
    html += `
      <div class="context-menu-item has-submenu" data-action="window" data-window-id="${windowId}">
        🪟 ${escapeHtml(windowLabel)}${isCurrent ? ' ✓' : ''} ▶
      </div>
    `;
  }
  
  submenu.innerHTML = html;
  
  // 定位到父项右侧（空间不足时显示在左侧）
  const parentRect = parentItem.getBoundingClientRect();
  const menuWidth = 170;
  
  if (parentRect.right + menuWidth > window.innerWidth) {
    // 右侧空间不足，显示在左侧
    submenu.style.left = `${Math.max(5, parentRect.left - menuWidth + 5)}px`;
  } else {
    submenu.style.left = `${parentRect.right - 5}px`;
  }
  submenu.style.top = `${Math.min(parentRect.top, window.innerHeight - 300)}px`;
  
  // 点击处理
  submenu.addEventListener('click', async (e) => {
    const item = e.target.closest('.context-menu-item');
    if (!item) return;
    
    const action = item.dataset.action;
    
    if (action === 'new-window') {
      // Tab(s) → New Window
      await MoveOperations.tabsToNewWindow(tabIds);
      selectedTabIds.clear();
      hideContextMenu();
    } else if (action === 'window') {
      // Tab(s) → Window（点击窗口名 = 移动到该窗口，不分组）
      const windowId = parseInt(item.dataset.windowId);
      await MoveOperations.tabsToWindow(tabIds, windowId);
      selectedTabIds.clear();
      hideContextMenu();
    }
  });
  
  // 悬停在有子菜单的项 → 显示第二级菜单（选择分组）
  submenu.querySelectorAll('[data-action="window"]').forEach(item => {
    item.addEventListener('mouseenter', () => {
      const windowId = parseInt(item.dataset.windowId);
      showWindowGroupsSubmenu(item, tabIds, windowId);
    });
  });
  
  // 悬停在没有子菜单的项（如 New Window）→ 关闭第二级菜单
  submenu.querySelectorAll('.context-menu-item:not(.has-submenu)').forEach(item => {
    item.addEventListener('mouseenter', () => {
      document.querySelectorAll('.context-submenu-level2').forEach(m => m.remove());
    });
  });
  
  // 鼠标离开一级菜单区域 → 关闭一级和二级菜单（延迟检查，避免移动到子菜单时误关）
  let leaveTimeout;
  submenu.addEventListener('mouseleave', () => {
    leaveTimeout = setTimeout(() => {
      // 检查鼠标是否在二级菜单内
      const level2 = document.querySelector('.context-submenu-level2');
      if (level2 && level2.matches(':hover')) return;
      
      // 检查鼠标是否回到了主菜单的 Move to 项
      if (parentItem.matches(':hover')) return;
      
      // 关闭一级和二级菜单
      document.querySelectorAll('.context-submenu').forEach(m => m.remove());
    }, 100);
  });
  
  submenu.addEventListener('mouseenter', () => {
    clearTimeout(leaveTimeout);
  });
  
  document.body.appendChild(submenu);
}

// 显示窗口内的分组子菜单
function showWindowGroupsSubmenu(parentItem, tabIds, targetWindowId) {
  // 移除同级子菜单
  document.querySelectorAll('.context-submenu-level2').forEach(m => m.remove());
  
  const submenu = document.createElement('div');
  submenu.className = 'context-menu context-submenu context-submenu-level2';
  
  // 获取该窗口的分组
  const windowGroups = allGroups.filter(g => 
    allTabs.some(t => t.windowId === targetWindowId && t.groupId === g.id)
  );
  
  let html = `
    <div class="context-menu-item" data-action="new-group">🆕 New Group</div>
  `;
  
  if (windowGroups.length > 0) {
    html += `<div class="context-menu-separator"></div>`;
    for (const group of windowGroups) {
      const groupTitle = group.title || 'Unnamed Group';
      html += `
        <div class="context-menu-item" data-action="to-group" data-group-id="${group.id}">
          <span class="group-color-dot" style="background: var(--group-${group.color})"></span>
          ${escapeHtml(groupTitle)}
        </div>
      `;
    }
  }
  
  submenu.innerHTML = html;
  
  // 先添加到 DOM（隐藏），然后计算位置
  submenu.style.visibility = 'hidden';
  document.body.appendChild(submenu);
  
  // 定位 - 确保不超出屏幕，跟随 parentItem 的实际位置
  const parentRect = parentItem.getBoundingClientRect();
  const submenuRect = submenu.getBoundingClientRect();
  const menuWidth = submenuRect.width || 160;
  const menuHeight = submenuRect.height || 150;
  
  // 水平定位：优先右侧，空间不足时显示在左侧
  let left;
  if (parentRect.right + menuWidth > window.innerWidth) {
    left = Math.max(5, parentRect.left - menuWidth + 5);
  } else {
    left = parentRect.right - 5;
  }
  
  // 垂直定位：与 parentItem 对齐，但确保不超出屏幕底部
  let top = parentRect.top;
  if (top + menuHeight > window.innerHeight - 10) {
    top = Math.max(10, window.innerHeight - menuHeight - 10);
  }
  
  submenu.style.left = `${left}px`;
  submenu.style.top = `${top}px`;
  submenu.style.visibility = 'visible';
  
  // 处理点击
  submenu.addEventListener('click', async (e) => {
    const item = e.target.closest('.context-menu-item');
    if (!item) return;
    
    const action = item.dataset.action;
    
    if (action === 'new-group') {
      // Tab(s) → New Group
      await MoveOperations.tabsToNewGroup(tabIds, targetWindowId);
    } else if (action === 'to-group') {
      // Tab(s) → Group
      const groupId = parseInt(item.dataset.groupId);
      await MoveOperations.tabsToGroup(tabIds, groupId);
    }
    
    selectedTabIds.clear();
    hideContextMenu();
  });
  
  // 鼠标离开二级菜单 → 关闭自己（延迟检查）
  let leaveTimeout;
  submenu.addEventListener('mouseleave', () => {
    leaveTimeout = setTimeout(() => {
      // 检查鼠标是否回到了一级菜单的对应项
      if (parentItem.matches(':hover')) return;
      submenu.remove();
    }, 100);
  });
  
  submenu.addEventListener('mouseenter', () => {
    clearTimeout(leaveTimeout);
  });
}

function hideContextMenu() {
  // 移除所有子菜单
  document.querySelectorAll('.context-submenu').forEach(m => m.remove());
  
  // 移除主菜单
  const menu = document.querySelector('.context-menu:not(.context-submenu)');
  if (menu) {
    if (menu._cleanup) menu._cleanup();
    menu.remove();
  }
}

// ============ Tab Group 操作 ============

async function createTabGroup(tabIds) {
  if (!tabIds || tabIds.length === 0) return;
  
  // 弹出输入框获取分组名称
  const groupName = prompt('Enter group name:', 'New Group');
  if (!groupName) return;
  
  try {
    // 创建分组
    const groupId = await chrome.tabs.group({ tabIds });
    
    // 设置分组名称和颜色
    const colors = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    
    await chrome.tabGroups.update(groupId, {
      title: groupName,
      color: randomColor,
    });
    
    selectedTabIds.clear();
  } catch (error) {
    console.error('Failed to create group:', error);
    alert('Failed to create group: ' + error.message);
  }
}

async function showAddToGroupMenu(x, y, tabIds) {
  // 获取当前窗口的所有分组
  const groups = await chrome.tabGroups.query({});
  
  if (groups.length === 0) {
    alert('No existing groups. Create a new group first.');
    return;
  }
  
  hideContextMenu();
  
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  
  let html = '<div class="context-menu-header">Add to Group</div><div class="context-menu-separator"></div>';
  
  for (const group of groups) {
    html += `<div class="context-menu-item" data-action="add-to-existing" data-group-id="${group.id}">
      <span class="color-dot color-${group.color}"></span>
      ${escapeHtml(group.title || 'Unnamed Group')}
    </div>`;
  }
  
  menu.innerHTML = html;
  menu.style.left = `${Math.min(x, window.innerWidth - 180)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - 250)}px`;
  
  menu.addEventListener('click', async (e) => {
    const item = e.target.closest('.context-menu-item');
    if (!item) return;
    
    const groupId = parseInt(item.dataset.groupId);
    if (groupId) {
      try {
        await chrome.tabs.group({ groupId, tabIds });
        selectedTabIds.clear();
      } catch (error) {
        console.error('Failed to add to group:', error);
      }
    }
    
    hideContextMenu();
  });
  
  // 创建遮罩
  const overlay = document.createElement('div');
  overlay.className = 'context-menu-overlay';
  overlay.addEventListener('click', hideContextMenu);
  
  document.body.appendChild(overlay);
  document.body.appendChild(menu);
  
  menu._cleanup = () => overlay.remove();
}

// ============ 监听标签变化 ============

function listenToTabChanges() {
  // 标签创建
  chrome.tabs.onCreated.addListener(() => loadTabs());
  
  // 标签移除
  chrome.tabs.onRemoved.addListener(() => loadTabs());
  
  // 标签更新（URL、标题等变化）
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.title || changeInfo.url || changeInfo.favIconUrl || changeInfo.pinned !== undefined) {
      loadTabs();
    }
  });
  
  // 标签激活
  chrome.tabs.onActivated.addListener(() => loadTabs());
  
  // 标签移动
  chrome.tabs.onMoved.addListener(() => loadTabs());
  
  // 标签附加到窗口
  chrome.tabs.onAttached.addListener(() => loadTabs());
  
  // 标签组变化
  chrome.tabGroups.onCreated.addListener(() => loadTabs());
  chrome.tabGroups.onRemoved.addListener(() => loadTabs());
  chrome.tabGroups.onUpdated.addListener(() => loadTabs());
  
  // 窗口关闭时清理顺序
  chrome.windows.onRemoved.addListener(async (windowId) => {
    // 从顺序列表中移除
    const index = windowOrder.indexOf(windowId);
    if (index !== -1) {
      windowOrder.splice(index, 1);
      await chrome.storage.local.set({ windowOrder });
    }
    // 从名称列表中移除
    if (windowNames[windowId]) {
      delete windowNames[windowId];
      await chrome.storage.local.set({ windowNames });
    }
    loadTabs();
  });
}

// ============ 工具函数 ============

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============ 会话管理 ============

async function loadSession() {
  const result = await chrome.storage.local.get('currentSession');
  return result.currentSession || null;
}

async function saveSession(session) {
  await chrome.storage.local.set({ currentSession: session });
}

async function captureCurrentSession() {
  const windows = await chrome.windows.getAll({ populate: true });
  const groups = await chrome.tabGroups.query({});
  
  const sessionWindows = [];
  
  for (const win of windows) {
    // 获取该窗口的自定义名称
    const windowName = windowNames[win.id] || null;
    
    // 获取该窗口的所有分组
    const windowGroups = groups.filter(g => 
      win.tabs.some(t => t.groupId === g.id)
    );
    
    // 整理分组数据
    const groupsData = windowGroups.map(g => ({
      title: g.title || '',
      color: g.color,
      tabs: win.tabs
        .filter(t => t.groupId === g.id)
        .map(t => ({ url: t.url, title: t.title, pinned: t.pinned }))
    }));
    
    // 未分组的标签
    const ungroupedTabs = win.tabs
      .filter(t => t.groupId === -1 || !t.groupId)
      .map(t => ({ url: t.url, title: t.title, pinned: t.pinned }));
    
    sessionWindows.push({
      name: windowName,
      groups: groupsData,
      tabs: ungroupedTabs,
    });
  }
  
  return {
    savedAt: new Date().toISOString(),
    windows: sessionWindows,
  };
}

// 手动保存
async function saveCurrentSession(showAlert = true) {
  const session = await captureCurrentSession();
  await saveSession(session);
  if (showAlert) {
    showToast('Session saved!');
  }
  console.log('[Session] Saved at', session.savedAt);
}

// 显示简单提示（不用 alert 阻塞）
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

async function restoreSession(replaceMode = false) {
  const session = await loadSession();
  if (!session) {
    alert('No saved session found.');
    return;
  }
  
  const tabCount = session.windows.reduce((acc, w) => 
    acc + w.tabs.length + w.groups.reduce((a, g) => a + g.tabs.length, 0), 0);
  
  if (replaceMode) {
    // 替换模式：关闭所有现有窗口，恢复保存的会话
    const confirmReplace = confirm(
      `⚠️ Replace current session?\n\n` +
      `This will CLOSE all current windows and restore:\n` +
      `${session.windows.length} window(s), ${tabCount} tabs\n\n` +
      `Saved: ${new Date(session.savedAt).toLocaleString()}`
    );
    if (!confirmReplace) return;
    
    // 获取当前所有窗口
    const currentWindows = await chrome.windows.getAll();
    
    // 先创建恢复的窗口（至少要有一个窗口存在）
    await createSessionWindows(session);
    
    // 关闭旧窗口
    for (const win of currentWindows) {
      try {
        await chrome.windows.remove(win.id);
      } catch (e) {
        // 可能已关闭
      }
    }
  } else {
    // 追加模式：在新窗口中打开
    const confirmRestore = confirm(
      `Open saved session in NEW windows?\n\n` +
      `${session.windows.length} window(s), ${tabCount} tabs\n` +
      `Saved: ${new Date(session.savedAt).toLocaleString()}\n\n` +
      `(Current windows will remain open)`
    );
    if (!confirmRestore) return;
    
    await createSessionWindows(session);
  }
  
  // 保存窗口名称
  await chrome.storage.local.set({ windowNames });
  
  hideSessionsPanel();
  showToast('Session restored!');
}

// 创建会话中的窗口和标签
async function createSessionWindows(session) {
  for (const winData of session.windows) {
    // 创建新窗口
    const newWindow = await chrome.windows.create({});
    
    // 保存窗口名称
    if (winData.name) {
      windowNames[newWindow.id] = winData.name;
    }
    
    // 关闭默认创建的空白标签
    const defaultTab = (await chrome.tabs.query({ windowId: newWindow.id }))[0];
    
    // 先创建未分组的标签
    for (const tabData of winData.tabs) {
      if (tabData.url && !tabData.url.startsWith('chrome://')) {
        await chrome.tabs.create({
          windowId: newWindow.id,
          url: tabData.url,
          pinned: tabData.pinned,
        });
      }
    }
    
    // 创建分组和分组内的标签
    for (const groupData of winData.groups) {
      const tabIds = [];
      
      for (const tabData of groupData.tabs) {
        if (tabData.url && !tabData.url.startsWith('chrome://')) {
          const tab = await chrome.tabs.create({
            windowId: newWindow.id,
            url: tabData.url,
            pinned: tabData.pinned,
          });
          tabIds.push(tab.id);
        }
      }
      
      if (tabIds.length > 0) {
        const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId: newWindow.id } });
        await chrome.tabGroups.update(groupId, {
          title: groupData.title,
          color: groupData.color,
        });
      }
    }
    
    // 关闭默认空白标签
    if (defaultTab) {
      try {
        await chrome.tabs.remove(defaultTab.id);
      } catch (e) {
        // 可能已经被关闭
      }
    }
  }
}

// 导出会话为 JSON 文件
async function exportSession() {
  const session = await loadSession();
  if (!session) {
    alert('No saved session to export.');
    return;
  }
  
  const json = JSON.stringify(session, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `session_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  
  URL.revokeObjectURL(url);
  showToast('Session exported!');
}

// 导入会话
async function importSession() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      const session = JSON.parse(text);
      
      // 验证基本结构
      if (!session.windows || !Array.isArray(session.windows)) {
        throw new Error('Invalid session format');
      }
      
      session.savedAt = new Date().toISOString(); // 更新保存时间
      await saveSession(session);
      showToast('Session imported!');
      showSessionsPanel(); // 刷新
    } catch (err) {
      alert('Failed to import: ' + err.message);
    }
  };
  
  input.click();
}

async function showSessionsPanel() {
  // 移除已有面板
  hideSessionsPanel();
  
  const session = await loadSession();
  
  let sessionInfo = '';
  if (session) {
    const tabCount = session.windows.reduce((acc, w) => 
      acc + w.tabs.length + w.groups.reduce((a, g) => a + g.tabs.length, 0), 0);
    sessionInfo = `
      <div class="session-item">
        <div class="session-info">
          <div class="session-name">Latest Checkpoint</div>
          <div class="session-meta">
            ${session.windows.length} window(s) · ${tabCount} tabs<br>
            Saved: ${new Date(session.savedAt).toLocaleString()}
          </div>
        </div>
      </div>
      <div class="session-restore-actions">
        <button class="btn-restore-replace" title="Close current windows and restore">🔄 Replace</button>
        <button class="btn-restore-add" title="Open in new windows">➕ Add</button>
      </div>
    `;
  } else {
    sessionInfo = '<div class="sessions-empty">No saved session yet</div>';
  }
  
  const panel = document.createElement('div');
  panel.className = 'sessions-panel';
  panel.innerHTML = `
    <div class="sessions-header">
      <h2>📚 Session</h2>
      <button class="sessions-close" title="Close">✕</button>
    </div>
    <div class="sessions-actions">
      <button class="btn-save-session">💾 Save Now</button>
    </div>
    <div class="sessions-list">
      ${sessionInfo}
    </div>
    <div class="sessions-footer">
      <button class="btn-export">📤 Export JSON</button>
      <button class="btn-import">📥 Import JSON</button>
    </div>
    <div class="sessions-note">
      Auto-saves every 10 minutes
    </div>
  `;
  
  // 事件处理
  panel.querySelector('.sessions-close').addEventListener('click', hideSessionsPanel);
  panel.querySelector('.btn-save-session').addEventListener('click', async () => {
    await saveCurrentSession();
    showSessionsPanel(); // 刷新
  });
  
  // 替换恢复（关闭当前窗口）
  const replaceBtn = panel.querySelector('.btn-restore-replace');
  if (replaceBtn) {
    replaceBtn.addEventListener('click', () => restoreSession(true));
  }
  
  // 追加恢复（新窗口打开）
  const addBtn = panel.querySelector('.btn-restore-add');
  if (addBtn) {
    addBtn.addEventListener('click', () => restoreSession(false));
  }
  
  panel.querySelector('.btn-export').addEventListener('click', exportSession);
  panel.querySelector('.btn-import').addEventListener('click', importSession);
  
  // 点击外部关闭
  const overlay = document.createElement('div');
  overlay.className = 'sessions-overlay';
  overlay.addEventListener('click', hideSessionsPanel);
  
  document.body.appendChild(overlay);
  document.body.appendChild(panel);
}

function hideSessionsPanel() {
  const panel = document.querySelector('.sessions-panel');
  const overlay = document.querySelector('.sessions-overlay');
  if (panel) panel.remove();
  if (overlay) overlay.remove();
}

// ============ 设置面板 ============

async function showSettingsPanel() {
  hideSettingsPanel();
  
  // 获取当前快捷键配置
  const commands = await chrome.commands.getAll();
  const actionCmd = commands.find(c => c.name === '_execute_action');
  const currentShortcut = actionCmd?.shortcut || 'Not set';
  
  const panel = document.createElement('div');
  panel.className = 'settings-panel';
  panel.innerHTML = `
    <div class="settings-header">
      <h2>⚙️ Settings</h2>
      <button class="settings-close" title="Close">✕</button>
    </div>
    <div class="settings-content">
      <div class="settings-section">
        <h3>⌨️ Keyboard Shortcuts</h3>
        <div class="shortcut-item">
          <div class="shortcut-info">
            <div class="shortcut-name">Open Sidebar</div>
            <div class="shortcut-desc">打开侧边栏</div>
          </div>
          <div class="shortcut-key">${escapeHtml(currentShortcut)}</div>
        </div>
        <div class="shortcut-note">
          <button class="btn-customize-shortcuts">🔧 Customize Shortcuts</button>
          <p>再按一次可关闭侧边栏</p>
        </div>
      </div>
    </div>
  `;
  
  // 事件处理
  panel.querySelector('.settings-close').addEventListener('click', hideSettingsPanel);
  panel.querySelector('.btn-customize-shortcuts').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
  
  // 遮罩
  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  overlay.addEventListener('click', hideSettingsPanel);
  
  document.body.appendChild(overlay);
  document.body.appendChild(panel);
}

function hideSettingsPanel() {
  const panel = document.querySelector('.settings-panel');
  const overlay = document.querySelector('.settings-overlay');
  if (panel) panel.remove();
  if (overlay) overlay.remove();
}

// ============ 滚动同步 ============

let isScrollSyncing = false; // 防止循环触发

function setupScrollSync() {
  const container = document.querySelector('.tab-list-container');
  if (!container) return;
  
  // 恢复之前保存的滚动位置
  chrome.storage.local.get('scrollPosition', (result) => {
    if (result.scrollPosition !== undefined) {
      container.scrollTop = result.scrollPosition;
    }
  });
  
  // 监听滚动事件，保存位置
  let scrollTimeout;
  container.addEventListener('scroll', () => {
    if (isScrollSyncing) return;
    
    // 防抖：停止滚动后 100ms 保存
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      chrome.storage.local.set({ scrollPosition: container.scrollTop });
    }, 100);
  });
  
  // 监听其他窗口的滚动位置变化
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    
    // 同步滚动位置
    if (changes.scrollPosition) {
      const newPosition = changes.scrollPosition.newValue;
      if (Math.abs(container.scrollTop - newPosition) > 5) {
        isScrollSyncing = true;
        container.scrollTop = newPosition;
        setTimeout(() => { isScrollSyncing = false; }, 50);
      }
    }
    
    // 同步折叠状态
    if (changes.collapsedWindows || changes.collapsedGroups) {
      if (changes.collapsedWindows) {
        collapsedWindows = new Set(changes.collapsedWindows.newValue || []);
      }
      if (changes.collapsedGroups) {
        collapsedGroups = new Set(changes.collapsedGroups.newValue || []);
      }
      // 重新渲染以应用新的折叠状态
      renderTabList();
    }
  });
}

// ============ 启动 ============

document.addEventListener('DOMContentLoaded', init);

