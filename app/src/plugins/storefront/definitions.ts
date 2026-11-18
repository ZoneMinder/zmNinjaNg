export interface StorefrontPlugin {
  /** ISO 3166-1 alpha-3 code of the App Store storefront the app was installed
   *  from (e.g. 'CHN'), or null when there is no App Store account. */
  getCountryCode(): Promise<{ countryCode: string | null }>;
}
