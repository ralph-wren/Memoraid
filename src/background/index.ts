import OpenAI from 'openai';
import { getSettings, addHistoryItem } from '../utils/storage';
import { ExtractionResult, ActiveTask } from '../utils/types';

console.log('Background service worker started');

let currentTask: ActiveTask | null = null;
let abortController: AbortController | null = null;

// Initialize state from storage on startup
chrome.storage.local.get(['currentTask'], (result) => {
  if (result.currentTask) {
    currentTask = result.currentTask;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
});

// Listen for messages from Popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'START_SUMMARIZATION') {
    startSummarization(message.payload);
    sendResponse({ success: true });
    return true; // async response
  }
  
  if (message.type === 'CANCEL_SUMMARIZATION') {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    currentTask = null;
    chrome.storage.local.remove('currentTask');
    broadcastUpdate();
    sendResponse({ success: true });
    return true;
  }
  
  if (message.type === 'GET_STATUS') {
    // Return the memory state which should be in sync with storage
    sendResponse(currentTask);
    return true;
  }
  
  if (message.type === 'CLEAR_STATUS') {
    currentTask = null;
    chrome.storage.local.remove('currentTask');
    sendResponse({ success: true });
    return true;
  }
});

function updateTaskState(newState: ActiveTask) {
  currentTask = newState;
  chrome.storage.local.set({ currentTask: newState });
  broadcastUpdate();
}

async function startSummarization(extraction: ExtractionResult) {
  try {
    abortController = new AbortController();
    updateTaskState({ status: 'Initializing...', progress: 10 });

    const settings = await getSettings();
    if (!settings.apiKey) {
      throw new Error('API Key is missing. Please check settings.');
    }

    const openai = new OpenAI({
      apiKey: settings.apiKey,
      baseURL: settings.baseUrl,
    });

    updateTaskState({ status: 'Generating summary with AI...', progress: 30 });

    const initialMessages = [
      { role: 'system', content: settings.systemPrompt },
      { 
        role: 'user', 
        content: `Please summarize the following conversation from ${extraction.url}.\n\nTitle: ${extraction.title}\n\nContent:\n${JSON.stringify(extraction.messages)}` 
      }
    ];

    // Create a timeout promise that rejects after 90 seconds
    const timeoutPromise = new Promise((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Generation timed out (exceeded 1.5 minutes). Please try again or use a shorter chat.'));
      }, 90000); // 1.5 minutes
      
      // Clear timeout if aborted
      if (abortController?.signal) {
        abortController.signal.addEventListener('abort', () => clearTimeout(timer));
      }
    });

    const completionPromise = openai.chat.completions.create({
      model: settings.model,
      messages: initialMessages as any,
    }, { signal: abortController.signal });

    // Race between completion and timeout
    const completion: any = await Promise.race([completionPromise, timeoutPromise]);

    const summary = completion.choices[0]?.message?.content || 'No summary generated.';
    
    // Save to History
    const newItem = {
      id: Date.now().toString(),
      title: extraction.title || 'Untitled Chat',
      date: Date.now(),
      content: summary,
      url: extraction.url
    };
    await addHistoryItem(newItem);

    updateTaskState({ 
      status: 'Done!', 
      progress: 100, 
      result: summary 
    });

    // Send Notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'public/icon-128.png',
      title: 'Chat Export Complete',
      message: `Summary generated for: ${extraction.title || 'Untitled Chat'}`
    });

  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.log('Summarization cancelled');
      return; // Do nothing if cancelled
    }

    console.error('Summarization error:', error);
    updateTaskState({ 
      status: 'Error', 
      progress: 0, 
      error: error.message 
    });

    // Send Error Notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'public/icon-128.png',
      title: 'Chat Export Failed',
      message: error.message || 'Unknown error occurred'
    });
  } finally {
    abortController = null;
  }
}

function broadcastUpdate() {
  chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', payload: currentTask }).catch(() => {
    // Popup might be closed, which is expected
  });
}
