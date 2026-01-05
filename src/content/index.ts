import { ExtractionResult, ChatMessage } from '../utils/types';
import { Readability } from '@mozilla/readability';

console.log('Chat Export Content Script Loaded');

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'EXTRACT_CONTENT') {
    extractContent()
      .then(data => {
        sendResponse({ type: 'CONTENT_EXTRACTED', payload: data });
      })
      .catch(err => {
        sendResponse({ type: 'ERROR', payload: err.message });
      });
    return true; // Keep channel open for async response
  }
});

async function extractContent(): Promise<ExtractionResult> {
  const url = window.location.hostname;
  
  if (url.includes('chatgpt.com') || url.includes('openai.com')) {
    return extractChatGPT();
  } else if (url.includes('gemini.google.com')) {
    return extractGemini();
  } else if (url.includes('chat.deepseek.com')) {
    return extractDeepSeek();
  } else {
    return extractGenericPage();
  }
}

async function extractGenericPage(): Promise<ExtractionResult> {
  // Attempt to auto-expand "Read More" buttons before extraction
  await autoExpandContent();

  try {
    // Clone document to avoid modifying the actual page during parsing (though we might have modified it by expanding)
    const documentClone = document.cloneNode(true) as Document;
    const reader = new Readability(documentClone);
    const article = reader.parse();

    const title = article?.title || document.title || 'Web Page Content';
    const content = article?.textContent || document.body.innerText;

    return {
      title,
      messages: [{
        role: 'user',
        content: `Page Content:\n\n${content.trim()}`
      }],
      url: window.location.href
    };
  } catch (error) {
    console.warn('Readability extraction failed, falling back to body text', error);
    return {
      title: document.title || 'Web Page Content',
      messages: [{
        role: 'user',
        content: document.body.innerText
      }],
      url: window.location.href
    };
  }
}

async function autoExpandContent() {
  const EXPAND_SELECTORS = [
    '.btn-readmore', // CSDN
    '.btn-read-more', // Juejin
    '.read-more-btn',
    '.expand-button',
    '#btn-readmore',
    '.show-more', // SegmentFault
    '[data-action="expand"]'
  ];

  const EXPAND_TEXTS = ['阅读全文', '展开阅读', 'Read More', 'Show More', '展开更多'];

  console.log('Attempting to auto-expand content...');
  let expanded = false;

  // 1. Try Selectors
  for (const selector of EXPAND_SELECTORS) {
    const btn = document.querySelector(selector) as HTMLElement;
    if (btn && btn.offsetParent !== null) { // Check if visible
      console.log('Found expand button by selector:', selector);
      btn.click();
      expanded = true;
    }
  }

  // 2. Try Text Content (if no selector matched)
  if (!expanded) {
    const buttons = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
    for (const btn of buttons) {
      const text = (btn as HTMLElement).innerText?.trim();
      if (text && EXPAND_TEXTS.some(t => text === t)) {
        console.log('Found expand button by text:', text);
        (btn as HTMLElement).click();
        expanded = true;
        break; // Only click one main expand button usually
      }
    }
  }

  if (expanded) {
    // Wait for content to load/expand
    await new Promise(resolve => setTimeout(resolve, 800));
  }
}


