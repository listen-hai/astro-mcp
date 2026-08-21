#!/usr/bin/env bun
import { runServer } from './mcp/server';

runServer().catch((error) => {
  console.error('Fatal error in Astro MCP Server:', error);
  process.exit(1);
});
