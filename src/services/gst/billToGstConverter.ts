import { BillRecord, ExtractedBillData } from '../../types';
import { GstSector, GstTransactionInput, GstTreatment, GstTransactionType } from '../../types/gst';
import { canonicalGstEngine } from './gstEngineService';

export interface BillGstAuditItem {
  billId: string;
  invoiceNumber: string;
  invoiceDate: string;
  supplierName: string;
  supplierTin: string | null;
  outletId: string;
  outletName: string;
  documentType: string;
  taxStatus: string;
  status: string;
  invoiceTotal: number;
  taxableBase: number;
  gstAmount: number;
  claimableGst: number;
  blockedGst: number;
  miraBox: string;
  included: boolean;
  excludedReason?: string;
  warnings: string[];
}

export interface BillToGstConversionResult {
  transactions: GstTransactionInput[];
  auditItems: BillGstAuditItem[];
  stats: {
    totalBillsInPeriod: number;
    verifiedBillsInPeriod: number;
    includedBillsCount: number;
    pendingReviewCount: number;
    rejectedCount: number;
    excludedNoTaxCount: number;
    excludedOtherSectorCount: number;
  };
}

const MONTH_MAP: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12
};

/**
 * Normalizes bill invoice dates (e.g. "10 AUG 2026", "24 JUN 2026", "2026-08-10", "10/08/2026")
 * into YYYY-MM-DD without UTC timezone day shifting.
 */
