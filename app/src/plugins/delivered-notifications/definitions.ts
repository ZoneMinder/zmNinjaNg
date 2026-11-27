/** One notification in the OS tray (Notification Center on iOS). */
export interface DeliveredNotification {
  id: string;
  /** Android notification tag; the ES puts the event id here (issue #242). */
  tag?: string | null;
  title?: string | null;
  body?: string | null;
  /** iOS: the push payload. Android: the notification's extras. */
  data?: Record<string, unknown>;
  /** Epoch ms the OS delivered it (iOS UNNotification.date, Android postTime). */
  time?: number;
}

export interface DeliveredNotificationsPlugin {
  /** The app's notifications in the tray, with the time each was delivered,
   *  which @capacitor-firebase/messaging leaves out (issue #615). */
  getDelivered(): Promise<{ notifications: DeliveredNotification[] }>;
}
