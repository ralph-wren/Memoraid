
// Toutiao Publish Content Script

interface PublishData {
  title: string;
  content: string;
  htmlContent?: string; // Optional HTML content
  timestamp: number;
}

// --- Logger UI ---
class AILogger {
  private container: HTMLDivElement;
  private logContent: HTMLDivElement;
  private header: HTMLDivElement;
  private onStop?: () => void;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'memoraid-ai-logger';
    this.container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      width: 350px;
      max-height: 500px;
      background: rgba(0, 0, 0, 0.85);
      color: #0f0;
      font-family: monospace;
      font-size: 12px;
      border-radius: 8px;
      padding: 10px;
      z-index: 20000;
      display: none;
      flex-direction: column;
      box-shadow: 0 4px 15px rgba(0,0,0,0.5);
      backdrop-filter: blur(5px);
    `;

    this.header = document.createElement('div');
    this.header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #333;padding-bottom:8px;margin-bottom:8px;font-weight:bold;color:white;';
    
    // Header Content
    const title = document.createElement('span');
    title.innerText = '🤖 AI Interaction Log';
    
    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.gap = '8px';

    // Stop Button
    const stopBtn = document.createElement('button');
    stopBtn.innerText = 'Stop';
    stopBtn.style.cssText = 'background:#d32f2f;color:white;border:none;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:10px;display:none;';
    stopBtn.onclick = () => {
        if (this.onStop) this.onStop();
        this.log('🛑 Stopping...', 'error');
        stopBtn.style.display = 'none';
    };
    this.header.appendChild(title);
    this.header.appendChild(controls);
    controls.appendChild(stopBtn);

    // Copy Button
    const copyBtn = document.createElement('button');
    copyBtn.innerText = 'Copy';
    copyBtn.style.cssText = 'background:#1976d2;color:white;border:none;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:10px;';
    copyBtn.title = 'Copy all logs to clipboard';
    copyBtn.onclick = () => {
        const text = this.logContent.innerText;
        navigator.clipboard.writeText(text).then(() => {
            const originalText = copyBtn.innerText;
            copyBtn.innerText = 'Copied!';
            setTimeout(() => copyBtn.innerText = originalText, 2000);
        }).catch(err => {
            console.error('Failed to copy logs:', err);
            this.log('Failed to copy logs', 'error');
        });
    };
    controls.appendChild(copyBtn);

    // Close Button
    const closeBtn = document.createElement('span');
    closeBtn.innerText = '✕';
    closeBtn.style.cssText = 'cursor:pointer;margin-left:8px;';
    closeBtn.onclick = () => this.container.style.display = 'none';
    controls.appendChild(closeBtn);

    this.logContent = document.createElement('div');
    this.logContent.style.cssText = 'overflow-y:auto;flex:1;min-height:100px;';

    this.container.appendChild(this.header);
    this.container.appendChild(this.logContent);
    document.body.appendChild(this.container);

    // Expose stop button for toggle
    (this as any).stopBtn = stopBtn;
  }

  show() {
    this.container.style.display = 'flex';
  }

  setStopCallback(cb: () => void) {
    this.onStop = cb;
    ((this as any).stopBtn as HTMLElement).style.display = 'block';
  }

  hideStopButton() {
    ((this as any).stopBtn as HTMLElement).style.display = 'none';
  }

  log(message: string, type: 'info' | 'action' | 'error' | 'ai' | 'warn' = 'info') {
    this.show();
    const line = document.createElement('div');
    line.style.marginTop = '4px';
    line.style.wordWrap = 'break-word'; // Ensure long words break
    line.style.whiteSpace = 'pre-wrap'; // Preserve newlines but wrap
    const time = new Date().toLocaleTimeString();
    
    let color = '#ccc';
    if (type === 'action') color = '#0ff'; // Cyan for actions
    if (type === 'error') color = '#f55';  // Red for errors
    if (type === 'ai') color = '#f0f';     // Magenta for AI thoughts
    if (type === 'warn') color = '#fb0';   // Orange/Yellow for warnings

    line.innerHTML = `<span style="color:#666">[${time}]</span> <span style="color:${color}">${message}</span>`;
    this.logContent.appendChild(line);
    this.logContent.scrollTop = this.logContent.scrollHeight;
  }
}

const logger = new AILogger();

// --- DOM Extraction ---

interface SimplifiedNode {
  id: number;
  tag: string;
  text?: string;
  placeholder?: string;
  selector?: string; // CSS selector if possible
  rect: { x: number, y: number, w: number, h: number };
}

let nodeMap = new Map<number, HTMLElement>();
let nextNodeId = 1;

const getSimplifiedDOM = (): SimplifiedNode[] => {
  nodeMap.clear();
  nextNodeId = 1;
  const nodes: SimplifiedNode[] = [];
  
  // Select interactive elements
  // Strategy:
  // 1. Use specific selectors for known interactive elements.
  // 2. Scan a broader set of elements (divs, spans, images) for 'cursor: pointer' style, 
  //    which strongly indicates interactivity regardless of tag/class.
  
  const selectorElements = Array.from(document.querySelectorAll(`
    button, input, textarea, a, 
    [role="button"], [tabindex], 
    .syl-toolbar-tool, .upload-handler,
    li, 
    [class*="tab" i], [class*="btn" i], [class*="button" i], 
    [class*="upload" i], [class*="cover" i],
    .byte-tabs-item, .byte-btn,
    .article-cover-add, .article-cover-img,
    svg, img
  `)) as HTMLElement[];

  // Scan for pointer cursor elements (heuristic for clickable divs/spans)
  // We limit this to visible elements in the viewport or reasonably close to avoid analyzing the whole footer
  const candidates = document.querySelectorAll('div, span, i');
  const pointerElements: HTMLElement[] = [];
  
  // Optimization: Batch style reads if possible, but for now simple loop
  // To avoid performance hit on huge pages, we can limit the count or rely on the fact that this runs only when AI is invoked
  candidates.forEach(el => {
      // Fast check: skip if obviously not relevant (e.g. empty spans often used for spacing, though some are icons)
      // We will check computed style.
      const style = window.getComputedStyle(el);
      if (style.cursor === 'pointer') {
          pointerElements.push(el as HTMLElement);
      }
  });

  const allElements = new Set([...selectorElements, ...pointerElements]);
  
  allElements.forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 5 || rect.height < 5) return; // Skip tiny elements, but allow off-screen ones

    const htmlEl = el as HTMLElement;
    const style = window.getComputedStyle(htmlEl);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;

    const id = nextNodeId++;
    nodeMap.set(id, htmlEl);
    
    // Generate a simple selector
    let selector = htmlEl.tagName.toLowerCase();
    if (htmlEl.id) selector += `#${htmlEl.id}`;
    else if (htmlEl.classList.length > 0) selector += `.${Array.from(htmlEl.classList).join('.')}`;

