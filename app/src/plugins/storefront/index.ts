import { registerPlugin } from '@capacitor/core';
import type { StorefrontPlugin } from './definitions';

const Storefront = registerPlugin<StorefrontPlugin>('Storefront');

export * from './definitions';
export { Storefront };
