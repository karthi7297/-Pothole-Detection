# PRODUCT REQUIREMENTS DOCUMENT (PRD)

**Project Name:** RoadPulse Coimbatore — Automated Infrastructure Digital Twin & Predictive Maintenance Engine

**Document Version:** 2.0 (Hackathon Enterprise Edition)

**Target Deployment:** Coimbatore Municipal Corporation (CMC) & Tamil Nadu Highways Department

**Deployment Region:** Coimbatore, Tamil Nadu, India

**Cost Model:** 100% Free & Open-Source Stack

---

## 1. Executive Summary & Regional Context

### 1.1 The Problem Statement (Coimbatore Region)

The Coimbatore Municipal Corporation (CMC) oversees a road network spanning over 2,100 km across 5 administrative zones (North, South, East, West, and Central). Currently, road maintenance in Coimbatore suffers from three structural failures:

1. **Monsoon Degradation Acceleration:** During the South-West and North-East monsoons, rainwater pools in unsealed asphalt cracks along major corridors like *Avinashi Road*, *Mettupalayam Road*, and *Trichy Road*. Heavy vehicle traffic (TNSTC buses and freight lorries) forces water into the road sub-base, causing rapid structural collapse into deep potholes within 48 hours.
2. **Wasteful Band-Aid Patching:** Local ward engineers repeatedly deploy cold-mix asphalt to patch the exact same recurring potholes (e.g., near *Gandhipuram Flyover* or *RS Puram DB Road*). This temporary patching wastes lakhs of municipal rupees annually without addressing sub-base erosion.
3. **Reactive 311 Grievances:** Repairs rely almost exclusively on citizen complaints via the *Namma Coimbatore* app or public outcry, meaning hazards remain open for weeks, risking motorist safety and incurring vehicle damage claims.

### 1.2 The Solution

**RoadPulse Coimbatore** is an automated, zero-cost digital twin platform that transforms existing public fleets—specifically **TNSTC town buses** and **CMC waste collection vehicles**—into passive, real-time road inspectors. By combining pre-trained edge computer vision (YOLOv8), open-source spatial clustering (DBSCAN), local weather forecasts, and free-tier LLM intelligence, RoadPulse delivers:

* Real-time road damage detection and classification aligned with Indian Roads Congress (IRC:82) standards.
* Automated street-block **Pavement Condition Index (PCI)** scoring.
* Predictive **Monsoon Inundation Hazard** alerts prior to heavy rainfall events.
* **Chronic Hotspot Identification** to stop recurring patch waste and force permanent sub-base reconstruction.
* Zero-lag, 1-click **AI Dispatch Work Orders** generated via free OpenRouter LLM endpoints.

---

## 2. Product Vision & Value Proposition

### 2.1 Core Vision

To provide Coimbatore Municipal Corporation with a passive, predictive, and budget-optimizing road infrastructure management platform built entirely on free, open-source technology that can be deployed without custom hardware investments.

### 2.2 Key Value Metrics (Target KPIs)

| Metric | Current State (Manual/Reactive) | RoadPulse Target State |
| --- | --- | --- |
| **Hazard Discovery Time** | 14–21 Days (Citizen Complaint) | < 2 Hours (Automated Bus Fleet Pass) |
| **Inspection Cost per KM** | ₹1,200 / km (Manual Survey) | ₹0 / km (Passive Fleet Scanning) |
| **Preventative Repair Rate** | < 5% (Fixes after collapse) | > 40% (Crack sealing before monsoon) |
| **Hotspot Patch Savings** | ₹0 (Repeated patches) | ₹3.8 Lakhs / Ward / Year saved |

---

## 3. User Roles & Permission Matrix (RBAC Lite)

To ensure rapid evaluation by hackathon judges without authentication delay, access control is managed via an instant **Role Switcher** interface at the top of the application.

```
+-----------------------------------------------------------------------------------+
|  [ROLE SWITCHER]: (x) Municipal Executive  ( ) Field Inspector  ( ) Fleet Driver  |
+-----------------------------------------------------------------------------------+
```

### 3.1 Role Breakdown

