# BBL Self-Order Kiosk

Customers order on an iPad, pay by card on the screen (Square's secure card form), and the paid order goes into Square and onto the kitchen screen.

## Setup

1. **Application ID**: developer.squareup.com → BBL Kitchen → **Production** → Credentials → copy **Application ID** (starts with `sq0idp-`). Already added to `kiosk-config.js` (it's public, so it's safe in the repo).
2. **Open the kiosk**: on the kiosk iPad, go to `https://jtripdo.github.io/bbl-app/kiosk.html` → Share → **Add to Home Screen**.
3. **Pick the location** and tap **Start kiosk**. The kiosk remembers it.
4. **Lock the iPad to the kiosk**: Settings → Accessibility → **Guided Access** → on. Open the kiosk, triple-click the side/top button, then tap Start. Also set Display & Brightness → **Auto-Lock → Never**.

To get back to setup on the kiosk, press and hold the logo on the start screen for 3 seconds.

## How it works

- **Menu**: comes from your Square item library for that location: categories, photos, prices, sizes, and modifiers. Edit items in Square and the kiosk updates within 10 minutes. Items marked sold out at that location show as sold out.
- **Prices and tax**: always worked out by Square, not the iPad.
- **Kitchen**: orders show up on the kitchen screen as "BBL Kiosk · Pickup · (name)". Bumping them marks them picked up in Square.
- **Idle reset**: after 60 seconds with no taps, it asks "Still there?" and then starts over. You can change this in `kiosk-config.js`.
- **Apple Pay / Google Pay**: customers tap "Apple Pay or Google Pay on your phone" to get a QR code. They scan it and pay on Square's checkout page on their own phone (Apple Pay, Google Pay, Cash App or card), and can add a tip there. The kiosk shows "Thank you" by itself once they've paid. If nobody pays within 5 minutes, the order is canceled and the kiosk starts over.
- **Fees**: card entry on screen is charged at Square's online/API rate, not the tap/chip rate.
