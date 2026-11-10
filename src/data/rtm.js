// Requirements Traceability Matrix — transcribed from the WasteLess RTM report.
// `page` links each feature to the screen that implements it; `test` names the
// automated verification in tests/requirements.test.js.

export const FEATURES = [
  { id: 'F1.1', epic: 1, name: 'Multi-Variable Time-Series Demand Forecaster', page: 'forecast' },
  { id: 'F1.2', epic: 1, name: 'Dynamic Environmental & Calendar Pipeline', page: 'calendar' },
  { id: 'F1.3', epic: 1, name: 'Automated ML Retraining & Variance Engine', page: 'model' },
  { id: 'F1.4', epic: 1, name: 'Managerial Manual Override Control', page: 'overrides' },
  { id: 'F2.1', epic: 2, name: 'Daily Portion Preparation Guide & Scheduler', page: 'prep' },
  { id: 'F2.2', epic: 2, name: 'Purchasing & Safety Stock Calculator', page: 'purchasing' },
  { id: 'F2.3', epic: 2, name: 'Low Stock & Shortage Alert System', page: 'inventory' },
  { id: 'F2.4', epic: 2, name: 'Menu Item Popularity & Waste Ratio Analyzer', page: 'analyzer' },
  { id: 'F3.1', epic: 3, name: 'End-of-Shift Waste Logging Portal', page: 'waste-log' },
  { id: 'F3.2', epic: 3, name: 'Interactive Operations & Trend Dashboard', page: 'dashboard' },
  { id: 'F3.3', epic: 3, name: 'Financial Cost Savings & ROI Calculator', page: 'savings' },
  { id: 'F3.4', epic: 3, name: 'Sustainability & Carbon Offset Generator', page: 'sustainability' },
  { id: 'F4.1', epic: 4, name: 'Historical Data Ingestion & Schema Validator', page: 'admin' },
  { id: 'F5.1', epic: 5, name: 'Live Menu Display & Dietary Filters', page: 'menu' },
  { id: 'F5.2', epic: 5, name: 'Real-Time Low Supply Indicators', page: 'menu' },
  { id: 'F5.3', epic: 5, name: 'Crowd Density & Peak Hour Meter', page: 'crowd' },
  { id: 'F5.4', epic: 5, name: 'Student Attendance & Preference Tool', page: 'plan' },
  { id: 'F5.5', epic: 5, name: 'Post-Meal Rating & Feedback Form', page: 'rate' },
  { id: 'F5.6', epic: 5, name: 'Public Campus Waste Awareness Dashboard', page: 'impact' },
];

export const EPICS = {
  1: 'Machine Learning Demand & Forecasting Engine',
  2: 'Smart Kitchen Preparation & Inventory Module',
  3: 'Food Waste Tracking & Operational Analytics Dashboard',
  4: 'Platform Data Administration Portal',
  5: 'Student Dining Portal & Engagement Hub',
};

