
// Toutiao Publish Content Script

interface PublishData {
  title: string;
  content: string;
  htmlContent?: string; // Optional HTML content
  timestamp: number;
}

const waitForElement = (selector: string, timeout = 10000): Promise<HTMLElement | null> => {
  return new Promise((resolve) => {
    if (document.querySelector(selector)) {
      return resolve(document.querySelector(selector) as HTMLElement);
    }

    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) {
        observer.disconnect();
        resolve(document.querySelector(selector) as HTMLElement);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
};

const simulateInput = (element: HTMLElement, value: string) => {
  element.focus();
  
  // For React/Vue inputs, we often need to set the value property on the prototype
  // to trigger the setter and then dispatch the event.
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;

  if (element instanceof HTMLInputElement && nativeInputValueSetter) {
    nativeInputValueSetter.call(element, value);
  } else if (element instanceof HTMLTextAreaElement && nativeTextAreaValueSetter) {
    nativeTextAreaValueSetter.call(element, value);
  } else {
    // Fallback for non-standard inputs or contenteditable
    // element.innerText = value; // Dangerous for contenteditable
  }

  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
};

const clickByText = (text: string, selector = 'label, span, div, .byte-checkbox-wrapper') => {
    // Try to find exact text matches first or close matches
    const elements = Array.from(document.querySelectorAll(selector));
    // Filter for visible elements that contain the text
    const targets = elements.filter(el => {
        const content = el.textContent?.trim();
        return content && content.includes(text);
    });
    
    // Sort by length to get the most specific element (shortest text containing the keyword)
    targets.sort((a, b) => (a.textContent?.length || 0) - (b.textContent?.length || 0));

    if (targets.length > 0) {
        // Try to find an input inside or click the element itself
        const target = targets[0] as HTMLElement;
        
        // If it's a label for a checkbox, clicking it usually works.
        // Or if it's a custom checkbox wrapper.
        target.click();
        console.log(`Memoraid: Clicked element containing "${text}"`);
        return true;
    }
    return false;
};

const fillContent = async () => {
  try {
    const data = await chrome.storage.local.get('pending_toutiao_publish');
    if (!data || !data.pending_toutiao_publish) return;

    const payload: PublishData = data.pending_toutiao_publish;
    
    // Check timestamp to avoid using stale data (e.g. > 5 minutes old)
    if (Date.now() - payload.timestamp > 5 * 60 * 1000) {
      chrome.storage.local.remove('pending_toutiao_publish');
      return;
    }

    console.log('Memoraid: Found pending content to publish', payload.title);

    // 1. Wait for Title Input
    const titleSelectors = [
      'textarea[placeholder*="标题"]',
      'input[placeholder*="标题"]', 
      '.title-input',
      '[data-testid="title-input"]'
    ];
    
    let titleEl: HTMLElement | null = null;
    for (const sel of titleSelectors) {
      titleEl = await waitForElement(sel, 2000); // Try short wait for each
      if (titleEl) break;
    }

    if (titleEl) {
      simulateInput(titleEl, payload.title);
      // Fallback: execCommand for safety if simulateInput didn't take
      titleEl.focus();
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, payload.title);
      console.log('Memoraid: Title filled');
    } else {
      console.warn('Memoraid: Title input not found');
    }

    // 2. Wait for Content Editor
    const editorSelectors = [
      '.ProseMirror',
      '[contenteditable="true"]',
      '.editor-content'
    ];

    let editorEl: HTMLElement | null = null;
    for (const sel of editorSelectors) {
      editorEl = await waitForElement(sel, 2000);
      if (editorEl) break;
    }

    if (editorEl) {
      editorEl.focus();
      
      // Use insertHTML if available, otherwise insertText
      if (payload.htmlContent) {
          // Toutiao's editor might sanitize HTML, but let's try.
          // Common WYSIWYG editors support insertHTML command.
          const success = document.execCommand('insertHTML', false, payload.htmlContent);
          if (!success) {
              console.warn('Memoraid: insertHTML failed, falling back to text');
              document.execCommand('insertText', false, payload.content);
          } else {
              console.log('Memoraid: Content filled with HTML');
          }
      } else {
          document.execCommand('insertText', false, payload.content);
          console.log('Memoraid: Content filled with Text');
      }
      
      editorEl.dispatchEvent(new Event('input', { bubbles: true }));
      
      // 3. Handle Checkboxes (Original, Ads)
      // Wait a bit for the UI to settle if needed, or just try clicking.
      // Often these options appear at the bottom.
      setTimeout(() => {
          // Attempt to check "Original" (原创)
          // Looking at the screenshot, "原创" is a radio or checkbox.
          // Usually clicking the text "原创" works if it's in a label.
          const clickedOriginal = clickByText('原创');
          
          // Attempt to check "Ad Settings" (投放广告)
          // The screenshot shows "投放广告" as an option.
          const clickedAds = clickByText('投放广告');

          if (clickedOriginal) console.log('Memoraid: Attempted to check "Original"');
          if (clickedAds) console.log('Memoraid: Attempted to check "Ad Settings"');
          
      }, 1000);

      // Notify user
      const toast = document.createElement('div');
      toast.style.position = 'fixed';
      toast.style.bottom = '20px';
      toast.style.right = '20px';
      toast.style.padding = '10px 20px';
      toast.style.background = '#4CAF50';
      toast.style.color = 'white';
      toast.style.borderRadius = '4px';
      toast.style.zIndex = '9999';
      toast.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
      toast.innerText = 'Memoraid: Content Auto-filled';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);

      // Clear storage
      chrome.storage.local.remove('pending_toutiao_publish');

    } else {
      console.warn('Memoraid: Editor not found');
    }

  } catch (error) {
    console.error('Memoraid: Error filling content', error);
  }
};

// Run on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', fillContent);
} else {
  fillContent();
}
