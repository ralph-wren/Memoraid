export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ExtractionResult {
  title: string;
  messages: ChatMessage[];
  url: string;

  images?: string[];
}

export type ExtensionMessage = 
  | { type: 'EXTRACT_CONTENT' }
  | { type: 'CONTENT_EXTRACTED', payload: ExtractionResult }
  | { type: 'ERROR', payload: string };

export interface ActiveTask {
  status: string;
  progress: number;
  message?: string; // Detailed log message
  result?: string;
  error?: string;
  conversationHistory?: ChatMessage[]; // Persist chat history for refinement
  title?: string; // Title of the document being processed
  sourceUrl?: string; // Source URL for the article
  sourceImages?: string[]; // Source images from the original content
  generatedId?: string; // ID of the generated article record
  tokenUsage?: TokenUsage; // 本次 AI 调用的 token 消耗统计
}

// Token 消耗统计
export interface TokenUsage {
  promptTokens: number;      // 输入 token 数
  completionTokens: number;  // 输出 token 数
  totalTokens: number;       // 总 token 数
}
