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
};
