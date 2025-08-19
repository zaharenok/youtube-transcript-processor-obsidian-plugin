# YouTube Transcript Processor for Obsidian

An Obsidian plugin that seamlessly integrates with your n8n workflow to process YouTube videos and create structured notes from transcripts.

## 🚀 Features

- **Smart Link Detection**: Automatically detects YouTube URLs in your notes
- **Multiple Input Methods**:
  - Process links from current note
  - Process from clipboard
  - Manual URL input
- **Flexible Output**: Create new notes or append to existing ones
- **Customizable Settings**: Configure backend URL, output folder, and processing options
- **Auto-processing**: Optionally process videos automatically when opening notes
- **User-friendly Interface**: Clean modals and intuitive commands

## 🛠️ Installation

### Method 1: Manual Installation

1. Download the latest release from GitHub
2. Extract the files to your Obsidian vault's `.obsidian/plugins/youtube-transcript-processor/` folder
3. Enable the plugin in Obsidian's Community Plugins settings

### Method 2: Development Installation

1. Clone this repository:

   ```bash
   git clone https://github.com/yourusername/obsidian-youtube-transcript-plugin.git
   cd obsidian-youtube-transcript-plugin
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Build the plugin:

   ```bash
   npm run build
   ```

4. Copy the built files to your vault:
   ```bash
   cp main.js manifest.json /path/to/your/vault/.obsidian/plugins/youtube-transcript-processor/
   ```

## ⚙️ Configuration

### 1. Install the Plugin

#### Method 1: Community Plugins (Recommended)

1. Open Obsidian → Settings → Community Plugins
2. Turn on **Community Plugins** if not already enabled
3. Click **Browse** → Search for "YouTube Transcript Processor"
4. Click **Install** → **Enable**

#### Method 2: Manual Installation

1. Download latest release from [Releases](https://github.com/yourusername/obsidian-youtube-transcript-plugin/releases)
2. Extract to `.obsidian/plugins/youtube-transcript-processor/` in your vault
3. Enable in Settings → Community Plugins

#### Method 3: BRAT (Beta)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin
2. Add `yourusername/obsidian-youtube-transcript-plugin` as beta plugin

### 2. Configure Settings

1. **Open Settings**: Settings → Community Plugins → YouTube Transcript Processor

2. **Backend Configuration**:

   - **Backend URL**: Your n8n webhook endpoint (e.g., `https://your-n8n.com/webhook/abc123`)
   - **Output Folder**: Where new notes will be created (default: "YouTube Notes")

3. **OpenAI Settings**:

   - **OpenAI API Key**: Your OpenAI API key (starts with `sk-`)
   - **Model**: Select from available models (gpt-4o-mini, gpt-4o, gpt-3.5-turbo, etc.)
   - **Processing Prompt**: Customize how AI should process transcripts
   - **Max Tokens**: Maximum tokens for response (100-8000)
   - **Temperature**: Creativity level (0-2, lower = more focused)
   - **Language**: Output language (auto-detect or specific language)

4. **Processing Options**:
   - **Auto-process**: Enable/disable automatic processing when opening notes
   - **Include metadata**: Include video title, description, thumbnail
   - **Include timestamps**: Add timestamps to processed content
   - **Include chapters**: Generate chapter breaks from video

### 3. n8n Backend Setup

Ensure your n8n workflow is configured to:

1. Accept POST requests to your webhook endpoint
2. Process YouTube URLs and return formatted markdown
3. Handle OpenAI integration based on provided settings

## 🎯 Usage

### Method 1: Command Palette

1. **Process current note**: Open command palette (Ctrl/Cmd+P) → "Process YouTube link in current note"
2. **Process from clipboard**: "Process YouTube link from clipboard"
3. **Manual input**: "Enter YouTube URL manually"

### Method 2: Ribbon Icon

Click the YouTube icon in the left sidebar to process the current note.

### Method 3: Auto-processing

When enabled in settings, the plugin will automatically detect YouTube URLs when you open notes.

## 📋 How It Works

1. **Link Detection**: The plugin scans your notes for YouTube URLs
2. **Backend Processing**: Sends the URL to your n8n workflow
3. **Content Generation**: Your n8n workflow extracts transcript and processes with AI
4. **Note Creation**: Creates structured markdown notes in your specified folder

## 🔗 Integration with n8n

Your n8n workflow should:

1. Accept POST requests with JSON payload:

   ```json
   {
     "video_url": "https://youtube.com/watch?v=...",
     "target_note": "/path/to/note.md",
     "settings": {
       "output_folder": "YouTube Notes",
       "include_metadata": true
     }
   }
   ```

2. Return JSON response:
   ```json
   {
     "content": "# Processed YouTube content...",
     "new_note_path": "video-title.md",
     "append_to_note": false
   }
   ```

## 🎨 Customization

### Styling

The plugin uses Obsidian's native styling. You can customize the appearance by adding CSS to your theme or snippets.

### Output Format

Modify your n8n workflow to control the output format, structure, and styling of the generated notes.

## 🐛 Troubleshooting

### Common Issues

1. **Backend not responding**: Check your n8n webhook URL in settings
2. **No YouTube URL found**: Ensure URLs are properly formatted
3. **Permission errors**: Verify Obsidian has write access to your vault

### Debug Mode

Enable debug logging by adding this to your console:

```javascript
localStorage.setItem("youtube-transcript-debug", "true");
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

## 🙏 Acknowledgments

- Obsidian team for the amazing platform
- n8n team for the workflow automation
- Community plugins for inspiration

## 📞 Support

- [GitHub Issues](https://github.com/yourusername/obsidian-youtube-transcript-plugin/issues)
- [Community Discord](https://discord.gg/obsidianmd)
- [Obsidian Forum](https://forum.obsidian.md)

## 🗺️ Roadmap

- [ ] Batch processing multiple URLs
- [ ] Custom templates for note formatting
- [ ] Progress indicators for long processing
- [ ] Integration with other video platforms
- [ ] Advanced filtering and categorization
- [ ] Mobile-specific optimizations
