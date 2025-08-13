# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Chrome Translator 是一个基于Chrome浏览器原生翻译API的沉浸式翻译用户脚本。项目提供整页翻译、划词翻译、自动翻译新增内容等功能，支持40+种语言互译。

## 核心架构

### 单文件结构
- `chrome-translator.js` - 主要脚本文件 (2207行)，包含所有功能实现
- 采用Tampermonkey用户脚本格式，通过GM_* API进行权限管理

### 主要组件
1. **翻译引擎** (`chrome-translator.js:198-500`)
   - 基于Chrome Translation API
   - 支持段落级翻译，保持语义连贯性
   - 自适应多线程处理 (2-6个并发)
   - AbortController支持即时取消翻译

2. **UI系统** (`chrome-translator.js:832-1147`)
   - 悬浮按钮和设置面板
   - 拖拽定位功能
   - 划词翻译气泡界面
   - 实时进度反馈

3. **存储管理** (`chrome-translator.js:76-81`)
   - 基于GM_getValue/GM_setValue
   - 支持每个网站独立配置
   - 语言设置和界面位置记忆

4. **DOM观察** (`chrome-translator.js:340-373`)
   - MutationObserver监听页面变化
   - 自动翻译新增内容
   - React SSR环境兼容性处理

## 关键功能实现

### 翻译流程
- `translatePage()` - 整页翻译入口
- `translateStreaming()` - 流式翻译处理
- `runWithConcurrency()` - 并发控制
- `restorePage()` - 还原原文

### 智能内容识别
- 跳过URL、代码块、技术术语
- React组件和SSR环境检测
- CSP (内容安全策略) 兼容性处理

### 错误处理和重试
- 指数退避重试策略 (最多3次)
- 自动降级: Worker → 主线程
- 错误率自适应并发调整

## 开发相关

### 调试模式
```javascript
// 在控制台启用调试日志
localStorage.setItem('ft_debug', 'true');
```

### 依赖和兼容性
- Chrome浏览器 ≥ 138版本
- 需要启用 `chrome://flags/#translation-api`
- Tampermonkey或其他用户脚本管理器

### 性能优化策略
- 批量DOM更新使用requestAnimationFrame
- 智能并发数控制 (基于硬件并发数)
- 优先级翻译队列 (页面顶部优先)
- 流式结果显示 (翻译完成立即显示)

## 代码约定

### 命名规范
- 功能函数使用驼峰命名法
- 常量使用大写下划线
- DOM元素ID使用连字符

### 错误处理
- 统一使用try-catch包装异步操作
- 详细的console.log调试信息
- 用户友好的错误提示

### 样式管理
- CSS通过GM_addStyle注入
- 使用ft-前缀避免样式冲突
- 支持深色模式和毛玻璃效果