    let text = htmlEl.innerText?.substring(0, 50).replace(/\s+/g, ' ').trim();
    if (!text && htmlEl.getAttribute('aria-label')) text = `[ARIA] ${htmlEl.getAttribute('aria-label')}`;
    if (!text && (htmlEl as HTMLInputElement).value) text = `[Value] ${(htmlEl as HTMLInputElement).value}`;

    nodes.push({
      id,
      tag: htmlEl.tagName.toLowerCase(),
      text: text || undefined,
      placeholder: (htmlEl as HTMLInputElement).placeholder || undefined,
      selector,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height)
      }
    });
  });

  return nodes;
};


// --- Standard Helpers ---

const waitForElement = (selector: string, timeout = 10000): Promise<HTMLElement | null> => {
  return new Promise((resolve) => {
    if (document.querySelector(selector)) return resolve(document.querySelector(selector) as HTMLElement);
    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) {
        observer.disconnect();
        resolve(document.querySelector(selector) as HTMLElement);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
  });
};

const simulateInput = (element: HTMLElement, value: string) => {
  element.focus();
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;

  if (element instanceof HTMLInputElement && nativeInputValueSetter) {
    nativeInputValueSetter.call(element, value);
  } else if (element instanceof HTMLTextAreaElement && nativeTextAreaValueSetter) {
    nativeTextAreaValueSetter.call(element, value);
  } else {
    // Fallback for contenteditable or other types
    element.innerText = value;
  }
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
};

