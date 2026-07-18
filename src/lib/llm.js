/**
 * LLM 客户端（OpenAI 兼容接口）
 *
 * 通过 /chat/completions 让模型把一批标签页重新组织成「窗口 → 分组」两层结构。
 * 兼容任何 OpenAI 风格的服务（OpenAI、各类代理、Ollama 的 OpenAI 兼容端点等），
 * 只需配置 baseUrl / apiKey / model；系统提示词可在设置里自定义。
 */

// Chrome Tab Group 支持的 9 种颜色
export const VALID_GROUP_COLORS = [
  'grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange',
];

// 默认系统提示词（可在设置里编辑）。注意：输出 JSON 结构需与解析逻辑一致。
export const DEFAULT_ORGANIZE_PROMPT = [
  '你是一个浏览器标签页整理助手。',
  '用户会给你一批标签页，每个标签有一个数字 id（从 0 开始的小整数）、title、domain。',
  '请把它们按主题/任务重新组织成若干「窗口」，每个窗口里再分若干「分组」。',
  '规则：',
  '- tabIds 里必须填标签列表中真实存在的 id 数字（就是每个标签的 id 字段），不要编造、不要用标题。',
  '- 每个标签最多出现一次。',
  '- 窗口名、分组名都要简短（2-6 个字/词）。',
  `- 颜色只能从这些里选：${VALID_GROUP_COLORS.join(', ')}。`,
  '- 每个窗口至少包含 2 个标签；尽量让大多数标签都被归类。',
  '- 每个分组至少包含 2 个标签：不要建只有 1 个标签的分组，零散的标签宁可不分组。',
  '- 如果给出了「已有分组」，且某些标签明显属于其中某个，请让该分组的 name 与已有分组的名字完全一致（系统会自动把它们并入现有分组，不会重复建组）；其余标签再新建分组。',
  '- 如果觉得不需要拆成多个窗口，也可以只返回一个窗口。',
  '只返回 JSON，不要任何额外文字。格式示例（id 用列表里的实际数字）：',
  '{"windows":[{"name":"开发","groups":[{"name":"前端","color":"blue","tabIds":[0,2]},{"name":"文档","color":"cyan","tabIds":[5]}]},{"name":"购物","groups":[{"name":"比价","color":"yellow","tabIds":[1,3]}]}]}',
].join('\n');

export const DEFAULT_LLM_CONFIG = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  prompt: DEFAULT_ORGANIZE_PROMPT,
};

/** 从 URL 取域名，失败返回空串 */
function getDomain(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname || '';
  } catch {
    return '';
  }
}

/**
 * 规整 baseUrl：去掉结尾斜杠；若只填到域名（路径为空）则自动补 /v1。
 * 例：https://host → https://host/v1；https://host/v1 保持不变；带自定义路径的不动。
 */
function normalizeBaseUrl(baseUrl) {
  const raw = (baseUrl || DEFAULT_LLM_CONFIG.baseUrl).replace(/\/+$/, '');
  try {
    const u = new URL(raw);
    if (u.pathname === '' || u.pathname === '/') {
      return `${u.origin}/v1`;
    }
  } catch {
    // 非法 URL 交给 fetch 报错
  }
  return raw;
}

function buildUserPrompt(tabs, existingGroups = []) {
  const tabsInfo = tabs.map(tab => ({
    id: tab.id,
    title: tab.title || '',
    domain: getDomain(tab.url),
  }));
  const lines = [`共 ${tabs.length} 个标签，id 从 0 到 ${tabs.length - 1}。`];
  if (existingGroups && existingGroups.length) {
    lines.push('已有分组（若标签明显属于其中某个，请复用同名 name 以并入；否则新建）：');
    lines.push(JSON.stringify(
      existingGroups.map(g => ({ name: g.name, domains: g.domains || [] })),
      null,
      2,
    ));
  }
  lines.push('标签页列表（JSON）：');
  lines.push(JSON.stringify(tabsInfo, null, 2));
  return lines.join('\n');
}

