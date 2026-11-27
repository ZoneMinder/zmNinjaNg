import { registerPlugin } from '@capacitor/core';
import type { DeliveredNotificationsPlugin } from './definitions';

const DeliveredNotifications = registerPlugin<DeliveredNotificationsPlugin>('DeliveredNotifications');

export * from './definitions';
export { DeliveredNotifications };
