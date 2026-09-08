import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

const client = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const api = {
  // Backtesting
  runBacktest: async (params) => {
    const response = await client.post('/api/backtest/run', params);
    return response.data;
  },

  getPresetStrategies: async () => {
    const response = await client.get('/api/backtest/preset-strategies');
    return response.data;
  },

  getBacktestDataAvailability: async () => {
    const response = await client.get('/api/backtest/data-availability');
    return response.data;
  },

  runDateRangeBacktest: async (params) => {
    const response = await client.post('/api/backtest/run-date-range', params);
    return response.data;
  },

  getBacktestRuns: async (limit = 20) => {
    const response = await client.get('/api/backtest/runs', { params: { limit } });
    return response.data;
  },

  getBacktestRun: async (runId) => {
    const response = await client.get(`/api/backtest/runs/${runId}`);
    return response.data;
  },

  downloadBacktestExport: async (runId, type = 'deals', format = 'csv') => {
    const response = await client.get(`/api/backtest/runs/${runId}/export`, {
      params: { export_type: type, format },
      responseType: 'blob',
    });
    const disposition = response.headers['content-disposition'] || '';
    let filename = `backtest_${type}_${runId}.${format === 'excel' || format === 'xlsx' ? 'xlsx' : 'csv'}`;
    const match = disposition.match(/filename="?([^"]+)"?/);
    if (match && match[1]) {
      filename = match[1];
    }
    const blob = new Blob([response.data], {
      type: response.headers['content-type'] || 'application/octet-stream',
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    return filename;
  },

  // Deals
  getDeals: async (params = {}) => {
    const response = await client.get('/api/deals', { params });
    return response.data;
  },

  getDealsSummary: async () => {
    const response = await client.get('/api/deals/summary');
    return response.data;
  },

  getDealExchanges: async () => {
    const response = await client.get('/api/deals/exchanges');
    return response.data;
  },

  getClientDeals: async (clientName) => {
    const response = await client.get(`/api/deals/clients/${encodeURIComponent(clientName)}`);
    return response.data;
  },

  // Stocks
  getStocksList: async (search = '') => {
    const response = await client.get('/api/stocks/list', { params: { search } });
    return response.data;
  },

  getStockHistory: async (symbol, params = {}) => {
    const response = await client.get(`/api/stocks/${symbol}/history`, { params });
    return response.data;
  },

  getStockDeals: async (symbol) => {
    const response = await client.get(`/api/stocks/${symbol}/deals`);
    return response.data;
  },

  getStockIntelligence: async (symbol) => {
    const response = await client.get(`/api/stocks/${symbol}/intelligence`);
    return response.data;
  },

  // System & Pipelines
  getSystemStatus: async () => {
    const response = await client.get('/api/system/status');
    return response.data;
  },

  getAvailableScripts: async () => {
    const response = await client.get('/api/system/scripts');
    return response.data;
  },

  runScript: async (scriptKey, args = [], exchanges = undefined) => {
    const response = await client.post('/api/system/run-script', {
      script_key: scriptKey,
      args,
      exchanges,
    });
    return response.data;
  },

  getTasks: async () => {
    const response = await client.get('/api/system/tasks');
    return response.data;
  },

  getTaskStatus: async (taskId) => {
    const response = await client.get(`/api/system/tasks/${taskId}`);
    return response.data;
  },

  stopTask: async (taskId) => {
    const response = await client.post(`/api/system/tasks/${taskId}/stop`);
    return response.data;
  },

  clearInsiderData: async (confirmation) => {
    const response = await client.post('/api/system/insider-data/clear', { confirmation });
    return response.data;
  },

  // Insider Conviction Engine
  getConvictionRanking: async (params = {}) => {
    const response = await client.get('/api/conviction', { params });
    return response.data;
  },

  getConvictionScore: async (symbol) => {
    const response = await client.get(`/api/conviction/${symbol}`);
    return response.data;
  },

  getConvictionExplanation: async (symbol) => {
    const response = await client.get(`/api/conviction/${symbol}/explanation`);
    return response.data;
  },

  getConvictionHistory: async (symbol) => {
    const response = await client.get(`/api/conviction/${symbol}/history`);
    return response.data;
  },

  // Smart Screener
  runScreener: async (filterPayload) => {
    const response = await client.post('/api/screener/search', filterPayload);
    return response.data;
  },

  getScreenerOptions: async () => {
    const response = await client.get('/api/screener/options');
    return response.data;
  },

  // Symbol Matcher Governance
  getUnmatchedSecurities: async (search = '') => {
    const response = await client.get('/api/symbol-matcher/unmatched', { params: { search: search || undefined } });
    return response.data;
  },

  getLowConfidenceSecurities: async (search = '') => {
    const response = await client.get('/api/symbol-matcher/low-confidence', { params: { search: search || undefined } });
    return response.data;
  },

  getAllMappings: async (params = {}) => {
    const response = await client.get('/api/symbol-matcher/mappings', { params });
    return response.data;
  },

  getMatchCandidates: async (securityName) => {
    const response = await client.get(`/api/symbol-matcher/candidates/${encodeURIComponent(securityName)}`);
    return response.data;
  },

  createSymbolMapping: async (payload) => {
    const response = await client.post('/api/symbol-matcher/mapping', payload);
    return response.data;
  },

  updateSymbolMapping: async (mappingId, payload) => {
    const response = await client.put(`/api/symbol-matcher/mapping/${mappingId}`, payload);
    return response.data;
  },

  removeSymbolMapping: async (mappingId, payload = {}) => {
    const response = await client.delete(`/api/symbol-matcher/mapping/${mappingId}`, { data: payload });
    return response.data;
  },

  getMappingHistory: async (mappingId) => {
    const response = await client.get(`/api/symbol-matcher/history/${mappingId}`);
    return response.data;
  },

  rematchSymbols: async (confirmation) => {
    const response = await client.post('/api/symbol-matcher/rematch', { confirmation });
    return response.data;
  },

  validateSymbolMappings: async () => {
    const response = await client.get('/api/symbol-matcher/validate');
    return response.data;
  },

  // Alerts & Saved Filters
  getSavedFilters: async () => {
    const response = await client.get('/api/alerts/filters');
    return response.data;
  },

  createSavedFilter: async (filter) => {
    const response = await client.post('/api/alerts/filters', filter);
    return response.data;
  },

  deleteSavedFilter: async (filterId) => {
    const response = await client.delete(`/api/alerts/filters/${filterId}`);
    return response.data;
  },

  acknowledgeFilter: async (filterId) => {
    const response = await client.post(`/api/alerts/filters/${filterId}/acknowledge`);
    return response.data;
  },

  getAlertMatches: async () => {
    const response = await client.get('/api/alerts/matches');
    return response.data;
  },
};