| Feature / Workspace | Fleet Driver (Passive Ingestion) | Field Inspector (Triage Officer) | Municipal Executive (Admin / Engineer) |
| --- | --- | --- | --- |
| **Live Dashcam AI Feed** | Read / View | Hidden | Hidden |
| **Interactive GIS Map** | Hidden | Read Only | Read / Interactive |
| **Verification Queue** | Hidden | Read / Approve / Reject | Read / Override |
| **PCI City Health Metrics** | Hidden | Hidden | Full Access |
| **Monsoon Risk Alerts** | Hidden | Read Only | Full Access |
| **AI Work Order Generator** | Hidden | Hidden | Trigger / Export PDF |

---

## 4. Functional Specifications & Core Algorithms

### 4.1 Multi-Class Edge Computer Vision Engine

* **Integration Strategy:** Zero model training required. Imports pre-trained weights (`best.pt`) from open-source repositories (`HarshithaPethuraj/pothole-detection-yolov8`, `juligevariya/Road-damage-detection`) and frame extraction loops from `Botkraker/RoadScanCV`.
* **IRC Damage Classification:**
  * **Class 0 (`Pothole`):** Deep bowl-shaped depression. High-priority safety hazard.
  * **Class 1 (`Alligator Crack`):** Interconnected fatigue cracks resembling reptile skin. High structural degradation indicator.
  * **Class 2 (`Longitudinal Crack`):** Single linear crack along the pavement seam. Early-stage moisture ingress vector.
* **Filter Gate:** Detections with YOLO confidence < 0.60 are automatically rejected at the edge script level to prevent false positives (e.g., shadows, leaves, oil stains).

### 4.2 Dynamic Priority Level Scoring Algorithm

Detections are ranked dynamically using physical dimensions, route importance, duplicate frequency, and monsoon threat multipliers.

Priority Score = (Severity Score × Traffic Multiplier) + (Report Count × 1.5) + Monsoon Risk Bonus

Where:

* Severity Score = Bounding Box Area Ratio × YOLO Confidence × 10
* Traffic Multiplier:
  * Major Arterials (*Avinashi Rd, Mettupalayam Rd*): 2.0x
  * Bus Routes / Collector Roads (*DB Rd, Thadagam Rd*): 1.5x
  * Ward / Residential Lanes (*RS Puram Interior*): 1.0x
* Report Count: Number of unique fleet observations within a 5-meter radius.
* Monsoon Risk Bonus: +5.0 points added if an alligator crack location has a rainfall forecast > 25 mm/day.

```
Priority Score Grading Scale:
  0.0 - 10.0  --> LOW PRIORITY      (Green Badge)
 10.1 - 22.0  --> MEDIUM PRIORITY   (Yellow Badge)
 22.1 - 35.0  --> HIGH PRIORITY     (Amber Badge)
 35.1+        --> CRITICAL EMERGENCY (Red Flashing Badge)
```

### 4.3 Monsoon Inundation & Sub-Base Erosion Engine

* **Regional Mechanics:** Water penetrating cracks causes asphalt binder stripping when compressed by heavy vehicles during Tamil Nadu monsoons.
* **Execution Logic:**
  1. Backend queries SQLite for coordinates where `damage_class == 'alligator_crack'`.
  2. Pings OpenWeatherMap free API using latitude/longitude for Coimbatore coordinates.
  3. If 5-day forecast detects daily rainfall >= 25 mm/day, set `monsoon_inundation_risk = TRUE`.
  4. Flag coordinate on the GIS map as a **Flashing Amber Monsoon Hazard**.

### 4.4 Chronic Hotspot Clustering Engine (DBSCAN)

* **Algorithm:** Runs `scikit-learn` Density-Based Spatial Clustering of Applications with Noise (`DBSCAN`).
* **Parameters:** epsilon = 5.0 meters, min_samples = 3 detections.
* **Business Rule:** If >= 3 distinct repair/detection records occur inside a 5-meter radius within 180 days, flag as a **Chronic Structural Sub-Base Failure**.
* **Financial Action:** Recommends halting cold-mix patches (~ ₹2,000/patch) and schedules a permanent sub-base reconstruction (~ ₹85,000), presenting net long-term savings.

### 4.5 Automated Pavement Condition Index (PCI)

* **Standard:** Compliant with IRC:82 pavement surface evaluation ratings (0 to 100).
* **Base Rating:** Each road segment starts at PCI = 100.
* **Deduction Points:**
  * Pothole: -15 points per occurrence
  * Alligator Cracks: -8 points per occurrence
  * Longitudinal Cracks: -3 points per occurrence
