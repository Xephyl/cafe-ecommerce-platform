import { Router } from "express"
import { authenticate } from "../middleware/authenticate"
import { validate } from "../middleware/validate"
import { requireFlag } from "../middleware/requireFlag"
import { placeOrder, getMyOrders, getOrderById } from "../controllers/order.controller"
import { PlaceOrderSchema } from "@cafe/shared"

const router: Router = Router()

// All order routes require authentication
router.use(authenticate)

// GET /api/orders/my-orders — before /:id to avoid param collision
router.get("/my-orders", getMyOrders)

// GET /api/orders/:id
router.get("/:id", getOrderById)

// POST /api/orders
// requireFlag("PAYMENTS_ENABLED") is placed here so to entire checkout
// flow can be disabled server-side without touching any frontend code.
// The flag name is slightly misleading — it guards the order + payment
// pipeline, not just the PayMongo step. Rename to CHECKOUT_ENABLED if
// your team prefers clarity (update FeatureFlags interface too).
router.post(
  "/",
  requireFlag("PAYMENTS_ENABLED"),
  validate(PlaceOrderSchema),
  placeOrder
)

// Task 1-10 adds admin routes below this line:
// router.get("/",              authorize(UserRole.ADMIN), listOrders)
// router.get("/export",        authorize(UserRole.ADMIN), exportOrders)
// router.patch("/:id/status",  authorize(UserRole.ADMIN), updateOrderStatus)
// router.post("/:id/cancel",   authorize(UserRole.ADMIN), cancelOrder)

export { router as orderRoutes }
