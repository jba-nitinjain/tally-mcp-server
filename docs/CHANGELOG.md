# Release History

### Version: v7.8.1 [24/09/2026]

Fixed:
* **TallyPrime 2.1 froze with the pop-up *Error in TDL. 'Collection:MyCollection' Could not find description!*** whenever employees were read: listing the **Employee** collection through **list-master** or **query-collection**, the existence check run by **employee-create-update**, or the name check run by **delete-master**. Employees were requested from Tally as object type `Employee`, which TallyPrime 2.1 does not know; the pop-up is modal, so Tally stopped answering every later request until someone clicked OK, and the calls in between timed out. Employees are now read as what Tally stores them as, cost centres flagged for payroll (`CostCentre` filtered on `$ForPayroll`), which every release understands, and an employee is deleted as that cost centre. Collection definitions can now name the Tally object type and a built-in filter separately from the collection name (`tallyType`, `tallyFilter`). Every other collection (Company, Ledger, Group, VoucherType, Unit, Godown, StockGroup, StockCategory, StockItem, CostCategory, CostCentre, Currency, GSTClassification, AttendanceType, Budget, Bill) was checked against TallyPrime 2.1 and answers without error

### Version: v7.8.0 [22-Sep-2026]

Changed:
* **The company is never implicit any more: `targetCompany` is mandatory on every data and write tool.** With two companies open in Tally, a report call which left `targetCompany` out was served from whichever company the Tally screen had in focus, not the one **server-info** reported as active and not the one **set-company** had just been asked for, and nothing in the response said so: **trial-balance** returned another company's 2,366 ledgers with debits and credits ten crore apart, **ledger-account** answered *No ledger found* for a ledger which plainly existed, and a working paper could have been built on the wrong entity's books without any error to catch. `targetCompany` is now a required argument of **query-collection**, **list-master**, **chart-of-accounts**, **trial-balance**, **profit-loss**, **balance-sheet**, **stock-summary**, **ledger-balance**, **stock-item-balance**, **bills-outstanding**, **ledger-account**, **stock-item-account** and of every create / update / delete tool (**ledger-create-update**, **delete-master**, **group-create-update**, **stock-group-create-update**, **unit-create-update**, **godown-create-update**, **cost-category-create-update**, **cost-centre-create-update**, **stock-item-create-update**, **voucher-create-update**, **voucher-delete**, **stock-category-create-update**, **voucher-type-create-update**, **currency-create-update**, **gst-classification-create-update**, **budget-create-update**, **pay-head-create-update**, **employee-create-update**, **attendance-type-create-update**). A call which leaves it out is refused naming the argument; a blank value, or a name which is not among the companies open in Tally, is refused with the list of companies currently open, taken from the same company list **server-info** reports; a name is matched exactly, then case-insensitively with surrounding whitespace trimmed, and the exact name Tally holds is the one placed in `SVCURRENTCOMPANY` of every request. The company Tally has in focus is never used as a default, whether one company is open or ten (feedback #27, #30)
* Tool **set-company** was removed. Tally acknowledged the switch but did not honour it for later requests, so the tool invited exactly the omission above. Ask for the company on each call instead; there is no session-level company selection
* Every response of the tools above now carries a `company` property naming the company it was served from, next to the unchanged `tableID` and `rowCount`, and every table cached in pglite carries a `company` column stamped on each row, so a figure taken from a cached table later in the session, or read by someone else from the working papers, can always be tied back to its company. **server-info** and the server instructions now say that `targetCompany` is required and where to read the company names from

Fixed:
* Tool **chart-of-accounts** answered `bs_pl` = false for every one of a company's ledgers, so a trial balance grouped on it fell into a single bucket. The TDL answers every boolean as 1 / 0 while the parser accepted only the word Yes, which silently collapsed every collection boolean (bs_pl, dr_cr, affects_gross_profit, IsActiveCompany) to false. Boolean coercion is now one shared helper (`parseTallyBoolean`: Yes/No, true/false, 1/0, a blank is null rather than false) used by every collection and report field; `bs_pl` is taken from the revenue nature of the ledger's primary group (`$IsRevenue`), falls back to the six revenue primary groups by name (Sales Accounts, Purchase Accounts, Direct Incomes, Direct Expenses, Indirect Incomes, Indirect Expenses) when Tally answers blank, and is null when neither can be resolved. The tool description now states exactly what the column means (feedback #33)
* **Master names now round-trip between tools.** Tool **chart-of-accounts** (and every other report) handed out names with Tally's XML character references still in them, so a ledger or group carrying an accidental line break came back as `GENERATOR&#13;&#10;` (10 extra characters, no real line break), while a name containing an ampersand could not be passed back to **ledger-account** in the `&amp;` form it was sometimes seen in. Tally's answers are now parsed with numeric character references decoded (`&#13;` `&#10;` `&#x41;`) alongside the five named entities, and every text field of every collection and report passes through one `normaliseName` helper before it is cached: the second layer of escaping Tally applies in places is decoded once (`&amp;#13;` on its own stays literal text), runs of control characters (CR, LF, TAB) become a single space and the value is trimmed, so `Jain Bafna &amp; Associates&#13;&#10;` is returned as `Jain Bafna & Associates`. This covers ledger_name, group_name, primary_group, party_name, alternate_ledger, stock_item_name, stock_group_name, voucher_type, narration and the strings of **list-master**. On the way in, `ledgerName`, `itemName`, `group_name`, `stockGroup`, `containsFilter`, `companyName`, `targetCompany` and the names on every create / update / delete tool are accepted raw or escaped and run through the same helper before the request to Tally is built; a lookup then matches exact, then case-insensitive, then case-insensitive with whitespace collapsed. When a name is still not found, the error says whether none or several masters matched, lists up to five closest names and points to **list-master** instead of the bare *No ledger found with the given name* (feedback #31, #34)
* Tool **query-database** refused every query beginning with WITH ("Only SELECT queries are permitted") because the guard only tested whether the text started with the word SELECT, so a read-only common table expression was rejected while nothing actually stopped a data-modifying statement hidden inside one. The SQL is now parsed (pgsql-ast-parser) and accepted only when it is a single SELECT, WITH ... SELECT (including WITH RECURSIVE and several CTEs), UNION / INTERSECT / EXCEPT or VALUES with no INSERT, UPDATE, DELETE, MERGE, TRUNCATE, CREATE, ALTER, DROP, GRANT, COPY or CALL anywhere in the tree, CTE bodies included; syntax the parser does not know falls back to a keyword check on the text with comments, string literals and quoted identifiers removed. The refusal names what was refused and which check refused it (for example *statement type DELETE at position 11*). Independently of the guard, the statement now runs inside a READ ONLY transaction, so the cached tables cannot be altered or dropped even by a construct the guard did not recognise. One statement per call; a second statement after a semicolon is refused (feedback #37)
* Tool **ledger-account** could return nothing but the synthetic Opening row for a ledger which trial-balance showed as having moved, with no way to tell "no transactions" from "could not retrieve". Every statement now ends with a synthetic **Closing** row (voucher_type Closing, date = toDate, amount = the closing balance Tally reports for the period, the same figure trial-balance gives), and the response carries a reconciliation check: `reconciled` (opening + voucher amounts = closing within 0.01), `unexplainedMovement`, `openingBalance`, `closingBalance`, `voucherCount` and, when the rows do not add up, a plain `note`. A ledger under primary group Stock-in-Hand is called out explicitly: its balance is derived from stock values (the company's Integrate Accounts and Inventory setting is reported in the note) and has no vouchers or narration behind it, so the caller is pointed to stock-summary instead of hunting for an entry. The `party_name` column of the cached table, blank since v7 because the report field is named party_ledger, is now populated
* **Intermittent "Device did not respond within 60s" on ledger-account.** That message is produced by the Claude relay which forwards tool calls to this machine, not by this server: a request to Tally carried no timeout at all, so a call Tally never answered held the relay open until its 60s expired, and the caller was left unable to tell a stalled connection from a missing ledger. Every Tally call now has an overall budget of 45s (`TALLY_TIMEOUT_MS`) split into a 5s connect deadline (`TALLY_CONNECT_TIMEOUT_MS`) and the wait for the response, so this server always answers before the relay gives up. A read tool (ledger-account, trial-balance, list-master and the rest) whose connection is refused, reset or dropped before any response byte is retried inside the server up to two more times with a 0.5s then 1.5s pause; a write (create-update, delete) is retried only when the connection was never established, so a voucher can never be posted twice, and an answer from Tally such as *No ledger found* is never retried. When the budget still runs out the error names the phase which timed out (connect or response), states that the condition is transient and that an identical retry is expected to succeed. Reads share a keep-alive connection to Tally, with one request in flight per Tally instance (`TALLY_MAX_SOCKETS`), the XML templates are compiled once at start instead of on every call, and the server opens the Tally connection at start rather than on the first tool call. Every Tally call is timed (render, queue, connect, first byte, total, bytes, socket reused) along with the XML parse and the pglite insert; set `TALLY_DEBUG=1` to log every call to stderr, while calls slower than 5s (`TALLY_SLOW_MS`), retries and failures are always logged. Tool **ledger-account** and every other report also stopped hiding the real cause behind the words *Server exception* (feedback #35)

### Version: v7.7.0 [18-Sep-2026]

Added:
* **Tally port is no longer fixed at install time.** Several Tally Prime instances can run at once on different ports (say two versions of Tally, or two separate sets of companies) and the MCP client can pick which one to talk to per conversation. The `TALLY_PORT` / `TALLY_HOST` settings remain as the default connection at startup
* Tool **list-tally-instances** scanning a port range (default 9000 to 9999, with optional host, fromPort and toPort) for running Tally Prime instances. It returns every port which answered along with the companies open there, the active company and its books-from date, plus the connection currently in use and a hint on what to do next. The server instructs Claude to call it at the start of every conversation, connect automatically when exactly one Tally answers, and ask the user which port to use when several answer
* Tool **set-tally-connection** switching the Tally host and port used by every subsequent tool call, reads as well as writes, in this server process until changed again or the server restarts. The port is probed first and the change is refused, leaving the previous connection in place, if no Tally answers there. Available even when Block Write Access is on, and can be triggered any time by asking Claude to *switch to port 9001*
* Tool **server-info** now also reports `connectionSource` (default from the extension settings, or session when chosen through set-tally-connection) together with `defaultTallyHost` / `defaultTallyPort`, so it is always clear which Tally is being addressed and where the server will fall back to after a restart
* Note that Claude Desktop runs one copy of this server for the whole application, so a port chosen in one chat remains selected for later chats until it is changed again or Claude Desktop is restarted. Claude re-checks the connection at the start of each conversation and states which Tally it is talking to

### Version: v7.6.2 [21-Aug-2026]

Fixed:
* **Data corruption on re-creating an existing master.** Every master template sent ACTION="Create" unconditionally. That is a safe create-or-alter for some master types but not for all of them: for a Unit, Tally inserts a second record instead of altering the first, and the company is then left with two masters of the same name, which Tally reports as *Internal Error ... is DUPLICATED in Company*. Every master tool now reads back what Tally already holds and sends ACTION="Alter" for a master which exists and ACTION="Create" only for one which does not. The implicit Create default was removed from the templates as well, so this cannot silently come back
* Sending the same master twice inside a single request is rejected, since Tally can duplicate it for the same reason
* Modifying a master through _name which does not exist in Tally is now rejected with a clear message, instead of quietly creating a new master under the old name
* Tag ORIGINALNAME of a unit carried the new name rather than the existing one, so Tally could not match the record being renamed

### Version: v7.6.1 [21-Aug-2026]

Added:
* Tool **server-info** reporting the build version, whether write tools are exposed, the Tally host and port in use, whether Tally answered, the companies open in Tally and which one is active. An unreachable Tally and a Tally with no company loaded previously looked identical to an empty result everywhere else, which made both hard to tell apart from a genuine absence of data

Fixed:
* Tool **set-company** answered OK for a company that does not exist. The response of a Tally action was being discarded altogether, so every failure reached the caller as a silent success. The company name is now validated first, exceptions reported by Tally are raised, and the switch is confirmed by reading back the active company. Tool **set-period** likewise surfaces exceptions and validates that fromDate does not fall after toDate
* Both tools were annotated readOnlyHint true although they change global state in Tally which is shared by every other client of that instance. They are now annotated as state changing, and remain available when BLOCK_WRITE is set since reports depend on them
* Report tools answered with a blank tableID whether Tally had no company loaded or the query genuinely matched nothing. They now report rowCount along with an explanation of what an empty result can mean
* Tool **stock-item-balance** answered with an empty string for a stock item which does not exist, where every comparable tool raises an error
* Voucher balance and bill / cost centre allocation checks ran after master names were resolved against Tally. Since name resolution short circuits on the first missing name, a voucher which was both unbalanced and referred to an unknown ledger only ever reported the name. These checks cost nothing and now run first, before any round trip to Tally

### Version: v7.6 [20-Aug-2026]

Added:
* Write coverage extended to the remaining master types, so that every master which can be created from the Tally screen can now be created from the MCP client. New tools **company-create-update**, **stock-category-create-update**, **voucher-type-create-update**, **currency-create-update**, **gst-classification-create-update**, **budget-create-update** and the payroll trio **pay-head-create-update**, **employee-create-update** and **attendance-type-create-update**
* Tool **voucher-create-update** now supports **Stock Journal** and **Manufacturing Journal** through sourceEntries (consumption) and destinationEntries (production), which Tally expects as separate inventory lists and which the earlier single inventory list could not express
* Collection definition of **Currency**, **GSTClassification**, **AttendanceType**, **Employee** and **Budget**, making them queryable through query-collection and list-master

Fixed:
* Tool **list-master** offered collections (attendancetype, currency, gstclassification, gstin) which had no definition behind them and always answered *Invalid collection name*, while stockcategory was missing from the list despite being supported. The list is now derived from the collection definitions, so the two can no longer drift apart
* Version reported to the MCP client was hard-coded as 7.0.0 since v7, which made it impossible to tell from the client which build was actually running. It is now read from package.json of the deployment

### Version: v7.5 [10-Aug-2026]

Added:
* **Write-back to Tally** extended well beyond ledger creation. New tools **group-create-update**, **stock-group-create-update**, **stock-item-create-update**, **unit-create-update**, **godown-create-update**, **cost-category-create-update** and **cost-centre-create-update** cover the remaining master types, while **voucher-create-update** and **voucher-delete** allow transactions (payment, receipt, contra, journal, sales, purchase, credit note, debit note, delivery note, receipt note) to be created, altered and deleted. Voucher input supports bill wise allocation, cost centre allocation, godown and batch allocation and invoice style accounting allocation of inventory
* Tool **ledger-create-update** now accepts email, mobile number, bank details (account number / IFSC), cost centre applicability and a multi-line mailing address
* Collection definition of **CostCategory** and **CostCentre**, which makes them queryable through query-collection and list-master tools
* Add many fields into collection definition to make query-collection even more robust
* Introduced feature of blocking access to Write functionality tool as discussed in [#26](https://github.com/dhananjay1405/tally-mcp-server/issues/26) by introduction of environment variable BLOCK_WRITE
* MCP was unable to connect to tally running of PC other than local, as localhost was hard-coded in Tally Host setting. Based on suggestion for improvement in [#25](https://github.com/dhananjay1405/tally-mcp-server/issues/25) environment variable TALLY_HOST was introduced to allow setting of IP address to connect Tally running on different computer

Fixed:
* Failures reported by Tally during an import (LINEERROR / ERRORS / EXCEPTIONS inside the response envelope) were being swallowed and reported as a success with zero counts. These are now surfaced back with the exact message returned by Tally
* Tool errors were serialized using JSON.stringify on an Error instance, which produced an empty object hiding the reason of failure. Errors now carry a readable message
* GSTIN of ledger-create-update was validated against a date pattern, due to which GST registration details could never be pushed. Mailing address supplied to the same tool was silently dropped as the XML template never emitted it
* Master name supplied for renaming was not being XML escaped, breaking the request when the name carried characters like &amp;
* Names of masters referred by a voucher are validated (case-insensitively) against Tally before the write is attempted, and vouchers which do not balance or whose bill / cost centre allocations do not add up are rejected upfront with a precise message instead of being partially imported
* Environment variable BLOCK_WRITE now accepts **true** and **yes** apart from **1**, and is exposed as the *Block Write Access* switch of the Claude Desktop extension
* House-keeping task like upgrading of depedencies (node packages)
* Improvement in the documentation

### Version: v7.4 [03-Jul-2026]

Added:
* Tool delete-master introduce to delete master type collection [#14](https://github.com/dhananjay1405/tally-mcp-server/issues/14)

Fixed:
* Date was being shifted by 1 day due to UTC offset. Fixed applied addressing issue [#23](https://github.com/dhananjay1405/tally-mcp-server/issues/23)

### Version: v7.3 [31-May-2026]

Fixed:
* Tool query-collection was crashing Tally instance when the all of the fields requested did not exists in Tally, due to which bad Tally XML request was being generated, which is fixed in https://github.com/dhananjay1405/tally-mcp-server/pull/20

### Version: v7.2 [13-May-2026]

Added:
* Bundled version of Tally MCP Server for Claude Desktop i.e. Extension, for one-click installation

### Version: v7.1 [13-May-2026]

Fixed:
* Internal TDL syntax in XML request were breaking when double quote was specified in input for tools, which is now escaped properly
* Faulty handling for 0 and blank string is fixed
* In v7 tool chart-of-accounts was modified to extract only group, due to which response cycle was getting longer consuming more tokens. This behavious is reverted back to orginal
* In tool **ledger-account** field displaying alternate ledger is introduced, since party name field is found empty for journal type vouchers

### Version: v7 [12-May-2026]

Added:
* Tools **set-period** and **set-company** which can act as extra safeguard if user wants to set it as default for subsequent tool calls
* Tool **query-collection** to quickly query various fields of collection dynamically for ad-hoc information gathering [#11](https://github.com/dhananjay1405/tally-mcp-server/issues/11)
* Tools **metadata-collection** and **metadata-fields** to be used as helper functionality to gather listing of available collections and their fields for *query-collection* tool
* Tool **query-option-values** to gather listing of drop-down values from Tally for various data-entry screens [#12](https://github.com/dhananjay1405/tally-mcp-server/issues/12)
* Tool **ledger-create-update** to create or update ledger(s) on-the-fly in Tally [#7](https://github.com/dhananjay1405/tally-mcp-server/issues/7)

Fixed:
* Database of in-memory query was changed from **DuckDB** to **PgLite** for better cross-platform experience. Justification behind this change was increasing adoption of this MCP server in Mac OS [[#10](https://github.com/dhananjay1405/tally-mcp-server/issues/10)]
* Migrated many reports to use tool query-collection internally to reduce static XML templates. As a result many of XML template files are now removed in favour of internal tool call. Reports are left only for few tools which have complex TDL expression which is difficult to accommodate in query collection functionality.
* Tool usage for reports were found to be reading template file from disk for every tool call. Caching of these templates was implemented by storing minified XML of these template in key-value variables [#13](https://github.com/dhananjay1405/tally-mcp-server/issues/13)
* TSV (Tab Separated Value) format was facing issue for few AI agents, which are designed to work only with JSON output. TSV has been removed in favour of introduction of 4 output format CSV, Markdown, JSON Array of Objects, JSON Schema and Rows

### Version: v6 [11-Nov-2025]

Added:
* Introducing of DuckDB based in-memory database caching of tabular output into temporary table (which persists for 15 min), for quick and accurate aggregation, filtering, sorting, calculation (which LLM is not capable of). This feature helps to do away with context size limitation of LLM for MCP output, which often produced error or hallucination. LLM now smartly handles by using SQL query to get this done.

Fixed:
* Renaming of column names for better readability and SQL querying by MCP
* Fixed few prompt description
* Amount was coming as 0 for *ledger-account* tool for few scenario, is now fixed by relevant XML TDL expression changes
* Quantity fetched by *stock-item-balance* tool was in absolute number ignoring negative balance scenario, is fixed by applying changes to XML
* Debit / Credit total in *trial-balance* tool was suppose to be positive for net Debit or net Credit respetively, is now fixed by applying changes on XML

### Version: v5 [06-Nov-2025]

Added:
* Stock Item Account tool

Fixed:
* ledger-account tool was ignoring Debit / Credit sign for opening balance. XML was fixed to prefix Dr / Cr sign


### Version: v4 [30-Oct-2025]

Added:
* Ease of configuration of setting via **.env** file instead of environment variables
* Balance Sheet and Profit Loss tools

Fixed:
* Ability to fetch from specific targetCompany was not working, which is now fixed
* ledger-account tool was skipping vouchers for some scenario. XML was fixed to query it and optimize it further as per Tally Solution TDL blog for best practise
* Unnecessary XML files used during initial development phase were removed


### Version: v3 [09-Oct-2025]

Added:
* Tool **chart-of-accounts** to grab group hierarchy structure
* Tool **stock-summary** to pull summary of all stock items with opening / inward / outward / closing values of quantity and amount

Fixed:
* Revamped MCP code to enhance connectivity with ChatGPT
* Minor fixes in Tally XML handling
* Tool **ledger-account** was skipping opening balance, which is not added into it
* Converted output of all the possible tools to tab separated format for optimization and light-weight response


### Version: v2 [04-Oct-2025]

Added:
* Tool **ledger-account** to grab ledger account
* Support for **ChatGPT** platform remote MCP

Fixed:
* oAuth implementation was revamped to adhere better to specification 2.1. These fixes allowed ChatGPT connectivity.
* Tabular response format was changed from JSON (which is heavy) to tab-separated for optimization. This allowed fitting of more data in response context.
* CLIENT_SECRET term was mistakenly used in entire code base, which was renamed as PASSWORD which is precise description of it.


### Version: v1 [02-Sep-2025]

Added:
* Entire implementation of Local &amp; Remote MCP