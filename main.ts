import { App, Editor, MarkdownView, Modal, Notice, Plugin, Setting, PluginSettingTab, TFile, requestUrl, EditorPosition } from 'obsidian';

interface YouTubeTranscriptPluginSettings {
  processingUrl: string;
  httpMethod: 'GET' | 'POST';
  language: string; // 'auto' | 'ru' | 'en' | ...
  includeTitle: boolean;
  githubUrl: string;
  buyMeACoffeeSlug: string;
  authToken: string;
  backgroundMode: boolean; // run without blocking modal
  dailyNoteUrl: string;
  showCreditsInfo: boolean; // показывать информацию о балансе
}

const DEFAULT_SETTINGS: YouTubeTranscriptPluginSettings = {
  processingUrl: 'https://n8n.aaagency.at/webhook/9b601faa-5f51-477a-9d23-e95104ccd35d',
  httpMethod: 'POST',
  language: 'en',
  includeTitle: true,
  githubUrl: 'https://github.com/olegzakhark',
  buyMeACoffeeSlug: 'olegzakhark',
  authToken: '',
  backgroundMode: true,
  dailyNoteUrl: '',
  showCreditsInfo: true,
};

const DAILY_NOTE_TRANSCRIPT_MARKER = '<!-- YOUTUBE_TRANSCRIPT_PROCESSED -->';

export default class YouTubeTranscriptPlugin extends Plugin {
  settings: YouTubeTranscriptPluginSettings;
  private statusEl: HTMLElement | null = null;
  private countdownInterval: NodeJS.Timeout | null = null;
  private countdownSeconds: number = 0;

  async onload() {
    await this.loadSettings();

    // Ribbon icon
    this.addRibbonIcon('youtube', 'Process YouTube video', () => {
      this.processCurrentNote();
    });

    // Commands
    this.addCommand({
      id: 'process-youtube-link',
      name: 'Process YouTube link in current note',
      editorCallback: () => {
        this.processCurrentNote();
      },
    });

    this.addCommand({
        id: 'process-youtube-selection',
        name: 'Process selected YouTube link and replace',
        editorCallback: (editor: Editor, view: MarkdownView) => {
            const selection = editor.getSelection();
            const youtubeUrl = this.extractYouTubeUrl(selection);

            if (youtubeUrl) {
                const selectionRange = editor.listSelections()[0];
                const from = selectionRange.anchor < selectionRange.head ? selectionRange.anchor : selectionRange.head;
                const to = selectionRange.anchor < selectionRange.head ? selectionRange.head : selectionRange.anchor;

                // Create inline loading animation
                const loadingElement = this.createInlineLoadingAnimation();
                const loadingId = this.insertInlineLoadingForSelection(editor, from, to, loadingElement);

                // Запускаем таймер обратного отсчета
                this.startCountdownTimer();

                this.fetchTranscript(youtubeUrl)
                    .then(result => {
                        this.removeInlineLoading(editor);
                        this.stopCountdownTimer();
                        if (result) {
                            const contentToInsert = this.settings.includeTitle ? `## ${result.title}\n\n${result.content}` : result.content;
                            editor.replaceRange(contentToInsert, from, to);
                            // Успешное завершение - не показываем сообщение
                            this.clearStatus();
                        } else {
                            editor.replaceRange("Error fetching transcript.", from, to);
                            // Обычная ошибка - не показываем в статусе
                            this.clearStatus();
                        }
                    })
                    .catch(error => {
                        this.removeInlineLoading(editor);
                        this.stopCountdownTimer();
                        console.error("Error fetching transcript:", error);
                        editor.replaceRange(`Error: ${error.message}`, from, to);
                        
                        // Показываем в статусе только важные ошибки (токен, оплата)
                        if (this.shouldShowErrorInStatus(error.message)) {
                            this.showStatus('❌ Error');
                            setTimeout(() => this.clearStatus(), 5000);
                        } else {
                            // Для обычных ошибок просто очищаем статус
                            this.clearStatus();
                        }
                    });
            } else {
                new Notice('No YouTube URL selected.');
            }
        },
    });

    this.addCommand({
      id: 'process-youtube-clipboard',
      name: 'Process YouTube link from clipboard',
      callback: () => {
        this.processFromClipboard();
      },
    });

    this.addCommand({
      id: 'process-youtube-prompt',
      name: 'Enter YouTube URL manually',
      callback: () => {
        new YouTubeURLModal(this.app, (url) => {
          this.processYouTubeUrl(url);
        }).open();
      },
    });

    this.addSettingTab(new YouTubeTranscriptSettingsTab(this.app, this));

    this.setupDailyNoteTrigger();
  }