const selectTextInEditor = (searchText: string): boolean => {
    const editor = document.querySelector('.ProseMirror') as HTMLElement;
    if (!editor) return false;

    const trySelect = (text: string) => {
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
        let node: Node | null;
        while ((node = walker.nextNode())) {
            if (node.textContent && node.textContent.includes(text)) {
                const range = document.createRange();
                range.selectNodeContents(node);
                const selection = window.getSelection();
                selection?.removeAllRanges();
                selection?.addRange(range);
                node.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return true;
            }
        }
        return false;
    };

    if (trySelect(searchText)) return true;
    
    // Fallback: Try a shorter substring if the exact match failed
    if (searchText.length > 15) {
        if (trySelect(searchText.substring(0, 15))) return true;
    }

    return false;
};





// --- Enhanced Magic Image Flow ---

interface AIAction {
  action: 'click' | 'input' | 'done' | 'fail';
  target_id?: number; // ID from our simplified DOM
  selector?: string; // CSS selector fallback
  coordinates?: { x: number, y: number }; // Fallback
  value?: string; // For input
  reason: string;
}

interface ImageTask {
    type: 'cover' | 'inline';
    keyword: string;
    context?: string; // Text to find and replace/append
    reason: string;
}

// Conversation History for Context Awareness
let interactionHistory: { role: 'user' | 'assistant', content: string }[] = [];

let isFlowCancelled = false;

