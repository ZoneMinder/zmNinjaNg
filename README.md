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

A ZoneMinder client for web, desktop, iOS, and Android. It shows live camera feeds, a montage of many cameras at once, and events on a timeline, and has an AI chat agent you can ask about your cameras. It is a rewrite of the original zmNinja, built on React, TypeScript, Capacitor, and Electron.

### Demo

[Watch the demo](https://zmninjang.zoneminder.com/)

### Notes
- zmNinjaNg supports self-signed certificates on iOS and Android. Turn it on in Settings > Advanced. On desktop, add your CA to the system trust store. I still recommend a proper certificate (for example [Let's Encrypt](https://letsencrypt.org/)).
- zmNinjaNg has been tested with [zmesNg](https://zmeventnotificationng.readthedocs.io/en/latest/), and I recommend switching to it. Push notifications require it.
- For the AI agent, I recommend `qwen3:8b` on your Ollama server, or Qwen3 4B on device. The models built into phones (Apple Intelligence, Gemini Nano) scored lower in our evals.

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
Claude Code agents write most of the code in zmNinjaNg, zmesNg, and pyzmNg. That is how I was able to rewrite zmNinja, and I don't plan to change it, because I wouldn't have time to keep extending the app otherwise. I read and review the design as changes land, and I've spent a lot of time with Claude writing the rules the agents follow.

#### Pull requests

I'm happy to accept PRs, including ones written by agents, as long as they aren't [AI slop](https://en.wikipedia.org/wiki/AI_slop). Coding agents often write custom code where the codebase already has a helper, and they make mistakes, so every PR has to follow these rules:

- Point your agent at [AGENTS.md](AGENTS.md) and [AGENTS.project.md](AGENTS.project.md). The contracts there name the one approved way to do each thing, such as HTTP requests, logging, and settings. Scripted gates catch some bypasses, and review catches the rest.
- Run `npm run gates` from `app/` and make sure it passes before you open a PR. [Chapter 14](docs/developer-guide/14-agent-development-model.rst) explains how agents work in this repo.
- Run a code review before you open a PR (an agent review is fine). If a rule seems wrong, propose a change to the rule in the PR instead of working around it.


## Quick start

### Binaries
- Download from the [zmNinjaNg site](https://zmninjang.zoneminder.com/).
- [GitHub workflows](https://github.com/ZoneMinder/zmNinjaNg/tree/main/.github/workflows) build the release binaries for specific platforms. If a binary doesn't work on your Linux distribution, [build from source](#build-from-source).

## Build from source

### Prerequisites
- Node.js 22 or newer, and npm ([download](https://nodejs.org/en/download))

### GitHub Actions setup (for automated releases)

If you're setting up automated builds via GitHub Actions, you need to enable write permissions:

1. Go to your repository on GitHub
2. Navigate to **Settings** → **Actions** → **General**
3. Scroll down to **Workflow permissions**
4. Select **Read and write permissions**
5. Check **Allow GitHub Actions to create and approve pull requests** (optional)
6. Click **Save**

This allows the workflows to create GitHub releases automatically when you push a tag.

### Desktop development

```bash
git clone https://github.com/ZoneMinder/zmNinjaNg
cd zmNinjaNg/app
npm install

# Desktop development
npm run electron:dev   # Electron shell (Chromium)
```

### Desktop production builds

Desktop builds use Electron (bundles its own Chromium).

```bash
npm run electron:build         # -> desktop_release_builds/electron/
```
On macOS, the build signs with the Developer ID and notarizes when `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` are set in the environment. Append `:nosign` for an unsigned build:
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

### Mobile builds

- For Android setup and builds, see [ANDROID](docs/building/ANDROID.rst)
- For iOS setup and builds, see [IOS](docs/building/IOS.rst)

## Testing

The project has unit tests and end-to-end (E2E) tests for web and devices. All testing commands run from `app/`.

### Unit tests

```bash
npm run test:unit              # Run all unit tests
npm run test:unit -- --watch   # Watch mode
npm run test:coverage          # With coverage report
```

### Web E2E tests

Uses Playwright with Gherkin `.feature` files against a real ZoneMinder server. Configure credentials in `app/.env`.

```bash
npm run test:e2e                                    # All web E2E tests
npm run test:e2e -- tests/features/dashboard.feature  # Single feature
npm run test:e2e -- --headed                          # See the browser
npm run test:all                                      # Unit + web E2E
```

### Device E2E tests

Tests run on the Android emulator and iOS simulators (phone + tablet). Each platform uses shell scripts that handle building, booting, and running tests.

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
- See [`scripts/make_release.sh`](scripts/make_release.sh). It tags the current state and triggers release builds
- After tagging, `make_release.sh` offers to publish to the App Store and Google Play in one prompt. Both land as drafts, so nothing reaches users until you release them in the respective console. `scripts/upload-ios.sh` and `scripts/upload-android.sh` also run on their own to publish a release tagged earlier. Setup is in the [iOS](docs/building/IOS.rst) and [Android](docs/building/ANDROID.rst) build guides
- `app/package.json` is the source of truth for the version number
- From the repo root, run `npm run notice <version>` to draft a short in-app "what's new" notice from the closed issues since the last release (Claude writes it, you approve it). It only writes `docs/notices.json` for you to test; nothing is committed. To discard a test draft, run `git checkout -- docs/notices.json`. On minor/major releases `make_release.sh` offers to generate one for you. Details in the [release notices guide](docs/building/release-notices.rst).