  private setupDailyNoteTrigger() {
      this.registerInterval(window.setInterval(async () => {
          if (this.settings.dailyNoteUrl) {
              await this.processDailyNote();
          }
      }, 1000 * 60 * 60)); // every hour
  }

  private async processDailyNote() {
    const dailyNotePath = this.getDailyNotePath();
    const file = this.app.vault.getAbstractFileByPath(dailyNotePath);

    if (file instanceof TFile) {
        const content = await this.app.vault.read(file);
        if (!content.includes(DAILY_NOTE_TRANSCRIPT_MARKER)) {
            const result = await this.fetchTranscript(this.settings.dailyNoteUrl);
            if (result) {
                const contentToInsert = this.settings.includeTitle ? `\n\n## ${result.title}\n\n${result.content}\n\n${DAILY_NOTE_TRANSCRIPT_MARKER}` : `\n\n${result.content}\n\n${DAILY_NOTE_TRANSCRIPT_MARKER}`;
                await this.appendToNote(file, contentToInsert);
                new Notice('Transcript added to daily note.');
            }
        }
    }
  }

  private getDailyNotePath(): string {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      // This is a simplification. A robust implementation would check the daily-notes plugin settings.
      return `${year}-${month}-${day}.md`;
  }

  private parseResponse(response: any): any {
    // Check if response is valid JSON
    if (response.text && response.text.trim().startsWith('{')) {
        try {
            return JSON.parse(response.text);
        } catch (parseError) {
            console.error('JSON parse error:', parseError);
            throw new Error(`Invalid JSON response: ${response.text.substring(0, 100)}...`);
        }
    } else {
        // Если ответ не JSON, это может быть HTML с ошибкой
        const responseText = response.text || '';
        if (responseText.includes('<html') || responseText.includes('<!DOCTYPE')) {
            // Это HTML-страница с ошибкой
            const errorMatch = responseText.match(/<title[^>]*>([^<]+)<\/title>/i) || 
                             responseText.match(/<h1[^>]*>([^<]+)<\/h1>/i) ||
                             responseText.match(/<body[^>]*>([^<]+)<\/body>/i);
            const errorTitle = errorMatch ? errorMatch[1].trim() : 'HTML Error Page';
            throw new Error(`Server returned HTML error page: ${errorTitle}`);
        } else {
            throw new Error(`Server returned non-JSON response: ${responseText.substring(0, 100)}...`);
        }
    }
  }

