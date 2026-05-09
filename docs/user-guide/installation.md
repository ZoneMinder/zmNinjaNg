# Installation

## Pre-built Binaries

Download links for every platform are on the [zmNinjaNg downloads page](https://pliablepixels.github.io/zmNinjaNg/). Mobile users install from the App Store or Google Play; desktop users grab an installer from [GitHub Releases](https://github.com/pliablepixels/zmNinjaNg/releases).

### Android

Install from [Google Play](https://play.google.com/store/apps/details?id=com.zoneminder.zmNinjaNG). Launch zmNinjaNg and set up your first {doc}`profile <profiles>`.

:::{tip}
An APK is also published on the [releases page](https://github.com/pliablepixels/zmNinjaNg/releases) for sideloading. Enable **Install from unknown sources** (Settings > Security) before running it. Sideloaded builds do not receive automatic updates.
:::

### Windows

1. Download the `.msi` or `.exe` installer from the releases page
2. Run the installer
3. Launch zmNinjaNg from the Start menu

### macOS

1. Download the `.dmg` file from the releases page
2. Open the DMG and drag zmNinjaNg to your Applications folder
3. On first launch, you may need to right-click > Open to bypass Gatekeeper (the app is not notarized)

### Linux

1. Download the `.deb` (Debian/Ubuntu) or `.AppImage` (universal) from the releases page
2. Install:
   - **Debian/Ubuntu**: `sudo dpkg -i zmNinjaNg_*.deb`
   - **AppImage**: `chmod +x zmNinjaNg_*.AppImage && ./zmNinjaNg_*.AppImage`

:::{tip}
If the pre-built binary doesn't work on your Linux distribution, check the [GitHub Actions workflows](https://github.com/pliablepixels/zmNinjaNg/tree/main/.github/workflows) for build details and adjust for your system.
:::

### iOS

Install from the [App Store](https://apps.apple.com/app/id6759469535). Launch zmNinjaNg and set up your first {doc}`profile <profiles>`.

:::{tip}
If you prefer to build from source (for example, to customize settings or contribute), see {doc}`../building/IOS`. You will need an Apple Developer account.
:::

## Web Deployment

You can also host zmNinjaNg as a web application.

### Build from Source

```bash
git clone https://github.com/pliablepixels/zmNinjaNg
cd zmNinjaNg/app
npm install
npm run build
```

The `dist/` folder contains the static files. Deploy to any web server or hosting service (Netlify, Vercel, GitHub Pages, nginx, Apache, etc.).

### Example: nginx

```nginx
server {
    listen 80;
    server_name zmng.example.com;
    root /var/www/zmng/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

## Build from Source (Desktop)

```bash
git clone https://github.com/pliablepixels/zmNinjaNg
cd zmNinjaNg/app
npm install
npm run tauri:build
```

The built application will be in `app/src-tauri/target/release/bundle/`.

See {doc}`../building/index` for detailed platform-specific instructions.

## Updating

### Binaries

Download the new version from the releases page and install it over the existing installation. Profiles and settings are preserved — they are stored in the browser/app local storage, not in the application files.

### Web Deployment

Rebuild from source and replace the `dist/` folder contents.