* **Segment Thresholds:**
  * PCI >= 80: **Good** (Solid Green Line)
  * 50 <= PCI < 80: **Fair / Degrading** (Solid Yellow Line)
  * PCI < 50: **Poor / Critical** (Solid Red Line)

### 4.6 Spam Protection & False Accusation Filtering

* **Spatial Deduplication:** Detections within 5 meters from the *same* vehicle/user ID inside 24 hours increment `pass_count` but do not create duplicate database rows.
* **Multi-Vehicle Validation:** Detections recorded by *different* vehicles/users within 5 meters increment `report_count`, boosting the Dynamic Priority Score.
* **Edge Sanity Check:** Bounding box aspect ratios that do not match asphalt anomaly dimensions (e.g., tall vertical boxes from trees or human shadows) are dropped before database insertion.

### 4.7 OpenRouter AI Work Order & Legal Summary Generator

* **Primary LLM:** `nvidia/nemotron-3-super-120b-a12b:free`
* **Fallback LLM:** `inclusionai/ling-3.0-flash-sante:free`
* **Function:** Compiles database records for selected critical hotspots, calculates required raw materials (cold-mix asphalt in metric tons, emulsion, labor force), and outputs a structured municipal work order formatted for CMC engineering teams.

---

## 5. 100% Free Tooling & Tech Stack Matrix

All components of RoadPulse are selected specifically to run at zero financial cost using open-source packages and free-tier cloud endpoints.

```
+-----------------------------------------------------------------------------------+
|                                 ROAD PULSE STACK                                  |
|                                                                                   |
|  [Frontend UI] --------> Streamlit 1.32+ (Custom Tactical Dark CSS)               |
|  [Mapping Engine] -----> Streamlit-Folium / Folium (Leaflet Vector Tiles)         |
|  [Computer Vision] ----> YOLOv8 (Ultralytics) + OpenCV (PyTorch CPU/GPU)          |
|  [Database] -----------> SQLite3 (`roadpulse.db`) + SQLAlchemy ORM                |
|  [Analytics/ML] -------> Scikit-learn (DBSCAN) + Pandas + NumPy                   |
|  [Weather API] --------> OpenWeatherMap Free Tier (1,000 calls/day)               |
|  [LLM Engine] ---------> OpenRouter Free Tier (Nemotron 120B / Ling 3.0)           |
+-----------------------------------------------------------------------------------+
```

---

## 6. Database Schema (SQLite Production DDL)

Save and execute the following DDL script to initialize `roadpulse.db`:

```sql
-- SQLite Production Schema for RoadPulse Coimbatore

-- 1. Raw Detections Table
CREATE TABLE IF NOT EXISTS detections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    vehicle_id VARCHAR(50) DEFAULT 'TNSTC_BUS_CB_104',
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    damage_class VARCHAR(30) NOT NULL, -- 'pothole', 'alligator_crack', 'longitudinal_crack'
    confidence REAL NOT NULL,
    bbox_area_ratio REAL NOT NULL,
    image_path VARCHAR(255),
    street_name VARCHAR(100) DEFAULT 'Avinashi Road',
    zone_name VARCHAR(50) DEFAULT 'East Zone',
    road_type VARCHAR(20) DEFAULT 'Arterial', -- 'Arterial', 'Collector', 'Residential'
    status VARCHAR(20) DEFAULT 'Pending' -- 'Pending', 'Verified', 'Dispatched', 'Repaired'
);

-- 2. Road Segments Health Table (PCI Tracking)
CREATE TABLE IF NOT EXISTS road_segments (
    segment_id VARCHAR(50) PRIMARY KEY, -- e.g. 'SEG_AVINASHI_01'
    street_name VARCHAR(100) NOT NULL,
    zone_name VARCHAR(50) DEFAULT 'East Zone',
    start_lat REAL NOT NULL,
    start_lon REAL NOT NULL,
    end_lat REAL NOT NULL,
    end_lon REAL NOT NULL,
    road_type VARCHAR(20) DEFAULT 'Arterial',
    current_pci INTEGER DEFAULT 100,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Chronic Hotspots & Risk Table (DBSCAN Output)
CREATE TABLE IF NOT EXISTS chronic_hotspots (
    hotspot_id INTEGER PRIMARY KEY AUTOINCREMENT,
    center_lat REAL NOT NULL,
    center_lon REAL NOT NULL,
    street_name VARCHAR(100) NOT NULL,
    radius_meters REAL DEFAULT 5.0,
    detection_count INTEGER DEFAULT 1,
    is_chronic BOOLEAN DEFAULT 0,
    monsoon_inundation_risk BOOLEAN DEFAULT 0,
    priority_score REAL DEFAULT 0.0,
    estimated_patch_cost_inr REAL DEFAULT 0.0,
    estimated_reconstruct_cost_inr REAL DEFAULT 0.0,
    status VARCHAR(20) DEFAULT 'Active'
);

-- 4. AI Generated Work Orders Table
CREATE TABLE IF NOT EXISTS work_orders (
    work_order_id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    hotspot_id INTEGER,
    priority_level VARCHAR(20),
    asphalt_required_tons REAL,
    estimated_budget_inr REAL,
    summary_text TEXT,
    assigned_ward_office VARCHAR(100) DEFAULT 'CMC Ward 32 Office',
    FOREIGN KEY(hotspot_id) REFERENCES chronic_hotspots(hotspot_id)
);
```

