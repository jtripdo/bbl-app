# BBL Online Ordering

Customer page: **https://jtripdo.github.io/bbl-app/order.html**. Link it from the "Order online" button on buttermilkbiscuitlab.com.

## What customers can do

- **Locations:** choose **BBL @ Pasta Packs** or **BBL Pop Ups**. Chicken & Pig is never offered.
- **When they can order:**
  - **Open now:** pickup ASAP (about 15 minutes) or any 15-minute time later today.
  - **Opens later today:** order ahead for a time once it opens.
  - **No hours left today:** shown as Closed with the next opening time, and it can't be selected.
- **Menu:** that location's menu from your Square item library, the same as the kiosk.
- **Paying:** on Square's secure checkout page with Apple Pay, Google Pay, Cash App or card, where they can also tip. They then return to a confirmation page with their order number and pickup time.
- **Kitchen:** paid orders appear on that location's kitchen screen as "BBL Online · Pickup · (name)", with the due time for scheduled orders.

## Hours come from Square

Square Dashboard → **Settings → Locations →** (location) → **Business hours**.

- **Pasta Packs:** set the regular weekly hours once.
- **Pop Ups:** before each pop-up, set that day's hours, and remove them afterwards. If a location has no hours set, it always shows Closed.
- **Pause ordering:** to stop orders right now, temporarily clear today's hours in Square. Changes show on the order page within about 5 minutes.

## Settings in `functions/online.js`

- `PREP_MIN` (15): earliest pickup is this many minutes from now.
- `SLOT_MIN` (15): spacing between pickup times.
- `ONLINE_LOCATIONS`: which Square locations are offered.
