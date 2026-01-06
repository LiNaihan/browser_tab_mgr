/**
 * Popup UI 逻辑
 */

// DOM Elements
const elements = {
  // Stats
  tabCount: document.getElementById('tabCount'),
  windowCount: document.getElementById('windowCount'),
  groupCount: document.getElementById('groupCount'),
  
  // Buttons
  analyzeBtn: document.getElementById('analyzeBtn'),
  quickGroupBtn: document.getElementById('quickGroupBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  applyBtn: document.getElementById('applyBtn'),
  cancelBtn: document.getElementById('cancelBtn'),
  retryBtn: document.getElementById('retryBtn'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
  closeSettingsBtn: document.getElementById('closeSettingsBtn'),
  
  // Sections
  resultsSection: document.getElementById('resultsSection'),
  resultsList: document.getElementById('resultsList'),
  loadingState: document.getElementById('loadingState'),
  errorState: document.getElementById('errorState'),
  errorMessage: document.getElementById('errorMessage'),
  settingsPanel: document.getElementById('settingsPanel'),
  
  // Settings inputs
  llmProvider: document.getElementById('llmProvider'),
  apiKey: document.getElementById('apiKey'),
  model: document.getElementById('model'),
};

// State
let currentPlan = null;

/**
 * 发送消息到 background service worker
 */
async function sendMessage(action, payload = {}) {
  return chrome.runtime.sendMessage({ action, payload });
}

/**
 * 初始化
 */
async function init() {
  await loadStats();
  await loadSettings();
  bindEvents();
}

/**
 * 加载统计数据
 */
async function loadStats() {
  try {
    const response = await sendMessage('GET_ALL_TABS');
    if (response.success) {
      const tabs = response.data;
      const windows = new Set(tabs.map(t => t.windowId));
      const groups = new Set(tabs.map(t => t.groupId).filter(id => id !== -1));
      
      elements.tabCount.textContent = tabs.length;
      elements.windowCount.textContent = windows.size;
      elements.groupCount.textContent = groups.size;
    }
  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}

/**
 * 加载设置
 */
async function loadSettings() {
  try {
    const response = await sendMessage('GET_SETTINGS');
    if (response.success) {
      const settings = response.data;
      elements.llmProvider.value = settings.llm?.provider || 'openai';
      elements.apiKey.value = settings.llm?.apiKey || '';
      elements.model.value = settings.llm?.model || 'gpt-4o-mini';
    }
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

/**
 * 绑定事件
 */
function bindEvents() {
  // Analyze with AI
  elements.analyzeBtn.addEventListener('click', handleAnalyze);
  
  // Quick group by domain
  elements.quickGroupBtn.addEventListener('click', handleQuickGroup);
  
  // Settings
  elements.settingsBtn.addEventListener('click', () => toggleSettings(true));
  elements.closeSettingsBtn.addEventListener('click', () => toggleSettings(false));
  elements.saveSettingsBtn.addEventListener('click', handleSaveSettings);
  
  // Results
  elements.applyBtn.addEventListener('click', handleApply);
  elements.cancelBtn.addEventListener('click', hideResults);
  
  // Error
  elements.retryBtn.addEventListener('click', handleAnalyze);
}

/**
 * 处理 AI 分析
 */
async function handleAnalyze() {
  showLoading();
  hideError();
  hideResults();
  
  try {
    const response = await sendMessage('ANALYZE_TABS');
    
    if (response.success) {
      currentPlan = response.data;
      showResults(currentPlan);
    } else {
      showError(response.error || 'Analysis failed');
    }
  } catch (error) {
    showError(error.message);
  } finally {
    hideLoading();
  }
}

/**
 * 处理快速分组（按域名）
 */
async function handleQuickGroup() {
  showLoading();
  hideError();
  hideResults();
  
  try {
    // TODO: 实现快速分组
    // 临时：直接调用 background 的 groupByDomain 策略
    showError('Quick group not implemented yet');
  } catch (error) {
    showError(error.message);
  } finally {
    hideLoading();
  }
}

/**
 * 应用整理方案
 */
async function handleApply() {
  if (!currentPlan) return;
  
  showLoading();
  
  try {
    const response = await sendMessage('APPLY_ORGANIZATION', currentPlan);
    
    if (response.success) {
      hideResults();
      await loadStats(); // 刷新统计
    } else {
      showError(response.error || 'Failed to apply changes');
    }
  } catch (error) {
    showError(error.message);
  } finally {
    hideLoading();
  }
}

/**
 * 保存设置
 */
async function handleSaveSettings() {
  const settings = {
    llm: {
      provider: elements.llmProvider.value,
      apiKey: elements.apiKey.value,
      model: elements.model.value,
    },
  };
  
  try {
    const response = await sendMessage('SAVE_SETTINGS', settings);
    if (response.success) {
      toggleSettings(false);
    } else {
      alert('Failed to save settings');
    }
  } catch (error) {
    alert('Failed to save settings: ' + error.message);
  }
}

/**
 * 显示结果
 */
function showResults(plan) {
  elements.resultsList.innerHTML = '';
  
  // 显示分组建议
  if (plan.groups && plan.groups.length > 0) {
    for (const group of plan.groups) {
      const item = document.createElement('div');
      item.className = 'result-item';
      item.innerHTML = `
        <div class="color-dot color-${group.color || 'blue'}"></div>
        <span class="group-name">${escapeHtml(group.name)}</span>
        <span class="tab-count">${group.tabIds.length} tabs</span>
      `;
      elements.resultsList.appendChild(item);
    }
  }
  
  // 显示关闭建议
  if (plan.close && plan.close.length > 0) {
    const item = document.createElement('div');
    item.className = 'result-item';
    item.innerHTML = `
      <div class="color-dot color-red"></div>
      <span class="group-name">Close</span>
      <span class="tab-count">${plan.close.length} tabs</span>
    `;
    elements.resultsList.appendChild(item);
  }
  
  if (elements.resultsList.children.length === 0) {
    elements.resultsList.innerHTML = '<p style="color: var(--text-secondary); text-align: center;">No suggestions available</p>';
  }
  
  elements.resultsSection.classList.remove('hidden');
}

/**
 * 隐藏结果
 */
function hideResults() {
  elements.resultsSection.classList.add('hidden');
  currentPlan = null;
}

/**
 * 显示/隐藏设置面板
 */
function toggleSettings(show) {
  if (show) {
    elements.settingsPanel.classList.remove('hidden');
  } else {
    elements.settingsPanel.classList.add('hidden');
  }
}

/**
 * 显示加载状态
 */
function showLoading() {
  elements.loadingState.classList.remove('hidden');
}

/**
 * 隐藏加载状态
 */
function hideLoading() {
  elements.loadingState.classList.add('hidden');
}

/**
 * 显示错误
 */
function showError(message) {
  elements.errorMessage.textContent = message;
  elements.errorState.classList.remove('hidden');
}

/**
 * 隐藏错误
 */
function hideError() {
  elements.errorState.classList.add('hidden');
}

/**
 * HTML 转义
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 启动
document.addEventListener('DOMContentLoaded', init);

