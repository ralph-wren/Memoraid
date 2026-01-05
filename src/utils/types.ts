export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ExtractionResult {
  title: string;
  messages: ChatMessage[];
  url: string;
}

export type ExtensionMessage = 
  | { type: 'EXTRACT_CONTENT' }
  | { type: 'CONTENT_EXTRACTED', payload: ExtractionResult }
  | { type: 'ERROR', payload: string };

export interface ActiveTask {
  status: string;
  progress: number;
  result?: string;
  error?: string;
}
