# Software Requirements Specification
### for
## Multi-Outlet Purchase Receipt AI Extraction and MIRA GST File Input Sheet Automation System
**Version 1.0**

---

### Prepared by:
**Student Details:**  
- **Name:** [Student First Name] [Student Last Name]  
- **Student ID:** [Student ID]  
- **Email:** ibryxx@gmail.com  

**Instructor:** Dr. Saurabh / Prof. Sandeep Singh Sikerwar  
**Course:** Bachelor’s Degree Year 3 – IT (Unit 22: Capstone Project)  
**Institution:** Maldives Business School  
**Date of Submission:** 1st October 2026  

---

## Contents
- **Contents** ................................................................................................................................. ii
- **Revisions** ............................................................................................................................... iii
- **1 INTRODUCTION** ............................................................................................................... 1
  - 1.1 Document Purpose ......................................................................................................... 1
  - 1.2 Product Scope ................................................................................................................ 1
  - 1.3 Intended Audience and Document Overview ................................................................. 1
  - 1.4 Definitions, Acronyms and Abbreviations ..................................................................... 2
  - 1.5 Document Conventions ................................................................................................. 2
  - 1.6 References and Acknowledgments ................................................................................. 2
- **2 OVERALL DESCRIPTION** ................................................................................................. 3
  - 2.1 Product Overview ........................................................................................................... 3
  - 2.2 Product Functionality ..................................................................................................... 4
  - 2.3 Design and Implementation Constraints ........................................................................ 4
  - 2.4 Assumptions and Dependencies ................................................................................... 5
- **3 SPECIFIC REQUIREMENTS** .............................................................................................. 6
  - 3.1 External Interface Requirements .................................................................................... 6
    - 3.1.1 User Interfaces ........................................................................................................ 6
    - 3.1.2 Hardware Interfaces ................................................................................................. 7
    - 3.1.3 Software Interfaces ................................................................................................. 7
  - 3.2 Functional Requirements ............................................................................................... 8
    - 3.2.1 F1: Multi-Outlet User Authentication & Branch Scoping ........................................... 8
    - 3.2.2 F2: Multi-Modal Receipt & Invoice Ingestion ........................................................... 8
    - 3.2.3 F3: AI Information Extraction & Tax Attribute Normalization ................................... 8
    - 3.2.4 F4: In-Flight Verification & Line Item Tax Adjustment .............................................. 9
    - 3.2.5 F5: Excel Template Header Parsing & Dynamic Column Mapping ........................... 9
    - 3.2.6 F6: Authoritative GST Input Sheet Updating ........................................................... 9
    - 3.2.7 F7: Filtered & Consolidated GST Input File Download ............................................. 9
  - 3.3 Use Case Model ........................................................................................................... 10
    - 3.3.1 Use Case Diagram Representation ........................................................................ 10
    - 3.3.2 UC-01: Upload Receipt / Invoice File ..................................................................... 10
    - 3.3.3 UC-02: Extract Receipt Metadata via AI Engine ................................................... 11
    - 3.3.4 UC-03: Verify Extracted Tax Attributes ................................................................. 12
    - 3.3.5 UC-04: Configure GST Template Column Mapping ................................................. 13
    - 3.3.6 UC-05: Update GST Input Sheet & Download Workbook ........................................ 14
- **4 OTHER NON-FUNCTIONAL REQUIREMENTS** ............................................................... 15
  - 4.1 Performance Requirements ......................................................................................... 15
  - 4.2 Safety and Security Requirements ............................................................................... 15
  - 4.3 Software Quality Attributes ......................................................................................... 16
    - 4.3.1 Reliability & Data Integrity ..................................................................................... 16
    - 4.3.2 Usability & Error Tolerance ................................................................................... 16
    - 4.3.3 Maintainability & Modularity .................................................................................. 16
    - 4.3.4 Portability .............................................................................................................. 16
- **5 OTHER REQUIREMENTS** ............................................................................................... 17
  - 5.1 Legal & Statutory Tax Compliance (MIRA GST Act) .................................................... 17
  - 5.2 Multi-Outlet Data Isolation Rules ................................................................................. 17
- **APPENDIX A – DATA DICTIONARY** ................................................................................... 18

---

## Revisions

| Version | Primary Author(s) | Description of Version | Date Completed |
| :--- | :--- | :--- | :---: |
| 1.0 | [Student Name] | Complete Software Requirements Specification covering Receipt Upload, Multimodal Information Extraction, Multi-Outlet Scoping, GST File Input Sheet Updating, and Export. | 01/10/2026 |

---

## 1 Introduction

### 1.1 Document Purpose
This Software Requirements Specification (SRS) establishes the complete functional and non-functional requirements for the **Multi-Outlet Purchase Receipt AI Extraction and MIRA GST File Input Sheet Automation System**, Version 1.0. This document specifies the implementation of a focused, automated workflow:
1. Receipt and purchase bill file upload (via direct file intake and camera photo capture).
2. Automated financial and tax metadata extraction using Google Gemini Multimodal Vision Artificial Intelligence.
3. Structured updating of the Maldives Inland Revenue Authority (MIRA) GST File Input Sheet (`.xlsx`) adhering to user-configured or standard statutory layout specifications.
4. Multi-outlet data isolation and role-based authority management.
5. Filtered and consolidated streaming download of the updated GST input file.

This specification describes only the core receipt-to-GST workflow and its directly supporting infrastructure.

