import mongoose from "mongoose"
import { AppError } from "../utils/AppError"
import { Cart } from "../models/cart.model"
import { Product } from "../models/product.model"
import { ProductStatus } from "@cafe/shared"
import type { ICart } from "../models/cart.model"

export type CartIdentity =
  | { type: "user";    userId:    string }
  | { type: "session"; sessionId: string }

// Finds the cart for either an authenticated user or a guest session.
// Creates a new cart if none exists.
async function findOrCreateCart(identity: CartIdentity): Promise<ICart> {
  const filter =
    identity.type === "user"
      ? { user: identity.userId }
      : { sessionId: identity.sessionId, user: { $exists: false } }

  let cart = await Cart.findOne(filter)
  if (!cart) {
    if (identity.type === "user") {
      cart = await Cart.create({ user: identity.userId, items: [] })
    } else {
      cart = await Cart.create({ sessionId: identity.sessionId, items: [] })
    }
  }
  return cart
}

// Returns the current cart, or a synthetic empty cart if none exists yet.
// We return an empty shell rather than 404 so the frontend always gets
// a consistent shape on first load.
export async function getCart(identity: CartIdentity): Promise<ICart> {
  const filter =
    identity.type === "user"
      ? { user: identity.userId }
      : { sessionId: identity.sessionId, user: { $exists: false } }

  const cart = await Cart.findOne(filter).populate("items.productId", "name slug imageUrls status")
  if (!cart) {
    const shell = {
      items:       [],
      totalAmount: 0,
      itemCount:   0,
    }
    return shell as unknown as ICart
  }
  return cart
}

// Adds an item to the cart.
// If the same productId+variantId already exists, increments quantity (cap 99).
// Snapshots the unit price at add-time — price changes do not affect cart items.
// Throws PRODUCT_NOT_AVAILABLE if the product is not ACTIVE or variant is out of stock.
export async function addItem(
  identity:  CartIdentity,
  productId: string,
  variantId: string,
  quantity:  number
): Promise<ICart> {
  // Validate ObjectId format to prevent Mongoose CastError
  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid product ID format")
  }

  const product = await Product.findById(productId)
  if (!product?.status || product.status !== ProductStatus.ACTIVE) {
    throw new AppError(404, "PRODUCT_NOT_AVAILABLE", "Product is not available")
  }

  const variant = product.variants.id(variantId)
  if (!variant) {
    throw new AppError(404, "PRODUCT_NOT_AVAILABLE", "Product variant not found")
  }
  if (variant.stock < quantity) {
    throw new AppError(400, "INSUFFICIENT_STOCK", "Not enough stock available")
  }

  const unitPrice = product.basePrice + variant.priceModifier
  const cart      = await findOrCreateCart(identity)

  const existingIdx = cart.items.findIndex(
    (i) =>
      i.productId.toHexString() === productId &&
      i.variantId === variantId
  )

  if (existingIdx >= 0) {
    const newQty = Math.min(99, cart.items[existingIdx].quantity + quantity)
    cart.items[existingIdx].quantity = newQty
    cart.items[existingIdx].subtotal = newQty * unitPrice
  } else {
    cart.items.push({
      productId: new mongoose.Types.ObjectId(productId),
      variantId,
      quantity,
      unitPrice,
      subtotal: quantity * unitPrice,
    } as never)
  }

  await cart.save()
  return cart
}

// Updates the quantity of an existing cart item.
// Quantity 0 removes the item entirely.
export async function updateItem(
  identity: CartIdentity,
  itemId:   string,
  quantity: number
): Promise<ICart> {
  const cart = await findOrCreateCart(identity)
  const item = cart.items.id(itemId)
  if (!item) {
    throw new AppError(404, "ITEM_NOT_FOUND", "Cart item not found")
  }

  if (quantity <= 0) {
    item.deleteOne()
  } else {
    item.quantity = Math.min(99, quantity)
    item.subtotal = item.quantity * item.unitPrice
  }

  await cart.save()
  return cart
}

// Removes a single item from the cart by its _id.
export async function removeItem(identity: CartIdentity, itemId: string): Promise<ICart> {
  const cart = await findOrCreateCart(identity)
  const item = cart.items.id(itemId)
  if (!item) {
    throw new AppError(404, "ITEM_NOT_FOUND", "Cart item not found")
  }

  item.deleteOne()
  await cart.save()
  return cart
}

// Removes all items and clears any applied coupon.
export async function clearCart(identity: CartIdentity): Promise<ICart> {
  const cart = await findOrCreateCart(identity)
  cart.items.splice(0)
  cart.coupon = undefined
  await cart.save()
  return cart
}

// Stub until Task 1-12 (Coupon model) is built.
// When 1-12 is complete, this function is replaced with:
//   const result = await couponService.validateCoupon(code, userId, cart.totalAmount)
//   cart.coupon = { code, type: result.coupon.type, value: result.coupon.value,
//                   discountAmount: result.discountAmount }
export async function applyCoupon(identity: CartIdentity, _code: string): Promise<ICart> {
  const cart = await findOrCreateCart(identity)
  if (cart.items.length === 0) {
    throw new AppError(400, "CART_EMPTY", "Cannot apply coupon to an empty cart")
  }
  // Stub: accept any non-empty code as a no-op until Coupon model exists.
  // Real validation is wired in Task 1-12.
  // TODO: Implement coupon validation with couponService.validateCoupon(_code, userId, cart.totalAmount)
  throw new AppError(503, "FEATURE_DISABLED", "Coupon validation available in Task 1-12")
}

// Merges a guest cart into an authenticated user's cart.
// Runs inside a MongoDB transaction — partial failure leaves neither cart corrupted.
//
// Strategy:
//   Same productId+variantId: sum quantities, cap at 99.
//   Different item: append to user cart.
//   After merge: delete guest cart.
//   Controller clears the sessionId cookie after this resolves.
export async function mergeCarts(sessionId: string, userId: string): Promise<void> {
  const session = await mongoose.startSession()
  session.startTransaction()

  try {
    const guestCart = await Cart.findOne(
      { sessionId, user: { $exists: false } }
    ).session(session)

    if (!guestCart || guestCart.items.length === 0) {
      await session.commitTransaction()
      return
    }

    let userCart = await Cart.findOne({ user: userId }).session(session)

    if (!userCart) {
      // No existing user cart — reassign the guest cart to the user.
      guestCart.user      = new mongoose.Types.ObjectId(userId)
      guestCart.sessionId = undefined
      await guestCart.save({ session })
      await session.commitTransaction()
      return
    }

    // Merge guest items into user cart.
    for (const guestItem of guestCart.items) {
      const existingIdx = userCart.items.findIndex(
        (i) =>
          i.productId.toHexString() === guestItem.productId.toHexString() &&
          i.variantId            === guestItem.variantId
      )

      if (existingIdx >= 0) {
        const merged                              = Math.min(99, userCart.items[existingIdx].quantity + guestItem.quantity)
        userCart.items[existingIdx].quantity = merged
        userCart.items[existingIdx].subtotal = merged * userCart.items[existingIdx].unitPrice
      } else {
        userCart.items.push({
          productId: guestItem.productId,
          variantId: guestItem.variantId,
          quantity:  guestItem.quantity,
          unitPrice: guestItem.unitPrice,
          subtotal:  guestItem.subtotal,
        } as never)
      }
    }

    await userCart.save({ session })
    await Cart.deleteOne({ _id: guestCart._id }, { session })
    await session.commitTransaction()
  } catch (err) {
    await session.abortTransaction()
    throw err
  } finally {
    session.endSession()
  }
}