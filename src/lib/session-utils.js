/**
 * 会话工具：窗口指纹、会话捕获、退化检测、checkpoint 保留、窗口名注册表
 *
 * 设计目标（解决「外力关闭浏览器后自动保存覆盖好数据」的问题）：
 * 1. 窗口名不再只依赖易变的 windowId，而是按「窗口指纹」（标签域名集合）持久化，
 *    重启后可重新认领回新的 windowId。
 * 2. 自动保存检测到当前状态相对上次明显退化（窗口/标签骤减）时，不直接覆盖，
 *    而是把上次的好 checkpoint 冻结成一份独立、可恢复的 ckpt，再把基线推进到当前状态。
 *    基线推进保证后续保存不会每次都 fork（不会刷屏）。
 */

export const MAX_CHECKPOINTS = 12;
export const MAX_REGISTRY_ENTRIES = 80;

/** 从 URL 取 hostname，失败返回空串 */
export function getHostname(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname || '';
  } catch {
    return '';
  }
}

/**
 * 计算窗口指纹：去重并排序后的 hostname 集合。
 * 忽略空白页 / 无 host 的标签，对查询参数、hash 不敏感。
 */
export function computeWindowFingerprint(tabs) {
  const hosts = [...new Set((tabs || []).map(t => getHostname(t.url)).filter(Boolean))].sort();
  return hosts.join('|');
}

/**
 * 从一个 chrome.tabs.Tab 捕获一条可归档的最小快照（供常驻组 per-tab archive 用）。
 * 与整窗 Session Archive 的 tab 结构对齐，另记 archivedAt 便于列表排序/展示。
 */
export function captureArchivedTab(tab) {
  return {
    url: tab?.url || '',
    title: tab?.title || '',
    favIconUrl: tab?.favIconUrl || '',
    archivedAt: Date.now(),
  };
}

/** 统计一个会话对象包含的标签总数（含分组内） */
export function countSessionTabs(session) {
  if (!session || !Array.isArray(session.windows)) return 0;
  return session.windows.reduce((acc, w) => {
    const ungrouped = Array.isArray(w.tabs) ? w.tabs.length : 0;
    const grouped = Array.isArray(w.groups)
      ? w.groups.reduce((a, g) => a + (Array.isArray(g.tabs) ? g.tabs.length : 0), 0)
      : 0;
    return acc + ungrouped + grouped;
  }, 0);
}

/**
 * 从 chrome.windows.getAll({populate:true}) 的结果捕获一份会话快照。
 * @param {Array} windows  populate 后的窗口数组
 * @param {Array} groups   chrome.tabGroups.query 结果
 * @param {Object} windowNames  { [windowId]: name }
 */
export function captureSession(windows, groups, windowNames = {}) {
  const sessionWindows = (windows || []).map(win => {
    const windowName = windowNames[win.id] || null;
    const windowGroups = (groups || []).filter(g => win.tabs.some(t => t.groupId === g.id));

    const groupsData = windowGroups.map(g => ({
      title: g.title || '',
      color: g.color,
      tabs: win.tabs
        .filter(t => t.groupId === g.id)
        .map(t => ({ url: t.url, title: t.title, pinned: t.pinned })),
    }));

    const ungroupedTabs = win.tabs
      .filter(t => t.groupId === -1 || !t.groupId)
      .map(t => ({ url: t.url, title: t.title, pinned: t.pinned }));

    return {
      name: windowName,
      fingerprint: computeWindowFingerprint(win.tabs),
      groups: groupsData,
      tabs: ungroupedTabs,
    };
  });

  return {
    savedAt: new Date().toISOString(),
    windows: sessionWindows,
  };
}

/**
 * 判断 next 相对 prev 是否「明显退化」（疑似数据丢失）。
 * 保守判定，宁可偶尔多保留一份 ckpt，也不漏掉真正的数据丢失。
 */