### 1.2 Product Scope
The software specified herein is an enterprise-grade cloud accounting utility designed to eliminate the manual, error-prone data entry bottleneck experienced by multi-outlet retail and hospitality organizations operating under Maldivian tax jurisdiction. 

The software allows branch operators to upload purchase receipts, validates the physical files, extracts key tax attributes (Supplier Name, Supplier TIN, Invoice Number, Invoice Date, Subtotal, and 8% GST Amount), presents the data for interactive verification, appends verified transaction records into an OpenXML Excel workbook without corrupting existing formulas or rows, and enables authorized accountants to download scoped or consolidated GST input workbooks. The primary benefits include:
- Drastic reduction of transcription delays during quarterly and monthly MIRA filing cycles.
- Prevention of human transposition errors in 7-digit/10-digit Maldivian Tax Identification Numbers (TIN).
- Strict isolation of branch finances while giving central management unified export visibility.

### 1.3 Intended Audience and Document Overview
This document is prepared for:
- **Academic Evaluators and Assessors:** To verify adherence to BTEC Level 7 / Bachelor's Degree Year 3 IT Capstone guidelines, assessment criteria (1.1 and 1.2), and IEEE/COMET software engineering standards.
- **Software Engineers & System Architects:** To guide technical maintenance, component wiring, API route implementations, and database constraints.
- **Quality Assurance & Testers:** As the authoritative baseline for executing black-box validation, white-box unit tests, and multi-tenant security verification.

**Suggested Reading Flow:**
Readers seeking an architectural summary should begin with **Section 2 (Overall Description)**. Developers and testers should focus on **Section 3 (Specific Requirements)** and **Appendix A (Data Dictionary)**. Project auditors should review **Section 4 (Non-Functional Requirements)** and **Section 5 (Other Requirements)**.

### 1.4 Definitions, Acronyms and Abbreviations
- **AOA:** Array of Arrays (internal two-dimensional matrix representation used in SheetJS for Excel cell addressing).
- **COMET:** Concurrent Object Modeling and Architectural Design Method.
- **CSV:** Comma-Separated Values.
- **GST:** Goods and Services Act / Tax of the Republic of Maldives.
- **IEEE:** Institute of Electrical and Electronics Engineers.
- **MBS:** Maldives Business School.
- **MIME:** Multipurpose Internet Mail Extensions.
- **MIRA:** Maldives Inland Revenue Authority.
- **MVR:** Maldivian Rufiyaa (legal tender of the Republic of Maldives).
- **OCR:** Optical Character Recognition.
- **OpenXML:** Standard XML-based file format specification for electronic spreadsheets (`.xlsx`).
- **RBAC:** Role-Based Access Control.
- **SDLC:** Software Development Life Cycle.
- **SPA:** Single Page Application.
- **SRS:** Software Requirements Specification.
- **TIN:** Taxpayer Identification Number registered with MIRA.
- **UML:** Unified Modeling Language.
- **UUID:** Universally Unique Identifier.
- **WDV:** Written Down Value.
- **XLSX:** Microsoft Excel OpenXML Spreadsheet file format.

### 1.5 Document Conventions
This document adheres to the IEEE Std 830-1998 standard for Software Requirements Specifications. The following typographical conventions are used:
- **Bold text** indicates component names, file paths, database entities, and formal role identifiers.
- `Monospaced text` denotes source code identifiers, API endpoints, HTTP verbs, JSON properties, and terminal commands.
- *Italics* denote commentary, business rules, or citations.
- Priority rankings are explicitly categorized as **High**, **Medium**, or **Low**.

### 1.6 References and Acknowledgments
1. Maldives Inland Revenue Authority (MIRA), 2022. *Goods and Services Tax Act (Law Number 10/2011 as amended by Act No. 20/2022)*. Male': MIRA.
2. Maldives Inland Revenue Authority (MIRA), 2024. *Tax Ruling on General Sector GST Return (MIRA 205) and GST Input Tax Invoicing Regulations*. Male': MIRA.
3. IEEE Computer Society, 1998. *IEEE Recommended Practice for Software Requirements Specifications (IEEE Std 830-1998)*. New York: IEEE.
4. Gomaa, H., 2000. *Designing Concurrent, Distributed, and Real-Time Applications with UML (COMET Method)*. Boston: Addison-Wesley.
5. SheetJS LLC, 2023. *SheetJS Community Edition: Spreadsheet Data Toolset Documentation*. Available at: <https://docs.sheetjs.com/>.
6. Google Cloud, 2025. *Google Gen AI SDK for TypeScript Reference Documentation*. Available at: <https://ai.google.dev/>.

---

## 2 Overall Description

### 2.1 Product Overview
The system is a distributed web-based software application operating on a client-server architecture. It is built as a self-contained tax-preparation module that enables retail multi-outlet enterprises to digitize paper receipts, perform automated field extraction, and populate the authoritative GST File Input Sheet required for statutory MIRA audits and filings.

The system interacts with two external actors: (1) **Branch/Outlet Operators**, who upload receipts from retail points of sale or store warehouses, and (2) **Central Finance Officers / Super Admins**, who manage branch configurations, supervise column mapping, and download compiled GST input workbooks. Externally, the application interfaces over HTTPS with the Google Gemini Multimodal Vision API for character recognition and tax semantic reasoning.