---

## 7. System Architecture & Data Flow

```
[ FLEET DASHCAM / VIDEO ]
          |
          v
[ OpenCV Frame Capture ] ---> [ YOLOv8 Inference (best.pt) ]
                                          |
                                          v  (Confidence >= 0.60)
                             [ Extract Class & Bounding Box ]
                                          |
                                          v
                             [ SQLite DB Insert (`detections`) ]
                                          |
        +---------------------------------+---------------------------------+
        |                                 |                                 |
        v                                 v                                 v
[ DBSCAN Clustering ]          [ OpenWeatherMap API ]            [ PCI Calculator ]
(5m Radius Grouping)           (Rainfall > 25mm/day)            (Deduct from Base 100)
        |                                 |                                 |
        +---------------------------------+---------------------------------+
                                          |
                                          v
                       [ Hotspots & Priority Calculation ]
                                          |
                                          v
                       [ Streamlit Tactical Dashboard ]
                                          |
                                          v
                       [ OpenRouter Nemotron 120B LLM ]
                                          |
                                          v
                       [ Instant Work Order & ROI Summary ]
```

---

## 8. UI/UX Design System & Theme Tokens

The dashboard uses a tactical command design system tuned for rapid scanning and minimal cognitive load during presentations.

### 8.1 Custom CSS Design Tokens (`style.css`)

```css
/* Tactical Command Theme Tokens for Streamlit */
:root {
  --bg-main: #090D16;          /* Deep Slate Background */
  --bg-card: #121826;          /* Card Container Surface */
  --border-card: #1F293D;      /* High Contrast Border */
  --text-primary: #F8FAFC;     /* Off-White Primary Text */
  --text-secondary: #94A3B8;   /* Muted Slate Text */
  --accent-cyan: #00E5FF;      /* System Accent */

  /* Status Colors */
  --color-critical: #FF3B30;   /* Emergency Pothole Red */
  --color-monsoon: #FF9500;    /* Monsoon Risk Amber */
  --color-chronic: #AF52DE;    /* Chronic Hotspot Purple */
  --color-good: #34C759;       /* Healthy PCI Green */
}

/* Custom Card Layout */
.stMetricCard {
  background-color: var(--bg-card) !important;
  border: 1px solid var(--border-card) !important;
  border-radius: 8px !important;
  padding: 16px !important;
}
```

### 8.2 Layout Geometry (Split Screen Layout)

