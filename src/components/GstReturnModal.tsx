import React, { useState, useEffect, useRef } from "react";
import {
  X,
  FileSpreadsheet,
  Building2,
  Calendar,
  ShieldCheck,
  Download,
  Printer,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Layers,
  Receipt
} from "lucide-react";
import { AuthUser, Outlet } from "../types";
import {
  GstSector,
  Mira205GeneralReturn,
  Mira206TourismReturn,
  GstGlReconciliation
} from "../types/gst";

interface BillBreakdownItem {
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

interface PeriodBucketSummary {
  totalBills: number;
  verifiedBills: number;
  pendingBills: number;
  revenuesCount: number;
  totalBillGst: number;
  totalRevenueGst: number;
}

interface PeriodStatsSummary {
  totalBillsInPeriod: number;
  verifiedBillsInPeriod: number;
  includedBillsCount: number;
  pendingReviewCount: number;
  rejectedCount: number;
  excludedNoTaxCount: number;
  excludedOtherSectorCount: number;
  revenueEntriesCount?: number;
  outletScope?: string;
}

interface GstReturnModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: AuthUser | null;
  outlets: Outlet[];
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function computePeriodDates(periodStr: string): { year: number; startDate: string; endDate: string } {
  const [yearStr, periodCode] = (periodStr || "").split("-");
  const year = parseInt(yearStr, 10) || new Date().getFullYear();

  if (periodCode?.startsWith("Q")) {
    const quarter = Math.min(4, Math.max(1, parseInt(periodCode.replace("Q", ""), 10) || 1));
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = quarter * 3;
    const lastDay = new Date(year, endMonth, 0).getDate();
    return {
      year,
      startDate: `${year}-${String(startMonth).padStart(2, "0")}-01`,
      endDate: `${year}-${String(endMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
    };
  }

  const month = Math.min(12, Math.max(1, parseInt((periodCode || "M01").replace("M", ""), 10) || 1));
  const lastDay = new Date(year, month, 0).getDate();
  return {
    year,
    startDate: `${year}-${String(month).padStart(2, "0")}-01`,
    endDate: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
  };
}

export const GstReturnModal: React.FC<GstReturnModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  outlets
}) => {
  const isOutletLocked = currentUser?.role === "outlet_user" && Boolean(currentUser.outlet_id);
  const defaultOutlet = isOutletLocked && currentUser?.outlet_id ? currentUser.outlet_id : "ALL";

  const [sector, setSector] = useState<GstSector>("GENERAL");
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedPeriod, setSelectedPeriod] = useState<string>(
    `${new Date().getFullYear()}-M${String(new Date().getMonth() + 1).padStart(2, "0")}`
  );
  const [selectedOutlet, setSelectedOutlet] = useState<string>(defaultOutlet);
  const [previousExcessCredit, setPreviousExcessCredit] = useState<number>(0);

  const [availableYears, setAvailableYears] = useState<number[]>([
    new Date().getFullYear(),
    new Date().getFullYear() - 1
  ]);
  const [periodSummaries, setPeriodSummaries] = useState<Record<string, PeriodBucketSummary>>({});
  const autoSelectedRef = useRef<boolean>(false);

  const [activeTab, setActiveTab] = useState<"return" | "reconciliation" | "rates">("return");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mira205, setMira205] = useState<Mira205GeneralReturn | null>(null);
  const [mira206, setMira206] = useState<Mira206TourismReturn | null>(null);
  const [billBreakdown, setBillBreakdown] = useState<BillBreakdownItem[]>([]);
  const [periodStats, setPeriodStats] = useState<PeriodStatsSummary | null>(null);
  const [reconciliation, setReconciliation] = useState<GstGlReconciliation | null>(null);

  const getToken = () =>
    localStorage.getItem("cr_auth_token") || localStorage.getItem("crmaldives_token");

  useEffect(() => {
    if (isOutletLocked && currentUser?.outlet_id && selectedOutlet !== currentUser.outlet_id) {
      setSelectedOutlet(currentUser.outlet_id);
    }
  }, [isOutletLocked, currentUser?.outlet_id]);

  useEffect(() => {
    if (!isOpen) {
      autoSelectedRef.current = false;
      return;
    }
    fetchPeriodSummaries();
  }, [isOpen, selectedOutlet]);

  useEffect(() => {
    if (isOpen) {
      fetchGstReturn();
      fetchReconciliation();
    }
  }, [isOpen, sector, selectedPeriod, selectedOutlet]);

  const fetchPeriodSummaries = async () => {
    try {
      const token = getToken();
      const res = await fetch(`/api/gst/periods?outlet_id=${encodeURIComponent(selectedOutlet)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.years) && data.years.length > 0) {
        setAvailableYears(data.years);
      }
      if (data.periods) {
        setPeriodSummaries(data.periods);
      }
      if (!autoSelectedRef.current && data.latestBillPeriod) {
        autoSelectedRef.current = true;
        const [yrStr] = String(data.latestBillPeriod).split("-");
        const parsedYr = parseInt(yrStr, 10);
        if (!isNaN(parsedYr)) {
          setSelectedYear(parsedYr);
        }
        setSelectedPeriod(data.latestBillPeriod);
      }
    } catch (e) {
      console.warn("Period summary fetch error", e);
    }
  };