export function normalizeBillDateToIso(rawDate?: string | null, fallbackIso?: string): string {
  const tryFallback = (): string => {
    if (fallbackIso) {
      const m = fallbackIso.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    }
    return new Date().toISOString().slice(0, 10);
  };

  if (!rawDate || typeof rawDate !== 'string') {
    return tryFallback();
  }

  const trimmed = rawDate.trim();
  if (!trimmed) return tryFallback();

  // ISO YYYY-MM-DD
  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const y = isoMatch[1];
    const m = isoMatch[2].padStart(2, '0');
    const d = isoMatch[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // DD MMM YYYY or DD-MMM-YYYY (e.g. "10 AUG 2026")
  const dmyTextMatch = trimmed.match(/^(\d{1,2})[\s\-\/]+([A-Za-z]+)[\s\-\/,]+(\d{2,4})$/);
  if (dmyTextMatch) {
    const day = parseInt(dmyTextMatch[1], 10);
    const monKey = dmyTextMatch[2].toLowerCase();
    const month = MONTH_MAP[monKey] || MONTH_MAP[monKey.slice(0, 3)];
    let year = parseInt(dmyTextMatch[3], 10);
    if (year < 100) year += 2000;
    if (month && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // MMM DD, YYYY (e.g. "Aug 10, 2026")
  const mdyTextMatch = trimmed.match(/^([A-Za-z]+)[\s\-\/]+(\d{1,2})[,\s]+(\d{2,4})$/);
  if (mdyTextMatch) {
    const monKey = mdyTextMatch[1].toLowerCase();
    const month = MONTH_MAP[monKey] || MONTH_MAP[monKey.slice(0, 3)];
    const day = parseInt(mdyTextMatch[2], 10);
    let year = parseInt(mdyTextMatch[3], 10);
    if (year < 100) year += 2000;
    if (month && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmyNumMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmyNumMatch) {
    const first = parseInt(dmyNumMatch[1], 10);
    const second = parseInt(dmyNumMatch[2], 10);
    let year = parseInt(dmyNumMatch[3], 10);
    if (year < 100) year += 2000;
    // Assume DD/MM/YYYY (Maldivian standard) unless second > 12
    const day = second > 12 ? second : first;
    const month = second > 12 ? first : second;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  return tryFallback();
}

function isTourismBillData(data: ExtractedBillData): boolean {
  const gstType = (data.invoice?.gst_type || '').toUpperCase();
  if (gstType.includes('TGST') || gstType.includes('TOURISM') || gstType.includes('16%') || gstType.includes('17%')) {
    return true;
  }
  const items = Array.isArray(data.items) ? data.items : [];
  return items.some((i) => {
    const r = Number(i.gst_rate || 0);
    return r === 16 || r === 17;
  });
}

function isCapitalAssetBill(data: ExtractedBillData): boolean {
  return (
    data.document_type === 'CAPITAL_EXPENDITURE' ||
    data.mira_schedule1_category === 'Capital Asset (Schedule 2)' ||
    data.income_tax_treatment === 'CAPITAL_ALLOWANCE' ||
    data.accounting_treatment === 'CAPITAL_EXPENDITURE'
  );
}

function isBlockedInputBill(data: ExtractedBillData): boolean {
  if (data.income_tax_treatment === 'NON_DEDUCTIBLE' || data.deductible_percentage === 0) {
    return true;
  }
  const combined = `${data.expense_category || ''} ${data.mira_schedule1_category || ''} ${data.notes || ''}`.toLowerCase();
  return (
    combined.includes('entertainment') ||
    combined.includes('fine') ||
    combined.includes('penalty') ||
    combined.includes('personal gift') ||
    combined.includes('motor_vehicle_passenger')
  );
}

function isOverheadBill(data: ExtractedBillData): boolean {
  const cat = (data.expense_category || '').toLowerCase();
  const sch = (data.mira_schedule1_category || '').toLowerCase();
  return (
    cat.includes('utilities') ||
    sch.includes('rental') ||
    sch.includes('professional') ||
    sch.includes('other expenses')
  );
}

/**
 * Extracts exact taxable purchase base and GST amount from a verified bill
 * following MIRA 205/206 statutory rules:
 * - Zero-rated / exempt / untaxed line items (e.g. Customs Duty, Delivery Order Fee at 0%)
 *   do NOT inflate Standard-Rated Purchases (Box 8).
 * - Tax-inclusive bills cleanly separate taxable base = total - gst.
 */
function extractTaxedBaseAndGst(
  data: ExtractedBillData,
  billSector: GstSector,
  isoDate: string
): { taxableBase: number; gstAmount: number; invoiceTotal: number } {
  const totals = data.totals || { taxable_value: 0, gst_amount: 0, round_off: 0, invoice_total: 0 };
  const rawTotalsGst = Number(totals.gst_amount || 0);
  const rawTotalsTaxable = totals.taxable_value !== null && totals.taxable_value !== undefined ? Number(totals.taxable_value) : null;
  const rawInvoiceTotal = Number(totals.invoice_total || 0);

  const items = Array.isArray(data.items) ? data.items : [];
  const taxedItems = items.filter((it) => Number(it.gst_amount || 0) > 0 || Number(it.gst_rate || 0) > 0);

  if (data.tax_status === 'NO_TAX') {
    return {
      taxableBase: 0,
      gstAmount: 0,
      invoiceTotal: rawInvoiceTotal || rawTotalsTaxable || 0
    };
  }

  // Prefer line-item taxed subset when line items accurately account for the GST charged
  if (taxedItems.length > 0 && rawTotalsGst > 0) {
    let itemTaxedBase = 0;
    let itemGstSum = 0;
    for (const it of taxedItems) {
      const itGst = Number(it.gst_amount || 0);
      const itBase = it.taxable_value !== null && it.taxable_value !== undefined ? Number(it.taxable_value) : 0;
      itemTaxedBase += itBase;
      itemGstSum += itGst;
    }

    if (itemGstSum > 0 && Math.abs(itemGstSum - rawTotalsGst) <= 0.5 && itemTaxedBase > 0) {
      return {
        taxableBase: Number(itemTaxedBase.toFixed(2)),
        gstAmount: Number(rawTotalsGst.toFixed(2)),
        invoiceTotal: rawInvoiceTotal || Number(((rawTotalsTaxable ?? itemTaxedBase) + rawTotalsGst).toFixed(2))
      };
    }
  }

  if (rawTotalsGst <= 0) {
    return {
      taxableBase: 0,
      gstAmount: 0,
      invoiceTotal: rawInvoiceTotal || rawTotalsTaxable || 0
    };
  }

  let taxableBase = 0;
  if (data.tax_status === 'TAX_INCLUDED' && rawInvoiceTotal > rawTotalsGst && (rawTotalsTaxable === null || Math.abs(rawTotalsTaxable - rawInvoiceTotal) < 0.05)) {
    taxableBase = Number((rawInvoiceTotal - rawTotalsGst).toFixed(2));
  } else if (rawTotalsTaxable !== null && rawTotalsTaxable > 0) {
    taxableBase = Number(rawTotalsTaxable.toFixed(2));
  } else if (rawInvoiceTotal > rawTotalsGst) {
    taxableBase = Number((rawInvoiceTotal - rawTotalsGst).toFixed(2));
  } else {
    const rateRes = canonicalGstEngine.resolveGstRate(isoDate, billSector);
    taxableBase = Number((rawTotalsGst / rateRes.rate).toFixed(2));
  }

  return {
    taxableBase,
    gstAmount: Number(rawTotalsGst.toFixed(2)),
    invoiceTotal: rawInvoiceTotal || Number((taxableBase + rawTotalsGst).toFixed(2))
  };
}

/**
 * Converts uploaded BillRecord entries for a filing period into canonical GstTransactionInput[]
 * plus a transparent per-bill MIRA audit breakdown.
 */
export function convertBillsToGstInputs(params: {
  bills: BillRecord[];
  period: { startDate: string; endDate: string };
  targetSector: GstSector;
  myTin?: string;
  entityHasExemptSupplies?: boolean;
  apportionmentRatio?: number;
}): BillToGstConversionResult {
  const {
    bills,
    period,
    targetSector,
    myTin,
    entityHasExemptSupplies = false,
    apportionmentRatio = 1.0
  } = params;

  const transactions: GstTransactionInput[] = [];
  const auditItems: BillGstAuditItem[] = [];

  let totalBillsInPeriod = 0;
  let verifiedBillsInPeriod = 0;
  let includedBillsCount = 0;
  let pendingReviewCount = 0;
  let rejectedCount = 0;
  let excludedNoTaxCount = 0;
  let excludedOtherSectorCount = 0;

  for (const bill of bills) {
    const data = bill.verifiedData || bill.extractedData;
    if (!data) continue;

    const isoDate = normalizeBillDateToIso(data.invoice?.date, bill.uploadDate);
    if (isoDate < period.startDate || isoDate > period.endDate) {
      continue;
    }

    totalBillsInPeriod++;

    const supplierName = data.supplier?.name || 'Unknown Supplier';
    const supplierTin = data.supplier?.gstin || null;
    const invoiceNumber = data.invoice?.number || bill.fileName;
    const billSector: GstSector = isTourismBillData(data) ? 'TOURISM' : 'GENERAL';

    const { taxableBase, gstAmount, invoiceTotal } = extractTaxedBaseAndGst(data, billSector, isoDate);

    const warnings: string[] = [];
    if (data.document_type !== 'TAX_INVOICE' && data.document_type !== 'CAPITAL_EXPENDITURE') {
      warnings.push(`Document type is ${data.document_type} (MIRA Sec 41 recommends Tax Invoice)`);
    }
    if (!supplierTin) {
      warnings.push('Missing Supplier TIN');
    } else if (myTin && supplierTin.trim().toUpperCase() === myTin.trim().toUpperCase()) {
      warnings.push(`Supplier TIN (${supplierTin}) matches own taxpayer TIN`);
    }
    if (bill.validation?.duplicate_found) {
      warnings.push('Flagged as potential duplicate invoice');
    }

    if (bill.status === 'rejected') {
      rejectedCount++;
      auditItems.push({
        billId: bill.id,
        invoiceNumber,
        invoiceDate: isoDate,
        supplierName,
        supplierTin,
        outletId: bill.outlet_id,
        outletName: bill.outlet_name || bill.outlet_id,
        documentType: data.document_type,
        taxStatus: data.tax_status,
        status: bill.status,
        invoiceTotal,
        taxableBase,
        gstAmount,
        claimableGst: 0,
        blockedGst: 0,
        miraBox: 'Excluded',
        included: false,
        excludedReason: 'Bill rejected',
        warnings
      });
      continue;
    }

    if (bill.status !== 'verified') {
      pendingReviewCount++;
      auditItems.push({
        billId: bill.id,
        invoiceNumber,
        invoiceDate: isoDate,
        supplierName,
        supplierTin,
        outletId: bill.outlet_id,
        outletName: bill.outlet_name || bill.outlet_id,
        documentType: data.document_type,
        taxStatus: data.tax_status,
        status: bill.status,
        invoiceTotal,
        taxableBase,
        gstAmount,
        claimableGst: 0,
        blockedGst: 0,
        miraBox: 'Pending Review',
        included: false,
        excludedReason: 'Pending verification — verify bill before claiming on MIRA return',
        warnings
      });
      continue;
    }

    verifiedBillsInPeriod++;

    if (billSector !== targetSector) {
      excludedOtherSectorCount++;
      auditItems.push({
        billId: bill.id,
        invoiceNumber,
        invoiceDate: isoDate,
        supplierName,
        supplierTin,
        outletId: bill.outlet_id,
        outletName: bill.outlet_name || bill.outlet_id,
        documentType: data.document_type,
        taxStatus: data.tax_status,
        status: bill.status,
        invoiceTotal,
        taxableBase,
        gstAmount,
        claimableGst: 0,
        blockedGst: 0,
        miraBox: billSector === 'TOURISM' ? 'MIRA 206 (Tourism)' : 'MIRA 205 (General)',
        included: false,
        excludedReason: `Bill belongs to ${billSector} GST sector`,
        warnings
      });
      continue;
    }

    if (gstAmount <= 0 || taxableBase <= 0) {
      excludedNoTaxCount++;
      auditItems.push({
        billId: bill.id,
        invoiceNumber,
        invoiceDate: isoDate,
        supplierName,
        supplierTin,
        outletId: bill.outlet_id,
        outletName: bill.outlet_name || bill.outlet_id,
        documentType: data.document_type,
        taxStatus: data.tax_status,
        status: bill.status,
        invoiceTotal,
        taxableBase: 0,
        gstAmount: 0,
        claimableGst: 0,
        blockedGst: 0,
        miraBox: 'Non-Taxable (0%)',
        included: false,
        excludedReason: 'No GST charged (0% / Exempt / Non-registered supplier)',
        warnings
      });
      continue;
    }

    const rateResolution = canonicalGstEngine.resolveGstRate(isoDate, targetSector);
    const isBlocked = isBlockedInputBill(data);
    const isCapEx = !isBlocked && isCapitalAssetBill(data);
    const isMixed = !isBlocked && !isCapEx && entityHasExemptSupplies && isOverheadBill(data);

    let transactionType: GstTransactionType = 'INPUT_TAX';
    let treatment: GstTreatment = 'GENERAL_INPUT_TAX';
    let isClaimable = true;
    let claimableGst = gstAmount;
    let blockedGst = 0;
    let miraBox = 'Box 8 (Standard Purchases)';

    if (isBlocked) {
      transactionType = 'BLOCKED_INPUT_TAX';
      treatment = 'BLOCKED_INPUT_TAX';
      isClaimable = false;
      claimableGst = 0;
      blockedGst = gstAmount;
      miraBox = 'Box 10 (Blocked Input Tax)';
    } else if (isCapEx) {
      transactionType = 'CAPITAL_INPUT_TAX';
      treatment = 'CAPITAL_INPUT_TAX';
      isClaimable = true;
      claimableGst = gstAmount;
      miraBox = 'Box 9 (Capital Purchases)';
    } else if (isMixed) {
      transactionType = 'INPUT_TAX';
      treatment = 'MIXED_USE_INPUT_TAX';
      isClaimable = true;
      claimableGst = Number((gstAmount * apportionmentRatio).toFixed(2));
      miraBox = 'Box 11 (Mixed-Use Apportionment)';
    }

    transactions.push({
      tenantId: bill.outlet_id || 'DEFAULT-TENANT',
      invoiceId: bill.id,
      transactionDate: isoDate,
      sector: targetSector,
      transactionType,
      treatment,
      description: `${supplierName} - ${invoiceNumber}`,
      taxableAmount: taxableBase,
      gstRate: rateResolution.rate,
      gstAmount,
      isInputTaxClaimable: isClaimable,
      isCapitalAsset: isCapEx,
      apportionmentRatio: isMixed ? apportionmentRatio : undefined,
      sourceDocumentNumber: invoiceNumber
    });

    includedBillsCount++;
    auditItems.push({
      billId: bill.id,
      invoiceNumber,
      invoiceDate: isoDate,
      supplierName,
      supplierTin,
      outletId: bill.outlet_id,
      outletName: bill.outlet_name || bill.outlet_id,
      documentType: data.document_type,
      taxStatus: data.tax_status,
      status: bill.status,
      invoiceTotal,
      taxableBase,
      gstAmount,
      claimableGst,
      blockedGst,
      miraBox,
      included: true,
      warnings
    });
  }

  return {
    transactions,
    auditItems,
    stats: {
      totalBillsInPeriod,
      verifiedBillsInPeriod,
      includedBillsCount,
      pendingReviewCount,
      rejectedCount,
      excludedNoTaxCount,
      excludedOtherSectorCount
    }
  };
}