```
┌───────────────────────────────────────────────────────────────────────────┐
│                             CLIENT ENVIRONMENT                            │
│                                                                           │
│   ┌───────────────────────────┐          ┌────────────────────────────┐   │
│   │ Outlet Operator (Branch)  │          │ Super Admin (Central HQ)   │   │
│   │  - Drag & Drop Upload     │          │  - Multi-Outlet Management │   │
│   │  - Camera Photo Capture   │          │  - Template Column Mapping │   │
│   │  - Verification Dialog    │          │  - Consolidated Export     │   │
│   └─────────────┬─────────────┘          └─────────────┬──────────────┘   │
└─────────────────┼──────────────────────────────────────┼──────────────────┘
                  │ HTTPS / JSON & Multipart Forms       │
                  ▼                                      ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                             SERVER ENVIRONMENT                            │
│                                                                           │
│   ┌───────────────────────────────────────────────────────────────────┐   │
│   │ Express.js REST API Layer (Port 3000)                             │   │
│   │  - /api/bills/analyze (Multer upload & magic bytes validator)     │   │
│   │  - /api/bills/:id/verify (Field verification & persistence)       │   │
│   │  - /api/template/mapping (SheetJS dynamic header detector)        │   │
│   │  - /api/export/excel (OpenXML cell builder & download stream)     │   │
│   └─────────────┬──────────────────────────────┬──────────────────────┘   │
│                 │                              │                          │
│                 ▼                              ▼                          │
│   ┌───────────────────────────┐  ┌────────────────────────────────────┐   │
│   │ Security & RBAC Guard     │  │ SheetJS (xlsx) Workbook Engine     │   │
│   │  - Outlet Scoping Rule    │  │  - Parses custom_template.xlsx     │   │
│   │  - Super Admin Privilege  │  │  - Appends rows via sheet_add_aoa  │   │
│   │  - Upload Rate Limiting   │  │  - Generates binary download stream│   │
│   └─────────────┬─────────────┘  └────────────────────────────────────┘   │
│                 │                                                         │
│                 ▼                                                         │
│   ┌───────────────────────────┐                                           │
│   │ Gemini AI Vision Pipeline │ ─── HTTPS ──► Google Gemini API           │
│   │  - Base64 image payload   │               (Multimodal Vision Model)   │
│   │  - JSON schema extraction │                                           │
│   └───────────────────────────┘                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Product Functionality
The software performs the following major functions:
- **Multi-Modal Receipt & Invoice Ingestion:** Accepts single receipts and purchase bills via file system selection, drag-and-drop, or real-time camera photo capture.
- **Cryptographic File Sanitization:** Validates uploaded file buffers against strict MIME magic-bytes definitions (`image/jpeg`, `image/png`, `image/webp`, `application/pdf`) and rejects spoofed files.
- **Multimodal AI Tax Information Extraction:** Sends document image buffers to Google Gemini vision models with strict system instructions to extract vendor name, vendor TIN, bill number, issue date, subtotal, and 8% GST amount in Maldivian Rufiyaa.
- **In-Flight Review & Field Verification:** Provides an interactive modal window allowing users to cross-examine extracted fields against the document preview, modify values if needed, and confirm verification status.
- **Excel Template Ingestion & Header Detection:** Reads user-supplied custom `.xlsx` templates, extracts header labels from the primary worksheet, and maintains header coordinates.
- **Interactive Template Column Mapping:** Enables administrators to visually map canonical invoice attributes (`supplier_name`, `supplier_tin`, `invoice_number`, `invoice_date`, `taxable_value`, `gst_amount`, `invoice_total`, `outlet_name`) to corresponding template header columns.
- **Non-Destructive GST Input Sheet Updating:** Appends verified invoice records to the worksheet cell matrix using `XLSX.utils.sheet_add_aoa`, preserving pre-existing worksheet rows, headers, and formulas.
- **Multi-Outlet Isolation & RBAC:** Enforces strict role-based access control where outlet staff are confined to their specific outlet data, while administrators maintain global oversight across all outlets.
- **Filtered & Consolidated Excel Export:** Generates and streams down formatted OpenXML `.xlsx` spreadsheets filtered by quarter, calendar year, or specific outlet.

### 2.3 Design and Implementation Constraints
1. **Architecture & Engineering Method:** Software design is structured according to the **COMET (Concurrent Object Modeling and Architectural Design Method)** methodology, separating active controller processes, entity services, and interface boundary components.
2. **Modeling Standard:** Structural and behavioral abstractions are documented using the **Unified Modeling Language (UML 2.5)** standard.
3. **Backend Stack:** Node.js runtime environment (v22.x LTS), TypeScript (v5.8.x), Express.js (v4.21.x) with strict asynchronous error handling.
4. **Frontend Stack:** React 19 SPA compiled via Vite 6, utilizing Tailwind CSS 4 for responsive utility layout, and Lucide React icons.
5. **Spreadsheet Compilation Constraint:** Workbooks must be processed natively in Node.js memory using the SheetJS (`xlsx`) library without requiring external Microsoft Office automation or third-party cloud office suites.
6. **Regulatory Compliance Constraint:** All GST calculations must adhere to the 8% general rate mandated by the Maldives Goods and Services Tax Act Amendment (Act No. 20/2022).

### 2.4 Assumptions and Dependencies
- **Network Connectivity:** The host server must maintain outbound HTTPS (port 443) connectivity to Google Generative AI endpoints (`generativelanguage.googleapis.com`).
- **Client Hardware Capability:** Client devices utilizing camera scanning must support the HTML5 `MediaDevices.getUserMedia()` API and grant browser camera permissions.
- **Document Quality:** Receipts uploaded for AI extraction must have a minimum resolution of 300x300 pixels with legibly printed vendor and amount data.
- **Template Compatibility:** Uploaded Excel templates must be valid OpenXML `.xlsx` files with a header row located on Row 1 of the first worksheet.

---

## 3 Specific Requirements

### 3.1 External Interface Requirements

#### 3.1.1 User Interfaces
The user interface is a responsive, web-based dashboard consisting of the following primary views and modals:
- **Receipt Upload Modal (`UploadModal.tsx`):**
  - Displays a drag-and-drop file target zone with dashed amber-tinted borders and a direct file picker button.
  - Features an interactive tab for switching between **File Upload** and **Camera Capture**.
  - The Camera Capture tab renders an active video feed with a rounded viewfinder overlay, a "Capture Photo" shutter button, and a video device selector.
  - An animated processing indicator displays step-by-step progress (*"Uploading file..."* -> *"Gemini AI is parsing supplier TIN, invoice number, line items, and GST amounts..."*).
- **Bill Verification & Review Dialog (`BillReviewModal.tsx`):**
  - Side-by-side split screen presenting the uploaded receipt document image/PDF preview on the left and extracted editable input fields on the right.
  - Fields include: Supplier Name, Supplier TIN (7 to 10 digits), Invoice Number, Invoice Date (date picker), Taxable Subtotal (MVR), 8% GST Amount (MVR), and Total Amount (MVR).
  - Validation banner warning the user if the calculated 8% GST does not reconcile with the extracted total within 0.05 MVR tolerance.
  - "Verify & Save to GST Input Sheet" action button that promotes the bill from `pending_review` to `verified`.
- **Excel Template & GST Export Dialog (`ExcelExportModal.tsx`):**
  - **Template Configuration Section:** Displays current template status (*"Using Standard MIRA Format"* or *"Custom Template Active: custom_template.xlsx"*). Includes a template upload drop-zone and a "Reset to Default" action.
  - **Visual Column Mapper:** A grid listing the 10 canonical GST input fields alongside dropdown selectors containing all headers extracted from the uploaded Excel template.
  - **Export Filter Toolbar:** Controls for selecting Fiscal Quarter (Q1, Q2, Q3, Q4, or All), Fiscal Year, and Outlet Scope (All Outlets or individual branch).
  - **Download Trigger:** Primary CTA button labeled **"Download GST Purchases (.xlsx)"** which executes a POST request to `/api/export/excel` and triggers browser file download.
- **Multi-Outlet Administration Modal (`OutletManagementModal.tsx`):**
  - Accessible exclusively to `super_admin` users to create, view, and assign outlets (e.g., Male' Main Branch, Hulhumale' Outlet, Maafushi Resort Shop).

#### 3.1.2 Hardware Interfaces
- **Camera Sensor:** Interfaced through standard browser W3C Media Capture streams (`navigator.mediaDevices.getUserMedia`) supporting video resolutions up to 1080p for capture onto an HTML5 `<canvas>` element.
- **Storage Subsystem:** High-speed server block storage (SSD) hosting the document cache at `/data/uploads/` and template storage at `/data/custom_template.xlsx`.

#### 3.1.3 Software Interfaces
- **Google Gemini API (`@google/genai`):** Communicates via HTTPS REST protocols using API keys passed via server environment variables (`GEMINI_API_KEY`). Sends base64-encoded image payloads and receives structured JSON schema responses.
- **SheetJS (`xlsx` v0.18.5):** Embedded Node.js binary library executing OpenXML read/write operations (`XLSX.read`, `XLSX.utils.sheet_to_json`, `XLSX.utils.sheet_add_aoa`, and `XLSX.write`).

---

### 3.2 Functional Requirements

#### 3.2.1 F1: Multi-Outlet User Authentication & Branch Scoping
- **F1.1:** The system shall authenticate users via secure session cookies or Bearer tokens against the user registry.
- **F1.2:** If a user possesses the role `outlet_user`, the system shall strictly scope all bill queries, upload operations, and audit records to the user’s assigned `outlet_id`.
- **F1.3:** If a user possesses the role `super_admin`, the system shall grant authority to access all outlets, reassign bills, alter global template column mappings, and download consolidated cross-outlet GST sheets.
- **F1.4:** Any attempt by an `outlet_user` to access or modify records belonging to a different `outlet_id` shall be aborted with an `HTTP 403 Forbidden` response.

#### 3.2.2 F2: Multi-Modal Receipt & Invoice Ingestion
- **F2.1:** The system shall accept receipt file uploads in JPEG, PNG, WEBP, and PDF formats through multipart form-data.
- **F2.2:** The system shall inspect file headers using cryptographic magic-bytes verification (`UploadValidator.validateFile`). Files whose binary signature does not match their declared extension shall be rejected with `HTTP 400 Bad Request`.
- **F2.3:** The system shall enforce a maximum file size limit of 10 MB per upload.
- **F2.4:** The system shall support direct photo capture through the client device's camera, converting video stream frames to JPEG blobs prior to submission.
- **F2.5:** Upon valid upload, the system shall save the file to `/data/uploads/` with a sanitized UUID-based filename.

#### 3.2.3 F3: AI Information Extraction & Tax Attribute Normalization
- **F3.1:** The backend route `POST /api/bills/analyze` shall transmit the document image buffer to the Google Gemini multimodal model.
- **F3.2:** The AI extraction prompt shall instruct the model to extract:
  - `supplier_name`: Commercial legal name of the vendor.
  - `supplier_tin`: Vendor Taxpayer Identification Number (7 to 10 characters).
  - `invoice_number`: Vendor's official tax invoice or receipt serial number.
  - `invoice_date`: Date of supply formatted as `YYYY-MM-DD` or `DD MMM YYYY`.
  - `taxable_value`: Net purchase amount excluding GST in Maldivian Rufiyaa (MVR).
  - `gst_amount`: Extracted 8% Goods and Services Tax in MVR.
  - `total_amount`: Gross total payable in MVR.
- **F3.3:** The AI engine shall compare the extracted `supplier_tin` against the registered buyer's own business TIN. If they match, the system shall flag the result to prevent self-billing extraction errors.
- **F3.4:** If the receipt does not explicitly state the GST amount, the system shall calculate the tax using standard Maldives GST arithmetic: $\text{GST} = \text{Taxable Value} \times 0.08$.

#### 3.2.4 F4: In-Flight Verification & Line Item Tax Adjustment
- **F4.1:** Extracted metadata shall be returned to the client and rendered in the verification modal alongside the document preview.
- **F4.2:** The user shall have full capability to manually edit any extracted field prior to approval.
- **F4.3:** The client shall execute real-time mathematical validation: $\text{Calculated Total} = \text{Taxable Value} + \text{GST Amount}$. If the difference between the entered total and the sum exceeds 0.05 MVR, a discrepancy alert shall be displayed.
- **F4.4:** Upon clicking "Verify & Save", the backend `POST /api/bills/:id/verify` shall update the bill status to `verified` and store the verified payload.

#### 3.2.5 F5: Excel Template Header Parsing & Dynamic Column Mapping
- **F5.1:** The system shall allow administrators to upload a custom Excel template (`.xlsx`) via `POST /api/template/upload`.
- **F5.2:** The backend shall parse Row 1 of the primary sheet in the uploaded template using SheetJS and return the list of detected column headers.
- **F5.3:** The system shall maintain an active mapping dictionary (`templateMapping`) correlating canonical system fields with custom template headers.
- **F5.4:** Default fallback mappings shall be provided for standard MIRA GST Input Sheet formats:
  - `Date` $\rightarrow$ Date of Invoice
  - `Supplier Name` $\rightarrow$ Name of Vendor
  - `Supplier TIN` $\rightarrow$ Vendor TIN
  - `Invoice Number` $\rightarrow$ Tax Invoice No
  - `Subtotal (Excl. GST)` $\rightarrow$ Taxable Value (MVR)
  - `GST Amount (8%)` $\rightarrow$ Input GST Claimable (MVR)
  - `Total Amount` $\rightarrow$ Total Invoice Value (MVR)
  - `Outlet Name` $\rightarrow$ Branch / Location

#### 3.2.6 F6: Authoritative GST Input Sheet Updating
- **F6.1:** When the export engine is triggered (`POST /api/export/excel`), the system shall load either the active custom template from `/data/custom_template.xlsx` or generate a standard MIRA GST Input Sheet workbook.
- **F6.2:** The engine shall query all bills matching status `verified` and conforming to selected fiscal filters.
- **F6.3:** Each verified bill shall be transformed into a spreadsheet row where values are positioned according to the active column mapping coordinates.
- **F6.4:** Rows shall be appended to the worksheet using `XLSX.utils.sheet_add_aoa`, beginning immediately after the last existing data row (`origin: -1`), ensuring template formulas, styles, and existing records are preserved.

#### 3.2.7 F7: Filtered & Consolidated GST Input File Download
- **F7.1:** The export endpoint shall accept query parameters: `quarter` (Q1–Q4 or All), `year`, and `outlet`.
- **F7.2:** If an `outlet_user` requests the export, the backend shall force the filter to their assigned `outlet_id`, preventing cross-outlet data inclusion.
- **F7.3:** If a `super_admin` selects "All Outlets", the export shall consolidate verified bills from every branch, annotating each row with its respective `outlet_name`.
- **F7.4:** The server shall compile the updated workbook into a binary buffer using `XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })` and stream it to the client with `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and `Content-Disposition: attachment; filename="CR_Maldives_GST_Purchases_[Filter]_[Timestamp].xlsx"`.

