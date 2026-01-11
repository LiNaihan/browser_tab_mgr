/**
 * Background Service Worker
 * 处理插件的后台逻辑
 */

const AUTO_SAVE_ALARM = 'auto-save-session';
const AUTO_SAVE_INTERVAL_MINUTES = 10;

// 安装时设置侧边栏行为和自动保存
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({
    enabled: true,
  });
  
  chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true,
  });
  
  // 创建自动保存 alarm（每 10 分钟）
  chrome.alarms.create(AUTO_SAVE_ALARM, {
    delayInMinutes: AUTO_SAVE_INTERVAL_MINUTES,
    periodInMinutes: AUTO_SAVE_INTERVAL_MINUTES,
  });
  
  console.log('[Session] Auto-save alarm created (every 10 min)');
});

// 确保每次启动时也设置
chrome.sidePanel.setPanelBehavior({
  openPanelOnActionClick: true,
});

// ============ 侧边栏同步功能 ============

const connectedSidePanels = new Map(); // windowId -> port

// 广播连接数量给所有侧边栏（用于更新图标）
async function broadcastConnectedCount() {
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  const msg = {
    type: 'connectedCountUpdate',
    connected: connectedSidePanels.size,
    total: windows.length
  };
  
  for (const [windowId, p] of connectedSidePanels.entries()) {
    try {
      p.postMessage(msg);
    } catch (err) {
      console.log(`[Sidebar Sync] Could not update window ${windowId}:`, err.message);
    }
  }
}

// 监听来自侧边栏的连接
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidepanel') return;
  
  let registeredWindowId = null;
  
  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'register' && msg.windowId) {
      registeredWindowId = msg.windowId;
      connectedSidePanels.set(msg.windowId, port);
      console.log(`[Sidebar Sync] Window ${msg.windowId} connected, total: ${connectedSidePanels.size}`);
      
      // 广播给所有侧边栏更新图标
      broadcastConnectedCount();
    }
    
    // 处理同步关闭请求（从按钮点击触发）
    if (msg.type === 'closeAllSidebars') {
      console.log('[Sidebar Sync] Closing all sidebars');
      for (const [windowId, p] of connectedSidePanels.entries()) {
        try {
          p.postMessage({ type: 'close' });
        } catch (err) {
          console.log(`[Sidebar Sync] Could not close window ${windowId}:`, err.message);
        }
      }
    }
    
    // 查询当前连接的侧边栏数量（执行 toggle 操作）
    if (msg.type === 'getConnectedCount') {
      const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
      port.postMessage({ 
        type: 'connectedCount', 
        connected: connectedSidePanels.size,
        total: windows.length
      });
    }
    
    // 仅查询连接数量（只更新图标，不执行操作）
    if (msg.type === 'getConnectedCountOnly') {
      const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
      port.postMessage({ 
        type: 'connectedCountUpdate', 
        connected: connectedSidePanels.size,
        total: windows.length
      });
    }
  });
  
  port.onDisconnect.addListener(() => {
    if (registeredWindowId) {
      connectedSidePanels.delete(registeredWindowId);
      console.log(`[Sidebar Sync] Window ${registeredWindowId} disconnected, total: ${connectedSidePanels.size}`);
      // Alt+A 关闭时不再同步关闭其他窗口
      
      // 广播给剩余侧边栏更新图标
      broadcastConnectedCount();
    }
  });
});

// 监听 alarm 触发
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === AUTO_SAVE_ALARM) {
    await autoSaveSession();
  }
});

// 自动保存会话
async function autoSaveSession() {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    const groups = await chrome.tabGroups.query({});
    
    // 加载自定义窗口名称
    const result = await chrome.storage.local.get('windowNames');
    const windowNames = result.windowNames || {};
    
    const sessionWindows = [];
    
    for (const win of windows) {
      const windowName = windowNames[win.id] || null;
      
      const windowGroups = groups.filter(g => 
        win.tabs.some(t => t.groupId === g.id)
      );
      
      const groupsData = windowGroups.map(g => ({
        title: g.title || '',
        color: g.color,
        tabs: win.tabs
          .filter(t => t.groupId === g.id)
          .map(t => ({ url: t.url, title: t.title, pinned: t.pinned }))
      }));
      
      const ungroupedTabs = win.tabs
        .filter(t => t.groupId === -1 || !t.groupId)
        .map(t => ({ url: t.url, title: t.title, pinned: t.pinned }));
      
      sessionWindows.push({
        name: windowName,
        groups: groupsData,
        tabs: ungroupedTabs,
      });
    }
    
    const session = {
      savedAt: new Date().toISOString(),
      windows: sessionWindows,
    };
    
    await chrome.storage.local.set({ currentSession: session });
    console.log('[Session] Auto-saved at', session.savedAt);
  } catch (err) {
    console.error('[Session] Auto-save failed:', err);
  }
}
