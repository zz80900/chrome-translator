// ==UserScript==
// @name         Chrome Translator
// @namespace    https://ndllz.cn/
// @version      1.0.5
// @description  Chrome 浏览器原生翻译功能的沉浸式翻译脚本，支持整页翻译、保留原文对照和自动翻译新增内容
// @author       ndllz
// @license      GPL-3.0 License
// @match        *://*/*
// @run-at       document-end
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// ==/UserScript==
(function () {
    'use strict';
  
    // --------------------------
    // Config
    // --------------------------
    const LANGUAGES = [
      'zh-Hans','zh-Hant','en','ja','ru','ko','es','fr','de','pt','it','nl','sv',
      'da','fi','no','id','th','pl','tr','vi','ar','hi','bn','kn','mr','hr','cs',
      'hu','uk','he','bg','ro','te','lt','sl','el','ta'
    ];
    const STORAGE_KEYS = {
      source: 'ft_source_lang',
      target: 'ft_target_lang',
      autoObserve: 'ft_auto_observe_',
      position: 'ft_position',
      disabled: 'ft_disabled',
      siteDisabled: 'ft_site_disabled_',
      wordSelection: 'ft_word_selection_global', // 全局划词翻译开关
    };
    
  
    // --------------------------
    // Utils: page-context API access
    // --------------------------
    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    function hasTranslator() { return 'Translator' in pageWindow; }
    function hasLanguageDetector() { return 'LanguageDetector' in pageWindow; }
    const DEFAULTS = inferDefaultPair();
  
    // DisplayNames for language labels
    const displayNames = (() => {
      try {
        if ('Intl' in window && 'DisplayNames' in Intl) {
          const locales = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en-US'];
          return new Intl.DisplayNames(locales, { type: 'language' });
        }
      } catch {}
      return null;
    })();
    function langLabel(code) {
      if (!displayNames) return code;
      try {
        const l = displayNames.of(code);
        return l ? `${l} <${code}>` : code;
      } catch {
        return code;
      }
    }
  
    function inferDefaultPair() {
      const nav = navigator.language || 'en-US';
      const isZh = /^zh\b/i.test(nav);
      return {
        source: hasLanguageDetector() ? 'auto' : (isZh ? 'zh-Hans' : 'en'),
        target: 'zh-Hans',
        autoObserve: false,
        position: { top: 50, right: 12 },
      };
    }
  
    function getStored(key, fallback) {
      try { return GM_getValue ? GM_getValue(key, fallback) : fallback; } catch { return fallback; }
    }
    function setStored(key, val) {
      try { GM_setValue && GM_setValue(key, val); } catch {}
    }
  
    // --------------------------
    // Register menu commands
    // --------------------------
    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('重新启用 Chrome Translator', () => {
        setStored(STORAGE_KEYS.disabled, false);
        setStored(STORAGE_KEYS.siteDisabled + location.hostname, false);
        location.reload();
      });
      
      GM_registerMenuCommand('清除本站禁用状态', () => {
        setStored(STORAGE_KEYS.siteDisabled + location.hostname, false);
        location.reload();
      });
    }
  
    // --------------------------
    // Check if disabled
    // --------------------------
    if (getStored(STORAGE_KEYS.disabled, false)) {
      console.log('[ChromeTranslator] Permanently disabled');
      return;
    }
    if (getStored(STORAGE_KEYS.siteDisabled + location.hostname, false)) {
      console.log('[ChromeTranslator] Disabled for this site');
      return;
    }
  
    // --------------------------
    // State variables - 需要在buildUI之前定义
    // --------------------------
  let sourceLang = getStored(STORAGE_KEYS.source, DEFAULTS.source);
  let targetLang = getStored(STORAGE_KEYS.target, DEFAULTS.target);
  let autoObserve = !!getStored(STORAGE_KEYS.autoObserve + location.hostname, DEFAULTS.autoObserve);
  let detectorInstance = null;
  let translatorInstance = null;
  let inProgress = false;
  let observer = null;
  let lastPairKey = '';
  const MAX_CONCURRENCY = Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 4) - 2));
  let keepOriginal = true; // 默认保留原文
  let isPageTranslated = false; // 跟踪页面翻译状态
  let wordSelectionEnabled = !!getStored(STORAGE_KEYS.wordSelection, false); // 全局划词翻译开关
  let selectionBubble = null; // 划词翻译悬浮框
  let translationPopup = null; // 翻译结果弹窗
  
    // --------------------------
    // UI
    // --------------------------
    let ui;
    try {
      injectStyles();
      ui = buildUI();
      document.documentElement.appendChild(ui.container);
      console.log('[ChromeTranslator] UI initialized successfully');
    } catch (error) {
      console.error('[ChromeTranslator] UI initialization failed:', error);
      return;
    }
  
  // 检查页面是否已翻译
  function checkPageTranslationStatus() {
    const pairs = document.querySelectorAll('span.ft-pair');
    const oldTranslated = document.querySelectorAll('[data-ft-original]');
    const segmentTranslated = document.querySelectorAll('[data-ft-segment-translated]');
    const segmentWrappers = document.querySelectorAll('.ft-segment-wrapper');
    return pairs.length > 0 || oldTranslated.length > 0 || segmentTranslated.length > 0 || segmentWrappers.length > 0;
  }
  
    // init UI selections
    populateSelect(ui.sourceSelect, buildSourceOptions());
    populateSelect(ui.targetSelect, buildTargetOptions());
    ui.sourceSelect.value = sourceLang;
    ui.targetSelect.value = targetLang;
    ui.observeCheckbox.checked = autoObserve;
    // keepOriginal will be bound after UI is extended below
  
    // bind events
    ui.translateBtn.addEventListener('click', () => translatePage(false));
    ui.observeCheckbox.addEventListener('change', (e) => {
      autoObserve = e.target.checked;
      setStored(STORAGE_KEYS.autoObserve + location.hostname, autoObserve);
      setupObserver(autoObserve);
    });
    // 保留原文功能已默认启用
    ui.sourceSelect.addEventListener('change', () => {
      sourceLang = ui.sourceSelect.value;
      setStored(STORAGE_KEYS.source, sourceLang);
    });
    ui.targetSelect.addEventListener('change', () => {
      targetLang = ui.targetSelect.value;
      setStored(STORAGE_KEYS.target, targetLang);
      ui.container.updateFabTooltip(); // 更新提示词
    });
  
      // auto observe initially
  setupObserver(autoObserve);
  
  // 初始化保留原文功能（默认启用）
  toggleKeepOriginal(keepOriginal);
  
  // 初始化时检查页面翻译状态
  isPageTranslated = checkPageTranslationStatus();
  
  // 根据页面状态设置悬浮按钮样式
  if (isPageTranslated) {
    ui.fab.classList.add('ft-translated');
  }
  
  // 初始化划词翻译
  if (wordSelectionEnabled) {
    setupSelectionListeners();
  }
  
    // --------------------------
    // Core: Translate workflow
    // --------------------------
        async function translatePage(isFromObserver) {
      if (inProgress) return;
      inProgress = true;
      setPanelBusy(true);
      setButtonState('loading', '准备翻译...');
      
      try {
        // 异步优化：并行执行可用性检查和文本收集
        const [availabilityOk, nodes] = await Promise.all([
          ensureAvailability(),
          Promise.resolve(collectTextNodes(document.body))
        ]);
        
        if (!availabilityOk) return;
        
        console.log(`[ChromeTranslator] 异步并行翻译模式：${nodes.length} 个文本节点`);
        ui.progressText.textContent = `扫描到 ${nodes.length} 个文本节点，准备异步翻译...`;
        setButtonState('loading', `准备翻译 ${nodes.length} 个文本`);
        setProgress(0, true);

        // 异步优化：并行执行语言检测和Worker检查
        const [realSource, useWorker] = await Promise.all([
          resolveRealSourceLanguage(),
          canUseWorkerTranslator('auto', targetLang) // 先用auto检查，后面会更新
        ]);
        
        const pairKey = `${realSource}->${targetLang}`;
        if (pairKey !== lastPairKey) {
          lastPairKey = pairKey;
        }

        // 异步优化：并行初始化翻译器和更新Worker检查
        const [instanceOk, finalUseWorker] = await Promise.all([
          ensureTranslator(realSource, targetLang),
          useWorker ? canUseWorkerTranslator(realSource, targetLang) : Promise.resolve(false)
        ]);
        
        if (!instanceOk) return;

        // 实时进度更新 - 每个翻译完成立即更新
        let done = 0;
        const startTime = Date.now();
        const updateProgress = () => { 
          const percentage = nodes.length > 0 ? (done / nodes.length) * 100 : 0;
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = done / elapsed;
          const eta = done > 0 ? (nodes.length - done) / rate : 0;
          
          ui.progressText.textContent = `已翻译 ${done}/${nodes.length} (${rate.toFixed(1)}/s, 预计${eta.toFixed(0)}s)`;
          setButtonState('loading', `翻译中 ${done}/${nodes.length}`);
          setProgress(percentage, true);
        };

        // 流式翻译显示 - 使用异步队列和批量DOM更新
        const domUpdateQueue = [];
        let domUpdateScheduled = false;
        
        const scheduleDOMUpdate = () => {
          if (domUpdateScheduled) return;
          domUpdateScheduled = true;
          
          requestAnimationFrame(() => {
            // 批量应用DOM更新
            const updates = domUpdateQueue.splice(0);
            for (const update of updates) {
              try {
                applyTranslationToNode(update.node, update.original, update.leading, update.trailing, update.translated);
              } catch (error) {
                console.warn('[ChromeTranslator] DOM更新失败:', error);
              }
            }
            domUpdateScheduled = false;
            
            // 如果还有更新，继续调度
            if (domUpdateQueue.length > 0) {
              scheduleDOMUpdate();
            }
          });
        };

        if (finalUseWorker) {
          const pool = await createWorkerPool(MAX_CONCURRENCY, realSource, targetLang);
          try {
            const tasks = nodes.map(({ node, original, leading, trailing }, index) => async () => {
              if (!original.trim()) { 
                done++; 
                updateProgress(); 
                return; 
              }
              
              try {
                const translated = await pool.translate(original.replace(/\n/g, '<br>'));
                const pretty = (translated || '').replace(/<br>/g, '\n').trim();
                
                // 异步DOM更新队列
                domUpdateQueue.push({ node, original, leading, trailing, translated: pretty });
                scheduleDOMUpdate();
                
              } catch (error) {
                console.warn('[ChromeTranslator] Worker翻译失败:', error);
              } finally { 
                done++; 
                updateProgress(); 
              }
            });
            
            // 使用高级并发控制器
            await runWithAdvancedConcurrency(tasks, MAX_CONCURRENCY, {
              adaptiveLimit: true,
              onProgress: (stats) => {
                if (stats.successCount % 10 === 0) {
                  console.log(`[ChromeTranslator] Worker并发状态: 活跃${stats.active}, 队列${stats.queued}, 限制${stats.currentLimit}`);
                }
              },
              onError: (error) => {
                console.warn('[ChromeTranslator] Worker翻译错误:', error.message);
              },
              priorityFn: (index) => {
                // 优先翻译页面顶部的内容
                return Math.max(0, 1000 - index);
              }
            });
          } finally { 
            pool.terminate(); 
          }
        }
        else {
          // 主线程异步翻译 - 使用高级并发控制
          const tasks = nodes.map(({ node, original, leading, trailing }, index) => async () => {
            if (!original.trim()) { 
              done++; 
              updateProgress(); 
              return; 
            }
            
            try {
              const translated = await translateStreaming(`${original.replace(/\n/g, '<br>')}`);
              const pretty = (translated || '').replace(/<br>/g, '\n').trim();
              
              // 异步DOM更新队列
              domUpdateQueue.push({ node, original, leading, trailing, translated: pretty });
              scheduleDOMUpdate();
              
            } catch (error) {
              console.warn('[ChromeTranslator] 主线程翻译失败:', error);
            } finally { 
              done++; 
              updateProgress(); 
            }
          });
          
          await runWithAdvancedConcurrency(tasks, Math.max(2, Math.min(4, MAX_CONCURRENCY)), {
            adaptiveLimit: true,
            onProgress: (stats) => {
              if (stats.successCount % 5 === 0) {
                console.log(`[ChromeTranslator] 主线程并发状态: 活跃${stats.active}, 队列${stats.queued}, 限制${stats.currentLimit}`);
              }
            },
            onError: (error) => {
              console.warn('[ChromeTranslator] 主线程翻译错误:', error.message);
            },
            priorityFn: (index) => {
              // 优先翻译页面顶部的内容
              return Math.max(0, 1000 - index);
            }
          });
        }
        
        // 等待所有DOM更新完成
        await new Promise(resolve => {
          const checkComplete = () => {
            if (domUpdateQueue.length === 0 && !domUpdateScheduled) {
              resolve();
            } else {
              setTimeout(checkComplete, 50);
            }
          };
          checkComplete();
        });
  
              ui.progressText.textContent = `翻译完成：${done}/${nodes.length}`;
      
      // 更新翻译状态
      isPageTranslated = true;
      
      // 显示成功状态
      ui.fab.classList.add('ft-success', 'ft-translated');
      ui.container.updateFabTooltip(); // 更新提示词
      setButtonState('success', `翻译完成 ${done}/${nodes.length}`);
      setProgress(100, false); // 隐藏进度条
      setTimeout(() => {
        ui.fab.classList.remove('ft-success');
        // 保留ft-translated状态指示
      }, 3000); // 3秒后移除成功状态
              
      } catch (err) {
        showError(err);
        setButtonState('error', '翻译失败');
        setProgress(0, false); // 隐藏进度条
      } finally {
        setPanelBusy(false);
        inProgress = false;
        
        // ensure UI is still present after translation
        setTimeout(() => {
          if (!document.querySelector('.ft-ui')) {
            console.warn('[ChromeTranslator] UI missing after translation, restoring...');
            try {
              document.documentElement.appendChild(ui.container);
            } catch (e) {
              console.error('[ChromeTranslator] Failed to restore UI after translation:', e);
            }
          }
        }, 100);
      }
    }
  
    function restorePage() {
      let restored = 0;
      
      // 还原新的段落翻译结构
      const segmentWrappers = Array.from(document.querySelectorAll('.ft-segment-wrapper'));
      for (const wrapper of segmentWrappers) {
        const originalText = wrapper.getAttribute('data-ft-segment-original') || '';
        if (originalText) {
          const textNode = document.createTextNode(originalText);
          wrapper.replaceWith(textNode);
          restored++;
        }
      }
      
      // 还原旧的翻译对结构
      const pairs = Array.from(document.querySelectorAll('span.ft-pair'));
      for (const w of pairs) {
        const original = w.getAttribute('data-ft-original-text') || w.querySelector('.ft-original')?.textContent || '';
        const leading = w.getAttribute('data-ft-leading') || '';
        const trailing = w.getAttribute('data-ft-trailing') || '';
        const textNode = document.createTextNode(leading + original + trailing);
        w.replaceWith(textNode);
        restored++;
      }
      
      // 清理段落级别的翻译标记
      const segmentElements = Array.from(document.querySelectorAll('[data-ft-segment-translated]'));
      for (const element of segmentElements) {
        element.removeAttribute('data-ft-segment-translated');
        element.removeAttribute('data-ft-segment-original');
        element.removeAttribute('data-ft-segment-translated');
      }
      
      // 兼容性：处理旧式翻译标记
      const iter = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      let node;
      while ((node = iter.nextNode())) {
        const parent = node.parentElement;
        if (!parent) continue;
        if (parent.closest('.ft-ui')) continue;
        if (parent.hasAttribute('data-ft-original')) {
          node.textContent = parent.getAttribute('data-ft-original-text') || node.textContent;
          parent.removeAttribute('data-ft-original');
          parent.removeAttribute('data-ft-original-text');
          restored++;
        }
      }
      
      ui.progressText.textContent = `已还原 ${restored} 个翻译元素`;
    
      // 更新翻译状态
      isPageTranslated = false;
      
      // 显示成功状态并移除翻译状态
      ui.fab.classList.add('ft-success');
      ui.fab.classList.remove('ft-translated');
      ui.container.updateFabTooltip(); // 更新提示词
      setButtonState('success', `已还原 ${restored} 个元素`);
      setTimeout(() => {
        ui.fab.classList.remove('ft-success');
      }, 2000); // 2秒后移除成功状态
    }
  
    function setupObserver(enabled) {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (!enabled) return;
      observer = new MutationObserver((mutations) => {
        // check if UI was accidentally removed and restore it
        if (!document.querySelector('.ft-ui')) {
          console.warn('[ChromeTranslator] UI was removed, restoring...');
          try {
            document.documentElement.appendChild(ui.container);
          } catch (e) {
            console.error('[ChromeTranslator] Failed to restore UI:', e);
          }
        }
        
        // debounce: translate new nodes only
        const added = [];
        for (const m of mutations) {
          m.addedNodes && added.push(...m.addedNodes);
        }
        const needTranslation = added.some(n => n.nodeType === 1 && !n.closest?.('.ft-ui'));
        if (needTranslation) {
          // schedule lightly
          setTimeout(() => translatePage(true), 600);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  
    // --------------------------
    // Translator/Detector helpers
    // --------------------------
    async function ensureAvailability() {
      if (!hasTranslator()) {
        ui.statusText.textContent = '此浏览器不支持原生翻译（需 Chrome 138+）';
        return false;
      }
      return true;
    }
  
    async function ensureDetector() {
      if (!hasLanguageDetector() || sourceLang !== 'auto') return null;
      if (detectorInstance) return detectorInstance;
      setPanelBusy(true, '下载语言检测模型中...');
      try {
        detectorInstance = await pageWindow.LanguageDetector.create({
          monitor(m) {
            m.addEventListener('downloadprogress', (e) => {
              if (typeof e.loaded === 'number') {
                ui.statusText.textContent = `检测模型下载 ${(e.loaded * 100).toFixed(2)}%`;
              }
            });
          },
        });
        ui.statusText.textContent = '检测模型已就绪';
        return detectorInstance;
      } catch (e) {
        ui.statusText.textContent = '检测模型加载失败';
        return null;
      } finally {
        setPanelBusy(false);
      }
    }
  
    async function resolveRealSourceLanguage() {
      if (sourceLang !== 'auto') return sourceLang;
      const det = await ensureDetector();
      if (!det) return 'und';
      // sample: title + a bit of body text
      const sample = getSampleText(1500);
      const list = await det.detect(sample).catch(() => []);
      const lang = (list && list[0] && list[0].detectedLanguage) || 'und';
      return lang === 'und' ? 'und' : lang;
    }
  
    async function ensureTranslator(src, tgt) {
      setPanelBusy(true, '准备翻译模型...');
      try {
        // 检查当前实例是否匹配语言对且仍然有效
        if (translatorInstance && 
            translatorInstance.sourceLanguage === src && 
            translatorInstance.targetLanguage === tgt) {
          try {
            // 验证实例是否仍然可用（通过检查配额）
            await translatorInstance.measureInputUsage('test');
            ui.statusText.textContent = '翻译模型就绪';
            return true;
          } catch (error) {
            console.log('[ChromeTranslator] 现有翻译器实例无效，重新创建:', error.message);
            // 实例无效，销毁并重新创建
            try {
              translatorInstance.destroy();
            } catch (destroyError) {
              console.warn('[ChromeTranslator] 销毁翻译器实例失败:', destroyError);
            }
            translatorInstance = null;
          }
        } else if (translatorInstance) {
          // 语言对不匹配，销毁旧实例
          console.log('[ChromeTranslator] 语言对改变，销毁旧翻译器实例');
          try {
            translatorInstance.destroy();
          } catch (destroyError) {
            console.warn('[ChromeTranslator] 销毁翻译器实例失败:', destroyError);
          }
          translatorInstance = null;
        }

        // 检查翻译器可用性
        const availability = await pageWindow.Translator.availability({
          sourceLanguage: src,
          targetLanguage: tgt,
        });
        
        if (availability === 'unavailable') {
          ui.statusText.textContent = `不支持 ${src} -> ${tgt} 翻译`;
          return false;
        }
        
        ui.statusText.textContent = availability === 'available' ? '翻译模型已缓存，正在加载...' : '翻译模型下载中...';
        
        // 创建新的翻译器实例
        translatorInstance = await pageWindow.Translator.create({
          sourceLanguage: src,
          targetLanguage: tgt,
          monitor(m) {
            m.addEventListener('downloadprogress', (e) => {
              if (typeof e.loaded === 'number') {
                ui.statusText.textContent = `翻译模型 ${(e.loaded * 100).toFixed(2)}%`;
              }
            });
          },
        });
        
        ui.statusText.textContent = '翻译模型就绪';
        return true;
      } catch (e) {
        console.error('[ChromeTranslator] 翻译器初始化失败:', e);
        showError(e);
        // 确保清理无效实例
        if (translatorInstance) {
          try {
            translatorInstance.destroy();
          } catch (destroyError) {
            console.warn('[ChromeTranslator] 清理失败的翻译器实例时出错:', destroyError);
          }
          translatorInstance = null;
        }
        return false;
      } finally {
        setPanelBusy(false);
      }
    }
  
    async function translateStreaming(text) {
      const res = translatorInstance.translateStreaming(text);
      const reader = res.getReader();
      let out = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        out += value;
      }
      return out;
    }
  
    // --------------------------
    // Concurrency helpers and Worker pool
    // --------------------------
        // 优化的并发控制器 - 支持动态调整和优先级
    function createAdvancedLimiter(limit, options = {}) {
      let active = 0;
      const queue = [];
      const { 
        onProgress = () => {}, 
        onError = () => {},
        adaptiveLimit = false 
      } = options;
      
      let currentLimit = limit;
      let successCount = 0;
      let errorCount = 0;
      
      const next = () => {
        if (active >= currentLimit || queue.length === 0) return;
        
        const { fn, resolve, reject, priority = 0 } = queue.shift();
        active++;
        
        const startTime = Date.now();
        Promise.resolve()
          .then(fn)
          .then(result => {
            successCount++;
            const duration = Date.now() - startTime;
            
            // 自适应并发限制
            if (adaptiveLimit) {
              if (duration < 1000 && errorCount === 0 && currentLimit < limit * 2) {
                currentLimit = Math.min(currentLimit + 1, limit * 2);
              }
            }
            
            onProgress({ successCount, errorCount, active, queued: queue.length, duration });
            resolve(result);
          })
          .catch(error => {
            errorCount++;
            
            // 自适应降低并发
            if (adaptiveLimit && errorCount > successCount * 0.1) {
              currentLimit = Math.max(Math.floor(currentLimit * 0.8), 1);
            }
            
            onError(error);
            reject(error);
          })
          .finally(() => { 
            active--; 
            next(); 
          });
      };
      
      return {
        execute: (fn, priority = 0) => new Promise((resolve, reject) => { 
          queue.push({ fn, resolve, reject, priority }); 
          // 按优先级排序
          queue.sort((a, b) => b.priority - a.priority);
          next(); 
        }),
        getStats: () => ({ active, queued: queue.length, successCount, errorCount, currentLimit })
      };
    }

    // 优化的并发执行器
    async function runWithAdvancedConcurrency(tasks, limit, options = {}) {
      const limiter = createAdvancedLimiter(limit, options);
      
      return Promise.all(tasks.map((task, index) => 
        limiter.execute(task, options.priorityFn ? options.priorityFn(index) : 0)
      ));
    }

    // 保留原有的简单版本作为备用
    function createLimiter(limit) {
      let active = 0;
      const queue = [];
      const next = () => {
        if (active >= limit || queue.length === 0) return;
        const { fn, resolve, reject } = queue.shift();
        active++;
        Promise.resolve()
          .then(fn)
          .then(resolve, reject)
          .finally(() => { active--; next(); });
      };
      return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
    }

    async function runWithConcurrency(tasks, limit) {
      const limiter = createLimiter(limit);
      await Promise.all(tasks.map(task => limiter(task)));
    }
  
      async function canUseWorkerTranslator(src, tgt) {
    try {
      // 首先检测CSP是否允许创建Worker
      if (!canCreateWorker()) {
        console.log('[ChromeTranslator] Web Workers blocked by CSP, falling back to main thread');
        return false;
      }
      
      const url = createWorkerURL();
      const worker = new Worker(url);
      URL.revokeObjectURL(url);
      const ready = new Promise((resolve) => {
        const timer = setTimeout(() => { resolve(false); worker.terminate(); }, 3000);
        worker.onmessage = (e) => {
          if (e.data && e.data.type === 'ready') { clearTimeout(timer); resolve(true); worker.terminate(); }
          else if (e.data && e.data.type === 'error') { clearTimeout(timer); resolve(false); worker.terminate(); }
        };
      });
      worker.postMessage({ type: 'init-check' });
      return await ready;
    } catch (e) {
      console.log('[ChromeTranslator] Worker creation failed:', e.message);
      return false;
    }
  }

  function canCreateWorker() {
    try {
      // 尝试创建一个简单的Worker来检测CSP
      const testWorkerCode = 'self.postMessage("test");';
      const blob = new Blob([testWorkerCode], { type: 'application/javascript' });
      const workerURL = URL.createObjectURL(blob);
      const testWorker = new Worker(workerURL);
      testWorker.terminate();
      URL.revokeObjectURL(workerURL);
      return true;
    } catch (e) {
      // 如果创建Worker失败，说明被CSP阻止
      console.log('[ChromeTranslator] Worker creation blocked by CSP:', e.message);
      return false;
    }
  }
  
    function createWorkerURL() {
      const code = `self.onmessage = async (e) => {
    const data = e.data || {};
    try {
      if (data.type === 'init-check') {
        if ('Translator' in self) postMessage({ type: 'ready' });
        else postMessage({ type: 'error', message: 'Translator not in worker' });
        return;
      }
    } catch (err) { postMessage({ type: 'error', message: String(err) }); }
  };`;
      const blob = new Blob([code], { type: 'application/javascript' });
      return URL.createObjectURL(blob);
    }
  
      async function createWorkerPool(size, src, tgt) {
    // 在创建Worker池之前检查CSP
    if (!canCreateWorker()) {
      throw new Error('Web Workers are blocked by Content Security Policy. Falling back to main thread.');
    }
    
    // Build full worker script with translator support
    const code = `let translator = null;
self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    if (msg.type === 'init') {
      const availability = await self.Translator.availability({ sourceLanguage: msg.src, targetLanguage: msg.tgt });
      if (availability === 'unavailable') { postMessage({ type: 'init-error', message: 'unavailable' }); return; }
      translator = await self.Translator.create({ sourceLanguage: msg.src, targetLanguage: msg.tgt });
      postMessage({ type: 'inited' });
      return;
    }
    if (msg.type === 'translate') {
      if (!translator) { postMessage({ type: 'translate-error', id: msg.id, message: 'no-translator' }); return; }
      const res = translator.translateStreaming(msg.text);
      const reader = res.getReader();
      let out = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        out += value;
      }
      postMessage({ type: 'translated', id: msg.id, text: out });
      return;
    }
  } catch (err) {
    if (msg.type === 'translate') postMessage({ type: 'translate-error', id: msg.id, message: String(err) });
    else postMessage({ type: 'init-error', message: String(err) });
  }
};`;
    
    let url, workers;
    try {
      url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
      workers = Array.from({ length: size }, () => new Worker(url));
      URL.revokeObjectURL(url);
    } catch (e) {
      if (url) URL.revokeObjectURL(url);
      console.log('[ChromeTranslator] Failed to create worker pool:', e.message);
      throw new Error('Failed to create worker pool due to CSP restrictions.');
    }
  
      await Promise.all(workers.map((w) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => { w.terminate(); reject(new Error('init timeout')); }, 10000);
        w.onmessage = (e) => {
          if (e.data && e.data.type === 'inited') { clearTimeout(timer); resolve(null); }
        };
        w.onerror = (e) => { clearTimeout(timer); reject(new Error('worker error')); };
        w.postMessage({ type: 'init', src, tgt });
      })).catch((e) => {
        workers.forEach(w => w.terminate());
        throw e;
      }));
  
      let nextId = 1;
      const pending = new Map();
      let idx = 0;
      workers.forEach((w) => {
        w.onmessage = (e) => {
          const data = e.data || {};
          if (data.type === 'translated') {
            const entry = pending.get(data.id);
            if (entry) { pending.delete(data.id); entry.resolve(data.text); }
          } else if (data.type === 'translate-error') {
            const entry = pending.get(data.id);
            if (entry) { pending.delete(data.id); entry.reject(new Error(data.message || 'translate error')); }
          }
        };
      });
  
      function pick() { const w = workers[idx]; idx = (idx + 1) % workers.length; return w; }
  
      return {
        translate(text) {
          const id = nextId++;
          const worker = pick();
          const p = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
          worker.postMessage({ type: 'translate', id, text });
          return p;
        },
        terminate() { workers.forEach(w => w.terminate()); pending.forEach(p => p.reject(new Error('terminated'))); pending.clear(); },
      };
    }
  
    // --------------------------
    // DOM: text segments (improved for better translation)
    // --------------------------
    
    // 新的分段翻译：按DOM元素收集完整文本段落
    function collectTextSegments(root) {
      const segments = [];
      const processedElements = new Set();
      
      // 定义容器元素类型 - 这些元素通常包含完整的语义单元
      const containerTags = new Set([
        'p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'li', 'td', 'th', 'blockquote', 'article', 'section',
        'header', 'footer', 'main', 'aside', 'nav', 'figcaption',
        'summary', 'details', 'label', 'legend', 'caption'
      ]);
      
      // 遍历所有可能的容器元素
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
        acceptNode(element) {
          // 跳过已处理的元素
          if (processedElements.has(element)) return NodeFilter.FILTER_REJECT;
          
          // 跳过翻译UI
          if (element.closest('.ft-ui')) return NodeFilter.FILTER_REJECT;
          
          // 跳过隐藏元素
          const style = getComputedStyle(element);
          if (style && (style.display === 'none' || style.visibility === 'hidden')) {
            return NodeFilter.FILTER_REJECT;
          }
          
          // 跳过不需要翻译的元素
          const tag = element.tagName.toLowerCase();
          if (['script','style','noscript','textarea','input','code','pre','svg','math','kbd','samp'].includes(tag)) {
            return NodeFilter.FILTER_REJECT;
          }
          
          // 跳过标记为不翻译的元素
          if (element.closest('.notranslate,[translate="no"]')) return NodeFilter.FILTER_REJECT;
          
          // 跳过已翻译的元素
          if (element.hasAttribute('data-ft-original') || element.closest('.ft-pair')) {
            return NodeFilter.FILTER_REJECT;
          }
          
          // 只处理容器元素或包含文本的元素
          if (containerTags.has(tag) || hasDirectTextContent(element)) {
            return NodeFilter.FILTER_ACCEPT;
          }
          
          return NodeFilter.FILTER_SKIP;
        }
      });
      
      let element;
      while ((element = walker.nextNode())) {
        if (processedElements.has(element)) continue;
        
        const segment = collectElementTextSegment(element, processedElements);
        if (segment && segment.textNodes.length > 0) {
          segments.push(segment);
        }
      }
      
      return segments;
    }
    
    // 检查元素是否直接包含文本内容
    function hasDirectTextContent(element) {
      for (const child of element.childNodes) {
        if (child.nodeType === Node.TEXT_NODE && child.nodeValue.trim()) {
          return true;
        }
      }
      return false;
    }
    
    // 收集单个元素的文本段落
    function collectElementTextSegment(element, processedElements) {
      const textNodes = [];
      let fullText = '';
      
      // 递归收集元素内的所有文本节点
      function collectTextNodesRecursive(node) {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.nodeValue || '';
          if (text.trim()) {
            textNodes.push({
              node: node,
              text: text,
              startIndex: fullText.length,
              endIndex: fullText.length + text.length
            });
            fullText += text;
          }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          // 跳过不需要翻译的子元素
          const tag = node.tagName.toLowerCase();
          if (['script','style','noscript','textarea','input','code','pre','svg','math','kbd','samp'].includes(tag)) {
            return;
          }
          
          // 跳过标记为不翻译的子元素
          if (node.closest('.notranslate,[translate="no"]')) return;
          
          // 跳过已翻译的子元素
          if (node.hasAttribute('data-ft-original') || node.closest('.ft-pair')) return;
          
          // 递归处理子节点
          for (const child of node.childNodes) {
            collectTextNodesRecursive(child);
          }
        }
      }
      
      collectTextNodesRecursive(element);
      
      // 清理和验证文本内容
      const trimmedText = fullText.trim();
      if (!trimmedText || trimmedText.length < 2) return null;
      
      // 跳过纯标点符号
      if (/^[\s\p{P}\p{S}]+$/u.test(trimmedText)) return null;
      
      // 标记元素为已处理
      processedElements.add(element);
      
      return {
        element: element,
        textNodes: textNodes,
        originalText: fullText,
        trimmedText: trimmedText
      };
    }
    
    // --------------------------
    // 智能内容类型检测 - 针对Markdown优化
    // --------------------------
    
    // 检测文本是否包含不应翻译的内容
    function shouldSkipTranslation(text, parentElement) {
      if (!text || !text.trim()) return true;
      
      const trimmedText = text.trim();
      
      // 0. 检测父元素环境 - 优先级最高
      if (isInCodeEnvironment(parentElement)) return true;
      
      // 1. 检测URL和链接
      if (isUrlOrLink(trimmedText)) return true;
      
      // 2. 检测代码和技术术语
      if (isCodeOrTechnicalTerm(trimmedText)) return true;
      
      // 3. 检测Markdown语法
      if (isMarkdownSyntax(trimmedText)) return true;
      
      // 4. 检测纯标点符号
      if (/^[\s\p{P}\p{S}]+$/u.test(trimmedText)) return true;
      
      // 5. 检测数字和版本号
      if (isNumberOrVersion(trimmedText)) return true;
      
      // 6. 检测短的技术词汇（长度小于等于3的英文单词，可能是API名称）
      if (isShortTechnicalWord(trimmedText)) return true;
      
      return false;
    }
    
    // 检测是否在代码环境中
    function isInCodeEnvironment(element) {
      if (!element) return false;
      
      // 检查元素及其父元素的类名和属性
      let current = element;
      let depth = 0;
      
      while (current && depth < 5) { // 最多检查5层父元素
        // 检查标签名
        const tagName = current.tagName?.toLowerCase();
        if (['code', 'pre', 'kbd', 'samp', 'tt', 'var'].includes(tagName)) {
          return true;
        }
        
        // 检查类名
        const className = current.className || '';
        if (typeof className === 'string') {
          const codeClassPatterns = [
            /\bcode\b/i,
            /\bpre\b/i,
            /\bhighlight\b/i,
            /\blanguage-/i,
            /\bhljs\b/i,
            /\bcodehilite\b/i,
            /\bsyntax\b/i,
            /\bmonospace\b/i
          ];
          
          if (codeClassPatterns.some(pattern => pattern.test(className))) {
            return true;
          }
        }
        
        // 检查data属性
        if (current.hasAttribute && (
          current.hasAttribute('data-lang') ||
          current.hasAttribute('data-language') ||
          current.hasAttribute('data-code')
        )) {
          return true;
        }
        
        current = current.parentElement;
        depth++;
      }
      
      return false;
    }
    
    // 检测短的技术词汇
    function isShortTechnicalWord(text) {
      // 短的技术词汇通常是API名称、配置项等
      if (text.length > 3) return false;
      
      // 纯大写字母（如API、URL、CSS）
      if (/^[A-Z]{2,3}$/.test(text)) return true;
      
      // 常见的技术缩写
      const technicalAbbreviations = [
        'API', 'URL', 'CSS', 'HTML', 'XML', 'JSON', 'HTTP', 'HTTPS', 'FTP',
        'SSH', 'SSL', 'TLS', 'DNS', 'CDN', 'SDK', 'CLI', 'GUI', 'IDE',
        'SQL', 'NoSQL', 'REST', 'SOAP', 'JWT', 'OAuth', 'CORS', 'CSRF'
      ];
      
      return technicalAbbreviations.includes(text.toUpperCase());
    }
    
    // 检测URL和链接
    function isUrlOrLink(text) {
      // URL模式
      const urlPatterns = [
        /^https?:\/\/[^\s]+$/i,
        /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(\/[^\s]*)?$/,
        /^[a-zA-Z0-9.-]+\.io(\/[^\s]*)?$/i,
        /^[a-zA-Z0-9.-]+\.com(\/[^\s]*)?$/i,
        /^[a-zA-Z0-9.-]+\.org(\/[^\s]*)?$/i,
        /^kubernetes\.io[^\s]*$/i,
        /^github\.com[^\s]*$/i
      ];
      
      return urlPatterns.some(pattern => pattern.test(text));
    }
    
    // 检测代码和技术术语
    function isCodeOrTechnicalTerm(text) {
      // 代码和技术术语模式
      const codePatterns = [
        /^[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_.]*$/, // 如 spec.ingressClassName
        /^[a-zA-Z_][a-zA-Z0-9_]*::[a-zA-Z_][a-zA-Z0-9_]*$/, // 如 namespace::class
        /^--[a-zA-Z-]+(-[a-zA-Z-]+)*$/, // 如 --nginx-ingress-classes
        /^-[a-zA-Z]$/, // 单字母参数如 -f
        /^[A-Z_][A-Z0-9_]*$/, // 常量如 MAX_SIZE
        /^[a-z]+[A-Z][a-zA-Z0-9]*$/, // 驼峰命名如 camelCase
        /^\$[a-zA-Z_][a-zA-Z0-9_]*$/, // 变量如 $variable
        /^@[a-zA-Z_][a-zA-Z0-9_]*$/, // 装饰器如 @Component
        /^#[a-zA-Z_][a-zA-Z0-9_]*$/, // 哈希如 #header
        /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/, // 路径如 path/to
        /^[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+$/, // 键值对如 key:value
        /^[a-zA-Z][a-zA-Z0-9]*\(\)$/, // 函数调用如 function()
        /^[a-zA-Z][a-zA-Z0-9]*\[\]$/, // 数组如 array[]
        /^[a-zA-Z][a-zA-Z0-9]*\{\}$/, // 对象如 object{}
      ];
      
      // 特定的技术术语和配置项
      const technicalTerms = [
        'kubernetes', 'ingress', 'nginx', 'controller', 'rollouts', 'argo',
        'spec', 'metadata', 'annotations', 'labels', 'namespace', 'deployment',
        'service', 'configmap', 'secret', 'pod', 'node', 'cluster',
        'kubectl', 'helm', 'docker', 'container', 'image', 'registry',
        'yaml', 'json', 'api', 'endpoint', 'webhook', 'crd', 'rbac'
      ];
      
      // 检查是否匹配模式
      if (codePatterns.some(pattern => pattern.test(text))) return true;
      
      // 检查是否为技术术语（不区分大小写）
      if (technicalTerms.includes(text.toLowerCase())) return true;
      
      return false;
    }
    
    // 检测Markdown语法
    function isMarkdownSyntax(text) {
      const markdownPatterns = [
        /^#{1,6}\s/, // 标题 # ## ###
        /^\*\s/, // 列表 *
        /^-\s/, // 列表 -
        /^\d+\.\s/, // 有序列表 1.
        /^>\s/, // 引用 >
        /^```/, // 代码块 ```
        /^`[^`]+`$/, // 内联代码 `code`
        /^\[[^\]]+\]\([^)]+\)$/, // 链接 [text](url)
        /^!\[[^\]]*\]\([^)]+\)$/, // 图片 ![alt](url)
      ];
      
      return markdownPatterns.some(pattern => pattern.test(text));
    }
    
    // 检测数字和版本号
    function isNumberOrVersion(text) {
      const numberPatterns = [
        /^\d+$/, // 纯数字
        /^\d+\.\d+(\.\d+)?$/, // 版本号如 1.0.0
        /^v\d+\.\d+(\.\d+)?$/, // 版本号如 v1.0.0
        /^\d+[a-zA-Z]+$/, // 如 5px, 10ms
      ];
      
      return numberPatterns.some(pattern => pattern.test(text));
    }
    
    // 增强的collectTextNodes函数 - 支持智能内容过滤
    function collectTextNodes(root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          // skip empty/whitespace
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          const p = node.parentElement;
          if (!p) return NodeFilter.FILTER_REJECT;
          
          // skip UI panel - critical to prevent UI removal
          if (p.closest('.ft-ui')) return NodeFilter.FILTER_REJECT;
          
          // skip hidden
          const style = getComputedStyle(p);
          if (style && (style.display === 'none' || style.visibility === 'hidden')) return NodeFilter.FILTER_REJECT;
          
          // skip code/script/etc - 扩展代码标签列表
          const tag = p.tagName.toLowerCase();
          if (['script','style','noscript','textarea','input','code','pre','svg','math','kbd','samp','tt','var'].includes(tag)) {
            return NodeFilter.FILTER_REJECT;
          }
          
          // skip marked notranslate
          if (p.closest('.notranslate,[translate="no"]')) return NodeFilter.FILTER_REJECT;
          
          // 智能内容检测 - 跳过不应翻译的内容
          if (shouldSkipTranslation(node.nodeValue, p)) return NodeFilter.FILTER_REJECT;
          
          // already translated using legacy flag
          if (p.hasAttribute('data-ft-original')) return NodeFilter.FILTER_SKIP;
          
          // skip if inside ft-pair wrapper
          if (p.closest('.ft-pair')) return NodeFilter.FILTER_REJECT;
          
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      
      const nodes = [];
      let n;
      while ((n = walker.nextNode())) {
        const original = n.nodeValue || '';
        const leading = original.match(/^\s*/)[0] || '';
        const trailing = original.match(/\s*$/)[0] || '';
        nodes.push({ node: n, original, leading, trailing });
      }
      
      console.log(`[ChromeTranslator] 智能过滤后收集到 ${nodes.length} 个可翻译文本节点`);
      return nodes;
    }
  
    function markTranslated(textNode, original) {
      const el = textNode.parentElement;
      if (!el) return;
      if (!el.hasAttribute('data-ft-original')) {
        el.setAttribute('data-ft-original', '1');
        el.setAttribute('data-ft-original-text', original);
      }
    }
  
    function getSampleText(limit) {
      const parts = [document.title || ''];
      const nodes = collectTextNodes(document.body).slice(0, 200);
      for (const it of nodes) {
        parts.push(it.original);
        if (parts.join('\n').length > limit) break;
      }
      return parts.join('\n').slice(0, limit);
    }
  
    // --------------------------
    // UI building
    // --------------------------
    function buildSourceOptions() {
      const options = [];
      options.push({ value: 'auto', label: `自动检测` + (hasLanguageDetector() ? '' : '（不支持）'), disabled: !hasLanguageDetector() });
      for (const l of LANGUAGES) options.push({ value: l, label: langLabel(l) });
      return options;
    }
    function buildTargetOptions() {
      return LANGUAGES.map(l => ({ value: l, label: langLabel(l) }));
    }
  
    function populateSelect(select, options) {
      select.innerHTML = '';
      for (const opt of options) {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        if (opt.disabled) o.disabled = true;
        select.appendChild(o);
      }
    }
  
        function setPanelBusy(busy, text) {
      ui.container.classList.toggle('ft-busy', !!busy);
      if (text) ui.statusText.textContent = text;
    }

    function showError(e) {
      console.error('[ChromeTranslator] error:', e);
      ui.statusText.textContent = `错误：${e?.message || e}`;
    }

    // 按钮状态管理
    function setButtonState(state, text) {
      const btn = ui.translateBtn;
      if (!btn) return;
      
      // 清除所有状态类
      btn.classList.remove('success', 'error');
      btn.disabled = false;
      
      // 移除加载动画
      const existingSpinner = btn.querySelector('.ft-loading-spinner');
      if (existingSpinner) {
        existingSpinner.remove();
      }
      
      switch (state) {
        case 'loading':
          btn.disabled = true;
          btn.innerHTML = `<div class="ft-loading-spinner"></div><span>${text || '翻译中...'}</span>`;
          break;
        case 'success':
          btn.classList.add('success');
          btn.textContent = text || '翻译完成';
          setTimeout(() => {
            if (btn.classList.contains('success')) {
              btn.classList.remove('success');
              btn.textContent = '翻译';
            }
          }, 2000);
          break;
        case 'error':
          btn.classList.add('error');
          btn.textContent = text || '翻译失败';
          setTimeout(() => {
            if (btn.classList.contains('error')) {
              btn.classList.remove('error');
              btn.textContent = '翻译';
            }
          }, 3000);
          break;
        default:
          btn.textContent = text || '翻译';
      }
    }

    // 进度条管理
    function setProgress(percentage, show = true) {
      if (!ui.progressContainer || !ui.progressBar) return;
      
      if (show) {
        ui.progressContainer.classList.remove('hidden');
        ui.progressBar.style.width = `${Math.max(0, Math.min(100, percentage))}%`;
      } else {
        ui.progressContainer.classList.add('hidden');
        ui.progressBar.style.width = '0%';
      }
    }
  
    function buildUI() {
      const container = document.createElement('div');
      container.className = 'ft-ui';
      
      // 恢复位置
      const savedPos = getStored(STORAGE_KEYS.position, DEFAULTS.position);
      container.style.top = savedPos.top + '%';
      container.style.right = savedPos.right + 'px';
  
      // 主悬浮按钮
      const fab = document.createElement('div');
      fab.className = 'ft-fab';
      fab.title = 'Chrome 翻译';
  
      // 移除拖拽手柄，直接使用悬浮按钮拖拽
      
      // 设置按钮（悬停显示）
      const settingsBtn = document.createElement('div');
      settingsBtn.className = 'ft-settings-btn';
      settingsBtn.innerHTML = '⚙';
      settingsBtn.title = '设置';
      
          // 移除关闭按钮
  
      // 设置面板（独立弹窗）
      const settingsPanel = document.createElement('div');
      settingsPanel.className = 'ft-settings-panel';
      
          // 移除关闭选项面板
  
      const panel = document.createElement('div');
      panel.className = 'ft-panel';
  
      const row1 = document.createElement('div');
      row1.className = 'ft-row';
      const sourceSelect = document.createElement('select');
      sourceSelect.className = 'ft-select';
      const arrow = document.createElement('span'); arrow.textContent = '→';
      const targetSelect = document.createElement('select');
      targetSelect.className = 'ft-select';
      row1.append(sourceSelect, arrow, targetSelect);
  
      const row2 = document.createElement('div');
      row2.className = 'ft-row';
      const translateBtn = document.createElement('button');
      translateBtn.className = 'ft-btn';
      translateBtn.textContent = '翻译整页';
      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'ft-btn ghost';
      restoreBtn.textContent = '还原';
      row2.append(translateBtn, restoreBtn);
  
      const row3 = document.createElement('label');
      row3.className = 'ft-row ft-check';
      const observeCheckbox = document.createElement('input');
      observeCheckbox.type = 'checkbox';
      const observeText = document.createElement('span');
      observeText.textContent = '自动翻译新增内容';
      row3.append(observeCheckbox, observeText);
  
      const statusText = document.createElement('div');
      statusText.className = 'ft-status';
      statusText.textContent = hasTranslator() ? '就绪' : '此浏览器不支持原生翻译（需 Chrome 138+）';
  
      const progressText = document.createElement('div');
      progressText.className = 'ft-status ft-progress';
      progressText.textContent = '';
  
            // 构建设置面板内容 - 参考沉浸式翻译设计
      settingsPanel.innerHTML = `
        <div class="ft-settings-header">
          <span>翻译设置</span>
          <div class="ft-settings-close">×</div>
        </div>
        <div class="ft-lang-section">
          <div class="ft-lang-row">
            <select class="ft-lang-select ft-source-select">${row1.querySelector('select:first-of-type').innerHTML}</select>
            <div class="ft-lang-arrow">→</div>
            <select class="ft-lang-select ft-target-select">${row1.querySelector('select:last-of-type').innerHTML}</select>
          </div>
        </div>
        <div class="ft-main-action">
          <button class="ft-translate-btn">翻译</button>
        </div>
        <div class="ft-switches">
          <div class="ft-switch-item">
            <span class="ft-switch-label">自动翻译新增内容</span>
            <div class="ft-switch ft-auto-switch" data-checked="false">
              <input type="checkbox" style="display:none;">
            </div>
          </div>
          <div class="ft-switch-item">
            <span class="ft-switch-label">划词翻译（全局）</span>
            <div class="ft-switch ft-word-switch" data-checked="false">
              <input type="checkbox" style="display:none;">
            </div>
          </div>
          <div class="ft-shortcut-tip">
            <span class="ft-shortcut-text">💡 选中文本后按 <kbd>F2</kbd> 快速翻译</span>
          </div>
        </div>
        <div class="ft-status-section">
          <div class="ft-status-text">${statusText.textContent}</div>
          <div class="ft-progress-container hidden">
            <div class="ft-progress-bar" style="width:0%"></div>
          </div>
        </div>
      `;
  
          // 移除关闭选项面板
  
          // 组装容器
    container.append(fab, settingsBtn, panel, settingsPanel);
  
          // 拖拽功能 - 长按拖拽
    let isDragging = false;
    let dragStarted = false;
    let startY = 0;
    let startTop = 0;
    let longPressTimer = null;
    let mouseMoved = false;

    fab.addEventListener('mousedown', (e) => {
      // 只响应左键
      if (e.button !== 0) return;
      
      startY = e.clientY;
      startTop = parseFloat(container.style.top) || 50;
      dragStarted = false;
      mouseMoved = false;
      
      // 长按500ms后才能拖拽
      longPressTimer = setTimeout(() => {
        if (!mouseMoved) { // 只有在没有鼠标移动的情况下才进入拖拽模式
          isDragging = true;
          fab.classList.add('ft-dragging'); // 添加拖拽状态类
          document.addEventListener('mousemove', onDrag);
          document.addEventListener('mouseup', onDragEnd);
        }
      }, 500);
      
      // 监听鼠标移动，如果在长按期间移动则取消拖拽
      const onMouseMove = (e) => {
        const deltaY = Math.abs(e.clientY - startY);
        if (deltaY > 5) { // 移动超过5px就算移动
          mouseMoved = true;
          clearTimeout(longPressTimer);
          document.removeEventListener('mousemove', onMouseMove);
        }
      };
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', () => {
        clearTimeout(longPressTimer);
        document.removeEventListener('mousemove', onMouseMove);
      }, { once: true });
      
      e.preventDefault();
    });
  
      function onDrag(e) {
        if (!isDragging) return;
        const deltaY = e.clientY - startY;
        const newTop = Math.max(5, Math.min(95, startTop + (deltaY / window.innerHeight) * 100));
        container.style.top = newTop + '%';
      }
  
          function onDragEnd() {
      clearTimeout(longPressTimer);
      
      if (isDragging) {
        isDragging = false;
        dragStarted = true;
        fab.classList.remove('ft-dragging'); // 移除拖拽状态类
        
        const newPos = { 
          top: parseFloat(container.style.top) || 50, 
          right: parseFloat(container.style.right) || 12 
        };
        setStored(STORAGE_KEYS.position, newPos);
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', onDragEnd);
        
        // 延迟重置dragStarted状态，防止立即触发点击
        setTimeout(() => {
          dragStarted = false;
        }, 100);
      }
    }
    
    // 更新悬浮按钮的提示词
    function updateFabTooltip() {
      if (isPageTranslated) {
        fab.title = '点击切换到原文';
      } else {
        const targetLangName = langLabel(targetLang);
        fab.title = `点击翻译为${targetLangName}`;
      }
    }
    
    // 将更新函数添加到返回对象中
    container.updateFabTooltip = updateFabTooltip;
    
    // 处理点击事件（区分拖拽和点击）
    fab.addEventListener('click', (e) => {
      // 如果刚完成拖拽，不触发点击
      if (dragStarted || isDragging) {
        return;
      }
      
      // 智能切换：翻译和还原
      if (isPageTranslated) {
        restorePage();
      } else {
        translatePage(false);
      }
    });
    
    // 初始化提示词
    updateFabTooltip();
  
      // 悬停显示控制按钮
      let hoverTimer;
      container.addEventListener('mouseenter', () => {
        clearTimeout(hoverTimer);
        container.classList.add('ft-hover');
      });
      container.addEventListener('mouseleave', () => {
        hoverTimer = setTimeout(() => container.classList.remove('ft-hover'), 300);
      });
  
          // 设置按钮点击
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      settingsPanel.classList.toggle('ft-show');
    });
  
          // 移除关闭按钮相关事件监听器
  
      // 设置面板关闭
      settingsPanel.querySelector('.ft-settings-close').addEventListener('click', () => {
        settingsPanel.classList.remove('ft-show');
      });
  
          // 点击外部关闭面板
    document.addEventListener('click', (e) => {
      if (!container.contains(e.target)) {
        settingsPanel.classList.remove('ft-show');
      }
    });

    // 自定义开关功能
    const autoSwitch = settingsPanel.querySelector('.ft-auto-switch');
    const wordSwitch = settingsPanel.querySelector('.ft-word-switch');
    
    // 初始化自动翻译开关
    const autoCheckbox = autoSwitch.querySelector('input[type="checkbox"]');
    autoSwitch.setAttribute('data-checked', autoObserve);
    autoCheckbox.checked = autoObserve;
    autoSwitch.classList.toggle('active', autoObserve);
    
    // 初始化划词翻译开关
    const wordCheckbox = wordSwitch.querySelector('input[type="checkbox"]');
    wordSwitch.setAttribute('data-checked', wordSelectionEnabled);
    wordCheckbox.checked = wordSelectionEnabled;
    wordSwitch.classList.toggle('active', wordSelectionEnabled);
    
    // 自动翻译开关事件
    autoSwitch.addEventListener('click', () => {
      const isChecked = autoSwitch.getAttribute('data-checked') === 'true';
      const newChecked = !isChecked;
      autoSwitch.setAttribute('data-checked', newChecked);
      autoCheckbox.checked = newChecked;
      autoSwitch.classList.toggle('active', newChecked);
      autoCheckbox.dispatchEvent(new Event('change'));
    });
    
    // 划词翻译开关事件
    wordSwitch.addEventListener('click', () => {
      const isChecked = wordSwitch.getAttribute('data-checked') === 'true';
      const newChecked = !isChecked;
      wordSwitch.setAttribute('data-checked', newChecked);
      wordCheckbox.checked = newChecked;
      wordSwitch.classList.toggle('active', newChecked);
      
      // 更新全局状态
      wordSelectionEnabled = newChecked;
      setStored(STORAGE_KEYS.wordSelection, newChecked);
      
      // 启用或禁用划词翻译监听器
      if (newChecked) {
        setupSelectionListeners();
      } else {
        removeSelectionListeners();
        hideSelectionBubble();
        hideTranslationPopup();
      }
    });
  
          return {
      container,
      sourceSelect: settingsPanel.querySelector('.ft-source-select'),
      targetSelect: settingsPanel.querySelector('.ft-target-select'),
      translateBtn: settingsPanel.querySelector('.ft-translate-btn'),
      restoreBtn: null, // 移除还原按钮，改为点击悬浮按钮切换
      observeCheckbox: autoCheckbox,
      statusText: settingsPanel.querySelector('.ft-status-text'),
      progressText: progressText,
      progressContainer: settingsPanel.querySelector('.ft-progress-container'),
      progressBar: settingsPanel.querySelector('.ft-progress-bar'),
      fab,
      panel,
      settingsPanel,
    };
    }
  
    function injectStyles() {
      const css = `
  .ft-ui{ position:fixed !important; right:0 !important; transform:translateY(-50%) !important; z-index:2147483647 !important; font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Noto Sans,Ubuntu,Cantarell !important; color:#333 !important; pointer-events:auto !important; }
  .ft-ui *{ box-sizing:border-box; }
  
  /* 主悬浮按钮 - 紧贴侧边，保持黑色 */
  .ft-fab{ 
    width:36px; height:36px; 
    border-radius:18px 0 0 18px; 
    background:#333; 
    border:1px solid #555; 
    box-shadow:0 4px 12px rgba(0,0,0,.2); 
    cursor:pointer; display:flex; align-items:center; justify-content:center; 
    transition:all .3s ease; position:relative; 
    transform:translateX(0); /* 始终紧贴右侧 */
    overflow:visible;
  }
  .ft-ui:hover .ft-fab{ 
    transform:translateX(-2px); /* 悬停时稍微左移 */ 
    background:#444;
  }
  
  /* 主图标 */
  .ft-fab::before{ 
    content:""; position:absolute; width:20px; height:20px; 
    background:#fff; 
    mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none'%3E%3Cpath d='M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z' fill='currentColor'/%3E%3C/svg%3E") no-repeat center/contain; 
    transition:all .3s ease;
    z-index:1;
  }
  
  /* 状态指示器 */
  .ft-fab::after{
    content:'';
    position:absolute;
    top:-2px;
    right:-2px;
    width:10px;
    height:10px;
    border-radius:50%;
    border:2px solid #fff;
    opacity:0;
    transform:scale(0.5);
    transition:all 0.3s ease;
    z-index:2;
  }
  
  /* 翻译状态 - 已翻译页面，图标保持黑色，只显示绿色小圆圈 */
  .ft-fab.ft-translated::after{
    background:#10b981;
    opacity:1;
    transform:scale(1);
  }
  
  /* 成功状态 - 临时动画，图标保持黑色 */
  .ft-fab.ft-success{ 
    transform:translateX(-2px) scale(1.05) !important;
  }
  .ft-fab.ft-success::after{
    background:#10b981;
    opacity:1;
    transform:scale(1.2);
    box-shadow:0 0 8px rgba(16,185,129,0.5);
  }
  
  /* 错误状态 - 图标保持黑色，只显示红色小圆圈 */
  .ft-fab.ft-error::after{
    background:#ef4444;
    opacity:1;
    transform:scale(1);
  }
  
  /* 悬浮按钮拖拽状态 */
.ft-fab:active{ cursor:ns-resize !important; }
.ft-fab.ft-dragging{ 
  cursor:ns-resize !important; 
  transform:translateX(-4px) scale(1.05) !important;
  box-shadow:0 8px 24px rgba(0,0,0,.4) !important;
}
  
  /* 设置按钮 */
  .ft-settings-btn{ 
    position:absolute; right:8px; bottom:-30px;
    width:24px; height:24px; 
    border-radius:12px; 
    background:rgba(255,255,255,.9); 
    border:1px solid rgba(0,0,0,.1); 
    display:flex; align-items:center; justify-content:center; 
    cursor:pointer; font-size:14px; 
    opacity:0; transition:all .2s ease; 
    box-shadow:0 2px 8px rgba(0,0,0,.1);
  }
  .ft-ui.ft-hover .ft-settings-btn{ opacity:1; }
  
  /* 设置面板 - 美观重设计 */
  .ft-settings-panel{ 
    position:absolute; 
    top:-40px; right:40px;
    width:280px; 
    background:#1e1e1e; 
    border:1px solid #333; 
    border-radius:16px; 
    box-shadow:-12px 0 40px rgba(0,0,0,.5), 0 12px 40px rgba(0,0,0,.3); 
    opacity:0; pointer-events:none; 
    transform:translateX(24px) scale(0.9); 
    transition:all .35s cubic-bezier(0.34,1.56,0.64,1); 
    z-index:10; 
    color:#fff;
    overflow:hidden;
    backdrop-filter:blur(20px);
  }
  .ft-settings-panel.ft-show{ 
    opacity:1; pointer-events:auto; 
    transform:translateX(0) scale(1); 
  }
  
  /* 标题栏 */
  .ft-settings-header{ 
    padding:18px 20px; 
    background:linear-gradient(135deg, #2d2d2d 0%, #1f1f1f 100%);
    border-bottom:1px solid rgba(255,255,255,0.1); 
    display:flex; justify-content:space-between; align-items:center; 
    font-weight:600; font-size:15px;
    color:#f5f5f5;
  }
  .ft-settings-close{ 
    cursor:pointer; 
    font-size:20px; 
    color:#888; 
    width:24px; height:24px;
    display:flex; align-items:center; justify-content:center;
    border-radius:12px;
    transition:all 0.2s ease;
  }
  .ft-settings-close:hover{
    background:rgba(255,255,255,0.1);
    color:#fff;
  }
  
  /* 语言选择区域 */
  .ft-lang-section{
    padding:16px;
    background:rgba(255,255,255,0.02);
  }
  .ft-lang-row{
    display:flex;
    align-items:center;
    gap:8px;
  }
  .ft-lang-select{
    flex:1;
    padding:8px 12px;
    background:#2a2a2a;
    border:1px solid #444;
    border-radius:8px;
    color:#fff;
    font-size:12px;
    cursor:pointer;
    transition:all 0.2s ease;
    outline:none;
    min-width:0;
    max-width:none;
  }
  .ft-lang-select:hover{
    border-color:#555;
    background:#333;
  }
  .ft-lang-select:focus{
    border-color:#e91e63;
    box-shadow:0 0 0 2px rgba(233,30,99,0.2);
  }
  .ft-lang-arrow{
    color:#888;
    font-size:14px;
    font-weight:bold;
    min-width:14px;
    text-align:center;
    flex-shrink:0;
  }
  
  /* 主要操作按钮 */
  .ft-main-action{
    padding:16px;
  }
  .ft-translate-btn{
    width:100%;
    padding:14px 24px;
    background:linear-gradient(135deg, #e91e63 0%, #c2185b 100%);
    border:none;
    border-radius:12px;
    color:#fff;
    font-weight:600;
    font-size:15px;
    cursor:pointer;
    transition:all 0.3s ease;
    box-shadow:0 6px 20px rgba(233,30,99,0.25);
    position:relative;
    overflow:hidden;
    display:flex;
    align-items:center;
    justify-content:center;
    gap:8px;
  }
  .ft-translate-btn::before{
    content:'';
    position:absolute;
    top:0; left:-100%;
    width:100%; height:100%;
    background:linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
    transition:left 0.6s ease;
  }
  .ft-translate-btn:hover{
    background:linear-gradient(135deg, #c2185b 0%, #ad1457 100%);
    transform:translateY(-2px);
    box-shadow:0 8px 25px rgba(233,30,99,0.35);
  }
  .ft-translate-btn:hover::before{
    left:100%;
  }
  .ft-translate-btn:active{
    transform:translateY(0);
  }
  .ft-translate-btn:disabled{
    background:#666 !important;
    cursor:not-allowed !important;
    transform:none !important;
    box-shadow:0 2px 8px rgba(0,0,0,0.2) !important;
  }
  
  /* 加载动画 */
  .ft-loading-spinner{
    width:16px;
    height:16px;
    border:2px solid rgba(255,255,255,0.3);
    border-top:2px solid #fff;
    border-radius:50%;
    animation:ft-spin 1s linear infinite;
  }
  @keyframes ft-spin{
    0%{ transform:rotate(0deg); }
    100%{ transform:rotate(360deg); }
  }
  
  /* 异步翻译进度条样式 */
  .ft-translation-progress{ width:100%; height:2px; background:#f3f4f6; border-radius:1px; margin-top:8px; overflow:hidden; }
  .ft-progress-bar{ height:100%; background:linear-gradient(90deg, #3b82f6, #8b5cf6); border-radius:1px; width:0%; }
  @keyframes ft-progress{ 0%{ width:0%; } 100%{ width:100%; } }
  
  /* 重试按钮样式 */
  .ft-retry-button{ transition:all 0.2s ease; }
  .ft-retry-button:hover{ background:#2563eb !important; transform:translateY(-1px); }
  
  /* 成功/错误状态 */
  .ft-translate-btn.success{
    background:linear-gradient(135deg, #10b981 0%, #059669 100%) !important;
  }
  .ft-translate-btn.error{
    background:linear-gradient(135deg, #ef4444 0%, #dc2626 100%) !important;
  }
  
  /* 功能开关区域 */
  .ft-switches{
    padding:16px;
    border-top:1px solid rgba(255,255,255,0.05);
  }
  .ft-switch-item{
    display:flex;
    justify-content:space-between;
    align-items:center;
    padding:12px 0;
  }
  .ft-switch-label{
    font-size:14px;
    color:#ddd;
    font-weight:500;
  }
  .ft-switch{
    position:relative;
    width:48px;
    height:24px;
    background:#3a3a3a;
    border-radius:12px;
    cursor:pointer;
    transition:all 0.3s ease;
    border:1px solid #555;
  }
  .ft-switch.active{
    background:linear-gradient(135deg, #e91e63 0%, #c2185b 100%);
    border-color:#e91e63;
    box-shadow:0 0 12px rgba(233,30,99,0.3);
  }
  .ft-switch::after{
    content:'';
    position:absolute;
    top:2px;
    left:2px;
    width:18px;
    height:18px;
    background:#fff;
    border-radius:50%;
    transition:all 0.3s cubic-bezier(0.34,1.56,0.64,1);
    box-shadow:0 2px 6px rgba(0,0,0,0.3);
  }
  .ft-switch.active::after{
    transform:translateX(24px);
    box-shadow:0 2px 8px rgba(0,0,0,0.4);
  }
  
  /* 快捷键提示 */
  .ft-shortcut-tip{
    padding:8px 0 4px 0;
    margin-top:8px;
    border-top:1px solid rgba(255,255,255,0.05);
  }
  .ft-shortcut-text{
    font-size:11px;
    color:#888;
    display:flex;
    align-items:center;
    gap:4px;
  }
  .ft-shortcut-text kbd{
    background:rgba(255,255,255,0.1);
    border:1px solid rgba(255,255,255,0.2);
    border-radius:4px;
    padding:2px 6px;
    font-size:10px;
    font-family:monospace;
    color:#fff;
    box-shadow:0 1px 2px rgba(0,0,0,0.2);
  }
  
  /* 状态区域 */
  .ft-status-section{
    padding:12px 16px;
    background:rgba(0,0,0,0.2);
    border-top:1px solid rgba(255,255,255,0.05);
  }
  .ft-status-text{
    font-size:12px;
    color:#999;
    text-align:center;
    margin-bottom:8px;
  }
  
  /* 进度条 */
  .ft-progress-container{
    width:100%;
    height:4px;
    background:rgba(255,255,255,0.1);
    border-radius:2px;
    overflow:hidden;
    position:relative;
  }
  .ft-progress-bar{
    height:100%;
    background:linear-gradient(90deg, #e91e63 0%, #c2185b 100%);
    border-radius:2px;
    transition:width 0.3s ease;
    position:relative;
    overflow:hidden;
  }
  .ft-progress-bar::after{
    content:'';
    position:absolute;
    top:0;
    left:-100%;
    width:100%;
    height:100%;
    background:linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
    animation:ft-progress-shine 1.5s infinite;
  }
  @keyframes ft-progress-shine{
    0%{ left:-100%; }
    100%{ left:100%; }
  }
  
  /* 隐藏进度条 */
  .ft-progress-container.hidden{
    opacity:0;
    height:0;
    margin:0;
    transition:all 0.3s ease;
  }
  
  /* 移除关闭面板样式 */
  
  /* 旧面板隐藏 */
  .ft-panel{ display:none; }
  .ft-panel{ position:absolute; right:50px; top:0; min-width:320px; max-width:420px; padding:12px; border-radius:14px; background:rgba(255,255,255,.95); border:1px solid rgba(0,0,0,.12); box-shadow:0 12px 32px rgba(0,0,0,.18); backdrop-filter:saturate(1.2) blur(8px); opacity:0; pointer-events:none; transform:translateX(10px); transition:all .15s ease; }
  .ft-ui.open .ft-panel{ opacity:1; pointer-events:auto; transform:translateX(0); }
  .ft-row{ display:flex; align-items:center; gap:6px; margin-bottom:10px; }
  .ft-select{ flex:1; padding:5px 8px; border-radius:6px; border:1px solid #ddd; background:#fff; font-size:13px; }
  .ft-btn{ padding:6px 12px; border-radius:6px; border:1px solid #3b82f6; background:#3b82f6; color:#fff; cursor:pointer; font-size:13px; transition:background .2s ease; }
  .ft-btn:hover{ background:#2563eb; }
  .ft-btn.ghost{ background:#fff; color:#3b82f6; border-color:#3b82f6; }
  .ft-btn.ghost:hover{ background:#f1f5f9; }
  .ft-status{ font-size:11px; color:#666; margin-top:4px; }
  .ft-progress{ color:#444; font-size:11px; }
  .ft-check{ gap:6px; user-select:none; align-items:center; margin-bottom:8px; }
  .ft-check input{ margin:0; }
  .ft-check label{ font-size:13px; }
  .ft-busy .ft-btn{ opacity:.7; pointer-events:none; }
  .ft-pair{ display:inline; }
  .ft-pair .ft-original{ opacity:.6; margin-right:.35em; }
  .ft-pair:not(.show-original) .ft-original{ display:none; }
  .ft-segment{ display:inline; }
  .ft-segment .ft-pair{ display:inline; }
  
  /* 新的段落翻译样式 */
  .ft-segment-wrapper{ display:inline; }
  .ft-segment-original{ opacity:.6; margin-right:.35em; color:#666; }
  .ft-segment-separator{ margin:0 .2em; }
  .ft-segment-translated{ color:inherit; }
  .ft-segment-wrapper:not(.show-original) .ft-segment-original,
  .ft-segment-wrapper:not(.show-original) .ft-segment-separator{ display:none; }
  @media (prefers-color-scheme: dark){
  .ft-fab{ background:#222; border-color:#444; color:#eee; }
  .ft-ui:hover .ft-fab{ background:#333; }
  .ft-settings-panel{ background:rgba(24,24,24,.95); color:#ddd; }
  .ft-settings-header{ border-color:rgba(255,255,255,.1); }
  .ft-panel{ background:rgba(24,24,24,.95); border-color:rgba(255,255,255,.12); color:#ddd; }
  .ft-select{ background:#1f2937; border-color:#374151; color:#e5e7eb; }
  .ft-btn{ background:#3b82f6; color:#fff; border-color:#3b82f6; }
  .ft-btn:hover{ background:#2563eb; }
  .ft-btn.ghost{ background:#1f2937; color:#3b82f6; border-color:#3b82f6; }
  .ft-btn.ghost:hover{ background:#374151; }
  .ft-status{ color:#aaa; }
  .ft-progress{ color:#ccc; }
}

/* fallback for browsers without mask support */
@supports not (mask: url()) {
  .ft-fab::before{ display:none; }
  .ft-fab::after{ 
    content:"A文"; position:absolute; 
    font:bold 10px/1 sans-serif; color:#fff; 
    left:50%; top:50%; transform:translate(-50%,-50%);
    transition:color .3s ease, text-shadow .3s ease;
    z-index:1;
  }
  
  /* 状态指示器 - fallback模式 */
  .ft-fab.ft-translated::after{
    color:#fff;
    text-shadow:0 0 4px rgba(255,255,255,0.5);
  }
  .ft-fab.ft-success::after{ 
    color:#fff !important; 
    text-shadow:0 0 4px rgba(255,255,255,0.8);
  }
  .ft-fab.ft-error::after{
    color:#fff;
    text-shadow:0 0 4px rgba(255,255,255,0.5);
  }
  
  /* 为fallback模式添加状态指示点 */
  .ft-fab.ft-translated::before,
  .ft-fab.ft-error::before{
    content:'';
    display:block;
    position:absolute;
    top:-2px;
    right:-2px;
    width:8px;
    height:8px;
    border-radius:50%;
    border:1px solid #fff;
    z-index:2;
  }
  .ft-fab.ft-translated::before{
    background:#10b981;
  }
  .ft-fab.ft-error::before{
    background:#ef4444;
  }
}

/* 划词翻译样式 */
.ft-selection-bubble{
  position:absolute;
  width:26px;
  height:26px;
  background:rgba(156, 163, 175, 0.9);
  border:1px solid rgba(156, 163, 175, 0.3);
  border-radius:50%;
  box-shadow:0 3px 10px rgba(156, 163, 175, 0.3);
  cursor:pointer;
  display:flex;
  align-items:center;
  justify-content:center;
  z-index:2147483646;
  transition:all 0.2s ease;
  font-size:12px;
  color:#fff;
  user-select:none;
  opacity:0;
  transform:scale(0.5);
  animation:ft-bubble-appear 0.2s ease forwards;
}
@keyframes ft-bubble-appear{
  to{
    opacity:1;
    transform:scale(1);
  }
}
.ft-selection-bubble:hover{
  transform:scale(1.1);
  box-shadow:0 5px 15px rgba(156, 163, 175, 0.4);
}
.ft-selection-bubble::before{
  content:"A";
  font-weight:bold;
}

.ft-translation-popup{
  position:absolute;
  min-width:200px;
  max-width:300px;
  background:#1e1e1e;
  border:1px solid #333;
  border-radius:12px;
  box-shadow:0 8px 32px rgba(0,0,0,.3);
  color:#fff;
  z-index:2147483646;
  overflow:hidden;
  opacity:0;
  transform:scale(0.9);
  transition:all 0.2s ease;
  font-size:13px;
}
.ft-translation-popup.show{
  opacity:1;
  transform:scale(1);
}
.ft-translation-popup-header{
  padding:8px 12px;
  background:rgba(255,255,255,0.05);
  border-bottom:1px solid rgba(255,255,255,0.1);
  font-size:11px;
  color:#999;
  display:flex;
  justify-content:space-between;
  align-items:center;
}
.ft-translation-popup-actions{
  display:flex;
  gap:4px;
}
.ft-translation-popup-refresh,
.ft-translation-popup-close{
  cursor:pointer;
  width:16px;
  height:16px;
  display:flex;
  align-items:center;
  justify-content:center;
  border-radius:8px;
  transition:background 0.2s ease;
  font-size:12px;
}
.ft-translation-popup-refresh:hover,
.ft-translation-popup-close:hover{
  background:rgba(255,255,255,0.1);
}
.ft-translation-popup-refresh{
  color:#3b82f6;
}
.ft-translation-popup-refresh:hover{
  background:rgba(59,130,246,0.2);
}
.ft-translation-popup-content{
  padding:12px;
  line-height:1.4;
}
.ft-translation-original{
  color:#999;
  font-size:12px;
  margin-bottom:8px;
  word-break:break-word;
}
.ft-translation-result{
  color:#fff;
  word-break:break-word;
}
.ft-translation-loading{
  display:flex;
  align-items:center;
  gap:8px;
  color:#999;
}
.ft-translation-loading .ft-loading-spinner{
  width:12px;
  height:12px;
  border:1px solid rgba(255,255,255,0.3);
  border-top:1px solid #fff;
}
.ft-translation-error{
  color:#ef4444;
  line-height:1.4;
}
`;
    try {
      if (typeof GM_addStyle === 'function') GM_addStyle(css);
      else {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
      }
    } catch {}
  }
  
    function toggleKeepOriginal(on) {
      // 处理旧的翻译对结构
      const pairs = document.querySelectorAll('span.ft-pair');
      pairs.forEach((w) => {
        if (on) w.classList.add('show-original');
        else w.classList.remove('show-original');
      });
      
      // 处理新的段落翻译结构
      const segmentWrappers = document.querySelectorAll('.ft-segment-wrapper');
      segmentWrappers.forEach((w) => {
        if (on) w.classList.add('show-original');
        else w.classList.remove('show-original');
      });
    }
  
        // 重新设计的段落翻译应用函数 - 简化且可靠
    function applySegmentTranslation(segment, translatedText) {
      if (!segment || !segment.textNodes || segment.textNodes.length === 0) {
        console.warn('[ChromeTranslator] 无效的段落数据:', segment);
        return;
      }
      
      const { element, textNodes, originalText, trimmedText } = segment;
      const trimmedTranslated = translatedText.trim();
      
      if (!trimmedTranslated) {
        console.warn('[ChromeTranslator] 翻译结果为空:', originalText.substring(0, 50));
        return;
      }
      
      console.log('[ChromeTranslator] 应用段落翻译:', {
        element: element.tagName,
        originalLength: trimmedText.length,
        translatedLength: trimmedTranslated.length,
        textNodesCount: textNodes.length
      });
      
      try {
        // 修复方案：使用span元素保持内联布局，只替换第一个文本节点
        const segmentWrapper = document.createElement('span');
        segmentWrapper.className = 'ft-segment-wrapper';
        segmentWrapper.setAttribute('data-ft-segment-original', trimmedText);
        segmentWrapper.setAttribute('data-ft-segment-translated', trimmedTranslated);
        
        // 创建原文和译文的显示容器
        if (keepOriginal) {
          const originalSpan = document.createElement('span');
          originalSpan.className = 'ft-segment-original';
          originalSpan.textContent = trimmedText;
          segmentWrapper.appendChild(originalSpan);
          
          const separator = document.createElement('span');
          separator.className = 'ft-segment-separator';
          separator.textContent = ' ';
          segmentWrapper.appendChild(separator);
        }
        
        const translatedSpan = document.createElement('span');
        translatedSpan.className = 'ft-segment-translated';
        translatedSpan.textContent = trimmedTranslated;
        segmentWrapper.appendChild(translatedSpan);
        
        // 安全的节点替换：只替换第一个文本节点，保留其他节点
        if (textNodes.length > 0) {
          const firstNode = textNodes[0].node;
          if (firstNode && firstNode.parentNode) {
            // 用翻译容器替换第一个文本节点
            firstNode.parentNode.replaceChild(segmentWrapper, firstNode);
            
            // 清空其他文本节点的内容，但不删除它们（避免破坏DOM结构）
            for (let i = 1; i < textNodes.length; i++) {
              const node = textNodes[i].node;
              if (node && node.parentNode) {
                node.textContent = ''; // 清空内容而不是删除节点
              }
            }
          }
        }
        
        // 标记元素为已翻译
        element.setAttribute('data-ft-segment-translated', 'true');
        
        console.log('[ChromeTranslator] 段落翻译应用成功');
        
      } catch (error) {
        console.error('[ChromeTranslator] 段落翻译应用失败:', error);
        // 失败时回退到原有的单节点翻译方式
        fallbackToNodeTranslation(segment, translatedText);
      }
    }
    
    // 回退到单节点翻译的备用方案
    function fallbackToNodeTranslation(segment, translatedText) {
      console.log('[ChromeTranslator] 使用回退翻译方案');
      const { textNodes } = segment;
      
      // 简单地将翻译结果应用到第一个文本节点
      if (textNodes.length > 0) {
        const firstNode = textNodes[0];
        applyTranslationToNode(
          firstNode.node, 
          firstNode.text, 
          '', 
          '', 
          translatedText
        );
      }
    }

    
    // 保留原有的单节点翻译函数作为备用
    function applyTranslationToNode(node, original, leading, trailing, translatedPretty) {
      // Wrap the original text node with a pair container to support toggling
      const wrapper = document.createElement('span');
      wrapper.className = 'ft-pair';
      if (keepOriginal) wrapper.classList.add('show-original');
      wrapper.setAttribute('data-ft-original-text', original);
      wrapper.setAttribute('data-ft-leading', leading);
      wrapper.setAttribute('data-ft-trailing', trailing);

      const o = document.createElement('span');
      o.className = 'ft-original';
      o.textContent = original.trim();

      const t = document.createElement('span');
      t.className = 'ft-translated';
      t.textContent = leading + translatedPretty + trailing;

      wrapper.append(o, t);
      node.parentNode && node.parentNode.replaceChild(wrapper, node);
    }

    // --------------------------
    // 划词翻译功能
    // --------------------------
    function setupSelectionListeners() {
      document.addEventListener('mouseup', handleTextSelection);
      document.addEventListener('touchend', handleTextSelection);
    }
    
    function removeSelectionListeners() {
      document.removeEventListener('mouseup', handleTextSelection);
      document.removeEventListener('touchend', handleTextSelection);
    }
    
    function handleTextSelection(e) {
      // 延迟处理，确保选择已完成
      setTimeout(() => {
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();
        
        if (selectedText && selectedText.length > 0 && selectedText.length < 500) {
          // 排除在翻译UI内的选择
          if (e.target.closest('.ft-ui, .ft-selection-bubble, .ft-translation-popup')) {
            return;
          }
          
          // 获取鼠标/触摸位置
          let mouseX, mouseY;
          if (e.type === 'touchend' && e.changedTouches && e.changedTouches.length > 0) {
            // 触摸事件
            mouseX = e.changedTouches[0].clientX;
            mouseY = e.changedTouches[0].clientY;
          } else {
            // 鼠标事件
            mouseX = e.clientX || e.pageX;
            mouseY = e.clientY || e.pageY;
          }
          
          showSelectionBubble(selectedText, { x: mouseX, y: mouseY });
        } else {
          hideSelectionBubble();
        }
      }, 100);
    }
    
    function showSelectionBubble(text, mousePos) {
      hideSelectionBubble();
      hideTranslationPopup();
      
      selectionBubble = document.createElement('div');
      selectionBubble.className = 'ft-selection-bubble';
      
      // 使用鼠标位置，添加少量偏移避免遮挡光标
      const offsetX = 10;
      const offsetY = 10;
      
      // 计算最终位置，确保不超出视窗边界
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const bubbleSize = 26; // 悬浮框尺寸（26px）
      
      let left = mousePos.x + offsetX;
      let top = mousePos.y + offsetY;
      
      // 边界检查和调整
      if (left + bubbleSize > viewportWidth) {
        left = mousePos.x - bubbleSize - offsetX;
      }
      if (top + bubbleSize > viewportHeight) {
        top = mousePos.y - bubbleSize - offsetY;
      }
      
      // 确保不小于0
      left = Math.max(0, left);
      top = Math.max(0, top);
      
      selectionBubble.style.left = (left + window.scrollX) + 'px';
      selectionBubble.style.top = (top + window.scrollY) + 'px';
      
      selectionBubble.addEventListener('click', (e) => {
        e.stopPropagation();
        showTranslationPopup(text, selectionBubble);
      });
      
      document.body.appendChild(selectionBubble);
      
      // 自动隐藏机制
      setTimeout(() => {
        if (selectionBubble && !selectionBubble.matches(':hover')) {
          hideSelectionBubble();
        }
      }, 3000);
    }
    
    function hideSelectionBubble() {
      if (selectionBubble) {
        selectionBubble.remove();
        selectionBubble = null;
      }
    }
    
    function showTranslationPopupAtPosition(text, x, y) {
      hideTranslationPopup();
      
      translationPopup = document.createElement('div');
      translationPopup.className = 'ft-translation-popup';
      
      // 计算弹窗位置，确保不超出视窗边界
      const popupWidth = 300; // 最大宽度
      const popupHeight = 150; // 估计高度
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      let left = x + window.scrollX;
      let top = y + window.scrollY + 10; // 在选中文本下方10px
      
      // 边界检查
      if (left + popupWidth > viewportWidth + window.scrollX) {
        left = x + window.scrollX - popupWidth;
      }
      if (top + popupHeight > viewportHeight + window.scrollY) {
        top = y + window.scrollY - popupHeight - 10; // 在选中文本上方
      }
      
      // 确保不超出左边界和上边界
      left = Math.max(window.scrollX + 10, left);
      top = Math.max(window.scrollY + 10, top);
      
      translationPopup.style.left = left + 'px';
      translationPopup.style.top = top + 'px';
      
      translationPopup.innerHTML = `
        <div class="ft-translation-popup-header">
          <span>快捷翻译 (F2)</span>
          <div class="ft-translation-popup-actions">
            <div class="ft-translation-popup-refresh" title="重新翻译">↻</div>
            <div class="ft-translation-popup-close" title="关闭">×</div>
          </div>
        </div>
        <div class="ft-translation-popup-content">
          <div class="ft-translation-original">${text}</div>
          <div class="ft-translation-loading">
            <div class="ft-loading-spinner"></div>
            <span>翻译中...</span>
          </div>
        </div>
      `;
      
      document.body.appendChild(translationPopup);
      
      // 添加关闭和刷新事件
      translationPopup.querySelector('.ft-translation-popup-close').addEventListener('click', hideTranslationPopup);
      translationPopup.querySelector('.ft-translation-popup-refresh').addEventListener('click', () => {
        manualRefreshTranslation(text);
      });
      
      // 显示动画
      setTimeout(() => {
        translationPopup.classList.add('show');
      }, 10);
      
      // 开始翻译
      retryTranslation(text, 0);
    }

    function showTranslationPopup(text, anchorElement) {
      hideTranslationPopup();
      
      translationPopup = document.createElement('div');
      translationPopup.className = 'ft-translation-popup';
      
      const rect = anchorElement.getBoundingClientRect();
      translationPopup.style.left = (rect.left + window.scrollX) + 'px';
      translationPopup.style.top = (rect.bottom + window.scrollY + 5) + 'px';
      
      translationPopup.innerHTML = `
        <div class="ft-translation-popup-header">
          <span>划词翻译</span>
          <div class="ft-translation-popup-actions">
            <div class="ft-translation-popup-refresh" title="重新翻译">↻</div>
            <div class="ft-translation-popup-close" title="关闭">×</div>
          </div>
        </div>
        <div class="ft-translation-popup-content">
          <div class="ft-translation-original">${text}</div>
          <div class="ft-translation-loading">
            <div class="ft-loading-spinner"></div>
            <span>翻译中...</span>
          </div>
        </div>
      `;
      
      document.body.appendChild(translationPopup);
      
      // 添加关闭和刷新事件
      translationPopup.querySelector('.ft-translation-popup-close').addEventListener('click', hideTranslationPopup);
      translationPopup.querySelector('.ft-translation-popup-refresh').addEventListener('click', () => {
        manualRefreshTranslation(text); // 手动刷新，只执行一次翻译
      });
      
      // 显示动画
      setTimeout(() => {
        translationPopup.classList.add('show');
      }, 10);
      
      // 开始翻译
      retryTranslation(text, 0);
    }
    
    function hideTranslationPopup() {
      if (translationPopup) {
        translationPopup.remove();
        translationPopup = null;
      }
    }
    
    async function manualRefreshTranslation(text) {
      if (!translationPopup) return;
      
      // 显示加载状态
      const content = translationPopup.querySelector('.ft-translation-popup-content');
      content.innerHTML = `
        <div class="ft-translation-original">${text}</div>
        <div class="ft-translation-loading">
          <div class="ft-loading-spinner"></div>
          <span>重新初始化翻译器...</span>
        </div>
      `;
      
      try {
        // 强制重新初始化翻译器
        console.log('[ChromeTranslator] 手动刷新：强制重新初始化翻译器');
        
        // 销毁现有翻译器和语言检测器实例
        if (translatorInstance) {
          try {
            translatorInstance.destroy();
            console.log('[ChromeTranslator] 已销毁现有翻译器实例');
          } catch (destroyError) {
            console.warn('[ChromeTranslator] 销毁翻译器实例失败:', destroyError);
          }
          translatorInstance = null;
        }
        
        if (detectorInstance) {
          try {
            detectorInstance.destroy();
            console.log('[ChromeTranslator] 已销毁现有语言检测器实例');
          } catch (destroyError) {
            console.warn('[ChromeTranslator] 销毁语言检测器实例失败:', destroyError);
          }
          detectorInstance = null;
        }
        
        // 更新状态显示
        if (translationPopup) {
          const loadingSpan = content.querySelector('.ft-translation-loading span');
          if (loadingSpan) loadingSpan.textContent = '重新翻译中...';
        }
        
        // 重新初始化并翻译
        const result = await translateSelectedText(text);
        
        // 翻译成功，更新UI
        if (translationPopup && result) {
          content.innerHTML = `
            <div class="ft-translation-original">${text}</div>
            <div class="ft-translation-result">${result}</div>
          `;
        }
      } catch (error) {
        console.error('[ChromeTranslator] 手动刷新翻译失败:', error);
        
        // 手动刷新失败，显示错误但不自动重试
        if (translationPopup) {
          content.innerHTML = `
            <div class="ft-translation-original">${text}</div>
            <div class="ft-translation-error">
              <div style="color:#ef4444; margin-bottom:8px;">翻译失败: ${error.message}</div>
              <div style="font-size:11px; color:#999;">请点击刷新按钮重试</div>
            </div>
          `;
        }
      }
    }

    async function retryTranslation(text, retryCount = 0) {
      const maxRetries = 3;
      
      if (!translationPopup) return;
      
      // 显示加载状态
      const content = translationPopup.querySelector('.ft-translation-popup-content');
      const isInitError = retryCount > 0; // 重试时检查是否需要重新初始化
      
      content.innerHTML = `
        <div class="ft-translation-original">${text}</div>
        <div class="ft-translation-loading">
          <div class="ft-loading-spinner"></div>
          <span>${isInitError ? '重新初始化翻译器' : '翻译中'}${retryCount > 0 ? ` (重试 ${retryCount}/${maxRetries})` : ''}...</span>
        </div>
      `;
      
      try {
        // 如果是重试且上次失败可能是初始化问题，强制重新初始化
        if (retryCount > 0) {
          console.log(`[ChromeTranslator] 自动重试第${retryCount}次：重新初始化翻译器`);
          
          // 销毁现有实例
          if (translatorInstance) {
            try {
              translatorInstance.destroy();
              console.log('[ChromeTranslator] 已销毁现有翻译器实例');
            } catch (destroyError) {
              console.warn('[ChromeTranslator] 销毁翻译器实例失败:', destroyError);
            }
            translatorInstance = null;
          }
          
          if (detectorInstance) {
            try {
              detectorInstance.destroy();
              console.log('[ChromeTranslator] 已销毁现有语言检测器实例');
            } catch (destroyError) {
              console.warn('[ChromeTranslator] 销毁语言检测器实例失败:', destroyError);
            }
            detectorInstance = null;
          }
          
          // 更新状态显示
          if (translationPopup) {
            const loadingSpan = content.querySelector('.ft-translation-loading span');
            if (loadingSpan) {
              loadingSpan.textContent = `翻译中 (重试 ${retryCount}/${maxRetries})...`;
            }
          }
        }
        
        const result = await translateSelectedText(text);
        
        // 翻译成功，更新UI
        if (translationPopup && result) {
          content.innerHTML = `
            <div class="ft-translation-original">${text}</div>
            <div class="ft-translation-result">${result}</div>
          `;
        }
      } catch (error) {
        console.error(`[ChromeTranslator] 划词翻译失败 (第${retryCount + 1}次):`, error);
        
        if (retryCount < maxRetries) {
          // 还有重试次数，1秒后重试
          if (translationPopup) {
            content.innerHTML = `
              <div class="ft-translation-original">${text}</div>
              <div class="ft-translation-loading">
                <div class="ft-loading-spinner"></div>
                <span>翻译失败，${1}秒后重试 (${retryCount + 1}/${maxRetries})...</span>
              </div>
            `;
          }
          
          setTimeout(() => {
            retryTranslation(text, retryCount + 1);
          }, 1000);
        } else {
          // 重试次数用完，显示最终错误
          if (translationPopup) {
            content.innerHTML = `
              <div class="ft-translation-original">${text}</div>
              <div class="ft-translation-error">
                <div style="color:#ef4444; margin-bottom:8px;">翻译失败: ${error.message}</div>
                <div style="font-size:11px; color:#999;">已重试 ${maxRetries} 次，请检查网络或稍后再试</div>
              </div>
            `;
          }
        }
      }
    }

    // 优化的异步划词翻译函数
    async function translateSelectedText(text) {
      if (!hasTranslator()) throw new Error('翻译器不可用');
      
      // 异步并行执行初始化检查
      const [availabilityOk, realSource] = await Promise.all([
        ensureAvailability(),
        resolveRealSourceLanguage()
      ]);
      
      if (!availabilityOk) throw new Error('翻译器不可用');
      
      // 异步初始化翻译器
      const instanceOk = await ensureTranslator(realSource, targetLang);
      if (!instanceOk) throw new Error('翻译器初始化失败');
      
      // 异步执行翻译，添加超时控制
      const translationPromise = translateStreaming(text.replace(/\n/g, '<br>'));
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('翻译超时')), 8000);
      });
      
      const translated = await Promise.race([translationPromise, timeoutPromise]);
      const result = (translated || '').replace(/<br>/g, '\n').trim();
      
      if (!result) throw new Error('翻译结果为空');
      
      return result;
    }
    
    // 点击其他地方关闭划词翻译相关UI
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.ft-selection-bubble, .ft-translation-popup')) {
        hideSelectionBubble();
        hideTranslationPopup();
      }
    });
    
    // F2快捷键快速翻译选中文本
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F2' && wordSelectionEnabled) {
        e.preventDefault();
        
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();
        
        if (selectedText && selectedText.length > 0 && selectedText.length < 500) {
          // 排除在翻译UI内的选择
          const range = selection.getRangeAt(0);
          const container = range.commonAncestorContainer;
          const element = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
          
          if (element && element.closest('.ft-ui, .ft-selection-bubble, .ft-translation-popup')) {
            return;
          }
          
          // 获取选中文本的位置，用于显示翻译弹窗
          const rect = range.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          
          // 直接显示翻译弹窗，跳过悬浮按钮
          showTranslationPopupAtPosition(selectedText, centerX, centerY);
        }
      }
    });
  })();
  
  
  
