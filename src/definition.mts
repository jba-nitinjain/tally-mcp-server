/**
 * JSON objects of report XML definitions and configurations
 */

import * as m from './models.mjs';

export const lstOptionCountryState = [
    {
        country: 'India',
        state: ['Andaman & Nicobar', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh', 'Dadra & Nagar Haveli and Daman & Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu & Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal']
    },
    {
        country: 'UAE',
        state: ['Abu Dhabi', 'Ajman', 'Dubai', 'Fujairah', 'Ras al-Khaimah', 'Sharjah', 'Umm al-Quwain']
    },
    {
        country: 'UK',
        state: ['England', 'Scotland', 'Wales', 'Northern Ireland']
    },
    {
        country: 'USA',
        states: ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming']
    },
    {
        country: 'Saudi Arabia',
        states: ['Riyadh', 'Makkah', 'Madina', 'Eastern Province', 'Asir', 'Tabuk', 'Hail', 'Northern Borders', 'Jizan', 'Najran', 'Al-Baha', 'Al-Jouf']
    },
    {
        country: 'Qatar',
        states: ['Doha', 'Al Rayyan', 'Al Wakrah', 'Al Khor', 'Al Shamal', 'Al Daayen', 'Umm Salal', 'Ash Shihaniyah']
    },
    {
        country: 'Kuwait',
        states: ['Al Asimah', 'Hawalli', 'Al Ahmadi', 'Al Farwaniyah', 'Al Jahra']
    },
    {
        country: 'Tanzania',
        states: ['Arusha', 'Dar es Salaam', 'Dodoma', 'Geita', 'Iringa', 'Kagera', 'Katavi', 'Kigoma', 'Kilimanjaro', 'Lindi', 'Manyara', 'Mara', 'Mbeya', 'Morogoro', 'Mtwara', 'Mwanza', 'Njombe', 'Pemba North', 'Pemba South', 'Pwani', 'Rukwa', 'Ruvuma', 'Shinyanga', 'Simiyu', 'Singida', 'Tabora', 'Tanga']
    },
    {
        country: 'Nigeria',
        states: ['Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara']
    }
]

export const lstCollections = ['Company', 'Group', 'Ledger', 'VoucherType', 'Unit', 'Godown', 'StockGroup', 'StockItem', 'CostCategory', 'CostCentre', 'Voucher'];

export const lstCollectionFields: m.TallyCollectionDefinition[] = [
    {
        collection: 'Company',
        fields: [
            { name: 'Name', datatype: 'string' },
            { name: 'Address', datatype: 'string', expression: 'if $$IsEmpty:$Address then "" else $$FullList:Address:$Address' },
            { name: 'StateName', datatype: 'string' },
            { name: 'CountryName', datatype: 'string' },
            { name: 'Pincode', datatype: 'string', description: 'postal code or ZIP code of the company' },
            { name: 'PhoneNumber', datatype: 'string', description: 'contact or mobile number' },
            { name: 'Email', datatype: 'string' },
            { name: 'BooksFrom', datatype: 'date', description: 'financial year start date when the books keeping started or the company was split' },
            { name: 'IsActiveCompany', datatype: 'boolean', expression: '$$IsEqual:$Name:##SVCurrentCompany', description: 'true if the company is active and currently selected in Tally, false if the company is inactive or not currently selected in Tally' }
        ]
    },
    {
        collection: 'VoucherType',
        fields: [
            { name: 'Name', datatype: 'string' },
            { name: 'Parent', datatype: 'string' },
            { name: 'AffectsStock', datatype: 'boolean' },
        ]
    },
    {
        collection: 'Group',
        fields: [
            { name: 'Name', datatype: 'string' },
            { name: 'Parent', datatype: 'string', expression: 'if $$IsEqual:$Parent:$$SysName:Primary then "" else $Parent' },
            { name: 'IsRevenue', datatype: 'boolean', description: 'true if the group belongs to profit loss, false if group belongs to balance sheet' },
            { name: 'IsDeemedPositive', datatype: 'boolean', description: 'true if group nature is debit, false if group nature is credit' },
            { name: 'AffectsGrossProfit', datatype: 'boolean', description: 'applicable only when isRevenue is true, if found true then group belongs to trading used for gross profit calculation' },
            { name: 'SortPosition', datatype: 'number' },
            { name: 'OpeningBalance', datatype: 'amount', description: 'opening or starting or begning balance of group based on from date' },
            { name: 'ClosingBalance', datatype: 'amount', description: 'closing or ending balance of group based on to date' }
        ]
    },
    {
        collection: 'Ledger',
        fields: [
            { name: 'Name', datatype: 'string' },
            { name: 'Parent', datatype: 'string', expression: 'if $$IsEqual:$Parent:$$SysName:Primary then "Reserves & Surplus" else $Parent', description: 'group under which ledger is nested' },
            { name: '_PrimaryGroup', datatype: 'string', description: 'primary group of parent or group, under which ledger is nested' },
            { name: 'IsRevenue', datatype: 'boolean', description: 'true if the ledger belongs to profit loss, false if it belongs to balance sheet; inherited from the primary group at the root of its group tree' },
            { name: 'IsDeemedPositive', datatype: 'boolean', description: 'true if group nature is debit, false if group nature is credit' },
            { name: 'AffectsGrossProfit', datatype: 'boolean', description: 'applicable only when isRevenue is true, if found true then group belongs to trading used for gross profit calculation' },
            { name: 'OpeningBalance', datatype: 'amount', description: 'opening or starting or begning balance based on from date' },
            { name: 'ClosingBalance', datatype: 'amount', description: 'closing or ending or balance based on to date' },
            { name: 'DebitTotals', datatype: 'amount', description: 'total debit amount of all vouchers passed during the period from and to date, negative denotes debit and vice-a-versa' },
            { name: 'CreditTotals', datatype: 'amount', description: 'total credit amount of all vouchers passed during the period from and to date, positive denotes credit and vice-a-versa' },
            { name: 'MailingName', datatype: 'string', description: 'name of the ledger for mailing or correspondence purpose' },
            { name: 'MailingAddress', datatype: 'string', expression: 'if $$IsEmpty:$Address then "" else $$FullList:Address:$Address', description: 'address of the ledger for mailing or correspondence purpose' },
            { name: 'LedStateName', datatype: 'string', description: 'state of the ledger for mailing or correspondence purpose' },
            { name: 'CountryName', datatype: 'string', description: 'country of the ledger for mailing or correspondence purpose' },
            { name: 'Pincode', datatype: 'string', description: 'postal code or ZIP code of the ledger for mailing or correspondence purpose' },
            { name: 'Email', datatype: 'string', description: 'email address of the ledger for mailing or correspondence purpose' },
            { name: 'MobileNumber', datatype: 'string', expression: 'if NOT $$IsEmpty:$LedgerMobile then $$Sprintf:"%s %s":$LedgerCountryISDCode:$LedgerMobile else ""', description: 'mobile number of the ledger for mailing or correspondence purpose' },
            { name: 'GSTN', datatype: 'string', expression: 'if $$IsEmpty:$PartyGSTIN then $LedGSTRegDetails[Last].GSTIN else $PartyGSTIN', description: 'GST number of the party ledger' },
            { name: 'GSTRegType', datatype: 'string', expression: 'if $$IsEmpty:$Gstregistrationtype then $LedGSTRegDetails[Last].Gstregistrationtype else $Gstregistrationtype', description: 'GST registration type of the party ledger' },
            { name: 'GstTypeOfsupply', datatype: 'string', description: 'GST type of supply of the party ledger' },
            { name: 'GstDutyHead', datatype: 'string', description: 'GST duty head of the party ledger' }
        ]
    },
    {
        collection: 'Unit',
        description: 'Unit of measurement used for stock items',
        fields: [
            { name: 'Name', datatype: 'string' },
            { name: 'Parent', datatype: 'string' },
            { name: 'FormalName', datatype: 'string', description: 'full name or formal name like Kilogram for name as kg, Litre for name as ltr, Piece for name as pcs' },
            { name: 'BaseUnits', datatype: 'string', description: 'base units' },
            { name: 'AdditionalUnits', datatype: 'string', description: 'additional units if any' },
            { name: 'Conversion', datatype: 'string', description: 'conversion expression or multiplier to convert additional units to base units if applicable, example "1 Dozen = 12 Pcs" or "1 Quintal = 100 Kgs"' }
        ]
    },
    {
        collection: 'Godown',
        description: 'warehouse or location of stock items',
        fields: [
            { name: 'Name', datatype: 'string' },
            { name: 'Parent', datatype: 'string' },
            { name: 'Address', datatype: 'string', expression: 'if $$IsEmpty:$Address then "" else $$FullList:Address:$Address' },
        ]
    },
    {
        collection: 'StockGroup',
        description: 'group of stock item',
        fields: [
            { name: 'Name', datatype: 'string' },
            { name: 'Parent', datatype: 'string', expression: 'if $$IsEqual:$Parent:$$SysName:Primary then "" else $Parent' }
        ]
    },
    {
        collection: 'StockCategory',
        description: 'category of stock item',
        fields: [
            { name: 'Name', datatype: 'string' },
            { name: 'Parent', datatype: 'string', expression: 'if $$IsEqual:$Parent:$$SysName:Primary then "" else $Parent' }
        ]
    },
    {
        collection: 'StockItem',
        description: 'stock item or product or service constituting inventory or services purchased or sold',
        fields: [
            { name: 'Name', datatype: 'string' },
            { name: 'Parent', datatype: 'string', expression: 'if $$IsEqual:$Parent:$$SysName:Primary then "" else $Parent', description: 'name field of StockGroup collection under which item is nested' },
            { name: 'Category', datatype: 'string', description: 'name field of StockCategory collection under which item is nested if applicable' },
            { name: 'OnlyAlias', datatype: 'string', description: 'alternate name or alias' },
            { name: 'PartNo', datatype: 'string', expression: 'if $$IsEqual:$BaseUnits:$$SysName:NotApplicable then "" else $BaseUnits', description: 'part number, or classification' },
            { name: 'Unit', datatype: 'string', expression: 'if $$IsEqual:$BaseUnits:$$SysName:NotApplicable then "" else $BaseUnits', description: 'name field of Unit collection under which item is nested' },
            { name: 'AlternateUnit', datatype: 'string', expression: 'if $$IsEqual:$AdditionalUnits:$$SysName:NotApplicable then "" else $AdditionalUnits', description: 'name field of Unit collection under which item is nested which is set as alternate or additional unit' },
            { name: 'Conversion', datatype: 'number', description: 'multiplier for alternate or additional unit' },
            { name: 'OpeningBalance', datatype: 'quantity', description: 'opening or begning quantity as on from date' },
            { name: 'ClosingBalance', datatype: 'quantity', description: 'closing or ending or balance quantity left as on to date' },
            { name: 'OpeningValue', datatype: 'amount', description: 'opening or begning value of stock item as on from date, negative denotes debit and to be treated as positive and vice-a-versa' },
            { name: 'ClosingValue', datatype: 'amount', description: 'closing or ending value of stock item as on to date, negative denotes debit and to be treated as positive and vice-a-versa' },
            { name: 'OpeningRate', datatype: 'rate', description: 'opening or begning rate as on from date' },
            { name: 'ClosingRate', datatype: 'rate', description: 'closing or ending rate as on to date' },
            { name: 'CostingMethod', datatype: 'string', description: 'method of valuation of opening or closing stock which can be Avg. Cost (Average Cost), FIFO (First in First Out), Std. Cost (Standard Cost), At Zero Cost, Monthly Avg. Cost' },
            { name: 'InwardQuantity', datatype: 'quantity', description: 'total inward quantity purchase or sales return or stock transfer during the period from and to date' },
            { name: 'OutwardQuantity', datatype: 'quantity', description: 'total outward quantity sales or purchase return or stock transfer during the period from and to date, it will be in negative which denotes outflow to be treated as positive and vice-a-versa' },
            { name: 'InwardValue', datatype: 'amount', description: 'total inward value of purchase or sales return or stock transfer during the period from and to date, negative denotes debit and positive credit' },
            { name: 'OutwardValue', datatype: 'amount', description: 'total outward value of sales or purchase return or stock transfer during the period from and to date, positive denotes credit and negative debit' },
            { name: 'CostingMethod', datatype: 'string', description: 'method of valuation of stock which can be Avg. Cost (Average Cost), FIFO (First in First Out), Std. Cost (Standard Cost), At Zero Cost, Monthly Avg. Cost' },
            { name: 'GSTMSTTypeofSupply', datatype: 'string', description: 'GST type of supply' },
            { name: 'InfGSTHSNCode', datatype: 'string', description: 'GST HSN code' },
            { name: 'InfGSTHSNDescription', datatype: 'string', description: 'GST HSN description' },
            { name: 'InfGSTIGSTRate', datatype: 'number', description: 'GST IGST rate' },
            { name: 'InfGSTTaxablility', datatype: 'string', description: 'GST taxability' }
        ]
    },
    {
        collection: 'CostCategory',
        description: 'cost category used to group cost centres for parallel allocation of income and expenses',
        fields: [
            { name: 'Name', datatype: 'string' },
            { name: 'AllocateRevenue', datatype: 'boolean', description: 'true if revenue items like income and expenses can be allocated to cost centres of this category' },
            { name: 'AllocateNonRevenue', datatype: 'boolean', description: 'true if non-revenue items like assets and liabilities can be allocated to cost centres of this category' }
        ]
    },
    {
        collection: 'CostCentre',
        description: 'cost centre or profit centre used to track income and expenses of a department, branch, project or employee',
        fields: [
            { name: 'Name', datatype: 'string' },
            { name: 'Parent', datatype: 'string', expression: 'if $$IsEqual:$Parent:$$SysName:Primary then "" else $Parent', description: 'name field of CostCentre collection under which cost centre is nested' },
            { name: 'Category', datatype: 'string', description: 'name field of CostCategory collection under which cost centre is nested' },
            { name: 'OpeningBalance', datatype: 'amount', description: 'opening or begning balance based on from date' },
            { name: 'ClosingBalance', datatype: 'amount', description: 'closing or ending balance based on to date' }
        ]
    },
    {
        collection: 'Currency',
        description: 'currency in which transactions can be recorded, base currency of the company plus any foreign currency configured',
        fields: [
            { name: 'Name', datatype: 'string', description: 'symbol of the currency' },
            { name: 'MailingName', datatype: 'string', description: 'formal name of the currency like US Dollar for symbol $' },
            { name: 'ExpandedSymbol', datatype: 'string', description: 'symbol in words used while printing amount in words' },
            { name: 'DecimalPlaces', datatype: 'number' },
            { name: 'IsSuffixedToValue', datatype: 'boolean', description: 'true if the symbol is printed after the amount' }
        ]
    },
    {
        collection: 'GSTClassification',
        description: 'reusable GST rate and HSN / SAC classification which can be applied on stock items and ledgers',
        fields: [
            { name: 'Name', datatype: 'string' },
            { name: 'InfGSTHSNCode', datatype: 'string', description: 'HSN code for goods or SAC code for services' },
            { name: 'InfGSTHSNDescription', datatype: 'string' },
            { name: 'InfGSTIGSTRate', datatype: 'number', description: 'total GST rate in percentage' },
            { name: 'InfGSTTaxablility', datatype: 'string' }
        ]
    },
    {
        collection: 'AttendanceType',
        description: 'payroll attendance or production type like Present, Absent, Overtime, Piece Production',
        fields: [
            { name: 'Name', datatype: 'string' },
            { name: 'Parent', datatype: 'string', expression: 'if $$IsEqual:$Parent:$$SysName:Primary then "" else $Parent' },
            { name: 'AttendanceType', datatype: 'string', description: 'Attendance/Leave with Pay, Leave without Pay or User Defined' },
            { name: 'AttendancePeriod', datatype: 'string', description: 'unit of the attendance period like Days' },
            { name: 'BaseUnits', datatype: 'string', description: 'unit of measurement, applicable for production type' }
        ]
    },
    {
        collection: 'Employee',
        description: 'payroll employee, internally stored by Tally as a cost centre flagged for payroll',
        tallyType: 'CostCentre', //object type Employee is unknown to TallyPrime 2.1 and pops a modal "Could not find description" which freezes Tally
        tallyFilter: '$ForPayroll',
        fields: [
            { name: 'Name', datatype: 'string' },
            { name: 'Parent', datatype: 'string', expression: 'if $$IsEqual:$Parent:$$SysName:Primary then "" else $Parent', description: 'employee group under which employee is nested' },
            { name: 'Category', datatype: 'string', description: 'cost category under which employee is nested' },
            { name: 'IsEmployeeGroup', datatype: 'boolean', description: 'true if this record is an employee group and not an employee' }
        ]
    },
    {
        collection: 'Budget',
        description: 'budget defined for groups, ledgers or cost centres for a period',
        fields: [
            { name: 'Name', datatype: 'string' },
            { name: 'Parent', datatype: 'string', expression: 'if $$IsEqual:$Parent:$$SysName:Primary then "" else $Parent' },
            { name: 'BudgetPeriodFrom', datatype: 'date' },
            { name: 'BudgetPeriodTo', datatype: 'date' }
        ]
    },
    {
        collection: 'Bill',
        description: 'Bill references for outstanding payables or receivables',
        fields: [
            { name: 'BillDate', datatype: 'date' },
            { name: 'Name', datatype: 'string', description: 'bill number or reference number' },
            { name: 'ClosingBalance', datatype: 'amount', description: 'closing or outstanding balance of bill as on to date, negative denotes debit and positive credit' },
            { name: 'Parent', datatype: 'string', description: 'name field of Ledger collection, party debtor or creditor under which bill is nested' },
            { name: '_OverDueDays', datatype: 'number', description: 'over due days, number of days bill is overdue as on to date' }
        ]
    }
]

// minified XML of ./template/generic/query-collection.njk
export const xmlQueryCollection = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>MyTallyLiveReport</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>{% if fromDate %}<SVFROMDATE>{{ fromDate | formatDate("d-MMM-yyyy") }}</SVFROMDATE>{% endif %}{% if toDate %}<SVTODATE>{{ toDate | formatDate("d-MMM-yyyy") }}</SVTODATE>{% endif %}{% if targetCompany %}<SVCURRENTCOMPANY>{{ targetCompany | escape }}</SVCURRENTCOMPANY>{% endif %}</STATICVARIABLES><TDL><TDLMESSAGE><REPORT NAME="MyTallyLiveReport"><FORMS>MyForm</FORMS></REPORT><FORM NAME="MyForm"><PARTS>MyPart01</PARTS><XMLTAG>DATA</XMLTAG></FORM><PART NAME="MyPart01"><LINES>MyLine01</LINES><REPEAT>MyLine01 : MyCollection</REPEAT><SCROLLED>Vertical</SCROLLED></PART><LINE NAME="MyLine01"><FIELDS>{% set comma = joiner() %}{% for field in fields -%}{{ comma() }}fld_{{ field.name }}{%- endfor %}</FIELDS><XMLTAG>ROW</XMLTAG></LINE>{% for field in fields %}<FIELD NAME="fld_{{ field.name }}">{% if field.expression %}<SET>{{ field.expression }}</SET>{% elif field.datatype == "date" %}<SET>if $$IsEmpty:${{ field.name }} then "" else $$PyrlYYYYMMDDFormat:${{ field.name }}:"-"</SET>{% elif field.datatype == "boolean" %}<SET>if ${{ field.name }} then 1 else 0</SET>{% elif field.datatype == "amount" %}<SET>$$StringFindAndReplace:(if $$IsDebit:${{ field.name }} then -$$NumValue:${{ field.name }} else $$NumValue:${{ field.name }}):"(-)":"-"</SET>{% elif field.datatype == "number" %}<SET>if $$IsEmpty:${{ field.name }} then 0 else $$StringFindAndReplace:($$String:${{ field.name }}):"(-)":"-"</SET>{% elif field.datatype == "quantity" %}<SET>$$StringFindAndReplace:(if $$IsInwards:${{ field.name }} then $$Number:$$String:${{ field.name }}"TailUnits" else -$$Number:$$String:${{ field.name }}:"TailUnits"):"(-)":"-"</SET>{% elif field.datatype == "rate" %}<SET>if $$IsEmpty:${{ field.name }} then 0 else $$Number:${{ field.name }}</SET>{% else %}<SET>${{ field.name }}</SET>{% endif %}<XMLTAG>{{ field.name }}</XMLTAG></FIELD>{% endfor %}<COLLECTION NAME="MyCollection"><TYPE>{{ collection }}</TYPE>{% if filters.length %}<FILTER>{% set comma = joiner() %}{% for filter in filters -%}{{ comma() }}fltr_{{ filter.name }}{%- endfor %}</FILTER><FETCH>{% set comma = joiner() %}{% for field in fields -%}{{ comma() }}fld_{{ field.name }}{%- endfor %}</FETCH>{% endif %}</COLLECTION>{% for filter in filters %}<SYSTEM TYPE="Formulae" NAME="fltr_{{ filter.name }}">{{ filter.expression }}</SYSTEM>{% endfor %}</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>';

// minified XML of ./templates/generic/delete-master.njk
export const xmlDeleteMasters = '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME>{% if targetCompany %}<SVCURRENTCOMPANY>{{ targetCompany | escape }}</SVCURRENTCOMPANY>{% endif %}</REQUESTDESC><REQUESTDATA>{% for master in masters %}<TALLYMESSAGE><{{ targetCollection | upper }} NAME="{{ master | escape }}" ACTION="Delete"><NAME>{{ master | escape }}</NAME></{{ targetCollection | upper }}></TALLYMESSAGE>{% endfor %}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>';

// minified XML of ./templates/generic/delete-voucher.njk
export const xmlDeleteVouchers = '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES>{% if targetCompany %}<SVCURRENTCOMPANY>{{ targetCompany | escape }}</SVCURRENTCOMPANY>{% endif %}</STATICVARIABLES></REQUESTDESC><REQUESTDATA>{% for voucher in vouchers %}<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER REMOTEID="{{ voucher.guid | escape }}" VCHTYPE="{{ voucher.voucherType | escape }}" ACTION="Delete"><DATE>{{ voucher.date | formatDate("yyyyMMdd") }}</DATE><VOUCHERTYPENAME>{{ voucher.voucherType | escape }}</VOUCHERTYPENAME>{% if voucher.voucherNumber %}<VOUCHERNUMBER>{{ voucher.voucherNumber | escape }}</VOUCHERNUMBER>{% endif %}</VOUCHER></TALLYMESSAGE>{% endfor %}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>';

// minified XML of ./template/generic/invoke-action.njk
export const xmlInvokeAction = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>MyTallyLiveReport</ID></HEADER><BODY><DESC><TDL><TDLMESSAGE><REPORT NAME="MyTallyLiveReport"><USE>{{ targetReport }}</USE>{% for variable in variables %}<SET>{{ variable.name }} : "{{ variable.value | escape }}"</SET>{% endfor %}</REPORT></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>';

// minified XML of ./template/report/*.njk
export const lstReportXml = new Map<string, string>([
    ['ledger-account', '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>MyTallyLiveReport</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVFROMDATE>{{ fromDate | formatDate("d-MMM-yyyy") }}</SVFROMDATE><SVTODATE>{{ toDate | formatDate("d-MMM-yyyy") }}</SVTODATE>{% if targetCompany %}<SVCURRENTCOMPANY>{{ targetCompany | escape }}</SVCURRENTCOMPANY>{% endif %}</STATICVARIABLES><TDL><TDLMESSAGE><REPORT NAME="MyTallyLiveReport"><FORMS>MyForm</FORMS></REPORT><FORM NAME="MyForm"><PARTS>MyPart01</PARTS><XMLTAG>DATA</XMLTAG></FORM><PART NAME="MyPart01"><LINES>MyLine01,MyLineOp,MyLineCl</LINES><REPEAT>MyLine01 : MyCollection</REPEAT><SCROLLED>Vertical</SCROLLED></PART><LINE NAME="MyLine01"><FIELDS>FldGuid,FldDate,FldVoucherType,FldVoucherNumber,FldAlternateLedger,FldPartyLedger,FldAmount,FldNarration</FIELDS><XMLTAG>ROW</XMLTAG></LINE><LINE NAME="MyLineOp"><FIELDS>FldDateOp,FldVoucherTypeOp,FldAmountOp</FIELDS><XMLTAG>ROW</XMLTAG></LINE><LINE NAME="MyLineCl"><FIELDS>FldDateCl,FldVoucherTypeCl,FldAmountCl,FldPrimaryGroupCl,FldIsIntegratedCl,FldIsRevenueCl</FIELDS><XMLTAG>ROW</XMLTAG></LINE><FIELD NAME="FldGuid"><SET>$Guid</SET><XMLTAG>guid</XMLTAG></FIELD><FIELD NAME="FldDate"><SET>$Date</SET><XMLTAG>date</XMLTAG></FIELD><FIELD NAME="FldVoucherType"><SET>$VoucherTypeName</SET><XMLTAG>voucher_type</XMLTAG></FIELD><FIELD NAME="FldVoucherNumber"><SET>$VoucherNumber</SET><XMLTAG>voucher_number</XMLTAG></FIELD><FIELD NAME="FldAlternateLedger"><SET>$AllLedgerEntries[1,@@FilterNotLedgerEqual].LedgerName</SET><XMLTAG>alternate_ledger</XMLTAG></FIELD><FIELD NAME="FldPartyLedger"><SET>$PartyLedgerName</SET><XMLTAG>party_ledger</XMLTAG></FIELD><FIELD NAME="FldAmount"><SET>if $$IsDebit:($AllLedgerEntries[1,@@FilterLedgerEqual].Amount) then -$$NumValue:$AllLedgerEntries[1,@@FilterLedgerEqual].Amount else $$NumValue:$AllLedgerEntries[1,@@FilterLedgerEqual].Amount</SET><XMLTAG>amount</XMLTAG></FIELD><FIELD NAME="FldNarration"><SET>$Narration</SET><XMLTAG>narration</XMLTAG></FIELD><FIELD NAME="FldDateOp"><SET>##SVFromDate</SET><XMLTAG>date</XMLTAG></FIELD><FIELD NAME="FldVoucherTypeOp"><SET>"Opening"</SET><XMLTAG>voucher_type</XMLTAG></FIELD><FIELD NAME="FldAmountOp"><SET>if $$IsDebit:$OpeningBalance:Ledger:"{{ ledgerName }}" then -$$NumValue:$OpeningBalance:Ledger:"{{ ledgerName }}" else $$NumValue:$OpeningBalance:Ledger:"{{ ledgerName }}"</SET><XMLTAG>amount</XMLTAG></FIELD><FIELD NAME="FldDateCl"><SET>##SVToDate</SET><XMLTAG>date</XMLTAG></FIELD><FIELD NAME="FldVoucherTypeCl"><SET>"Closing"</SET><XMLTAG>voucher_type</XMLTAG></FIELD><FIELD NAME="FldAmountCl"><SET>if $$IsDebit:$ClosingBalance:Ledger:"{{ ledgerName }}" then -$$NumValue:$ClosingBalance:Ledger:"{{ ledgerName }}" else $$NumValue:$ClosingBalance:Ledger:"{{ ledgerName }}"</SET><XMLTAG>amount</XMLTAG></FIELD><FIELD NAME="FldPrimaryGroupCl"><SET>$_PrimaryGroup:Ledger:"{{ ledgerName }}"</SET><XMLTAG>primary_group</XMLTAG></FIELD><FIELD NAME="FldIsIntegratedCl"><SET>$IsIntegrated:Company:##SVCurrentCompany</SET><XMLTAG>is_integrated</XMLTAG></FIELD><FIELD NAME="FldIsRevenueCl"><SET>$IsRevenue:Ledger:"{{ ledgerName }}"</SET><XMLTAG>is_revenue</XMLTAG></FIELD><COLLECTION NAME="MyCollection"><TYPE>Voucher</TYPE><FETCH>AllLedgerEntries,Narration,PartyLedgerName</FETCH><FILTER>FilterLedger,FilterExcludeInventoryVch,FilterExcludeOrderVch,FilterCancelledVouchers,FilterOptionalVouchers</FILTER></COLLECTION><SYSTEM TYPE="Formulae" NAME="FilterLedger">NOT $$IsEmpty:$AllLedgerEntries[1,@@FilterLedgerEqual].LedgerName</SYSTEM><SYSTEM TYPE="Formulae" NAME="FilterLedgerEqual">$$IsEqual:$LedgerName:"{{ ledgerName }}"</SYSTEM><SYSTEM TYPE="Formulae" NAME="FilterNotLedgerEqual">NOT $$IsEqual:$LedgerName:"{{ ledgerName }}"</SYSTEM><SYSTEM TYPE="Formulae" NAME="FilterExcludeInventoryVch">NOT $$IsInventoryVch:$VoucherTypeName</SYSTEM><SYSTEM TYPE="Formulae" NAME="FilterExcludeOrderVch">NOT $$IsOrderVch:$VoucherTypeName</SYSTEM><SYSTEM TYPE="Formulae" NAME="FilterCancelledVouchers">NOT $IsCancelled</SYSTEM><SYSTEM TYPE="Formulae" NAME="FilterOptionalVouchers">NOT $IsOptional</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'],
    ['ledger-period-balance', '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>MyTallyLiveReport</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVFROMDATE>{{ fromDate | formatDate("d-MMM-yyyy") }}</SVFROMDATE><SVTODATE>{{ toDate | formatDate("d-MMM-yyyy") }}</SVTODATE>{% if targetCompany %}<SVCURRENTCOMPANY>{{ targetCompany | escape }}</SVCURRENTCOMPANY>{% endif %}</STATICVARIABLES><TDL><TDLMESSAGE><REPORT NAME="MyTallyLiveReport"><FORMS>MyForm</FORMS></REPORT><FORM NAME="MyForm"><PARTS>MyPart01</PARTS><XMLTAG>DATA</XMLTAG></FORM><PART NAME="MyPart01"><LINES>MyLineOp,MyLineCl</LINES></PART><LINE NAME="MyLineOp"><FIELDS>FldDateOp,FldVoucherTypeOp,FldAmountOp</FIELDS><XMLTAG>ROW</XMLTAG></LINE><LINE NAME="MyLineCl"><FIELDS>FldDateCl,FldVoucherTypeCl,FldAmountCl,FldPrimaryGroupCl,FldIsIntegratedCl,FldIsRevenueCl</FIELDS><XMLTAG>ROW</XMLTAG></LINE><FIELD NAME="FldDateOp"><SET>##SVFromDate</SET><XMLTAG>date</XMLTAG></FIELD><FIELD NAME="FldVoucherTypeOp"><SET>"Opening"</SET><XMLTAG>voucher_type</XMLTAG></FIELD><FIELD NAME="FldAmountOp"><SET>if $$IsDebit:$OpeningBalance:Ledger:"{{ ledgerName }}" then -$$NumValue:$OpeningBalance:Ledger:"{{ ledgerName }}" else $$NumValue:$OpeningBalance:Ledger:"{{ ledgerName }}"</SET><XMLTAG>amount</XMLTAG></FIELD><FIELD NAME="FldDateCl"><SET>##SVToDate</SET><XMLTAG>date</XMLTAG></FIELD><FIELD NAME="FldVoucherTypeCl"><SET>"Closing"</SET><XMLTAG>voucher_type</XMLTAG></FIELD><FIELD NAME="FldAmountCl"><SET>if $$IsDebit:$ClosingBalance:Ledger:"{{ ledgerName }}" then -$$NumValue:$ClosingBalance:Ledger:"{{ ledgerName }}" else $$NumValue:$ClosingBalance:Ledger:"{{ ledgerName }}"</SET><XMLTAG>amount</XMLTAG></FIELD><FIELD NAME="FldPrimaryGroupCl"><SET>$_PrimaryGroup:Ledger:"{{ ledgerName }}"</SET><XMLTAG>primary_group</XMLTAG></FIELD><FIELD NAME="FldIsIntegratedCl"><SET>$IsIntegrated:Company:##SVCurrentCompany</SET><XMLTAG>is_integrated</XMLTAG></FIELD><FIELD NAME="FldIsRevenueCl"><SET>$IsRevenue:Ledger:"{{ ledgerName }}"</SET><XMLTAG>is_revenue</XMLTAG></FIELD></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'],
    ['stock-item-account', '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>MyTallyLiveReport</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVFROMDATE>{{ fromDate | formatDate("d-MMM-yyyy") }}</SVFROMDATE><SVTODATE>{{ toDate | formatDate("d-MMM-yyyy") }}</SVTODATE>{% if targetCompany %}<SVCURRENTCOMPANY>{{ targetCompany | escape }}</SVCURRENTCOMPANY>{% endif %}</STATICVARIABLES><TDL><TDLMESSAGE><REPORT NAME="MyTallyLiveReport"><FORMS>MyForm</FORMS></REPORT><FORM NAME="MyForm"><PARTS>MyPart01</PARTS><XMLTAG>DATA</XMLTAG></FORM><PART NAME="MyPart01"><LINES>MyLine01,MyLineOp</LINES><REPEAT>MyLine01 : MyCollection</REPEAT><SCROLLED>Vertical</SCROLLED></PART><LINE NAME="MyLine01"><FIELDS>FldDate,FldVoucherType,FldVoucherNumber,FldPartyLedger,FldQuantity,FldAmount,FldNarration,FldTrackingNumber,FldVoucherTypeParent</FIELDS><XMLTAG>ROW</XMLTAG></LINE><LINE NAME="MyLineOp"><FIELDS>FldDateOp,FldVoucherTypeOp,FldQuantityOp,FldAmountOp,FldVoucherTypeParentOp</FIELDS><XMLTAG>ROW</XMLTAG></LINE><FIELD NAME="FldDate"><SET>$Date</SET><XMLTAG>date</XMLTAG></FIELD><FIELD NAME="FldVoucherType"><SET>$VoucherTypeName</SET><XMLTAG>voucher_type</XMLTAG></FIELD><FIELD NAME="FldVoucherNumber"><SET>$VoucherNumber</SET><XMLTAG>voucher_number</XMLTAG></FIELD><FIELD NAME="FldPartyLedger"><SET>$PartyLedgerName</SET><XMLTAG>party_ledger</XMLTAG></FIELD><FIELD NAME="FldQuantity"><SET>if $$IsInwards:$AllInventoryEntries[1,@@FilterItemEqual].BilledQty then $$Number:$AllInventoryEntries[1,@@FilterItemEqual].BilledQty else -$$Number:$AllInventoryEntries[1,@@FilterItemEqual].BilledQty</SET><XMLTAG>quantity</XMLTAG></FIELD><FIELD NAME="FldAmount"><SET>if $$IsDebit:($AllInventoryEntries[1,@@FilterItemEqual].Amount) then -$$NumValue:$AllInventoryEntries[1,@@FilterItemEqual].Amount else $$NumValue:$AllInventoryEntries[1,@@FilterItemEqual].Amount</SET><XMLTAG>amount</XMLTAG></FIELD><FIELD NAME="FldNarration"><SET>$Narration</SET><XMLTAG>narration</XMLTAG></FIELD><FIELD NAME="FldTrackingNumber"><SET>if ($$IsEmpty:$AllInventoryEntries[1,@@FilterItemEqual].TrackingNumber or $$IsNotApplicable:$AllInventoryEntries[1,@@FilterItemEqual].TrackingNumber) then "" else $AllInventoryEntries[1,@@FilterItemEqual].TrackingNumber</SET><XMLTAG>tracking_number</XMLTAG></FIELD><FIELD NAME="FldVoucherTypeParent"><SET>$Parent:VoucherType:$VoucherTypeName</SET><XMLTAG>voucher_category</XMLTAG></FIELD><FIELD NAME="FldDateOp"><SET>##SVFromDate</SET><XMLTAG>date</XMLTAG></FIELD><FIELD NAME="FldVoucherTypeOp"><SET>"Opening"</SET><XMLTAG>voucher_type</XMLTAG></FIELD><FIELD NAME="FldQuantityOp"><SET>if $$IsInwards:$OpeningBalance:StockItem:"{{ itemName }}" then $$NumValue:$OpeningBalance:StockItem:"{{ itemName }}" else -$$NumValue:$OpeningBalance:StockItem:"{{ itemName }}"</SET><XMLTAG>quantity</XMLTAG></FIELD><FIELD NAME="FldAmountOp"><SET>if $$IsDebit:$OpeningValue:StockItem:"{{ itemName }}" then -$$NumValue:$OpeningValue:StockItem:"{{ itemName }}" else $$NumValue:$OpeningValue:StockItem:"{{ itemName }}"</SET><XMLTAG>amount</XMLTAG></FIELD><FIELD NAME="FldVoucherTypeParentOp"><SET>"Opening"</SET><XMLTAG>voucher_category</XMLTAG></FIELD><COLLECTION NAME="MyCollection"><TYPE>Voucher</TYPE><FETCH>AllInventoryEntries,Narration,PartyLedgerName</FETCH><FILTER>FilterStockItem,FilterExcludeOrderVch,FilterCancelledVouchers,FilterOptionalVouchers</FILTER></COLLECTION><SYSTEM TYPE="Formulae" NAME="FilterStockItem">NOT $$IsEmpty:$AllInventoryEntries[1,@@FilterItemEqual].StockItemName</SYSTEM><SYSTEM TYPE="Formulae" NAME="FilterItemEqual">$$IsEqual:$StockItemName:"{{ itemName }}"</SYSTEM><SYSTEM TYPE="Formulae" NAME="FilterInventoryVch">$$IsInventoryVch:$VoucherTypeName</SYSTEM><SYSTEM TYPE="Formulae" NAME="FilterExcludeOrderVch">NOT $$IsOrderVch:$VoucherTypeName</SYSTEM><SYSTEM TYPE="Formulae" NAME="FilterCancelledVouchers">NOT $IsCancelled</SYSTEM><SYSTEM TYPE="Formulae" NAME="FilterOptionalVouchers">NOT $IsOptional</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'],
]);

// minified XML of ./templates/push/*.njk
export const lstPushXml = new Map<string, string>([
    ['master-company', '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME></REQUESTDESC><REQUESTDATA>{% for master in masters %}<TALLYMESSAGE><COMPANY NAME="{{ (master._name or master.name) | escape }}" ACTION="{{ master.action }}"><NAME>{{ master.name | escape }}</NAME><ISUPDATINGTARGETID>No</ISUPDATINGTARGETID>{% if master.mailingName != undefined %}<MAILINGNAME>{{ master.mailingName | escape }}</MAILINGNAME>{% endif %}{% if master.address %}<ADDRESS.LIST TYPE="String">{% for line in master.address %}<ADDRESS>{{ line | escape }}</ADDRESS>{% endfor %}</ADDRESS.LIST>{% endif %}<COUNTRYNAME>{{ master.country | escape }}</COUNTRYNAME><STATENAME>{{ master.state | escape }}</STATENAME>{% if master.pincode != undefined %}<PINCODE>{{ master.pincode | escape }}</PINCODE>{% endif %}{% if master.phoneNumber != undefined %}<PHONENUMBER>{{ master.phoneNumber | escape }}</PHONENUMBER>{% endif %}{% if master.email != undefined %}<EMAIL>{{ master.email | escape }}</EMAIL>{% endif %}<STARTINGFROM>{{ master.booksFrom | formatDate("yyyyMMdd") }}</STARTINGFROM><BOOKSFROM>{{ master.booksFrom | formatDate("yyyyMMdd") }}</BOOKSFROM><ISINVENTORYON>{{ "Yes" if master.isInventory else "No" }}</ISINVENTORYON><ISACCOUNTINGON>Yes</ISACCOUNTINGON>{% if master.currencySymbol != undefined %}<BASECURRENCYSYMBOL>{{ master.currencySymbol | escape }}</BASECURRENCYSYMBOL><FORMALNAME>{{ master.currencyFormalName | escape }}</FORMALNAME><ISSUFFIXEDTOVALUE>No</ISSUFFIXEDTOVALUE><HASSPACEBETWEENAMOUNT>Yes</HASSPACEBETWEENAMOUNT><DECIMALPLACES>2</DECIMALPLACES><DECIMALPLACESFORPRINTING>2</DECIMALPLACESFORPRINTING>{% endif %}{% if master.gstin != undefined %}<GSTREGNUMBER>{{ master.gstin | escape }}</GSTREGNUMBER>{% endif %}{% if master.incomeTaxNumber != undefined %}<INCOMETAXNUMBER>{{ master.incomeTaxNumber | escape }}</INCOMETAXNUMBER>{% endif %}</COMPANY></TALLYMESSAGE>{% endfor %}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'],
    ['master-ledger', '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES>{% if targetCompany %}<SVCURRENTCOMPANY>{{ targetCompany | escape }}</SVCURRENTCOMPANY>{% endif %}</STATICVARIABLES></REQUESTDESC><REQUESTDATA>{% for master in masters %}<TALLYMESSAGE><LEDGER NAME="{{ (master._name or master.name) | escape }}" ACTION="{{ master.action }}"><LANGUAGENAME.LIST><NAME.LIST><NAME>{{ master.name | escape }}</NAME></NAME.LIST></LANGUAGENAME.LIST>{% if master.parent %}<PARENT>{{ master.parent | escape }}</PARENT>{% endif %}{% if master.openingBalance != undefined %}<OPENINGBALANCE>{{ master.openingBalance }}</OPENINGBALANCE>{% endif %}{% if master.isBillWise != undefined %}<ISBILLWISEON>{{ "Yes" if master.isBillWise else "No" }}</ISBILLWISEON>{% if master.billCreditPeriod != undefined %}<BILLCREDITPERIOD>{{ master.billCreditPeriod }} Days</BILLCREDITPERIOD>{% endif %}{% endif %}{% if master.isCostCentre != undefined %}<ISCOSTCENTRESON>{{ "Yes" if master.isCostCentre else "No" }}</ISCOSTCENTRESON>{% endif %}{% if master.email != undefined %}<EMAIL>{{ master.email | escape }}</EMAIL>{% endif %}{% if master.mobileNumber != undefined %}<LEDGERMOBILE>{{ master.mobileNumber | escape }}</LEDGERMOBILE>{% endif %}{% if master.bankDetails %}<BANKDETAILS.LIST><BANKACCOUNTNUMBER>{{ master.bankDetails.accountNumber | escape }}</BANKACCOUNTNUMBER><BANKIFSCODE>{{ master.bankDetails.ifscCode | escape }}</BANKIFSCODE>{% if master.bankDetails.bankName != undefined %}<BANKNAME>{{ master.bankDetails.bankName | escape }}</BANKNAME>{% endif %}{% if master.bankDetails.accountHolderName != undefined %}<ACCOUNTHOLDERNAME>{{ master.bankDetails.accountHolderName | escape }}</ACCOUNTHOLDERNAME>{% endif %}</BANKDETAILS.LIST>{% endif %}{% if master.mailingDetails %}{% if master.mailingDetails.address %}<ADDRESS.LIST TYPE="String">{% for line in master.mailingDetails.address %}<ADDRESS>{{ line | escape }}</ADDRESS>{% endfor %}</ADDRESS.LIST>{% endif %}<LEDMAILINGDETAILS.LIST><APPLICABLEFROM>{{ master.mailingDetails.applicableFrom | formatDate("yyyyMMdd") }}</APPLICABLEFROM>{% if master.mailingDetails.name != undefined %}<MAILINGNAME>{{ master.mailingDetails.name | escape }}</MAILINGNAME>{% endif %}{% if master.mailingDetails.address %}<ADDRESS.LIST TYPE="String">{% for line in master.mailingDetails.address %}<ADDRESS>{{ line | escape }}</ADDRESS>{% endfor %}</ADDRESS.LIST>{% endif %}<COUNTRY>{{ master.mailingDetails.country | escape }}</COUNTRY><STATE>{{ master.mailingDetails.state | escape }}</STATE>{% if master.mailingDetails.pincode != undefined %}<PINCODE>{{ master.mailingDetails.pincode | escape }}</PINCODE>{% endif %}</LEDMAILINGDETAILS.LIST>{% if master.gstRegistrationDetails %}<LEDGSTREGDETAILS.LIST><APPLICABLEFROM>{{ master.gstRegistrationDetails.applicableFrom | formatDate("yyyyMMdd") }}</APPLICABLEFROM>{% if master.gstRegistrationDetails.registrationType != undefined %}<GSTREGISTRATIONTYPE>{{ master.gstRegistrationDetails.registrationType | escape }}</GSTREGISTRATIONTYPE>{% endif %}{% if master.gstRegistrationDetails.placeOfSupply != undefined %}<PLACEOFSUPPLY>{{ master.gstRegistrationDetails.placeOfSupply | escape }}</PLACEOFSUPPLY>{% endif %}<GSTIN>{{ master.gstRegistrationDetails.gstin | escape }}</GSTIN></LEDGSTREGDETAILS.LIST>{% endif %}{% endif %}</LEDGER></TALLYMESSAGE>{% endfor %}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'],
    ['master-group', '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES>{% if targetCompany %}<SVCURRENTCOMPANY>{{ targetCompany | escape }}</SVCURRENTCOMPANY>{% endif %}</STATICVARIABLES></REQUESTDESC><REQUESTDATA>{% for master in masters %}<TALLYMESSAGE><GROUP NAME="{{ (master._name or master.name) | escape }}" ACTION="{{ master.action }}"><LANGUAGENAME.LIST><NAME.LIST><NAME>{{ master.name | escape }}</NAME></NAME.LIST></LANGUAGENAME.LIST>{% if master.parent %}<PARENT>{{ master.parent | escape }}</PARENT>{% endif %}{% if master.isSubLedger != undefined %}<ISSUBLEDGER>{{ "Yes" if master.isSubLedger else "No" }}</ISSUBLEDGER>{% endif %}{% if master.isNettBalance != undefined %}<ISADDABLE>{{ "Yes" if master.isNettBalance else "No" }}</ISADDABLE>{% endif %}{% if master.isCostCentre != undefined %}<ISCOSTCENTRESON>{{ "Yes" if master.isCostCentre else "No" }}</ISCOSTCENTRESON>{% endif %}</GROUP></TALLYMESSAGE>{% endfor %}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'],
    ['master-stock-group', '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES>{% if targetCompany %}<SVCURRENTCOMPANY>{{ targetCompany | escape }}</SVCURRENTCOMPANY>{% endif %}</STATICVARIABLES></REQUESTDESC><REQUESTDATA>{% for master in masters %}<TALLYMESSAGE><STOCKGROUP NAME="{{ (master._name or master.name) | escape }}" ACTION="{{ master.action }}"><LANGUAGENAME.LIST><NAME.LIST><NAME>{{ master.name | escape }}</NAME></NAME.LIST></LANGUAGENAME.LIST>{% if master.parent %}<PARENT>{{ master.parent | escape }}</PARENT>{% endif %}{% if master.isQuantityAddable != undefined %}<ISADDABLE>{{ "Yes" if master.isQuantityAddable else "No" }}</ISADDABLE>{% endif %}</STOCKGROUP></TALLYMESSAGE>{% endfor %}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'],
    ['master-stock-category', '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES>{% if targetCompany %}<SVCURRENTCOMPANY>{{ targetCompany | escape }}</SVCURRENTCOMPANY>{% endif %}</STATICVARIABLES></REQUESTDESC><REQUESTDATA>{% for master in masters %}<TALLYMESSAGE><STOCKCATEGORY NAME="{{ (master._name or master.name) | escape }}" ACTION="{{ master.action }}"><LANGUAGENAME.LIST><NAME.LIST><NAME>{{ master.name | escape }}</NAME></NAME.LIST></LANGUAGENAME.LIST>{% if master.parent %}<PARENT>{{ master.parent | escape }}</PARENT>{% endif %}</STOCKCATEGORY></TALLYMESSAGE>{% endfor %}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'],
    ['master-stock-item', '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES>{% if targetCompany %}<SVCURRENTCOMPANY>{{ targetCompany | escape }}</SVCURRENTCOMPANY>{% endif %}</STATICVARIABLES></REQUESTDESC><REQUESTDATA>{% for master in masters %}<TALLYMESSAGE><STOCKITEM NAME="{{ (master._name or master.name) | escape }}" ACTION="{{ master.action }}"><LANGUAGENAME.LIST><NAME.LIST><NAME>{{ master.name | escape }}</NAME></NAME.LIST></LANGUAGENAME.LIST>{% if master.parent %}<PARENT>{{ master.parent | escape }}</PARENT>{% endif %}{% if master.category %}<CATEGORY>{{ master.category | escape }}</CATEGORY>{% elif master.category == "" %}<CATEGORY>&#4; Not Applicable</CATEGORY>{% endif %}{% if master.unit %}<BASEUNITS>{{ master.unit | escape }}</BASEUNITS>{% endif %}{% if master.alternateUnit %}<ADDITIONALUNITS>{{ master.alternateUnit | escape }}</ADDITIONALUNITS><CONVERSION>{{ master.conversion }}</CONVERSION><DENOMINATOR>1</DENOMINATOR>{% endif %}{% if master.description != undefined %}<DESCRIPTION>{{ master.description | escape }}</DESCRIPTION>{% endif %}{% if master.costingMethod %}<COSTINGMETHOD>{{ master.costingMethod | escape }}</COSTINGMETHOD>{% endif %}{% if master.isBatchWise != undefined %}<ISBATCHWISEON>{{ "Yes" if master.isBatchWise else "No" }}</ISBATCHWISEON>{% endif %}{% if master.openingQuantity != undefined %}<OPENINGBALANCE>{{ master.openingQuantity }}{% if master.unit %} {{ master.unit | escape }}{% endif %}</OPENINGBALANCE>{% if master.openingRate != undefined %}<OPENINGRATE>{{ master.openingRate }}{% if master.unit %}/{{ master.unit | escape }}{% endif %}</OPENINGRATE>{% endif %}{% if master.openingValue != undefined %}<OPENINGVALUE>{{ master.openingValue }}</OPENINGVALUE>{% endif %}{% endif %}{% if master.gstDetails %}<GSTAPPLICABLE>&#4; Applicable</GSTAPPLICABLE><GSTTYPEOFSUPPLY>{{ master.gstDetails.typeOfSupply | escape }}</GSTTYPEOFSUPPLY><GSTDETAILS.LIST><APPLICABLEFROM>{{ master.gstDetails.applicableFrom | formatDate("yyyyMMdd") }}</APPLICABLEFROM>{% if master.gstDetails.hsnCode != undefined %}<HSNCODE>{{ master.gstDetails.hsnCode | escape }}</HSNCODE><HSNDESCRIPTION>{{ master.gstDetails.hsnDescription | escape }}</HSNDESCRIPTION><SRCOFHSNDETAILS>Specify Details Here</SRCOFHSNDETAILS>{% endif %}<SRCOFGSTDETAILS>Specify Details Here</SRCOFGSTDETAILS><TAXABILITY>{{ master.gstDetails.taxability | escape }}</TAXABILITY><STATEWISEDETAILS.LIST><STATENAME>&#4; Any</STATENAME><RATEDETAILS.LIST><GSTRATEDUTYHEAD>CGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>{{ master.gstDetails.cgstRate }}</GSTRATE></RATEDETAILS.LIST><RATEDETAILS.LIST><GSTRATEDUTYHEAD>SGST/UTGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>{{ master.gstDetails.sgstRate }}</GSTRATE></RATEDETAILS.LIST><RATEDETAILS.LIST><GSTRATEDUTYHEAD>IGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>{{ master.gstDetails.igstRate }}</GSTRATE></RATEDETAILS.LIST><RATEDETAILS.LIST><GSTRATEDUTYHEAD>Cess</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>&#4; Not Applicable</GSTRATEVALUATIONTYPE></RATEDETAILS.LIST></STATEWISEDETAILS.LIST></GSTDETAILS.LIST>{% endif %}</STOCKITEM></TALLYMESSAGE>{% endfor %}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'],
    ['master-unit', '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES>{% if targetCompany %}<SVCURRENTCOMPANY>{{ targetCompany | escape }}</SVCURRENTCOMPANY>{% endif %}</STATICVARIABLES></REQUESTDESC><REQUESTDATA>{% for master in masters %}<TALLYMESSAGE><UNIT NAME="{{ (master._name or master.name) | escape }}" ACTION="{{ master.action }}"><NAME>{{ master.name | escape }}</NAME><ORIGINALNAME>{{ (master._name or master.name) | escape }}</ORIGINALNAME>{% if master.baseUnit and master.additionalUnit %}<ISSIMPLEUNIT>No</ISSIMPLEUNIT><BASEUNITS>{{ master.baseUnit | escape }}</BASEUNITS><ADDITIONALUNITS>{{ master.additionalUnit | escape }}</ADDITIONALUNITS><CONVERSION>{{ master.conversion }}</CONVERSION>{% else %}<ISSIMPLEUNIT>Yes</ISSIMPLEUNIT>{% if master.formalName != undefined %}<FORMALNAME>{{ master.formalName | escape }}</FORMALNAME>{% endif %}{% if master.decimalPlaces != undefined %}<DECIMALPLACES>{{ master.decimalPlaces }}</DECIMALPLACES>{% endif %}{% endif %}</UNIT></TALLYMESSAGE>{% endfor %}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'],
    ['master-godown', '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES>{% if targetCompany %}<SVCURRENTCOMPANY>{{ targetCompany | escape }}</SVCURRENTCOMPANY>{% endif %}</STATICVARIABLES></REQUESTDESC><REQUESTDATA>{% for master in masters %}<TALLYMESSAGE><GODOWN NAME="{{ (master._name or master.name) | escape }}" ACTION="{{ master.action }}"><LANGUAGENAME.LIST><NAME.LIST><NAME>{{ master.name | escape }}</NAME></NAME.LIST></LANGUAGENAME.LIST>{% if master.parent %}<PARENT>{{ master.parent | escape }}</PARENT>{% endif %}{% if master.address %}<ADDRESS.LIST TYPE="String">{% for line in master.address %}<ADDRESS>{{ line | escape }}</ADDRESS>{% endfor %}</ADDRESS.LIST>{% endif %}{% if master.isExternal != undefined %}<ISEXTERNAL>{{ "Yes" if master.isExternal else "No" }}</ISEXTERNAL>{% endif %}</GODOWN></TALLYMESSAGE>{% endfor %}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'],
    ['master-cost-category', '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES>{% if targetCompany %}<SVCURRENTCOMPANY>{{ targetCompany | escape }}</SVCURRENTCOMPANY>{% endif %}</STATICVARIABLES></REQUESTDESC><REQUESTDATA>{% for master in masters %}<TALLYMESSAGE><COSTCATEGORY NAME="{{ (master._name or master.name) | escape }}" ACTION="{{ master.action }}"><LANGUAGENAME.LIST><NAME.LIST><NAME>{{ master.name | escape }}</NAME></NAME.LIST></LANGUAGENAME.LIST>{% if master.allocateRevenue != undefined %}<ALLOCATEREVENUE>{{ "Yes" if master.allocateRevenue else "No" }}</ALLOCATEREVENUE>{% endif %}{% if master.allocateNonRevenue != undefined %}<ALLOCATENONREVENUE>{{ "Yes" if master.allocateNonRevenue else "No" }}</ALLOCATENONREVENUE>{% endif %}</COSTCATEGORY></TALLYMESSAGE>{% endfor %}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'],
    ['master-cost-centre', '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES>{% if targetCompany %}<SVCURRENTCOMPANY>{{ targetCompany | escape }}</SVCURRENTCOMPANY>{% endif %}</STATICVARIABLES></REQUESTDESC><REQUESTDATA>{% for master in masters %}<TALLYMESSAGE><COSTCENTRE NAME="{{ (master._name or master.name) | escape }}" ACTION="{{ master.action }}"><LANGUAGENAME.LIST><NAME.LIST><NAME>{{ master.name | escape }}</NAME></NAME.LIST></LANGUAGENAME.LIST><CATEGORY>{{ (master.category or "Primary Cost Category") | escape }}</CATEGORY>{% if master.parent %}<PARENT>{{ master.parent | escape }}</PARENT>{% endif %}</COSTCENTRE></TALLYMESSAGE>{% endfor %}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'],
    ['master-voucher-type', '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES>{% if targetCompany %}<SVCURRENTCOMPANY>{{ targetCompany | escape }}</SVCURRENTCOMPANY>{% endif %}</STATICVARIABLES></REQUESTDESC><REQUESTDATA>{% for master in masters %}<TALLYMESSAGE><VOUCHERTYPE NAME="{{ (master._name or master.name) | escape }}" ACTION="{{ master.action }}"><LANGUAGENAME.LIST><NAME.LIST><NAME>{{ master.name | escape }}</NAME></NAME.LIST></LANGUAGENAME.LIST><PARENT>{{ master.parent | escape }}</PARENT>{% if master.numberingMethod %}<NUMBERINGMETHOD>{{ master.numberingMethod | escape }}</NUMBERINGMETHOD>{% endif %}{% if master.isOptional != undefined %}<ISOPTIONAL>{{ "Yes" if master.isOptional else "No" }}</ISOPTIONAL>{% endif %}{% if master.affectsStock != undefined %}<AFFECTSSTOCK>{{ "Yes" if master.affectsStock else "No" }}</AFFECTSSTOCK>{% endif %}{% if master.preventDuplicates != undefined %}<PREVENTDUPLICATES>{{ "Yes" if master.preventDuplicates else "No" }}</PREVENTDUPLICATES>{% endif %}{% if master.useCommonNarration != undefined %}<COMMONNARRATION>{{ "Yes" if master.useCommonNarration else "No" }}</COMMONNARRATION>{% endif %}{% if master.narrationsAtLineLevel != undefined %}<NARRATIONSATLINELEVEL>{{ "Yes" if master.narrationsAtLineLevel else "No" }}</NARRATIONSATLINELEVEL>{% endif %}{% if master.printAfterSave != undefined %}<PRINTAFTERSAVE>{{ "Yes" if master.printAfterSave else "No" }}</PRINTAFTERSAVE>{% endif %}{% if master.prefixDetails %}<PREFIXLIST.LIST><APPLICABLEFROM>{{ master.prefixDetails.applicableFrom | formatDate("yyyyMMdd") }}</APPLICABLEFROM><PREFIXPARTICULARS>{{ master.prefixDetails.prefix | escape }}</PREFIXPARTICULARS></PREFIXLIST.LIST>{% endif %}</VOUCHERTYPE></TALLYMESSAGE>{% endfor %}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'],
    ['master-currency', '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES>{% if targetCompany %}<SVCURRENTCOMPANY>{{ targetCompany | escape }}</SVCURRENTCOMPANY>{% endif %}</STATICVARIABLES></REQUESTDESC><REQUESTDATA>{% for master in masters %}<TALLYMESSAGE><CURRENCY NAME="{{ (master._name or master.name) | escape }}" ACTION="{{ master.action }}"><NAME>{{ master.name | escape }}</NAME><ORIGINALNAME>{{ master.name | escape }}</ORIGINALNAME>{% if master.formalName != undefined %}<MAILINGNAME>{{ master.formalName | escape }}</MAILINGNAME>{% endif %}{% if master.expandedSymbol != undefined %}<EXPANDEDSYMBOL>{{ master.expandedSymbol | escape }}</EXPANDEDSYMBOL>{% endif %}{% if master.decimalSymbol != undefined %}<DECIMALSYMBOL>{{ master.decimalSymbol | escape }}</DECIMALSYMBOL>{% endif %}{% if master.decimalPlaces != undefined %}<DECIMALPLACES>{{ master.decimalPlaces }}</DECIMALPLACES><DECIMALPLACESFORPRINTING>{{ master.decimalPlaces }}</DECIMALPLACESFORPRINTING>{% endif %}{% if master.isSymbolSuffixed != undefined %}<ISSUFFIXEDTOVALUE>{{ "Yes" if master.isSymbolSuffixed else "No" }}</ISSUFFIXEDTOVALUE>{% endif %}{% if master.hasSpaceBetweenAmount != undefined %}<HASSPACEBETWEENAMOUNT>{{ "Yes" if master.hasSpaceBetweenAmount else "No" }}</HASSPACEBETWEENAMOUNT>{% endif %}{% if master.showInMillions != undefined %}<SHOWINMILLIONS>{{ "Yes" if master.showInMillions else "No" }}</SHOWINMILLIONS>{% endif %}</CURRENCY></TALLYMESSAGE>{% endfor %}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'],
    ['master-gst-classification', '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES>{% if targetCompany %}<SVCURRENTCOMPANY>{{ targetCompany | escape }}</SVCURRENTCOMPANY>{% endif %}</STATICVARIABLES></REQUESTDESC><REQUESTDATA>{% for master in masters %}<TALLYMESSAGE><GSTCLASSIFICATION NAME="{{ (master._name or master.name) | escape }}" ACTION="{{ master.action }}"><LANGUAGENAME.LIST><NAME.LIST><NAME>{{ master.name | escape }}</NAME></NAME.LIST></LANGUAGENAME.LIST><GSTDETAILS.LIST><APPLICABLEFROM>{{ master.applicableFrom | formatDate("yyyyMMdd") }}</APPLICABLEFROM>{% if master.hsnCode != undefined %}<HSNCODE>{{ master.hsnCode | escape }}</HSNCODE><HSNDESCRIPTION>{{ master.hsnDescription | escape }}</HSNDESCRIPTION><SRCOFHSNDETAILS>Specify Details Here</SRCOFHSNDETAILS>{% endif %}<SRCOFGSTDETAILS>Specify Details Here</SRCOFGSTDETAILS><TAXABILITY>{{ master.taxability | escape }}</TAXABILITY><TYPEOFSUPPLY>{{ master.typeOfSupply | escape }}</TYPEOFSUPPLY><STATEWISEDETAILS.LIST><STATENAME>&#4; Any</STATENAME><RATEDETAILS.LIST><GSTRATEDUTYHEAD>CGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>{{ master.cgstRate }}</GSTRATE></RATEDETAILS.LIST><RATEDETAILS.LIST><GSTRATEDUTYHEAD>SGST/UTGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>{{ master.sgstRate }}</GSTRATE></RATEDETAILS.LIST><RATEDETAILS.LIST><GSTRATEDUTYHEAD>IGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>{{ master.igstRate }}</GSTRATE></RATEDETAILS.LIST><RATEDETAILS.LIST><GSTRATEDUTYHEAD>Cess</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>&#4; Not Applicable</GSTRATEVALUATIONTYPE></RATEDETAILS.LIST></STATEWISEDETAILS.LIST></GSTDETAILS.LIST></GSTCLASSIFICATION></TALLYMESSAGE>{% endfor %}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'],
    ['master-budget', '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES>{% if targetCompany %}<SVCURRENTCOMPANY>{{ targetCompany | escape }}</SVCURRENTCOMPANY>{% endif %}</STATICVARIABLES></REQUESTDESC><REQUESTDATA>{% for master in masters %}<TALLYMESSAGE><BUDGET NAME="{{ (master._name or master.name) | escape }}" ACTION="{{ master.action }}"><LANGUAGENAME.LIST><NAME.LIST><NAME>{{ master.name | escape }}</NAME></NAME.LIST></LANGUAGENAME.LIST>{% if master.parent %}<PARENT>{{ master.parent | escape }}</PARENT>{% endif %}<BUDGETPERIODFROM>{{ master.fromDate | formatDate("yyyyMMdd") }}</BUDGETPERIODFROM><BUDGETPERIODTO>{{ master.toDate | formatDate("yyyyMMdd") }}</BUDGETPERIODTO>{% for allocation in master.groupBudgets %}<BUDGETGROUP.LIST><GROUPNAME>{{ allocation.name | escape }}</GROUPNAME><ISADDABLE>{{ "Yes" if allocation.isNettBalance else "No" }}</ISADDABLE><CLBALANCE>{{ allocation.amount }}</CLBALANCE></BUDGETGROUP.LIST>{% endfor %}{% for allocation in master.ledgerBudgets %}<BUDGETLEDGER.LIST><LEDGERNAME>{{ allocation.name | escape }}</LEDGERNAME><CLBALANCE>{{ allocation.amount }}</CLBALANCE></BUDGETLEDGER.LIST>{% endfor %}{% for allocation in master.costCentreBudgets %}<BUDGETCOSTCENTRE.LIST><COSTCENTRENAME>{{ allocation.name | escape }}</COSTCENTRENAME><CLBALANCE>{{ allocation.amount }}</CLBALANCE></BUDGETCOSTCENTRE.LIST>{% endfor %}</BUDGET></TALLYMESSAGE>{% endfor %}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'],
    ['master-pay-head', '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES>{% if targetCompany %}<SVCURRENTCOMPANY>{{ targetCompany | escape }}</SVCURRENTCOMPANY>{% endif %}</STATICVARIABLES></REQUESTDESC><REQUESTDATA>{% for master in masters %}<TALLYMESSAGE><LEDGER NAME="{{ (master._name or master.name) | escape }}" ACTION="{{ master.action }}"><LANGUAGENAME.LIST><NAME.LIST><NAME>{{ master.name | escape }}</NAME></NAME.LIST></LANGUAGENAME.LIST><PARENT>{{ master.parent | escape }}</PARENT><ISPAYROLLPAYHEAD>Yes</ISPAYROLLPAYHEAD><PAYHEADTYPE>{{ master.payHeadType | escape }}</PAYHEADTYPE><PAYSLIPNAME>{{ (master.payslipName or master.name) | escape }}</PAYSLIPNAME><ISDEEMEDPOSITIVE>{{ "Yes" if master.isDebit else "No" }}</ISDEEMEDPOSITIVE>{% if master.calculationType %}<CALCTYPE>{{ master.calculationType | escape }}</CALCTYPE>{% endif %}{% if master.calculationPeriod %}<CALCPERIODTYPE>{{ master.calculationPeriod | escape }}</CALCPERIODTYPE>{% endif %}{% if master.appropriateFor %}<APPROPRIATEFOR>{{ master.appropriateFor | escape }}</APPROPRIATEFOR>{% endif %}{% if master.roundingMethod %}<ROUNDINGMETHOD>{{ master.roundingMethod | escape }}</ROUNDINGMETHOD><ROUNDINGLIMIT>{{ master.roundingLimit }}</ROUNDINGLIMIT>{% endif %}{% if master.attendanceType %}<ATTENDANCETYPE>{{ master.attendanceType | escape }}</ATTENDANCETYPE>{% endif %}{% if master.isBillWise != undefined %}<ISBILLWISEON>{{ "Yes" if master.isBillWise else "No" }}</ISBILLWISEON>{% endif %}</LEDGER></TALLYMESSAGE>{% endfor %}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'],
    ['master-employee', '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES>{% if targetCompany %}<SVCURRENTCOMPANY>{{ targetCompany | escape }}</SVCURRENTCOMPANY>{% endif %}</STATICVARIABLES></REQUESTDESC><REQUESTDATA>{% for master in masters %}<TALLYMESSAGE><COSTCENTRE NAME="{{ (master._name or master.name) | escape }}" ACTION="{{ master.action }}"><LANGUAGENAME.LIST><NAME.LIST><NAME>{{ master.name | escape }}</NAME></NAME.LIST></LANGUAGENAME.LIST><CATEGORY>{{ (master.category or "Primary Cost Category") | escape }}</CATEGORY>{% if master.parent %}<PARENT>{{ master.parent | escape }}</PARENT>{% endif %}<FORPAYROLL>Yes</FORPAYROLL><ISEMPLOYEEGROUP>{{ "Yes" if master.isGroup else "No" }}</ISEMPLOYEEGROUP>{% if not master.isGroup %}<EMPLOYEEDETAILS.LIST><APPLICABLEFROM>{{ master.dateOfJoining | formatDate("yyyyMMdd") }}</APPLICABLEFROM><DATEOFJOINING>{{ master.dateOfJoining | formatDate("yyyyMMdd") }}</DATEOFJOINING>{% if master.dateOfRelease %}<DATEOFRELEASE>{{ master.dateOfRelease | formatDate("yyyyMMdd") }}</DATEOFRELEASE>{% endif %}{% if master.employeeNumber != undefined %}<EMPLOYEENUMBER>{{ master.employeeNumber | escape }}</EMPLOYEENUMBER>{% endif %}{% if master.designation != undefined %}<DESIGNATION>{{ master.designation | escape }}</DESIGNATION>{% endif %}{% if master.functionName != undefined %}<FUNCTIONNAME>{{ master.functionName | escape }}</FUNCTIONNAME>{% endif %}{% if master.location != undefined %}<LOCATION>{{ master.location | escape }}</LOCATION>{% endif %}{% if master.gender != undefined %}<GENDER>{{ master.gender | escape }}</GENDER>{% endif %}{% if master.dateOfBirth %}<DATEOFBIRTH>{{ master.dateOfBirth | formatDate("yyyyMMdd") }}</DATEOFBIRTH>{% endif %}{% if master.mobileNumber != undefined %}<MOBILENO>{{ master.mobileNumber | escape }}</MOBILENO>{% endif %}{% if master.email != undefined %}<EMAILID>{{ master.email | escape }}</EMAILID>{% endif %}{% if master.panNumber != undefined %}<INCOMETAXNUMBER>{{ master.panNumber | escape }}</INCOMETAXNUMBER>{% endif %}{% if master.bankDetails %}<BANKNAME>{{ master.bankDetails.bankName | escape }}</BANKNAME><BANKACCOUNTNUMBER>{{ master.bankDetails.accountNumber | escape }}</BANKACCOUNTNUMBER><IFSCODE>{{ master.bankDetails.ifscCode | escape }}</IFSCODE>{% endif %}</EMPLOYEEDETAILS.LIST>{% endif %}</COSTCENTRE></TALLYMESSAGE>{% endfor %}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'],
    ['master-attendance-type', '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES>{% if targetCompany %}<SVCURRENTCOMPANY>{{ targetCompany | escape }}</SVCURRENTCOMPANY>{% endif %}</STATICVARIABLES></REQUESTDESC><REQUESTDATA>{% for master in masters %}<TALLYMESSAGE><ATTENDANCETYPE NAME="{{ (master._name or master.name) | escape }}" ACTION="{{ master.action }}"><LANGUAGENAME.LIST><NAME.LIST><NAME>{{ master.name | escape }}</NAME></NAME.LIST></LANGUAGENAME.LIST>{% if master.parent %}<PARENT>{{ master.parent | escape }}</PARENT>{% endif %}<ATTENDANCETYPE>{{ master.attendanceType | escape }}</ATTENDANCETYPE>{% if master.attendanceType == "User Defined" %}<PRODUCTIONTYPE>{{ master.productionType | escape }}</PRODUCTIONTYPE><BASEUNITS>{{ master.unit | escape }}</BASEUNITS>{% else %}<ATTENDANCEPERIOD>{{ (master.period or "Days") | escape }}</ATTENDANCEPERIOD>{% endif %}</ATTENDANCETYPE></TALLYMESSAGE>{% endfor %}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'],
    ['voucher', '{% macro inventoryEntry(item) %}<STOCKITEMNAME>{{ item.stockItemName | escape }}</STOCKITEMNAME><ISDEEMEDPOSITIVE>{{ "Yes" if item.amount < 0 else "No" }}</ISDEEMEDPOSITIVE>{% if item.rate != undefined %}<RATE>{{ item.rate }}{% if item.unit %}/{{ item.unit | escape }}{% endif %}</RATE>{% endif %}<AMOUNT>{{ item.amount }}</AMOUNT><ACTUALQTY>{{ item.quantity }}{% if item.unit %} {{ item.unit | escape }}{% endif %}</ACTUALQTY><BILLEDQTY>{{ item.quantity }}{% if item.unit %} {{ item.unit | escape }}{% endif %}</BILLEDQTY>{% if item.godownName or item.batchName %}<BATCHALLOCATIONS.LIST><GODOWNNAME>{{ (item.godownName or "Main Location") | escape }}</GODOWNNAME><BATCHNAME>{{ (item.batchName or "Primary Batch") | escape }}</BATCHNAME><AMOUNT>{{ item.amount }}</AMOUNT><ACTUALQTY>{{ item.quantity }}{% if item.unit %} {{ item.unit | escape }}{% endif %}</ACTUALQTY><BILLEDQTY>{{ item.quantity }}{% if item.unit %} {{ item.unit | escape }}{% endif %}</BILLEDQTY></BATCHALLOCATIONS.LIST>{% endif %}{% if item.accountingLedger %}<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>{{ item.accountingLedger | escape }}</LEDGERNAME><ISDEEMEDPOSITIVE>{{ "Yes" if item.amount < 0 else "No" }}</ISDEEMEDPOSITIVE><AMOUNT>{{ item.amount }}</AMOUNT></ACCOUNTINGALLOCATIONS.LIST>{% endif %}{% endmacro %}<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>{% if targetCompany %}<SVCURRENTCOMPANY>{{ targetCompany | escape }}</SVCURRENTCOMPANY>{% endif %}</STATICVARIABLES></REQUESTDESC><REQUESTDATA>{% for voucher in vouchers %}<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER {% if voucher.guid %}REMOTEID="{{ voucher.guid | escape }}" VCHKEY="" {% endif %}VCHTYPE="{{ voucher.voucherType | escape }}" ACTION="{{ "Alter" if voucher.guid else "Create" }}" OBJVIEW="{{ voucher.objectView | escape }}"><DATE>{{ voucher.date | formatDate("yyyyMMdd") }}</DATE><EFFECTIVEDATE>{{ voucher.date | formatDate("yyyyMMdd") }}</EFFECTIVEDATE><VOUCHERTYPENAME>{{ voucher.voucherType | escape }}</VOUCHERTYPENAME>{% if voucher.voucherNumber %}<VOUCHERNUMBER>{{ voucher.voucherNumber | escape }}</VOUCHERNUMBER>{% endif %}{% if voucher.reference %}<REFERENCE>{{ voucher.reference | escape }}</REFERENCE>{% endif %}{% if voucher.referenceDate %}<REFERENCEDATE>{{ voucher.referenceDate | formatDate("yyyyMMdd") }}</REFERENCEDATE>{% endif %}{% if voucher.partyLedgerName %}<PARTYLEDGERNAME>{{ voucher.partyLedgerName | escape }}</PARTYLEDGERNAME><PARTYNAME>{{ voucher.partyLedgerName | escape }}</PARTYNAME>{% endif %}{% if voucher.narration %}<NARRATION>{{ voucher.narration | escape }}</NARRATION>{% endif %}{% if voucher.isInvoice %}<ISINVOICE>Yes</ISINVOICE>{% endif %}<PERSISTEDVIEW>{{ voucher.objectView | escape }}</PERSISTEDVIEW>{% for entry in voucher.ledgerEntries %}<ALLLEDGERENTRIES.LIST><LEDGERNAME>{{ entry.ledgerName | escape }}</LEDGERNAME><ISDEEMEDPOSITIVE>{{ "Yes" if entry.amount < 0 else "No" }}</ISDEEMEDPOSITIVE><AMOUNT>{{ entry.amount }}</AMOUNT>{% for bill in entry.billAllocations %}<BILLALLOCATIONS.LIST><NAME>{{ bill.name | escape }}</NAME><BILLTYPE>{{ bill.billType | escape }}</BILLTYPE>{% if bill.creditPeriod != undefined %}<BILLCREDITPERIOD>{{ bill.creditPeriod }} Days</BILLCREDITPERIOD>{% endif %}<AMOUNT>{{ bill.amount }}</AMOUNT></BILLALLOCATIONS.LIST>{% endfor %}{% for allocation in entry.costCentreAllocations %}<CATEGORYALLOCATIONS.LIST><CATEGORY>{{ allocation.costCategory | escape }}</CATEGORY><ISDEEMEDPOSITIVE>{{ "Yes" if allocation.amount < 0 else "No" }}</ISDEEMEDPOSITIVE><COSTCENTREALLOCATIONS.LIST><NAME>{{ allocation.costCentre | escape }}</NAME><AMOUNT>{{ allocation.amount }}</AMOUNT></COSTCENTREALLOCATIONS.LIST></CATEGORYALLOCATIONS.LIST>{% endfor %}</ALLLEDGERENTRIES.LIST>{% endfor %}{% for item in voucher.inventoryEntries %}<ALLINVENTORYENTRIES.LIST>{{ inventoryEntry(item) }}</ALLINVENTORYENTRIES.LIST>{% endfor %}{% for item in voucher.sourceEntries %}<INVENTORYENTRIESOUT.LIST>{{ inventoryEntry(item) }}</INVENTORYENTRIESOUT.LIST>{% endfor %}{% for item in voucher.destinationEntries %}<INVENTORYENTRIESIN.LIST>{{ inventoryEntry(item) }}</INVENTORYENTRIESIN.LIST>{% endfor %}</VOUCHER></TALLYMESSAGE>{% endfor %}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'],
]);


export const lstReportConfig = [
    {
        name: 'ledger-account',
        input: [
            { name: 'fromDate', datatype: 'date' },
            { name: 'toDate', datatype: 'date' },
            { name: 'ledgerName', datatype: 'string' }
        ],
        output: [
            { name: 'guid', datatype: 'string' },
            { name: 'date', datatype: 'date' },
            { name: 'voucher_type', datatype: 'string' },
            { name: 'voucher_number', datatype: 'string' },
            { name: 'alternate_ledger', datatype: 'string' },
            { name: 'party_ledger', datatype: 'string' },
            { name: 'amount', datatype: 'number' },
            { name: 'narration', datatype: 'string' },
            // carried only on the synthetic Closing row: used by the reconciliation guard, not cached as columns
            { name: 'primary_group', datatype: 'string' },
            { name: 'is_integrated', datatype: 'string' },
            { name: 'is_revenue', datatype: 'string' }
        ]
    },
    {
        name: 'ledger-period-balance', // the Opening and Closing lines of ledger-account without the vouchers: a cheap whole-period cross-check (feedback #59)
        input: [
            { name: 'fromDate', datatype: 'date' },
            { name: 'toDate', datatype: 'date' },
            { name: 'ledgerName', datatype: 'string' }
        ],
        output: [
            { name: 'guid', datatype: 'string' },
            { name: 'date', datatype: 'date' },
            { name: 'voucher_type', datatype: 'string' },
            { name: 'voucher_number', datatype: 'string' },
            { name: 'alternate_ledger', datatype: 'string' },
            { name: 'party_ledger', datatype: 'string' },
            { name: 'amount', datatype: 'number' },
            { name: 'narration', datatype: 'string' },
            // carried only on the synthetic Closing row: used by the reconciliation guard, not cached as columns
            { name: 'primary_group', datatype: 'string' },
            { name: 'is_integrated', datatype: 'string' },
            { name: 'is_revenue', datatype: 'string' }
        ]
    },
    {
        name: 'stock-item-account',
        input: [
            { name: 'fromDate', datatype: 'date' },
            { name: 'toDate', datatype: 'date' },
            { name: 'itemName', datatype: 'string' }
        ],
        output: [
            { name: 'date', datatype: 'date' },
            { name: 'voucher_type', datatype: 'string' },
            { name: 'voucher_number', datatype: 'string' },
            { name: 'party_ledger', datatype: 'string' },
            { name: 'quantity', datatype: 'number' },
            { name: 'amount', datatype: 'number' },
            { name: 'narration', datatype: 'string' },
            { name: 'tracking_number', datatype: 'string' },
            { name: 'voucher_category', datatype: 'string' }
        ]
    }
]