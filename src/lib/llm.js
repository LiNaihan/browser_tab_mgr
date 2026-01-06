/**
 * LLM API 封装层
 * TODO: 实现具体的 LLM 调用逻辑
 */

export class LLMClient {
  constructor(config = {}) {
    this.provider = config.provider || 'openai';
    this.apiKey = config.apiKey || '';
    this.model = config.model || 'gpt-4o-mini';
  }

  /**
   * 更新配置
   * @param {Object} config 
   */
  setConfig(config) {
    if (config.provider) this.provider = config.provider;
    if (config.apiKey) this.apiKey = config.apiKey;
    if (config.model) this.model = config.model;
  }

  /**
   * 分析标签页
   * @param {Array} tabs 标签页列表
   * @returns {Promise<Object>} 分析结果
   */
  async analyze(tabs) {
    // TODO: 实现 LLM 调用
    // 
    // 输入: tabs 数组，每个元素包含 { id, url, title, domain }
    // 
    // 期望输出格式:
    // {
    //   groups: [
    //     { name: "工作", tabIds: [1, 2, 3], color: "blue" },
    //     { name: "购物", tabIds: [4, 5], color: "yellow" },
    //   ],
    //   duplicates: [[1, 3], [5, 7]], // 重复的标签对
    //   suggestions: [
    //     { tabId: 6, action: "close", reason: "临时页面" }
    //   ]
    // }
    
    throw new Error('LLM analyze() not implemented');
  }

  /**
   * 构建用于分析的 prompt
   * @param {Array} tabs 
   * @returns {string}
   */
  buildPrompt(tabs) {
    const tabsInfo = tabs.map(tab => ({
      id: tab.id,
      title: tab.title,
      domain: tab.domain,
      url: tab.url,
    }));

    // TODO: 设计 prompt
    const prompt = `
你是一个浏览器标签页整理助手。请分析以下标签页，并给出整理建议。

标签页列表:
${JSON.stringify(tabsInfo, null, 2)}

请返回 JSON 格式的整理方案:
{
  "groups": [
    { "name": "分组名称", "tabIds": [标签ID列表], "color": "颜色" }
  ],
  "close": [可以关闭的标签ID列表],
  "duplicates": [[重复的标签ID对]]
}

颜色可选: grey, blue, red, yellow, green, pink, purple, cyan, orange
`;
    return prompt;
  }

  /**
   * 调用 OpenAI API
   * @param {string} prompt 
   * @returns {Promise<Object>}
   */
  async callOpenAI(prompt) {
    // TODO: 实现 OpenAI API 调用
    throw new Error('OpenAI API not implemented');
  }

  /**
   * 调用 Claude API
   * @param {string} prompt 
   * @returns {Promise<Object>}
   */
  async callClaude(prompt) {
    // TODO: 实现 Claude API 调用
    throw new Error('Claude API not implemented');
  }

  /**
   * 调用本地模型 (如 Ollama)
   * @param {string} prompt 
   * @returns {Promise<Object>}
   */
  async callLocal(prompt) {
    // TODO: 实现本地模型调用
    throw new Error('Local LLM not implemented');
  }
}

