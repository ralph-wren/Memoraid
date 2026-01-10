export interface Translation {
  // Settings page
  settingsTitle: string;
  languageLabel: string;
  languageHint: string;
  providerLabel: string;
  apiKeyLabel: string;
  getKey: string;
  apiKeyPlaceholder: string;
  baseUrlLabel: string;
  modelLabel: string;
  manualInput: string;
  doubaoHint: string;
  githubTitle: string;
  tokenLabel: string;
  ownerLabel: string;
  repoLabel: string;
  branchLabel: string;
  verifyButton: string;
  verifying: string;
  verifyTitle: string;
  fillGithubAlert: string;
  systemPromptLabel: string;
  resetButton: string;
  promptPlaceholder: string;
  saveButton: string;
  savedButton: string;
  savedMessage: string;
  
  // Home page
  homeDescription: string;
  publishToToutiao: string;
  publishToZhihu: string;
  orSeparator: string;
  generateArticleOnly: string;
  generateSummary: string;
  generateTechDoc: string;
  processing: string;
  viewLiveResult: string;
  stopGenerating: string;
  recentDocuments: string;
  clearAll: string;
  noHistoryYet: string;
  result: string;
  showCode: string;
  preview: string;
  close: string;
  copy: string;
  download: string;
  save: string;
  toutiao: string;
  zhihu: string;
  refinePromptPlaceholder: string;
  status: string;
  
  // Messages
  extractingContent: string;
  contentExtracted: string;
  publishingToToutiao: string;
  publishingToZhihu: string;
  publishSuccess: string;
  publishFailed: string;
  connectionFailed: string;
  refreshPage: string;
  cookieMissing: string;
  goToSettings: string;
  copiedToClipboard: string;
  pushedToGithub: string;
  confirmClearHistory: string;
  
  // GitHub Modal
  saveToGithub: string;
  fileName: string;
  directory: string;
  commitMessage: string;
  loadingDirectories: string;
  pushing: string;
  pushToGithub: string;
  successfullyPushed: string;
  viewOnGithub: string;
  githubNotConfigured: string;
  
  // Settings page - additional
  syncBackupTitle: string;
  syncDescription: string;
  googleLogin: string;
  githubLogin: string;
  loginSuccess: string;
  loginFailed: string;
  logout: string;
  encryptionKeyLabel: string;
  encryptionKeyHint: string;
  randomGenerate: string;
  syncUp: string;
  restore: string;
  lastSynced: string;
  
  // Toutiao config
  toutiaoConfigTitle: string;
  cookieLabel: string;
  autoFetch: string;
  cookieHint: string;
  autoPublish: string;
  autoPublishHintToutiao: string;
  noToutiaoCookie: string;
  
  // Zhihu config
  zhihuConfigTitle: string;
  autoPublishHintZhihu: string;
  noZhihuCookie: string;
  
  // Article style
  articleStyleTitle: string;
  articleStyleHint: string;
  styleStance: string;
  styleStanceLeft: string;
  styleStanceRight: string;
  styleEmotion: string;
  styleEmotionLeft: string;
  styleEmotionRight: string;
  styleTone: string;
  styleToneLeft: string;
  styleToneRight: string;
  stylePoliteness: string;
  stylePolitenessLeft: string;
  stylePolitenessRight: string;
  styleFormality: string;
  styleFormalityLeft: string;
  styleFormalityRight: string;
  styleHumor: string;
  styleHumorLeft: string;
  styleHumorRight: string;
  resetToDefaultStyle: string;
  
  // Debug mode
  debugModeTitle: string;
  debugModeHint: string;
  
  // Misc
  downloadMarkdown: string;
  
  // Custom prompts for platforms
  customPromptLabel: string;
  customPromptHint: string;
  customPromptPlaceholder: string;
  resetToDefault: string;
  
  // Auto save
  autoSaving: string;
  autoSaved: string;
  autoSaveHint: string;
}

