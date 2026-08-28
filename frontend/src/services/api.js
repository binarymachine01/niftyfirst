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

  // System & Pipelines
  getSystemStatus: async () => {
    const response = await client.get('/api/system/status');
    return response.data;
  },

  getAvailableScripts: async () => {
    const response = await client.get('/api/system/scripts');
    return response.data;
  },

  runScript: async (scriptKey, args = []) => {
    const response = await client.post('/api/system/run-script', {
      script_key: scriptKey,
      args,
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
};
