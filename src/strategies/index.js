/**
 * 标签页整理策略
 * TODO: 实现具体的整理策略逻辑
 */

/**
 * 根据 LLM 分析结果生成整理方案
 * @param {Array} tabs 原始标签页列表
 * @param {Object} analysis LLM 分析结果
 * @returns {Object} 整理方案
 */
export function organizeTabsStrategy(tabs, analysis) {
  // TODO: 实现整理策略
  // 
  // 可以在这里添加额外的后处理逻辑:
  // - 过滤掉 pinned 的标签
  // - 验证 tabIds 是否有效
  // - 合并相似的组
  // - 应用用户偏好设置
  
  return {
    groups: analysis?.groups || [],
    close: analysis?.close || [],
    duplicates: analysis?.duplicates || [],
  };
}

/**
 * 按域名分组（简单策略，不需要 LLM）
 * @param {Array} tabs 
 * @returns {Object}
 */
export function groupByDomain(tabs) {
  const domainMap = new Map();
  
  for (const tab of tabs) {
    if (tab.pinned) continue; // 跳过固定的标签
    
    const domain = tab.domain || 'other';
    if (!domainMap.has(domain)) {
      domainMap.set(domain, []);
    }
    domainMap.get(domain).push(tab.id);
  }
  
  const groups = [];
  for (const [domain, tabIds] of domainMap) {
    if (tabIds.length >= 2) { // 只对 2 个以上的标签创建组
      groups.push({
        name: domain,
        tabIds,
        color: 'blue',
      });
    }
  }
  
  return { groups, close: [], duplicates: [] };
}

/**
 * 找出重复标签页（基于 URL）
 * @param {Array} tabs 
 * @returns {Array} 重复标签对
 */
export function findDuplicates(tabs) {
  const urlMap = new Map();
  const duplicates = [];
  
  for (const tab of tabs) {
    const url = tab.url;
    if (urlMap.has(url)) {
      duplicates.push([urlMap.get(url), tab.id]);
    } else {
      urlMap.set(url, tab.id);
    }
  }
  
  return duplicates;
}

/**
 * 预定义的分类规则
 */
export const CATEGORY_RULES = {
  work: {
    domains: ['github.com', 'gitlab.com', 'notion.so', 'slack.com', 'linear.app'],
    keywords: ['jira', 'confluence', 'docs.google'],
    color: 'blue',
  },
  social: {
    domains: ['twitter.com', 'x.com', 'facebook.com', 'linkedin.com', 'reddit.com'],
    keywords: [],
    color: 'pink',
  },
  shopping: {
    domains: ['amazon.com', 'taobao.com', 'jd.com', 'ebay.com'],
    keywords: ['shop', 'store', 'cart'],
    color: 'yellow',
  },
  entertainment: {
    domains: ['youtube.com', 'netflix.com', 'bilibili.com', 'twitch.tv'],
    keywords: [],
    color: 'purple',
  },
  reference: {
    domains: ['stackoverflow.com', 'developer.mozilla.org', 'wikipedia.org'],
    keywords: ['docs', 'documentation', 'api'],
    color: 'cyan',
  },
};