const showClickMarker = (x: number, y: number) => {
    const dot = document.createElement('div');
    dot.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:20px;height:20px;background:rgba(255,0,0,0.6);border:2px solid red;border-radius:50%;z-index:10000;pointer-events:none;transform:translate(-50%,-50%);transition:all 0.3s;`;
    document.body.appendChild(dot);
    setTimeout(() => { dot.style.opacity = '0'; dot.style.transform = 'translate(-50%,-50%) scale(2)'; }, 500);
    setTimeout(() => dot.remove(), 1000);
};

const askAIForAction = async (taskDescription: string): Promise<AIAction | null> => {
    if (isFlowCancelled) throw new Error('Cancelled by user');

    logger.log(`Analyzing: ${taskDescription}...`, 'info');
    
    let domNodes = getSimplifiedDOM();
    
    // --- Context-Aware Sorting ---
    // Move elements relevant to the task to the top of the list to avoid truncation
    const keywords = taskDescription.toLowerCase().split(/\s+/).filter(k => k.length > 2);
    
    domNodes.sort((a, b) => {
        let scoreA = 0;
        let scoreB = 0;
        
        const textA = (a.text + ' ' + a.selector + ' ' + a.tag).toLowerCase();
        const textB = (b.text + ' ' + b.selector + ' ' + b.tag).toLowerCase();
        
        keywords.forEach(kw => {
            if (textA.includes(kw)) scoreA += 1;
            if (textB.includes(kw)) scoreB += 1;
        });
        
        // Also prioritize high z-index or visible dialogs if we could detect them, 
        // but for now, keyword matching is strong enough.
        
        return scoreB - scoreA;
    });
    
    const domSummary = JSON.stringify(domNodes.slice(0, 300)); // Limit to first 300 interactive elements
    
    // logger.log(`Extracted ${domNodes.length} interactive elements.`, 'info');

    const prompt = `
    Task: ${taskDescription}
    
    I will provide:
    1. A screenshot of the page.
    2. A list of interactive DOM elements with IDs, tags, text, and coordinates (Simplified DOM).
    
    You must:
    1. Analyze the screenshot and DOM to find the target element.
    2. Return a JSON object (NO markdown) with:
    - "action": "click" or "input" or "done" (if task seems finished) or "fail"
    - "target_id": The 'id' from the provided DOM list that matches best.
    - "reason": Brief explanation.
    - "value": (If action is input) The text to type.
    - "coordinates": {x, y} (0-100 percentage) as a backup if DOM matching fails.

    DOM List:
    ${domSummary}
    `;

    try {
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('AI Request Timed Out (30s)')), 30000)
        );

        const responsePromise = chrome.runtime.sendMessage({ 
            type: 'ANALYZE_SCREENSHOT', 
            payload: { 
                prompt,
                history: interactionHistory // Send previous context
            } 
        });

        const response = await Promise.race([responsePromise, timeoutPromise]) as any;

        if (response.success && response.result) {
            // logger.log(`AI Thought: ${response.result}`, 'ai');
            
            // Update History with the abstract task and the result
            // We store the simplified task description, not the full prompt with DOM dump
            interactionHistory.push({ role: 'user', content: `Task: ${taskDescription}` });
            interactionHistory.push({ role: 'assistant', content: response.result });
            
            // Keep history manageable (last 10 turns)
            if (interactionHistory.length > 20) {
                interactionHistory = interactionHistory.slice(interactionHistory.length - 20);
            }

            const jsonMatch = response.result.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    // Pre-process JSON to fix common AI errors
                    let jsonStr = jsonMatch[0];
                    // Fix single quotes to double quotes for property names and string values
                    // This is a naive regex but helps with simple cases. 
                    // Be careful not to break apostrophes inside strings.
                    // A safer bet is to rely on the prompt, but we can try to fix strict syntax errors.
                    
                    return JSON.parse(jsonStr) as AIAction;
                } catch (e: any) {
                    logger.log(`JSON Parse Error: ${e.message}`, 'error');
                    
                    // Attempt to repair: sometimes AI adds comments // or trailing commas
                    try {
                        let looseJson = jsonMatch[0]
                            .replace(/\/\/.*$/gm, '') // Remove comments
                            .replace(/,\s*}/g, '}'); // Remove trailing comma
                        
                        return JSON.parse(looseJson) as AIAction;
                    } catch (e2) {
                         logger.log(`JSON Repair Failed.`, 'warn');
                         logger.log(`Raw snippet: ${jsonMatch[0].substring(0, 100)}...`, 'warn');
                    }
                }
            }
        } else {
            logger.log(`AI Error: ${response.error}`, 'error');
        }
    } catch (e: any) {
        logger.log(`Exception: ${e.message || e}`, 'error');
    }
    return null;
};

const executeAction = async (action: AIAction): Promise<boolean> => {
    if (isFlowCancelled) throw new Error('Cancelled by user');
    if (action.action === 'fail') {
        logger.log(`AI Failed: ${action.reason}`, 'error');
        return false;
    }
    
    let target: HTMLElement | undefined;

    if (action.target_id && nodeMap.has(action.target_id)) {
        target = nodeMap.get(action.target_id);
    }
    if (!target && action.selector) {
        try {
            const el = document.querySelector(action.selector);
            if (el) target = el as HTMLElement;
        } catch (e) {}
    }
    if (!target && action.coordinates) {
        const { x: pctX, y: pctY } = action.coordinates;
        
        if (typeof pctX === 'number' && typeof pctY === 'number' && 
            Number.isFinite(pctX) && Number.isFinite(pctY)) {
            
            const x = window.innerWidth * (pctX / 100);
            const y = window.innerHeight * (pctY / 100);
            
            if (Number.isFinite(x) && Number.isFinite(y)) {
                showClickMarker(x, y);
                try {
                    target = document.elementFromPoint(x, y) as HTMLElement;
                } catch (e) {
                    logger.log(`Coordinate lookup failed: ${e}`, 'warn');
                }
            } else {
                logger.log(`Calculated coordinates non-finite: ${x}, ${y}`, 'warn');
            }
        } else {
             logger.log(`Invalid coordinates received: ${JSON.stringify(action.coordinates)}`, 'warn');
        }
    }

    if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await new Promise(r => setTimeout(r, 500)); // Wait for scroll
        
        const rect = target.getBoundingClientRect();
        showClickMarker(rect.left + rect.width/2, rect.top + rect.height/2);
        
        if (action.action === 'click') {
            target.click();
            logger.log(`Clicked: ${action.reason}`, 'action');
            return true;
        } else if (action.action === 'input' && action.value) {
            target.click();
            simulateInput(target, action.value);
            target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
            logger.log(`Input "${action.value}": ${action.reason}`, 'action');
            return true;
        }
    } else {
        logger.log('Could not locate target element.', 'error');
    }
    return false;
};

const analyzeArticleForImages = async (): Promise<ImageTask[]> => {
    // Scroll to bottom to ensure lazy-loaded content is present
    logger.log('Scrolling to capture full content...', 'info');
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise(r => setTimeout(r, 1000));
    window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 500));

    const editor = document.querySelector('.ProseMirror') || document.querySelector('[contenteditable="true"]');
    // Get text but limit length to avoid token limits, but increased to 5000
    const content = (editor as HTMLElement)?.innerText || '';
    
    logger.log(`Analyzing article (${content.length} chars) for image opportunities...`, 'info');

    const prompt = `
    I have an article content. I need you to identify where images should be inserted.
    
    Article Content:
    ${content.substring(0, 5000)}... (truncated if longer)

    Task:
    1. Identify if a "Cover Image" (封面) is needed/suggested.
    2. Identify inline image placeholders.
    3. Return a STRICT JSON array of tasks.
    
    IMPORTANT JSON RULES:
    - Return ONLY the JSON array. No markdown.
    - **Do NOT include newlines or line breaks inside string values.**
    - Keep "context" and "reason" VERY SHORT (max 30 chars) to avoid cutoff.
    - Escape all double quotes inside strings with backslash.
    - **CRITICAL: The "keyword" MUST be in Simplified Chinese (zh-CN) for accurate search.**

    Format:
    [
      { "type": "cover", "keyword": "中文搜索关键词", "reason": "short reason" },
      { "type": "inline", "keyword": "中文搜索关键词", "context": "short unique snippet", "reason": "short reason" }
    ]
    `;

    try {
        const response = await chrome.runtime.sendMessage({ 
            type: 'ANALYZE_SCREENSHOT', 
            payload: { prompt } 
        });

        if (response.success && response.result) {
            let jsonStr = response.result;
            // Clean up potential markdown code blocks
            jsonStr = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
            
            // Attempt to find array brackets
            const firstBracket = jsonStr.indexOf('[');
            const lastBracket = jsonStr.lastIndexOf(']');
            if (firstBracket !== -1 && lastBracket !== -1) {
                jsonStr = jsonStr.substring(firstBracket, lastBracket + 1);
            }

            // Advanced Sanitizer: Handle newlines inside strings vs formatting newlines
            const sanitizeJson = (str: string) => {
                let inString = false;
                let result = '';
                for (let i = 0; i < str.length; i++) {
                    const char = str[i];
                    // Check for unescaped quote
                    if (char === '"' && (i === 0 || str[i - 1] !== '\\')) {
                        inString = !inString;
                    }
                    
                    if (char === '\n') {
                        if (inString) {
                            // Escape newline inside string
                            result += '\\n';
                        } else {
                            // Keep formatting newline (valid in JSON)
                            result += char;
                        }
                    } else {
                        result += char;
                    }
                }
                return result;
            };

            jsonStr = sanitizeJson(jsonStr);

            try {
                return JSON.parse(jsonStr) as ImageTask[];
            } catch (parseError) {
                logger.log(`JSON Parse Error. Trying truncation repair...`, 'error');
                logger.log(`Raw: ${jsonStr}`, 'error'); 

                // Truncation Repair: Find last valid object closing and close array
                // We search for "}" or "}," from the end
                const lastClose = jsonStr.lastIndexOf('}');
                if (lastClose !== -1) {
                    // Check if it looks like the start of a valid closure
                    const repaired = jsonStr.substring(0, lastClose + 1) + ']';
                    try {
                         const fixed = JSON.parse(repaired) as ImageTask[];
                         logger.log(`Repaired truncated JSON, recovered ${fixed.length} items.`, 'action');
                         return fixed;
                    } catch (e2) {
                        logger.log(`Repair failed: ${e2}`, 'error');
                    }
                }
                throw parseError;
            }
        }
    } catch (e) {
        logger.log(`Analysis failed: ${e}`, 'error');
    }
    return [];
};

const runSingleImageSearchFlow = async (keyword: string) => {
    // 1. Search Tab/Input
    // We explicitly ask to find "Free Library"
    const step1 = await askAIForAction(`Find the "Free Library" (免费正版图库) tab or button in the image dialog. Click it.`);
    if (step1) await executeAction(step1);
    
    await new Promise(r => setTimeout(r, 2000));
    if (isFlowCancelled) throw new Error('Cancelled by user');

    // 2. Input Keyword
    const step2 = await askAIForAction(`Find the search input in the Free Library. Input "${keyword}".`);
    if (step2) {
        step2.value = keyword;
        await executeAction(step2);
    }

    await new Promise(r => setTimeout(r, 3000)); // Wait for results
    if (isFlowCancelled) throw new Error('Cancelled by user');

    // 3. Select Image
    const step3 = await askAIForAction(`
        Look at the search results in the dialog.
        Task: Select the SINGLE BEST image that matches the concept "${keyword}".
        Requirements:
        1. Do NOT automatically pick the first image. 
        2. Analyze the visual content of the thumbnails.
        3. Pick the one that is most high-quality and relevant.
        4. Click that specific image thumbnail.
    `);
    if (step3) await executeAction(step3);

    await new Promise(r => setTimeout(r, 1000));
    if (isFlowCancelled) throw new Error('Cancelled by user');

    // 4. Confirm
    const step4 = await askAIForAction('Find and click the "Confirm" (确定/插入) button.');
    if (step4) await executeAction(step4);
};

const runMagicImageFlow = async () => {
    isFlowCancelled = false;
    interactionHistory = []; // Reset history for new flow
    logger.show();
    logger.setStopCallback(() => { isFlowCancelled = true; });
    logger.log('Starting Smart Image Flow...', 'info');

    // Scroll to bottom first as requested
    logger.log('Scrolling to bottom to ensure all elements are visible...', 'info');
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise(r => setTimeout(r, 1000));

    try {
        // Phase 1: Analyze Article
        const tasks = await analyzeArticleForImages();
        logger.log(`Found ${tasks.length} image tasks.`, 'info');

        if (tasks.length === 0) {
            logger.log('No automatic image tasks found.', 'info');
            return;
        }

        for (const task of tasks) {
            if (isFlowCancelled) break;
            logger.log(`Executing Task: ${task.type} - ${task.keyword}`, 'info');

            if (task.type === 'cover') {
                // Find Cover Upload Button
                logger.log('Scrolling to bottom for cover settings...', 'info');
                window.scrollTo(0, document.body.scrollHeight);
                await new Promise(r => setTimeout(r, 1000));

                const coverBtn = await askAIForAction('Find the "Set Cover" (展示封面/设置封面) "+" button or area. It is usually a large box with a plus sign.');
                if (coverBtn) {
                    await executeAction(coverBtn);
                    await new Promise(r => setTimeout(r, 1000));
                    await runSingleImageSearchFlow(task.keyword);
                }
            } else if (task.type === 'inline') {
                if (task.context) {
                    // 1. Locate Toolbar Button FIRST (without clicking)
                    const imageBtnAction = await askAIForAction('Locate the "Image" (图片) button in the editor toolbar. Action: "click" (but I will execute it later).');

                    if (imageBtnAction) {
                        // 2. Locate and Select Text
                        logger.log(`Locating context: "${task.context.substring(0, 20)}..."`, 'info');
                        const found = selectTextInEditor(task.context);
                        
                        if (!found) {
                            logger.log('Could not find context text, inserting at current cursor.', 'error');
                            // If not found, we just click the button (might insert at end)
                            await executeAction(imageBtnAction);
                        } else {
                            // 3. Delete the placeholder text
                            try {
                                document.execCommand('delete');
                                logger.log('Removed placeholder text.', 'action');
                            } catch (e) {
                                logger.log('Failed to delete placeholder text, continuing...', 'warn');
                            }
                            
                            // 4. IMMEDIATELY Click the button we found earlier
                            // This ensures the cursor position (set by delete) is preserved
                            await executeAction(imageBtnAction);
                        }

                        await new Promise(r => setTimeout(r, 1000));
                        await runSingleImageSearchFlow(task.keyword);
                    } else {
                         logger.log('Could not find Image toolbar button.', 'error');
                    }
                }
            }
            
            await new Promise(r => setTimeout(r, 2000)); // Pause between tasks
        }

        logger.log('All tasks completed.', 'info');

    } catch (e: any) {
        if (e.message === 'Cancelled by user') {
            logger.log('Flow cancelled by user.', 'error');
        } else {
            logger.log(`Flow Error: ${e.message || e}`, 'error');
        }
    } finally {
        logger.hideStopButton();
    }
};

// --- Auto-Fill Logic (Robust) ---
const fillContent = async () => {
  try {
    const data = await chrome.storage.local.get('pending_toutiao_publish');
    if (!data || !data.pending_toutiao_publish) return;
    const payload: PublishData = data.pending_toutiao_publish;
    
    // Expire after 5 minutes
    if (Date.now() - payload.timestamp > 5 * 60 * 1000) {
      chrome.storage.local.remove('pending_toutiao_publish');
      return;
    }

    logger.log(`Found pending content: ${payload.title}`, 'info');
    logger.log('Waiting for editor to load...', 'info');

    // Retry finding elements
    let attempts = 0;
    const maxAttempts = 10;
    
    const tryFill = async () => {
        // Title Selectors: Try multiple common patterns
        const titleEl = (document.querySelector('textarea[placeholder*="标题"]') || 
                         document.querySelector('input[placeholder*="标题"]') ||
                         document.querySelector('.article-title-wrap input')) as HTMLElement;
        
        // Editor Selectors
        const editorEl = (document.querySelector('.ProseMirror') || 
                          document.querySelector('[contenteditable="true"]')) as HTMLElement;

        if (titleEl && editorEl) {
            // Fill Title
            simulateInput(titleEl, payload.title);
            logger.log('Title filled', 'action');

            // Fill Content
            editorEl.click();
            editorEl.focus();
            
            // Use execCommand for rich text (HTML) if available, otherwise Text
            if (payload.htmlContent) {
                 document.execCommand('insertHTML', false, payload.htmlContent);
                 logger.log('Content filled (HTML)', 'action');
            } else {
                 document.execCommand('insertText', false, payload.content);
                 logger.log('Content filled (Text)', 'action');
            }
            
            chrome.storage.local.remove('pending_toutiao_publish');
            return true;
        }
        return false;
    };

    const interval = setInterval(async () => {
        attempts++;
        const success = await tryFill();
        if (success || attempts >= maxAttempts) {
            clearInterval(interval);
            if (!success) {
                logger.log('Failed to auto-fill content: Editor not found.', 'error');
            } else {
                logger.log('Content filled. Auto-starting AI Image Flow...', 'info');
                setTimeout(() => runMagicImageFlow(), 2000);
            }
        }
    }, 1000);

  } catch (error) {
    console.error('Memoraid: Error filling content', error);
    logger.log(`Error filling content: ${error}`, 'error');
  }
};

// Run on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
      fillContent();
  });
} else {
  fillContent();
}
