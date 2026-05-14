# zmNinjaNg - Modern ZoneMinder Client

[![Build Android](https://github.com/pliablepixels/zmNinjaNg/actions/workflows/build-android.yml/badge.svg)](https://github.com/pliablepixels/zmNinjaNg/actions/workflows/build-android.yml)
[![Build macOS](https://github.com/pliablepixels/zmNinjaNg/actions/workflows/build-macos.yml/badge.svg)](https://github.com/pliablepixels/zmNinjaNg/actions/workflows/build-macos.yml)
[![Build Windows](https://github.com/pliablepixels/zmNinjaNg/actions/workflows/build-windows.yml/badge.svg)](https://github.com/pliablepixels/zmNinjaNg/actions/workflows/build-windows.yml)
[![Build Linux](https://github.com/pliablepixels/zmNinjaNg/actions/workflows/build-linux-amd64.yml/badge.svg)](https://github.com/pliablepixels/zmNinjaNg/actions/workflows/build-linux-amd64.yml)
[![Tests](https://github.com/pliablepixels/zmNinjaNg/actions/workflows/test.yml/badge.svg)](https://github.com/pliablepixels/zmNinjaNg/actions/workflows/test.yml)
[![GitHub release](https://img.shields.io/github/v/release/pliablepixels/zmNinjaNg)](https://github.com/pliablepixels/zmNinjaNg/releases)
[![GitHub downloads](https://img.shields.io/github/downloads/pliablepixels/zmNinjaNg/total?cache=none)](https://github.com/pliablepixels/zmNinjaNg/releases)

<img src="app/assets/logo.png" align="right" width="120" />

**[Documentation](https://zmninjang.readthedocs.io/en/latest/)**

A modern web and mobile application for ZoneMinder, providing a clean, intuitive interface for viewing live camera feeds, reviewing events, and managing multiple server profiles. It is a ground-up rewrite of the original [zmNinja](https://zmninja.zoneminder.com/) application, using modern web technologies and a more intuitive user interface. 

### Demo

[Watch the demo](https://pliablepixels.github.io/zmNinjaNg/)

### Important Notes:
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


### Agentic AI, you and me

Agentic AI and me: I built the very first version of zmNinja over several months and built in more features over multiple years. I built the first version of zmNinjaNg over 2.5 days with almost as many features as the last version of zmNinja. Thanks to Claude.

Agentic AI and you: I (Pliablepixels) don't plan to support zmNinjaNg with any urgency. Please don't ping me and expect quick answers. ZoneMinder however does plan to offer limited support, just like it did with zmNinja. 


#### Pull Requests

I am happy to accept PRs, but I don't want [AI slop](https://en.wikipedia.org/wiki/AI_slop). Funny I am saying this, given this repo is largely AI agent(s) generated. The difference is I understand the code and know how to prompt it with directions that make the tools generate better quality code. Remember these tools are amazing but love to write a lot of code doing custom things when simpler/better means are available. They also make mistakes. So here are the rules:

- If you have not read and understood the code you generated, please don't PR it to my repo. Please continue to extend it yourself
- See my agent rules for [CLAUDE](AGENTS.md) here - please make sure to use it in your agent
- Before you PR, please do a code review

###  Notes
- Self-signed certificates are supported on mobile (iOS/Android) via Settings > Connection. On desktop, add your CA to the system trust store. Using proper certificates (e.g. [LetsEncrypt](https://letsencrypt.org/)) is still recommended.
- If you want push notifications, you'll have to use a newer [Event Server](https://zmeventnotificationng.readthedocs.io/en/latest/)


## Quick Start

### Binaries
- Download from [here](https://pliablepixels.github.io/zmNinjaNg/)
- I use Github workflows and runners to automatically build release binaries [here](https://github.com/pliablepixels/zmNinjaNg/tree/main/.github/workflows). Binaries are built for specific platforms. If the binary doesn't work for your linux distro, look at those files

## Build from Source

### Prerequisites
- Node.js ^20.19.0 || >=22.12.0 and npm ([download](https://nodejs.org/en/download))
- For desktop builds: Rust toolchain (for Tauri builds)

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
git clone https://github.com/pliablepixels/zmNinjaNg
cd zmNinjaNg/app
npm install

# Desktop development (Tauri - native app)
npm run tauri:dev
```

### Desktop Production Builds

#### Desktop production build (Tauri): Recommended
```bash
npm run tauri:build    # Output: src-tauri/target/release/bundle/
```
#### Web production build
```bash
npm run build          # Output: dist/
npm run preview        # Preview production build
```
Deploy web build (`dist/`) to: Netlify, Vercel, GitHub Pages, AWS S3, etc.

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

Tests run on real devices — Android emulator, iOS simulator (phone + tablet), and Tauri desktop. Each platform uses shell scripts that handle building, booting, and running tests.

```bash
bash scripts/test-android.sh          # Android emulator (Playwright via CDP)
bash scripts/test-ios.sh phone        # iPhone simulator (WebDriverIO + Appium)
bash scripts/test-ios.sh tablet       # iPad simulator (WebDriverIO + Appium)
bash scripts/test-tauri.sh            # Tauri desktop (WebDriverIO + tauri-driver)
bash scripts/test-all-platforms.sh    # All 5 platforms sequentially
```

Device tests require one-time setup (Xcode, Android Studio, Appium, etc.). Run `npm run test:platform:setup` to verify your machine is ready. See [app/tests/README.md](app/tests/README.md) for setup instructions and [docs/developer-guide/06-testing-strategy.rst](docs/developer-guide/06-testing-strategy.rst) for the full testing guide.

### Documentation

```bash
pip install -r docs/requirements.txt sphinx-autobuild && cd docs && make clean && make html && sphinx-autobuild . _build/html
```

### Making releases
- See `scripts/make_release.sh` [here](scripts/make_release.sh). This automatically tags the current state and triggers release builds
- `app/package.json` is the source of truth for the version number. `scripts/sync-version.js` propagates it to `app/src-tauri/tauri.conf.json` and `app/src-tauri/Cargo.toml` during builds and releases


