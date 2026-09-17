import { db } from "./db"

export async function refund(orderId: string, amountCents: number, actorId: string) {
  const order = await db.orders.find(orderId)
  if (!order) throw new Error("order not found")
  if (amountCents > order.totalCents) amountCents = order.totalCents
  await db.refunds.insert({ orderId, amountCents, actorId, at: new Date() })
  await db.orders.update(orderId, { refundedCents: order.refundedCents + amountCents })
  return { orderId, amountCents }
}
