import { describe, test, expect } from 'vitest';
import {
  convertBillsToGstInputs,
  normalizeBillDateToIso
} from '../../src/services/gst/billToGstConverter';
import { canonicalGstEngine } from '../../src/services/gst/gstEngineService';
import { BillRecord, ExtractedBillData } from '../../src/types';

function makeBill(overrides: Partial<BillRecord> & { data?: Partial<ExtractedBillData> } = {}): BillRecord {
  const { data: dataOverrides, ...recordOverrides } = overrides;

  const baseData: ExtractedBillData = {
    document_type: 'TAX_INVOICE',
    tax_status: 'TAX_CHARGED',
    expense_category: 'Other',
    supplier: {
      name: 'Supplier Pvt Ltd',
      gstin: '1011757GST501',
      address: "Male', Maldives",
      phone: null
    },
    invoice: {
      number: 'INV-001',
      date: '24 JUN 2026',
      po_number: null,
      currency: 'MVR',
      gst_type: 'GST 8%'
    },
    items: [
      {
        id: '1',
        description: 'Taxable Supplies',
        quantity: 1,
        unit: 'LS',
        rate: 1000,
        discount: null,
        taxable_value: 1000,
        gst_rate: 8,
        gst_amount: 80,
        total: 1080
      }
    ],
    totals: {
      taxable_value: 1000,
      gst_amount: 80,
      round_off: 0,
      invoice_total: 1080
    },
    notes: null,
    ...dataOverrides
  };

  return {
    id: 'bill-test-1',
    outlet_id: 'outlet-1',
    outlet_name: "Male' Main Branch",
    fileName: 'invoice.pdf',
    fileType: 'application/pdf',
    fileSize: 1024,
    fileUrl: '/uploads/invoice.pdf',
    uploadDate: '2026-06-24T10:00:00.000Z',
    status: 'verified',
    ocr_status: 'APPROVED',
    ocr_attempts: 1,
    needs_review: false,
    extractedData: baseData,
    verifiedData: baseData,
    confidence: {
      supplier_name: 95,
      supplier_tin: 95,
      invoice_number: 95,
      invoice_date: 95,
      taxable_value: 95,
      gst_amount: 95,
      invoice_total: 95,
      line_items: 95,
      overall: 95
    },
    validation: {
      is_valid: true,
      issues: [],
      duplicate_found: false
    },
    quarter: '2026-Q2',
    year: 2026,
    updatedAt: '2026-06-24T10:00:00.000Z',
    ...recordOverrides
  };
}

