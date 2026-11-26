export interface AlertSettings {
  lowUnits: number | null;
  highUnits: number | null;
  lowEnabled: boolean;
  highEnabled: boolean;
}
export interface DeviceSubscription {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
}
export interface AlertEvent {
  kind: "low" | "high" | "test";
  status: "pending" | "sent" | "failed" | "expired" | "cancelled";
  createdAt: number;
  priceUnits: number | null;
}
export interface AlertStatus extends AlertSettings {
  recent: AlertEvent[];
}
export interface AlertNotification {
  title: string;
  body: string;
  tag: string;
  url: "/";
}