export function isDegraded(prev, next) {
  if (!prev || !Array.isArray(prev.windows) || prev.windows.length === 0) return false;

  const prevTabs = countSessionTabs(prev);
  const nextTabs = countSessionTabs(next);

  // 数据量太小时不做判断，避免噪声
  if (prevTabs < 8) return false;

  const prevWins = prev.windows.length;
  const nextWins = Array.isArray(next.windows) ? next.windows.length : 0;

  // 标签数腰斩且至少少了 6 个 → 退化
  if (nextTabs <= prevTabs * 0.5 && (prevTabs - nextTabs) >= 6) return true;

  // 窗口数减半（且原本是多窗口）并伴随标签明显减少 → 退化
  if (prevWins >= 2 && nextWins <= Math.ceil(prevWins / 2) && nextTabs < prevTabs * 0.7) return true;

  return false;
}

/**
 * 把一份会话冻结为 checkpoint 加入列表（最新在前），去重并裁剪到上限。
 * @param {Array} checkpoints 现有 checkpoint 列表
 * @param {Object} session    要保留的会话
 * @param {string} reason      保留原因，如 'auto' | 'manual'
 */
export function preserveCheckpoint(checkpoints, session, reason = 'auto', max = MAX_CHECKPOINTS) {
  const list = Array.isArray(checkpoints) ? checkpoints : [];
  if (!session || !Array.isArray(session.windows) || session.windows.length === 0) return list;
  // 去重：同一份 savedAt 不重复保留
  if (list.some(c => c.savedAt === session.savedAt)) return list;

  const checkpoint = {
    id: 'cp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    savedAt: session.savedAt,
    preservedAt: new Date().toISOString(),
    reason,
    windowCount: session.windows.length,
    tabCount: countSessionTabs(session),
    windows: session.windows,
  };

  return [checkpoint, ...list].slice(0, max);
}

/**
 * 指纹匹配：先精确匹配，再按 hostname 集合 Jaccard 相似度找最佳（>=0.6 命中）。
 * @returns {string|null} 命中的窗口名
 */
export function bestFingerprintMatch(fingerprint, registry) {
  if (!fingerprint || !registry) return null;
  if (registry[fingerprint]) return registry[fingerprint].name;

  const target = new Set(fingerprint.split('|').filter(Boolean));
  if (target.size === 0) return null;

  let best = null;
  let bestScore = 0;
  for (const [fp, info] of Object.entries(registry)) {
    const s = new Set(fp.split('|').filter(Boolean));
    if (s.size === 0) continue;
    let inter = 0;
    for (const h of target) if (s.has(h)) inter++;
    const union = new Set([...target, ...s]).size;
    const score = union > 0 ? inter / union : 0;
    if (score > bestScore) {
      bestScore = score;
      best = info.name;
    }
  }
  return bestScore >= 0.6 ? best : null;
}

/**
 * 为缺少名字的当前窗口，按指纹从注册表恢复名字。
 * @returns {{ names: Object, changed: boolean }}
 */
export function resolveWindowNames(windows, windowNames = {}, registry = {}) {
  const names = { ...windowNames };
  let changed = false;
  for (const win of windows || []) {
    if (names[win.id]) continue;
    const fp = computeWindowFingerprint(win.tabs);
    const match = bestFingerprintMatch(fp, registry);
    if (match) {
      names[win.id] = match;
      changed = true;
    }
  }
  return { names, changed };
}

/**
 * 用当前已命名窗口刷新注册表（指纹 -> 名字），按时间裁剪。
 */
export function updateRegistry(windows, windowNames = {}, registry = {}, max = MAX_REGISTRY_ENTRIES) {
  const reg = { ...registry };
  const now = Date.now();
  for (const win of windows || []) {
    const name = windowNames[win.id];
    if (!name) continue;
    const fp = computeWindowFingerprint(win.tabs);
    if (!fp) continue;
    reg[fp] = { name, ts: now };
  }
  const entries = Object.entries(reg).sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0)).slice(0, max);
  return Object.fromEntries(entries);
}
