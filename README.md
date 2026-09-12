# zmNinjaNg - ZoneMinder Client

[![Build Android](https://github.com/ZoneMinder/zmNinjaNg/actions/workflows/build-android.yml/badge.svg)](https://github.com/ZoneMinder/zmNinjaNg/actions/workflows/build-android.yml)
[![Build macOS](https://github.com/ZoneMinder/zmNinjaNg/actions/workflows/build-macos.yml/badge.svg)](https://github.com/ZoneMinder/zmNinjaNg/actions/workflows/build-macos.yml)
[![Build Windows](https://github.com/ZoneMinder/zmNinjaNg/actions/workflows/build-windows.yml/badge.svg)](https://github.com/ZoneMinder/zmNinjaNg/actions/workflows/build-windows.yml)
[![Build Linux](https://github.com/ZoneMinder/zmNinjaNg/actions/workflows/build-linux-amd64.yml/badge.svg)](https://github.com/ZoneMinder/zmNinjaNg/actions/workflows/build-linux-amd64.yml)
[![Tests](https://github.com/ZoneMinder/zmNinjaNg/actions/workflows/test.yml/badge.svg)](https://github.com/ZoneMinder/zmNinjaNg/actions/workflows/test.yml)
[![GitHub release](https://img.shields.io/github/v/release/ZoneMinder/zmNinjaNg)](https://github.com/ZoneMinder/zmNinjaNg/releases)
[![GitHub downloads](https://img.shields.io/github/downloads/ZoneMinder/zmNinjaNg/total?cache=none)](https://github.com/ZoneMinder/zmNinjaNg/releases)

<img src="app/assets/logo.png" align="right" width="120" />

**[Documentation](https://zmninjang.readthedocs.io/en/latest/)**

A web and mobile application for ZoneMinder for viewing live camera feeds, reviewing events, a local AI chat agent and much more. It is a rewrite of the original zmNinja application, built on React, TypeScript, Capacitor, and Electron. 

### Demo

[Watch the demo](https://zmninjang.zoneminder.com/)

###  Notes:
- zmNinjaNg supports self-signed certificates on mobile (iOS/Android). Enable it in Settings > Connection. On desktop, add your CA to the system trust store. Using proper certificates (e.g. [LetsEncrypt](https://letsencrypt.org/)) is still recommended.
- zmNinjaNg has been tested with [zmesNg](https://zmeventnotificationng.readthedocs.io/en/latest/) - I'd recommend you switch to this new ecosystem

<details>
<summary>Screenshots</summary>
<sub><sup>frames courtesy <a href="https://appleframer.com/">appleframer</a></sup></sub>

<p align="center">
  <img src="images/1.png" width="32%" />
  <img src="images/2.png" width="32%" />
  <img src="images/3.png" width="32%" />
</p>
<p align="center">
  <img src="images/4.png" width="32%" />
  <img src="images/5.png" width="32%" />
  <img src="images/6.png" width="32%" />
</p>
<p align="center">
  <img src="images/7.png" width="32%" />
  <img src="images/8.png" width="32%" />
  <img src="images/9.png" width="32%" />
</p>
</details>

### Support
I (Pliablepixels) don't plan to support zmNinjaNg with any urgency. Please don't ping me and expect quick answers. ZoneMinder however does plan to offer limited support, just like it did with zmNinja. 

### Agentic AI
zmNinjaNg, esNg and pyzmNg heavily use Agentic UI (Claude) for development. Thanks to these tools, I was able to redo things and get it to a point where the new codebase is better in many ways than the old one. I don't plan to change this anytime soon (and if I did, I won't have time to extend this anymore). In short, in my view, this is the new way of development for me atleast. I've spent a lot of time working with Claude to build this system - just because I used AI doesn't really mean I don't know what is going on. I do and I still spend time reading/understanding the code as changes are made. 

#### Pull Requests

I am happy to accept PRs, but I don't want [AI slop](https://en.wikipedia.org/wiki/AI_slop). Funny I am saying this, given this repo is largely AI agent(s) generated. The difference is I understand the system and do my best to ensure it follows good principles. Remember these tools are capable but love to write a lot of code doing custom things when simpler/better means are available. They also make mistakes. So here are the rules:

- PRs are judged by this repo's rules and gates, not by who or what wrote the code. Point your agent at [AGENTS.md](AGENTS.md) and [AGENTS.project.md](AGENTS.project.md); the contracts there describe the sanctioned path through every subsystem, and the gates fail anything that bypasses them
- Every gate must pass before you PR: the unit suite, the blocking lints, and the instruction-system checks. [docs/developer-guide/14-agent-development-model.rst](docs/developer-guide/14-agent-development-model.rst) explains how the whole system works
- Before you PR, run a code review (agent-driven is fine; that is how this repo works). If a rule seems wrong, propose a rule change in the PR instead of working around it

###  Notes
- Self-signed certificates are supported on mobile (iOS/Android) via Settings > Connection. On desktop, add your CA to the system trust store. Using proper certificates (e.g. [LetsEncrypt](https://letsencrypt.org/)) is still recommended.
- If you want push notifications, you'll have to use a newer [Event Server](https://zmeventnotificationng.readthedocs.io/en/latest/)
- If you use the AI agent, I'd highly recommend you use Qwen-8b on your Ollama server, or Qwen-3b on device. The local LLMs provided in phones are terrible. 


## Quick Start

### Binaries
- Download from [here](https://zmninjang.zoneminder.com/)
- I use Github workflows and runners to automatically build release binaries [here](https://github.com/ZoneMinder/zmNinjaNg/tree/main/.github/workflows). Binaries are built for specific platforms. If the binary doesn't work for your linux distro, look at those files

## Build from Source

### Prerequisites
- Node.js ^20.19.0 || >=22.12.0 and npm ([download](https://nodejs.org/en/download))

### GitHub Actions Setup (For Automated Releases)

If you're setting up automated builds via GitHub Actions, you need to enable write permissions:

1. Go to your repository on GitHub
2. Navigate to **Settings** → **Actions** → **General**
3. Scroll down to **Workflow permissions**
4. Select **"Read and write permissions"**
5. Check **"Allow GitHub Actions to create and approve pull requests"** (optional)
6. Click **Save**

This allows the workflows to create GitHub releases automatically when you push a tag.

### Desktop Development

```bash
git clone https://github.com/ZoneMinder/zmNinjaNg
cd zmNinjaNg/app
npm install

# Desktop development
npm run electron:dev   # Electron shell (Chromium)
```

### Desktop Production Builds

Desktop builds use Electron (bundles its own Chromium).

```bash
npm run electron:build         # -> desktop_release_builds/electron/
```
Signs with the Developer ID and notarizes when `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` are set in the environment. Append `:nosign` for an unsigned build:
```bash
npm run electron:build:nosign
```
The target folder is wiped at the start of each build.

#### Web production build
```bash
npm run build          # Output: app/dist/
npm run preview        # Preview the production build
```
Deploy the web build (`app/dist/`) to Netlify, Vercel, GitHub Pages, AWS S3, etc.

### Mobile Builds

- For Android setup and builds, see [ANDROID](docs/building/ANDROID.md)
- For iOS setup and builds, see [IOS](docs/building/IOS.md)

## Testing

The project includes unit tests and cross-platform E2E tests. All commands run from `app/`.

### Unit Tests

```bash
npm run test:unit              # Run all unit tests
npm run test:unit -- --watch   # Watch mode
npm run test:coverage          # With coverage report
```

### Web E2E Tests

Uses Playwright with Gherkin `.feature` files against a real ZoneMinder server. Configure credentials in `app/.env`.

```bash
npm run test:e2e                                    # All web E2E tests
npm run test:e2e -- tests/features/dashboard.feature  # Single feature
npm run test:e2e -- --headed                          # See the browser
npm run test:e2e:visual-update                        # Regenerate visual baselines
npm run test:all                                      # Unit + web E2E
```

### Device E2E Tests

Tests run on real devices: Android emulator and iOS simulator (phone + tablet). Each platform uses shell scripts that handle building, booting, and running tests.

```bash
bash scripts/test-android.sh          # Android emulator (Playwright via CDP)
bash scripts/test-ios.sh phone        # iPhone simulator (WebDriverIO + Appium)
bash scripts/test-ios.sh tablet       # iPad simulator (WebDriverIO + Appium)
bash scripts/test-all-platforms.sh    # All platforms sequentially
```

Device tests require one-time setup (Xcode, Android Studio, Appium, etc.). Run `npm run test:platform:setup` to verify your machine is ready. See [app/tests/README.md](app/tests/README.md) for setup instructions and [docs/developer-guide/06-testing-strategy.rst](docs/developer-guide/06-testing-strategy.rst) for the full testing guide.

### Documentation

```bash
pip install -r docs/requirements.txt sphinx-autobuild && cd docs && make clean && make html && sphinx-autobuild . _build/html
```

### Making releases
- See `scripts/make_release.sh` [here](scripts/make_release.sh). This automatically tags the current state and triggers release builds
- **Store uploads**: after tagging, `make_release.sh` offers to publish to the App Store and Google Play in one prompt. Both land as drafts, so nothing reaches users until you release them in the respective console. `scripts/upload-ios.sh` and `scripts/upload-android.sh` also run on their own to publish a release tagged earlier. Setup is in the [iOS](docs/building/IOS.rst) and [Android](docs/building/ANDROID.rst) build guides
- `app/package.json` is the source of truth for the version number
- **In-app release notice**: run `npm run notice <version>` to draft a short "what's new" notice from the closed issues since the last release (Claude writes it, you approve it). It only writes `docs/notices.json` for you to test; nothing is committed. To discard a test draft, run `git checkout -- docs/notices.json`. On minor/major releases `make_release.sh` offers to generate one for you. Details in the [developer guide](docs/developer-guide/13-network-endpoints.rst).