---

### 3.3 Use Case Model

#### 3.3.1 Use Case Diagram Representation
```
                    ┌────────────────────────────────────────────────┐
                    │               GST Automation System            │
                    │                                                │
                    │    ┌──────────────────────────────────────┐    │
                    │    │ UC-01: Upload Receipt / Invoice File │    │
                    │    └──────────────────┬───────────────────┘    │
                    │                       │ <<includes>>           │
                    │                       ▼                        │
                    │    ┌──────────────────────────────────────┐    │
                    │    │ UC-02: Extract Receipt Info via AI   │    │
                    │    └──────────────────┬───────────────────┘    │
                    │                       │ <<includes>>           │
                    │                       ▼                        │
  [Outlet User] ───┼───►┌──────────────────────────────────────┐    │
        │           │    │ UC-03: Verify Extracted Tax Fields   │    │
        │           │    └──────────────────┬───────────────────┘    │
        │           │                       │ <<enables>>            │
        │           │                       ▼                        │
        │           │    ┌──────────────────────────────────────┐    │
        │           └───►│ UC-05: Update Sheet & Download File  │◄───┼─── [Super Admin]
        │                └──────────────────▲───────────────────┘    │         │
        │                                   │ <<uses mapping>>       │         │
        │                ┌──────────────────┴───────────────────┐    │         │
        └───────────────►│ UC-04: Configure Template Mapping    │◄───┘─────────┘
                         └──────────────────────────────────────┘    │
                    └────────────────────────────────────────────────┘
```

