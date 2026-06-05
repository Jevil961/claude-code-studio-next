/* notifications.js — System notifications for task completion */

let permissionGranted = false;

export async function requestNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission === 'granted') { permissionGranted = true; return true; }
  if (Notification.permission === 'denied') return false;
  try {
    const result = await Notification.requestPermission();
    permissionGranted = result === 'granted';
    return permissionGranted;
  } catch { return false; }
}

export function sendNotification(title, body) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (!permissionGranted && Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, icon: undefined, silent: false });
  } catch {
    // Fallback: use toast if Notification constructor fails
  }
}

export function initNotifications() {
  requestNotificationPermission();
}
