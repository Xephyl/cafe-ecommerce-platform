import type { OrderStatus } from "@cafe/shared"
import type { IOrder } from "../models/order.model"

// Stub emitters — replaced in Task 1-11 with real Socket.IO calls.
// Keeping the same function signatures so all callers compile unchanged.

export function emitOrderNew(_order: IOrder): void {
  // Task 1-11: io.to("admin:orders").emit("order:new", { ... })
}

export function emitOrderStatusChanged(
  _orderId: string,
  _status:  OrderStatus,
  _note?:   string
): void {
  // Task 1-11: io.to(`order:${_orderId}`).emit("order:status-changed", { ... })
  //            io.to("admin:orders").emit("order:status-changed", { ... })
}

export function emitPaymentConfirmed(_userId: string, _orderId: string): void {
  // Task 1-11: io.to(`user:${_userId}`).emit("payment:confirmed", { orderId: _orderId })
}

export function emitNotification(_userId: string, _notification: unknown): void {
  // Task 1-11: io.to(`user:${_userId}`).emit("notification:new", _notification)
}