#### 3.3.2 UC-01: Upload Receipt / Invoice File
- **Author:** [Student Name]
- **Purpose:** Allow an authenticated user to upload a purchase receipt file or photograph for processing.
- **Requirements Traceability:** F1.1, F1.2, F2.1, F2.2, F2.3, F2.4, F2.5.
- **Priority:** High.
- **Preconditions:** User is logged in with an active session (`outlet_user` or `super_admin`).
- **Postconditions:** File is verified, stored in `/data/uploads/`, and assigned to the user's outlet.
- **Actors:** Outlet User, Super Admin.
- **Flow of Events:**
  1. *Basic Flow:*
     1. User navigates to the Bills dashboard and clicks **"Upload Receipt"**.
     2. System presents the `UploadModal` dialog.
     3. User drags and drops a receipt file (or selects it via file dialog).
     4. System performs client-side size and extension validation.
     5. Client transmits the file to `POST /api/bills/analyze` via multipart form data.
     6. Server validates MIME magic bytes, stores the file, and proceeds to UC-02.
  2. *Alternative Flow (Camera Capture):*
     1. In Step 3, user switches to the **"Camera Capture"** tab.
     2. System requests camera access and renders the live video stream.
     3. User positions the physical receipt in the frame and clicks **"Capture Photo"**.
     4. Canvas serializes the frame into a JPEG blob and triggers upload as in Step 5.
  3. *Exceptions:*
     - *E1 (Invalid File Type / Spoofed Extension):* System displays *"File rejected: Only PDF, JPG, and PNG images are permitted."* Upload terminates.
     - *E2 (File Exceeds 10 MB):* System displays *"File size exceeds 10 MB limit."* Upload terminates.
     - *E3 (Camera Denied):* System alerts user to grant camera permissions in browser settings.

