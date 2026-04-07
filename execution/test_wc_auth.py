#!/usr/bin/env python3
"""
Diagnostic script to test WooCommerce + WordPress authentication.
Run: cd execution && python test_wc_auth.py
"""
import os
import sys
import json
import requests
from requests.auth import HTTPBasicAuth
from pathlib import Path

# Force UTF-8 output on Windows
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

sys.path.insert(0, str(Path(__file__).parent.parent))
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / '.env')

WC_URL     = os.getenv('WC_URL', '').rstrip('/')
WC_KEY     = os.getenv('WC_CONSUMER_KEY', '')
WC_SECRET  = os.getenv('WC_CONSUMER_SECRET', '')
WP_USER    = os.getenv('WP_USERNAME', '')
WP_PASS    = os.getenv('WP_APP_PASSWORD', '')

SEP = '=' * 60

print(f'\n{SEP}')
print('HolloEngine Auth Diagnostic')
print(SEP)
print(f'Store:       {WC_URL}')
print(f'WC Key:      {WC_KEY[:20]}...')
print(f'WP Username: [{WP_USER}]')
print(f'WP Pass:     {WP_PASS[:4]}...')
print(f'{SEP}\n')


def show_response(label: str, resp: requests.Response):
    print(f'[{label}]')
    print(f'  Status:  {resp.status_code}')
    interesting = ['X-hacker', 'Server', 'WWW-Authenticate', 'X-Powered-By', 'X-ac']
    for h in interesting:
        v = resp.headers.get(h)
        if v:
            print(f'  {h}: {v}')
    try:
        body = resp.json()
        print(f'  Body:    {json.dumps(body)[:400]}')
    except Exception:
        print(f'  Body:    {resp.text[:300]}')
    print()


# 1. WC REST API Basic Auth
print('--- TEST 1: WooCommerce REST API (Basic Auth) ---')
try:
    r = requests.get(
        f'{WC_URL}/wp-json/wc/v3/products',
        params={'per_page': 1},
        auth=HTTPBasicAuth(WC_KEY, WC_SECRET),
        timeout=15,
    )
    show_response('WC API Basic Auth', r)
except Exception as e:
    print(f'  ERROR: {e}\n')


# 2. WC REST API Query Params
print('--- TEST 2: WooCommerce REST API (query params) ---')
try:
    r = requests.get(
        f'{WC_URL}/wp-json/wc/v3/products',
        params={'consumer_key': WC_KEY, 'consumer_secret': WC_SECRET, 'per_page': 1},
        timeout=15,
    )
    show_response('WC API query params', r)
except Exception as e:
    print(f'  ERROR: {e}\n')


# 3. WP REST /users/me
print('--- TEST 3: WordPress /wp-json/wp/v2/users/me ---')
try:
    r = requests.get(
        f'{WC_URL}/wp-json/wp/v2/users/me',
        auth=HTTPBasicAuth(WP_USER, WP_PASS),
        timeout=15,
    )
    show_response('WP /users/me', r)
except Exception as e:
    print(f'  ERROR: {e}\n')


# 4. WP REST root (no auth)
print('--- TEST 4: WordPress REST API root (no auth) ---')
try:
    r = requests.get(f'{WC_URL}/wp-json/', timeout=15)
    show_response('WP REST root', r)
except Exception as e:
    print(f'  ERROR: {e}\n')


# 5. WP users list (public)
print('--- TEST 5: WordPress public user list ---')
try:
    r = requests.get(
        f'{WC_URL}/wp-json/wp/v2/users',
        params={'per_page': 10},
        timeout=15,
    )
    show_response('WP /users public', r)
    if r.status_code == 200:
        users = r.json()
        print('  Known user slugs:')
        for u in users:
            print(f'    id={u.get("id")}  slug=[{u.get("slug")}]  name=[{u.get("name")}]')
        print()
except Exception as e:
    print(f'  ERROR: {e}\n')


# 6. Try app password with each known slug
if WP_PASS:
    print('--- TEST 6: Try WP auth with known user slugs ---')
    slugs = [
        'hollomenstyle', 'angolo-gadii', 'suitharbor',
        'holloengine_dev', 'holloengine-dev', 'hollostyle',
        'admin', 'HolloEngine_Dev', 'trendythreads097gmail-com',
    ]
    for slug in slugs:
        try:
            r = requests.get(
                f'{WC_URL}/wp-json/wp/v2/users/me',
                auth=HTTPBasicAuth(slug, WP_PASS),
                timeout=10,
            )
            ok = 'OK' if r.status_code == 200 else f'FAIL {r.status_code}'
            detail = ''
            try:
                b = r.json()
                detail = b.get('code', b.get('name', b.get('slug', '')))
            except Exception:
                pass
            print(f'  [{slug:35s}]  {ok}  {detail}')
        except Exception as e:
            print(f'  [{slug:35s}]  ERROR: {e}')
    print()


print(SEP)
print('Diagnostic complete.')
print(SEP)
