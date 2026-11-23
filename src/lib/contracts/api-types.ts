// Shapes returned by our own /api/today and /api/history route handlers
// (see docs/blueprint.md §6).

export interface TodayResponse {
  bank: string;
  currency: string;
  date: string;
  publishedAt: string;
  huiSell: number;
}

export interface HistoryPointResponse {
  date: string;
  huiSell: number;
}

export interface HistoryResponse {
  currency: string;
  bank: string;
  field: string;
  series: HistoryPointResponse[];
}
