/**
 * Background Service Worker
 * 处理插件的后台逻辑
 */

import {
  captureSession,
  isDegraded,
  preserveCheckpoint,
  resolveWindowNames,
  updateRegistry,
} from '../lib/session-utils.js';

const AUTO_SAVE_ALARM = 'auto-save-session';
const AUTO_SAVE_INTERVAL_MINUTES = 10;

// ============ 标签活跃度追踪（陈旧检测用）============
// chrome.tabs.Tab.lastAccessed 会在浏览器重启/扩展重载后被刷新，导致所有标签
// 看起来「刚用过」。这里自己记一份 tabId -> 上次真正激活的时间戳，存 storage：
// 扩展重载（标签 id 不变）时数据保留；仅整浏览器重启换了 tab id 才会丢，届时退回 lastAccessed。
const TAB_ACTIVE_KEY = 'tabLastActive';

async function recordTabActive(tabId) {
  if (typeof tabId !== 'number') return;
  try {
    const store = await chrome.storage.local.get(TAB_ACTIVE_KEY);
    const map = store[TAB_ACTIVE_KEY] || {};
    map[tabId] = Date.now();
    await chrome.storage.local.set({ [TAB_ACTIVE_KEY]: map });
  } catch (err) {
    console.error('[Stale] recordTabActive failed:', err);
  }
}

// 为尚无记录的现存标签播种（用 lastAccessed 或当前时间作起点），并清理已关闭标签的残留
async function seedTabActivity() {
  try {
    const tabs = await chrome.tabs.query({});
    const store = await chrome.storage.local.get(TAB_ACTIVE_KEY);
    const map = store[TAB_ACTIVE_KEY] || {};
    const liveIds = new Set();
    const now = Date.now();
    for (const t of tabs) {
      liveIds.add(t.id);
      // 只给「没记录过」的标签播种，避免扩展重载时覆盖已有的真实历史
      if (map[t.id] === undefined) {
        map[t.id] = typeof t.lastAccessed === 'number' ? t.lastAccessed : now;
      }
    }
    // 清理已不存在的 tabId
    for (const key of Object.keys(map)) {
      if (!liveIds.has(Number(key))) delete map[key];
    }
    await chrome.storage.local.set({ [TAB_ACTIVE_KEY]: map });
  } catch (err) {
    console.error('[Stale] seedTabActivity failed:', err);
  }
}

chrome.tabs.onActivated.addListener(({ tabId }) => recordTabActive(tabId));
chrome.tabs.onCreated.addListener((tab) => recordTabActive(tab.id));
chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    const store = await chrome.storage.local.get(TAB_ACTIVE_KEY);
    const map = store[TAB_ACTIVE_KEY] || {};
    if (map[tabId] !== undefined) {
      delete map[tabId];
      await chrome.storage.local.set({ [TAB_ACTIVE_KEY]: map });
    }
  } catch (err) {
    console.error('[Stale] onRemoved cleanup failed:', err);
  }
});

// SW 每次唤醒都补种一次（保留已有记录，只补新标签、清残留）
seedTabActivity();

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
//
// 关键改动（防止外力关闭浏览器后覆盖好数据）：
// - 先按指纹恢复窗口名（重启后 windowId 变了也能认领回名字）。
// - 若当前状态相对上次明显退化（窗口/标签骤减），不直接覆盖，而是把上次的好
//   checkpoint 冻结成一份独立可恢复的 ckpt，再把基线推进到当前状态。
async function autoSaveSession() {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    const groups = await chrome.tabGroups.query({});

    const store = await chrome.storage.local.get([
      'windowNames',
      'currentSession',
      'sessionCheckpoints',
      'windowNameRegistry',
    ]);

    const registry = store.windowNameRegistry || {};

    // 按指纹恢复缺失的窗口名（即便侧边栏从未打开过也能恢复）
    const { names, changed } = resolveWindowNames(windows, store.windowNames || {}, registry);

    const newSession = captureSession(windows, groups, names);
    const prev = store.currentSession || null;
    let checkpoints = store.sessionCheckpoints || [];

    // 退化检测：把上次的好状态冻结为 ckpt，避免被本次覆盖
    if (prev && isDegraded(prev, newSession)) {
      checkpoints = preserveCheckpoint(checkpoints, prev, 'auto');
      console.warn(
        '[Session] Degradation detected, preserved previous checkpoint before overwrite'
      );
    }

    const newRegistry = updateRegistry(windows, names, registry);

    const toSet = {
      currentSession: newSession,
      sessionCheckpoints: checkpoints,
      windowNameRegistry: newRegistry,
    };
    // 仅在恢复出新名字时回写 windowNames（只新增、不删除）
    if (changed) toSet.windowNames = names;

    await chrome.storage.local.set(toSet);
    console.log('[Session] Auto-saved at', newSession.savedAt);
  } catch (err) {
    console.error('[Session] Auto-save failed:', err);
  }
}
