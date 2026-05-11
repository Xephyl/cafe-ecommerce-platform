import mongoose, { Document, Model, Schema } from "mongoose"
import {
  OrderStatus,
  PaymentStatus,
  PaymentProvider,
} from "@cafe/shared"
import { AppError } from "../utils/AppError"

export interface IOrderItemSnapshot {
  productId:   string
  productName: string
  variantId:   string
  variantName: string
  sku:         string
  imageUrl?:   string
}

export interface IOrderItem {
  _id:       mongoose.Types.ObjectId
  snapshot:  IOrderItemSnapshot
  quantity:  number
  unitPrice: number
  subtotal:  number
}

export interface IStatusHistoryEntry {
  status:    OrderStatus
  timestamp: string
  note?:     string
}

export interface IOrderAddress {
  street:   string
  city:     string
  province: string
  zipCode:  string
}

export interface IPaymentRecord {
  provider:  PaymentProvider
  intentId?: string
  status:    PaymentStatus
  amount:    number
  paidAt?:   string
}

export interface IOrder extends Document {
  _id:             mongoose.Types.ObjectId
  orderNumber:     string
  user:            mongoose.Types.ObjectId
  items:           mongoose.Types.DocumentArray<IOrderItem & Document>
  status:          OrderStatus
  statusHistory:   IStatusHistoryEntry[]
  shippingAddress: IOrderAddress
  paymentMethod:   PaymentProvider
  paymentStatus:   PaymentStatus
  payment:         IPaymentRecord
  subtotal:        number
  discountAmount:  number
  deliveryFee:     number
  total:           number
  couponCode?:     string
  notes?:          string
  estimatedReadyAt?: string
  cancelledAt?:    string
  createdAt:       Date
  updatedAt:       Date

  transitionStatus(newStatus: OrderStatus, note?: string): void
}

export interface IOrderModel extends Model<IOrder> {}

// Allowed transitions enforce the state machine.
// COMPLETED and CANCELLED are terminal — no further transitions.
const ALLOWED_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  [OrderStatus.PENDING]:   [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  [OrderStatus.PREPARING]: [OrderStatus.READY],
  [OrderStatus.READY]:     [OrderStatus.COMPLETED],
}

const OrderItemSnapshotSchema = new Schema<IOrderItemSnapshot>(
  {
    productId:   { type: String, required: true },
    productName: { type: String, required: true },
    variantId:   { type: String, required: true },
    variantName: { type: String, required: true },
    sku:         { type: String, required: true },
    imageUrl:    { type: String },
  },
  { _id: false }
)

const OrderItemSchema = new Schema<IOrderItem>(
  {
    snapshot:  { type: OrderItemSnapshotSchema, required: true },
    quantity:  { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    subtotal:  { type: Number, required: true, min: 0 },
  },
  { _id: true }
)

const StatusHistorySchema = new Schema<IStatusHistoryEntry>(
  {
    status:    { type: String, enum: Object.values(OrderStatus), required: true },
    timestamp: { type: String, required: true },
    note:      { type: String },
  },
  { _id: false }
)

const OrderAddressSchema = new Schema<IOrderAddress>(
  {
    street:   { type: String, required: true, trim: true },
    city:     { type: String, required: true, trim: true },
    province: { type: String, required: true, trim: true },
    zipCode:  { type: String, required: true, trim: true },
  },
  { _id: false }
)

const PaymentRecordSchema = new Schema<IPaymentRecord>(
  {
    provider:  { type: String, enum: Object.values(PaymentProvider), required: true },
    intentId:  { type: String },
    status:    { type: String, enum: Object.values(PaymentStatus), required: true },
    amount:    { type: Number, required: true, min: 0 },
    paidAt:    { type: String },
  },
  { _id: false }
)

const OrderSchema = new Schema<IOrder, IOrderModel>(
  {
    orderNumber: {
      type:     String,
      required: true,
      unique:   true,
      index:    true,
    },
    user: {
      type:     Schema.Types.ObjectId,
      ref:      "User",
      required: true,
      index:    true,
    },
    items:           { type: [OrderItemSchema], required: true },
    status: {
      type:    String,
      enum:    Object.values(OrderStatus),
      default: OrderStatus.PENDING,
      index:   true,
    },
    statusHistory:   { type: [StatusHistorySchema], default: [] },
    shippingAddress: { type: OrderAddressSchema, required: true },
    paymentMethod: {
      type:     String,
      enum:     Object.values(PaymentProvider),
      required: true,
    },
    paymentStatus: {
      type:    String,
      enum:    Object.values(PaymentStatus),
      default: PaymentStatus.UNPAID,
      index:   true,
    },
    payment: { type: PaymentRecordSchema, required: true },
    subtotal:      { type: Number, required: true, min: 0 },
    discountAmount:{ type: Number, default: 0,    min: 0 },
    deliveryFee:   { type: Number, default: 0,    min: 0 },
    total:         { type: Number, required: true, min: 0 },
    couponCode:    { type: String },
    notes:         { type: String, maxlength: 500 },
    estimatedReadyAt: { type: String },
    cancelledAt:   { type: String },
  },
  {
    timestamps: true,
    toJSON:    { virtuals: true },
    toObject:  { virtuals: true },
  }
)

// Compound index for the most common admin query (list by user + status).
OrderSchema.index({ user: 1, createdAt: -1 })
OrderSchema.index({ status: 1, createdAt: -1 })
OrderSchema.index({ paymentStatus: 1 })

// Instance method: validates the transition, pushes to statusHistory,
// and updates this.status. Does NOT call save() — caller is responsible.
//
// Why not save inside the method?
// Callers often need to set other fields (cancelledAt, estimatedReadyAt)
// alongside the transition. Letting the caller save once keeps it atomic.
OrderSchema.methods.transitionStatus = function (
  this:      IOrder,
  newStatus: OrderStatus,
  note?:     string
): void {
  const allowed = ALLOWED_TRANSITIONS[this.status] ?? []
  if (!allowed.includes(newStatus)) {
    throw new AppError(
      400,
      "INVALID_STATUS_TRANSITION",
      `Cannot transition from ${this.status} to ${newStatus}` 
    )
  }
  this.statusHistory.push({
    status:    newStatus,
    timestamp: new Date().toISOString(),
    note,
  })
  this.status = newStatus
}

export const Order = (mongoose.models.Order ??
  mongoose.model<IOrder, IOrderModel>("Order", OrderSchema)) as IOrderModel
