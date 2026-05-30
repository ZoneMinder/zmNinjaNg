export interface PlatformTestConfig {
  android: {
    avdName: string;
    apiLevel: number;
    systemImage: string;
    cdpPort: number;
    appId: string;
    apkPath: string;
    chromedriverPath?: string;
  };
  ios: {
    phone: {
      simulator: string;
      runtime: string;
    };
    tablet: {
      simulator: string;
      runtime: string;
    };
    appBundleId: string;
    appPath: string;
    appiumPort: number;
  };
  web: {
    baseUrl: string;
  };
  timeouts: {
    appLaunch: number;
    navigation: number;
    element: number;
    screenshot: number;
    webviewSwitch: number;
  };
}

export type PlatformProfile =
  | 'web-chromium'
  | 'android-phone'
  | 'ios-phone'
  | 'ios-tablet';

export const defaults: PlatformTestConfig = {
  android: {
    avdName: 'Pixel_7_API_34',
    apiLevel: 34,
    systemImage: 'google_apis;arm64-v8a',
    cdpPort: 9222,
    appId: 'com.zoneminder.zmNinjaNG',
    apkPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
  },
  ios: {
    phone: {
      simulator: 'iPhone 15',
      runtime: 'iOS-17-5',
    },
    tablet: {
      simulator: 'iPad Air 11-inch (M2)',
      runtime: 'iOS-17-5',
    },
    appBundleId: 'com.zoneminder.zmNinjaNG',
    appPath: 'ios/App/DerivedData/Build/Products/Debug-iphonesimulator/App.app',
    appiumPort: 4723,
  },
  web: {
    baseUrl: 'http://localhost:5173',
  },
  timeouts: {
    appLaunch: 30000,
    navigation: 10000,
    element: 5000,
    screenshot: 1000,
    webviewSwitch: 10000,
  },
};
