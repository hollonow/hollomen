# HolloEngine

An automated supply chain pipeline that transforms raw supplier data into production-ready, SEO-optimised luxury product listings.

## What It Does

HolloEngine takes a Yupoo supplier gallery URL and runs it through a 5-agent pipeline that handles everything from image acquisition to WooCommerce publishing — fully automated, with a human review step for low-confidence products.

```
Yupoo URL
    ↓ Agent 1 — Miner       Scrapes gallery, stages images to Cloudinary
    ↓ Agent 2 — Architect   Visual ID via Google Lens + GPT-4o, identifies designer brand
    ↓ Agent 3 — Voice       Generates SEO titles, meta descriptions, HTML content, FAQ JSON-LD
    ↓ Agent 4 — Optimizer   Compresses images to WebP, classifies viewpoints, renames files
    ↓ Agent 5 — Publisher   Publishes to WooCommerce with full image gallery and Rank Math SEO
```

A **human review queue** (NEEDS_REVIEW) catches low-confidence products before they reach SEO generation. Admins can edit brand, type, name and research fields directly from the dashboard.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Agents | Python on [Modal](https://modal.com) (serverless GPU/CPU) |
| Dashboard | Next.js 14 (App Router) on Vercel |
| Database | Supabase (Postgres + Auth) |
| Image storage | Cloudinary |
| Visual search | SerpAPI Google Lens |
| AI | OpenAI GPT-4o + GPT-4o-mini |
| Store | WooCommerce REST API |
| Notifications | Telegram Bot API |

---

## Repository Structure

```
/execution          Python agents + shared utilities
  /miners           Agent 1 — Yupoo scraper
  /researchers      Agent 2 — Visual ID
  /marketers        Agent 3 — SEO content
  /optimizers       Agent 4 — Image processing
  /publishers       Agent 5 — WooCommerce
  /notifiers        Slack + Telegram notifiers
  modal_agents.py   Modal deployment entry point
  supabase_manager.py  Database layer

/config             attribute_matrix.json (brand voice), pipeline_config.json

/ui                 Next.js dashboard
  /app              Pages: overview, pipeline, reports, settings
  /app/api          API routes (data, agents, logs, settings)
  /components       ProductCard, ProductDetail, ReviewModal, AgentControls
  /lib              Supabase client, auth helpers, status utilities

/directives         Agent SOP documents
```

---

## Pipeline Status Flow

```
READY_FOR_SCRAPE → READY_FOR_RESEARCH → NEEDS_REVIEW (low confidence)
                                      → READY_FOR_SEO → READY_FOR_PUBLISH
                                                      → PUBLISHED → PENDING_APPROVAL
```

Failure states (`*_FAILED`) surface in the dashboard with a one-click retry that requeues the product and restarts the correct agent automatically.

---

## Dashboard Features

- **Overview** — live agent controls, pipeline runner, log panel, AI error interpreter
- **Pipeline** — table + grid views, column sorting, CSV export, bulk approve/retry/delete
- **Review modal** — edit brand, type, name and manual research fields before advancing to SEO
- **Reports** — run sessions, analytics, per-product timeline, Cloudinary usage, API cost breakdown
- **Settings** — team management (invite, roles, remove), pipeline config editor

---

## Environment Variables

### `execution/.env`
```
OPENAI_API_KEY=
SERPAPI_API_KEY=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
SUPABASE_URL=
SUPABASE_KEY=
WC_STORE_URL=
WC_CONSUMER_KEY=
WC_CONSUMER_SECRET=
WP_USERNAME=
WP_APP_PASSWORD=
CLIENT_BRAND_NAME=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

### `ui/.env.local`
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=
OPENAI_API_KEY=
MODAL_URL_AGENT0=
MODAL_URL_AGENT1=
MODAL_URL_AGENT2=
MODAL_URL_AGENT3=
MODAL_URL_AGENT4=
MODAL_URL_AGENT5=
```

---

## Running Locally

**Agents:**
```bash
cd execution
pip install -r requirements.txt
python run_miner.py
python run_researcher.py
python run_marketer.py
python run_optimizer.py
python run_publisher.py
```

**Dashboard:**
```bash
cd ui
npm install
npm run dev
```

**Modal deploy (cloud agents):**
```bash
cd execution
modal deploy modal_agents.py
```