```
+-------------------------------------------------------------------------------------+
| [LOGO] ROADPULSE COIMBATORE | [ROLE]: (x) Exec  ( ) Inspector  ( ) Driver | [LIVE]   |
+-------------------------------------------------------------------------------------+
| METRIC CARDS:                                                                       |
| [ Avg City PCI: 58/100 ] [ Active Potholes: 18 ] [ Monsoon Hazards: 6 ] [ ROI: ₹3.8L ]|
+-----------------------------------------------+-------------------------------------+
|                                               | RIGHT PANEL (Control & Triage)      |
|                                               |                                     |
| LEFT PANEL (60% Width):                       | [ TAB 1: Priority Triage Queue ]    |
| INTERACTIVE COIMBATORE GIS MAP                | ----------------------------------  |
|                                               | [CRITICAL] Avinashi Rd (HOPE Coll)  |
| * Polylines (PCI Scores):                     | Score: 38.4 | Monsoon Risk: YES     |
|   - Green: PCI > 80                           | Action: [ Approve & Dispatch ]      |
|   - Yellow: PCI 50-80                         | ----------------------------------  |
|   - Red: PCI < 50                             | [CHRONIC] DB Road (RS Puram)        |
|                                               | Score: 28.1 | Patched 4x in 6 Mon   |
| * Map Pins:                                   | Action: [ Schedule Reconstruction ] |
|   - Flashing Red: Critical Pothole            |                                     |
|   - Flashing Amber: Monsoon Risk Crack        | [ TAB 2: AI Work Order Generator ]  |
|   - Purple Badge: Chronic Hotspot             | Target: CMC Ward 32                 |
|                                               | Button: [ Generate Work Order ]     |
+-----------------------------------------------+-------------------------------------+
```

---

## 9. Localized Seed Data Configuration (Coimbatore Corridors)

To ensure zero setup time, pre-seed SQLite with these realistic Coimbatore coordinates and parameters.

```python
# seed_coimbatore.py - SQLite Pre-seeding Script

COIMBATORE_CORRIDORS = [
    {
        "segment_id": "SEG_AVINASHI_01",
        "street_name": "Avinashi Road (HOPE College Stretch)",
        "zone_name": "East Zone",
        "start_lat": 11.0283, "start_lon": 76.9942,
        "end_lat": 11.0345, "end_lon": 77.0081,
        "road_type": "Arterial",
        "current_pci": 42 # Critical
    },
    {
        "segment_id": "SEG_DBROAD_01",
        "street_name": "DB Road (RS Puram Commercial Hub)",
        "zone_name": "Central Zone",
        "start_lat": 11.0251, "start_lon": 76.9482,
        "end_lat": 11.0388, "end_lon": 76.9451,
        "road_type": "Arterial",
        "current_pci": 38 # Critical
    },
    {
        "segment_id": "SEG_TRICHY_01",
        "street_name": "Trichy Road (Singanallur Junction)",
        "zone_name": "South Zone",
        "start_lat": 10.9981, "start_lon": 76.9924,
        "end_lat": 11.0025, "end_lon": 77.0112,
        "road_type": "Arterial",
        "current_pci": 78 # Fair
    }
]

SAMPLE_HOTSPOTS = [
    {
        "center_lat": 11.0295, "center_lon": 76.9981,
        "street_name": "Avinashi Road (HOPE College)",
        "detection_count": 5, "is_chronic": True,
        "monsoon_inundation_risk": True, "priority_score": 42.5,
        "estimated_patch_cost_inr": 10000.0,
        "estimated_reconstruct_cost_inr": 85000.0
    },
    {
        "center_lat": 11.0112, "center_lon": 76.9532,
        "street_name": "DB Road (RS Puram)",
        "detection_count": 4, "is_chronic": True,
        "monsoon_inundation_risk": False, "priority_score": 28.1,
        "estimated_patch_cost_inr": 8000.0,
        "estimated_reconstruct_cost_inr": 65000.0
    }
]
```

---

## 10. Zero-Lag Hackathon Execution Roadmap (24-Hour Plan)

Follow this execution schedule to complete the application within 24 hours.

```
+-----------------------------------------------------------------------------------+
|                            24-HOUR HACKATHON SCHEDULE                             |
|                                                                                   |
|  Hours 00 - 04 : Environment Setup, Clone Repos, Run YOLOv8 on Sample Video       |
|  Hours 04 - 08 : SQLite Schema Creation & Run Seeding Script (`seed_coimbatore`) |
|  Hours 08 - 12 : Implement DBSCAN Clustering & Priority Score Algorithm           |
|  Hours 12 - 16 : Integrate OpenWeatherMap API & Monsoon Risk Trigger Logic        |
|  Hours 16 - 20 : Build Streamlit Dashboard, Folium Map & Custom Dark CSS          |
|  Hours 20 - 22 : Hook OpenRouter Free LLM API for 1-Click Work Order PDF Export   |
|  Hours 22 - 24 : Dry Run Pitch, Verify Offline Fallbacks, Final Presentation Prep |
+-----------------------------------------------------------------------------------+
```

### 10.1 Key Code Implementation Snippets

