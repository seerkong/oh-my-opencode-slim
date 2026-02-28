import type { LocalMcpConfig } from './types';

/**
 * Playwright MCP - browser automation toolkit.
 * Uses the official Playwright MCP package via npx.
 */
export const playwright: LocalMcpConfig = {
  type: 'local',
  command: ['npx', '@playwright/mcp@latest', '--headed'],
};