export const TRANSLATIONS: Record<string, Translation> = {
  'en': {
    // Settings page
    settingsTitle: 'Settings',
    languageLabel: 'Language (Output Language)',
    languageHint: 'Changing language will update the System Prompt if you are using a default template.',
    providerLabel: 'Provider',
    apiKeyLabel: 'API Key',
    getKey: 'Get Key',
    apiKeyPlaceholder: 'Enter your API Key',
    baseUrlLabel: 'Base URL',
    modelLabel: 'Model',
    manualInput: 'Manual Input...',
    doubaoHint: 'Note: For Doubao, you usually need to use the Endpoint ID (e.g. ep-202406...) as the model name.',
    githubTitle: 'GitHub Integration (Save Target)',
    tokenLabel: 'Personal Access Token (Repo Scope)',
    ownerLabel: 'Owner (User/Org)',
    repoLabel: 'Repo Name',
    branchLabel: 'Branch (Default: main)',
    verifyButton: 'Verify',
    verifying: '...',
    verifyTitle: 'Verify Connection',
    fillGithubAlert: 'Please fill in Token, Owner, and Repo Name',
    systemPromptLabel: 'Tech Doc Prompt',
    resetButton: 'Reset to Default',
    promptPlaceholder: 'Enter tech doc generation rules...',
    saveButton: 'Save Settings',
    savedButton: 'Saved Successfully!',
    savedMessage: 'Saved!',
    
    // Home page
    homeDescription: 'Open a ChatGPT or Gemini chat page and click the button below to publish',
    publishToToutiao: 'Toutiao',
    publishToZhihu: 'Zhihu',
    orSeparator: 'or',
    generateArticleOnly: 'Generate Article Only',
    generateSummary: 'Generate Summary',
    generateTechDoc: 'Tech Doc',
    processing: 'Processing...',
    viewLiveResult: 'View Live Result',
    stopGenerating: 'Stop Generating',
    recentDocuments: 'Recent Documents',
    clearAll: 'Clear All',
    noHistoryYet: 'No history yet.',
    result: 'Result',
    showCode: 'Show Code',
    preview: 'Preview',
    close: 'Close',
    copy: 'Copy',
    download: 'MD',
    save: 'Save',
    toutiao: 'Toutiao',
    zhihu: 'Zhihu',
    refinePromptPlaceholder: "Ask AI to refine (e.g. 'Make it shorter')...",
    status: 'Status',
    
    // Messages
    extractingContent: 'Extracting content from page...',
    contentExtracted: 'Content extracted! Starting generation...',
    publishingToToutiao: 'Publishing to Toutiao...',
    publishingToZhihu: 'Publishing to Zhihu...',
    publishSuccess: 'Published successfully!',
    publishFailed: 'Publish Failed',
    connectionFailed: 'Connection failed. The page might need a refresh.',
    refreshPage: 'Refresh Page',
    cookieMissing: 'Cookie is missing. Go to settings?',
    goToSettings: 'Go to Settings',
    copiedToClipboard: 'Copied to clipboard!',
    pushedToGithub: 'Pushed to GitHub!',
    confirmClearHistory: 'Are you sure you want to clear all history?',
    
    // GitHub Modal
    saveToGithub: 'Save to GitHub',
    fileName: 'File Name',
    directory: 'Directory',
    commitMessage: 'Commit Message',
    loadingDirectories: 'Loading directories...',
    pushing: 'Pushing...',
    pushToGithub: 'Push to GitHub',
    successfullyPushed: 'Successfully Pushed!',
    viewOnGithub: 'View on GitHub',
    githubNotConfigured: 'GitHub Integration is not configured. Go to settings?',
    
    // Settings page - additional
    syncBackupTitle: 'Sync & Backup (Encrypted)',
    syncDescription: 'Sign in to sync your settings across devices. All critical data (API Keys) is encrypted client-side before upload.',
    googleLogin: 'Google Login',
    githubLogin: 'GitHub Login',
    loginSuccess: 'Login successful!',
    loginFailed: 'Login failed',
    logout: 'Logout',
    encryptionKeyLabel: 'Encryption Key (Passphrase)',
    encryptionKeyHint: 'This key is used to encrypt your data before sending to cloud. You MUST remember it to restore data on another device.',
    randomGenerate: 'Random Generate',
    syncUp: 'Sync Up',
    restore: 'Restore',
    lastSynced: 'Last Synced',
    
    // Toutiao config
    toutiaoConfigTitle: 'Toutiao Configuration',
    cookieLabel: 'Cookie (Required for Publishing)',
    autoFetch: 'Auto Fetch',
    cookieHint: 'Login to mp.toutiao.com, open DevTools, copy "cookie" from any network request header.',
    autoPublish: 'Auto Publish',
    autoPublishHintToutiao: 'Automatically publish to Toutiao after article generation and navigate to publish page',
    noToutiaoCookie: 'No Toutiao login cookies found. Would you like to open the Toutiao login page?',
    
    // Zhihu config
    zhihuConfigTitle: 'Zhihu Column Configuration',
    autoPublishHintZhihu: 'Automatically publish to Zhihu column after article generation',
    noZhihuCookie: 'No Zhihu login cookies found. Would you like to open the Zhihu login page?',
    
    // Article style
    articleStyleTitle: 'Article Style Settings',
    articleStyleHint: 'Adjust the sliders to control the AI-generated article style',
    styleStance: 'Stance',
    styleStanceLeft: 'Objective',
    styleStanceRight: 'Opinionated',
    styleEmotion: 'Emotion',
    styleEmotionLeft: 'Pessimistic',
    styleEmotionRight: 'Optimistic',
    styleTone: 'Tone',
    styleToneLeft: 'Critical',
    styleToneRight: 'Appreciative',
    stylePoliteness: 'Expression',
    stylePolitenessLeft: 'Direct',
    stylePolitenessRight: 'Polite',
    styleFormality: 'Language',
    styleFormalityLeft: 'Casual',
    styleFormalityRight: 'Formal',
    styleHumor: 'Humor',
    styleHumorLeft: 'Serious',
    styleHumorRight: 'Humorous',
    resetToDefaultStyle: 'Reset to default style',
    
    // Debug mode
    debugModeTitle: 'Debug Mode',
    debugModeHint: 'Automatically upload error logs to server for analysis',
    
    // Misc
    downloadMarkdown: 'Download',
    
    // Custom prompts for platforms
    customPromptLabel: 'Custom Prompt',
    customPromptHint: 'Customize the AI generation prompt for this platform. Leave empty to use default.',
    customPromptPlaceholder: 'Enter custom prompt for article generation...',
    resetToDefault: 'Reset to Default',
    
    // Auto save
    autoSaving: 'Auto saving...',
    autoSaved: 'Auto saved',
    autoSaveHint: 'Settings are saved automatically',
  },
  'zh-CN': {
    // Settings page
    settingsTitle: '设置',
    languageLabel: '语言 (输出语言)',
    languageHint: '切换语言将会更新系统提示词（如果使用的是默认模板）。',
    providerLabel: '模型提供商',
    apiKeyLabel: 'API Key',
    getKey: '获取 Key',
    apiKeyPlaceholder: '请输入您的 API Key',
    baseUrlLabel: 'Base URL',
    modelLabel: '模型',
    manualInput: '手动输入...',
    doubaoHint: '注意：对于豆包 (Doubao)，通常需要使用 Endpoint ID (如 ep-202406...) 作为模型名称。',
    githubTitle: 'GitHub 集成 (保存目标)',
    tokenLabel: 'Personal Access Token (需 Repo 权限)',
    ownerLabel: 'Owner (用户名/组织名)',
    repoLabel: '仓库名 (Repo Name)',
    branchLabel: '分支 (默认: main)',
    verifyButton: '验证',
    verifying: '验证中...',
    verifyTitle: '验证连接',
    fillGithubAlert: '请填写 Token, Owner 和 仓库名',
    systemPromptLabel: '技术文档提示词',
    resetButton: '重置为默认',
    promptPlaceholder: '输入技术文档生成规则...',
    saveButton: '保存设置',
    savedButton: '保存成功!',
    savedMessage: '已保存!',
    
    // Home page
    homeDescription: '打开 ChatGPT 或 Gemini 对话页面，点击下方按钮一键发布',
    publishToToutiao: '发头条',
    publishToZhihu: '发知乎',
    orSeparator: '或',
    generateArticleOnly: '仅生成文章',
    generateSummary: '生成摘要',
    generateTechDoc: '技术文档',
    processing: '处理中...',
    viewLiveResult: '查看实时结果',
    stopGenerating: '停止生成',
    recentDocuments: '最近文档',
    clearAll: '清空',
    noHistoryYet: '暂无历史记录',
    result: '结果',
    showCode: '显示代码',
    preview: '预览',
    close: '关闭',
    copy: '复制',
    download: 'MD',
    save: '保存',
    toutiao: '头条',
    zhihu: '知乎',
    refinePromptPlaceholder: '让 AI 优化文章（如"写短一点"）...',
    status: '状态',
    
    // Messages
    extractingContent: '正在提取页面内容...',
    contentExtracted: '内容提取成功！开始生成...',
    publishingToToutiao: '正在发布到头条...',
    publishingToZhihu: '正在发布到知乎...',
    publishSuccess: '发布成功！',
    publishFailed: '发布失败',
    connectionFailed: '连接失败，请刷新页面后重试。',
    refreshPage: '刷新页面',
    cookieMissing: 'Cookie 未配置，是否前往设置？',
    goToSettings: '前往设置',
    copiedToClipboard: '已复制到剪贴板！',
    pushedToGithub: '已推送到 GitHub！',
    confirmClearHistory: '确定要清空所有历史记录吗？',
    
    // GitHub Modal
    saveToGithub: '保存到 GitHub',
    fileName: '文件名',
    directory: '目录',
    commitMessage: '提交信息',
    loadingDirectories: '加载目录中...',
    pushing: '推送中...',
    pushToGithub: '推送到 GitHub',
    successfullyPushed: '推送成功！',
    viewOnGithub: '在 GitHub 上查看',
    githubNotConfigured: 'GitHub 集成未配置，是否前往设置？',
    
    // Settings page - additional
    syncBackupTitle: '同步与备份（加密）',
    syncDescription: '登录以在多设备间同步设置。所有关键数据（API Key）在上传前会在客户端加密。',
    googleLogin: 'Google 登录',
    githubLogin: 'GitHub 登录',
    loginSuccess: '登录成功！',
    loginFailed: '登录失败',
    logout: '退出登录',
    encryptionKeyLabel: '加密密钥（密码短语）',
    encryptionKeyHint: '此密钥用于在发送到云端前加密您的数据。您必须记住它才能在其他设备上恢复数据。',
    randomGenerate: '随机生成',
    syncUp: '同步上传',
    restore: '恢复',
    lastSynced: '上次同步',
    
    // Toutiao config
    toutiaoConfigTitle: '头条配置',
    cookieLabel: 'Cookie（发布文章需要）',
    autoFetch: '自动获取',
    cookieHint: '登录 mp.toutiao.com，打开开发者工具，从任意请求头中复制 cookie。',
    autoPublish: '自动发布',
    autoPublishHintToutiao: '生成文章后自动发布到头条并跳转到发布页面',
    noToutiaoCookie: '未找到头条登录 Cookie。是否打开头条登录页面？',
    
    // Zhihu config
    zhihuConfigTitle: '知乎专栏配置',
    autoPublishHintZhihu: '生成文章后自动发布到知乎专栏',
    noZhihuCookie: '未找到知乎登录 Cookie。是否打开知乎登录页面？',
    
    // Article style
    articleStyleTitle: '文章风格设置',
    articleStyleHint: '调整滑动条来控制 AI 生成文章的风格倾向',
    styleStance: '立场倾向',
    styleStanceLeft: '客观中立',
    styleStanceRight: '观点鲜明',
    styleEmotion: '情感色彩',
    styleEmotionLeft: '消极悲观',
    styleEmotionRight: '积极乐观',
    styleTone: '评价态度',
    styleToneLeft: '批评质疑',
    styleToneRight: '赞美认可',
    stylePoliteness: '表达方式',
    stylePolitenessLeft: '犀利直接',
    stylePolitenessRight: '委婉礼貌',
    styleFormality: '语言风格',
    styleFormalityLeft: '口语随意',
    styleFormalityRight: '正式书面',
    styleHumor: '趣味程度',
    styleHumorLeft: '严肃认真',
    styleHumorRight: '幽默搞笑',
    resetToDefaultStyle: '重置为默认风格',
    
    // Debug mode
    debugModeTitle: '调试模式',
    debugModeHint: '自动上传错误日志到服务器进行分析',
    
    // Misc
    downloadMarkdown: '下载',
    
    // Custom prompts for platforms
    customPromptLabel: '自定义提示词',
    customPromptHint: '自定义该平台的 AI 生成提示词，留空则使用默认提示词。',
    customPromptPlaceholder: '输入文章生成的自定义提示词...',
    resetToDefault: '恢复默认',
    
    // Auto save
    autoSaving: '自动保存中...',
    autoSaved: '已自动保存',
    autoSaveHint: '设置会自动保存',
  },
  'ja': {
    // Settings page
    settingsTitle: '設定',
    languageLabel: '言語 (出力言語)',
    languageHint: '言語を変更すると、デフォルトのテンプレートを使用している場合、システムプロンプトが更新されます。',
    providerLabel: 'プロバイダー',
    apiKeyLabel: 'APIキー',
    getKey: 'キーを取得',
    apiKeyPlaceholder: 'APIキーを入力してください',
    baseUrlLabel: 'ベースURL',
    modelLabel: 'モデル',
    manualInput: '手動入力...',
    doubaoHint: '注：Doubaoの場合、通常はエンドポイントID（例：ep-202406...）をモデル名として使用する必要があります。',
    githubTitle: 'GitHub連携 (保存先)',
    tokenLabel: 'パーソナルアクセストークン (Repoスコープ)',
    ownerLabel: 'オーナー (ユーザー/組織)',
    repoLabel: 'リポジトリ名',
    branchLabel: 'ブランチ (デフォルト: main)',
    verifyButton: '検証',
    verifying: '検証中...',
    verifyTitle: '接続を検証',
    fillGithubAlert: 'Token、Owner、リポジトリ名を入力してください',
    systemPromptLabel: '技術文書プロンプト',
    resetButton: 'デフォルトにリセット',
    promptPlaceholder: '技術文書生成ルールを入力...',
    saveButton: '設定を保存',
    savedButton: '保存しました！',
    savedMessage: '保存しました！',
    
    // Home page
    homeDescription: 'ChatGPTまたはGeminiのチャットページを開き、下のボタンをクリックして公開',
    publishToToutiao: '頭条',
    publishToZhihu: '知乎',
    orSeparator: 'または',
    generateArticleOnly: '記事のみ生成',
    generateSummary: '要約を生成',
    generateTechDoc: '技術文書',
    processing: '処理中...',
    viewLiveResult: 'リアルタイム結果を表示',
    stopGenerating: '生成を停止',
    recentDocuments: '最近のドキュメント',
    clearAll: 'すべてクリア',
    noHistoryYet: '履歴がありません',
    result: '結果',
    showCode: 'コードを表示',
    preview: 'プレビュー',
    close: '閉じる',
    copy: 'コピー',
    download: 'MD',
    save: '保存',
    toutiao: '頭条',
    zhihu: '知乎',
    refinePromptPlaceholder: 'AIに改善を依頼（例：「短くして」）...',
    status: 'ステータス',
    
    // Messages
    extractingContent: 'ページからコンテンツを抽出中...',
    contentExtracted: 'コンテンツ抽出完了！生成を開始...',
    publishingToToutiao: '頭条に公開中...',
    publishingToZhihu: '知乎に公開中...',
    publishSuccess: '公開成功！',
    publishFailed: '公開失敗',
    connectionFailed: '接続に失敗しました。ページを更新してください。',
    refreshPage: 'ページを更新',
    cookieMissing: 'Cookieが設定されていません。設定に移動しますか？',
    goToSettings: '設定へ',
    copiedToClipboard: 'クリップボードにコピーしました！',
    pushedToGithub: 'GitHubにプッシュしました！',
    confirmClearHistory: 'すべての履歴をクリアしてもよろしいですか？',
    
    // GitHub Modal
    saveToGithub: 'GitHubに保存',
    fileName: 'ファイル名',
    directory: 'ディレクトリ',
    commitMessage: 'コミットメッセージ',
    loadingDirectories: 'ディレクトリを読み込み中...',
    pushing: 'プッシュ中...',
    pushToGithub: 'GitHubにプッシュ',
    successfullyPushed: 'プッシュ成功！',
    viewOnGithub: 'GitHubで表示',
    githubNotConfigured: 'GitHub連携が設定されていません。設定に移動しますか？',
    
    // Settings page - additional
    syncBackupTitle: '同期とバックアップ（暗号化）',
    syncDescription: 'ログインしてデバイス間で設定を同期します。すべての重要なデータ（APIキー）はアップロード前にクライアント側で暗号化されます。',
    googleLogin: 'Googleログイン',
    githubLogin: 'GitHubログイン',
    loginSuccess: 'ログイン成功！',
    loginFailed: 'ログイン失敗',
    logout: 'ログアウト',
    encryptionKeyLabel: '暗号化キー（パスフレーズ）',
    encryptionKeyHint: 'このキーはクラウドに送信する前にデータを暗号化するために使用されます。他のデバイスでデータを復元するには、このキーを覚えておく必要があります。',
    randomGenerate: 'ランダム生成',
    syncUp: '同期アップロード',
    restore: '復元',
    lastSynced: '最終同期',
    
    // Toutiao config
    toutiaoConfigTitle: '頭条設定',
    cookieLabel: 'Cookie（公開に必要）',
    autoFetch: '自動取得',
    cookieHint: 'mp.toutiao.comにログインし、開発者ツールを開き、任意のリクエストヘッダーからcookieをコピーしてください。',
    autoPublish: '自動公開',
    autoPublishHintToutiao: '記事生成後、自動的に頭条に公開し、公開ページに移動します',
    noToutiaoCookie: '頭条のログインCookieが見つかりません。頭条のログインページを開きますか？',
    
    // Zhihu config
    zhihuConfigTitle: '知乎コラム設定',
    autoPublishHintZhihu: '記事生成後、自動的に知乎コラムに公開します',
    noZhihuCookie: '知乎のログインCookieが見つかりません。知乎のログインページを開きますか？',
    
    // Article style
    articleStyleTitle: '記事スタイル設定',
    articleStyleHint: 'スライダーを調整してAI生成記事のスタイルを制御します',
    styleStance: 'スタンス',
    styleStanceLeft: '客観的',
    styleStanceRight: '主観的',
    styleEmotion: '感情',
    styleEmotionLeft: '悲観的',
    styleEmotionRight: '楽観的',
    styleTone: 'トーン',
    styleToneLeft: '批判的',
    styleToneRight: '称賛的',
    stylePoliteness: '表現',
    stylePolitenessLeft: '直接的',
    stylePolitenessRight: '丁寧',
    styleFormality: '言語',
    styleFormalityLeft: 'カジュアル',
    styleFormalityRight: 'フォーマル',
    styleHumor: 'ユーモア',
    styleHumorLeft: '真面目',
    styleHumorRight: 'ユーモラス',
    resetToDefaultStyle: 'デフォルトスタイルにリセット',
    
    // Debug mode
    debugModeTitle: 'デバッグモード',
    debugModeHint: 'エラーログを自動的にサーバーにアップロードして分析します',
    
    // Misc
    downloadMarkdown: 'ダウンロード',
    
    // Custom prompts for platforms
    customPromptLabel: 'カスタムプロンプト',
    customPromptHint: 'このプラットフォーム用のAI生成プロンプトをカスタマイズします。空のままにするとデフォルトが使用されます。',
    customPromptPlaceholder: '記事生成用のカスタムプロンプトを入力...',
    resetToDefault: 'デフォルトに戻す',
    
    // Auto save
    autoSaving: '自動保存中...',
    autoSaved: '自動保存しました',
    autoSaveHint: '設定は自動的に保存されます',
  },
  'ko': {
    // Settings page
    settingsTitle: '설정',
    languageLabel: '언어 (출력 언어)',
    languageHint: '언어를 변경하면 기본 템플릿을 사용하는 경우 시스템 프롬프트가 업데이트됩니다.',
    providerLabel: '제공자',
    apiKeyLabel: 'API 키',
    getKey: '키 발급',
    apiKeyPlaceholder: 'API 키를 입력하세요',
    baseUrlLabel: '기본 URL (Base URL)',
    modelLabel: '모델',
    manualInput: '직접 입력...',
    doubaoHint: '참고: Doubao의 경우 일반적으로 엔드포인트 ID(예: ep-202406...)를 모델 이름으로 사용해야 합니다.',
    githubTitle: 'GitHub 연동 (저장 대상)',
    tokenLabel: '개인 액세스 토큰 (Repo 권한)',
    ownerLabel: '소유자 (사용자/조직)',
    repoLabel: '저장소 이름',
    branchLabel: '브랜치 (기본값: main)',
    verifyButton: '확인',
    verifying: '확인 중...',
    verifyTitle: '연결 확인',
    fillGithubAlert: 'Token, Owner 및 저장소 이름을 입력하십시오',
    systemPromptLabel: '기술 문서 프롬프트',
    resetButton: '기본값으로 재설정',
    promptPlaceholder: '기술 문서 생성 규칙 입력...',
    saveButton: '설정 저장',
    savedButton: '저장되었습니다!',
    savedMessage: '저장됨!',
    
    // Home page
    homeDescription: 'ChatGPT 또는 Gemini 채팅 페이지를 열고 아래 버튼을 클릭하여 게시',
    publishToToutiao: '头条',
    publishToZhihu: '知乎',
    orSeparator: '또는',
    generateArticleOnly: '기사만 생성',
    generateSummary: '요약 생성',
    generateTechDoc: '기술 문서',
    processing: '처리 중...',
    viewLiveResult: '실시간 결과 보기',
    stopGenerating: '생성 중지',
    recentDocuments: '최근 문서',
    clearAll: '모두 지우기',
    noHistoryYet: '기록이 없습니다',
    result: '결과',
    showCode: '코드 보기',
    preview: '미리보기',
    close: '닫기',
    copy: '복사',
    download: 'MD',
    save: '저장',
    toutiao: '头条',
    zhihu: '知乎',
    refinePromptPlaceholder: 'AI에게 개선 요청 (예: "짧게 해줘")...',
    status: '상태',
    
    // Messages
    extractingContent: '페이지에서 콘텐츠 추출 중...',
    contentExtracted: '콘텐츠 추출 완료! 생성 시작...',
    publishingToToutiao: '头条에 게시 중...',
    publishingToZhihu: '知乎에 게시 중...',
    publishSuccess: '게시 성공!',
    publishFailed: '게시 실패',
    connectionFailed: '연결 실패. 페이지를 새로고침하세요.',
    refreshPage: '페이지 새로고침',
    cookieMissing: '쿠키가 설정되지 않았습니다. 설정으로 이동하시겠습니까?',
    goToSettings: '설정으로 이동',
    copiedToClipboard: '클립보드에 복사됨!',
    pushedToGithub: 'GitHub에 푸시됨!',
    confirmClearHistory: '모든 기록을 지우시겠습니까?',
    
    // GitHub Modal
    saveToGithub: 'GitHub에 저장',
    fileName: '파일 이름',
    directory: '디렉토리',
    commitMessage: '커밋 메시지',
    loadingDirectories: '디렉토리 로딩 중...',
    pushing: '푸시 중...',
    pushToGithub: 'GitHub에 푸시',
    successfullyPushed: '푸시 성공!',
    viewOnGithub: 'GitHub에서 보기',
    githubNotConfigured: 'GitHub 연동이 설정되지 않았습니다. 설정으로 이동하시겠습니까?',
    
    // Settings page - additional
    syncBackupTitle: '동기화 및 백업 (암호화)',
    syncDescription: '로그인하여 여러 기기에서 설정을 동기화하세요. 모든 중요 데이터(API 키)는 업로드 전에 클라이언트 측에서 암호화됩니다.',
    googleLogin: 'Google 로그인',
    githubLogin: 'GitHub 로그인',
    loginSuccess: '로그인 성공!',
    loginFailed: '로그인 실패',
    logout: '로그아웃',
    encryptionKeyLabel: '암호화 키 (암호 문구)',
    encryptionKeyHint: '이 키는 클라우드로 전송하기 전에 데이터를 암호화하는 데 사용됩니다. 다른 기기에서 데이터를 복원하려면 이 키를 기억해야 합니다.',
    randomGenerate: '무작위 생성',
    syncUp: '동기화 업로드',
    restore: '복원',
    lastSynced: '마지막 동기화',
    
    // Toutiao config
    toutiaoConfigTitle: '头条 설정',
    cookieLabel: 'Cookie (게시에 필요)',
    autoFetch: '자동 가져오기',
    cookieHint: 'mp.toutiao.com에 로그인하고 개발자 도구를 열어 요청 헤더에서 cookie를 복사하세요.',
    autoPublish: '자동 게시',
    autoPublishHintToutiao: '기사 생성 후 자동으로 头条에 게시하고 게시 페이지로 이동합니다',
    noToutiaoCookie: '头条 로그인 쿠키를 찾을 수 없습니다. 头条 로그인 페이지를 여시겠습니까?',
    
    // Zhihu config
    zhihuConfigTitle: '知乎 칼럼 설정',
    autoPublishHintZhihu: '기사 생성 후 자동으로 知乎 칼럼에 게시합니다',
    noZhihuCookie: '知乎 로그인 쿠키를 찾을 수 없습니다. 知乎 로그인 페이지를 여시겠습니까?',
    
    // Article style
    articleStyleTitle: '기사 스타일 설정',
    articleStyleHint: '슬라이더를 조정하여 AI 생성 기사의 스타일을 제어하세요',
    styleStance: '입장',
    styleStanceLeft: '객관적',
    styleStanceRight: '주관적',
    styleEmotion: '감정',
    styleEmotionLeft: '비관적',
    styleEmotionRight: '낙관적',
    styleTone: '톤',
    styleToneLeft: '비판적',
    styleToneRight: '칭찬적',
    stylePoliteness: '표현',
    stylePolitenessLeft: '직접적',
    stylePolitenessRight: '공손한',
    styleFormality: '언어',
    styleFormalityLeft: '캐주얼',
    styleFormalityRight: '공식적',
    styleHumor: '유머',
    styleHumorLeft: '진지한',
    styleHumorRight: '유머러스',
    resetToDefaultStyle: '기본 스타일로 재설정',
    
    // Debug mode
    debugModeTitle: '디버그 모드',
    debugModeHint: '분석을 위해 오류 로그를 서버에 자동 업로드합니다',
    
    // Misc
    downloadMarkdown: '다운로드',
    
    // Custom prompts for platforms
    customPromptLabel: '사용자 정의 프롬프트',
    customPromptHint: '이 플랫폼의 AI 생성 프롬프트를 사용자 정의합니다. 비워두면 기본값이 사용됩니다.',
    customPromptPlaceholder: '기사 생성을 위한 사용자 정의 프롬프트 입력...',
    resetToDefault: '기본값으로 복원',
    
    // Auto save
    autoSaving: '자동 저장 중...',
    autoSaved: '자동 저장됨',
    autoSaveHint: '설정이 자동으로 저장됩니다',
  },
  'de': {
    // Settings page
    settingsTitle: 'Einstellungen',
    languageLabel: 'Sprache (Ausgabesprache)',
    languageHint: 'Das Ändern der Sprache aktualisiert den System-Prompt, wenn Sie eine Standardvorlage verwenden.',
    providerLabel: 'Anbieter',
    apiKeyLabel: 'API-Schlüssel',
    getKey: 'Schlüssel erhalten',
    apiKeyPlaceholder: 'Geben Sie Ihren API-Schlüssel ein',
    baseUrlLabel: 'Basis-URL',
    modelLabel: 'Modell',
    manualInput: 'Manuelle Eingabe...',
    doubaoHint: 'Hinweis: Für Doubao müssen Sie normalerweise die Endpoint-ID (z. B. ep-202406...) als Modellnamen verwenden.',
    githubTitle: 'GitHub-Integration (Speicherziel)',
    tokenLabel: 'Persönlicher Zugriffstoken (Repo-Bereich)',
    ownerLabel: 'Eigentümer (Benutzer/Org)',
    repoLabel: 'Repo-Name',
    branchLabel: 'Zweig (Standard: main)',
    verifyButton: 'Überprüfen',
    verifying: '...',
    verifyTitle: 'Verbindung überprüfen',
    fillGithubAlert: 'Bitte füllen Sie Token, Eigentümer und Repo-Namen aus',
    systemPromptLabel: 'Tech-Dok Prompt',
    resetButton: 'Auf Standard zurücksetzen',
    promptPlaceholder: 'Tech-Dok Generierungsregeln eingeben...',
    saveButton: 'Einstellungen speichern',
    savedButton: 'Erfolgreich gespeichert!',
    savedMessage: 'Gespeichert!',
    
    // Home page
    homeDescription: 'Öffnen Sie eine ChatGPT- oder Gemini-Chatseite und klicken Sie auf die Schaltfläche unten',
    publishToToutiao: 'Toutiao',
    publishToZhihu: 'Zhihu',
    orSeparator: 'oder',
    generateArticleOnly: 'Nur Artikel generieren',
    generateSummary: 'Zusammenfassung generieren',
    generateTechDoc: 'Tech-Dok',
    processing: 'Verarbeitung...',
    viewLiveResult: 'Live-Ergebnis anzeigen',
    stopGenerating: 'Generierung stoppen',
    recentDocuments: 'Letzte Dokumente',
    clearAll: 'Alle löschen',
    noHistoryYet: 'Noch kein Verlauf',
    result: 'Ergebnis',
    showCode: 'Code anzeigen',
    preview: 'Vorschau',
    close: 'Schließen',
    copy: 'Kopieren',
    download: 'MD',
    save: 'Speichern',
    toutiao: 'Toutiao',
    zhihu: 'Zhihu',
    refinePromptPlaceholder: 'KI um Verbesserung bitten (z.B. "Kürzer machen")...',
    status: 'Status',
    
    // Messages
    extractingContent: 'Inhalt von Seite extrahieren...',
    contentExtracted: 'Inhalt extrahiert! Generierung starten...',
    publishingToToutiao: 'Veröffentlichung auf Toutiao...',
    publishingToZhihu: 'Veröffentlichung auf Zhihu...',
    publishSuccess: 'Erfolgreich veröffentlicht!',
    publishFailed: 'Veröffentlichung fehlgeschlagen',
    connectionFailed: 'Verbindung fehlgeschlagen. Bitte Seite aktualisieren.',
    refreshPage: 'Seite aktualisieren',
    cookieMissing: 'Cookie fehlt. Zu Einstellungen gehen?',
    goToSettings: 'Zu Einstellungen',
    copiedToClipboard: 'In Zwischenablage kopiert!',
    pushedToGithub: 'Zu GitHub gepusht!',
    confirmClearHistory: 'Möchten Sie wirklich den gesamten Verlauf löschen?',
    
    // GitHub Modal
    saveToGithub: 'Auf GitHub speichern',
    fileName: 'Dateiname',
    directory: 'Verzeichnis',
    commitMessage: 'Commit-Nachricht',
    loadingDirectories: 'Verzeichnisse laden...',
    pushing: 'Pushen...',
    pushToGithub: 'Zu GitHub pushen',
    successfullyPushed: 'Erfolgreich gepusht!',
    viewOnGithub: 'Auf GitHub anzeigen',
    githubNotConfigured: 'GitHub-Integration ist nicht konfiguriert. Zu Einstellungen gehen?',
    
    // Settings page - additional
    syncBackupTitle: 'Synchronisierung & Backup (Verschlüsselt)',
    syncDescription: 'Melden Sie sich an, um Ihre Einstellungen geräteübergreifend zu synchronisieren. Alle kritischen Daten (API-Schlüssel) werden vor dem Upload clientseitig verschlüsselt.',
    googleLogin: 'Google-Anmeldung',
    githubLogin: 'GitHub-Anmeldung',
    loginSuccess: 'Anmeldung erfolgreich!',
    loginFailed: 'Anmeldung fehlgeschlagen',
    logout: 'Abmelden',
    encryptionKeyLabel: 'Verschlüsselungsschlüssel (Passphrase)',
    encryptionKeyHint: 'Dieser Schlüssel wird verwendet, um Ihre Daten vor dem Senden in die Cloud zu verschlüsseln. Sie MÜSSEN ihn sich merken, um Daten auf einem anderen Gerät wiederherzustellen.',
    randomGenerate: 'Zufällig generieren',
    syncUp: 'Hochladen',
    restore: 'Wiederherstellen',
    lastSynced: 'Zuletzt synchronisiert',
    
    // Toutiao config
    toutiaoConfigTitle: 'Toutiao-Konfiguration',
    cookieLabel: 'Cookie (Erforderlich zum Veröffentlichen)',
    autoFetch: 'Automatisch abrufen',
    cookieHint: 'Melden Sie sich bei mp.toutiao.com an, öffnen Sie DevTools und kopieren Sie "cookie" aus einem beliebigen Anfrage-Header.',
    autoPublish: 'Automatisch veröffentlichen',
    autoPublishHintToutiao: 'Nach der Artikelgenerierung automatisch auf Toutiao veröffentlichen und zur Veröffentlichungsseite navigieren',
    noToutiaoCookie: 'Keine Toutiao-Login-Cookies gefunden. Möchten Sie die Toutiao-Anmeldeseite öffnen?',
    
    // Zhihu config
    zhihuConfigTitle: 'Zhihu-Spalten-Konfiguration',
    autoPublishHintZhihu: 'Nach der Artikelgenerierung automatisch in der Zhihu-Spalte veröffentlichen',
    noZhihuCookie: 'Keine Zhihu-Login-Cookies gefunden. Möchten Sie die Zhihu-Anmeldeseite öffnen?',
    
    // Article style
    articleStyleTitle: 'Artikelstil-Einstellungen',
    articleStyleHint: 'Passen Sie die Schieberegler an, um den Stil des KI-generierten Artikels zu steuern',
    styleStance: 'Haltung',
    styleStanceLeft: 'Objektiv',
    styleStanceRight: 'Meinungsstark',
    styleEmotion: 'Emotion',
    styleEmotionLeft: 'Pessimistisch',
    styleEmotionRight: 'Optimistisch',
    styleTone: 'Ton',
    styleToneLeft: 'Kritisch',
    styleToneRight: 'Anerkennend',
    stylePoliteness: 'Ausdruck',
    stylePolitenessLeft: 'Direkt',
    stylePolitenessRight: 'Höflich',
    styleFormality: 'Sprache',
    styleFormalityLeft: 'Lässig',
    styleFormalityRight: 'Formell',
    styleHumor: 'Humor',
    styleHumorLeft: 'Ernst',
    styleHumorRight: 'Humorvoll',
    resetToDefaultStyle: 'Auf Standardstil zurücksetzen',
    
    // Debug mode
    debugModeTitle: 'Debug-Modus',
    debugModeHint: 'Fehlerprotokolle automatisch zur Analyse auf den Server hochladen',
    
    // Misc
    downloadMarkdown: 'Herunterladen',
    
    // Custom prompts for platforms
    customPromptLabel: 'Benutzerdefinierter Prompt',
    customPromptHint: 'Passen Sie den KI-Generierungsprompt für diese Plattform an. Leer lassen für Standard.',
    customPromptPlaceholder: 'Benutzerdefinierten Prompt für Artikelgenerierung eingeben...',
    resetToDefault: 'Standard wiederherstellen',
    
    // Auto save
    autoSaving: 'Automatisch speichern...',
    autoSaved: 'Automatisch gespeichert',
    autoSaveHint: 'Einstellungen werden automatisch gespeichert',
  },
  'fr': {
    // Settings page
    settingsTitle: 'Paramètres',
    languageLabel: 'Langue (Langue de sortie)',
    languageHint: 'Changer de langue mettra à jour le prompt système si vous utilisez un modèle par défaut.',
    providerLabel: 'Fournisseur',
    apiKeyLabel: 'Clé API',
    getKey: 'Obtenir une clé',
    apiKeyPlaceholder: 'Entrez votre clé API',
    baseUrlLabel: 'URL de base',
    modelLabel: 'Modèle',
    manualInput: 'Saisie manuelle...',
    doubaoHint: 'Note : Pour Doubao, vous devez généralement utiliser l\'ID de point de terminaison (ex : ep-202406...) comme nom de modèle.',
    githubTitle: 'Intégration GitHub (Cible de sauvegarde)',
    tokenLabel: 'Jeton d\'accès personnel (Portée Repo)',
    ownerLabel: 'Propriétaire (Utilisateur/Org)',
    repoLabel: 'Nom du dépôt',
    branchLabel: 'Branche (Défaut : main)',
    verifyButton: 'Vérifier',
    verifying: '...',
    verifyTitle: 'Vérifier la connexion',
    fillGithubAlert: 'Veuillez remplir le jeton, le propriétaire et le nom du dépôt',
    systemPromptLabel: 'Prompt Doc Tech',
    resetButton: 'Rétablir par défaut',
    promptPlaceholder: 'Entrez les règles de génération de doc tech...',
    saveButton: 'Enregistrer les paramètres',
    savedButton: 'Enregistré avec succès !',
    savedMessage: 'Enregistré !',
    
    // Home page
    homeDescription: 'Ouvrez une page de chat ChatGPT ou Gemini et cliquez sur le bouton ci-dessous',
    publishToToutiao: 'Toutiao',
    publishToZhihu: 'Zhihu',
    orSeparator: 'ou',
    generateArticleOnly: 'Générer article uniquement',
    generateSummary: 'Générer résumé',
    generateTechDoc: 'Doc Tech',
    processing: 'Traitement...',
    viewLiveResult: 'Voir résultat en direct',
    stopGenerating: 'Arrêter la génération',
    recentDocuments: 'Documents récents',
    clearAll: 'Tout effacer',
    noHistoryYet: 'Pas encore d\'historique',
    result: 'Résultat',
    showCode: 'Afficher le code',
    preview: 'Aperçu',
    close: 'Fermer',
    copy: 'Copier',
    download: 'MD',
    save: 'Enregistrer',
    toutiao: 'Toutiao',
    zhihu: 'Zhihu',
    refinePromptPlaceholder: 'Demander à l\'IA d\'améliorer (ex: "Raccourcir")...',
    status: 'Statut',
    
    // Messages
    extractingContent: 'Extraction du contenu de la page...',
    contentExtracted: 'Contenu extrait ! Démarrage de la génération...',
    publishingToToutiao: 'Publication sur Toutiao...',
    publishingToZhihu: 'Publication sur Zhihu...',
    publishSuccess: 'Publié avec succès !',
    publishFailed: 'Échec de la publication',
    connectionFailed: 'Connexion échouée. Veuillez rafraîchir la page.',
    refreshPage: 'Rafraîchir la page',
    cookieMissing: 'Cookie manquant. Aller aux paramètres ?',
    goToSettings: 'Aller aux paramètres',
    copiedToClipboard: 'Copié dans le presse-papiers !',
    pushedToGithub: 'Poussé vers GitHub !',
    confirmClearHistory: 'Êtes-vous sûr de vouloir effacer tout l\'historique ?',
    
    // GitHub Modal
    saveToGithub: 'Enregistrer sur GitHub',
    fileName: 'Nom du fichier',
    directory: 'Répertoire',
    commitMessage: 'Message de commit',
    loadingDirectories: 'Chargement des répertoires...',
    pushing: 'Envoi...',
    pushToGithub: 'Pousser vers GitHub',
    successfullyPushed: 'Poussé avec succès !',
    viewOnGithub: 'Voir sur GitHub',
    githubNotConfigured: 'L\'intégration GitHub n\'est pas configurée. Aller aux paramètres ?',
    
    // Settings page - additional
    syncBackupTitle: 'Synchronisation et sauvegarde (Chiffré)',
    syncDescription: 'Connectez-vous pour synchroniser vos paramètres sur tous vos appareils. Toutes les données critiques (clés API) sont chiffrées côté client avant l\'envoi.',
    googleLogin: 'Connexion Google',
    githubLogin: 'Connexion GitHub',
    loginSuccess: 'Connexion réussie !',
    loginFailed: 'Échec de la connexion',
    logout: 'Déconnexion',
    encryptionKeyLabel: 'Clé de chiffrement (Phrase secrète)',
    encryptionKeyHint: 'Cette clé est utilisée pour chiffrer vos données avant de les envoyer dans le cloud. Vous DEVEZ la mémoriser pour restaurer les données sur un autre appareil.',
    randomGenerate: 'Générer aléatoirement',
    syncUp: 'Synchroniser',
    restore: 'Restaurer',
    lastSynced: 'Dernière synchronisation',
    
    // Toutiao config
    toutiaoConfigTitle: 'Configuration Toutiao',
    cookieLabel: 'Cookie (Requis pour publier)',
    autoFetch: 'Récupération auto',
    cookieHint: 'Connectez-vous à mp.toutiao.com, ouvrez DevTools, copiez "cookie" depuis n\'importe quel en-tête de requête.',
    autoPublish: 'Publication automatique',
    autoPublishHintToutiao: 'Publier automatiquement sur Toutiao après la génération de l\'article et naviguer vers la page de publication',
    noToutiaoCookie: 'Aucun cookie de connexion Toutiao trouvé. Voulez-vous ouvrir la page de connexion Toutiao ?',
    
    // Zhihu config
    zhihuConfigTitle: 'Configuration de la colonne Zhihu',
    autoPublishHintZhihu: 'Publier automatiquement dans la colonne Zhihu après la génération de l\'article',
    noZhihuCookie: 'Aucun cookie de connexion Zhihu trouvé. Voulez-vous ouvrir la page de connexion Zhihu ?',
    
    // Article style
    articleStyleTitle: 'Paramètres de style d\'article',
    articleStyleHint: 'Ajustez les curseurs pour contrôler le style de l\'article généré par l\'IA',
    styleStance: 'Position',
    styleStanceLeft: 'Objectif',
    styleStanceRight: 'Opinionné',
    styleEmotion: 'Émotion',
    styleEmotionLeft: 'Pessimiste',
    styleEmotionRight: 'Optimiste',
    styleTone: 'Ton',
    styleToneLeft: 'Critique',
    styleToneRight: 'Appréciateur',
    stylePoliteness: 'Expression',
    stylePolitenessLeft: 'Direct',
    stylePolitenessRight: 'Poli',
    styleFormality: 'Langage',
    styleFormalityLeft: 'Décontracté',
    styleFormalityRight: 'Formel',
    styleHumor: 'Humour',
    styleHumorLeft: 'Sérieux',
    styleHumorRight: 'Humoristique',
    resetToDefaultStyle: 'Réinitialiser au style par défaut',
    
    // Debug mode
    debugModeTitle: 'Mode débogage',
    debugModeHint: 'Télécharger automatiquement les journaux d\'erreurs sur le serveur pour analyse',
    
    // Misc
    downloadMarkdown: 'Télécharger',
    
    // Custom prompts for platforms
    customPromptLabel: 'Prompt personnalisé',
    customPromptHint: 'Personnalisez le prompt de génération IA pour cette plateforme. Laissez vide pour utiliser le défaut.',
    customPromptPlaceholder: 'Entrez un prompt personnalisé pour la génération d\'articles...',
    resetToDefault: 'Restaurer par défaut',
    
    // Auto save
    autoSaving: 'Sauvegarde automatique...',
    autoSaved: 'Sauvegardé automatiquement',
    autoSaveHint: 'Les paramètres sont sauvegardés automatiquement',
  },
  'es': {
    // Settings page
    settingsTitle: 'Configuración',
    languageLabel: 'Idioma (Idioma de salida)',
    languageHint: 'Cambiar el idioma actualizará el prompt del sistema si está utilizando una plantilla predeterminada.',
    providerLabel: 'Proveedor',
    apiKeyLabel: 'Clave API',
    getKey: 'Obtener clave',
    apiKeyPlaceholder: 'Ingrese su clave API',
    baseUrlLabel: 'URL base',
    modelLabel: 'Modelo',
    manualInput: 'Entrada manual...',
    doubaoHint: 'Nota: Para Doubao, generalmente necesita usar el ID de punto final (por ejemplo, ep-202406...) como nombre del modelo.',
    githubTitle: 'Integración con GitHub (Destino de guardado)',
    tokenLabel: 'Token de acceso personal (Alcance Repo)',
    ownerLabel: 'Propietario (Usuario/Org)',
    repoLabel: 'Nombre del repositorio',
    branchLabel: 'Rama (Predeterminado: main)',
    verifyButton: 'Verificar',
    verifying: '...',
    verifyTitle: 'Verificar conexión',
    fillGithubAlert: 'Por favor complete Token, Propietario y Nombre del repositorio',
    systemPromptLabel: 'Prompt Doc Téc',
    resetButton: 'Restablecer a predeterminado',
    promptPlaceholder: 'Ingrese las reglas de generación de doc téc...',
    saveButton: 'Guardar configuración',
    savedButton: '¡Guardado exitosamente!',
    savedMessage: '¡Guardado!',
    
    // Home page
    homeDescription: 'Abra una página de chat de ChatGPT o Gemini y haga clic en el botón de abajo',
    publishToToutiao: 'Toutiao',
    publishToZhihu: 'Zhihu',
    orSeparator: 'o',
    generateArticleOnly: 'Solo generar artículo',
    generateSummary: 'Generar resumen',
    generateTechDoc: 'Doc Téc',
    processing: 'Procesando...',
    viewLiveResult: 'Ver resultado en vivo',
    stopGenerating: 'Detener generación',
    recentDocuments: 'Documentos recientes',
    clearAll: 'Borrar todo',
    noHistoryYet: 'Sin historial aún',
    result: 'Resultado',
    showCode: 'Mostrar código',
    preview: 'Vista previa',
    close: 'Cerrar',
    copy: 'Copiar',
    download: 'MD',
    save: 'Guardar',
    toutiao: 'Toutiao',
    zhihu: 'Zhihu',
    refinePromptPlaceholder: 'Pedir a la IA que mejore (ej: "Hazlo más corto")...',
    status: 'Estado',
    
    // Messages
    extractingContent: 'Extrayendo contenido de la página...',
    contentExtracted: '¡Contenido extraído! Iniciando generación...',
    publishingToToutiao: 'Publicando en Toutiao...',
    publishingToZhihu: 'Publicando en Zhihu...',
    publishSuccess: '¡Publicado exitosamente!',
    publishFailed: 'Error al publicar',
    connectionFailed: 'Conexión fallida. Por favor actualice la página.',
    refreshPage: 'Actualizar página',
    cookieMissing: 'Falta la cookie. ¿Ir a configuración?',
    goToSettings: 'Ir a configuración',
    copiedToClipboard: '¡Copiado al portapapeles!',
    pushedToGithub: '¡Enviado a GitHub!',
    confirmClearHistory: '¿Está seguro de que desea borrar todo el historial?',
    
    // GitHub Modal
    saveToGithub: 'Guardar en GitHub',
    fileName: 'Nombre del archivo',
    directory: 'Directorio',
    commitMessage: 'Mensaje de commit',
    loadingDirectories: 'Cargando directorios...',
    pushing: 'Enviando...',
    pushToGithub: 'Enviar a GitHub',
    successfullyPushed: '¡Enviado exitosamente!',
    viewOnGithub: 'Ver en GitHub',
    githubNotConfigured: 'La integración de GitHub no está configurada. ¿Ir a configuración?',
    
    // Settings page - additional
    syncBackupTitle: 'Sincronización y copia de seguridad (Cifrado)',
    syncDescription: 'Inicie sesión para sincronizar su configuración entre dispositivos. Todos los datos críticos (claves API) se cifran en el cliente antes de cargarlos.',
    googleLogin: 'Iniciar sesión con Google',
    githubLogin: 'Iniciar sesión con GitHub',
    loginSuccess: '¡Inicio de sesión exitoso!',
    loginFailed: 'Error de inicio de sesión',
    logout: 'Cerrar sesión',
    encryptionKeyLabel: 'Clave de cifrado (Frase de contraseña)',
    encryptionKeyHint: 'Esta clave se usa para cifrar sus datos antes de enviarlos a la nube. DEBE recordarla para restaurar datos en otro dispositivo.',
    randomGenerate: 'Generar aleatoriamente',
    syncUp: 'Sincronizar',
    restore: 'Restaurar',
    lastSynced: 'Última sincronización',
    
    // Toutiao config
    toutiaoConfigTitle: 'Configuración de Toutiao',
    cookieLabel: 'Cookie (Requerido para publicar)',
    autoFetch: 'Obtener automáticamente',
    cookieHint: 'Inicie sesión en mp.toutiao.com, abra DevTools, copie "cookie" de cualquier encabezado de solicitud.',
    autoPublish: 'Publicación automática',
    autoPublishHintToutiao: 'Publicar automáticamente en Toutiao después de generar el artículo y navegar a la página de publicación',
    noToutiaoCookie: 'No se encontraron cookies de inicio de sesión de Toutiao. ¿Desea abrir la página de inicio de sesión de Toutiao?',
    
    // Zhihu config
    zhihuConfigTitle: 'Configuración de columna Zhihu',
    autoPublishHintZhihu: 'Publicar automáticamente en la columna Zhihu después de generar el artículo',
    noZhihuCookie: 'No se encontraron cookies de inicio de sesión de Zhihu. ¿Desea abrir la página de inicio de sesión de Zhihu?',
    
    // Article style
    articleStyleTitle: 'Configuración de estilo de artículo',
    articleStyleHint: 'Ajuste los controles deslizantes para controlar el estilo del artículo generado por IA',
    styleStance: 'Postura',
    styleStanceLeft: 'Objetivo',
    styleStanceRight: 'Con opinión',
    styleEmotion: 'Emoción',
    styleEmotionLeft: 'Pesimista',
    styleEmotionRight: 'Optimista',
    styleTone: 'Tono',
    styleToneLeft: 'Crítico',
    styleToneRight: 'Apreciativo',
    stylePoliteness: 'Expresión',
    stylePolitenessLeft: 'Directo',
    stylePolitenessRight: 'Cortés',
    styleFormality: 'Lenguaje',
    styleFormalityLeft: 'Casual',
    styleFormalityRight: 'Formal',
    styleHumor: 'Humor',
    styleHumorLeft: 'Serio',
    styleHumorRight: 'Humorístico',
    resetToDefaultStyle: 'Restablecer al estilo predeterminado',
    
    // Debug mode
    debugModeTitle: 'Modo de depuración',
    debugModeHint: 'Cargar automáticamente registros de errores al servidor para análisis',
    
    // Misc
    downloadMarkdown: 'Descargar',
    
    // Custom prompts for platforms
    customPromptLabel: 'Prompt personalizado',
    customPromptHint: 'Personalice el prompt de generación de IA para esta plataforma. Deje vacío para usar el predeterminado.',
    customPromptPlaceholder: 'Ingrese un prompt personalizado para la generación de artículos...',
    resetToDefault: 'Restaurar predeterminado',
    
    // Auto save
    autoSaving: 'Guardando automáticamente...',
    autoSaved: 'Guardado automáticamente',
    autoSaveHint: 'La configuración se guarda automáticamente',
  }
};

export const getTranslation = (lang: string): Translation => {
  return TRANSLATIONS[lang] || TRANSLATIONS['zh-CN'];
};