#### A. DBSCAN Clustering Implementation (`clustering.py`)

```python
import numpy as np
from sklearn.cluster import DBSCAN
import sqlite3

def run_dbscan_clustering(db_path="roadpulse.db"):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Fetch all detection coordinates
    cursor.execute("SELECT id, latitude, longitude FROM detections WHERE status='Pending'")
    rows = cursor.fetchall()

    if not rows:
        return

    coords = np.array([[r[1], r[2]] for r in rows])

    # Earth radius in kilometers; 5 meters = 0.005 km
    kms_per_radian = 6371.0088
    epsilon = 0.005 / kms_per_radian

    db = DBSCAN(eps=epsilon, min_samples=3, metric='haversine').fit(np.radians(coords))
    labels = db.labels_

    # Process clusters
    unique_labels = set(labels)
    for k in unique_labels:
        if k == -1:
            continue # Noise points

        cluster_mask = (labels == k)
        cluster_coords = coords[cluster_mask]
        center_lat = np.mean(cluster_coords[:, 0])
        center_lon = np.mean(cluster_coords[:, 1])
        detection_count = len(cluster_coords)

        # Save or update chronic hotspot table
        cursor.execute("""
            INSERT INTO chronic_hotspots
            (center_lat, center_lon, street_name, detection_count, is_chronic, priority_score)
            VALUES (?, ?, 'Avinashi Road', ?, 1, ?)
        """, (center_lat, center_lon, detection_count, detection_count * 7.5))

    conn.commit()
    conn.close()
```

#### B. OpenRouter API Integration (`work_order.py`)

```python
import requests
import json

OPENROUTER_API_KEY = "YOUR_FREE_OPENROUTER_KEY"

def generate_ai_work_order(hotspot_data):
    prompt = f"""
    You are the Chief Municipal Engineer for Coimbatore Municipal Corporation (CMC).
    Generate a formal asphalt repair dispatch work order based on the following automated data:

    Location: {hotspot_data['street_name']}
    GPS Coordinates: {hotspot_data['lat']}, {hotspot_data['lon']}
    Detection Count: {hotspot_data['count']} (Flagged as Chronic Structural Failure)
    Monsoon Inundation Risk: {hotspot_data['monsoon_risk']}
    Priority Score: {hotspot_data['priority_score']}

    Provide a concise report with:
    1. Recommended Action (Cold Patch vs Sub-base Reconstruction)
    2. Estimated Raw Material Requirements (Asphalt Tons, Bitumen Emulsion)
    3. Crew Size & Heavy Equipment Needed
    4. Financial Risk Statement if Unrepaired Before Monsoon
    """

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": "nvidia/nemotron-3-super-120b-a12b:free",
        "messages": [{"role": "user", "content": prompt}],
        "fallback_models": ["inclusionai/ling-3.0-flash-sante:free"]
    }

    response = requests.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, data=json.dumps(payload))

    if response.status_code == 200:
        return response.json()['choices'][0]['message']['content']
    else:
        return "Work Order Generation Error. Using Offline Template."
```

---

## 11. Final Pitch Deck & Presentation Checklist

During the 3-minute hackathon pitch to the judges, frame the project around municipal impact rather than raw code.

* [x] **0:00 – 0:30 (The Hook):** Show live dashcam video running locally in Python. YOLOv8 detects potholes and cracks at 30 FPS. Highlight the live detection counter.
* [x] **0:30 – 1:15 (The Coimbatore Map & PCI):** Switch to Executive Dashboard. Point out the color-coded *Avinashi Road* and *DB Road* segments updating their PCI score automatically.
* [x] **1:15 – 2:00 (The Monsoon Risk X-Factor):** Click a Flashing Amber Icon. Explain how cross-referencing OpenWeatherMap API predicts asphalt collapse *before* heavy rains hit Coimbatore.
* [x] **2:00 – 2:30 (Chronic Hotspots & Financial ROI):** Click a Chronic Purple Badge. Show that the location was patched 4 times in 6 months, and explain how switching to full sub-base repair saves ₹3.8 Lakhs per ward.
* [x] **2:30 – 3:00 (1-Click AI Dispatch & Wrap Up):** Click **"Generate AI Work Order"**. Show the generated dispatch summary via OpenRouter Nemotron 120B. End on the metric card: **"Total Estimated Municipal Savings: ₹14.2 Lakhs."**