  private async fetchTranscript(url: string): Promise<{ title: string; content: string } | null> {
    const endpoint = this.settings.processingUrl;
    const method = this.settings.httpMethod;

    // Валидация токена
    if (!this.settings.authToken || this.settings.authToken.trim() === '') {
        throw new Error('Authentication token is required. Please set your token in plugin settings.');
    }

    if (this.settings.authToken.length < 16) {
        throw new Error('Invalid token format. Please check your token in plugin settings.');
    }

    try {
        let data: any = {};
        // Language mapping
        const languageNames: { [key: string]: string } = {
            'en': 'English',
            'es': 'Spanish',
            'de': 'German',
            'fr': 'French',
            'it': 'Italian',
            'pt': 'Portuguese',
            'uk': 'Ukrainian',
            'tr': 'Turkish',
            'zh': 'Chinese',
            'ja': 'Japanese',
            'ko': 'Korean',
        };

        const requestData = {
            video_url: url,
            source: 'obsidian-plugin',
            timestamp: Date.now(),
            language: languageNames[this.settings.language] || this.settings.language,
            include_title: this.settings.includeTitle,
            token: this.settings.authToken,
            user_agent: navigator.userAgent,
            plugin_version: '1.0.0',
            request_id: `obs_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            credits_check: true, // запрос на проверку баланса
        };

        console.log('Sending request to n8n:', { url, method, endpoint });

        if (method === 'POST') {
            const response = await requestUrl({
                url: endpoint,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestData),
            });
            
            console.log('n8n response:', { status: response.status, text: response.text?.substring(0, 200) });
            
            if (response.status !== 200) {
                throw new Error(`Backend error: ${response.status} - ${response.text || 'Unknown error'}`);
            }
            
            data = this.parseResponse(response);
        } else { // GET
            const qs = new URLSearchParams(requestData as any);
            const response = await requestUrl({
                url: `${endpoint}?${qs.toString()}`,
                method: 'GET',
            });
            
            console.log('n8n response:', { status: response.status, text: response.text?.substring(0, 200) });
            
            if (response.status !== 200) {
                throw new Error(`Backend error: ${response.status} - ${response.text || 'Unknown error'}`);
            }
            
            data = this.parseResponse(response);
        }

        // Обработка информации о пользователе и балансе
        if (data.user_info) {
            console.log('User info:', {
                credits_remaining: data.user_info.credits_remaining,
                plan_type: data.user_info.plan_type,
                request_cost: data.user_info.request_cost
            });
            
            // Показываем информацию о балансе пользователю (если включено в настройках)
            if (this.settings.showCreditsInfo && data.user_info.credits_remaining !== undefined) {
                this.showStatus(`💰 Credits: ${data.user_info.credits_remaining}`);
                setTimeout(() => this.clearStatus(), 3000);
            }
            
            // Предупреждение о низком балансе (всегда показываем в статус-баре)
            if (data.user_info.credits_remaining < 5) {
                this.showStatus('⚠️ Low credits! Top up account');
                setTimeout(() => this.clearStatus(), 8000);
                // Также показываем Notice для важности
                new Notice('⚠️ Low credits! Consider topping up your account.', 8000);
            }
        }

        // Проверка на ошибки авторизации или баланса
        if (data.error) {
            throw new Error(data.error);
        }

        // Проверяем различные форматы ответа
        const processedTitle: string = data.title || data.processedTitle || data.videoTitle || 'Untitled';
        const processedContent: string = data.content || data.processedContent || data.transcript || data.finalContent || '';

        console.log('Processed data:', { title: processedTitle, contentLength: processedContent.length });

        if (!processedContent) {
            console.error('Empty content received from n8n:', data);
            // Always return content, even if empty, to avoid "Processing failed"
            return { 
                title: processedTitle, 
                content: `⚠️ Content unavailable. Check n8n workflow.

**Response from n8n:**
${JSON.stringify(data, null, 2).substring(0, 500)}...` 
            };
        }
        
        return { title: processedTitle, content: processedContent };

    } catch (error) {
        console.error('YouTube transcript error:', {
            error: error?.message || 'Unknown error occurred',
            url: url,
            timestamp: new Date().toISOString(),
        });
        
        // Format error message for user
        let userMessage = error?.message || 'Unknown error occurred';
        
        // Improve error messages
        if (userMessage.includes('Authentication token is required')) {
            userMessage = '🔐 Please set your authentication token in plugin settings to use this service.';
        } else if (userMessage.includes('Invalid token format')) {
            userMessage = '🔑 Invalid token format. Please check your token in settings.';
        } else if (userMessage.includes('insufficient credits') || userMessage.includes('Insufficient credits')) {
            userMessage = '💳 Insufficient credits. Please top up your account to continue.';
        } else if (userMessage.includes('invalid token') || userMessage.includes('Invalid token')) {
            userMessage = '🚫 Invalid or expired token. Please update your token in settings.';
        } else if (userMessage.includes('Server returned HTML error page')) {
            userMessage = 'Server returned HTML error page. n8n workflow might be unavailable or overloaded.';
        } else if (userMessage.includes('Server returned non-JSON response')) {
            userMessage = 'Server returned error instead of data. n8n workflow might be unavailable or overloaded.';
        } else if (userMessage.includes('Invalid JSON response')) {
            userMessage = 'Server returned invalid data. Please try again later.';
        } else if (userMessage.includes('Backend error: 500')) {
            userMessage = 'Server error (500). n8n workflow might not be working correctly.';
        } else if (userMessage.includes('Backend error: 404')) {
            userMessage = 'Service unavailable (404). Check n8n webhook settings.';
        } else if (userMessage.includes('Backend error: 403')) {
            userMessage = 'Access denied (403). Check authorization token.';
        } else if (userMessage.includes('Backend error: 401')) {
            userMessage = '🔐 Unauthorized (401). Check your authentication token.';
        } else if (userMessage.includes('Backend error: 402')) {
            userMessage = '💳 Payment required (402). Please top up your account.';
        }
        
        // Return informative error instead of null
        return { 
            title: 'Processing Error', 
            content: `❌ Error processing video: ${userMessage}

**Technical information:**
- URL: ${url}
- Time: ${new Date().toLocaleString('en-US')}
- Error: ${error?.message || 'Unknown error'}` 
        };
    }
  }


  private async processCurrentNote() {
    try {
      const activeFile = this.app.workspace.getActiveFile();
      if (!activeFile) {
        new Notice('No active note');
        return;
      }
      await this.checkAndProcessNote(activeFile);
    } catch (error) {
      console.error('Error processing current note:', error);
      new Notice(`Error: ${error.message || 'Unknown error occurred'}`);
    }
  }

  private async processFromClipboard() {
    try {
      const clipboard = await navigator.clipboard.readText();
      const youtubeUrl = this.extractYouTubeUrl(clipboard);
      if (youtubeUrl) {
        if (!this.isValidYouTubeUrl(youtubeUrl)) {
          new Notice('Invalid YouTube URL format');
          return;
        }
        this.processYouTubeUrl(youtubeUrl);
      } else {
        new Notice('No YouTube URL found in clipboard');
      }
    } catch (error) {
      console.error('Error processing clipboard:', error);
      new Notice(`Error reading clipboard: ${error.message || 'Unknown error'}`);
    }
  }

  private async checkAndProcessNote(file: TFile) {
    try {
      const content = await this.app.vault.read(file);
      const youtubeUrl = this.extractYouTubeUrl(content);
      if (youtubeUrl) {
        if (!this.isValidYouTubeUrl(youtubeUrl)) {
          new Notice('Invalid YouTube URL format in note');
          return;
        }
        // Автоматическая обработка без подтверждения
        await this.processYouTubeUrl(youtubeUrl, file);
      }
    } catch (error) {
      console.error('Error checking and processing note:', error);
      new Notice(`Error processing note: ${error.message || 'Unknown error'}`);
    }
  }

  private isValidYouTubeUrl(url: string): boolean {
    // Input length validation to prevent ReDoS attacks
    if (!url || url.length > 2048) {
      return false;
    }
    
    // More restrictive regex with consistent pattern matching
    const regex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|live\/|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})(\?.*)?$/;
    return regex.test(url.trim());
  }

  private extractYouTubeUrl(text: string): string | null {
    // Input validation to prevent ReDoS attacks
    if (!text || text.length > 10000) {
      return null;
    }
    
    // Consistent regex pattern with the validation function
    const youtubeRegex = /(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|live\/|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})(\?[^\s\n]*)?/g;
    const match = youtubeRegex.exec(text.trim());
    
    if (match) {
      const fullMatch = match[0];
      // Security: Validate the extracted URL before protocol normalization
      if (!fullMatch.startsWith('http') && !fullMatch.startsWith('www') && !fullMatch.startsWith('youtube') && !fullMatch.startsWith('youtu.be')) {
        return null;
      }
      
      // Ensure we return a full URL with HTTPS protocol
      return fullMatch.startsWith('http') ? fullMatch : `https://${fullMatch}`;
    }
    
    return null;
  }

  private async confirmProcessing(fileName: string, url: string): Promise<boolean> {
    return new Promise((resolve) => {
      new ProcessingConfirmModal(this.app, fileName, url, resolve).open();
    });
  }

  private async processYouTubeUrl(url: string, targetFile?: TFile) {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) return;

    const editor = activeView.editor;
    const cursor = editor.getCursor();
    
    // Сохраняем позицию курсора для вставки контента
    const startPos = { line: cursor.line, ch: cursor.ch };
    
    // Создаем inline анимацию загрузки
    const loadingElement = this.createInlineLoadingAnimation();
    const loadingText = this.insertInlineLoading(editor, startPos, loadingElement);

    try {
        console.log('=== START PROCESSING YouTube URL ===');
        console.log('URL:', url);
        console.log('Method:', this.settings.httpMethod);
        console.log('Endpoint:', this.settings.processingUrl);
        
        // Запускаем таймер обратного отсчета
        this.startCountdownTimer();
        
        const result = await this.fetchTranscript(url);
        
        console.log('=== N8N RESPONSE ===');
        console.log('Received result:', result);
        console.log('Title:', result?.title);
        console.log('Content length:', result?.content?.length);
        
        // Удаляем анимацию загрузки в любом случае
        this.removeInlineLoading(editor);
        
        if (result.title === 'Processing Error') {
            console.error('ERROR FROM N8N:', result.content);
            this.showInlineError(editor, startPos, `Processing error: ${result.content}`);
            this.stopCountdownTimer();
            this.showStatus('❌ Error from n8n');
            return;
        }
        
        // Вставляем обработанный контент в позицию курсора
        const contentToInsert = this.settings.includeTitle 
            ? `## ${result.title}\n\n${result.content}` 
            : result.content;
        
        editor.replaceRange(contentToInsert, startPos);
        
        // Успешное завершение - просто останавливаем таймер, не показываем сообщение
        this.stopCountdownTimer();
        this.clearStatus();
        
    } catch (error: any) {
      console.error('=== CRITICAL ERROR ===');
      console.error('Error:', error);
      console.error('Stack:', error.stack);
      
      // Удаляем анимацию загрузки при ошибке
      this.removeInlineLoading(editor);
      this.stopCountdownTimer();
      
      const errorMessage = error?.message || 'Unknown error occurred';
      this.showInlineError(editor, startPos, `Error: ${errorMessage}`);
      
      // Показываем в статусе только важные ошибки (токен, оплата)
      if (this.shouldShowErrorInStatus(errorMessage)) {
        this.showStatus('❌ Error');
        setTimeout(() => this.clearStatus(), 5000);
      } else {
        // Для обычных ошибок просто очищаем статус
        this.clearStatus();
      }
    }
  }