#### 3.3.3 UC-02: Extract Receipt Metadata via AI Engine
- **Author:** [Student Name]
- **Purpose:** Automatically extract structured tax and financial metadata from the uploaded receipt image.
- **Requirements Traceability:** F3.1, F3.2, F3.3, F3.4.
- **Priority:** High.
- **Preconditions:** Receipt file is successfully uploaded and stored on the server.
- **Postconditions:** A new bill record is created with status `pending_review` containing extracted JSON fields.
- **Actors:** System (Google Gemini API), Triggered by User.
- **Flow of Events:**
  1. *Basic Flow:*
     1. Server reads the uploaded file buffer from `/data/uploads/`.
     2. Server builds a multimodal prompt embedding Maldivian tax rules (TIN format, 8% GST arithmetic).
     3. Server invokes the Google Gemini API with the image payload and schema definition.
     4. Gemini API parses document text and returns structured JSON.
     5. Server normalizes extracted values (converts amounts to two-decimal numbers, formats dates).
     6. Server stores the record in the persistence store and returns the extracted entity to the client.
  2. *Alternative Flow (Missing GST on Receipt):*
     1. In Step 4, Gemini identifies that the receipt states a subtotal but omits the explicit tax amount.
     2. System automatically computes `gst_amount = taxable_value * 0.08` and flags the field as calculated.
  3. *Exceptions:*
     - *E1 (AI API Unreachable / Overloaded):* System catches the error, generates a blank bill record with `extraction_failed` status, and prompts the user to enter details manually.
     - *E2 (Unreadable Document):* System alerts the user that critical text could not be resolved and opens the manual entry form.

#### 3.3.4 UC-03: Verify Extracted Tax Attributes
- **Author:** [Student Name]
- **Purpose:** Allow authorized staff to cross-examine and adjust AI-extracted figures against the receipt preview before finalizing.
- **Requirements Traceability:** F4.1, F4.2, F4.3, F4.4.
- **Priority:** High.
- **Preconditions:** Bill has been processed by UC-02 and exists in `pending_review` status.
- **Postconditions:** Bill status transitions to `verified` and becomes eligible for inclusion in the GST Input Sheet.
- **Actors:** Outlet User, Super Admin.
- **Flow of Events:**
  1. *Basic Flow:*
     1. System presents the `BillReviewModal` displaying the document preview alongside extracted fields.
     2. User reviews Supplier Name, TIN, Invoice Number, Date, Subtotal, GST, and Total.
     3. User clicks **"Verify & Save to GST Input Sheet"**.
     4. Client dispatches `POST /api/bills/:id/verify`.
     5. Server updates the bill's state to `verified` and commits changes to storage.
     6. System confirms verification with a success notification.
  2. *Alternative Flow (User Adjusts Line Values):*
     1. User identifies that the AI slightly misread an invoice digit (e.g., "8" instead of "3").
     2. User edits the relevant text field directly.
     3. System dynamically recalculates totals and clears validation warnings.
     4. User proceeds to Step 3.
  3. *Exceptions:*
     - *E1 (Mathematical Discrepancy > 0.05 MVR):* System displays a warning: *"Subtotal + 8% GST does not equal the entered Total Amount."* User must correct values or acknowledge the override before saving.

