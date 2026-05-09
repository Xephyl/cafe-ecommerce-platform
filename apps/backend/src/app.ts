import express from "express"
import helmet from "helmet"
import cors from "cors"
import morgan from "morgan"
import cookieParser from "cookie-parser"
import { config } from "./config/index"
import { getMongoStatus } from "./config/database"
import { getRedisStatus } from "./config/redis"
import { getFlag } from "./config/featureFlags"
import { errorHandler } from "./middleware/errorHandler"
import { notFound } from "./middleware/notFound"
import { apiResponse } from "./utils/apiResponse"
import { flagsRoutes } from "./routes/flags.routes"
import { authRoutes } from "./routes/auth.routes"
import { productRoutes } from "./routes/product.routes"
import { cartRoutes } from "./routes/cart.routes"

export function createApp(): express.Application {
  const app = express()

  app.use(helmet())

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true)
        if (config.cors.origins.includes(origin)) return callback(null, true)
        callback(new Error(`CORS: origin ${origin} not allowed`))
      },
      credentials: true,
    })
  )

  app.use(morgan(config.isProd ? "combined" : "dev"))
  app.use(cookieParser(config.jwt.refreshSecret))
  app.use(express.json({ limit: "10mb" }))
  app.use(express.urlencoded({ extended: true, limit: "10mb" }))

  app.get("/health", (_req, res) => {
    res.status(200).json(
      apiResponse.success({
        status:    "ok",
        timestamp: new Date().toISOString(),
        mongo:     getMongoStatus(),
        redis:     getRedisStatus(),
      })
    )
  })

  app.use("/api/flags", flagsRoutes)

  app.use((_req, res, next) => {
    if (getFlag("MAINTENANCE_MODE")) {
      res.status(503).json(
        apiResponse.error(
          "MAINTENANCE_MODE",
          "The platform is currently undergoing maintenance. Please try again later."
        )
      )
      return
    }
    next()
  })

  app.use("/api/auth",     authRoutes)
  app.use("/api/products", productRoutes)
  app.use("/api/cart",     cartRoutes)

  // Task 1-09: app.use("/api/categories", categoryRoutes)
  // Task 1-06: app.use("/api/orders",     orderRoutes)
  // Task 1-07: app.use("/api/payments",   paymentRoutes)
  // Task 1-12: app.use("/api/coupons",    couponRoutes)
  // Task 1-13: app.use("/api/reviews",    reviewRoutes)

  app.use(notFound)
  app.use(errorHandler)

  return app
}