  const handleYearChange = (newYear: number) => {
    setSelectedYear(newYear);
    const [, periodCode] = selectedPeriod.split("-");
    setSelectedPeriod(`${newYear}-${periodCode || "M01"}`);
  };

  const fetchGstReturn = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = getToken();
      const endpoint = sector === "GENERAL" ? "/api/gst/mira205" : "/api/gst/mira206";
      const { year, startDate, endDate } = computePeriodDates(selectedPeriod);

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          period: {
            periodName: selectedPeriod,
            startDate,
            endDate,
            taxYear: year
          },
          outlet_id: selectedOutlet,
          previousExcessCredit: Number(previousExcessCredit || 0)
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to generate GST return");
      }

      const data = await res.json();
      setBillBreakdown(Array.isArray(data.billBreakdown) ? data.billBreakdown : []);
      setPeriodStats(data.periodStats || null);

      if (sector === "GENERAL") {
        setMira205(data.mira205);
        setMira206(null);
      } else {
        setMira206(data.mira206);
        setMira205(null);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load statutory GST return.");
    } finally {
      setLoading(false);
    }
  };

  const fetchReconciliation = async () => {
    try {
      const token = getToken();
      const { startDate, endDate } = computePeriodDates(selectedPeriod);

      const res = await fetch("/api/gst/reconciliation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          periodStart: startDate,
          periodEnd: endDate,
          sector,
          outlet_id: selectedOutlet
        })
      });

      if (res.ok) {
        const data = await res.json();
        setReconciliation(data.reconciliation);
      }
    } catch (e) {
      console.warn("Reconciliation fetch error", e);
    }
  };

  const handleExportJSON = () => {
    const payload = sector === "GENERAL" ? mira205 : mira206;
    if (!payload) return;
    const exportObj = {
      ...payload,
      billBreakdown,
      periodStats
    };
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sector === "GENERAL" ? "MIRA_205_v25.1" : "MIRA_206_v25.1"}_${selectedPeriod}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatPeriodBadge = (periodKey: string): string => {
    const s = periodSummaries[periodKey];
    if (!s) return "";
    const parts: string[] = [];
    if (s.totalBills > 0) {
      parts.push(`${s.verifiedBills}/${s.totalBills} bill${s.totalBills > 1 ? "s" : ""}`);
    }
    if (s.revenuesCount > 0) {
      parts.push(`${s.revenuesCount} rev`);
    }
    return parts.length > 0 ? ` • ${parts.join(", ")}` : "";
  };

  if (!isOpen) return null;

  const activeReturn = sector === "GENERAL" ? mira205 : mira206;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-6xl my-8 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden text-slate-100">
        
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-slate-800 bg-slate-900/90 sticky top-0 z-10">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-xl font-bold text-slate-100">
                  {sector === "GENERAL" ? "MIRA 205 (General Sector GST Return)" : "MIRA 206 (Tourism Sector GST Return)"}
                </h2>
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-mono font-bold">
                  v25.1 Statutory
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Computed strictly from Verified Uploaded Purchase Bills &amp; Posted Revenues (MIRA Maldives Standards)
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Outlet Selector */}
            <div className="flex items-center bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-xs">
              <Building2 className="w-3.5 h-3.5 text-blue-400 mr-2" />
              <select
                value={selectedOutlet}
                onChange={(e) => setSelectedOutlet(e.target.value)}
                disabled={isOutletLocked}
                aria-label="Select Outlet"
                className="bg-transparent text-slate-100 font-semibold focus:outline-none cursor-pointer disabled:opacity-70"
              >
                {!isOutletLocked && (
                  <option value="ALL" className="bg-slate-900 text-slate-100">
                    All Outlets Consolidated
                  </option>
                )}
                {outlets.map((outlet) => (
                  <option key={outlet.id} value={outlet.id} className="bg-slate-900 text-slate-100">
                    {outlet.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Sector Selector */}
            <div className="flex items-center bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-xs">
              <Layers className="w-3.5 h-3.5 text-emerald-400 mr-2" />
              <select
                value={sector}
                onChange={(e) => setSector(e.target.value as GstSector)}
                aria-label="Select GST Sector"
                className="bg-transparent text-emerald-300 font-bold focus:outline-none cursor-pointer"
              >
                <option value="GENERAL" className="bg-slate-900 text-slate-100">General Sector (8% Standard)</option>
                <option value="TOURISM" className="bg-slate-900 text-slate-100">Tourism Sector (16% / 17% TGST)</option>
              </select>
            </div>

            {/* Year Selector */}
            <div className="flex items-center bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-xs">
              <select
                value={selectedYear}
                onChange={(e) => handleYearChange(parseInt(e.target.value, 10))}
                aria-label="Select Tax Year"
                className="bg-transparent text-slate-100 font-bold focus:outline-none cursor-pointer"
              >
                {availableYears.map((yr) => (
                  <option key={yr} value={yr} className="bg-slate-900 text-slate-100">
                    {yr}
                  </option>
                ))}
              </select>
            </div>

            {/* Period Selector */}
            <div className="flex items-center bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-xs">
              <Calendar className="w-3.5 h-3.5 text-slate-400 mr-2" />
              <select
                value={selectedPeriod}
                onChange={(e) => setSelectedPeriod(e.target.value)}
                aria-label="Select Filing Period"
                className="bg-transparent text-slate-100 font-bold focus:outline-none cursor-pointer"
              >
                <optgroup label={`${selectedYear} Monthly Periods`} className="bg-slate-900 text-slate-300">
                  {MONTH_NAMES.map((mName, idx) => {
                    const code = `${selectedYear}-M${String(idx + 1).padStart(2, "0")}`;
                    return (
                      <option key={code} value={code} className="bg-slate-900 text-slate-100">
                        {selectedYear} {mName} (M{String(idx + 1).padStart(2, "0")}){formatPeriodBadge(code)}
                      </option>
                    );
                  })}
                </optgroup>
                <optgroup label={`${selectedYear} Quarterly Periods`} className="bg-slate-900 text-slate-300">
                  {[1, 2, 3, 4].map((q) => {
                    const code = `${selectedYear}-Q${q}`;
                    const rangeLabel = q === 1 ? "Jan–Mar" : q === 2 ? "Apr–Jun" : q === 3 ? "Jul–Sep" : "Oct–Dec";
                    return (
                      <option key={code} value={code} className="bg-slate-900 text-slate-100">
                        {selectedYear} Q{q} ({rangeLabel}){formatPeriodBadge(code)}
                      </option>
                    );
                  })}
                </optgroup>
              </select>
            </div>

            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center justify-between px-6 py-2 border-b border-slate-800 bg-slate-950 text-xs">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setActiveTab("return")}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer ${
                activeTab === "return"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Form Breakdown &amp; Calculation
            </button>
            <button
              onClick={() => setActiveTab("reconciliation")}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer ${
                activeTab === "reconciliation"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              GL Audit Reconciliation (Accounts 2200 &amp; 1400)
            </button>
            <button
              onClick={() => setActiveTab("rates")}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer ${
                activeTab === "rates"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Regulatory Rate Engine
            </button>
          </div>

          {activeReturn && (
            <div className="hidden md:flex items-center gap-3 text-[11px] text-slate-400 font-mono">
              <span>TIN: <strong className="text-slate-200">{activeReturn.taxpayer.tin}</strong></span>
              <span>•</span>
              <span>Entity: <strong className="text-slate-200">{activeReturn.taxpayer.name}</strong></span>
              <span>•</span>
              <span>Period: <strong className="text-slate-200">{activeReturn.period.startDate} to {activeReturn.period.endDate}</strong></span>
            </div>
          )}
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="py-20 text-center space-y-3">
              <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mx-auto" />
              <p className="text-sm text-slate-400">Compiling MIRA {sector === "GENERAL" ? "205" : "206"} Statutory Return...</p>
            </div>
          ) : error ? (
            <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-sm flex items-center space-x-3">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : activeTab === "return" && sector === "GENERAL" && mira205 ? (
            <div className="space-y-6">
              {/* Pending Review Alert */}
              {periodStats && periodStats.pendingReviewCount > 0 && (
                <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-200 text-xs flex items-center gap-3">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    <strong>{periodStats.pendingReviewCount}</strong> uploaded bill(s) in {selectedPeriod} are still <strong>pending review</strong> and excluded from claimable input tax until verified per MIRA rules.
                  </span>
                </div>
              )}

              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl">
                  <div className="text-xs text-slate-400 font-medium">Box 7 — Net Output Tax (Payable)</div>
                  <div className="text-2xl font-mono font-bold text-emerald-400 mt-1">
                    MVR {mira205.sectionA_Supplies.box7_NetOutputTax.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    From {periodStats?.revenueEntriesCount ?? 0} posted revenue record(s)
                  </div>
                </div>

                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl">
                  <div className="text-xs text-slate-400 font-medium">Box 14 — Net Claimable Input Tax</div>
                  <div className="text-2xl font-mono font-bold text-blue-400 mt-1">
                    MVR {mira205.sectionB_Purchases.box14_NetClaimableInputTax.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    From {periodStats?.includedBillsCount ?? 0} verified purchase bill(s)
                  </div>
                </div>

                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl">
                  <div className="text-xs text-slate-400 font-medium">Box 17 — Final Amount Payable / (Refundable)</div>
                  <div className={`text-2xl font-mono font-bold mt-1 ${
                    mira205.sectionC_Calculation.box17_FinalAmountPayableOrRefundable >= 0 ? "text-amber-400" : "text-purple-400"
                  }`}>
                    MVR {mira205.sectionC_Calculation.box17_FinalAmountPayableOrRefundable.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    {mira205.sectionC_Calculation.box17_FinalAmountPayableOrRefundable < 0
                      ? "Excess Input Tax Credit Carried Forward"
                      : "Net GST Payable to MIRA"}
                  </div>
                </div>
              </div>

              {/* Section A: Supplies */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-emerald-400" />
                    Section A — Supplies Made in the Taxable Period
                  </h3>
                  <span className="text-xs text-slate-400 font-mono">Rate: 8%</span>
                </div>

                <div className="divide-y divide-slate-800/60 text-xs">
                  <div className="flex justify-between py-2">
                    <span className="text-slate-300">Box 1 — Standard Rated Supplies (8%)</span>
                    <div className="text-right font-mono">
                      <span className="text-slate-400 mr-4">Taxable: MVR {mira205.sectionA_Supplies.box1_StandardRatedSupplies8Pct.taxableValue.toFixed(2)}</span>
                      <span className="text-emerald-400 font-bold">Tax: MVR {mira205.sectionA_Supplies.box1_StandardRatedSupplies8Pct.outputTax.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-slate-300">Box 2 — Zero-Rated Supplies (0%)</span>
                    <span className="font-mono text-slate-200">MVR {mira205.sectionA_Supplies.box2_ZeroRatedSupplies.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-slate-300">Box 3 — Exempt Supplies (0%)</span>
                    <span className="font-mono text-slate-200">MVR {mira205.sectionA_Supplies.box3_ExemptSupplies.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between py-2 font-bold bg-slate-900/50 px-2 rounded">
                    <span className="text-slate-100">Box 4 — Total Supplies Value (Box 1 + Box 2 + Box 3)</span>
                    <span className="font-mono text-emerald-300">MVR {mira205.sectionA_Supplies.box4_TotalSuppliesValue.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Section B: Purchases & Input Tax */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-blue-400" />
                    Section B — Purchases &amp; Claimable Input Tax
                  </h3>
                  <span className="text-xs text-slate-400 font-mono">Sec 22(b) Compliant</span>
                </div>

                <div className="divide-y divide-slate-800/60 text-xs">
                  <div className="flex justify-between py-2">
                    <span className="text-slate-300">Box 8 — Standard Rated Purchases (Operational)</span>
                    <div className="text-right font-mono">
                      <span className="text-slate-400 mr-4">Value: MVR {mira205.sectionB_Purchases.box8_StandardRatedPurchases.taxableValue.toFixed(2)}</span>
                      <span className="text-blue-400 font-bold">Input Tax: MVR {mira205.sectionB_Purchases.box8_StandardRatedPurchases.inputTax.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-slate-300">Box 9 — Capital Asset Purchases (Schedule 2)</span>
                    <div className="text-right font-mono">
                      <span className="text-slate-400 mr-4">Value: MVR {mira205.sectionB_Purchases.box9_CapitalPurchases.taxableValue.toFixed(2)}</span>
                      <span className="text-purple-400 font-bold">Capital Tax: MVR {mira205.sectionB_Purchases.box9_CapitalPurchases.inputTax.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="flex justify-between py-2 bg-rose-950/20 px-2 rounded">
                    <span className="text-rose-300 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                      Box 10 — Blocked Input Tax (Sec 22(b) Non-Claimable Entertainment/Fines)
                    </span>
                    <div className="text-right font-mono text-rose-400">
                      <span>Value: MVR {mira205.sectionB_Purchases.box10_BlockedInputTax.taxableValue.toFixed(2)} | Blocked: MVR {mira205.sectionB_Purchases.box10_BlockedInputTax.blockedTax.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-slate-300">Box 11 — Mixed-Use Apportionment (Turnover Pro-Rata)</span>
                    <span className="font-mono text-slate-200">Claimable: MVR {mira205.sectionB_Purchases.box11_MixedUseApportionment.claimableInputTax.toFixed(2)} (Ratio: {(mira205.sectionB_Purchases.box11_MixedUseApportionment.apportionmentRatio * 100).toFixed(1)}%)</span>
                  </div>
                  <div className="flex justify-between py-2 font-bold bg-slate-900/50 px-2 rounded">
                    <span className="text-slate-100">Box 14 — Net Claimable Input Tax (Box 8 + Box 9 + Box 11)</span>
                    <span className="font-mono text-blue-300">MVR {mira205.sectionB_Purchases.box14_NetClaimableInputTax.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Section C: Final Calculation & Excess Credit Carry-Forward */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-3 text-xs">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
                    Section C — Net Tax Calculation
                  </h3>
                </div>
                <div className="divide-y divide-slate-800/60">
                  <div className="flex justify-between py-2">
                    <span className="text-slate-300">Box 15 — Net GST Payable / (Refundable) (Box 7 − Box 14)</span>
                    <span className="font-mono font-bold text-slate-100">
                      MVR {mira205.sectionC_Calculation.box15_NetGstPayableOrRefundable.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 gap-4">
                    <label htmlFor="mira205-excess-credit" className="text-slate-300">
                      Box 16 — Excess Credits Carried Forward from Previous Period (MVR)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id="mira205-excess-credit"
                        type="number"
                        min="0"
                        step="0.01"
                        value={previousExcessCredit}
                        onChange={(e) => setPreviousExcessCredit(Math.max(0, Number(e.target.value) || 0))}
                        onBlur={fetchGstReturn}
                        className="w-32 px-2.5 py-1 bg-slate-900 border border-slate-700 rounded-lg text-right font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                      />
                      <button
                        type="button"
                        onClick={fetchGstReturn}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[11px] font-semibold cursor-pointer"
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-between py-2 font-bold bg-slate-900/50 px-2 rounded">
                    <span className="text-slate-100">Box 17 — Final Amount Payable / (Refundable)</span>
                    <span className={`font-mono ${mira205.sectionC_Calculation.box17_FinalAmountPayableOrRefundable >= 0 ? "text-amber-400" : "text-purple-400"}`}>
                      MVR {mira205.sectionC_Calculation.box17_FinalAmountPayableOrRefundable.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Uploaded Bills Source Breakdown */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
                    Uploaded Purchase Bills Evaluated for {selectedPeriod} ({billBreakdown.length})
                  </h3>
                  <span className="text-[11px] text-slate-400 font-mono">
                    {periodStats?.outletScope || "All Outlets Consolidated"}
                  </span>
                </div>

                {billBreakdown.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-400">
                    No uploaded purchase bills dated within {mira205.period.startDate} to {mira205.period.endDate}. All purchase boxes are MVR 0.00.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400">
                          <th className="py-2 pr-3">Date</th>
                          <th className="py-2 pr-3">Invoice #</th>
                          <th className="py-2 pr-3">Supplier / TIN</th>
                          <th className="py-2 pr-3">Outlet</th>
                          <th className="py-2 pr-3 text-right">Taxed Base</th>
                          <th className="py-2 pr-3 text-right">Claimable GST</th>
                          <th className="py-2 pr-3">MIRA Classification</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {billBreakdown.map((item) => (
                          <tr key={item.billId} className="align-top">
                            <td className="py-2.5 pr-3 font-mono text-slate-300 whitespace-nowrap">{item.invoiceDate}</td>
                            <td className="py-2.5 pr-3 font-mono text-slate-200">{item.invoiceNumber}</td>
                            <td className="py-2.5 pr-3">
                              <div className="text-slate-100 font-medium">{item.supplierName}</div>
                              <div className="text-[11px] text-slate-400 font-mono">
                                TIN: {item.supplierTin || "N/A"} • {item.documentType}
                              </div>
                              {item.warnings.length > 0 && (
                                <div className="text-[11px] text-amber-400 mt-1">
                                  ⚠ {item.warnings.join(" • ")}
                                </div>
                              )}
                              {item.excludedReason && (
                                <div className="text-[11px] text-slate-400 mt-1">
                                  Excluded: {item.excludedReason}
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 pr-3 text-slate-300">{item.outletName}</td>
                            <td className="py-2.5 pr-3 text-right font-mono text-slate-200">
                              MVR {item.taxableBase.toFixed(2)}
                            </td>
                            <td className="py-2.5 pr-3 text-right font-mono font-bold text-blue-400">
                              MVR {item.claimableGst.toFixed(2)}
                            </td>
                            <td className="py-2.5 pr-3">
                              <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${
                                item.included
                                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                                  : "bg-slate-800 text-slate-300 border border-slate-700"
                              }`}>
                                {item.miraBox}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Statutory Traceability Footer */}
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span className="font-semibold text-slate-200">Statutory Regulatory Checksum:</span>
                  </div>
                  <span className="font-mono text-[11px] text-emerald-400 truncate max-w-md">{mira205.regulatoryTraceability.checksum}</span>
                </div>
                <div className="text-slate-400 text-[11px]">
                  Governing Rule: <span className="text-slate-200 font-mono">{mira205.regulatoryTraceability.ruleId}</span> ({mira205.regulatoryTraceability.legalReference})
                </div>
              </div>
            </div>
          ) : activeTab === "return" && sector === "TOURISM" && mira206 ? (
            <div className="space-y-6">
              {periodStats && periodStats.pendingReviewCount > 0 && (
                <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-200 text-xs flex items-center gap-3">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    <strong>{periodStats.pendingReviewCount}</strong> uploaded bill(s) in {selectedPeriod} are still <strong>pending review</strong> and excluded until verified per MIRA rules.
                  </span>
                </div>
              )}

              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl">
                  <div className="text-xs text-slate-400 font-medium">Box 7 — Net TGST Output Tax</div>
                  <div className="text-2xl font-mono font-bold text-emerald-400 mt-1">
                    MVR {mira206.sectionA_Supplies.box7_NetTgstOutputTax.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    From {periodStats?.revenueEntriesCount ?? 0} posted TGST revenue record(s)
                  </div>
                </div>

                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl">
                  <div className="text-xs text-slate-400 font-medium">Box 13 — Net Claimable TGST Input Tax</div>
                  <div className="text-2xl font-mono font-bold text-blue-400 mt-1">
                    MVR {mira206.sectionB_Purchases.box13_NetClaimableTgstInputTax.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    From {periodStats?.includedBillsCount ?? 0} verified TGST purchase bill(s)
                  </div>
                </div>

                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl">
                  <div className="text-xs text-slate-400 font-medium">Box 16 — Final TGST Amount Payable / (Refundable)</div>
                  <div className={`text-2xl font-mono font-bold mt-1 ${
                    mira206.sectionC_Calculation.box16_FinalTgstPayableOrRefundable >= 0 ? "text-amber-400" : "text-purple-400"
                  }`}>
                    MVR {mira206.sectionC_Calculation.box16_FinalTgstPayableOrRefundable.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">Due under Tourism GST Act</div>
                </div>
              </div>

              {/* Section A: Tourism Supplies */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-emerald-400" />
                    Section A — Tourism Sector Supplies (TGST)
                  </h3>
                  <span className="text-xs text-slate-400 font-mono">16% / 17% Versioned</span>
                </div>

                <div className="divide-y divide-slate-800/60 text-xs">
                  <div className="flex justify-between py-2">
                    <span className="text-slate-300">Box 1A — Tourism Supplies (16% through 2025-06-30)</span>
                    <div className="text-right font-mono">
                      <span className="text-slate-400 mr-4">Taxable: MVR {mira206.sectionA_Supplies.box1A_TourismSupplies16Pct.taxableValue.toFixed(2)}</span>
                      <span className="text-emerald-400 font-bold">TGST: MVR {mira206.sectionA_Supplies.box1A_TourismSupplies16Pct.outputTax.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-slate-300">Box 1B — Tourism Supplies (17% from 2025-07-01)</span>
                    <div className="text-right font-mono">
                      <span className="text-slate-400 mr-4">Taxable: MVR {mira206.sectionA_Supplies.box1B_TourismSupplies17Pct.taxableValue.toFixed(2)}</span>
                      <span className="text-emerald-400 font-bold">TGST: MVR {mira206.sectionA_Supplies.box1B_TourismSupplies17Pct.outputTax.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-slate-300">Box 2 — Zero-Rated Tourism Supplies</span>
                    <span className="font-mono text-slate-200">MVR {mira206.sectionA_Supplies.box2_ZeroRatedTourismSupplies.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-slate-300">Box 3 — Exempt Tourism Supplies</span>
                    <span className="font-mono text-slate-200">MVR {mira206.sectionA_Supplies.box3_ExemptTourismSupplies.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between py-2 font-bold bg-slate-900/50 px-2 rounded">
                    <span className="text-slate-100">Box 4 — Total Tourism Supplies Value</span>
                    <span className="font-mono text-emerald-300">MVR {mira206.sectionA_Supplies.box4_TotalTourismSuppliesValue.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Section B: Purchases */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-blue-400" />
                    Section B — Tourism Purchases &amp; TGST Input
                  </h3>
                </div>

                <div className="divide-y divide-slate-800/60 text-xs">
                  <div className="flex justify-between py-2">
                    <span className="text-slate-300">Box 8 — Tourism Operational Purchases</span>
                    <div className="text-right font-mono">
                      <span className="text-slate-400 mr-4">Value: MVR {mira206.sectionB_Purchases.box8_TourismOperationalPurchases.taxableValue.toFixed(2)}</span>
                      <span className="text-blue-400 font-bold">Input Tax: MVR {mira206.sectionB_Purchases.box8_TourismOperationalPurchases.inputTax.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-slate-300">Box 9 — Tourism Capital Asset Purchases</span>
                    <div className="text-right font-mono">
                      <span className="text-slate-400 mr-4">Value: MVR {mira206.sectionB_Purchases.box9_TourismCapitalPurchases.taxableValue.toFixed(2)}</span>
                      <span className="text-purple-400 font-bold">Capital Tax: MVR {mira206.sectionB_Purchases.box9_TourismCapitalPurchases.inputTax.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="flex justify-between py-2 bg-rose-950/20 px-2 rounded">
                    <span className="text-rose-300">Box 10 — Blocked Input Tax (Sec 22(b))</span>
                    <span className="font-mono text-rose-400">Blocked: MVR {mira206.sectionB_Purchases.box10_BlockedInputTax.blockedTax.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between py-2 font-bold bg-slate-900/50 px-2 rounded">
                    <span className="text-slate-100">Box 13 — Net Claimable TGST Input Tax</span>
                    <span className="font-mono text-blue-300">MVR {mira206.sectionB_Purchases.box13_NetClaimableTgstInputTax.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Section C: Tourism Net Calculation */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-3 text-xs">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
                    Section C — Net TGST Calculation
                  </h3>
                </div>
                <div className="divide-y divide-slate-800/60">
                  <div className="flex justify-between py-2">
                    <span className="text-slate-300">Box 14 — Net TGST Payable / (Refundable)</span>
                    <span className="font-mono font-bold text-slate-100">
                      MVR {mira206.sectionC_Calculation.box14_NetTgstPayableOrRefundable.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 gap-4">
                    <label htmlFor="mira206-excess-credit" className="text-slate-300">
                      Box 15 — Excess Credits Carried Forward from Previous Period (MVR)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id="mira206-excess-credit"
                        type="number"
                        min="0"
                        step="0.01"
                        value={previousExcessCredit}
                        onChange={(e) => setPreviousExcessCredit(Math.max(0, Number(e.target.value) || 0))}
                        onBlur={fetchGstReturn}
                        className="w-32 px-2.5 py-1 bg-slate-900 border border-slate-700 rounded-lg text-right font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                      />
                      <button
                        type="button"
                        onClick={fetchGstReturn}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[11px] font-semibold cursor-pointer"
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-between py-2 font-bold bg-slate-900/50 px-2 rounded">
                    <span className="text-slate-100">Box 16 — Final TGST Payable / (Refundable)</span>
                    <span className={`font-mono ${mira206.sectionC_Calculation.box16_FinalTgstPayableOrRefundable >= 0 ? "text-amber-400" : "text-purple-400"}`}>
                      MVR {mira206.sectionC_Calculation.box16_FinalTgstPayableOrRefundable.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Uploaded Bills Source Breakdown */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
                    Uploaded Purchase Bills Evaluated for {selectedPeriod} ({billBreakdown.length})
                  </h3>
                  <span className="text-[11px] text-slate-400 font-mono">
                    {periodStats?.outletScope || "All Outlets Consolidated"}
                  </span>
                </div>

                {billBreakdown.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-400">
                    No Tourism-sector uploaded purchase bills dated within {mira206.period.startDate} to {mira206.period.endDate}. All purchase boxes are MVR 0.00.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400">
                          <th className="py-2 pr-3">Date</th>
                          <th className="py-2 pr-3">Invoice #</th>
                          <th className="py-2 pr-3">Supplier / TIN</th>
                          <th className="py-2 pr-3">Outlet</th>
                          <th className="py-2 pr-3 text-right">Taxed Base</th>
                          <th className="py-2 pr-3 text-right">Claimable TGST</th>
                          <th className="py-2 pr-3">MIRA Classification</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {billBreakdown.map((item) => (
                          <tr key={item.billId} className="align-top">
                            <td className="py-2.5 pr-3 font-mono text-slate-300 whitespace-nowrap">{item.invoiceDate}</td>
                            <td className="py-2.5 pr-3 font-mono text-slate-200">{item.invoiceNumber}</td>
                            <td className="py-2.5 pr-3">
                              <div className="text-slate-100 font-medium">{item.supplierName}</div>
                              <div className="text-[11px] text-slate-400 font-mono">TIN: {item.supplierTin || "N/A"}</div>
                              {item.excludedReason && (
                                <div className="text-[11px] text-slate-400 mt-1">Excluded: {item.excludedReason}</div>
                              )}
                            </td>
                            <td className="py-2.5 pr-3 text-slate-300">{item.outletName}</td>
                            <td className="py-2.5 pr-3 text-right font-mono text-slate-200">MVR {item.taxableBase.toFixed(2)}</td>
                            <td className="py-2.5 pr-3 text-right font-mono font-bold text-blue-400">MVR {item.claimableGst.toFixed(2)}</td>
                            <td className="py-2.5 pr-3">
                              <span className="inline-block px-2 py-0.5 rounded text-[11px] bg-slate-800 text-slate-300 border border-slate-700">
                                {item.miraBox}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === "reconciliation" ? (
            <div className="space-y-6">
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    GST Subledger (Uploaded Bills &amp; Revenues) to General Ledger Audit
                  </h3>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold flex items-center gap-1 ${
                    reconciliation?.isReconciled ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"
                  }`}>
                    {reconciliation?.isReconciled ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>100% RECONCILED</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>VARIANCES DETECTED</span>
                      </>
                    )}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg space-y-2">
                    <div className="font-bold text-slate-200">Account 2200 — GST Output Tax Payable</div>
                    <div className="flex justify-between text-slate-400">
                      <span>Posted Revenue Subledger Total:</span>
                      <span className="font-mono text-slate-100">MVR {(reconciliation?.gstTransactionsTotalOutputTax || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>GL Account 2200 Balance:</span>
                      <span className="font-mono text-slate-100">MVR {(reconciliation?.glOutputTaxBalance || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between font-bold pt-2 border-t border-slate-800">
                      <span>Variance:</span>
                      <span className={`font-mono ${reconciliation?.outputTaxVariance === 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        MVR {(reconciliation?.outputTaxVariance || 0).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg space-y-2">
                    <div className="font-bold text-slate-200">Account 1400 / 2100-INPUT — GST Input Tax Claimable</div>
                    <div className="flex justify-between text-slate-400">
                      <span>Verified Bills Subledger Total:</span>
                      <span className="font-mono text-slate-100">MVR {(reconciliation?.gstTransactionsTotalInputTax || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>GL Input Tax Account Balance:</span>
                      <span className="font-mono text-slate-100">MVR {(reconciliation?.glInputTaxBalance || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between font-bold pt-2 border-t border-slate-800">
                      <span>Variance:</span>
                      <span className={`font-mono ${reconciliation?.inputTaxVariance === 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        MVR {(reconciliation?.inputTaxVariance || 0).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>

                {reconciliation?.discrepancies && reconciliation.discrepancies.length > 0 && (
                  <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-200 space-y-1">
                    {reconciliation.discrepancies.map((msg, i) => (
                      <div key={i}>• {msg}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-3 text-xs">
                <h3 className="text-sm font-bold text-slate-200">Maldives Statutory GST Rate Governance</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg space-y-2">
                    <div className="font-bold text-emerald-400">General Sector GST</div>
                    <div className="text-slate-300">Rate: <span className="font-mono font-bold text-white">8%</span></div>
                    <div className="text-slate-400">Effective: 2023-01-01 to Present</div>
                    <div className="text-slate-500 text-[11px]">Governed by Goods and Services Tax Act Amendment (Act No. 20/2022) Section 15(a)</div>
                  </div>

                  <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg space-y-2">
                    <div className="font-bold text-amber-400">Tourism Sector GST (TGST)</div>
                    <div className="text-slate-300">Historical Rate: <span className="font-mono font-bold text-white">16%</span> (through 2025-06-30)</div>
                    <div className="text-slate-300">Current Statutory Rate: <span className="font-mono font-bold text-emerald-400">17%</span> (from 2025-07-01)</div>
                    <div className="text-slate-500 text-[11px]">Governed by Goods and Services Tax Act Amendment Section 15(b)</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-900">
          <button
            onClick={fetchGstReturn}
            className="flex items-center space-x-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Re-compute Return</span>
          </button>

          <div className="flex items-center space-x-3">
            <button
              onClick={() => window.print()}
              className="flex items-center space-x-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Statutory Form</span>
            </button>

            <button
              onClick={handleExportJSON}
              className="flex items-center space-x-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download MIRA Payload (JSON)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

