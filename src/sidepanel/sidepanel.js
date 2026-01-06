/**
 * Side Panel - 标签管理器主界面
 */

// State
let allTabs = [];
let allGroups = [];
let windowNames = {}; // 自定义窗口名称
let searchQuery = '';
let draggedTab = null;
let dragOverElement = null;
let selectedTabIds = new Set(); // 多选的标签 ID
let lastSelectedTabId = null;  // 上次选中的标签（用于 Shift 范围选择）

// DOM Elements
const elements = {
  searchInput: document.getElementById('searchInput'),
  tabList: document.getElementById('tabList'),
  tabStats: document.getElementById('tabStats'),
  newTabBtn: document.getElementById('newTabBtn'),
  collapseAllBtn: document.getElementById('collapseAllBtn'),
  sessionsBtn: document.getElementById('sessionsBtn'),
};

// ============ 初始化 ============

async function init() {
  await loadWindowNames();
  await loadTabs();
  bindEvents();
  listenToTabChanges();
}

// ============ 窗口名称管理 ============

async function loadWindowNames() {
  try {
    const result = await chrome.storage.local.get('windowNames');
    windowNames = result.windowNames || {};
  } catch (error) {
    console.error('Failed to load window names:', error);
    windowNames = {};
  }
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
  
  let html = '';
  for (const [windowId, windowTabs] of tabsByWindow) {
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
  
  // 按组和未分组整理标签
  const { groups, ungrouped } = organizeTabsByGroup(tabs);
  
  let html = `
    <div class="window-section" data-window-id="${windowId}">
      <div class="window-header" data-window-id="${windowId}">
        <span class="window-icon">🪟</span>
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
  
  let html = `
    <div class="tab-group" data-group-id="${group.id}" data-color="${color}">
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
  
  // 新建标签
  elements.newTabBtn.addEventListener('click', async () => {
    await chrome.tabs.create({});
  });
  
  // 折叠所有组
  elements.collapseAllBtn.addEventListener('click', () => {
    document.querySelectorAll('.tab-group').forEach(group => {
      group.classList.toggle('collapsed');
    });
  });
  
  // 会话管理
  elements.sessionsBtn.addEventListener('click', showSessionsPanel);
  
  // 标签列表点击事件（事件委托）
  elements.tabList.addEventListener('click', handleTabListClick);
  
  // 双击窗口名编辑
  elements.tabList.addEventListener('dblclick', handleWindowNameEdit);
  
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
  
  // 点击组头 - 折叠/展开
  const groupHeader = e.target.closest('.group-header');
  if (groupHeader) {
    const group = groupHeader.closest('.tab-group');
    group.classList.toggle('collapsed');
    return;
  }
}

function handleContextMenu(e) {
  e.preventDefault();
  
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

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  
  const tabItem = e.target.closest('.tab-item');
  if (tabItem && tabItem !== dragOverElement) {
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    tabItem.classList.add('drag-over');
    dragOverElement = tabItem;
  }
}

function handleDragLeave(e) {
  const tabItem = e.target.closest('.tab-item');
  if (tabItem) {
    tabItem.classList.remove('drag-over');
  }
}

async function handleDrop(e) {
  e.preventDefault();
  
  if (!draggedTab) return;
  
  const targetTabItem = e.target.closest('.tab-item');
  const windowSection = e.target.closest('.window-section');
  
  if (targetTabItem) {
    // 拖到另一个标签上 - 插入到该位置
    const targetTabId = parseInt(targetTabItem.dataset.tabId);
    const targetTab = allTabs.find(t => t.id === targetTabId);
    
    if (targetTab && draggedTab.id !== targetTabId) {
      await chrome.tabs.move(draggedTab.id, {
        windowId: targetTab.windowId,
        index: targetTab.index,
      });
    }
  } else if (windowSection) {
    // 拖到窗口区域 - 移动到该窗口末尾
    const windowId = parseInt(windowSection.closest('.window-section').dataset.windowId);
    
    if (windowId !== draggedTab.windowId) {
      await chrome.tabs.move(draggedTab.id, {
        windowId: windowId,
        index: -1,
      });
    }
  }
  
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
}

// ============ 右键菜单 ============

function showContextMenu(x, y, tab) {
  // 移除已有菜单
  hideContextMenu();
  
  const isMultiSelect = selectedTabIds.size > 1;
  const selectedCount = selectedTabIds.size;
  
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  
  if (isMultiSelect) {
    // 多选菜单
    menu.innerHTML = `
      <div class="context-menu-header">${selectedCount} tabs selected</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-action="create-group">📁 Create Group</div>
      <div class="context-menu-item" data-action="add-to-group">➕ Add to Group...</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-action="reload-selected">🔄 Reload All</div>
      <div class="context-menu-item" data-action="pin-selected">📌 Pin All</div>
      <div class="context-menu-item" data-action="new-window-selected">🪟 Move to new window</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item danger" data-action="close-selected">✕ Close ${selectedCount} tabs</div>
    `;
  } else {
    // 单选菜单
    menu.innerHTML = `
      <div class="context-menu-item" data-action="reload">🔄 Reload</div>
      <div class="context-menu-item" data-action="duplicate">📋 Duplicate</div>
      <div class="context-menu-item" data-action="pin">${tab.pinned ? '📌 Unpin' : '📌 Pin'}</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-action="create-group">📁 Create Group</div>
      <div class="context-menu-item" data-action="new-window">🪟 Move to new window</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-action="close-others">Close other tabs</div>
      <div class="context-menu-item danger" data-action="close">✕ Close tab</div>
    `;
  }
  
  // 定位
  menu.style.left = `${Math.min(x, window.innerWidth - 180)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - 250)}px`;
  
  // 事件处理
  menu.addEventListener('click', async (e) => {
    const item = e.target.closest('.context-menu-item');
    if (!item) return;
    
    const action = item.dataset.action;
    const selectedIds = Array.from(selectedTabIds);
    
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
      case 'new-window':
        await chrome.windows.create({ tabId: tab.id });
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
      case 'new-window-selected':
        const newWindow = await chrome.windows.create({ tabId: selectedIds[0] });
        for (let i = 1; i < selectedIds.length; i++) {
          await chrome.tabs.move(selectedIds[i], { windowId: newWindow.id, index: -1 });
        }
        break;
      case 'close-selected':
        await chrome.tabs.remove(selectedIds);
        break;
      
      // 分组操作
      case 'create-group':
        await createTabGroup(selectedIds.length > 0 ? selectedIds : [tab.id]);
        break;
      case 'add-to-group':
        await showAddToGroupMenu(x, y, selectedIds);
        return; // 不关闭菜单，显示子菜单
    }
    
    selectedTabIds.clear();
    
    hideContextMenu();
  });
  
  // 创建透明遮罩层，点击遮罩关闭菜单
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
  
  // 保存清理函数
  menu._cleanup = () => {
    document.removeEventListener('keydown', onKeyDown);
    overlay.remove();
  };
}

