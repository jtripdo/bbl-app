# BBL Kitchen Display: setup

Square order → Firebase → kitchen screen (kds.html). Each screen picks one Square location and only shows that location's tickets.

## 1. Add the files to your `bbl-app` repo

In GitHub, tap **Add file → Create new file** and type the full name, including folders. Typing the `/` creates the folder.

| File name to type | File |
|---|---|
| `kds.html` | kds.html |
| `kds.css` | kds.css |
| `kds.js` | kds.js |
| `kds-render.js` | kds-render.js |
| `kds-config.js` | kds-config.js (fill it in at step 9) |
| `firebase.json` | firebase.json |
| `functions/package.json` | package.json |
| `functions/index.js` | index.js |
| `functions/square.js` | square.js |
| `functions/tickets.js` | tickets.js |
| `.github/workflows/deploy-functions.yml` | deploy-functions.yml |

There are no passwords in any of these files, so it's fine that the repo is public.

## 2. Switch Firebase to the Blaze plan

Firebase console → your **BBL App** project → **Upgrade** (bottom-left) → **Blaze**. Then set a **budget alert** of $5 under Usage and billing. At your volume this should cost about $0–1/month.

## 3. Let the kitchen screen read tickets

Firebase console → **Firestore Database → Rules**. Add this inside the `match /databases/{database}/documents {` block, then tap **Publish**:

```
match /kdsOrders/{id} {
  allow read: if true;
  allow write: if false;
}
```

## 4. Get your Square access token

1. Go to **developer.squareup.com** and sign in with your normal Square login.
2. **Create an app** named "BBL Kitchen".
3. Open it, switch the toggle at the top to **Production**, then **Credentials**.
4. Copy the **Production Access token**. It covers all 3 locations.

## 5. Get a Firebase deploy key

1. Firebase console → ⚙️ **Project settings → Service accounts → Generate new private key**. A `.json` file downloads.
2. Open it in the Files app, select all, and copy.
3. Note the email inside it (`firebase-adminsdk-…@….iam.gserviceaccount.com`).
4. Go to **console.cloud.google.com → IAM & Admin → IAM** (same project). Tap the pencil next to that email and add these roles: **Editor**, **Cloud Functions Admin**, **Cloud Run Admin**, **Service Account User**. Save.

## 6. Add GitHub secrets

In the repo, go to **Settings → Secrets and variables → Actions → New repository secret**:

| Name | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | the whole .json text from step 5 |
| `FIREBASE_PROJECT_ID` | Project ID (Firebase → Project settings) |
| `SQUARE_ACCESS_TOKEN` | token from step 4 |

## 7. First deploy

Go to the **Actions** tab → **Deploy kitchen display functions** → **Run workflow**. It takes 3–6 minutes. A green check means it worked. If it turns red, open it and send Claude a screenshot of the error.

## 8. Connect Square's instant alerts

1. In your Square developer app: **Webhooks → Subscriptions → Add subscription** (Production).
2. URL: `https://us-central1-bbl-app-d58e6.cloudfunctions.net/squareWebhook`
3. Events: `payment.created`, `payment.updated`, `order.created`, `order.updated`, `order.fulfillment.updated`
4. Save, then copy the **Signature key**.
5. Add two more GitHub secrets:
   - `SQUARE_WEBHOOK_SIGNATURE_KEY`: the signature key
   - `SQUARE_WEBHOOK_URL`: the exact URL from step 2
6. Go back to Actions → **Run workflow** again.

Even before this step, the screen picks up orders within about a minute through the backup check. This step makes it 1–3 seconds.

## 9. Fill in `kds-config.js`

- `firebaseConfig`: the same config block your BBL app already uses.
- `functionsBase`: replace `bbl-app-d58e6` with your Project ID.
- `logoUrl`: the file name of your logo in the repo, if it isn't `logo.png`.

## 10. Set up each kitchen screen

1. On each location's iPad or tablet, open `https://jtripdo.github.io/bbl-app/kds.html`.
2. Tap **Share → Add to Home Screen**.
3. Open it, pick that screen's **location**, and tap **Start**. The screen remembers the location.
4. To change it later, tap the location name in the top bar.

## 11. Test

Ring up a small sale at one location. The ticket should appear on that location's screen and not on the others. Tap **BUMP** to clear it. **Recall** brings back the last bumped ticket.

## How it behaves

- Tickets appear once an order is **paid**: POS sales, Square Online, and delivery apps that flow into Square.
- Orders created more than 12 hours ago never show. This keeps old catering invoices off the screen when they get paid.
- Tap an item to cross it off. Bumping also marks pickup/delivery orders complete in Square.
- Timer colors: green, then yellow at 8 minutes, then red at 15. Change these in `kds-config.js`.
