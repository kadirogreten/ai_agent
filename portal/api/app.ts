/**
 * This is a API server
 */

import express, {
  type Request,
  type Response,
} from 'express'
import cors from 'cors'
import path from 'path'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import importRoutes from './routes/import.js'
import ceoRoutes from './routes/ceo.js'
import operationsRoutes from './routes/operations.js'
import notificationsRoutes from './routes/notifications.js'
import llmProvidersRoutes from './routes/llmProviders.js'
import socialRoutes from './routes/social.js'
import sectorRoutes from './routes/sector.js'
import packsRoutes from './routes/packs.js'
import mcpRoutes from './routes/mcp.js'
import a2aRoutes, {
  wellKnownAgentCard,
  wellKnownAgentJsonAlias,
} from './routes/a2a.js'

fileURLToPath(import.meta.url)

// load env
dotenv.config({ path: path.join(process.cwd(), '.env.local') })
dotenv.config()

const app: express.Application = express()

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

app.use('/api/import', importRoutes)
app.use('/api/ceo', ceoRoutes)
app.use('/api/operations', operationsRoutes)
app.use('/api/notifications', notificationsRoutes)
app.use('/api/llm-providers', llmProvidersRoutes)
app.use('/api/social', socialRoutes)
app.use('/api/sector', sectorRoutes)
app.use('/api/packs', packsRoutes)
app.use('/api/mcp', mcpRoutes)
app.use('/api/a2a', a2aRoutes)

// D4b — A2A discovery (nginx /.well-known/ → bu process)
app.get('/.well-known/agent-card.json', wellKnownAgentCard)
app.get('/.well-known/agent.json', wellKnownAgentJsonAlias)

/**
 * health
 */
app.use(
  '/api/health',
  (req: Request, res: Response): void => {
    res.status(200).json({
      success: true,
      message: 'ok',
    })
  },
)

/**
 * error handler middleware
 */
app.use((error: Error, req: Request, res: Response, next: express.NextFunction) => {
  void next
  res.status(500).json({
    success: false,
    error: 'Server internal error',
  })
})

/**
 * 404 handler
 */
app.use((req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    error: 'API not found',
  })
})

export default app
