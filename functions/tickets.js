// Turns Square orders into kitchen tickets in Firestore (collection "kdsOrders").
const { FieldValue } = require("firebase-admin/firestore");
const { locationName } = require("./square");

// Orders older than this are never shown (keeps old catering invoices off the screen).
const MAX_AGE_HOURS = Number(process.env.KDS_MAX_AGE_HOURS || 12);
const CLOSED = ["COMPLETED", "CANCELED", "FAILED"];

const TYPE_FALLBACK = "";

function isPaid(order) {
  return order.state === "COMPLETED" || (order.tenders || []).length > 0;
}

function fulfillmentsDone(order) {
  const f = order.fulfillments || [];
  return f.length > 0 && f.every((x) => CLOSED.includes(x.state));
}

function shouldShow(order) {
  if (!order || !(order.line_items || []).length) return false;
  if (order.state === "CANCELED" || order.state === "DRAFT") return false;
  const ageHours = (Date.now() - Date.parse(order.created_at)) / 3600000;
  if (!(ageHours <= MAX_AGE_HOURS)) return false;
  return isPaid(order);
}

function qtyText(q) {
  const n = Number(q);
  return Number.isFinite(n) ? String(n) : String(q || "1");
}

function toTicket(order) {
  const f = (order.fulfillments || [])[0] || {};
  const d = f.pickup_details || f.delivery_details || f.shipment_details || {};
  return {
    squareOrderId: order.id,
    locationId: order.location_id || "",
    label: order.ticket_name || order.reference_id || order.id.slice(-4).toUpperCase(),
    source: (order.source && order.source.name) || "In person",
    customer: (d.recipient && d.recipient.display_name) || "",
    fulfillmentType: f.type || TYPE_FALLBACK,
    dueAt: d.pickup_at || d.deliver_at || "",
    note: d.note || "",
    createdAt: order.created_at || "",
    items: (order.line_items || []).map((li) => ({
      name: li.name || "Custom amount",
      qty: qtyText(li.quantity),
      variation: li.variation_name && li.variation_name !== "Regular" ? li.variation_name : "",
      modifiers: (li.modifiers || []).map(
        (m) => (m.quantity && m.quantity !== "1" ? `${m.quantity}x ` : "") + (m.name || "")
      ),
      note: li.note || "",
    })),
  };
}

async function syncOrder(db, order) {
  if (!order || !order.id) return;
  const ref = db.collection("kdsOrders").doc(order.id);
  const locName = await locationName(order.location_id);

  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const cur = snap.exists ? snap.data() : null;

    if (cur) {
      if (cur.status !== "open") return; // already bumped: never bring it back
      if (order.state === "CANCELED") {
        t.update(ref, { status: "canceled", closedAt: FieldValue.serverTimestamp() });
        return;
      }
      if (fulfillmentsDone(order) && !cur.recalledAt) {
        t.update(ref, { status: "done", closedBy: "square", closedAt: FieldValue.serverTimestamp() });
        return;
      }
      t.update(ref, { ...toTicket(order), locationName: locName });
      return;
    }

    if (fulfillmentsDone(order) || !shouldShow(order)) return;
    t.set(ref, {
      ...toTicket(order),
      locationName: locName,
      status: "open",
      receivedAt: FieldValue.serverTimestamp(),
    });
  });
}

module.exports = { syncOrder };