  private createInlineLoadingAnimation(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'youtube-inline-loading';
    container.innerHTML = `
      <div class="youtube-inline-spinner">
        <div class="spinner-ring"></div>
        <div class="spinner-ring"></div>
        <div class="spinner-ring"></div>
      </div>
      <div class="youtube-inline-text">
        <div class="youtube-inline-title">Processing YouTube video</div>
        <div class="youtube-inline-subtitle">Getting transcript...</div>
        <div class="youtube-inline-dots">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </div>
      </div>
    `;
    return container;
  }

  private insertInlineLoading(editor: Editor, startPos: EditorPosition, loadingElement: HTMLElement): string {
    const loadingId = `youtube-loading-${Date.now()}`;
    const loadingText = `\n\n<!-- ${loadingId} -->
⏳ Processing YouTube video...
\n\n`;
    
    // Вставляем текст загрузки в редактор
    editor.replaceRange(loadingText, startPos);
    
    // Добавляем элемент анимации в DOM после небольшой задержки для рендеринга
    setTimeout(() => {
      const editorEl = document.querySelector('.cm-editor');
      if (editorEl) {
        const tempContainer = document.createElement('div');
        tempContainer.setAttribute('data-loading-id', loadingId);
        tempContainer.style.position = 'relative';
        tempContainer.appendChild(loadingElement);
        editorEl.appendChild(tempContainer);
      }
    }, 50);
    
    return loadingId;
  }

