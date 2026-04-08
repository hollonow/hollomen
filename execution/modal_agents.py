#!/usr/bin/env python3
"""
MODAL DEPLOYMENT: HolloEngine Agents
Deploys all 6 agents as Modal serverless functions.

Each agent has:
  - A web_endpoint trigger (fast) that spawns the async worker
  - A @app.function worker (timeout=7200s) that runs the actual agent

Config persistence:
  - `config_vol` (Modal Volume) is mounted at /app/config
  - Agent 0 writes attribute_matrix.json there; Agents 2 and 3 read from it

Deploy:
  cd execution
  modal deploy modal_agents.py

Env vars to set in Modal secrets ("hollomen"):
  OPENAI_API_KEY, SERPAPI_API_KEY,
  CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET,
  SUPABASE_URL, SUPABASE_SERVICE_KEY,
  WC_STORE_URL, WC_CONSUMER_KEY, WC_CONSUMER_SECRET,
  WP_USERNAME, WP_APP_PASSWORD,
  CLIENT_BRAND_NAME, WC_BRAND_CATEGORY_MAP, WC_DEFAULT_CATEGORY_ID

Vercel env vars to add after deploy (from `modal deploy` output):
  MODAL_URL_AGENT0=https://...hollomen-agent0.modal.run
  MODAL_URL_AGENT1=https://...hollomen-agent1.modal.run
  MODAL_URL_AGENT2=https://...hollomen-agent2.modal.run
  MODAL_URL_AGENT3=https://...hollomen-agent3.modal.run
  MODAL_URL_AGENT4=https://...hollomen-agent4.modal.run
  MODAL_URL_AGENT5=https://...hollomen-agent5.modal.run
"""

import modal

# ── App & infrastructure ──────────────────────────────────────────────────────

app = modal.App("hollomen-agents")

# Volume for persistent config (attribute_matrix.json survives between runs)
config_vol = modal.Volume.from_name("hollomen-config", create_if_missing=True)

# Base image — install all Python dependencies + Playwright browser
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "openai>=1.0.0",
        "fastapi>=0.100.0",
        "python-dotenv==1.0.1",
        "requests==2.31.0",
        "beautifulsoup4==4.12.3",
        "google-search-results==2.4.2",
        "Pillow==10.4.0",
        "cloudinary==1.41.0",
        "supabase>=2.0.0",
        "woocommerce>=3.0.0",
        "playwright==1.48.0",
        "google-auth==2.35.0",
        "google-auth-oauthlib==1.2.1",
        "google-auth-httplib2==0.2.0",
        "google-api-python-client==2.150.0",
    )
    .run_commands("playwright install chromium --with-deps")
    # Bake execution code + config into the image at build time
    .add_local_dir(".", remote_path="/app/execution")
    .add_local_dir("../config", remote_path="/app/config")
)

# Modal secret — set all env vars in the Modal dashboard under "hollomen"
secrets = [modal.Secret.from_name("Hollo-men")]

# Shared kwargs for long-running worker functions
WORKER_KWARGS = dict(
    image=image,
    secrets=secrets,
    volumes={"/app/config": config_vol},
    timeout=7200,   # 2 hours
    retries=0,      # Agents handle their own retries internally
)

# Trigger functions are lightweight — they just spawn the worker and return
TRIGGER_KWARGS = dict(
    image=image,
    secrets=secrets,
)


# ── Helper: run a run_*.py script as a subprocess inside the container ────────

def _run_script(script_name: str, extra_args: list[str] = None) -> None:
    """Delegates to a run_*.py script so its logging and sys.exit work normally."""
    import subprocess
    import sys

    cmd = [sys.executable, f"/app/execution/{script_name}"] + (extra_args or [])
    result = subprocess.run(cmd, cwd="/app/execution")
    if result.returncode != 0:
        raise RuntimeError(f"{script_name} exited with code {result.returncode}")


# ── Agent 0: Calibrator ───────────────────────────────────────────────────────

@app.function(**WORKER_KWARGS)
def agent0_work(force: bool = False) -> None:
    args = ["--force"] if force else []
    _run_script("run_calibrator.py", args)


@app.function(**TRIGGER_KWARGS)
@modal.fastapi_endpoint(method="POST", label="hollomen-agent0")
def trigger_agent0(body: dict = None) -> dict:
    force = bool((body or {}).get("force", False))
    agent0_work.spawn(force=force)
    return {"status": "started", "agent": "agent0"}


# ── Agent 1: Miner ────────────────────────────────────────────────────────────

@app.function(**WORKER_KWARGS)
def agent1_work(product_id: str = None) -> None:
    args = ["--product-id", product_id] if product_id else []
    _run_script("run_miner.py", args)


@app.function(**TRIGGER_KWARGS)
@modal.fastapi_endpoint(method="POST", label="hollomen-agent1")
def trigger_agent1(body: dict = None) -> dict:
    product_id = (body or {}).get("product_id")
    agent1_work.spawn(product_id=product_id)
    return {"status": "started", "agent": "agent1"}


# ── Agent 2: Researcher ───────────────────────────────────────────────────────

@app.function(**WORKER_KWARGS)
def agent2_work(product_id: str = None) -> None:
    args = ["--product-id", product_id] if product_id else []
    _run_script("run_researcher.py", args)


@app.function(**TRIGGER_KWARGS)
@modal.fastapi_endpoint(method="POST", label="hollomen-agent2")
def trigger_agent2(body: dict = None) -> dict:
    product_id = (body or {}).get("product_id")
    agent2_work.spawn(product_id=product_id)
    return {"status": "started", "agent": "agent2"}


# ── Agent 3: Marketer ─────────────────────────────────────────────────────────

@app.function(**WORKER_KWARGS)
def agent3_work(product_id: str = None) -> None:
    args = ["--product-id", product_id] if product_id else []
    _run_script("run_marketer.py", args)


@app.function(**TRIGGER_KWARGS)
@modal.fastapi_endpoint(method="POST", label="hollomen-agent3")
def trigger_agent3(body: dict = None) -> dict:
    product_id = (body or {}).get("product_id")
    agent3_work.spawn(product_id=product_id)
    return {"status": "started", "agent": "agent3"}


# ── Agent 4: Optimizer ────────────────────────────────────────────────────────

@app.function(**WORKER_KWARGS)
def agent4_work(product_id: str = None) -> None:
    args = ["--product-id", product_id] if product_id else []
    _run_script("run_optimizer.py", args)


@app.function(**TRIGGER_KWARGS)
@modal.fastapi_endpoint(method="POST", label="hollomen-agent4")
def trigger_agent4(body: dict = None) -> dict:
    product_id = (body or {}).get("product_id")
    agent4_work.spawn(product_id=product_id)
    return {"status": "started", "agent": "agent4"}


# ── Agent 5: Publisher ────────────────────────────────────────────────────────

@app.function(**WORKER_KWARGS)
def agent5_work(product_id: str = None) -> None:
    args = ["--product-id", product_id] if product_id else []
    _run_script("run_publisher.py", args)


@app.function(**TRIGGER_KWARGS)
@modal.fastapi_endpoint(method="POST", label="hollomen-agent5")
def trigger_agent5(body: dict = None) -> dict:
    product_id = (body or {}).get("product_id")
    agent5_work.spawn(product_id=product_id)
    return {"status": "started", "agent": "agent5"}
