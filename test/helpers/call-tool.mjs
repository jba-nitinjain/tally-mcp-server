// Starts the MCP server in this (fresh) process, calls one tool through an in-memory client and
// prints the tool's JSON answer on stdout. Usage: node call-tool.mjs <tool> '<json args>'
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const { registerMcpServer } = await import('../../dist/mcp.mjs');
const [tool, rawArgs] = process.argv.slice(2);

const server = await registerMcpServer();
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
const client = new Client({ name: 'test', version: '1.0.0' });
await client.connect(clientTransport);

const result = await client.callTool({ name: tool, arguments: JSON.parse(rawArgs || '{}') });
const text = result.content?.[0]?.text ?? '';
let body;
try { body = JSON.parse(text); } catch { body = { text }; }
process.stdout.write(JSON.stringify(result.isError ? { isError: true, ...body } : body));
process.exit(0);
