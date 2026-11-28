// Team accounts: invite links, username + password sign-up, reset links, remove access.
// Accounts live in Firebase Authentication; profiles in Firestore "staff/{uid}".
const crypto = require("crypto");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const EMAIL_DOMAIN = "staff.buttermilkbiscuitlab.com"; // sign-in IDs only, no mail is sent
const INVITE_DAYS = 7;
const USERNAME_RE = /^[a-z0-9._-]{3,20}$/;

class TeamError extends Error {}
const db = () => getFirestore();
const emailFor = (username) => `${username}@${EMAIL_DOMAIN}`;

function cleanName(n) {
  const s = String(n || "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!s) throw new TeamError("Please enter a name.");
  return s;
}
function cleanUsername(u) {
  const s = String(u || "").trim().toLowerCase();
  if (!USERNAME_RE.test(s)) throw new TeamError("Usernames are 3–20 letters, numbers, dots, dashes or underscores.");
  return s;
}
function checkPassword(p) {
  const s = String(p || "");
  if (s.length < 8) throw new TeamError("Passwords need at least 8 characters.");
  if (s.length > 100) throw new TeamError("That password is too long.");
  return s;
}
const ms = (x) => (x && x.toMillis ? x.toMillis() : x instanceof Date ? x.getTime() : Date.parse(x));
const newCode = () => crypto.randomBytes(15).toString("base64url");

// Who is calling? Reads the Firebase sign-in token sent by the app.
async function caller(req) {
  const m = String(req.get("authorization") || "").match(/^Bearer (.+)$/);
  if (!m) return null;
  try {
    const t = await getAuth().verifyIdToken(m[1]);
    const snap = await db().collection("staff").doc(t.uid).get();
    if (!snap.exists || snap.data().active === false) return null;
    return { uid: t.uid, ...snap.data() };
  } catch (e) { return null; }
}
const isManager = (who) => who && (who.role === "owner" || who.role === "manager");
const isOwner = (who) => who && who.role === "owner";
const ROLES = ["owner", "manager", "staff"];

// Which roles can open each page of the team app. Owners always see everything.
const PAGES = ["today", "par", "opening", "closing", "cleaning", "prep", "mealprep", "chat", "needs", "events", "training", "temps", "handoff", "eightysix", "labels", "loyalty", "people", "website", "backoffice", "mode"];
const MANAGER_ONLY = ["people", "backoffice", "website"];
const DEFAULT_ACCESS = Object.fromEntries(PAGES.map((p) => [p, MANAGER_ONLY.includes(p) ? ["manager"] : ["manager", "staff"]]));
async function getAccess() {
  const snap = await db().collection("settings").doc("access").get();
  const saved = snap.exists ? snap.data().pages || {} : {};
  return Object.fromEntries(PAGES.map((p) => [p, Array.isArray(saved[p]) ? saved[p] : DEFAULT_ACCESS[p]]));
}
// Managers can only act on Team members; owners can act on anyone.
function canManage(who, target) {
  if (isOwner(who)) return true;
  return isManager(who) && (target.role || "staff") === "staff";
}

async function hasOwner() {
  const s = await db().collection("staff").where("role", "==", "owner").limit(1).get();
  return !s.empty;
}

// Creates the sign-in account + profile; claims the username so no one else can take it.
async function createAccount({ name, username, password, role }) {
  const ref = db().collection("usernames").doc(username);
  const taken = await ref.get();
  if (taken.exists) throw new TeamError("That username is taken. Try another.");
  let user;
  try {
    user = await getAuth().createUser({ email: emailFor(username), password, displayName: name });
  } catch (e) {
    if (String(e.code).includes("email-already-exists")) throw new TeamError("That username is taken. Try another.");
    throw e;
  }
  await db().runTransaction(async (t) => {
    const again = await t.get(ref);
    if (again.exists) throw new TeamError("That username is taken. Try another.");
    t.set(ref, { uid: user.uid });
    t.set(db().collection("staff").doc(user.uid), {
      name, username, role, active: true, createdAt: FieldValue.serverTimestamp(),
    });
  }).catch(async (e) => { await getAuth().deleteUser(user.uid).catch(() => {}); throw e; });
  return user.uid;
}

async function getInvite(code) {
  if (!/^[A-Za-z0-9_-]{10,40}$/.test(String(code || ""))) throw new TeamError("This link isn't valid.");
  const ref = db().collection("invites").doc(code);
  const snap = await ref.get();
  if (!snap.exists) throw new TeamError("This link isn't valid.");
  const inv = snap.data();
  if (inv.used) throw new TeamError("This link was already used. Ask for a new one.");
  if (inv.canceled) throw new TeamError("This link was canceled. Ask for a new one.");
  if (inv.expiresAt && ms(inv.expiresAt) < Date.now()) throw new TeamError("This link expired. Ask for a new one.");
  return { ref, inv };
}

async function handle(req) {
  const b = req.body || {};
  const who = await caller(req);

  switch (b.action) {
    // ----- anyone -----
    case "status":
      return { hasOwner: await hasOwner() };

    case "me": // the signed-in person's own profile
      if (!who) throw new TeamError("This account is not active. Ask a manager.");
      return { name: who.name, role: who.role || "staff", username: who.username, access: await getAccess() };

    case "setAccess": {
      if (!isOwner(who)) throw new TeamError("Only owners can change page access.");
      const pages = {};
      for (const p of PAGES) {
        const want = (b.access && Array.isArray(b.access[p])) ? b.access[p] : DEFAULT_ACCESS[p];
        pages[p] = want.filter((r) => r === "manager" || r === "staff");
      }
      await db().collection("settings").doc("access").set({ pages, by: who.name, at: FieldValue.serverTimestamp() });
      return { ok: true, access: pages };
    }

    case "setRole": {
      if (!isOwner(who)) throw new TeamError("Only owners can change roles.");
      const role = String(b.role || "");
      if (!ROLES.includes(role)) throw new TeamError("Unknown role.");
      const ref = db().collection("staff").doc(String(b.uid || "x"));
      const snap = await ref.get();
      if (!snap.exists || snap.data().active === false) throw new TeamError("Team member not found.");
      if (snap.id === who.uid) throw new TeamError("You can't change your own role.");
      await ref.update({ role, roleBy: who.name, roleAt: FieldValue.serverTimestamp() });
      return { ok: true };
    }

    case "setupOwner": { // only works once, before anyone has an account
      if (await hasOwner()) throw new TeamError("Setup is already done. Please sign in.");
      const uid = await createAccount({
        name: cleanName(b.name), username: cleanUsername(b.username), password: checkPassword(b.password), role: "owner",
      });
      return { ok: true, uid };
    }

    case "checkInvite": {
      const { inv } = await getInvite(b.code);
      return { name: inv.name, kind: inv.kind || "invite", username: inv.username || "" };
    }

    case "redeem": {
      const { ref, inv } = await getInvite(b.code);
      const password = checkPassword(b.password);
      if (inv.kind === "reset") {
        await getAuth().updateUser(inv.uid, { password, disabled: false });
        await ref.update({ used: true, usedAt: FieldValue.serverTimestamp() });
        return { ok: true, username: inv.username };
      }
      const username = cleanUsername(b.username);
      const uid = await createAccount({ name: inv.name, username, password, role: inv.role || "staff" });
      await ref.update({ used: true, usedAt: FieldValue.serverTimestamp(), uid, username });
      return { ok: true, username };
    }

    // ----- owner / managers only -----
    case "list": {
      if (!isManager(who)) throw new TeamError("Only managers can do that.");
      const [staff, invites] = await Promise.all([
        db().collection("staff").get(),
        db().collection("invites").where("used", "==", false).get(),
      ]);
      const now = Date.now();
      return {
        me: who.uid,
        myRole: who.role,
        access: await getAccess(),
        pages: PAGES,
        staff: staff.docs.map((d) => ({ uid: d.id, ...d.data(), createdAt: null }))
          .filter((s) => s.active !== false).sort((a, c) => a.name.localeCompare(c.name)),
        invites: invites.docs.map((d) => ({ code: d.id, ...d.data() }))
          .filter((i) => !i.canceled && i.kind !== "reset" && (!i.expiresAt || ms(i.expiresAt) > now))
          .map((i) => ({ code: i.code, name: i.name, role: i.role })),
      };
    }

    case "invite": {
      if (!isManager(who)) throw new TeamError("Only managers can invite people.");
      const role = isOwner(who) && ROLES.includes(b.role) ? b.role : "staff";
      const code = newCode();
      await db().collection("invites").doc(code).set({
        kind: "invite", name: cleanName(b.name), role, used: false, by: who.name,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + INVITE_DAYS * 86400000),
      });
      return { code };
    }

    case "cancelInvite": {
      if (!isManager(who)) throw new TeamError("Only managers can do that.");
      const { ref } = await getInvite(b.code);
      await ref.update({ canceled: true });
      return { ok: true };
    }

    case "resetLink": {
      if (!isManager(who)) throw new TeamError("Only managers can do that.");
      const snap = await db().collection("staff").doc(String(b.uid || "x")).get();
      if (!snap.exists) throw new TeamError("Team member not found.");
      const s = snap.data();
      if (snap.id !== who.uid && !canManage(who, s)) throw new TeamError("Only owners can reset a manager's or owner's password.");
      const code = newCode();
      await db().collection("invites").doc(code).set({
        kind: "reset", uid: snap.id, name: s.name, username: s.username, used: false, by: who.name,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + INVITE_DAYS * 86400000),
      });
      return { code };
    }

    case "remove": {
      if (!isManager(who)) throw new TeamError("Only managers can do that.");
      const ref = db().collection("staff").doc(String(b.uid || "x"));
      const snap = await ref.get();
      if (!snap.exists) throw new TeamError("Team member not found.");
      if (snap.id === who.uid) throw new TeamError("You can't remove yourself.");
      if (!canManage(who, snap.data())) throw new TeamError("Only owners can remove managers or owners.");
      await getAuth().deleteUser(snap.id).catch(() => {}); // signs them out everywhere and frees the username
      await ref.update({ active: false, removedBy: who.name, removedAt: FieldValue.serverTimestamp() });
      await db().collection("usernames").doc(snap.data().username).delete().catch(() => {});
      return { ok: true };
    }

    default:
      throw new TeamError("Unknown action.");
  }
}

module.exports = { handle, TeamError, caller, getAccess, cleanUsername, checkPassword, emailFor, EMAIL_DOMAIN };
