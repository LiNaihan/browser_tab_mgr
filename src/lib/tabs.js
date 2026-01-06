/**
 * Chrome Tabs API 封装
 */

export class TabsManager {
  /**
   * 获取所有窗口的所有标签页
   * @returns {Promise<Array>} 标签页列表
   */
  async getAllTabs() {
    const tabs = await chrome.tabs.query({});
    return tabs.map(tab => this.normalizeTab(tab));
  }

  /**
   * 获取当前窗口的所有标签页
   * @returns {Promise<Array>} 标签页列表
   */
  async getCurrentWindowTabs() {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    return tabs.map(tab => this.normalizeTab(tab));
  }

  /**
   * 标准化标签页数据
   * @param {chrome.tabs.Tab} tab 
   * @returns {Object} 标准化后的标签页数据
   */
  normalizeTab(tab) {
    return {
      id: tab.id,
      windowId: tab.windowId,
      url: tab.url,
      title: tab.title,
      favIconUrl: tab.favIconUrl,
      active: tab.active,
      pinned: tab.pinned,
      groupId: tab.groupId,
      index: tab.index,
      // 提取域名用于分析
      domain: this.extractDomain(tab.url),
    };
  }

  /**
   * 从 URL 提取域名
   * @param {string} url 
   * @returns {string}
   */
  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return '';
    }
  }

  /**
   * 创建标签组
   * @param {string} title 组名
   * @param {number[]} tabIds 标签页 ID 列表
   * @param {string} color 颜色
   * @returns {Promise<number>} 组 ID
   */
  async createGroup(title, tabIds, color = 'blue') {
    if (!tabIds || tabIds.length === 0) return null;

    const groupId = await chrome.tabs.group({ tabIds });
    
    await chrome.tabGroups.update(groupId, {
      title,
      color, // grey, blue, red, yellow, green, pink, purple, cyan, orange
    });

    return groupId;
  }

  /**
   * 将标签页添加到已有组
   * @param {number} groupId 组 ID
   * @param {number[]} tabIds 标签页 ID 列表
   */
  async addToGroup(groupId, tabIds) {
    await chrome.tabs.group({ groupId, tabIds });
  }

  /**
   * 解散标签组
   * @param {number} groupId 组 ID
   */
  async ungroup(groupId) {
    const tabs = await chrome.tabs.query({ groupId });
    const tabIds = tabs.map(t => t.id);
    if (tabIds.length > 0) {
      await chrome.tabs.ungroup(tabIds);
    }
  }

  /**
   * 关闭标签页
   * @param {number|number[]} tabIds 标签页 ID
   */
  async closeTab(tabIds) {
    await chrome.tabs.remove(tabIds);
  }

  /**
   * 移动标签页到指定位置
   * @param {number} tabId 
   * @param {Object} moveProperties 
   */
  async moveTab(tabId, moveProperties) {
    await chrome.tabs.move(tabId, moveProperties);
  }

  /**
   * 高亮/激活标签页
   * @param {number} tabId 
   */
  async activateTab(tabId) {
    await chrome.tabs.update(tabId, { active: true });
  }

  /**
   * 获取所有标签组
   * @returns {Promise<Array>}
   */
  async getAllGroups() {
    return await chrome.tabGroups.query({});
  }
}

