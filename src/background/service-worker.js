/**
 * Background Service Worker
 * 处理插件的后台逻辑
 */

// 点击插件图标时打开侧边栏
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

// 安装时设置侧边栏行为
chrome.runtime.onInstalled.addListener(() => {
  // 设置侧边栏在所有页面可用
  chrome.sidePanel.setOptions({
    enabled: true,
  });
});
