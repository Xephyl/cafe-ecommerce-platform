import mongoose from "mongoose"
import { AppError } from "../utils/AppError"
import { Order } from "../models/order.model"
import { Cart } from "../models/cart.model"
import { Product } from "../models/product.model"
import { emitOrderNew } from "../socket/emitters"
import { generateOrderNumber } from "@cafe/shared"
import {
  OrderStatus,
  PaymentStatus,
} from "@cafe/shared"
import type { PlaceOrderInput } from "@cafe/shared"
import type { IOrder } from "../models/order.model"

// Stub until Task 1-12 (Coupon model) is built.
// Returns zero discount regardless of coupon code.
// Task 1-12 replaces this with real couponService.validateCoupon().
async function validateCouponStub(
  _code:  string,
  _userId: string,
  _total: number
): Promise<{ discountAmount: number }> {
  return { discountAmount: 0 }
}

// Places an order from the authenticated user's cart.
// Entire operation runs in a MongoDB transaction:
//   1. Fetch and validate cart
//   2. Snapshot item prices and verify stock
//   3. Deduct stock atomically per variant
//   4. Apply coupon (stub until Task 1-12)
//   5. Create order document
//   6. Delete cart
//   7. Commit
//   8. Emit Socket.IO event (after commit — not transactional)
export async function placeOrder(
  userId: string,
  input:  PlaceOrderInput
): Promise<IOrder> {
  const session = await mongoose.startSession()
  session.startTransaction()

  try {
    // 1. Fetch cart belonging to this user
    const cart = await Cart.findOne({ user: userId })
      .populate("items.productId")
      .session(session)

    if (!cart) {
      throw new AppError(404, "CART_NOT_FOUND", "No cart found for this user")
    }
    if (cart.items.length === 0) {
      throw new AppError(400, "CART_EMPTY", "Cannot place an order with an empty cart")
    }

    // 2. Snapshot prices and verify stock for every line item
    let subtotal = 0
    const orderItems: {
      snapshot:  {
        productId:   string
        productName: string
        variantId:   string
        variantName: string
        sku:         string
        imageUrl?:   string
      }
      quantity:  number
      unitPrice: number
      subtotal:  number
    }[] = []

    for (const cartItem of cart.items) {
      const product = cartItem.productId as unknown as import("../models/product.model").IProduct

      if (!product || !product._id) {
        throw new AppError(400, "PRODUCT_NOT_AVAILABLE", "A product in your cart is no longer available")
      }

      const variant = product.variants.id(cartItem.variantId)
      if (!variant) {
        throw new AppError(
          400,
          "PRODUCT_NOT_AVAILABLE",
          `Variant not found for ${product.name}` 
        )
      }

      if (variant.stock < cartItem.quantity) {
        throw new AppError(
          400,
          "INSUFFICIENT_STOCK",
          `Not enough stock for ${product.name} — ${variant.name}`,
          { productId: product._id.toString(), variantId: cartItem.variantId, available: variant.stock }
        )
      }

      // 3. Deduct stock atomically using $inc on the matched variant subdocument.
      // Using updateOne with session keeps the deduction inside the transaction.
      await Product.updateOne(
        {
          _id:          product._id,
          "variants._id": new mongoose.Types.ObjectId(cartItem.variantId),
        },
        { $inc: { "variants.$.stock": -cartItem.quantity } },
        { session }
      )

      const unitPrice = product.basePrice + variant.priceModifier
      const lineSubtotal = unitPrice * cartItem.quantity

      orderItems.push({
        snapshot: {
          productId:   product._id?.toString() || '',
          productName: product.name,
          variantId:   cartItem.variantId,
          variantName: variant.name,
          sku:         variant.sku,
          imageUrl:    product.imageUrls?.[0],
        },
        quantity:  cartItem.quantity,
        unitPrice,
        subtotal:  lineSubtotal,
      })

      subtotal += lineSubtotal
    }

    // 4. Apply coupon (stub — zero discount until Task 1-12)
    let discountAmount = 0
    if (input.couponCode) {
      const couponResult = await validateCouponStub(input.couponCode, userId, subtotal)
      discountAmount = couponResult.discountAmount
    }

    const total = subtotal - discountAmount

    // 5. Create order document inside the transaction
    const [order] = await Order.create(
      [
        {
          orderNumber:     generateOrderNumber(),
          user:            userId,
          items:           orderItems,
          status:          OrderStatus.PENDING,
          statusHistory:   [
            { status: OrderStatus.PENDING, timestamp: new Date().toISOString() },
          ],
          shippingAddress: input.address,
          paymentMethod:   input.paymentMethod,
          paymentStatus:   PaymentStatus.UNPAID,
          payment: {
            provider: input.paymentMethod,
            status:   PaymentStatus.UNPAID,
            amount:   total,
          },
          subtotal,
          discountAmount,
          deliveryFee: 0,
          total,
          couponCode: input.couponCode,
          notes:      input.notes,
        },
      ],
      { session }
    )

    // 6. Delete cart inside the same transaction
    await Cart.deleteOne({ _id: cart._id }, { session })

    // 7. Commit — everything succeeded
    await session.commitTransaction()

    // 8. Emit Socket.IO event AFTER commit (stub until Task 1-11)
    // Emitting inside the transaction risks broadcasting an order that
    // never makes it to the DB if the commit fails.
    emitOrderNew(order)

    return order
  } catch (err) {
    await session.abortTransaction()
    throw err
  } finally {
    session.endSession()
  }
}

// Returns paginated orders for a single customer.
// Used by the customer-facing order history page.
export async function getMyOrders(
  userId: string,
  page   = 1,
  limit  = 10
): Promise<{ items: IOrder[]; total: number; page: number; totalPages: number }> {
  const skip = (page - 1) * limit
  const [items, total] = await Promise.all([
    Order.find({ user: userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Order.countDocuments({ user: userId }),
  ])

  return { items: items as unknown as IOrder[], total, page, totalPages: Math.ceil(total / limit) }
}

// Returns a single order, verifying it belongs to the requesting user.
// Admins bypass the ownership check (handled in the controller via req.user.role).
export async function getOrderById(
  orderId: string,
  userId:  string,
  isAdmin: boolean
): Promise<IOrder> {
  const filter: Record<string, unknown> = { _id: orderId }
  if (!isAdmin) filter.user = userId

  const order = await Order.findOne(filter)
    .populate("user", "firstName lastName email")
    .lean()

  if (!order) {
    throw new AppError(404, "ORDER_NOT_FOUND", "Order not found")
  }
  return order as unknown as IOrder
}
