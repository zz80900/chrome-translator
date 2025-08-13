# Chrome Translator

> 基于Chrome浏览器原生翻译API的沉浸式翻译用户脚本

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/daidr/fancy-translator)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Tampermonkey](https://img.shields.io/badge/tampermonkey-compatible-orange.svg)](https://www.tampermonkey.net/)

## ✨ 特性

### 🌐 核心翻译功能

- **整页翻译**：一键翻译网页所有文本内容
- **保留原文**：翻译后保留原文对照，便于理解
- **智能还原**：随时切换回原文显示
- **多线程翻译**：利用Web Workers提升翻译速度
- **自动检测语言**：智能识别源语言

### 🎯 划词翻译

- **选词翻译**：选中文本后显示翻译气泡
- **快捷键支持**：按F2快速翻译选中文本
- **智能重试**：翻译失败自动重试，最多3次
- **手动刷新**：支持手动重新翻译

### 🎨 用户界面

- **悬浮按钮**：右侧边栏智能悬浮按钮
- **拖拽定位**：长按拖拽自定义按钮位置
- **智能提示**：根据状态显示操作提示
- **现代设计**：毛玻璃效果，支持深色模式
- **进度显示**：翻译进度条和状态指示

### ⚙️ 智能配置

- **语言选择**：支持40+种语言互译
- **自动翻译**：可配置自动翻译新增内容
- **划词开关**：全局划词翻译功能开关
- **站点记忆**：每个网站独立的配置记忆

## 🚀 安装使用

### 前置要求

1. **Chrome浏览器** 版本 ≥ 138

2. **Tampermonkey扩展** 或其他用户脚本管理器

3. **启用翻译API**：

   ```
   chrome://flags/#translation-api
   设置为 "Enabled"
   ```

### 安装步骤

1. **安装Tampermonkey**
   - 访问 [Chrome Web Store](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
   - 点击"添加至Chrome"

2. **安装脚本**
   - 复制 `chrome-translator.js` 内容
   - 打开Tampermonkey管理面板
   - 点击"添加新脚本"
   - 粘贴代码并保存

3. **启用脚本**
   - 确保脚本状态为"启用"
   - 刷新目标网页即可使用

## 📖 使用指南

### 基础操作

#### 整页翻译

1. **点击悬浮按钮**：直接翻译整个页面
2. **查看提示**：悬停查看当前操作提示
3. **切换显示**：再次点击切换回原文

#### 划词翻译

1. **选中文本**：鼠标选择要翻译的文本
2. **点击气泡**：点击出现的翻译图标
3. **快捷键**：选中后按F2快速翻译
4. **重试翻译**：失败时点击刷新按钮

#### 设置配置

1. **打开设置**：点击悬浮按钮旁的齿轮图标
2. **选择语言**：设置源语言和目标语言
3. **功能开关**：启用/禁用自动翻译和划词翻译
4. **保存设置**：配置自动保存到本地

### 高级功能

#### 拖拽定位

- **长按按钮**：按住500ms后可拖拽
- **自由定位**：拖拽到屏幕任意位置
- **位置记忆**：下次访问保持相同位置

#### 自动翻译

- **新增内容**：自动翻译页面动态加载的内容
- **站点配置**：每个网站独立的自动翻译设置
- **智能检测**：避免重复翻译已处理内容

#### 错误处理

- **CSP兼容**：自动检测并适配内容安全策略
- **降级处理**：Worker不可用时自动切换主线程
- **重试机制**：网络错误时自动重试翻译

## 🛠️ 技术架构

### 核心技术

- **Chrome Translation API**：浏览器原生翻译引擎
- **Web Workers**：多线程并发翻译
- **MutationObserver**：DOM变化监听
- **Intl.DisplayNames**：国际化语言显示

### 兼容性处理

- **CSP检测**：自动检测内容安全策略限制
- **API降级**：不支持Worker时使用主线程
- **错误恢复**：翻译失败时的重试和恢复机制

### 性能优化

- **并发控制**：基于CPU核心数的并发限制
- **内存管理**：及时销毁翻译器实例
- **DOM优化**：高效的文本节点收集和处理

## 🔧 故障排除

### 常见问题

#### 翻译功能不可用

```bash
# 检查Chrome版本
chrome://version/

# 启用翻译API
chrome://flags/#translation-api
```

#### 悬浮按钮消失

- **刷新页面**：F5重新加载
- **检查脚本**：确认Tampermonkey中脚本已启用
- **清除缓存**：清除浏览器缓存后重试

#### 翻译速度慢

- **检查网络**：确保网络连接稳定
- **关闭其他标签**：减少浏览器负载
- **重启浏览器**：清理内存后重试

#### CSP错误

```
Refused to create a worker from 'blob:...' because it violates CSP
```

- **自动处理**：脚本会自动检测并切换到主线程模式
- **功能正常**：不影响翻译功能，仅影响并发性能

### 调试模式

```javascript
// 在控制台启用调试日志
localStorage.setItem('ft_debug', 'true');
```

## 🙏 致谢

- **Chrome Translation API**：提供强大的翻译能力

- **Tampermonkey**：优秀的用户脚本管理器

  

