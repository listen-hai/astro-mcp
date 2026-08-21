import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import rootPkg from '../../package.json';

export function createAstroMcpServer(): Server {
  return new Server(
    { name: 'astro-mcp', version: rootPkg.version },
    { capabilities: { tools: {} } }
  );
}

export async function runServer(): Promise<void> {
  const server = createAstroMcpServer();
  await server.connect(new StdioServerTransport());
}