  private insertInlineLoadingForSelection(editor: Editor, from: EditorPosition, to: EditorPosition, loadingElement: HTMLElement): string {
    const loadingId = `youtube-loading-${Date.now()}`;
    const loadingText = `⏳ Processing YouTube video...`;

    // Вставляем текст загрузки в редактор, заменяя выделение
    editor.replaceRange(loadingText, from, to);

    // Добавляем элемент анимации в DOM после небольшой задержки
    setTimeout(() => {
      const editorEl = document.querySelector('.cm-editor');
      if (editorEl) {
        const tempContainer = document.createElement('div');
        tempContainer.setAttribute('data-loading-id', loadingId);
        tempContainer.style.position = 'relative';
        tempContainer.appendChild(loadingElement);
        editorEl.appendChild(tempContainer);
      }
    }, 50);

    return loadingId;
  }

  private showInlineError(editor: Editor, startPos: EditorPosition, errorMessage: string) {
    // Удаляем анимацию загрузки
    this.removeInlineLoading(editor);
    
    // Вставляем сообщение об ошибке
    const errorText = `\n\n> ❌ **Error**\n> ${errorMessage}\n\n`;
    editor.replaceRange(errorText, startPos);
  }

  private removeInlineLoading(editor: Editor) {
    // Удаляем все элементы загрузки из редактора
    const editorEl = document.querySelector('.cm-editor');
    if (!editorEl) return;
    
    const loadingElements = editorEl.querySelectorAll('.youtube-inline-loading');
    loadingElements.forEach((el: Element) => {
      if (el.parentElement) {
        el.parentElement.removeChild(el);
      }
    });
    
    // Удаляем временные контейнеры
    const tempContainers = editorEl.querySelectorAll('[data-loading-id]');
    tempContainers.forEach((el: Element) => {
      if (el.parentElement) {
        el.parentElement.removeChild(el);
      }
    });
    
    // Также удаляем HTML комментарии загрузки из текста
    const currentContent = editor.getValue();
    const cleanedContent = currentContent.replace(/<!-- youtube-loading-\d+ -->\n?/g, '');
    if (currentContent !== cleanedContent) {
      editor.setValue(cleanedContent);
    }
  }

