/**
 * 发布报告工具类
 * 提供统一的发布状态监控和报告功能
 */

import { reportArticlePublish } from './debug';
import { DOMHelper } from './domHelper';

export interface PublishReporterOptions {
  platform: 'toutiao' | 'zhihu' | 'weixin';
  titleSelectors: string[];
  publishButtonTexts: string[];
  urlPatterns: RegExp[];
  findPublishedUrl?: () => string | null;
}

export class PublishReporter {
  private options: PublishReporterOptions;
  private hasReported = false;
  private armed = false;
  private armAt = 0;
  private observer?: MutationObserver;

  constructor(options: PublishReporterOptions) {
    this.options = options;
  }

  /**
   * 安装发布监控
   */
  install(): void {
    // 检查 sessionStorage 中的 armed 状态
    try {
      const storedArmed = sessionStorage.getItem(`memoraid_armed_${this.options.platform}`);
      if (storedArmed) {
        const armData = JSON.parse(storedArmed);
        // 如果在5分钟内，恢复 armed 状态
        if (Date.now() - armData.at < 5 * 60 * 1000) {
          this.armed = true;
          this.armAt = armData.at;
        } else {
          sessionStorage.removeItem(`memoraid_armed_${this.options.platform}`);
        }
      }
    } catch {}

    // 监听点击事件
    document.addEventListener('click', (e) => {
      this.handleClick(e);
    }, true);

    // 监听DOM变化
    this.observer = new MutationObserver((mutations) => {
      this.handleMutation(mutations);
    });

    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    // 初始扫描
    setTimeout(() => {
      if (!this.hasReported) {
        this.maybeReport('page:initial_scan');
      }
    }, 1500);
  }

  /**
   * 卸载监控
   */
  uninstall(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = undefined;
    }
  }

  /**
   * 处理点击事件
   */
  private handleClick(e: Event): void {
    const target = e.target as HTMLElement | null;
    const btn = target?.closest?.('button') as HTMLElement | null;
    if (!btn) return;

    const text = (btn.innerText || '').trim();
    if (!text) return;

    // 检查是否是发布按钮
    const isPublishButton = this.options.publishButtonTexts.some(
      btnText => text === btnText || text.includes(btnText)
    );

    if (isPublishButton) {
      this.armed = true;
      this.armAt = Date.now();
      try {
        sessionStorage.setItem(`memoraid_armed_${this.options.platform}`, JSON.stringify({ at: this.armAt }));
      } catch {}
      setTimeout(() => this.maybeReport('click:publish'), 1500);
    }
  }

  /**
   * 处理DOM变化
   */
  private handleMutation(mutations: MutationRecord[]): void {
    if (this.hasReported) return;
    if (!this.armed) return;
    if (this.armed && Date.now() - this.armAt > 2 * 60 * 1000) return;

    for (const m of mutations) {
      if (m.addedNodes.length) {
        this.maybeReport('dom:mutation');
        if (this.hasReported) return;
      }
    }
  }

  /**
   * 尝试报告发布状态
   */
  private maybeReport(trigger: string): void {
    if (!this.armed || this.hasReported) return;

    const publishedUrl = this.findPublishedUrl();
    if (publishedUrl) {
      this.reportOnce(trigger, publishedUrl);
    }
  }

  /**
   * 查找已发布的文章URL
   */
  private findPublishedUrl(): string | null {
    // 如果提供了自定义查找函数，优先使用
    if (this.options.findPublishedUrl) {
      return this.options.findPublishedUrl();
    }

    // 默认查找逻辑
    const currentUrl = window.location.href;

    // 1. 检查当前URL
    for (const pattern of this.options.urlPatterns) {
      const match = currentUrl.match(pattern);
      if (match) {
        return currentUrl;
      }
    }

    // 2. 检查页面中的链接
    const links = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      if (!href) continue;

      let absUrl = '';
      try {
        absUrl = new URL(href, window.location.href).toString();
      } catch {
        absUrl = href;
      }

      for (const pattern of this.options.urlPatterns) {
        if (pattern.test(absUrl)) {
          return absUrl;
        }
      }
    }

    // 3. 检查页面文本中的URL
    const text = document.body?.innerText || '';
    for (const pattern of this.options.urlPatterns) {
      const match = text.match(pattern);
      if (match) {
        return match[0];
      }
    }

    return null;
  }

  /**
   * 报告一次（防止重复）
   */
  private reportOnce(trigger: string, publishedUrl: string): void {
    if (this.hasReported) return;
    this.hasReported = true;
    try {
      sessionStorage.removeItem(`memoraid_armed_${this.options.platform}`);
    } catch {}

    const title = this.getCurrentTitle();

    reportArticlePublish({
      platform: this.options.platform,
      title: title || document.title || '未命名文章',
      url: publishedUrl,
      status: 'published',
      extra: { trigger }
    });
  }

  /**
   * 获取当前标题
   */
  private getCurrentTitle(): string {
    const titleEl = DOMHelper.findElement(this.options.titleSelectors);
    if (!titleEl) return '';

    return titleEl instanceof HTMLInputElement || titleEl instanceof HTMLTextAreaElement
      ? (titleEl.value || '').trim()
      : (titleEl.innerText || '').trim();
  }
}