function extractDeepSeek(): ExtractionResult {
  const title = document.title || 'DeepSeek Conversation';
  const messages: ChatMessage[] = [];
  
  // DeepSeek Chat DOM Structure Analysis (as of Jan 2025)
  // Usually wrapped in a container. Let's look for standard patterns.
  // User message: often has specific classes or alignment
  // Assistant message: often has 'ds-markdown' or similar class
  
  // Attempt 1: Look for message container class (common in React apps)
  // We'll search for elements that look like message bubbles
  
  // Note: Since we can't inspect the live DOM, we'll use a robust heuristic strategy
  // 1. Find the main chat container
  // 2. Iterate through children
  // 3. Classify based on known markers (e.g., "DeepSeek" avatar, "You" label)

  // Try to find all message blocks
  const messageBlocks = document.querySelectorAll('div[class*="message"], div[class*="chat-item"]');
  
  if (messageBlocks.length > 0) {
      messageBlocks.forEach(block => {
          const text = (block as HTMLElement).innerText;
          if (!text) return;
          
          // Heuristic to determine role
          // This is a best-guess without exact class names. 
          // Often user messages are on the right or have "User"/"You"
          // Assistant messages have the logo or "DeepSeek"
          
          // For now, let's grab the text and try to deduce, or just dump it.
          // Better strategy: DeepSeek uses markdown rendering for assistant.
          // Look for 'ds-markdown' or similar class which is likely the assistant.
          
          let role: 'user' | 'assistant' = 'user';
          if (block.innerHTML.includes('ds-markdown') || block.innerHTML.includes('markdown-body')) {
              role = 'assistant';
          }
          
          messages.push({ role, content: text });
      });
  } 

  // Fallback: If no specific structure found, grab the main text content
  if (messages.length === 0) {
    const main = document.querySelector('main') || document.body;
    if (main) {
       messages.push({ 
         role: 'user', 
         content: main.innerText + '\n\n(Note: Automatic extraction could not identify individual messages for DeepSeek yet. Captured full page text.)' 
       });
    }
  }

  return {
    title,
    messages,
    url: window.location.href
  };
}

function extractChatGPT(): ExtractionResult {
  const title = document.title || 'ChatGPT Conversation';
  const messages: ChatMessage[] = [];
  
  // Strategy 1: data-message-author-role (Standard)
  let messageElements = document.querySelectorAll('[data-message-author-role]');
  
  // Strategy 2: Fallback to article tags (often used in new UI)
  if (messageElements.length === 0) {
    messageElements = document.querySelectorAll('article');
  }

  // Strategy 3: Text-based heuristic (Last resort)
  if (messageElements.length === 0) {
     console.warn('No standard chat elements found. Trying to capture visible text.');
     const main = document.querySelector('main');
     if (main) {
       return {
         title,
         messages: [{ role: 'user', content: main.innerText }],
         url: window.location.href
       };
     }
  }

  messageElements.forEach((el) => {
    let role: 'user' | 'assistant' = 'user';
    
    if (el.hasAttribute('data-message-author-role')) {
        role = el.getAttribute('data-message-author-role') as 'user' | 'assistant';
    } else if (el.tagName.toLowerCase() === 'article') {
        // In some versions, user messages have a specific class or lack 'text-token-text-primary'
        // This is tricky without specific classes. 
        // Often assistant messages have a specific avatar or icon.
        // Let's assume if it contains "ChatGPT" or has specific SVG it's assistant.
        const isAssistant = el.querySelector('.markdown') !== null;
        role = isAssistant ? 'assistant' : 'user';
    }

    // specific cleanup for ChatGPT
    // Remove "Copy code" buttons text if present in textContent
    const clone = el.cloneNode(true) as HTMLElement;
    const buttons = clone.querySelectorAll('button');
    buttons.forEach(b => b.remove()); // Remove buttons to avoid "Copy code" text
    
    const textContent = clone.textContent || '';
    
    if (textContent.trim()) {
        messages.push({
          role: role,
          content: textContent.trim()
        });
    }
  });

  return {
    title,
    messages,
    url: window.location.href
  };
}

function extractGemini(): ExtractionResult {
  const title = document.title || 'Gemini Conversation';
  const messages: ChatMessage[] = [];

  // Gemini is tricky. Look for user-query and model-response classes or similar attributes.
  // As of late 2023/early 2024:
  // User: .user-query-container or [data-test-id="user-query"]
  // Model: .model-response-container or [data-test-id="model-response"]
  
  // Let's try a generic approach iterating through the chat history container
  // The container is usually infinite-scroller or similar.
  
  const turnContainers = document.querySelectorAll('user-query, model-response');
  
  if (turnContainers.length > 0) {
     turnContainers.forEach(el => {
       const isUser = el.tagName.toLowerCase() === 'user-query';
       const text = el.textContent || '';
       messages.push({
         role: isUser ? 'user' : 'assistant',
         content: text.trim()
       });
     });
  } else {
     // Fallback for different DOM structure
     // Just grab all text for now if specific selectors fail
     const main = document.querySelector('main');
     if (main) {
       messages.push({ role: 'user', content: main.innerText }); // desperation
     }
  }

  return {
    title,
    messages,
    url: window.location.href
  };
}
