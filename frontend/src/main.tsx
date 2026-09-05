import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { queryClient } from './api';
import { ToastProvider } from './context';
import { App } from './App';
import './styles.css';
import 'highlight.js/styles/github.min.css';

const Router = import.meta.env.VITE_ROUTER_MODE === 'hash' ? HashRouter : BrowserRouter;
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router>
        <ToastProvider>
          <App />
        </ToastProvider>
      </Router>
    </QueryClientProvider>
  </React.StrictMode>,
);