/** 从字符串里截取第一个完整的 JSON 对象（括号配对，跳过字符串内的括号） */
function sliceFirstJsonObject(s) {
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** 从模型返回的文本里抽取 JSON（容错处理 code fence / 前后多余文字） */
function extractJson(text) {
  if (!text) throw new Error('Empty response from model');
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) s = fence[1].trim();

  // 优先：直接解析
  try {
    return JSON.parse(s);
  } catch {
    // 回退：只取第一个完整 JSON 对象（处理对象后还有多余文字的情况）
    const obj = sliceFirstJsonObject(s);
    if (obj) return JSON.parse(obj);
    throw new Error('模型返回的内容不是有效 JSON。');
  }
}

function cleanName(name, fallback) {
  return (typeof name === 'string' && name.trim()) ? name.trim().slice(0, 40) : fallback;
}

/** 规整一批分组：过滤无效/重复 id，校验颜色，丢弃成员数不足的组 */
function sanitizeGroups(rawGroups, valid, used, minSize, startColorIdx = 0) {
  const groups = [];
  let colorIdx = startColorIdx;
  for (const g of Array.isArray(rawGroups) ? rawGroups : []) {
    const ids = (Array.isArray(g?.tabIds) ? g.tabIds : [])
      .map(Number)
      .filter(id => valid.has(id) && !used.has(id));
    if (ids.length < minSize) continue;
    ids.forEach(id => used.add(id));
    const color = VALID_GROUP_COLORS.includes(g?.color)
      ? g.color
      : VALID_GROUP_COLORS[colorIdx % VALID_GROUP_COLORS.length];
    colorIdx++;
    groups.push({ name: cleanName(g?.name, 'Group'), color, tabIds: ids });
  }
  return groups;
}

/**
 * 把模型输出规整成安全的整理方案（id 仍是传入时的序号）。
 * 支持两种模式：
 * - windows：{ mode:'windows', windows:[{name, groups:[{name,color,tabIds}]}] }
 * - groups （自定义提示词下的扁平回退）：{ mode:'groups', groups:[...] }
 */
function normalizePlan(parsed, validTabIds) {
  const valid = new Set(validTabIds);
  const used = new Set();

  if (Array.isArray(parsed?.windows)) {
    const windows = [];
    for (const w of parsed.windows) {
      const groups = sanitizeGroups(w?.groups, valid, used, 1, windows.length);
      const total = groups.reduce((acc, g) => acc + g.tabIds.length, 0);
      if (total >= 2) {
        windows.push({ name: cleanName(w?.name, 'Window'), groups });
      }
    }
    return { mode: 'windows', windows };
  }

  // 回退：扁平分组（每组至少 2 个）
  const groups = sanitizeGroups(parsed?.groups, valid, used, 2);
  return { mode: 'groups', groups };
}

/**
 * 调用 LLM 分析标签页，返回规整后的整理方案。
 * @param {Array} tabs 标签数组（含 id/title/url），id 应为 0 起的小序号
 * @param {Object} config { baseUrl, apiKey, model, prompt }
 * @param {Array} existingGroups 已有分组信息 [{ name, domains }]，供模型判断是否并入
 */
export async function analyzeTabs(tabs, config, existingGroups = []) {
  const cfg = { ...DEFAULT_LLM_CONFIG, ...(config || {}) };
  if (!cfg.apiKey) throw new Error('未配置 API Key，请在设置里填写。');
  if (!tabs || tabs.length === 0) throw new Error('没有可整理的标签页。');

  const systemPrompt = (cfg.prompt && cfg.prompt.trim()) ? cfg.prompt : DEFAULT_ORGANIZE_PROMPT;
  const endpoint = `${normalizeBaseUrl(cfg.baseUrl)}/chat/completions`;
  const body = {
    model: cfg.model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildUserPrompt(tabs, existingGroups) },
    ],
    response_format: { type: 'json_object' },
  };
    // 不发 temperature：部分模型（如 claude-opus-4-8）已废弃该参数，带上会 400。

  let resp;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`无法连接到 LLM 服务：${err.message}`);
  }

  if (!resp.ok) {
    let detail = '';
    try {
      const errJson = await resp.json();
      detail = errJson?.error?.message || JSON.stringify(errJson);
    } catch {
      detail = await resp.text().catch(() => '');
    }
    throw new Error(`LLM 请求失败 (${resp.status}): ${detail || resp.statusText}`);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('模型未返回有效内容。');

  console.log('[LLM] raw response:', content);

  const parsed = extractJson(content);
  const validIds = tabs.map(t => t.id);
  const result = normalizePlan(parsed, validIds);
  result.raw = content;
  return result;
}
