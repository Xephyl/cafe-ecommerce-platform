import mongoose, { Document, Model, Schema } from "mongoose"

export interface ICartItem {
  _id:       mongoose.Types.ObjectId
  productId: mongoose.Types.ObjectId
  variantId: string
  quantity:  number
  unitPrice: number
  subtotal:  number
}

export interface IAppliedCoupon {
  code:           string
  type:           "PERCENTAGE" | "FIXED"
  value:          number
  discountAmount: number
}

export interface ICart extends Document {
  _id:          mongoose.Types.ObjectId
  user?:        mongoose.Types.ObjectId
  sessionId?:   string
  items:        mongoose.Types.DocumentArray<ICartItem & Document>
  coupon?:      IAppliedCoupon
  totalAmount:  number
  itemCount:    number
  createdAt:    Date
  updatedAt:    Date
}

export interface ICartModel extends Model<ICart> {}

const CartItemSchema = new Schema<ICartItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    variantId: { type: String, required: true },
    quantity:  {
      type:     Number,
      required: true,
      min:      [1,  "Quantity must be at least 1"],
      max:      [99, "Quantity cannot exceed 99"],
      validate: { validator: Number.isInteger, message: "Quantity must be an integer" },
    },
    unitPrice: {
      type:     Number,
      required: true,
      min:      [0, "Unit price cannot be negative"],
      validate: { validator: Number.isInteger, message: "Unit price must be an integer (centavos)" },
    },
    subtotal: {
      type:     Number,
      required: true,
      min:      [0, "Subtotal cannot be negative"],
    },
  },
  { _id: true }
)

const AppliedCouponSchema = new Schema<IAppliedCoupon>(
  {
    code:           { type: String, required: true, uppercase: true, trim: true },
    type:           { type: String, enum: ["PERCENTAGE", "FIXED"], required: true },
    value:          { type: Number, required: true },
    discountAmount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
)

const CartSchema = new Schema<ICart, ICartModel>(
  {
    user:      { type: Schema.Types.ObjectId, ref: "User", index: true },
    sessionId: { type: String, index: true },
    items:     { type: [CartItemSchema], default: [] },
    coupon:    { type: AppliedCouponSchema, default: undefined },
  },
  {
    timestamps: true,
    toJSON:    { virtuals: true },
    toObject:  { virtuals: true },
  }
)

// Either user or sessionId must be present.
// Mongoose has no built-in OR constraint — enforce via pre-validate hook.
CartSchema.pre("validate", function (next) {
  if (!this.user && !this.sessionId) {
    return next(new Error("Cart must have either a user or a sessionId"))
  }
  next()
})

// Virtual: sum of all item subtotals.
// Computed fresh each time — never stale.
CartSchema.virtual("totalAmount").get(function (this: ICart) {
  return this.items.reduce((sum, item) => sum + item.subtotal, 0)
})

// Virtual: total number of individual units across all line items.
CartSchema.virtual("itemCount").get(function (this: ICart) {
  return this.items.reduce((sum, item) => sum + item.quantity, 0)
})

export const Cart = (mongoose.models.Cart ??
  mongoose.model<ICart, ICartModel>("Cart", CartSchema)) as ICartModel