function hideContextMenu() {
  const menu = document.querySelector('.context-menu');
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
}

// ============ 工具函数 ============

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============ 会话管理 ============

async function loadSessions() {
  const result = await chrome.storage.local.get('sessions');
  return result.sessions || [];
}

async function saveSessions(sessions) {
  await chrome.storage.local.set({ sessions });
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
    id: Date.now().toString(),
    name: '',
    createdAt: new Date().toISOString(),
    windows: sessionWindows,
  };
}

async function saveCurrentSession() {
  const name = prompt('Enter session name:', `Session ${new Date().toLocaleDateString()}`);
  if (!name) return;
  
  const session = await captureCurrentSession();
  session.name = name;
  
  const sessions = await loadSessions();
  sessions.unshift(session); // 添加到开头
  
  // 最多保存 20 个会话
  if (sessions.length > 20) {
    sessions.pop();
  }
  
  await saveSessions(sessions);
  alert('Session saved!');
}

async function restoreSession(sessionId) {
  const sessions = await loadSessions();
  const session = sessions.find(s => s.id === sessionId);
  if (!session) return;
  
  const confirmRestore = confirm(
    `Restore session "${session.name}"?\n\n` +
    `This will open ${session.windows.length} window(s) with all tabs and groups.`
  );
  if (!confirmRestore) return;
  
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
  
  // 保存窗口名称
  await chrome.storage.local.set({ windowNames });
  
  hideSessionsPanel();
  alert('Session restored!');
}

async function deleteSession(sessionId) {
  if (!confirm('Delete this session?')) return;
  
  const sessions = await loadSessions();
  const filtered = sessions.filter(s => s.id !== sessionId);
  await saveSessions(filtered);
  
  // 刷新面板
  showSessionsPanel();
}

async function showSessionsPanel() {
  // 移除已有面板
  hideSessionsPanel();
  
  const sessions = await loadSessions();
  
  const panel = document.createElement('div');
  panel.className = 'sessions-panel';
  panel.innerHTML = `
    <div class="sessions-header">
      <h2>📚 Sessions</h2>
      <button class="sessions-close" title="Close">✕</button>
    </div>
    <div class="sessions-actions">
      <button class="btn-save-session">💾 Save Current Session</button>
    </div>
    <div class="sessions-list">
      ${sessions.length === 0 ? '<div class="sessions-empty">No saved sessions</div>' : ''}
      ${sessions.map(s => `
        <div class="session-item" data-session-id="${s.id}">
          <div class="session-info">
            <div class="session-name">${escapeHtml(s.name)}</div>
            <div class="session-meta">
              ${s.windows.length} window(s) · 
              ${s.windows.reduce((acc, w) => acc + w.tabs.length + w.groups.reduce((a, g) => a + g.tabs.length, 0), 0)} tabs ·
              ${new Date(s.createdAt).toLocaleDateString()}
            </div>
          </div>
          <div class="session-actions">
            <button class="btn-restore" title="Restore">▶️</button>
            <button class="btn-delete" title="Delete">🗑️</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
  
  // 事件处理
  panel.querySelector('.sessions-close').addEventListener('click', hideSessionsPanel);
  panel.querySelector('.btn-save-session').addEventListener('click', async () => {
    await saveCurrentSession();
    showSessionsPanel(); // 刷新列表
  });
  
  panel.querySelectorAll('.btn-restore').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const sessionId = e.target.closest('.session-item').dataset.sessionId;
      restoreSession(sessionId);
    });
  });
  
  panel.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const sessionId = e.target.closest('.session-item').dataset.sessionId;
      deleteSession(sessionId);
    });
  });
  
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

// ============ 启动 ============

document.addEventListener('DOMContentLoaded', init);

