/**
 * Base URL of the Laravel API.
 *
 * - Android emulator: 10.0.2.2 maps to your machine's localhost
 * - iOS simulator: http://localhost:8005 works directly
 * - Physical device: use your machine's LAN IP, e.g. http://192.168.1.50:8005
 *
 * Override via EXPO_PUBLIC_API_URL in mobile/.env
 */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8005";
