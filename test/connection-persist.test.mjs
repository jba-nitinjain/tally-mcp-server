// feedback #56: the port chosen with set-tally-connection must survive the MCP client relaunching the
// server, and server-info must report connectionSource "session" until it is changed
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { configureEnv, startMockTally, reply, companyXml } from './helpers/mock-tally.mjs';

configureEnv({ TALLY_TIMEOUT_MS: '3000' });
const serverInfoScript = fileURLToPath(new URL('./helpers/call-tool.mjs', import.meta.url));

let tally;
before(async () => { tally = await startMockTally((body, req, res) => reply(res, companyXml(['Demo Co', 'Second Co']))); });
after(async () => { await tally.close(); });

/** runs one MCP tool in a brand-new server process, as Claude Desktop does after a relaunch */
async function callToolInFreshProcess(tool, args = {}) {
    // asynchronous, so this process keeps serving the mock Tally while the child talks to it
    const { stdout } = await promisify(execFile)(process.execPath, [serverInfoScript, tool, JSON.stringify(args)], { env: process.env, encoding: 'utf8' });
    return JSON.parse(stdout);
}

test('before any choice, server-info reports the installed default', async () => {
    const info = await callToolInFreshProcess('server-info');
    assert.equal(info.connectionSource, 'default');
    assert.equal(info.tallyPort, 1);
});

test('a port set in one server process is still in use by the next process', async () => {
    const set = await callToolInFreshProcess('set-tally-connection', { port: tally.port, host: '127.0.0.1' });
    assert.equal(set.connection.port, tally.port);
    assert.equal(set.persisted, true);

    const info = await callToolInFreshProcess('server-info');
    assert.equal(info.connectionSource, 'session');
    assert.equal(info.tallyPort, tally.port);
    assert.equal(info.connectionPersisted, true);
    assert.equal(info.tallyReachable, true);
    assert.deepEqual(info.companies, ['Demo Co', 'Second Co']);
});

test('a port nobody answers on is refused and the session port stays', async () => {
    const set = await callToolInFreshProcess('set-tally-connection', { port: 1, host: '127.0.0.1' });
    assert.equal(set.isError, true);
    const info = await callToolInFreshProcess('server-info');
    assert.equal(info.connectionSource, 'session');
    assert.equal(info.tallyPort, tally.port);
});

test('a choice unused for longer than the TTL lapses to the default', async () => {
    const info = await callToolInFreshProcess('server-info');
    const state = JSON.parse(fs.readFileSync(info.connectionStateFile, 'utf8'));
    state.touchedAt = new Date(Date.now() - 13 * 3600 * 1000).toISOString();
    fs.writeFileSync(info.connectionStateFile, JSON.stringify(state));
    assert.equal((await callToolInFreshProcess('server-info')).connectionSource, 'default');
});
