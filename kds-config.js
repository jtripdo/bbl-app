// Kitchen screen settings (already filled in for the BBL App Firebase project).

// Same Firebase config your BBL app already uses
// (Firebase console > Project settings > Your apps > Config).
export const firebaseConfig = {
  apiKey: "AIzaSyCV4nlJD5Uq6pS-P_sabpzHUjgi2kf_6Uk",
  authDomain: "bbl-app-d58e6.firebaseapp.com",
  projectId: "bbl-app-d58e6",
  storageBucket: "bbl-app-d58e6.firebasestorage.app",
  messagingSenderId: "159270496914",
  appId: "1:159270496914:web:8076c4dda73557bc2f544b",
};

// Replace bbl-app-d58e6 with your Firebase Project ID.
export const functionsBase = "https://us-central1-bbl-app-d58e6.cloudfunctions.net";

// Ticket timer colors (minutes since the ticket appeared).
export const yellowAfterMin = 8;
export const redAfterMin = 15;

// Pre-orders appear on the kitchen screen this many minutes before their pickup time.
export const showPreordersMin = 10;

// Logo shown in the top bar (file in your bbl-app repo).
export const logoUrl = "logo-dark.png";
