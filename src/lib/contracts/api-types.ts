// Shapes returned by our own /api/today and /api/history query APIs
// (see docs/blueprint.md §7).

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