  private startCountdownTimer() {
    this.stopCountdownTimer(); // Останавливаем предыдущий таймер если есть
    this.countdownSeconds = 30;
    
    // Показываем начальное сообщение
    this.showStatus(`⏳ Processing... ${this.countdownSeconds}s`);
    
    this.countdownInterval = setInterval(() => {
      this.countdownSeconds--;
      
      if (this.countdownSeconds <= 0) {
        this.showStatus('⏳ Still processing...');
        this.stopCountdownTimer();
      } else {
        this.showStatus(`⏳ Processing... ${this.countdownSeconds}s`);
      }
    }, 1000);
  }

  private stopCountdownTimer() {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    this.countdownSeconds = 0;
  }

  private shouldShowErrorInStatus(errorMessage: string): boolean {
    const importantErrors = [
      'Authentication token is required',
      'Invalid token format',
      'insufficient credits',
      'Insufficient credits',
      'invalid token',
      'Invalid token',
      'Payment required',
      'Backend error: 401',
      'Backend error: 402',
      'Backend error: 403'
    ];
    
    return importantErrors.some(err => errorMessage.includes(err));
  }

  private showStatus(text: string) {
    if (!this.statusEl) {
      this.statusEl = this.addStatusBarItem();
      this.statusEl.style.cursor = 'pointer';
      this.statusEl.style.padding = '0 8px';
      this.statusEl.addClass('youtube-status-bar');
    }
    
    // Добавляем плавный переход
    this.statusEl.style.transition = 'all 0.3s ease';
    
    // Определяем тип статуса и применяем соответствующие стили
    if (text.includes('⏳') || text.includes('🔄')) {
      this.statusEl.addClass('youtube-loading');
      this.statusEl.style.color = 'var(--interactive-accent)';
      this.statusEl.style.fontWeight = '600';
    } else if (text.includes('✅')) {
      this.statusEl.removeClass('youtube-loading');
      this.statusEl.style.color = '#27ae60';
      this.statusEl.style.fontWeight = '600';
      // Добавляем анимацию успеха
      this.statusEl.style.animation = 'success-pulse 0.6s ease-in-out';
    } else if (text.includes('❌')) {
      this.statusEl.removeClass('youtube-loading');
      this.statusEl.style.color = '#e74c3c';
      this.statusEl.style.fontWeight = '600';
      // Добавляем анимацию ошибки
      this.statusEl.style.animation = 'error-shake 0.6s ease-in-out';
    } else {
      this.statusEl.removeClass('youtube-loading');
      this.statusEl.style.color = '';
      this.statusEl.style.fontWeight = '';
      this.statusEl.style.animation = '';
    }
    
    this.statusEl.setText(text);
  }

  private showLoadingAnimation() {
    if (!this.statusEl) {
      this.statusEl = this.addStatusBarItem();
      this.statusEl.style.cursor = 'pointer';
      this.statusEl.style.padding = '0 8px';
    }
    this.statusEl.addClass('youtube-loading');
    this.statusEl.style.animation = 'pulse 1.5s infinite';
  }

  private updateLoadingStatus(text: string) {
    if (this.statusEl) {
      this.statusEl.setText(text);
    }
  }

  private clearLoadingAnimation() {
    if (this.statusEl) {
      this.statusEl.removeClass('youtube-loading');
      this.statusEl.style.animation = '';
    }
  }

  private showSuccessStatus() {
    this.showStatus('✅ Done');
    setTimeout(() => this.clearStatus(), 3000);
  }

  private showErrorStatus(message: string) {
    this.showStatus('❌ Error');
    setTimeout(() => {
      this.clearStatus();
      this.showStatus('🎬 YouTube');
    }, 5000);
  }