#### 3.3.5 UC-04: Configure GST Template Column Mapping
- **Author:** [Student Name]
- **Purpose:** Enable administrators to define and customize how canonical invoice fields map to header columns in custom Excel templates.
- **Requirements Traceability:** F1.3, F5.1, F5.2, F5.3, F5.4.
- **Priority:** Medium.
- **Preconditions:** User is authenticated as `super_admin`.
- **Postconditions:** Active template mapping dictionary is saved to `settings.json`.
- **Actors:** Super Admin.
- **Flow of Events:**
  1. *Basic Flow:*
     1. Admin opens the **"Excel Template Settings"** dialog.
     2. Admin uploads a custom corporate Excel template (`.xlsx`).
     3. Server reads Sheet 1, extracts all column labels from Row 1, and returns them to the UI.
     4. Admin selects corresponding template columns for each system field using dropdown selectors.
     5. Admin clicks **"Save Column Mappings"**.
     6. Server commits the mapping dictionary to `/data/settings.json`.
  2. *Alternative Flow (Reset to Standard MIRA Template):*
     1. Admin clicks **"Reset to Standard MIRA Template"**.
     2. Server deletes `/data/custom_template.xlsx` and resets mappings to statutory default headers.
  3. *Exceptions:*
     - *E1 (Invalid Template File):* System reports that the uploaded workbook contains no readable sheets or header rows.

#### 3.3.6 UC-05: Update GST Input Sheet & Download Workbook
- **Author:** [Student Name]
- **Purpose:** Update the authoritative GST File Input Sheet with verified purchase records and download the finalized `.xlsx` spreadsheet.
- **Requirements Traceability:** F1.2, F1.3, F6.1, F6.2, F6.3, F6.4, F7.1, F7.2, F7.3, F7.4.
- **Priority:** High.
- **Preconditions:** At least one bill exists in `verified` status for the selected period.
- **Postconditions:** The updated `.xlsx` file is generated and downloaded to the client machine without modifying the server's clean template.
- **Actors:** Outlet User, Super Admin.
- **Flow of Events:**
  1. *Basic Flow:*
     1. User opens the **"Export GST Purchases"** dialog.
     2. User selects the target Quarter (e.g., Q1), Fiscal Year (e.g., 2026), and Outlet scope.
     3. User clicks **"Download GST Purchases (.xlsx)"**.
     4. Client dispatches `POST /api/export/excel` with filter parameters.
     5. Server retrieves all matching `verified` bills.
     6. Server loads the base template workbook (`custom_template.xlsx` or standard MIRA template).
     7. Server constructs an Array of Arrays (AOA) matching template column positions via `templateMapping`.
     8. Server appends data rows below existing content using `XLSX.utils.sheet_add_aoa`.
     9. Server streams the generated binary spreadsheet to the client with attachment headers.
     10. Browser prompts the user and saves `CR_Maldives_GST_Purchases_[Quarter]_[Timestamp].xlsx`.
  2. *Alternative Flow (Outlet User Scoped Download):*
     1. If triggered by an `outlet_user`, the server automatically overrides the requested outlet parameter to the user's assigned `outlet_id`.
     2. The downloaded spreadsheet contains only receipts belonging to that user's outlet.
  3. *Exceptions:*
     - *E1 (No Verified Records Found):* Server returns `HTTP 404` with message *"No verified bills available for the selected period."* Client displays an advisory toast.

---

## 4 Other Non-Functional Requirements

### 4.1 Performance Requirements
- **P1: AI Extraction Latency:** The end-to-end processing time from initial receipt upload to the return of extracted JSON metadata shall not exceed 10 seconds under standard broadband conditions (10 Mbps).
- **P2: Spreadsheet Generation Speed:** The server shall compile and stream an Excel workbook containing up to 1,000 verified purchase rows within 1.5 seconds of request receipt.
- **P3: Client UI Responsiveness:** Client-side mathematical validation and recalculation on the `BillReviewModal` shall execute instantaneously (< 50 milliseconds).
- **P4: Multi-User Concurrency:** The backend shall support concurrent uploads from up to 20 branch outlets simultaneously without thread starvation or file write race conditions.

### 4.2 Safety and Security Requirements
- **S1: Cryptographic Magic-Bytes Verification:** The server shall never rely solely on file extensions or client-reported MIME types. All uploaded files must be inspected at the byte level to verify legitimate image or PDF signatures.
- **S2: Multi-Outlet Tenant Isolation:** Strict authorization barriers must ensure an `outlet_user` is incapable of reading, querying, editing, or exporting bills belonging to any other `outlet_id`.
- **S3: Path Traversal Prevention:** Uploaded file storage filenames must be generated using randomized UUIDs (`crypto.randomUUID()`) to prevent directory traversal attacks (`../`).
- **S4: Rate Limiting:** All upload endpoints shall be guarded by an upload rate-limiter restricting clients to a maximum of 30 upload requests per 5-minute rolling window per IP address.
- **S5: API Key Protection:** The Google Gemini API key shall remain strictly server-side and must never be exposed or transmitted to the client application.

### 4.3 Software Quality Attributes

#### 4.3.1 Reliability & Data Integrity
- The system must ensure that updating the GST File Input Sheet never causes data corruption, row truncation, or formula overwrites in existing template sheets.
- All monetary amounts must be stored and formatted to exactly two decimal places, preventing floating-point precision leakage into statutory tax records.

