import React from 'react';
import ReactDOM from 'react-dom/client';
import '@douyinfe/semi-ui/dist/css/semi.min.css';
import App from './App';
import PlayerApp from './PlayerApp';
import WallApp from './WallApp';
import RequestApp from './RequestApp';
import './styles.css';
import { applyTheme, getTheme } from './api';

// 渲染前先应用主题，避免闪白
applyTheme(getTheme());

const path = window.location.pathname.replace(/\/+$/, '');
const view = path === '/wall' ? <WallApp /> : path === '/play' ? <PlayerApp /> : path === '/request' ? <RequestApp /> : <App />;

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<React.StrictMode>{view}</React.StrictMode>);