  private clearStatus(delayMs = 0) {
    if (!this.statusEl) return;
    
    const clearStyles = () => {
      try { 
        this.statusEl!.setText('🎬 YouTube'); 
        this.statusEl!.removeClass('youtube-loading');
        this.statusEl!.style.animation = '';
        this.statusEl!.style.color = '';
        this.statusEl!.style.fontWeight = '';
        this.statusEl!.style.transition = '';
      } catch (error) {
        console.error('Error clearing status:', error);
      }
    };
    
    if (delayMs > 0) {
      setTimeout(clearStyles, delayMs);
    } else {
      clearStyles();
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private async appendToNote(file: TFile, content: string) {
    const currentContent = await this.app.vault.read(file);
    const newContent = currentContent + '\n\n' + content;
    await this.app.vault.modify(file, newContent);
  }

  private async createNewNote(path: string, content: string) {
    const folderPath = 'YouTube Notes';

    if (!await this.app.vault.adapter.exists(folderPath)) {
      await this.app.vault.createFolder(folderPath);
    }

    const fullPath = `${folderPath}/${path}`;
    await this.app.vault.create(fullPath, content);

    const newFile = this.app.vault.getAbstractFileByPath(fullPath);
    if (newFile instanceof TFile) {
      await this.app.workspace.getLeaf().openFile(newFile);
    }
  }
}

class YouTubeTranscriptSettingsTab extends PluginSettingTab {
  plugin: YouTubeTranscriptPlugin;

  constructor(app: App, plugin: YouTubeTranscriptPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'YouTube Transcript Processor — Settings' });

    new Setting(containerEl)
      .setName('Processing URL')
      .setDesc('n8n webhook address (/webhook/... or /webhook-test/...)')
      .addText(text => text
        .setPlaceholder('https://your-n8n/webhook/xxxxx')
        .setValue(this.plugin.settings.processingUrl)
        .onChange(async (value) => {
          this.plugin.settings.processingUrl = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('HTTP Method')
      .setDesc('POST for production /webhook, GET for /webhook-test (test only)')
      .addDropdown(drop => drop
        .addOptions({ POST: 'POST', GET: 'GET' })
        .setValue(this.plugin.settings.httpMethod)
        .onChange(async (value: 'GET' | 'POST') => {
          this.plugin.settings.httpMethod = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Output language')
      .setDesc('Select the language for processed content')
      .addDropdown(drop => drop
        .addOptions({
          en: 'English',
          es: 'Spanish',
          de: 'German',
          fr: 'French',
          it: 'Italian',
          pt: 'Portuguese',
          uk: 'Ukrainian',
          tr: 'Turkish',
          zh: 'Chinese',
          ja: 'Japanese',
          ko: 'Korean',
        })
        .setValue(this.plugin.settings.language || 'en')
        .onChange(async (value) => {
          this.plugin.settings.language = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Include title')
      .setDesc('Send title along with content')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.includeTitle)
        .onChange(async (value) => {
          this.plugin.settings.includeTitle = value;
          await this.plugin.saveSettings();
        }));

    containerEl.createEl('hr');

    containerEl.createEl('h3', { text: 'Daily Note Settings' });

    new Setting(containerEl)
        .setName('Daily Note YouTube URL')
        .setDesc('Enter a YouTube URL to automatically add its transcript to your daily note.')
        .addText(text => text
            .setPlaceholder('https://www.youtube.com/watch?v=...')
            .setValue(this.plugin.settings.dailyNoteUrl)
            .onChange(async (value) => {
                this.plugin.settings.dailyNoteUrl = value.trim();
                await this.plugin.saveSettings();
            }));

    containerEl.createEl('hr');

    new Setting(containerEl)
      .setName('GitHub')
      .setDesc('Repository/profile link')
      .addText(text => text
        .setPlaceholder('https://github.com/olegzakhark')
        .setValue(this.plugin.settings.githubUrl)
        .onChange(async (value) => {
          this.plugin.settings.githubUrl = value.trim();
          await this.plugin.saveSettings();
        }))
      .addButton(btn => btn
        .setButtonText('Open')
        .onClick(() => {
          window.open(this.plugin.settings.githubUrl, '_blank');
        }));

    new Setting(containerEl)
      .setName('Buy Me a Coffee')
      .setDesc('Support the author')
      .addText(text => text
        .setPlaceholder('olegzakhark')
        .setValue(this.plugin.settings.buyMeACoffeeSlug)
        .onChange(async (value) => {
          this.plugin.settings.buyMeACoffeeSlug = value.trim();
          await this.plugin.saveSettings();
        }))
      .addButton(btn => btn
        .setButtonText('Buy me a coffee ☕')
        .onClick(() => {
          const slug = this.plugin.settings.buyMeACoffeeSlug || 'olegzakhark';
          window.open(`https://www.buymeacoffee.com/${slug}`, '_blank');
        }));

    new Setting(containerEl)
      .setName('Auth Token')
      .setDesc('Token to send with every webhook call')
      .addText(text => text
        .setPlaceholder('secret-token')
        .setValue(this.plugin.settings.authToken)
        .onChange(async (value) => {
          this.plugin.settings.authToken = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Background mode')
      .setDesc('Run without blocking modal, show status in the status bar')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.backgroundMode)
        .onChange(async (value) => {
          this.plugin.settings.backgroundMode = value;
          await this.plugin.saveSettings();
        }));

    // Embedding external <script> into settings is not supported for security reasons.
  }
}

class YouTubeURLModal extends Modal {
  private url = '';
  private onSubmit: (url: string) => void;

  constructor(app: App, onSubmit: (url: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Enter YouTube URL' });

    new Setting(contentEl)
      .setName('YouTube URL')
      .setDesc('Paste the YouTube video URL here')
      .addText(text => text
        .setPlaceholder('https://youtube.com/watch?v=...')
        .onChange(value => this.url = value));

    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Send to webhook')
        .setCta()
        .onClick(() => {
          this.close();
          this.onSubmit(this.url);
        }));
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

class ProcessingModal extends Modal {
  constructor(app: App) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Sending to webhook...' });
    contentEl.createEl('p', { text: 'Please wait while we send the URL to your n8n workflow.' });

    const spinner = contentEl.createDiv();
    spinner.style.textAlign = 'center';
    spinner.style.margin = '20px 0';
    spinner.innerHTML = `
      <div style="display: inline-block; width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; animation: spin 1s linear infinite;">
      </div>
      <style>
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      </style>
    `;
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

class ProcessingConfirmModal extends Modal {
  private fileName: string;
  private url: string;
  private onConfirm: (confirmed: boolean) => void;

  constructor(app: App, fileName: string, url: string, onConfirm: (confirmed: boolean) => void) {
    super(app);
    this.fileName = fileName;
    this.url = url;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Send to webhook?' });
    contentEl.createEl('p', { text: `Found YouTube URL in: ${this.fileName}` });
    contentEl.createEl('p', { text: `URL: ${this.url}` });

    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Cancel')
        .onClick(() => {
          this.close();
          this.onConfirm(false);
        }))
      .addButton(btn => btn
        .setButtonText('Send')
        .setCta()
        .onClick(() => {
          this.close();
          this.onConfirm(true);
        }));
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

class YouTubeLoadingModal extends Modal {
  private errorMessage: string | null = null;
  private isError: boolean = false;

  constructor(app: App) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('youtube-loading-modal');
    
    if (this.isError) {
      this.showErrorContent();
    } else {
      this.showLoadingContent();
    }
  }

  private showLoadingContent() {
    const { contentEl } = this;
    
    // Создаем контейнер
    const container = contentEl.createDiv('youtube-loading-container');
    
    // Спиннер с градиентом
    const spinner = container.createDiv('youtube-loading-spinner');
    spinner.innerHTML = `
      <div class="spinner-ring"></div>
      <div class="spinner-ring"></div>
      <div class="spinner-ring"></div>
    `;
    
    // Текст загрузки
    const textContainer = container.createDiv('youtube-loading-text');
    const title = textContainer.createEl('h3', { text: 'Processing YouTube video' });
    title.addClass('youtube-loading-title');
    
    const subtitle = textContainer.createEl('p', { text: 'Getting transcript and processing content...' });
    subtitle.addClass('youtube-loading-subtitle');
    
    // Анимированные точки
    const dots = textContainer.createDiv('youtube-loading-dots');
    dots.innerHTML = '<span></span><span></span><span></span>';
    
    // Прогресс бар
    const progressContainer = container.createDiv('youtube-loading-progress');
    const progressBar = progressContainer.createDiv('youtube-loading-progress-bar');
    const progressFill = progressBar.createDiv('youtube-loading-progress-fill');
    
    // Анимация прогресса
    let progress = 0;
    const progressInterval = setInterval(() => {
      progress += Math.random() * 15;
      if (progress > 90) progress = 90;
      progressFill.style.width = `${progress}%`;
    }, 500);
    
    // Сохраняем интервал для очистки
    this.progressInterval = progressInterval;
  }

  private showErrorContent() {
    const { contentEl } = this;
    
    const container = contentEl.createDiv('youtube-error-container');
    
    // Иконка ошибки
    const errorIcon = container.createDiv('youtube-error-icon');
    errorIcon.innerHTML = '❌';
    
    // Текст ошибки
    const textContainer = container.createDiv('youtube-error-text');
    const title = textContainer.createEl('h3', { text: 'An error occurred' });
    title.addClass('youtube-error-title');
    
    if (this.errorMessage) {
      const message = textContainer.createEl('p', { text: this.errorMessage });
      message.addClass('youtube-error-message');
    }
    
    // Кнопка закрытия
    const closeButton = container.createEl('button', { text: 'Close' });
    closeButton.addClass('youtube-error-close-btn');
    closeButton.addEventListener('click', () => this.close());
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.removeClass('youtube-loading-modal');
    
    // Очищаем интервал прогресса
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
    }
    
    this.isError = false;
    this.errorMessage = null;
  }

  showError(message: string) {
    this.isError = true;
    this.errorMessage = message;
    this.open();
  }

  private progressInterval: NodeJS.Timeout | null = null;
}