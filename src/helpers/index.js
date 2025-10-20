/**
 * Handlebars助手函数中心
 * 
 * 导入并重导出所有助手函数，方便在generator中统一注册
 */

const formatters = require('./formatters');
const conditions = require('./conditions');
const utils = require('./utils');

/**
 * 注册所有助手函数到Handlebars实例
 * @param {Handlebars} handlebars Handlebars实例
 */
function registerAllHelpers(handlebars) {
  // 注册格式化助手函数
  Object.entries(formatters).forEach(([name, helper]) => {
    handlebars.registerHelper(name, helper);
  });

  // 注册条件判断助手函数
  Object.entries(conditions).forEach(([name, helper]) => {
    handlebars.registerHelper(name, helper);
  });

  // 注册工具类助手函数
  Object.entries(utils).forEach(([name, helper]) => {
    handlebars.registerHelper(name, helper);
  });

  // 注册HTML转义函数（作为助手函数，方便在模板中调用）
  handlebars.registerHelper('escapeHtml', function (text) {
    if (text === undefined || text === null) {
      return '';
    }
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  });

  // 注册非转义助手函数（安全输出HTML）
  handlebars.registerHelper('safeHtml', function (text) {
    if (text === undefined || text === null) {
      return '';
    }
    return new handlebars.SafeString(text);
  });
  /**
   * 这是一个自定义 Helper，用于从完整的 URL 中提取主机名。
   * @param {string} url - 完整的 URL 字符串。
   * @returns {string} - 提取出的主机名。
   */
  handlebars.registerHelper('hostname', function (url) {
    try {
      // 核心逻辑：使用原生 JavaScript 的 URL API
      const parsedUrl = new URL(url);
      
      return parsedUrl.origin;
    } catch (e) {
      // 如果 URL 无效，返回空字符串或进行错误处理
      console.error("Invalid URL passed to hostname helper:", url, e);
      return '';
    }
  });
}

// 导出所有助手函数和注册函数
module.exports = {
  formatters,
  conditions,
  utils,
  registerAllHelpers
}; 