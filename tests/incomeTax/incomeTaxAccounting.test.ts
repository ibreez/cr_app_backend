import { describe, test, expect, beforeEach } from 'vitest';
import { Decimal } from 'decimal.js';
import { MIRA604IntegrationService } from '../../src/services/tax/mira604IntegrationService';
import { defaultIncomeTaxEngine } from '../../src/services/tax/incomeTaxEngineService';
import {
  calculateCapitalAllowance,
  generateSchedule2CapitalAllowanceSummary
} from '../../src/services/tax/capitalAllowanceService';
import { TaxLossLotEngine } from '../../src/services/tax/taxLossLotEngine';
import { createTaxAdjustment } from '../../src/services/tax/taxAdjustmentService';
import { PeriodControlService } from '../../src/services/accounting/periodControlService';
import { UserSession } from '../../src/types/rbac';

describe('Income Tax & Accounting Integration Golden Test Suite (IT-001 to IT-016 & Part Y Security)', { timeout: 60000 }, () => {
  const tenantId = 'TENANT-IT-GOLDEN';
  const taxYear = 2024;

  const adminSession: UserSession = {
    userId: 'USR-ADMIN-GOLDEN',
    tenantId,
    role: 'CLIENT_ADMIN'
  };

  const taxManagerSession: UserSession = {
    userId: 'USR-TAX-MGR',
    tenantId,
    role: 'TAX_MANAGER'
  };

  const staffSession: UserSession = {
    userId: 'USR-STAFF-1',
    tenantId,
    role: 'STAFF' as any
  };

  const foreignTenantSession: UserSession = {
    userId: 'USR-FOREIGN',
    tenantId: 'TENANT-FOREIGN-CORP',
    role: 'CLIENT_ADMIN'
  };

  beforeEach(() => {
    // Clear in-memory store for isolation
    MIRA604IntegrationService.memoryStore.clear();
    PeriodControlService.resetStore();
  });

  // ==========================================
  // PART 1 — IT-001 TO IT-016 SPECIFICATION TESTS
  // ==========================================

  describe('IT-001: GL/P&L profit flows exactly into tax calculation', () => {
    test('ensures accounting profit before tax derived from GL flows into tax starting profit with zero variance', async () => {
      const glProfit = 845210.75;
      const result = await MIRA604IntegrationService.calculateAndPrepareReturn(
        {
          tenantId,
          taxYear,
          tin: '1000200300',
          taxpayerName: 'Golden Taxpayer Ltd',
          entityType: 'COMPANY',
          overrideAccountingProfit: glProfit
        },
        adminSession
      );

      expect(result.accountingProfitBeforeTax).toBe(glProfit);
      expect(result.mira604.sectionB_Schedule1PnL.accountingProfitBeforeTax).toBe(glProfit);
      expect(result.trace.accountingProfitTrace.profitBeforeTax).toBe(glProfit);
      expect(result.reconciliation.items.find(i => i.code === 'GL_VS_TAX_PROFIT')?.variance).toBe(0);
      expect(result.reconciliation.items.find(i => i.code === 'GL_VS_TAX_PROFIT')?.status).toBe('PASS');
    });
  });

  describe('IT-002: Schedule 1 agrees with authoritative P&L', () => {
    test('validates line-by-line concordance between Schedule 1 and General Ledger P&L', async () => {
      const result = await MIRA604IntegrationService.calculateAndPrepareReturn(
        {
          tenantId,
          taxYear,
          tin: '1000200300',
          taxpayerName: 'Golden Taxpayer Ltd',
          entityType: 'COMPANY',
          overrideAccountingProfit: 500000.00
        },
        adminSession
      );

      const schedule1 = result.mira604.sectionB_Schedule1PnL;
      expect(schedule1).toBeDefined();
      expect(schedule1.accountingProfitBeforeTax).toBe(500000.00);

      // Verify reconciliation check
      const reconItem = result.reconciliation.items.find(i => i.code === 'GL_VS_TAX_PROFIT');
      expect(reconItem).toBeDefined();
      expect(reconItem?.status).toBe('PASS');
      expect(reconItem?.sourceSystem).toBe('General Ledger P&L');
      expect(reconItem?.targetSystem).toBe('MIRA 604 Schedule 1');
    });
  });

  describe('IT-003: A valid tax ADDITION increases taxable income exactly', () => {
    test('verifies statutory non-deductible add-back increases taxable income by exact amount', async () => {
      const startingProfit = 400000.00;
      const additionAmount = 35000.50;

      const adjustments = [
        createTaxAdjustment({
          miraCode: 'ADJ-FINES',
          amount: additionAmount,
          reason: 'Statutory late filing fines',
          direction: 'ADD_BACK'
        })
      ];

      const result = await MIRA604IntegrationService.calculateAndPrepareReturn(
        {
          tenantId,
          taxYear,
          tin: '1000200300',
          taxpayerName: 'Golden Taxpayer Ltd',
          entityType: 'COMPANY',
          overrideAccountingProfit: startingProfit,
          overrideAdjustments: adjustments as any
        },
        adminSession
      );

      const expectedAdjustedProfit = new Decimal(startingProfit).plus(additionAmount).toNumber();
      expect(result.totalAdditions).toBe(additionAmount);
      expect(result.mira604.sectionC_TaxAdjustments.totalAddBacks).toBe(additionAmount);
      expect(result.mira604.sectionE_TaxableIncomeLoss.adjustedTaxableProfitBeforeLoss).toBe(expectedAdjustedProfit);
      expect(result.finalTaxableIncome).toBe(expectedAdjustedProfit);
    });
  });

  describe('IT-004: A valid tax DEDUCTION decreases taxable income exactly', () => {
    test('verifies allowable statutory deduction decreases taxable income by exact amount', async () => {
      const startingProfit = 600000.00;
      const deductionAmount = 45000.25;

      const adjustments = [
        createTaxAdjustment({
          miraCode: 'ADJ-OTHER',
          amount: deductionAmount,
          reason: 'Exempt foreign dividend income',
          direction: 'DEDUCTION'
        })
      ];

      const result = await MIRA604IntegrationService.calculateAndPrepareReturn(
        {
          tenantId,
          taxYear,
          tin: '1000200300',
          taxpayerName: 'Golden Taxpayer Ltd',
          entityType: 'COMPANY',
          overrideAccountingProfit: startingProfit,
          overrideAdjustments: adjustments as any
        },
        adminSession
      );

      const expectedAdjustedProfit = new Decimal(startingProfit).minus(deductionAmount).toNumber();
      expect(result.totalDeductions).toBe(deductionAmount);
      expect(result.mira604.sectionC_TaxAdjustments.totalDeductions).toBe(deductionAmount);
      expect(result.mira604.sectionE_TaxableIncomeLoss.adjustedTaxableProfitBeforeLoss).toBe(expectedAdjustedProfit);
      expect(result.finalTaxableIncome).toBe(expectedAdjustedProfit);
    });
  });

  describe('IT-005: Accounting depreciation does not equal/overwrite tax capital allowance', () => {
    test('ensures accounting depreciation is added back and tax capital allowance claimed separately without collision', async () => {
      const startingProfit = 500000.00;
      const acctDepreciation = 75000.00;

      // 1. Accounting depreciation addback
      const adjustments = [
        createTaxAdjustment({
          miraCode: 'ADJ-DEPR',
          amount: acctDepreciation,
          reason: 'Accounting depreciation add-back',
          direction: 'ADD_BACK'
        })
      ];

      // 2. Separate tax capital allowance asset (Motor Vehicles: Class 2, 20% rate)
      const fixedAssets = [
        {
          assetId: 'VEH-001',
          name: 'Delivery Van',
          assetClass: 'MOTOR_VEHICLES_VESSELS' as any,
          cost: 200000.00,
          purchaseDate: '2024-01-15',
          taxYear: 2024
        }
      ];

      const result = await MIRA604IntegrationService.calculateAndPrepareReturn(
        {
          tenantId,
          taxYear,
          tin: '1000200300',
          taxpayerName: 'Golden Taxpayer Ltd',
          entityType: 'COMPANY',
          overrideAccountingProfit: startingProfit,
          overrideAdjustments: adjustments as any,
          fixedAssetsList: fixedAssets
        },
        adminSession
      );

      // Capital allowance for 200k @ 20% = 40,000
      const expectedCA = 40000.00;

      // Additions must have 75k addback
      expect(result.totalAdditions).toBe(acctDepreciation);
      // Capital allowance must be claimed separately under Schedule 2
      expect(result.capitalAllowanceTotal).toBe(expectedCA);
      expect(result.mira604.sectionD_Schedule2CapitalAllowance.totalAllowanceClaimed).toBe(expectedCA);

      // Section E: 500,000 + 75,000 (addback) - 40,000 (tax CA) = 535,000
      const expectedTaxableIncome = 500000 + 75000 - 40000;
      expect(result.mira604.sectionE_TaxableIncomeLoss.adjustedTaxableProfitBeforeLoss).toBe(expectedTaxableIncome);
      expect(result.finalTaxableIncome).toBe(expectedTaxableIncome);
    });
  });

  describe('IT-006: Capital allowance calculation is traceable to asset/source expenditure', () => {
    test('traces capital allowance claims back to individual asset master records and acquisition cost', async () => {
      const fixedAssets = [
        {
          assetId: 'ASSET-PLANT-01',
          name: 'Industrial Generator',
          assetClass: 'PLANT_MACHINERY' as any,
          cost: 150000.00,
          purchaseDate: '2024-02-01',
          taxYear: 2024
        }
      ];

      const result = await MIRA604IntegrationService.calculateAndPrepareReturn(
        {
          tenantId,
          taxYear,
          tin: '1000200300',
          taxpayerName: 'Golden Taxpayer Ltd',
          entityType: 'COMPANY',
          overrideAccountingProfit: 300000,
          fixedAssetsList: fixedAssets
        },
        adminSession
      );

      const caTrace = result.trace.capitalAllowancesTrace;
      expect(caTrace).toBeDefined();
      expect(caTrace.assetsCount).toBe(1);
      expect(caTrace.schedule2Summary.assetResults).toHaveLength(1);

      const assetDetail = caTrace.schedule2Summary.assetResults[0];
      expect(assetDetail.assetId).toBe('ASSET-PLANT-01');
      expect(assetDetail.cost).toBe(150000.00);
      expect(assetDetail.rate).toBe(20);
      expect(assetDetail.claimableAllowance).toBe(30000.00);
      expect(assetDetail.closingWDV).toBe(120000.00);
    });
  });

  describe('IT-007: Asset disposal produces correct balancing allowance/charge under the implemented rule', () => {
    test('computes statutory balancing charge when disposal proceeds exceed written-down value', () => {
      // Asset Cost 100,000, Opening WDV 60,000, Sold for 75,000 -> Balancing charge = 15,000
      const asset = {
        assetId: 'DISP-001',
        name: 'Office Equipment',
        assetClass: 'OFFICE_EQUIPMENT' as any,
        cost: 100000,
        purchaseDate: '2022-01-01',
        disposalDate: '2024-06-15',
        disposalProceeds: 75000,
        taxYear: 2024
      };

      const res = calculateCapitalAllowance(asset, 2024, 60000);
      expect(res.balancingCharge).toBe(15000);
      expect(res.balancingAllowance).toBe(0);
      expect(res.allowanceClaimed).toBe(0);
      expect(res.closingWDV).toBe(0);
    });

    test('computes statutory balancing allowance when disposal proceeds are less than written-down value', () => {
      // Asset Cost 100,000, Opening WDV 60,000, Sold for 40,000 -> Balancing allowance = 20,000
      const asset = {
        assetId: 'DISP-002',
        name: 'Office Equipment',
        assetClass: 'OFFICE_EQUIPMENT' as any,
        cost: 100000,
        purchaseDate: '2022-01-01',
        disposalDate: '2024-06-15',
        disposalProceeds: 40000,
        taxYear: 2024
      };

      const res = calculateCapitalAllowance(asset, 2024, 60000);
      expect(res.balancingAllowance).toBe(20000);
      expect(res.balancingCharge).toBe(0);
      expect(res.allowanceClaimed).toBe(0);
      expect(res.closingWDV).toBe(0);
    });
  });

  describe('IT-008: Loss carry-forward/utilization is correctly calculated', () => {
    test('absorbs prior year losses up to 100% of profit under Section 30 5-year limit', async () => {
      const priorLosses = [
        { year: 2022, lossAmount: 120000, utilisedAmount: 20000 }, // Remaining 100,000 (age 2 yrs)
        { year: 2023, lossAmount: 80000, utilisedAmount: 0 }      // Remaining 80,000 (age 1 yr)
      ];

      const currentProfit = 150000;

      const result = await MIRA604IntegrationService.calculateAndPrepareReturn(
        {
          tenantId,
          taxYear: 2024,
          tin: '1000200300',
          taxpayerName: 'Golden Taxpayer Ltd',
          entityType: 'COMPANY',
          overrideAccountingProfit: currentProfit,
          priorLossRecords: priorLosses
        },
        adminSession
      );

      // Total available valid losses = 100k + 80k = 180k
      // Profit = 150k, so loss absorbed = 150k, net taxable income = 0
      expect(result.mira604.sectionE_TaxableIncomeLoss.lossReliefApplied).toBe(150000);
      expect(result.finalTaxableIncome).toBe(0);
      expect(result.finalTaxPayable).toBe(0);
    });

    test('expires losses older than 5 years per Section 30 rules', async () => {
      const priorLosses = [
        { year: 2018, lossAmount: 200000, utilisedAmount: 0 }, // Age = 2024 - 2018 = 6 yrs (EXPIRED)
        { year: 2023, lossAmount: 50000, utilisedAmount: 0 }    // Age = 1 yr (VALID)
      ];

      const currentProfit = 100000;

      const result = await MIRA604IntegrationService.calculateAndPrepareReturn(
        {
          tenantId,
          taxYear: 2024,
          tin: '1000200300',
          taxpayerName: 'Golden Taxpayer Ltd',
          entityType: 'COMPANY',
          overrideAccountingProfit: currentProfit,
          priorLossRecords: priorLosses
        },
        adminSession
      );

      // Only the 50k from 2023 can be absorbed; the 200k from 2018 is expired
      expect(result.mira604.sectionE_TaxableIncomeLoss.lossReliefApplied).toBe(50000);
      expect(result.finalTaxableIncome).toBe(50000);
    });
  });

  describe('IT-009: MIRA 604 taxable-income fields equal tax-calculation snapshot', () => {
    test('confirms exact equality between engine snapshot and MIRA 604 form taxable income fields', async () => {
      const result = await MIRA604IntegrationService.calculateAndPrepareReturn(
        {
          tenantId,
          taxYear,
          tin: '1000200300',
          taxpayerName: 'Golden Taxpayer Ltd',
          entityType: 'COMPANY',
          overrideAccountingProfit: 750000
        },
        adminSession
      );

      expect(result.finalTaxableIncome).toBe(result.mira604.sectionE_TaxableIncomeLoss.netTaxableIncome);
      expect(result.finalTaxableIncome).toBe(result.mira604.sectionE_TaxableIncomeLoss.adjustedTaxableProfitBeforeLoss);

      const taxableIncomeRecon = result.reconciliation.items.find(i => i.code === 'TAX_ENGINE_VS_MIRA604_TAXABLE_INCOME');
      expect(taxableIncomeRecon?.status).toBe('PASS');
      expect(taxableIncomeRecon?.variance).toBe(0);
    });
  });

  describe('IT-010: MIRA 604 tax-payable fields equal tax-calculation snapshot', () => {
    test('confirms exact equality between engine snapshot and MIRA 604 form tax payable fields', async () => {
      const result = await MIRA604IntegrationService.calculateAndPrepareReturn(
        {
          tenantId,
          taxYear,
          tin: '1000200300',
          taxpayerName: 'Golden Taxpayer Ltd',
          entityType: 'COMPANY',
          overrideAccountingProfit: 1000000
        },
        adminSession
      );

      // For company: (1,000,000 - 500,000) * 15% = 75,000
      expect(result.finalTaxPayable).toBe(75000);
      expect(result.finalTaxPayable).toBe(result.mira604.sectionF_TaxCalculation.grossTaxLiability);
      expect(result.finalTaxPayable).toBe(result.mira604.sectionF_TaxCalculation.netTaxPayableOrRefundable);

      const taxPayableRecon = result.reconciliation.items.find(i => i.code === 'TAX_ENGINE_VS_MIRA604_TAX_PAYABLE');
      expect(taxPayableRecon?.status).toBe('PASS');
      expect(taxPayableRecon?.variance).toBe(0);
    });
  });

  describe('IT-011: Tax credits/payments reconcile to authoritative source records', () => {
    test('reconciles advance tax, interim payments, and withholding tax against gross tax liability', async () => {
      const result = await MIRA604IntegrationService.calculateAndPrepareReturn(
        {
          tenantId,
          taxYear,
          tin: '1000200300',
          taxpayerName: 'Golden Taxpayer Ltd',
          entityType: 'COMPANY',
          overrideAccountingProfit: 2000000, // Gross Tax = (2,000,000 - 500,000) * 15% = 225,000
          advanceTaxPaid: 50000,
          interimTaxPaid: 75000,
          withholdingTaxDeducted: 25000
        },
        adminSession
      );

      const secF = result.mira604.sectionF_TaxCalculation;
      expect(secF.grossTaxLiability).toBe(225000);
      expect(secF.advanceTaxPaid).toBe(50000);
      expect(secF.interimTaxPaid).toBe(75000);
      expect(secF.withholdingTaxDeducted).toBe(25000);

      // Net = 225,000 - (50k + 75k + 25k) = 75,000
      expect(secF.netTaxPayableOrRefundable).toBe(75000);
      expect(result.finalTaxPayable).toBe(75000);
    });
  });

  describe('IT-012: Finalized return snapshot does not change when source accounting records later change', () => {
    test('guarantees sealed immutability of finalized tax returns against later modifications', async () => {
      const immutTenant = 'TENANT-IMMUTABLE-TEST';
      const immutAdmin: UserSession = { userId: 'USR-ADMIN', tenantId: immutTenant, role: 'CLIENT_ADMIN' };

      // 1. Calculate & prepare
      await MIRA604IntegrationService.calculateAndPrepareReturn(
        {
          tenantId: immutTenant,
          taxYear: 2024,
          tin: '1000200300',
          taxpayerName: 'Immutable Corp Ltd',
          entityType: 'COMPANY',
          overrideAccountingProfit: 600000
        },
        immutAdmin
      );

      // 2. Approve
      await MIRA604IntegrationService.approveReturn(immutTenant, 2024, immutAdmin);

      // 3. Finalize
      const finalized = await MIRA604IntegrationService.finalizeReturn(immutTenant, 2024, immutAdmin);
      expect(finalized.status).toBe('FINALIZED');
      expect(finalized.isFinalized).toBe(true);
      const snapshotTaxableIncome = finalized.finalTaxableIncome;

      // 4. Attempt to mutate/recalculate without isAmendment
      await expect(
        MIRA604IntegrationService.calculateAndPrepareReturn(
          {
            tenantId: immutTenant,
            taxYear: 2024,
            overrideAccountingProfit: 99999999,
            isAmendment: false
          },
          immutAdmin
        )
      ).rejects.toThrow(/FINALIZED and immutable/);

      // 5. Verify snapshot remains identical in store
      const fetched = await MIRA604IntegrationService.getReturn(immutTenant, 2024, immutAdmin);
      expect(fetched?.finalTaxableIncome).toBe(snapshotTaxableIncome);
      expect(fetched?.isFinalized).toBe(true);
    });
  });

  describe('IT-013: Return revision creates a new traceable version', () => {
    test('creates incremented version (V2) when an amendment is filed for a finalized return', async () => {
      const amendTenant = 'TENANT-AMEND-TEST';
      const amendAdmin: UserSession = { userId: 'USR-ADMIN', tenantId: amendTenant, role: 'CLIENT_ADMIN' };

      // Initial return
      await MIRA604IntegrationService.calculateAndPrepareReturn(
        {
          tenantId: amendTenant,
          taxYear: 2024,
          tin: '1000200300',
          taxpayerName: 'Amended Corp Ltd',
          entityType: 'COMPANY',
          overrideAccountingProfit: 500000
        },
        amendAdmin
      );
      await MIRA604IntegrationService.approveReturn(amendTenant, 2024, amendAdmin);
      await MIRA604IntegrationService.finalizeReturn(amendTenant, 2024, amendAdmin);

      // File amendment revision with isAmendment: true
      const v2Return = await MIRA604IntegrationService.calculateAndPrepareReturn(
        {
          tenantId: amendTenant,
          taxYear: 2024,
          tin: '1000200300',
          taxpayerName: 'Amended Corp Ltd',
          entityType: 'COMPANY',
          overrideAccountingProfit: 700000,
          isAmendment: true
        },
        amendAdmin
      );

      expect(v2Return.version).toBe(2);
      expect(v2Return.returnId).toContain('-V2');
      expect(v2Return.accountingProfitBeforeTax).toBe(700000);
    });
  });

  describe('IT-014: Tax-rule version is stored with the calculation', () => {
    test('preserves authoritative statutory rule version inside the calculation snapshot and trace', async () => {
      const result = await MIRA604IntegrationService.calculateAndPrepareReturn(
        {
          tenantId,
          taxYear,
          tin: '1000200300',
          taxpayerName: 'Golden Taxpayer Ltd',
          entityType: 'COMPANY',
          overrideAccountingProfit: 500000
        },
        adminSession
      );

      expect(result.ruleVersion).toBeDefined();
      expect(result.ruleVersion).toContain('MIRA');
      expect(result.trace.ruleSetVersion).toBe(result.ruleVersion);
    });
  });

  describe('IT-015: Taxpayer classification changes the applicable calculation path', () => {
    test('applies corporate 15% flat threshold vs sole proprietor progressive brackets correctly', async () => {
      const taxableProfit = 1500000;

      // 1. Company calculation
      const companyResult = await MIRA604IntegrationService.calculateAndPrepareReturn(
        {
          tenantId,
          taxYear,
          tin: '1000200300',
          taxpayerName: 'Company Taxpayer Ltd',
          entityType: 'COMPANY',
          overrideAccountingProfit: taxableProfit
        },
        adminSession
      );

      // Company: (1,500,000 - 500,000) * 15% = 150,000
      expect(companyResult.finalTaxPayable).toBe(150000);

      // 2. Sole Proprietor calculation
      const solePropResult = await MIRA604IntegrationService.calculateAndPrepareReturn(
        {
          tenantId: 'TENANT-SOLE-PROP',
          taxYear,
          tin: '1000200300',
          taxpayerName: 'Ahmed Sole Proprietor',
          entityType: 'SOLE_PROPRIETOR',
          overrideAccountingProfit: taxableProfit
        },
        { ...adminSession, tenantId: 'TENANT-SOLE-PROP' }
      );

      // Sole Proprietor progressive brackets:
      // 0 to 720k: 0%
      // 720k to 1.2m (480k): 5.5% = 26,400
      // 1.2m to 1.5m (300k): 8% = 24,000
      // Total = 26,400 + 24,000 = 50,400
      expect(solePropResult.finalTaxPayable).toBe(50400);

      expect(companyResult.finalTaxPayable).not.toBe(solePropResult.finalTaxPayable);
    });
  });

  describe('IT-016: Missing mandatory information produces REVIEW_REQUIRED rather than invented zero', () => {
    test('produces REVIEW_REQUIRED status when mandatory TIN or Taxpayer Name is missing', async () => {
      const result = await MIRA604IntegrationService.calculateAndPrepareReturn(
        {
          tenantId: 'TENANT-MISSING-TIN',
          taxYear,
          tin: '', // Empty TIN
          taxpayerName: '', // Empty Taxpayer Name
          overrideAccountingProfit: 500000
        },
        { ...adminSession, tenantId: 'TENANT-MISSING-TIN' }
      );

      expect(result.status).toBe('REVIEW_REQUIRED');
      const criticalReview = result.reviewItems.filter(r => r.severity === 'CRITICAL');
      expect(criticalReview.length).toBeGreaterThanOrEqual(2);
      expect(criticalReview.some(r => r.code === 'MISSING_TIN')).toBe(true);
      expect(criticalReview.some(r => r.code === 'MISSING_TAXPAYER_NAME')).toBe(true);
    });
  });

  // ==========================================
  // PART Y — FAILURE / SECURITY TESTS (21 TESTS)
  // ==========================================

  describe('Part Y: Failure & Security Safeguards', () => {
    test('1. invalid tax year: rejects non-numeric, out-of-bounds, or NaN tax years', async () => {
      await expect(
        MIRA604IntegrationService.calculateAndPrepareReturn(
          { tenantId, taxYear: 1999 },
          adminSession
        )
      ).rejects.toThrow(/Invalid taxYear/);

      await expect(
        MIRA604IntegrationService.calculateAndPrepareReturn(
          { tenantId, taxYear: 2101 },
          adminSession
        )
      ).rejects.toThrow(/Invalid taxYear/);

      await expect(
        MIRA604IntegrationService.calculateAndPrepareReturn(
          { tenantId, taxYear: NaN as any },
          adminSession
        )
      ).rejects.toThrow(/Invalid taxYear/);
    });

    test('2. invalid tenant/entity: rejects missing or empty tenant IDs', async () => {
      await expect(
        MIRA604IntegrationService.calculateAndPrepareReturn(
          { tenantId: '', taxYear },
          adminSession
        )
      ).rejects.toThrow(/tenantId is required/);

      await expect(
        MIRA604IntegrationService.calculateAndPrepareReturn(
          { tenantId: '   ', taxYear },
          adminSession
        )
      ).rejects.toThrow(/tenantId is required/);
    });

    test('3. cross-tenant access: prevents user belonging to tenant A from mutating tenant B', async () => {
      await expect(
        MIRA604IntegrationService.calculateAndPrepareReturn(
          { tenantId, taxYear },
          foreignTenantSession
        )
      ).rejects.toThrow(/Cross-tenant access denied/);
    });

    test('4. unauthorized trace access: restricts audit calculation trace to authorized roles', async () => {
      // Calculate return first
      await MIRA604IntegrationService.calculateAndPrepareReturn(
        { tenantId, taxYear, tin: '1000200300', taxpayerName: 'Golden Taxpayer Ltd' },
        adminSession
      );

      // Staff role is not authorized to inspect audit traces
      await expect(
        MIRA604IntegrationService.getTrace(tenantId, taxYear, staffSession)
      ).rejects.toThrow(/Unauthorized trace access/);

      // Admin role is authorized
      const trace = await MIRA604IntegrationService.getTrace(tenantId, taxYear, adminSession);
      expect(trace).toBeDefined();
    });

    test('5. locked accounting period: rejects calculation mutation when accounting period is locked', async () => {
      await PeriodControlService.createPeriod({
        tenantId,
        periodName: `FY${taxYear}`,
        startDate: `${taxYear}-01-01`,
        endDate: `${taxYear}-12-31`,
        status: 'LOCKED',
        session: adminSession
      });

      await expect(
        MIRA604IntegrationService.calculateAndPrepareReturn(
          { tenantId, taxYear, isAmendment: false },
          adminSession
        )
      ).rejects.toThrow();

      // Cleanup
      PeriodControlService.resetStore();
    });

    test('6. missing P&L: handles empty GL ledger without crashing', async () => {
      const emptyTenant = 'TENANT-EMPTY-GL';
      const emptyAdmin: UserSession = { userId: 'USR-EMPTY', tenantId: emptyTenant, role: 'CLIENT_ADMIN' };

      const result = await MIRA604IntegrationService.calculateAndPrepareReturn(
        { tenantId: emptyTenant, taxYear, tin: '1000200300', taxpayerName: 'Empty GL Corp' },
        emptyAdmin
      );

      expect(result.accountingProfitBeforeTax).toBe(0);
      expect(result.finalTaxableIncome).toBe(0);
      expect(result.finalTaxPayable).toBe(0);
    });

    test('7. missing Schedule 1 source: generates zero-balance Schedule 1 gracefully', async () => {
      const result = await MIRA604IntegrationService.calculateAndPrepareReturn(
        { tenantId, taxYear, tin: '1000200300', taxpayerName: 'Golden Taxpayer Ltd', overrideAccountingProfit: 0 },
        adminSession
      );

      expect(result.mira604.sectionB_Schedule1PnL.accountingProfitBeforeTax).toBe(0);
    });

    test('8. missing taxpayer data: flags CRITICAL review rather than proceeding silently', async () => {
      const missingDataTenant = 'TENANT-MISSING-DATA';
      const missingAdmin: UserSession = { userId: 'USR-M', tenantId: missingDataTenant, role: 'CLIENT_ADMIN' };

      const result = await MIRA604IntegrationService.calculateAndPrepareReturn(
        { tenantId: missingDataTenant, taxYear },
        missingAdmin
      );

      expect(result.status).toBe('REVIEW_REQUIRED');
      expect(result.reviewItems.some(i => i.severity === 'CRITICAL')).toBe(true);
    });

    test('9. duplicate finalized return: throws error when attempting to re-finalize an already finalized return', async () => {
      const dupTenant = 'TENANT-DUP-FINAL';
      const dupAdmin: UserSession = { userId: 'USR-D', tenantId: dupTenant, role: 'CLIENT_ADMIN' };

      await MIRA604IntegrationService.calculateAndPrepareReturn(
        { tenantId: dupTenant, taxYear, tin: '1000200300', taxpayerName: 'Dup Final Corp' },
        dupAdmin
      );
      await MIRA604IntegrationService.approveReturn(dupTenant, taxYear, dupAdmin);
      await MIRA604IntegrationService.finalizeReturn(dupTenant, taxYear, dupAdmin);

      await expect(
        MIRA604IntegrationService.finalizeReturn(dupTenant, taxYear, dupAdmin)
      ).rejects.toThrow(/Duplicate finalization error/);
    });

    test('10. editing finalized return: blocks mutation without isAmendment flag', async () => {
      const editTenant = 'TENANT-EDIT-FINAL';
      const editAdmin: UserSession = { userId: 'USR-E', tenantId: editTenant, role: 'CLIENT_ADMIN' };

      await MIRA604IntegrationService.calculateAndPrepareReturn(
        { tenantId: editTenant, taxYear, tin: '1000200300', taxpayerName: 'Edit Final Corp' },
        editAdmin
      );
      await MIRA604IntegrationService.approveReturn(editTenant, taxYear, editAdmin);
      await MIRA604IntegrationService.finalizeReturn(editTenant, taxYear, editAdmin);

      await expect(
        MIRA604IntegrationService.calculateAndPrepareReturn(
          { tenantId: editTenant, taxYear, isAmendment: false },
          editAdmin
        )
      ).rejects.toThrow(/FINALIZED and immutable/);
    });

    test('11. deleting finalized return: strictly prevents deletion of legally sealed returns', async () => {
      const delTenant = 'TENANT-DEL-FINAL';
      const delAdmin: UserSession = { userId: 'USR-DEL', tenantId: delTenant, role: 'CLIENT_ADMIN' };

      await MIRA604IntegrationService.calculateAndPrepareReturn(
        { tenantId: delTenant, taxYear, tin: '1000200300', taxpayerName: 'Del Final Corp' },
        delAdmin
      );
      await MIRA604IntegrationService.approveReturn(delTenant, taxYear, delAdmin);
      await MIRA604IntegrationService.finalizeReturn(delTenant, taxYear, delAdmin);

      await expect(
        MIRA604IntegrationService.deleteReturn(delTenant, taxYear, delAdmin)
      ).rejects.toThrow(/Cannot delete a FINALIZED tax return/);
    });

    test('12. invalid Decimal input: rejects NaN and non-finite numbers', async () => {
      await expect(
        MIRA604IntegrationService.calculateAndPrepareReturn(
          { tenantId, taxYear, overrideAccountingProfit: NaN },
          adminSession
        )
      ).rejects.toThrow(/Invalid Decimal input/);

      await expect(
        MIRA604IntegrationService.calculateAndPrepareReturn(
          { tenantId, taxYear, overrideAccountingProfit: Infinity },
          adminSession
        )
      ).rejects.toThrow(/Invalid Decimal input/);
    });

    test('13. floating-point contamination: guarantees exact Decimal arithmetic without binary drift', async () => {
      // 0.1 + 0.2 in JS float is 0.30000000000000004
      const p1 = 0.1;
      const p2 = 0.2;
      const profit = new Decimal(p1).plus(p2).toNumber(); // exact 0.3

      const result = await MIRA604IntegrationService.calculateAndPrepareReturn(
        { tenantId, taxYear, tin: '1000200300', taxpayerName: 'Golden Taxpayer Ltd', overrideAccountingProfit: profit },
        adminSession
      );

      expect(result.accountingProfitBeforeTax).toBe(0.3);
      expect(result.accountingProfitBeforeTax.toString()).toBe('0.3');
    });

    test('14. invalid adjustment: rejects unknown adjustment codes or negative amounts', async () => {
      await expect(
        MIRA604IntegrationService.calculateAndPrepareReturn(
          {
            tenantId,
            taxYear,
            overrideAdjustments: [
              { miraCode: 'ADJ-INVALID-CODE' as any, amount: 100, reason: 'Bad code', direction: 'ADD_BACK' as any }
            ]
          },
          adminSession
        )
      ).rejects.toThrow(/Invalid tax adjustment code/);

      await expect(
        MIRA604IntegrationService.calculateAndPrepareReturn(
          {
            tenantId,
            taxYear,
            overrideAdjustments: [
              { miraCode: 'ADJ-DEPR', amount: -500, reason: 'Negative amount', direction: 'ADD_BACK' }
            ]
          },
          adminSession
        )
      ).rejects.toThrow(/Invalid tax adjustment amount/);
    });

    test('15. duplicate capital allowance: detects and blocks duplicate claims on the same asset', async () => {
      const duplicateAssets = [
        { assetId: 'ASSET-DUP-1', name: 'MacBook', assetClass: 'COMPUTERS_ELECTRONICS' as any, cost: 25000, purchaseDate: '2024-01-01', taxYear: 2024 },
        { assetId: 'ASSET-DUP-1', name: 'MacBook Clone', assetClass: 'COMPUTERS_ELECTRONICS' as any, cost: 25000, purchaseDate: '2024-01-01', taxYear: 2024 }
      ];

      await expect(
        MIRA604IntegrationService.calculateAndPrepareReturn(
          { tenantId, taxYear, fixedAssetsList: duplicateAssets },
          adminSession
        )
      ).rejects.toThrow(/Duplicate capital allowance/);
    });

    test('16. duplicate loss utilization: prevents duplicate loss claims for the same tax year', async () => {
      const duplicateLosses = [
        { year: 2022, lossAmount: 50000, utilisedAmount: 0 },
        { year: 2022, lossAmount: 50000, utilisedAmount: 0 }
      ];

      await expect(
        MIRA604IntegrationService.calculateAndPrepareReturn(
          { tenantId, taxYear, priorLossRecords: duplicateLosses },
          adminSession
        )
      ).rejects.toThrow(/Duplicate loss record/);
    });

    test('17. unauthorized tax-credit injection: rejects negative tax prepayments', async () => {
      await expect(
        MIRA604IntegrationService.calculateAndPrepareReturn(
          { tenantId, taxYear, advanceTaxPaid: -10000 },
          adminSession
        )
      ).rejects.toThrow(/Unauthorized tax-credit injection/);
    });

    test('18. client-supplied taxable income override: strictly blocks unauthorized client overrides', async () => {
      await expect(
        MIRA604IntegrationService.calculateAndPrepareReturn(
          { tenantId, taxYear, taxableIncome: 0 } as any,
          adminSession
        )
      ).rejects.toThrow(/Client-supplied taxable income override is strictly prohibited/);
    });

    test('19. client-supplied tax payable override: strictly blocks unauthorized client overrides', async () => {
      await expect(
        MIRA604IntegrationService.calculateAndPrepareReturn(
          { tenantId, taxYear, taxPayable: 0 } as any,
          adminSession
        )
      ).rejects.toThrow(/Client-supplied tax payable override is strictly prohibited/);
    });

    test('20. calculation rollback: ensures atomicity on failure without leaving corrupt state in store', async () => {
      const rollbackTenant = 'TENANT-ROLLBACK-TEST';
      const rollbackAdmin: UserSession = { userId: 'USR-RB', tenantId: rollbackTenant, role: 'CLIENT_ADMIN' };

      // Pass an invalid adjustment to force mid-flight failure
      await expect(
        MIRA604IntegrationService.calculateAndPrepareReturn(
          {
            tenantId: rollbackTenant,
            taxYear: 2024,
            overrideAdjustments: [{ miraCode: 'NON-EXISTENT' as any, amount: 100, reason: 'error', direction: 'ADD_BACK' as any }]
          },
          rollbackAdmin
        )
      ).rejects.toThrow();

      // Verify that no half-baked return was saved in memoryStore
      const state = MIRA604IntegrationService.memoryStore.get(`${rollbackTenant}:2024`);
      expect(state).toBeUndefined();
    });

    test('21. return persistence rollback: ensures deleteReturn deletes unfinalized drafts cleanly', async () => {
      const delDraftTenant = 'TENANT-DEL-DRAFT';
      const delDraftAdmin: UserSession = { userId: 'USR-DD', tenantId: delDraftTenant, role: 'CLIENT_ADMIN' };

      await MIRA604IntegrationService.calculateAndPrepareReturn(
        { tenantId: delDraftTenant, taxYear: 2024, tin: '1000200300', taxpayerName: 'Draft Corp' },
        delDraftAdmin
      );

      expect(MIRA604IntegrationService.memoryStore.get(`${delDraftTenant}:2024`)).toBeDefined();

      const delRes = await MIRA604IntegrationService.deleteReturn(delDraftTenant, 2024, delDraftAdmin);
      expect(delRes.success).toBe(true);
      expect(MIRA604IntegrationService.memoryStore.get(`${delDraftTenant}:2024`)).toBeUndefined();
    });
  });
});
