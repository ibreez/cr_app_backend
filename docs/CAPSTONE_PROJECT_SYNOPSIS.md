# MALDIVES BUSINESS SCHOOL
### Dreams & Do
## CAPSTONE PROJECT SYNOPSIS
**Unit 22: Capstone Project (Bachelor’s Degree Year 3 - IT)**

---

**Date of Submission:** 26th September 2026  
**Student Information:**  
- **Name:** [Student Name]  
- **STID:** [Student ID]  
- **Project Title:** Multi-Outlet Purchase Receipt AI Extraction and MIRA GST File Input Sheet Automation System  

---

### 1. Objective (Approx. 100 Words)
Multi-outlet retail and hospitality businesses in the Maldives face significant operational challenges in manually transcribing paper receipts and digital invoices for statutory Maldives Inland Revenue Authority (MIRA) GST compliance. Manual data entry is slow, prone to human error in capturing vendor Tax Identification Numbers (TIN), and leads to tax calculation discrepancies across decentralized branches. This project develops an automated, cloud-based platform allowing authorized outlet staff to upload purchase bills or capture receipts via mobile camera, utilizes multimodal artificial intelligence to extract critical tax metadata (Supplier Name, TIN, Invoice Number, Date, Subtotal, and 8% GST), and automatically updates an authoritative MIRA GST File Input Sheet for consolidated download.

---

### 2. Expected Outcome (Approx. 100 Words)
The completed system delivers an end-to-end automated pipeline resolving manual tax bookkeeping bottlenecks. Receipts uploaded across isolated outlet profiles are parsed with high precision via Google Gemini AI vision extraction, automatically validating vendor TINs and calculating 8% Maldives GST. Extracted figures are mapped directly into a standardized Excel GST File Input Sheet (`.xlsx`) without overwriting historical records. The final outputs include: (1) isolated, outlet-specific receipt repositories, (2) verified digital audit records with itemized line breakdowns, and (3) an updated, downloadable MIRA-compliant GST Input File supporting both single-outlet and consolidated multi-outlet reporting for immediate statutory filing.

---

### 3. Technology Used (Hardware and Software)

#### **Server Environment:**
- **Hardware (Minimum Requirements):**
  - **Processor (CPU):** Dual-Core 64-bit x86/ARM processor (2.0 GHz or higher)
  - **Memory (RAM):** 4 GB RAM (8 GB recommended for concurrent AI requests and spreadsheet operations)
  - **Storage (Storage/HDD/SSD):** 20 GB SSD with high I/O throughput for document buffer cache
  - **Network:** High-speed broadband connection (minimum 10 Mbps upstream/downstream)
- **Software Specifications:**
  - **Operating System:** Linux (Ubuntu 22.04 LTS / Debian 12) or POSIX containerized runtime
  - **Runtime Environment:** Node.js v22.14.0 LTS / tsx v4.21.0
  - **Backend Framework:** Express.js v4.21.2
  - **Programming Language:** TypeScript v5.8.2
  - **AI / Machine Learning SDK:** Google GenAI SDK (`@google/genai` v2.4.0, Gemini Multimodal Vision API)
  - **File Processing & Multipart Parser:** Multer v2.2.0 with cryptographic MIME magic-bytes validation
  - **Spreadsheet Engine:** SheetJS (`xlsx` v0.18.5) for OpenXML workbook parsing and cell array generation
  - **Database & Persistence:** PostgreSQL 15 / Prisma ORM v5.22.0 with JSON state-file redundancy

#### **Client Environment:**
- **Hardware (Minimum Requirements):**
  - **Processor (CPU):** 1.6 GHz Intel/AMD/Apple Silicon processor
  - **Memory (RAM):** 4 GB RAM minimum
  - **Display Resolution:** 1280 x 720 minimum (optimized for desktop and tablet screens)
  - **Peripherals:** Integrated web camera or mobile device camera (720p/1080p) for receipt scanning
- **Software Specifications:**
  - **Web Browser:** Google Chrome (v120+), Microsoft Edge (v120+), Mozilla Firefox (v120+), or Safari (v17+)
  - **Frontend Framework:** React 19 (v19.0.1) Single Page Application (SPA)
  - **Build Tool:** Vite v6.2.3
  - **Styling Architecture:** Tailwind CSS v4.1.14
  - **Component Icons & Animation:** Lucide React v0.546.0, Motion v12.23.24

---

### 4. Core Workflow Architecture & Module Functionalities

The application focuses exclusively on five cohesive architectural steps:

```
[ Receipt Upload ] 
       │ (Camera capture / File drag-and-drop: PDF, JPG, PNG)
       ▼
[ Multi-Outlet Authority & Security ]
       │ (RBAC: Super Admin vs. Scoped Outlet User Isolation)
       ▼
[ Gemini AI Multimodal Information Extraction ]
       │ (Extracts: Supplier, TIN, Inv #, Date, Subtotal, 8% GST, Total)
       ▼
[ GST File Input Sheet Updating Engine ]
       │ (Custom Template / Standard MIRA Format + Header Column Mapping)
       ▼
[ Download Updated GST Input File ]
         (Downloadable MIRA-ready .xlsx file with verified purchase rows)
```