#### 4.3.2 Usability & Error Tolerance
- The user interface must provide clear, human-readable error messages for all failure modes (e.g., unreadable receipts, mismatched totals, missing TINs).
- The dual-input upload mechanism (file drop vs. camera capture) must adapt seamlessly across desktop monitors, warehouse tablets, and mobile smartphones.

#### 4.3.3 Maintainability & Modularity
- The system shall maintain strict architectural decoupling between the receipt ingestion controller, the AI extraction adapter, and the SheetJS OpenXML compiler.
- Modifying the MIRA statutory GST rate (e.g., adjusting from 8% to a revised rate) shall require editing a single centralized configuration file (`/src/config/miraTaxRates.ts`).

#### 4.3.4 Portability
- The client application shall function consistently across all modern W3C-compliant web browsers (Google Chrome, Microsoft Edge, Mozilla Firefox, Apple Safari) without requiring third-party browser plugins or ActiveX controls.
- The server backend must be containerizable using standard Docker/OCI specifications and deployable across any modern Linux distribution.

---

## 5 Other Requirements

### 5.1 Legal & Statutory Tax Compliance (MIRA GST Act)
- The application must format all output purchase records to satisfy the record-keeping standards established under Section 27 of the Maldives Goods and Services Tax Act.
- Each exported record must distinctly maintain the supplier's Taxpayer Identification Number (TIN), tax invoice serial number, date of supply, net taxable value, and explicit 8% GST amount.

### 5.2 Multi-Outlet Data Isolation Rules
- Every purchase bill entity recorded in the system must be permanently stamped with:
  - `outlet_id`: Unique identifier of the originating retail branch.
  - `outlet_name`: Descriptive branch name (e.g., "Male' Main Branch", "Hulhumale' Outlet", "Maafushi Resort Shop").
  - `created_by`: User ID of the uploading operator.
- Automated tests must enforce that cross-outlet data modification attempts are systematically blocked.

---

## Appendix A – Data Dictionary

| Variable / Field Name | Category | Data Type | Possible States / Values | Description & Related Operations |
| :--- | :--- | :--- | :--- | :--- |
| `id` | State Variable | String (UUID) | Auto-generated UUID | Unique primary key identifying a purchase bill or receipt record. |
| `file_name` | State Variable | String | Alphanumeric string | Name of the uploaded receipt file stored on the server filesystem. |
| `file_url` | State Variable | String (URI) | `/data/uploads/{filename}` | Relative HTTP URL used by the client to render the document preview. |
| `outlet_id` | State Variable | String | e.g., `outlet-1`, `outlet-2`, `outlet-3` | Foreign key binding the bill to a specific retail branch. Enforces RBAC isolation. |
| `outlet_name` | State Variable | String | e.g., `Male' Main Branch`, `Hulhumale' Outlet` | Human-readable branch name populated into exported GST Input Sheets. |
| `status` | State Variable | String (Enum) | `pending_review`, `verified`, `archived` | Current processing state of the receipt. Only `verified` bills are appended to the GST sheet. |
| `supplier_name` | Extracted / Input | String | Vendor legal name | Business name of the issuing supplier extracted via Gemini AI or edited by user. |
| `supplier_tin` | Extracted / Input | String | 7 to 10 alphanumeric characters | Taxpayer Identification Number of the vendor registered with MIRA. |
| `invoice_number` | Extracted / Input | String | Serial alphanumeric | Official invoice or receipt reference number issued by the supplier. |
| `invoice_date` | Extracted / Input | String (Date) | `YYYY-MM-DD` or `DD MMM YYYY` | Date on which the goods or services were supplied. |
| `taxable_value` | Extracted / Input | Number (Float) | $\ge 0.00$ | Purchase value subject to GST, excluding the tax amount, in Maldivian Rufiyaa (MVR). |
| `gst_amount` | Extracted / Input | Number (Float) | $\ge 0.00$ | Claimable input Goods and Services Tax amount calculated at the statutory 8% rate. |
| `invoice_total` | Extracted / Input | Number (Float) | $\ge 0.00$ | Total gross purchase amount payable ($\text{taxable\_value} + \text{gst\_amount}$). |
| `quarter` | Input / Filter | String (Enum) | `Q1`, `Q2`, `Q3`, `Q4`, `All` | Fiscal quarter derived from invoice date or selected in export dialog filters. |
| `role` | State Variable | String (Enum) | `outlet_user`, `super_admin` | Access control role determining whether operations are branch-scoped or global. |
| `TEMPLATE_EXCEL_FILE` | Constant | String (Path) | `/data/custom_template.xlsx` | Absolute server path to the active user-uploaded Excel template. |
| `templateMapping` | State Variable | Object (Dict) | Key-value pairs (`field: column_header`) | Dynamic mapping dictionary correlating system fields to template header strings. |
| `DEFAULT_GST_RATE` | Constant | Number (Float) | `0.08` | Statutory Maldivian GST rate (8%) applied to general sector purchases. |
| `MAX_FILE_SIZE` | Constant | Integer | `10485760` (10 MB in bytes) | Maximum allowable file size for receipt and template uploads. |
| `ALLOWED_MIME_TYPES` | Constant | Array of Strings | `image/jpeg`, `image/png`, `image/webp`, `application/pdf` | Whitelist of permissible file MIME signatures validated via magic bytes. |

---
*End of Software Requirements Specification (SRS)*