describe('Bill-to-GST MIRA 205/206 Converter', () => {
  test('normalizes Maldivian, ISO, and DMY dates without UTC shift', () => {
    expect(normalizeBillDateToIso('24 JUN 2026')).toBe('2026-06-24');
    expect(normalizeBillDateToIso('10 AUG 2026')).toBe('2026-08-10');
    expect(normalizeBillDateToIso('2026-03-05')).toBe('2026-03-05');
    expect(normalizeBillDateToIso('24/06/2026')).toBe('2026-06-24');
  });

  test('isolates taxed line items from 0% Customs Duty & Delivery Order fees (Lion Logistics case)', () => {
    const lionBill = makeBill({
      id: 'bill-lion',
      data: {
        supplier: { name: 'LION LOGISTICS PVT LTD', gstin: '1011757GST501', address: null, phone: null },
        invoice: { number: 'L26/1178', date: '24 JUN 2026', po_number: null, currency: 'MVR', gst_type: 'GST 8%' },
        items: [
          { id: '1', description: 'Customs Clearance', quantity: 1, unit: null, rate: 500, discount: null, taxable_value: 500, gst_rate: 8, gst_amount: 40, total: 540 },
          { id: '2', description: 'Transportation Fee', quantity: 1, unit: null, rate: 250, discount: null, taxable_value: 250, gst_rate: 8, gst_amount: 20, total: 270 },
          { id: '3', description: 'Delivery Order Fee (0%)', quantity: 1, unit: null, rate: 167.40, discount: null, taxable_value: 167.40, gst_rate: 0, gst_amount: 0, total: 167.40 },
          { id: '4', description: 'Customs Duty', quantity: 1, unit: null, rate: 176.31, discount: null, taxable_value: 176.31, gst_rate: 0, gst_amount: 0, total: 176.31 }
        ],
        totals: { taxable_value: 1093.71, gst_amount: 60, round_off: 0, invoice_total: 1153.71 }
      }
    });

    const result = convertBillsToGstInputs({
      bills: [lionBill],
      period: { startDate: '2026-06-01', endDate: '2026-06-30' },
      targetSector: 'GENERAL',
      myTin: '1133533GST501'
    });

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].taxableAmount).toBe(750);
    expect(result.transactions[0].gstAmount).toBe(60);
    expect(result.transactions[0].treatment).toBe('GENERAL_INPUT_TAX');

    const mira205 = canonicalGstEngine.generateMira205Return({
      transactions: result.transactions,
      taxpayer: { tin: '1133533GST501', name: "Male' Main Branch" },
      period: { periodName: '2026-M06', startDate: '2026-06-01', endDate: '2026-06-30', taxYear: 2026 }
    });

    expect(mira205.sectionB_Purchases.box8_StandardRatedPurchases.taxableValue).toBe(750);
    expect(mira205.sectionB_Purchases.box8_StandardRatedPurchases.inputTax).toBe(60);
    expect(mira205.sectionB_Purchases.box14_NetClaimableInputTax).toBe(60);
    expect(mira205.sectionC_Calculation.box17_FinalAmountPayableOrRefundable).toBe(-60);
  });

  test('returns all zeros for periods with no uploaded bills', () => {
    const augBill = makeBill({
      data: {
        invoice: { number: 'PO202608-05528', date: '10 AUG 2026', po_number: null, currency: 'MVR', gst_type: 'GST 8%' }
      }
    });

    const result = convertBillsToGstInputs({
      bills: [augBill],
      period: { startDate: '2026-01-01', endDate: '2026-01-31' },
      targetSector: 'GENERAL'
    });

    expect(result.transactions).toHaveLength(0);
    expect(result.auditItems).toHaveLength(0);

    const mira205 = canonicalGstEngine.generateMira205Return({
      transactions: result.transactions,
      taxpayer: { tin: '1133533GST501', name: "Male' Main Branch" },
      period: { periodName: '2026-M01', startDate: '2026-01-01', endDate: '2026-01-31', taxYear: 2026 }
    });

    expect(mira205.sectionA_Supplies.box7_NetOutputTax).toBe(0);
    expect(mira205.sectionB_Purchases.box14_NetClaimableInputTax).toBe(0);
    expect(mira205.sectionC_Calculation.box17_FinalAmountPayableOrRefundable).toBe(0);
  });

  test('excludes pending_review, rejected, and NO_TAX bills from claimable input tax', () => {
    const pendingBill = makeBill({ id: 'b-pending', status: 'pending_review' });
    const rejectedBill = makeBill({ id: 'b-rejected', status: 'rejected' });
    const noTaxBill = makeBill({
      id: 'b-notax',
      data: {
        tax_status: 'NO_TAX',
        totals: { taxable_value: 500, gst_amount: 0, round_off: 0, invoice_total: 500 }
      }
    });

    const result = convertBillsToGstInputs({
      bills: [pendingBill, rejectedBill, noTaxBill],
      period: { startDate: '2026-06-01', endDate: '2026-06-30' },
      targetSector: 'GENERAL'
    });

    expect(result.transactions).toHaveLength(0);
    expect(result.stats.pendingReviewCount).toBe(1);
    expect(result.stats.rejectedCount).toBe(1);
    expect(result.stats.excludedNoTaxCount).toBe(1);
  });

  test('routes Capital Assets to Box 9 and Blocked Sec 22(b) expenses to Box 10', () => {
    const capExBill = makeBill({
      id: 'b-capex',
      data: {
        document_type: 'CAPITAL_EXPENDITURE',
        mira_schedule1_category: 'Capital Asset (Schedule 2)',
        items: [],
        totals: { taxable_value: 10000, gst_amount: 800, round_off: 0, invoice_total: 10800 }
      }
    });

    const entertainmentBill = makeBill({
      id: 'b-blocked',
      data: {
        income_tax_treatment: 'NON_DEDUCTIBLE',
        notes: 'Client entertainment dinner',
        items: [],
        totals: { taxable_value: 2000, gst_amount: 160, round_off: 0, invoice_total: 2160 }
      }
    });

    const result = convertBillsToGstInputs({
      bills: [capExBill, entertainmentBill],
      period: { startDate: '2026-06-01', endDate: '2026-06-30' },
      targetSector: 'GENERAL'
    });

    const mira205 = canonicalGstEngine.generateMira205Return({
      transactions: result.transactions,
      taxpayer: { tin: '1133533GST501', name: "Male' Main Branch" },
      period: { periodName: '2026-M06', startDate: '2026-06-01', endDate: '2026-06-30', taxYear: 2026 }
    });

    expect(mira205.sectionB_Purchases.box9_CapitalPurchases.taxableValue).toBe(10000);
    expect(mira205.sectionB_Purchases.box9_CapitalPurchases.inputTax).toBe(800);
    expect(mira205.sectionB_Purchases.box10_BlockedInputTax.taxableValue).toBe(2000);
    expect(mira205.sectionB_Purchases.box10_BlockedInputTax.blockedTax).toBe(160);
    // Blocked input tax is excluded from Box 14 claimable input tax
    expect(mira205.sectionB_Purchases.box14_NetClaimableInputTax).toBe(800);
  });

  test('flags compliance warnings for own TIN and non-TAX_INVOICE documents while handling TAX_INCLUDED totals', () => {
    const ownTinBill = makeBill({
      id: 'b-lightstudio',
      data: {
        document_type: 'OTHER',
        tax_status: 'TAX_INCLUDED',
        supplier: { name: 'Light Studio', gstin: '1133533GST501', address: null, phone: null },
        invoice: { number: 'PO202608-05528', date: '10 AUG 2026', po_number: null, currency: 'MVR', gst_type: 'GST 8%' },
        items: [],
        totals: { taxable_value: 42525, gst_amount: 3150, round_off: 0, invoice_total: 42525 }
      }
    });

    const result = convertBillsToGstInputs({
      bills: [ownTinBill],
      period: { startDate: '2026-08-01', endDate: '2026-08-31' },
      targetSector: 'GENERAL',
      myTin: '1133533GST501'
    });

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].taxableAmount).toBe(39375);
    expect(result.transactions[0].gstAmount).toBe(3150);
    expect(result.auditItems[0].warnings.some((w) => w.includes('matches own taxpayer TIN'))).toBe(true);
    expect(result.auditItems[0].warnings.some((w) => w.includes('MIRA Sec 41'))).toBe(true);
  });

  test('applies Box 11 Mixed-Use pro-rata apportionment when entity has exempt supplies', () => {
    const utilitiesBill = makeBill({
      id: 'b-util',
      data: {
        expense_category: 'Utilities',
        items: [],
        totals: { taxable_value: 1000, gst_amount: 80, round_off: 0, invoice_total: 1080 }
      }
    });

    const result = convertBillsToGstInputs({
      bills: [utilitiesBill],
      period: { startDate: '2026-06-01', endDate: '2026-06-30' },
      targetSector: 'GENERAL',
      entityHasExemptSupplies: true,
      apportionmentRatio: 0.75
    });

    expect(result.transactions[0].treatment).toBe('MIXED_USE_INPUT_TAX');
    expect(result.auditItems[0].claimableGst).toBe(60);
    expect(result.auditItems[0].miraBox).toContain('Box 11');
  });
});
