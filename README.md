## Code Tree

Browser extension that adds a code tree sidebar to GitHub and GitLab, making it easy to navigate repositories.

### Features

- File tree sidebar for GitHub and GitLab repositories
- Support for private repos via classic or fine-grained GitHub tokens
- Support for self-hosted GitHub Enterprise and GitLab instances
- Pull request diff view
- File-type icons
- Keyboard shortcuts
- Configurable sidebar (pinning, hover-open, lazy loading)

### Installation

1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm run build` to build the extension
4. Open your browser's extension page (e.g. `edge://extensions/`)
5. Enable Developer mode
6. Click "Load unpacked" and select the `tmp/chrome` folder

### Development

- `npm start` or `npm run watch` — build and watch for changes
- `npm run build` — one-time build
- `npm run dist` — production build with ZIP output

### Token Setup

For private repositories, you need an access token:

**GitHub (classic token — recommended for shared repos):**
Generate at Settings > Developer settings > Personal access tokens > Tokens (classic) with `repo` scope.

**GitHub (fine-grained token — your own repos only):**
Generate at Settings > Developer settings > Personal access tokens > Fine-grained tokens with `Contents: Read` and `Pull requests: Read` permissions.

**GitLab:**
Generate at Settings > Access Tokens with `read_api` scope.
