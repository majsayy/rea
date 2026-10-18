/**
 * Approximate public city-center coordinates for an offline drive-time guess.
 * These are not a survey and not a routing engine. Unknown ZIP codes stay
 * unresolved so the office confirms the fee instead of charging the wrong one.
 */
export const POSTAL_CENTROIDS: Record<string, { lat: number; lng: number; label: string }> = {
  "80020": { lat: 39.9205, lng: -105.0866, label: "Broomfield, CO" },
  "80023": { lat: 39.978, lng: -104.99, label: "Broomfield, CO" },
  "80026": { lat: 39.9936, lng: -105.0897, label: "Lafayette, CO" },
  "80027": { lat: 39.9778, lng: -105.1319, label: "Louisville, CO" },
  "80202": { lat: 39.7527, lng: -104.9995, label: "Denver, CO" },
  "80203": { lat: 39.7312, lng: -104.9826, label: "Denver, CO" },
  "80204": { lat: 39.7336, lng: -105.0178, label: "Denver, CO" },
  "80205": { lat: 39.759, lng: -104.978, label: "Denver, CO" },
  "80211": { lat: 39.762, lng: -105.012, label: "Denver, CO" },
  "80229": { lat: 39.868, lng: -104.972, label: "Thornton, CO" },
  "80301": { lat: 40.065, lng: -105.215, label: "Boulder, CO" },
  "80302": { lat: 40.015, lng: -105.2705, label: "Boulder, CO" },
  "80501": { lat: 40.1672, lng: -105.1019, label: "Longmont, CO" },
  "80503": { lat: 40.155, lng: -105.165, label: "Longmont, CO" },
  "80504": { lat: 40.149, lng: -105.047, label: "Longmont, CO" },
  "80514": { lat: 40.0847, lng: -104.9391, label: "Dacono, CO" },
  "80516": { lat: 40.0503, lng: -105.0497, label: "Erie, CO" },
  "80520": { lat: 40.1316, lng: -104.9364, label: "Firestone, CO" },
  "80525": { lat: 40.5506, lng: -105.0668, label: "Fort Collins, CO" },
  "80530": { lat: 40.1094, lng: -104.9372, label: "Frederick, CO" },
  "80544": { lat: 40.104, lng: -105.171, label: "Niwot, CO" },
  "80601": { lat: 39.9853, lng: -104.8205, label: "Brighton, CO" },
  "80631": { lat: 40.4233, lng: -104.7091, label: "Greeley, CO" },
};
