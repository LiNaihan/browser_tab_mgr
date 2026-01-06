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
