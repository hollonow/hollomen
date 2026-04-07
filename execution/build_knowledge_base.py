#!/usr/bin/env python3
"""
AGENT 0: THE APPRENTICE (Calibration)
Scrapes client sites to reverse-engineer brand vocabulary and naming conventions.
"""

import json
import logging
import os
import sys
import time
from typing import Dict, List, Optional, Any
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from openai import OpenAI

# Configure logging to stderr
logging.basicConfig(
    level=logging.INFO,
    format='[AGENT_0] [%(asctime)s] [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler(sys.stderr)]
)
logger = logging.getLogger(__name__)


class KnowledgeBaseBuilder:
    """Builds the attribute matrix by scraping client sites."""

    def __init__(self, openai_api_key: str):
        """Initialize the builder with API credentials."""
        self.client = OpenAI(api_key=openai_api_key)
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })

    def load_sites(self, sites_file: str) -> List[Dict[str, str]]:
        """Load client sites from JSON config."""
        try:
            with open(sites_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return data.get('client_sites', [])
        except FileNotFoundError:
            logger.error(f"Sites file not found: {sites_file}")
            sys.exit(1)
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON in sites file: {e}")
            sys.exit(1)

    def fetch_with_retry(self, url: str, max_retries: int = 3) -> Optional[requests.Response]:
        """Fetch URL with exponential backoff retry logic."""
        for attempt in range(max_retries):
            try:
                response = self.session.get(url, timeout=10)
                response.raise_for_status()
                return response
            except requests.RequestException as e:
                wait_time = 2 ** attempt
                logger.warning(f"Attempt {attempt + 1} failed for {url}: {e}. Retrying in {wait_time}s...")
                if attempt < max_retries - 1:
                    time.sleep(wait_time)
                else:
                    logger.error(f"Failed to fetch {url} after {max_retries} attempts")
                    return None

    def try_shopify_products_json(self, base_url: str) -> Optional[List[Dict[str, Any]]]:
        """Attempt to fetch products from Shopify products.json endpoint."""
        products_url = urljoin(base_url, '/products.json?limit=10')
        logger.info(f"Trying Shopify endpoint: {products_url}")

        response = self.fetch_with_retry(products_url)
        if response and response.status_code == 200:
            try:
                data = response.json()
                products = data.get('products', [])
                logger.info(f"Found {len(products)} products via Shopify API")
                return products
            except json.JSONDecodeError:
                logger.warning("Response was not valid JSON")
        return None

    def scrape_product_page(self, url: str) -> Optional[Dict[str, str]]:
        """Scrape a single product page for title and description."""
        response = self.fetch_with_retry(url)
        if not response:
            return None

        try:
            soup = BeautifulSoup(response.text, 'html.parser')

            # Extract title (try multiple selectors)
            title = None
            for selector in ['h1.product-title', 'h1', 'meta[property="og:title"]']:
                elem = soup.select_one(selector)
                if elem:
                    title = elem.get('content') if elem.name == 'meta' else elem.get_text(strip=True)
                    break

            # Extract description (try multiple selectors)
            description = None
            for selector in ['.product-description', '.description', 'meta[name="description"]', 'meta[property="og:description"]']:
                elem = soup.select_one(selector)
                if elem:
                    description = elem.get('content') if elem.name == 'meta' else elem.get_text(strip=True)
                    break

            if title:
                return {
                    'title': title,
                    'description': description or '',
                    'url': url
                }
        except Exception as e:
            logger.error(f"Error parsing {url}: {e}")

        return None

    def find_product_urls_from_sitemap(self, base_url: str) -> List[str]:
        """Extract product URLs from sitemap.xml."""
        sitemap_url = urljoin(base_url, '/sitemap.xml')
        logger.info(f"Trying sitemap: {sitemap_url}")

        response = self.fetch_with_retry(sitemap_url)
        if not response:
            return []

        try:
            soup = BeautifulSoup(response.text, 'xml')

            # Look for product sitemap links
            sitemap_links = soup.find_all('loc')
            product_sitemap = None
            for link in sitemap_links:
                if 'product' in link.text.lower():
                    product_sitemap = link.text
                    break

            # If found product sitemap, fetch it
            if product_sitemap:
                logger.info(f"Found product sitemap: {product_sitemap}")
                response = self.fetch_with_retry(product_sitemap)
                if response:
                    soup = BeautifulSoup(response.text, 'xml')

            # Extract all product URLs
            urls = []
            for loc in soup.find_all('loc'):
                url = loc.text
                # Filter for likely product URLs
                if '/products/' in url or '/product/' in url:
                    urls.append(url)

            logger.info(f"Found {len(urls)} product URLs in sitemap")
            return urls[:10]  # Limit to 10

        except Exception as e:
            logger.error(f"Error parsing sitemap: {e}")
            return []

    def scrape_site(self, site: Dict[str, str]) -> List[Dict[str, str]]:
        """Scrape products from a single site using multiple strategies."""
        brand = site['brand']
        base_url = site['url']
        logger.info(f"Scraping {brand} at {base_url}")

        products = []

        # Strategy A: Try Shopify products.json
        shopify_products = self.try_shopify_products_json(base_url)
        if shopify_products:
            for p in shopify_products[:10]:
                products.append({
                    'title': p.get('title', ''),
                    'description': BeautifulSoup(p.get('body_html', ''), 'html.parser').get_text(strip=True),
                    'brand': brand,
                    'url': urljoin(base_url, f"/products/{p.get('handle', '')}")
                })
            return products

        # Strategy B: Try sitemap
        product_urls = self.find_product_urls_from_sitemap(base_url)
        for url in product_urls[:10]:
            product_data = self.scrape_product_page(url)
            if product_data:
                product_data['brand'] = brand
                products.append(product_data)

        if products:
            logger.info(f"Scraped {len(products)} products from {brand}")
        else:
            logger.warning(f"No products found for {brand}")

        return products

    def analyze_with_llm(self, products: List[Dict[str, str]]) -> Dict[str, Any]:
        """Send product data to OpenAI for vocabulary extraction."""
        logger.info(f"Analyzing {len(products)} products with GPT-4...")

        # Build prompt with product data
        product_summary = "\n\n".join([
            f"Brand: {p['brand']}\nTitle: {p['title']}\nDescription: {p['description'][:500]}"
            for p in products
        ])

        system_prompt = """You are a luxury e-commerce brand analyst. Analyze the following product listings from high-end fashion retailers. Extract their specific vocabulary, design language, and naming conventions.

Return a JSON object with:
- brand_voice_summary: Overall tone and positioning
- materials: Array of material terms they use (e.g., "Italian Leather", "Suede", "Canvas")
- sole_types: Array of sole descriptions (e.g., "Rubber Outsole", "Leather Sole")
- fit_types: Array of fit terminology (e.g., "True to Size", "Slim Fit")
- design_details: Array of design descriptors (e.g., "Minimalist", "Statement", "Classic")
- brand_hooks: Array of recurring brand phrases or value props
- naming_formula: Description of how they structure product names
- tone_characteristics: Object with "formality", "adjective_density", and "seo_patterns" fields

Only extract terms they ACTUALLY use. Do not invent or suggest improvements."""

        user_prompt = f"Analyze these product listings:\n\n{product_summary}"

        try:
            response = self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                response_format={"type": "json_object"},
                temperature=0.3
            )

            result = json.loads(response.choices[0].message.content)
            logger.info("LLM analysis completed successfully")
            return result

        except Exception as e:
            logger.error(f"OpenAI API error: {e}")
            logger.error("Check your OPENAI_API_KEY in .env file")
            sys.exit(1)

    def build_matrix(self, sites_file: str = "config/sites.json", output_file: str = "config/attribute_matrix.json", force: bool = False) -> None:
        """Main execution: scrape sites and build attribute matrix."""
        logger.info("Starting knowledge base build...")

        # Check if output exists
        if os.path.exists(output_file) and not force:
            logger.warning(f"{output_file} already exists. Use --force to overwrite.")
            response = input("Overwrite? (y/n): ")
            if response.lower() != 'y':
                logger.info("Aborted by user")
                return

        # Load sites
        sites = self.load_sites(sites_file)
        logger.info(f"Loaded {len(sites)} client sites")

        # Scrape all sites
        all_products = []
        for site in sites:
            products = self.scrape_site(site)
            all_products.extend(products)
            time.sleep(1)  # Be polite

        if len(all_products) < 5:
            logger.error(f"Only found {len(all_products)} products. Need at least 5 for analysis.")
            sys.exit(1)

        logger.info(f"Total products collected: {len(all_products)}")

        # Analyze with LLM
        matrix = self.analyze_with_llm(all_products)

        # Add metadata
        matrix['_metadata'] = {
            'products_analyzed': len(all_products),
            'sites_scraped': len(sites),
            'generated_at': time.strftime('%Y-%m-%d %H:%M:%S')
        }

        # Write to file
        os.makedirs(os.path.dirname(output_file), exist_ok=True)
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(matrix, f, indent=2, ensure_ascii=False)

        logger.info(f"✅ Attribute matrix written to {output_file}")
        logger.info(f"✅ Materials found: {len(matrix.get('materials', []))}")
        logger.info(f"✅ Design details: {len(matrix.get('design_details', []))}")

        # Output to stdout for piping
        print(json.dumps(matrix, indent=2))


def main():
    """Entry point for Agent 0."""
    load_dotenv()

    openai_api_key = os.getenv('OPENAI_API_KEY')
    if not openai_api_key:
        logger.error("OPENAI_API_KEY not found in environment")
        logger.error("Please add it to your .env file")
        sys.exit(1)

    builder = KnowledgeBaseBuilder(openai_api_key)

    # Check for --force flag
    force = '--force' in sys.argv

    builder.build_matrix(force=force)


if __name__ == "__main__":
    main()