1. **Receipt Upload Module:**  
   Supports multi-channel file intake including direct file selector, drag-and-drop, and live camera photo capture with HTML5 canvas blob generation. Uploaded files undergo MIME magic-bytes validation, file size checks (up to 10 MB), and anti-tamper security screening.

2. **Receipt Information Extraction Engine:**  
   Leverages the Google Gemini multimodal model with strict financial prompts tailored for Maldivian commerce. Accurately extracts Supplier Name, Supplier TIN (excluding the buyer's own TIN to prevent collision), Invoice Number, Invoice Date (formatted as `DD MMM YYYY`), Taxable Subtotal (MVR), 8% GST Amount, and Total.

3. **GST File Input Sheet Update Engine:**  
   Parses user-supplied custom Excel templates or generates the standard MIRA GST Input Sheet layout using SheetJS. Implements semantic column mapping (`templateMapping`) to align extracted receipt fields to template headers and appends verified records into sheet rows (`XLSX.utils.sheet_add_aoa`) preserving template structure and formulas.

4. **Multi-Outlet with Multi-User Authority:**  
   Enforces Role-Based Access Control (RBAC):
   - **`super_admin`:** Global tenant authority; manages outlets and users, configures template mappings, and exports consolidated enterprise GST sheets.
   - **`outlet_user`:** Strictly isolated to their assigned outlet (e.g., Male' Main Branch, Hulhumale' Outlet, Maafushi Resort Shop). All uploaded bills are automatically tagged with the user's outlet ID, preventing cross-outlet data leakage.

5. **Download Updated GST Input File:**  
   Provides on-demand generation and streaming of the finalized Excel workbook (`.xlsx`) filtered by quarter, fiscal year, and outlet scope with proper HTTP attachment headers.

---

### 5. Project Planning (Gantt Chart Timeline)

The project follows an Agile Software Development Life Cycle (SDLC) executed across 12 scheduled weeks leading up to the final submission:

| Phase / Task Description | W1 | W2 | W3 | W4 | W5 | W6 | W7 | W8 | W9 | W10 | W11 | W12 | Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Phase 1: Requirements & Feasibility Analysis** | ■■ | ■■ |    |    |    |    |    |    |    |     |     |     | Completed |
| • Stakeholder needs & MIRA GST input specifications | ■■ |    |    |    |    |    |    |    |    |     |     |     | Completed |
| • Hardware & Software feasibility study |    | ■■ |    |    |    |    |    |    |    |     |     |     | Completed |
| **Phase 2: System Architecture & Security Design** |    |    | ■■ | ■■ |    |    |    |    |    |     |     |     | Completed |
| • Multi-Outlet data models & RBAC authorization |    |    | ■■ |    |    |    |    |    |    |     |     |     | Completed |
| • Upload validation, rate-limiting & session schema |    |    |    | ■■ |    |    |    |    |    |     |     |     | Completed |
| **Phase 3: Receipt Upload & Camera Integration** |    |    |    |    | ■■ | ■■ |    |    |    |     |     |     | Completed |
| • Drag-and-drop & Camera stream canvas capture |    |    |    |    | ■■ |    |    |    |    |     |     |     | Completed |
| • Multer backend pipeline & magic-bytes validation |    |    |    |    |    | ■■ |    |    |    |     |     |     | Completed |
| **Phase 4: Gemini AI Extraction Pipeline** |    |    |    |    |    |    | ■■ | ■■ |    |     |     |     | Completed |
| • Financial OCR prompting & JSON schema enforcement |    |    |    |    |    |    | ■■ |    |    |     |     |     | Completed |
| • TIN validation & 8% GST calculation verification |    |    |    |    |    |    |    | ■■ |    |     |     |     | Completed |
| **Phase 5: GST Input Sheet Update & Export Engine** |    |    |    |    |    |    |    |    | ■■ | ■■  |     |     | Completed |
| • SheetJS template ingestion & column mapper UI |    |    |    |    |    |    |    |    | ■■ |     |     |     | Completed |
| • Row appending & downloadable `.xlsx` export |    |    |    |    |    |    |    |    |    | ■■  |     |     | Completed |
| **Phase 6: Testing, Documentation & Submission** |    |    |    |    |    |    |    |    |    |     | ■■  | ■■  | In Progress |
| • Black-box & White-box test cases for 5 modules |    |    |    |    |    |    |    |    |    |     | ■■  |     | In Progress |
| • Capstone Synopsis, SRS & Viva Voce preparation |    |    |    |    |    |    |    |    |    |     |     | ■■  | Scheduled |

---

### 6. Work in Progress & Future Updates
- **Automated MIRAconnect Direct API Filing:** Direct electronic payload submission to the MIRA tax portal once formal B2G API specifications are released.
- **Advanced Disallowance Reconciliation:** Enhanced automated flag generation for non-deductible items under MIRA GST Act Section 22(b) (e.g., entertainment, non-commercial passenger transport).
- **Expanded Tourism Sector (TGST 16% / 17%) Rule Engine:** Auto-detecting tourism sector invoices for differential tax calculation and reporting.
