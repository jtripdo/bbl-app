// Self-order kiosk settings.

// Firebase functions (same project as the kitchen screen).
export const functionsBase = "https://us-central1-bbl-app-d58e6.cloudfunctions.net";

// Square > developer.squareup.com > BBL Kitchen > Production > Credentials >
// "Application ID" (starts with sq0idp-). This ID is public, so it's safe here.
export const squareApplicationId = "sq0idp-uH258Box8-k9epRzBwFqAw";

// Tip choices shown at checkout, in percent. 0 = "No tip".
export const tipPercents = [0, 15, 18, 20];

// Go back to the start screen after this many seconds with no taps.
export const idleSeconds = 60;

export const logoUrl = "logo-ink.png";