export const REQUIREMENTS = [
  { id: 'R1', us: 'US1', name: 'Food Demand Forecasting', features: ['F1.1'], desc: 'Analyze historical consumption, weather, and calendar data to generate automated daily meal predictions.', verify: 'ML model outputs meal unit demand with <15% MAPE using historical sales & weather feeds.' },
  { id: 'R2', us: 'US7', name: 'Purchasing Recommendations', features: ['F2.2'], desc: 'Calculate and recommend optimal ingredient purchasing quantities for upcoming days with safety stock.', verify: 'Purchasing order recommendations incorporate lead times and safety stock limits.' },
  { id: 'R3', us: 'US6', name: 'Daily Prep Recommendations', features: ['F2.1'], desc: 'Recommend exact portion preparation quantities per meal item to minimize leftover waste.', verify: 'Portion prep recommendations minimize kitchen overproduction while meeting student volume.' },
  { id: 'R4', us: 'US12', name: 'Historical Consumption Access', features: ['F3.2'], desc: 'Allow dining managers to view, filter, and analyze historical consumption trends daily/weekly/monthly.', verify: 'Historical consumption access executes correctly within F3.2.' },
  { id: 'R5', us: 'US2', name: 'Weather Demand Adjustments', features: ['F1.2'], desc: 'Automatically adjust meal demand forecasts based on live weather condition inputs (precipitation, temp).', verify: 'Live weather API inputs (rain, snow, temp) trigger automated attendance adjustments.' },
  { id: 'R6', us: 'US3', name: 'Academic Calendar & Events', features: ['F1.1', 'F1.2'], desc: 'Integrate academic schedules (midterms, breaks) and campus event calendars into demand models.', verify: 'Academic calendar & events execute correctly within F1.1, F1.2.' },
  { id: 'R7', us: 'US10', name: 'Daily Food Waste Logging', features: ['F3.1'], desc: 'Enable kitchen staff to log leftover prep and discarded food quantities by dish category at shift end.', verify: 'Staff can log unserved prep and discarded food weights categorized by dish type at shift end.' },
  { id: 'R8', us: 'US11', name: 'Food Waste Analytics Dashboard', features: ['F3.2'], desc: 'Interactive operational dashboard displaying predicted demand, actual consumption, and waste side-by-side.', verify: 'Dashboard renders side-by-side comparative charts for predicted vs. actual consumption and waste.' },
  { id: 'R9', us: 'US4', name: 'ML Model Retraining', features: ['F1.3'], desc: 'Continuously compare predicted demand against actual consumption data to retrain and improve ML accuracy.', verify: 'Prediction error delta automatically triggers model retraining pipeline over time.' },
  { id: 'R10', us: 'US13', name: 'Financial Cost Savings Tracking', features: ['F3.3'], desc: 'Calculate cumulative monetary savings achieved through food waste reduction for dining administration.', verify: 'Financial engine correctly computes cumulative cost savings ($ saved / kg waste avoided).' },
  { id: 'R11', us: 'US8', name: 'Low Inventory Alerts', features: ['F2.3'], desc: 'Issue automated alerts when current ingredient levels fall below predicted prep requirements.', verify: 'Low inventory alerts execute correctly within F2.3.' },
  { id: 'R12', us: 'US9', name: 'Meal Popularity Analysis', features: ['F2.4'], desc: 'Track and identify top-performing and underperforming menu items based on consumption vs waste.', verify: 'Meal popularity analysis executes correctly within F2.4.' },
  { id: 'R13', us: 'US5', name: 'Manual Forecast Overrides', features: ['F1.4'], desc: 'Allow dining managers to manually adjust or override automated demand predictions for special events.', verify: 'Manual forecast overrides execute correctly within F1.4.' },
  { id: 'R14', us: 'US14', name: 'Sustainability Impact Reporting', features: ['F3.4'], desc: 'Generate exportable reports detailing food waste reduction, carbon emission savings, and ESG goals.', verify: 'System exports formatted PDF/CSV reports detailing MT CO2e avoided and campus ESG targets.' },
  { id: 'R15', us: 'US15', name: 'Data Ingestion & Uploads', features: ['F4.1'], desc: 'Enable administrators to securely upload, manage, and validate historical meal sales, inventory, and waste.', verify: 'Data ingestion & uploads execute correctly within F4.1.' },
  { id: 'R16', us: 'US18', name: 'Real-Time Meal Availability', features: ['F5.1'], desc: 'Display currently available dining hall menu items to students in real time.', verify: 'Student interface updates active daily menu items in real time per dining facility.' },
  { id: 'R17', us: 'US21', name: 'Student Meal Preferences', features: ['F5.4'], desc: 'Allow students to select favorite meals and express food preferences to gauge short-term demand.', verify: 'Student meal preferences execute correctly within F5.4.' },
  { id: 'R18', us: 'US19', name: 'Dining Hall Crowd Predictions', features: ['F5.3'], desc: 'Provide students with predicted crowd density and peak occupancy hours across campus dining facilities.', verify: 'Crowd density meter presents accurate hourly occupancy projections for each dining hall.' },
  { id: 'R19', us: 'US20', name: 'Low Supply Notifications', features: ['F5.2'], desc: 'Notify students when popular menu items are running low in supply during meal service.', verify: 'Low supply notifications execute correctly within F5.2.' },
  { id: 'R20', us: 'US18', name: 'Dietary & Allergy Filtering', features: ['F5.1'], desc: 'Allow students to filter available menu options by dietary restrictions (vegan, GF) and food allergies.', verify: 'Dietary & allergy filtering executes correctly within F5.1.' },
  { id: 'R21', us: 'US21', name: 'Student Attendance Surveys', features: ['F5.4'], desc: 'Enable students to indicate planned meal attendance for upcoming days to refine demand signals.', verify: 'Student attendance surveys execute correctly within F5.4.' },
  { id: 'R22', us: 'US23', name: 'Campus Waste Awareness Metrics', features: ['F5.6'], desc: 'Display public campus-wide food waste reduction metrics and milestones to foster student engagement.', verify: 'Campus waste awareness metrics execute correctly within F5.6.' },
  { id: 'R23', us: 'US22', name: 'Student Ratings & Feedback', features: ['F5.5'], desc: 'Allow students to rate and review meals after dining to assist kitchen staff in recipe evaluation.', verify: 'Student ratings & feedback execute correctly within F5.5.' },
];

export const reqLabels = (featureIds) =>
  REQUIREMENTS.filter((r) => r.features.some((f) => featureIds.includes(f))).map((r) => `${r.id}/${r.us}`);
