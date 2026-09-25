# Tally Prime MCP Server
Tally Prime MCP (Model Context Protocol) Server implementation to feed Tally Prime ERP data to popular LLM like Claude, ChatGPT supporting MCP client. This MCP Server helps expose functionalities of Tally to LLM directly.


## Prerequisites
* Tally Prime (Silver / Gold)
* Node JS

Ensure below things are pre-installed and setup:
* Ensure to [download & install Node JS](https://nodejs.org/en) from official website
* XML Port of Tally Prime must be enabled (F1 &gt; Settings &gt; Connectivity &gt; Client/Server configuration) with below settings
```
TallyPrime acts as = Server
Port = 9000
```

Running several Tally Prime instances at once (say different versions or different sets of companies) on different ports is supported, they are discovered automatically at the start of each conversation, see [Multiple Tally instances](#multiple-tally-instances) below.

*Note: Kindly avoid using Educational version of Tally Prime, which has limitations of date range. It will result in invalid / partial data being fed to LLM, leading to highly degraded &amp; incorrect responses.*

## Download
Avoid cloning repository directly. Utility is available for download (with required dependencies) on below link <br>
[https://excelkida.com/resource/tally-mcp-server-v7.9.2.zip](https://excelkida.com/resource/tally-mcp-server-v7.9.2.zip)

One-click installer **extension** for **Claude Desktop**<br>
[https://excelkida.com/resource/tally-mcp-server-v7.9.2.mcpb](https://excelkida.com/resource/tally-mcp-server-v7.9.2.mcpb)

Last updated: version **7.9.2** [25/09/2026]

Refer docs/CHANGELOG.md for details

## Supported Platform
Implementation was tested on below AI platform

|Platform|Local|Remote|
|--|--|--|
|Claude AI| :heavy_check_mark: | :heavy_check_mark: |
|ChatGPT|| :heavy_check_mark: |
|Grok|| :heavy_check_mark: |


## Setup (Local)
This mode of setup is to be used when MCP Client (like Claude Desktop, Perplexity etc.) and Tally Prime both exists in local PC. MCP Client software itself runs the MCP Server internally in such scenario.

Simply download &amp; extract zip file somewhere on the disk.  Assuming that we downloaded &amp; extracted zip file on below path (folder)
```
D:\Software\Tally MCP Server
```

<image src="https://excelkida.com/image/github/explorer-tally-mcp-server.png" height="265" width="766" />

A sample setup for few popular tools is demonstrated.

### Claude Desktop
Desktop version of Claude AI supports loading of local MCP server. Ensure you have Pro / Team / Max / Enterprise subscription of Claude, which supports higher limit compared to Free. MCP makes multiple calls to Tally for validation and inference, which might exhaust free limits quickly. Download Claude Desktop from following link
[claude.ai/download](https://claude.ai/download)

#### One-click installation (via Extension)

Go to menu &gt; File &gt; Settings

<image src="https://excelkida.com/image/github/claude-desktop-settings-menu.png" height="185" width="335">

Extensions &gt; Advance Settings

<image src="https://excelkida.com/image/github/claude-desktop-settings-extension.png" height="553" width="928">

Click on install extension button

<image src="https://excelkida.com/image/github/claude-desktop-extension-page.png" height="619" width="868">

Browse the extension file (with file extension mcpb) download at the start

<image src="https://excelkida.com/image/github/claude-desktop-extension-install.png" height="843" width="696">

A dialog window will appear asking *Do you want to install Tally Prime?* click **Install** button, which would install the Tally MCP Server

#### Installation via Config file (via Developer menu)

Go to menu &gt; File &gt; Settings &gt; Developer

<image src="https://excelkida.com/image/github/claude-desktop-developer-setting.png" height="751" width="1045" />

This will open My Computer window. Right click and edit **claude_desktop_config.json** file (via Notepad) with as below JSON
```json
{
  "mcpServers": {
	  "Tally Prime": {
		  "command": "node",
		  "args": ["D:\\Software\\Tally MCP Server\\dist\\index.mjs"]
	  }
  }
}
```
*Note: single slash in folder path needs to be substituted with double slash*

Save the file. Close Claude Desktop (menu &gt; File &gt; Exit) and again re-launch it.

Verify by clicking on Tools button and check if Tally Prime appears in the list (screenshot below)

<image src="https://excelkida.com/image/github/claude-desktop-tally-mcp-server-tool-display.png" height="595" width="722" />

### Perplexity Desktop
Perplexity Desktop version for MacOS supports connecting to local MCP server. Configuration file (JSON format) is same as demonstrated for Claude Desktop. In absense of MacBook, documentation with screenshot could not be written. Kindly refer to below blog on perplexity website, which explains the steps.

[Perplexity Desktop MCP Connectivity](https://www.perplexity.ai/help-center/en/articles/11502712-local-and-remote-mcps-for-perplexity)

## Setup (Cloud)
This mode of setup is to be used, when using browser-based MCP client like ChatGPT, Claude AI, Copilot, OR mobile-based app for these LLM which cannot access Tally Prime running inside local PC. In this scenario, MCP Server needs to run as web-server, internally connected to Tally securely. Setup is quite complicated, and is covered in detail in **docs** folder of this project.
* [Linux-based Server](docs/server-setup-linux.md)
* Windows Server (exploration in-progress)

## Multiple Tally instances

The port set at install time (`TALLY_PORT`, default **9000**) is only the starting point. If more than one Tally Prime is running on the PC, for example two versions of Tally or two separate sets of companies, each on its own XML port, Claude finds them on its own and you simply tell it which one to use.

From your side the flow looks like this:
1. Start a new chat. Claude scans the ports (9000 to 9999 by default) for running Tally Prime instances.
1. If exactly one Tally answers, Claude connects to it straight away and carries on.
1. If several answer, Claude lists them along with the companies open in each and asks which port to use. Reply with the port (for example *use 9001*).
1. Everything after that, reports as well as any creation or alteration of masters and vouchers, goes to that Tally until you change it.

You can switch at any moment by saying something like *switch to port 9001*. Claude checks that a Tally really answers on that port before switching, so a typo cannot silently send your data to nowhere.

One thing to be aware of: the port chosen is shared by every chat and survives the server being relaunched (Claude Desktop relaunches extensions on start-up, on reload and whenever one stops). It is kept in a small state file in the `.tally-mcp-server` folder of your user profile, so a port chosen in one chat stays selected for later chats until it is changed again, and lapses back to the default only after 12 hours without use (`TALLY_CONNECTION_TTL_HOURS`). Claude re-checks the connection at the start of every conversation, so it will tell you which Tally it is talking to before doing anything else. The **server-info** tool reports it as well.

## Available Tools

This server currently exposes 40 MCP tools. Tools that write back into Tally Prime (create / update / delete of masters and vouchers) can be hidden altogether via the `BLOCK_WRITE` setting described under Environment Variables.

**The company is never implicit.** Every tool that reads or writes company data takes a **mandatory** `targetCompany`, which must name one of the companies open in Tally exactly as `server-info` lists them. A call that leaves it out, or names a company that is not open, is refused with the list of open companies; the company Tally happens to have in focus is never used as a default. Every such response carries a `company` property naming the company it was served from, and every cached table carries a `company` column on each row, so a figure can always be tied back to its company. The former `set-company` tool was removed in v7.8.0, since Tally did not reliably honour the switch for later requests.

### server-info
Reports the build and connectivity state of this server, including the exact names of the companies open in Tally which every data and write tool needs as `targetCompany`. Call it first whenever a tool returns no data or behaves unexpectedly — an unreachable Tally and a Tally with no company loaded both look like an empty result everywhere else.

**Input**
No input.

**Output**
JSON containing:
1. `version` — build of the MCP server that is actually running
1. `writeToolsEnabled` — false when `BLOCK_WRITE` is set
1. `tallyHost` / `tallyPort` — where this server is trying to reach Tally
1. `connectionSource` — `default` when the host and port come from the extension settings / environment, `session` when they were chosen through `set-tally-connection`
1. `connectionPersisted` / `connectionStateFile` — whether the session choice is stored in the state file which every relaunch of the server reads, and where that file is
1. `processId` / `processUptimeSeconds` — which server process answered and for how long it has been running, so a relaunch is visible
1. `defaultTallyHost` / `defaultTallyPort` — the installed default, used until `set-tally-connection` is called and again once the session choice lapses
1. `tallyReachable` — whether Tally answered at all
1. `companies` — companies open in Tally
1. `activeCompany` and `booksFrom` — the current company context
1. `diagnosis` — plain-language reading of the above, and what to do about it

### list-tally-instances
Scans a range of ports for running Tally Prime instances, so that the right one can be picked when several are running at once. Claude calls it at the start of every conversation: it connects automatically when exactly one Tally answers, and asks which port to use when several answer.

**Input**
|Argument|Description|
|--|--|
|host (optional)|Host name or IP to scan (defaults to the current Tally host)|
|fromPort (optional)|First port of the range (default **9000**)|
|toPort (optional)|Last port of the range (default **9999**)|

**Output**
JSON containing:
1. `instances` — one entry per port on which a Tally Prime answered, each with `port`, `companies` open there, `activeCompany` and `booksFrom`
1. `current` — the host and port every tool call currently goes to
1. `hint` — what to do next: connect, ask the user to choose, or start Tally / enable its XML port

### set-tally-connection
Switches the Tally host and port used by every subsequent tool call (reads as well as writes) until it is changed again. The choice is persisted, so it survives the server being relaunched, and lapses to the default after 12 hours without use; `server-info` reports `connectionSource` = `session` meanwhile. The port is probed first; if no Tally answers there the change is refused and the previous connection stays in place. Available even when `BLOCK_WRITE` is set.

**Input**
|Argument|Description|
|--|--|
|port|Port of the Tally XML server to switch to (1 to 65535)|
|host (optional)|Host name or IP of the Tally XML server (defaults to the current Tally host)|

**Output**
JSON containing the host and port now in use, `connectionSource` set to `session`, and the companies open on that Tally with the active one.

### metadata-collection
Returns metadata for supported collections.

**Input**
No input.

**Output**
JSON array with objects containing:
1. `collection`
1. `description`

### query-option-values
Returns predefined option values used by input fields.

**Input**
|Argument|Description|
|--|--|
|optionName|Supported: `country-state`|

**Output**
JSON array of option values for the selected option name.

### metadata-fields
Returns field metadata for a selected collection.

**Input**
|Argument|Description|
|--|--|
|collection|Collection name. Use `metadata-collection` to discover valid values|

**Output**
JSON array of field metadata containing field name, description (if any), and normalized datatype (`string`, `number`, `date`, `boolean`).

### query-database
Runs SQL query on in-memory pglite tables previously created by reporting tools.

**Input**
|Argument|Description|
|--|--|
|sql|SELECT query only|
|outputFormat|One of `JSON Array of Objects`, `JSON with Schema and Rows`, `CSV`, `Markdown Table`. Default is JSON Array of Objects which is preferred format|

**Output**
Query result in tab-separated text format.

### query-collection
Queries a Tally collection for selected fields and caches output in an in-memory table.

**Input**
|Argument|Description|
|--|--|
|collection|Collection name|
|fields|Array of field names to fetch|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|
|fromDate (optional)|Date in YYYY-MM-DD|
|toDate (optional)|Date in YYYY-MM-DD|

**Output**
JSON: `{ "tableID": "...", "rowCount": n, "company": "..." }` (the table also carries a `company` column on every row)

### list-master
Fetches list of masters for validation and auto-completion.

**Input**
|Argument|Description|
|--|--|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|
|collection|One of: `group`, `ledger`, `vouchertype`, `unit`, `godown`, `stockgroup`, `stockitem`, `costcategory`, `costcentre`, `attendancetype`, `company`, `currency`, `gstin`, `gstclassification`|
|containsFilter (optional)|filter to apply CONTAINS operation to restrict values|

**Output**
JSON: `{ "list": [ ... ], "company": "..." }`

### chart-of-accounts
Extracts Chart of Accounts (or Group hierarchy) useful for preparing Balance Sheet, Profit and Loss, Trial Balance

**Input**
|Argument|Description|
|--|--|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|

**Output**
JSON: `{ "tableID": "...", "rowCount": n, "company": "..." }` (the table also carries a `company` column on every row) with columns:
1. `ledger_name`
1. `group_name`
1. `primary_group`
1. `bs_pl` (boolean) [**true** = Profit &amp; Loss  / **false** = Balance Sheet]
1. `dr_cr` (boolean) [**true** = Debit / **false** = Credit]
1. `affects_gross_profit` (boolean) [**true** = Affects Gross Profit / **false** = Does not affect Gross Profit]
1. `sort_position` (number)

### trial-balance
Fetches trial balance for period.

**Input**
|Argument|Description|
|--|--|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|
|fromDate|Date in YYYY-MM-DD|
|toDate|Date in YYYY-MM-DD|
|group_name (optional)|Filter by group name|

**Output**
JSON: `{ "tableID": "...", "rowCount": n, "company": "..." }` (the table also carries a `company` column on every row) with columns:
1. `ledger_name`
1. `group_name`
1. `opening_balance` (number) [**negative** = Debit / **positive** = Credit]
1. `net_debit`
1. `net_credit`
1. `closing_balance` (number) [**negative** = Debit / **positive** = Credit]

### profit-loss
Fetches profit and loss data for period.

**Input**
|Argument|Description|
|--|--|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|
|fromDate|Date in YYYY-MM-DD|
|toDate|Date in YYYY-MM-DD|

**Output**
JSON: `{ "tableID": "...", "rowCount": n, "company": "..." }` (the table also carries a `company` column on every row) with columns:
1. `ledger_name`
1. `group_name`
1. `closing_balance` (number) [**negative** = Debit / **positive** = Credit]

### balance-sheet
Fetches balance sheet data for period.

**Input**
|Argument|Description|
|--|--|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|
|fromDate|Date in YYYY-MM-DD|
|toDate|Date in YYYY-MM-DD|

**Output**
JSON: `{ "tableID": "...", "rowCount": n, "company": "..." }` (the table also carries a `company` column on every row) with columns:
1. `ledger_name`
1. `group_name`
1. `closing_balance` (number) [**negative** = Debit / **positive** = Credit]

### stock-summary
Fetches stock item summary for period.

**Input**
|Argument|Description|
|--|--|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|
|fromDate|Date in YYYY-MM-DD|
|toDate|Date in YYYY-MM-DD|
|stockGroup (optional)|Filter by stock group name|

**Output**
JSON: `{ "tableID": "...", "rowCount": n, "company": "..." }` (the table also carries a `company` column on every row) with columns:
1. `stock_item_name`
1. `stock_group_name`
1. `opening_quantity` (number)
1. `opening_value` (number) [**negative** = Debit / **positive** = Credit]
1. `inward_quantity` (number)
1. `inward_value` (number)
1. `outward_quantity` (number)
1. `outward_value` (number)
1. `closing_quantity` (number)
1. `closing_value` (number) [**negative** = Debit / **positive** = Credit]

### ledger-balance
Returns ledger closing balance as on date.

**Input**
|Argument|Description|
|--|--|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|
|ledgerName|Exact ledger name|
|toDate|Date in YYYY-MM-DD|

**Output**
JSON: `{ "amount": number, "company": "..." }` where negative = Debit and positive = Credit.

### stock-item-balance
Returns stock item closing quantity as on date.

**Input**
|Argument|Description|
|--|--|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|
|itemName|Exact stock item name|
|toDate|Date in YYYY-MM-DD|

**Output**
JSON: `{ "quantity": number, "unit_of_measurement": string, "company": "..." }` when found.

### bills-outstanding
Fetches receivable/payable bill-wise outstanding as on date.

**Input**
|Argument|Description|
|--|--|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|
|nature|`receivable` or `payable`|
|toDate|Date in YYYY-MM-DD|

**Output**
JSON: `{ "tableID": "...", "rowCount": n, "company": "..." }` (the table also carries a `company` column on every row) with columns:
1. `bill_date`
1. `reference_number`
1. `outstanding_amount`
1. `party_name`
1. `overdue_days`

### ledger-account
Fetches ledger account statement for period.

**Input**
|Argument|Description|
|--|--|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|
|ledgerName|Ledger name|
|fromDate|Date in YYYY-MM-DD|
|toDate|Date in YYYY-MM-DD|

**Output**
JSON: `{ "tableID": "...", "rowCount": n, "company": "..." }` (the table also carries a `company` column on every row) with columns:
1. `guid`
1. `date`
1. `voucher_type`
1. `voucher_number`
1. `alternate_ledger`
1. `party_name`
1. `amount` (number) [**negative** = Debit / **positive** = Credit]
1. `narration`

A period longer than three months is fetched one calendar month at a time and joined into one statement; the response then also carries `chunked`, `chunkCount`, `ledgerNature`, `chunkContinuity` and `chunks` (per-month balances). A Balance Sheet ledger's months must chain (each month's closing equals the next month's opening). A Profit & Loss ledger is restarted at 0 by Tally for every period after the start of the financial year, so its months are added up as a running sum instead (`chunkContinuity` = `not_applicable_nominal`, closing = first month's opening + every voucher) and checked once against Tally's own closing for the whole period (`runningClosingBalance`, `wholePeriodClosingBalance`, `wholePeriodCheck` = matched / mismatch / not_done). When Tally does not deliver in time the tool returns an error object instead of an empty statement:
`{ "code": "TALLY_TIMEOUT", "reason": "timeout", "elapsedMs": 45012, "period": { "fromDate": "2025-04-01", "toDate": "2026-03-31" }, "hint": "split the period", "suggestedPeriods": [...], "message": "..." }`. `reason` is one of timeout, connect-timeout, reset, aborted, empty-response, truncated-response. Every other report tool answers a Tally transport failure with the same object

### stock-item-account
Fetches stock item account statement for period.

**Input**
|Argument|Description|
|--|--|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|
|itemName|Stock item name|
|fromDate|Date in YYYY-MM-DD|
|toDate|Date in YYYY-MM-DD|

**Output**
JSON: `{ "tableID": "...", "rowCount": n, "company": "..." }` (the table also carries a `company` column on every row) with columns:
1. `date`
1. `voucher_type`
1. `voucher_number`
1. `party_ledger`
1. `quantity`
1. `amount` (number) [**negative** = Debit / **positive** = Credit]
1. `narration`
1. `tracking_number`
1. `voucher_category`

### ledger-create-update
Creates or updates one or more ledger.

**Note: This tool has ability to modify existing ledger. Always backup your Company before instructing this tool.**

**Input**
|Argument|Description|
|--|--|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|
|masters|Array of ledger master objects to create/update|

Master ledger object accepts following

|Property|Description|
|--|--|
|name|Ledger name or New Ledger name (during update)|
|_name|Existing ledger name|
|parent|Group under which ledger would exists|
|openingBalance|(optional) Opening Balance of the Ledger|
|isBillWise|(optional) flag to set Bill-by-Bill referencing|
|billCreditPeriod|(optional) Credit Period for bill in days|
|isCostCentre|(optional) flag to enable cost centre allocation while passing vouchers with this ledger|
|email|(optional) Email address of the ledger|
|mobileNumber|(optional) Contact or mobile number of the ledger|
|bankDetails|(optional) Bank details containing `accountNumber`, `ifscCode`, `bankName` and `accountHolderName`|
|mailingDetails|(optional) Business Name for mailing purpose, country, state, pincode and `address` (array of address lines)|
|gstRegistrationDetails|(optional) GST registration details like GST Number, Registration Type, Place of Supply (state)|

**Output**
JSON result returned by import operation (success/failure details) with the `company` written to.

### delete-master
Delete one (or more) masters from Tally

**Input**
|Argument|Description|
|--|--|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|
|collection|Type of master or collection to delete. One of: `group`, `ledger`, `vouchertype`, `unit`, `godown`, `stockgroup`, `stockitem`, `costcategory`, `costcentre`, `attendancetype`, `company`, `currency`, `gstin`, `gstclassification` |
|name|array of name(s) of master to be deleted|

**Output**
JSON result returned by delete operation (count of deleted, skipped, etc) with the `company` written to.

### group-create-update
Create or update accounting group(s), i.e. the chart of accounts node under which ledgers are nested.

**Input**
|Argument|Description|
|--|--|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|
|masters|Array of group objects|

Every object of `masters` supports:
|Property|Description|
|--|--|
|name|Group name, or the new name when renaming|
|_name (optional)|Existing group name to modify / rename|
|parent (optional)|Parent group name. Skip it to create a primary group|
|isSubLedger (optional)|Group behaves like a sub-ledger|
|isNettBalance (optional)|Nett debit / credit balances of the group while reporting|
|isCostCentre (optional)|Cost centres applicable for ledgers of this group|

**Output**
JSON result returned by import operation (count of created / altered records) with the `company` written to.

### stock-group-create-update
Create or update stock group(s) under which stock items are nested.

**Input**
|Argument|Description|
|--|--|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|
|masters|Array of stock group objects with properties `name`, `_name` (optional), `parent` (optional), `isQuantityAddable` (optional)|

**Output**
JSON result returned by import operation (count of created / altered records) with the `company` written to.

### unit-create-update
Create or update unit(s) of measurement. Supports a simple unit (like `Nos`, `Kgs`) and a compound unit (like `Box of 12 Nos`).

**Input**
|Argument|Description|
|--|--|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|
|masters|Array of unit objects|

Every object of `masters` supports:
|Property|Description|
|--|--|
|name|Symbol of the unit like `Nos`, `Kgs`. Tally derives the name of a compound unit on its own|
|_name (optional)|Existing unit name to modify / rename|
|formalName (optional)|Full name of a simple unit like `Numbers` for `Nos`|
|decimalPlaces (optional)|Decimal places allowed for quantity of a simple unit (0 to 4)|
|baseUnit / additionalUnit / conversion|Specify all 3 together to create a compound unit. `conversion` is the count of base units in one additional unit|

**Output**
JSON result returned by import operation (count of created / altered records) with the `company` written to.

### godown-create-update
Create or update godown(s) or warehouse(s) where stock is stored.

**Input**
|Argument|Description|
|--|--|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|
|masters|Array of godown objects with properties `name`, `_name` (optional), `parent` (optional), `address` (optional array of address lines), `isExternal` (optional)|

**Output**
JSON result returned by import operation (count of created / altered records) with the `company` written to.

### cost-category-create-update
Create or update cost category(ies) used to group cost centres for parallel allocation.

**Input**
|Argument|Description|
|--|--|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|
|masters|Array of cost category objects with properties `name`, `_name` (optional), `allocateRevenue` (optional), `allocateNonRevenue` (optional)|

**Output**
JSON result returned by import operation (count of created / altered records) with the `company` written to.

### cost-centre-create-update
Create or update cost centre(s) or profit centre(s) used to track income and expenses of a department, branch, project or employee.

**Input**
|Argument|Description|
|--|--|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|
|masters|Array of cost centre objects with properties `name`, `_name` (optional), `category` (optional, default `Primary Cost Category`), `parent` (optional)|

**Output**
JSON result returned by import operation (count of created / altered records) with the `company` written to.

### stock-item-create-update
Create or update stock item(s), i.e. the product or material forming part of inventory.

**Input**
|Argument|Description|
|--|--|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|
|masters|Array of stock item objects|

Every object of `masters` supports:
|Property|Description|
|--|--|
|name|Stock item name, or the new name when renaming|
|_name (optional)|Existing stock item name to modify / rename|
|parent (optional)|Stock group under which the item is nested|
|category (optional)|Stock category. Blank value resets it to Not Applicable|
|unit (optional)|Base unit of measurement|
|alternateUnit / conversion (optional)|Alternate unit and the count of base units contained in it|
|description (optional)|Description or remarks|
|costingMethod (optional)|Method of valuation of stock like `Avg. Cost`, `FIFO`, `Std. Cost`|
|isBatchWise (optional)|Maintain the item batch wise|
|openingQuantity / openingRate / openingValue (optional)|Opening stock as on books begin date|
|gstDetails (optional)|`hsnCode`, `hsnDescription`, `typeOfSupply` (`Goods` / `Services`), `taxability` (`Taxable` / `Exempt` / `Nil Rated`) and `rate` (total GST rate, split internally into CGST, SGST and IGST)|

**Output**
JSON result returned by import operation (count of created / altered records) with the `company` written to.

### voucher-create-update
Create accounting and / or inventory vouchers (transactions like Payment, Receipt, Contra, Journal, Sales, Purchase, Credit Note, Debit Note, Delivery Note, Receipt Note, Stock Journal), or update an existing voucher when its `guid` is supplied.

Sign convention followed across the whole tool is **debit is negative and credit is positive**, and the sum of all amounts of a voucher must be **0**. Quantity is always an absolute positive number, since inward or outward movement is derived by Tally from the voucher type. Ledger, voucher type and stock item names are validated against Tally before the voucher is pushed, so a typo is reported back instead of being partially imported.

**Input**
|Argument|Description|
|--|--|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|
|vouchers|Array of voucher objects|

Every object of `vouchers` supports:
|Property|Description|
|--|--|
|guid (optional)|Guid of an existing voucher to update it (available in the output of `ledger-account`). Skip it to create a new voucher. On update the voucher is fully replaced by the supplied content|
|date|Voucher date in YYYY-MM-DD|
|voucherType|Voucher type name. Validate it using `list-master` with collection as `vouchertype`|
|voucherNumber (optional)|Skip it to let Tally auto-number the voucher|
|reference / referenceDate (optional)|Reference like a purchase order or supplier invoice number and its date|
|partyLedgerName (optional)|Party ledger of the voucher|
|narration (optional)|Narration or remarks|
|objectView (optional)|One of `Accounting Voucher View`, `Invoice Voucher View`, `Inventory Voucher View`. Derived automatically when skipped|
|ledgerEntries|Accounting entries. Empty array only for a pure inventory voucher like Delivery Note or Stock Journal|
|inventoryEntries (optional)|Inventory entries for an inventory affecting voucher type. Not used by a Stock Journal|
|sourceEntries (optional)|Consumption side of a Stock Journal / Manufacturing Journal, i.e. stock consumed or transferred out (amount positive)|
|destinationEntries (optional)|Production side of a Stock Journal / Manufacturing Journal, i.e. stock produced or transferred in (amount negative)|

Every object of `ledgerEntries` supports:
|Property|Description|
|--|--|
|ledgerName|Ledger name of the entry|
|amount|Debit is negative and credit is positive|
|billAllocations (optional)|Array of `name`, `billType` (`New Ref`, `Agst Ref`, `Advance`, `On Account`), `amount` and optional `creditPeriod`. Mandatory for a ledger on which bill wise details is enabled. Total must match the amount of the ledger entry|
|costCentreAllocations (optional)|Array of `costCategory` (optional), `costCentre` and `amount`. Total must match the amount of the ledger entry|

Every object of `inventoryEntries` supports:
|Property|Description|
|--|--|
|stockItemName|Stock item name|
|quantity|Absolute positive quantity|
|rate (optional)|Rate per unit|
|unit (optional)|Unit of measurement of quantity and rate|
|amount|Value of the entry. Debit is negative (inward) and credit is positive (outward)|
|godownName (optional)|Godown from / into which stock moves|
|batchName (optional)|Batch name for a batch wise stock item|
|accountingLedger (optional)|Sales / purchase / stock adjustment ledger to which the value is posted. Mandatory for an invoice like Sales or Purchase|

**Output**
JSON result returned by import operation (count of created / altered records) with the `company` written to.

### voucher-delete
Delete one (or more) vouchers from Tally permanently. This operation cannot be undone.

**Input**
|Argument|Description|
|--|--|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|
|vouchers|Array of objects containing `guid`, `date`, `voucherType` and optional `voucherNumber`. All of these are available in the output of `ledger-account` tool|

**Output**
JSON result returned by delete operation (count of deleted records) with the `company` written to.

### company-create-update
Create a new company, or update details of an existing one.

*Note: company creation over the XML interface depends on the Tally Prime edition and its security settings. If Tally rejects it, create the company from the Tally screen (Company &gt; Create) and use this tool to update it thereafter.*

**Input**
|Argument|Description|
|--|--|
|masters|Array of company objects|

Every object of `masters` supports:
|Property|Description|
|--|--|
|name|Company name, or the new name when renaming|
|_name (optional)|Existing company name to modify / rename|
|mailingName (optional)|Name used for mailing and printing|
|address (optional)|Array of address lines|
|country / state|Validate using `query-option-values` with `country-state`|
|pincode / phoneNumber / email (optional)|Contact details|
|booksFrom|Books beginning date in YYYY-MM-DD, which also sets the financial year start|
|isInventory (optional)|Maintain accounts with inventory|
|currencySymbol / currencyFormalName (optional)|Base currency. Both must be supplied together|
|gstin / incomeTaxNumber (optional)|GST number and PAN of the company|

**Output**
JSON result returned by import operation (count of created / altered records) with the `company` written to.

### stock-category-create-update
Create or update stock category(ies), the parallel classification of stock items that cuts across stock groups.

**Input**
|Argument|Description|
|--|--|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|
|masters|Array of objects with properties `name`, `_name` (optional), `parent` (optional)|

**Output**
JSON result returned by import operation (count of created / altered records) with the `company` written to.

### voucher-type-create-update
Create or update voucher type(s). Every voucher type is derived from one of the predefined types.

**Input**
|Argument|Description|
|--|--|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|
|masters|Array of voucher type objects|

Every object of `masters` supports:
|Property|Description|
|--|--|
|name|Voucher type name, or the new name when renaming|
|_name (optional)|Existing voucher type name to modify / rename|
|parent|Predefined voucher type it derives from, e.g. `Sales`, `Payment`, `Stock Journal`|
|numberingMethod (optional)|`Automatic`, `Automatic (Manual Override)`, `Manual`, `Multi-User Auto`|
|isOptional / affectsStock / preventDuplicates (optional)|Behaviour flags|
|useCommonNarration / narrationsAtLineLevel / printAfterSave (optional)|Behaviour flags|
|prefix (optional)|Prefix applied to the voucher number like `INV/`|

**Output**
JSON result returned by import operation (count of created / altered records) with the `company` written to.

### currency-create-update
Create or update currency(ies) used for recording foreign currency transactions.

**Input**
|Argument|Description|
|--|--|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|
|masters|Array of currency objects|

Every object of `masters` supports:
|Property|Description|
|--|--|
|name|Currency symbol like `$`, which is the identity of a currency in Tally|
|_name (optional)|Existing currency symbol to modify / rename|
|formalName (optional)|Formal name like `US Dollar`|
|expandedSymbol (optional)|Symbol in words used while printing amount in words|
|decimalSymbol (optional)|Name of the decimal portion like `Cents`|
|decimalPlaces (optional)|0 to 4, default 2|
|isSymbolSuffixed / hasSpaceBetweenAmount / showInMillions (optional)|Presentation flags|

**Output**
JSON result returned by import operation (count of created / altered records) with the `company` written to.

### gst-classification-create-update
Create or update GST classification(s), a reusable set of HSN / SAC and GST rate details applicable to many stock items and ledgers at once.

**Input**
|Argument|Description|
|--|--|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|
|masters|Array of objects with `name`, `_name` (optional), `hsnCode` (optional), `hsnDescription` (optional), `typeOfSupply` (optional), `taxability` (optional) and `rate` (total GST rate, split internally into CGST, SGST and IGST)|

**Output**
JSON result returned by import operation (count of created / altered records) with the `company` written to.

### budget-create-update
Create or update budget(s) for a period, with closing balance targets against groups, ledgers and cost centres. Debit is negative and credit is positive, so an expense target is a negative amount. At least one of the three target arrays must be supplied.

**Input**
|Argument|Description|
|--|--|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|
|masters|Array of budget objects|

Every object of `masters` supports:
|Property|Description|
|--|--|
|name|Budget name, or the new name when renaming|
|_name (optional)|Existing budget name to modify / rename|
|parent (optional)|Parent budget under which this budget is nested|
|fromDate / toDate|Budget period in YYYY-MM-DD|
|groupBudgets (optional)|Array of `name`, `amount` and optional `isNettBalance`|
|ledgerBudgets (optional)|Array of `name` and `amount`|
|costCentreBudgets (optional)|Array of `name` and `amount`|

**Output**
JSON result returned by import operation (count of created / altered records) with the `company` written to.

### pay-head-create-update
Create or update payroll pay head(s), the earning, deduction or contribution components used while processing salary. A pay head is internally a ledger, so it also shows up in `list-master` with collection as `ledger`.

**Input**
|Argument|Description|
|--|--|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|
|masters|Array of pay head objects|

Every object of `masters` supports:
|Property|Description|
|--|--|
|name|Pay head name, or the new name when renaming|
|_name (optional)|Existing pay head name to modify / rename|
|parent|Group under which the pay head is nested|
|payHeadType|Nature of the pay head, e.g. `Earnings for Employees`, `Deductions from Employees`, `Bonus`, `Gratuity`|
|isDebit|`true` when the pay head is an expense to the company, `false` when it is a liability|
|payslipName (optional)|Name printed on the payslip|
|calculationType (optional)|`On Attendance`, `As Computed Value`, `Flat Rate`, `On Production`, `As User Defined Value`|
|calculationPeriod (optional)|`Days`, `Weeks`, `Months`, `Fortnights`|
|attendanceType (optional)|Attendance or production type it is calculated on|
|appropriateFor (optional)|Statutory pay type this pay head is appropriated for|
|roundingMethod / roundingLimit (optional)|Rounding applied on the computed amount|
|isBillWise (optional)|Maintain bill wise details, typically for loans and advances|

**Output**
JSON result returned by import operation (count of created / altered records) with the `company` written to.

### employee-create-update
Create or update payroll employee(s) or employee group(s). Tally stores an employee as a cost centre flagged for payroll, so employees also show up in `list-master` with collection as `costcentre`.

**Input**
|Argument|Description|
|--|--|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|
|masters|Array of employee objects|

Every object of `masters` supports:
|Property|Description|
|--|--|
|name|Employee or employee group name, or the new name when renaming|
|_name (optional)|Existing employee name to modify / rename|
|isGroup (optional)|`true` creates an employee group instead of an employee|
|category (optional)|Cost category, default `Primary Cost Category`|
|parent (optional)|Employee group under which the employee is nested|
|dateOfJoining|Mandatory for an employee, in YYYY-MM-DD|
|dateOfRelease (optional)|Date of resignation or release|
|employeeNumber / designation / functionName / location (optional)|Employment details|
|gender / dateOfBirth / mobileNumber / email / panNumber (optional)|Personal details|
|bankDetails (optional)|`bankName`, `accountNumber` and `ifscCode` used for salary payment|

**Output**
JSON result returned by import operation (count of created / altered records) with the `company` written to.

### attendance-type-create-update
Create or update payroll attendance, leave or production type(s) like Present, Absent, Overtime or Piece Production.

**Input**
|Argument|Description|
|--|--|
|targetCompany|Company name, **mandatory** on every call, exactly as listed by `server-info`. A call without it, or naming a company not open in Tally, is refused with the list of open companies|
|masters|Array of attendance type objects|

Every object of `masters` supports:
|Property|Description|
|--|--|
|name|Attendance type name, or the new name when renaming|
|_name (optional)|Existing attendance type name to modify / rename|
|parent (optional)|Parent attendance type under which this one is nested|
|attendanceType|`Attendance/Leave with Pay`, `Leave without Pay` or `User Defined`|
|period (optional)|`Days`, `Weeks`, `Months`, `Fortnights`. Not applicable for `User Defined`|
|productionType / unit|Both mandatory when `attendanceType` is `User Defined`|

**Output**
JSON result returned by import operation (count of created / altered records) with the `company` written to.

### set-period
Sets active reporting period context in Tally Prime.

**Input**
|Argument|Description|
|--|--|
|fromDate|Start date in YYYY-MM-DD|
|toDate|End date in YYYY-MM-DD|

**Output**
JSON string: `"OK"` on success.

## Environment Variables

End-users are free to hard-code few settings which needs to be applied

|Variable|Description|
|--|--|
|TALLY_PORT|Port Number of XML Server of Tally used as the default connection when the server starts (*optional*, default is **9000**). When several Tally Prime instances run on different ports, the port can be switched per conversation through the **set-tally-connection** tool without changing this setting, see [Multiple Tally instances](#multiple-tally-instances)|
|TALLY_HOST|Host name or IP where XML Server is running (*optional*, default is **localhost**)|
|TALLY_TIMEOUT_MS|Time allowed for one Tally call, and for all the months of a chunked ledger-account together (*optional*, default is **45000**)|
|TALLY_CONNECTION_TTL_HOURS|Hours without use after which a port chosen through set-tally-connection lapses back to TALLY_PORT (*optional*, default is **12**)|
|TALLY_STATE_DIR|Folder of the state file holding the port chosen through set-tally-connection (*optional*, default is `.tally-mcp-server` in the user profile)|
|BLOCK_WRITE|Controls if MCP completely blocks access of write functionality. Setting this flag to **1** (or **true** / **yes**) will completely hide write functionality tools (create / update / delete of masters and vouchers) from the tool list. [ **0 = Allow , 1 = Block** ] (optional, default is **0** i.e. allowed). For Claude Desktop this is exposed as the **Block Write Access** switch of the extension settings|
|PORT|Tally MCP Server port number. Applicable only if Tally Prime MCP Server is deployed as Remote MCP server (*optional*, default is **3000**). Not applicable for Claude Desktop|
|MCP_DOMAIN|Domain name of Tally MCP Server website (*optional*, default is https://localhost:9000). Not applicable for Claude Desktop|
|PASSWORD|Password for the OAuth Login front-end page to authenticate genuine user (kindly set this to some complex password default is **password**). Not applicable for Claude Desktop|

## Contact
Project developed & maintained by: **Dhananjay Gokhale**

Email: **info@excelkida.com** <br>
Whatsapp: **(+91) 90284-63366**