import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerMcpServer } from './mcp.mjs';
import { warmTallyConnection } from './tally.mjs';
import { guardProcess } from './log.mjs';
guardProcess(); // a stray rejection must not end the process, which would drop the session connection
const mcpServer = await registerMcpServer();
const transport = new StdioServerTransport(); // Start receiving messages on stdin and sending messages on stdout
await mcpServer.connect(transport); // Connect to the MCP server
void warmTallyConnection(); // compile templates and open the Tally connection now, not on the first tool call (logs to stderr only)
//# sourceMappingURL=index.mjs.map