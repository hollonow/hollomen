#!/usr/bin/env python3
"""
Fetch all WooCommerce product categories and print them as a ready-to-paste
WC_BRAND_CATEGORY_MAP env var.

Run: cd execution && python fetch_wc_categories.py
"""

import json
import os
import sys

from dotenv import load_dotenv
from woocommerce import API

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))

wc_url          = os.getenv('WC_STORE_URL') or os.getenv('WC_URL', '')
consumer_key    = os.getenv('WC_CONSUMER_KEY', '')
consumer_secret = os.getenv('WC_CONSUMER_SECRET', '')

if not all([wc_url, consumer_key, consumer_secret]):
    print('ERROR: Missing WC_STORE_URL / WC_CONSUMER_KEY / WC_CONSUMER_SECRET in .env')
    sys.exit(1)

wcapi = API(
    url=wc_url,
    consumer_key=consumer_key,
    consumer_secret=consumer_secret,
    version='wc/v3',
    timeout=30,
)

# Fetch all categories (page through if >100)
all_cats = []
page = 1
while True:
    resp = wcapi.get('products/categories', params={'per_page': 100, 'page': page, 'orderby': 'name', 'order': 'asc'})
    if resp.status_code != 200:
        print(f'ERROR: WooCommerce returned {resp.status_code}: {resp.text[:300]}')
        sys.exit(1)
    batch = resp.json()
    if not batch:
        break
    all_cats.extend(batch)
    page += 1

# Print full table
print(f'\n{"ID":>6}  {"Parent":>6}  Category Name')
print('-' * 55)
for c in all_cats:
    parent_label = f'(parent {c["parent"]})' if c['parent'] else ''
    print(f'{c["id"]:>6}  {parent_label:<12}  {c["name"]}')

# Print ready-to-paste env var — keys are the bare brand names
print('\n\n── Paste into .env ──────────────────────────────────────')
brand_map = {c['name']: c['id'] for c in all_cats}
print(f'WC_BRAND_CATEGORY_MAP={json.dumps(brand_map, ensure_ascii=False)}')
print('\n# Set WC_DEFAULT_CATEGORY_ID to whichever category should be the catch-all:')
for c in all_cats[:5]:
    print(f'# WC_DEFAULT_CATEGORY_ID={c["id"]}  ← {c["name"]}')
