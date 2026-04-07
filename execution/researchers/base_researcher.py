#!/usr/bin/env python3
"""
BASE RESEARCHER: Abstract base class for product research/identification.
Uses SerpApi (Google Lens) and GPT-4o Vision for visual product identification.
"""

import base64
import io
import json
import logging
import os
import re
import shutil
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests
from openai import OpenAI
from PIL import Image
from serpapi import GoogleSearch

logger = logging.getLogger(__name__)


# =============================================================================
# DOMAIN REPUTATION SCORING SYSTEM
# Weights sources by credibility to improve brand confidence assessment
# =============================================================================

# Tier 1: Official brand/retailer sites (highest trust)
TIER_1_DOMAINS = {
    # Official luxury brand sites
    'gucci.com', 'dior.com', 'louisvuitton.com', 'prada.com', 'balenciaga.com',
    'givenchy.com', 'valentino.com', 'fendi.com', 'hermes.com', 'burberry.com',
    'tods.com', 'ferragamo.com', 'bottegaveneta.com', 'loropiana.com',
    'brunellocucinelli.com', 'santoni-shoes.com', 'churchs.com', 'jimmychoo.com',
    'christianlouboutin.com', 'manoloblahnik.com', 'rogerviver.com',
    # Major authorized retailers
    'farfetch.com', 'net-a-porter.com', 'mrporter.com', 'mytheresa.com',
    'ssense.com', 'matchesfashion.com', 'luisaviaroma.com', 'selfridges.com',
    'harrods.com', 'bergdorfgoodman.com', 'neimanmarcus.com', 'saksfifthavenue.com',
    'nordstrom.com', 'bloomingdales.com', '24s.com', 'cettire.com',
}

# Tier 2: Trusted fashion/retail sites
TIER_2_DOMAINS = {
    'vogue.com', 'gq.com', 'harpersbazaar.com', 'elle.com', 'esquire.com',
    'highsnobiety.com', 'hypebeast.com', 'grailed.com', 'vestiairecollective.com',
    'therealreal.com', 'rebag.com', '1stdibs.com', 'fashionphile.com',
    'zappos.com', 'amazon.com', 'ebay.com', 'stockx.com', 'goat.com',
    'endclothing.com', 'brownsfashion.com', 'yoox.com', 'italist.com',
}

# Tier 3: Mixed reliability (general fashion, social)
TIER_3_DOMAINS = {
    'pinterest.com', 'instagram.com', 'facebook.com', 'twitter.com', 'reddit.com',
    'tumblr.com', 'polyvore.com', 'lyst.com', 'shopstyle.com', 'lookastic.com',
    'asos.com', 'zara.com', 'hm.com', 'shein.com', 'boohoo.com',
}

# Tier 4: Low credibility (replica/wholesale markets) - RED FLAGS
TIER_4_DOMAINS = {
    'aliexpress.com', 'alibaba.com', 'dhgate.com', 'taobao.com', '1688.com',
    'wish.com', 'banggood.com', 'gearbest.com', 'yupoo.com', 'weidian.com',
    'pandabuy.com', 'superbuy.com', 'wegobuy.com', 'sugargoo.com',
}


def get_domain_from_url(url: str) -> str:
    """Extract base domain from URL."""
    if not url:
        return ''
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        # Remove 'www.' prefix
        if domain.startswith('www.'):
            domain = domain[4:]
        return domain
    except Exception:
        return ''


def get_domain_reputation_score(domain: str) -> dict:
    """
    Get reputation score and tier for a domain.

    Returns:
        dict with 'score' (0.0-1.0), 'tier' (1-4 or 0 for unknown), 'label'
    """
    domain = domain.lower()

    # Check each tier
    for tier_domain in TIER_1_DOMAINS:
        if tier_domain in domain or domain.endswith(tier_domain):
            return {'score': 1.0, 'tier': 1, 'label': 'Official/Authorized'}

    for tier_domain in TIER_2_DOMAINS:
        if tier_domain in domain or domain.endswith(tier_domain):
            return {'score': 0.75, 'tier': 2, 'label': 'Trusted Retailer'}

    for tier_domain in TIER_3_DOMAINS:
        if tier_domain in domain or domain.endswith(tier_domain):
            return {'score': 0.4, 'tier': 3, 'label': 'Mixed Reliability'}

    for tier_domain in TIER_4_DOMAINS:
        if tier_domain in domain or domain.endswith(tier_domain):
            return {'score': 0.1, 'tier': 4, 'label': 'Low Credibility'}

    # Unknown domain - moderate score
    return {'score': 0.5, 'tier': 0, 'label': 'Unknown'}


@dataclass
class SourceLink:
    """A visual match source with reputation scoring."""
    url: str
    domain: str
    title: str
    reputation_score: float
    reputation_tier: int
    reputation_label: str

    def to_dict(self) -> dict:
        return {
            'url': self.url,
            'domain': self.domain,
            'title': self.title,
            'reputation_score': self.reputation_score,
            'reputation_tier': self.reputation_tier,
            'reputation_label': self.reputation_label
        }



@dataclass
class SearchContext:
    """
    Bundled text evidence from SerpApi for Truth Grounding.
    This data takes priority over visual perception for attributes like color.
    Now includes source links with reputation scoring.
    """
    # Knowledge Graph (highest priority)
    kg_title: Optional[str] = None
    kg_subtitle: Optional[str] = None
    kg_description: Optional[str] = None

    # AI Overview (Google's AI summary)
    ai_overview: Optional[str] = None

    # Visual Match titles (for consensus analysis)
    visual_match_titles: List[str] = field(default_factory=list)

    # Source links with reputation scoring (4B feature)
    source_links: List[SourceLink] = field(default_factory=list)

    # Aggregated reputation metrics
    avg_reputation_score: float = 0.0
    high_tier_count: int = 0  # Tier 1 or 2 sources
    low_tier_count: int = 0   # Tier 4 sources (red flags)

    def get_all_text(self) -> str:
        """Combine all text evidence for analysis."""
        parts = []
        if self.kg_title:
            parts.append(f"Knowledge Graph Title: {self.kg_title}")
        if self.kg_subtitle:
            parts.append(f"Knowledge Graph Subtitle: {self.kg_subtitle}")
        if self.kg_description:
            parts.append(f"Knowledge Graph Description: {self.kg_description}")
        if self.ai_overview:
            parts.append(f"AI Overview: {self.ai_overview}")
        if self.visual_match_titles:
            parts.append(f"Visual Match Titles: {', '.join(self.visual_match_titles[:10])}")
        return "\n".join(parts) if parts else "No search context available"

    def get_top_sources_summary(self, max_sources: int = 5) -> str:
        """Get a summary of top-credibility source links for sheet storage."""
        if not self.source_links:
            return ""

        # Sort by reputation score descending
        sorted_links = sorted(self.source_links, key=lambda x: x.reputation_score, reverse=True)
        top_links = sorted_links[:max_sources]

        summaries = []
        for link in top_links:
            summaries.append(f"{link.domain} ({link.reputation_label})")

        return " | ".join(summaries)

    def get_source_urls(self, max_sources: int = 5) -> List[str]:
        """Get top source URLs for sheet storage."""
        if not self.source_links:
            return []

        sorted_links = sorted(self.source_links, key=lambda x: x.reputation_score, reverse=True)
        return [link.url for link in sorted_links[:max_sources]]


@dataclass
class VisualSearchResult:
    """Result from SerpApi Google Lens visual search."""
    knowledge_graph_title: Optional[str] = None
    visual_matches: List[Dict[str, str]] = field(default_factory=list)
    search_context: SearchContext = field(default_factory=SearchContext)  # NEW: Truth Grounding data
    raw_response: Dict = field(default_factory=dict)
    search_successful: bool = False
    error_message: Optional[str] = None


@dataclass
class ProductIntelligence:
    """Synthesized product intelligence from GPT-4o Vision."""
    designer_brand: str
    product_type: str
    final_product_name: str
    confidence_score: float
    reasoning: str
    attributes: Dict[str, Any]


@dataclass
class ResearchResult:
    """Final research result for sheet update."""
    designer_brand: str
    product_type: str
    final_product_name: str
    attribute_json: str  # JSON string for sheet storage
    researched_at: str
    status: str = 'READY_FOR_SEO'
    # Source transparency (4B feature)
    source_links: str = ''  # Top source URLs (pipe-separated)
    source_summary: str = ''  # Domain summary with reputation labels
    avg_source_reputation: float = 0.0


class BaseResearcher(ABC):
    """
    Abstract base class for product research.
    Handles image download, visual search, and GPT synthesis.
    """

    def __init__(
        self,
        openai_api_key: str,
        serpapi_key: str,
        attribute_matrix_path: str = 'config/attribute_matrix.json'
    ):
        """
        Initialize researcher with API credentials.

        Args:
            openai_api_key: OpenAI API key for GPT-4o Vision
            serpapi_key: SerpApi key for Google Lens
            attribute_matrix_path: Path to brand vocabulary matrix
        """
        self.openai_client = OpenAI(api_key=openai_api_key)
        self.serpapi_key = serpapi_key
        self.attribute_matrix_path = Path(attribute_matrix_path)

        # Load attribute matrix
        self.attribute_matrix = self._load_attribute_matrix()
        # In-house fallback brand (for unconfirmed products); read from matrix so Agent 0 controls it
        self.fallback_brand = self.attribute_matrix.get('brand_name', 'Hollostyle')

        # Create tmp directory
        self.tmp_dir = Path('.tmp')
        self.tmp_dir.mkdir(exist_ok=True)

        # Run-level cost accumulators (reset per batch, reported to run_sessions)
        self._run_tokens: int = 0
        self._run_cost: float = 0.0

        logger.info("BaseResearcher initialized")

    def _load_attribute_matrix(self) -> Dict[str, Any]:
        """Load the brand vocabulary matrix from config."""
        if not self.attribute_matrix_path.exists():
            logger.warning(f"Attribute matrix not found: {self.attribute_matrix_path}")
            return {}

        with open(self.attribute_matrix_path, 'r', encoding='utf-8') as f:
            matrix = json.load(f)

        logger.info(f"Loaded attribute matrix with {len(matrix.get('materials', []))} materials")
        return matrix

    def download_image(
        self,
        file_id: str,
        product_id: str,
        max_retries: int = 3
    ) -> Optional[Path]:
        """
        Download hero image from Cloudinary.

        Args:
            file_id: Cloudinary public_id
            product_id: Product identifier for local storage
            max_retries: Number of retry attempts

        Returns:
            Path to downloaded image, or None if failed
        """
        product_tmp = self.tmp_dir / product_id
        product_tmp.mkdir(exist_ok=True)
        local_path = product_tmp / 'hero.jpg'

        # Download from Cloudinary using public_id
        cloud_name = os.environ.get('CLOUDINARY_CLOUD_NAME')
        if not cloud_name:
            logger.error("CLOUDINARY_CLOUD_NAME not set")
            return None
        url = f"https://res.cloudinary.com/{cloud_name}/image/upload/{file_id}"
        for attempt in range(max_retries):
            try:
                logger.info(f"Downloading image {file_id} from Cloudinary (attempt {attempt + 1}/{max_retries})")
                response = requests.get(url, timeout=30)
                response.raise_for_status()
                with open(local_path, 'wb') as f:
                    f.write(response.content)

                # Validate image
                with Image.open(local_path) as img:
                    img.verify()

                logger.info(f"Successfully downloaded image to {local_path}")
                return local_path

            except Exception as e:
                logger.warning(f"Download attempt {attempt + 1} failed: {e}")
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)  # Exponential backoff
                continue

        logger.error(f"Failed to download image after {max_retries} attempts")
        return None


    def sanitize_brand(self, brand: str) -> str:
        """
        Sanitize brand name by removing non-ASCII characters.

        Examples:
            - "DIOR迪奥" → "DIOR"
            - "GUCCI古驰" → "GUCCI"
            - "Louis Vuitton" → "Louis Vuitton" (unchanged)

        Args:
            brand: Raw brand name that may contain Chinese/non-ASCII characters

        Returns:
            Cleaned brand name with only ASCII characters
        """
        if not brand:
            return brand

        # Remove all non-ASCII characters
        sanitized = re.sub(r'[^\x00-\x7F]+', '', brand)

        # Clean up extra whitespace
        sanitized = ' '.join(sanitized.split()).strip()

        if sanitized != brand:
            logger.info(f"[BRAND SANITIZATION] '{brand}' → '{sanitized}'")

        return sanitized if sanitized else brand  # Fallback to original if completely non-ASCII

    def extract_brand_hint(self, english_name_draft: str) -> Tuple[Optional[str], str]:
        """
        Extract brand hint from English_Name_Draft if present.

        The Agent 1 miner prepends brand hints in the format: [Brand: GUCCI] Original Name

        Args:
            english_name_draft: The English name draft which may contain a brand tag

        Returns:
            Tuple of (brand_hint, clean_name):
            - brand_hint: The extracted brand name (e.g., "GUCCI") or None
            - clean_name: The name with the brand tag removed
        """
        if not english_name_draft:
            return None, ""

        # Pattern: [Brand: SOMETHING] at the start of the string
        brand_match = re.match(r'^\[Brand:\s*([^\]]+)\]\s*(.*)$', english_name_draft, re.IGNORECASE)

        if brand_match:
            brand_hint = brand_match.group(1).strip()
            # Sanitize brand hint (remove non-ASCII characters like Chinese)
            brand_hint = self.sanitize_brand(brand_hint)
            clean_name = brand_match.group(2).strip()
            logger.info(f"[BRAND HINT] Extracted from name: {brand_hint}")
            return brand_hint, clean_name

        logger.info("[BRAND HINT] No brand tag found in English_Name_Draft")
        return None, english_name_draft

    def visual_search(
        self,
        image_path: Path,
        file_id: Optional[str] = None,
        brand_hint: Optional[str] = None
    ) -> VisualSearchResult:
        """
        Perform visual search using SerpApi Google Lens with optional brand seeding.

        HYBRID SEARCH SEEDING: When a brand hint is provided (e.g., "GUCCI" from raw text),
        we pass it to SerpApi's `q` parameter to seed the visual search. This dramatically
        improves identification accuracy.

        Args:
            image_path: Path to local image file
            file_id: Optional Drive file ID for public URL approach
            brand_hint: Optional brand name to seed the search (e.g., "GUCCI")

        Returns:
            VisualSearchResult with knowledge graph and visual matches
        """
        try:
            if brand_hint:
                logger.info(f"[SEEDED SEARCH] Starting visual search for {image_path} with brand hint: {brand_hint}")
            else:
                logger.info(f"Starting visual search for {image_path} (no brand hint)")

            # SerpApi Google Lens requires a URL. Options:
            # 1. Make Drive file public (needs write permission)
            # 2. Use image upload to SerpApi (paid feature)
            # 3. Upload to temporary hosting

            # Try public URL approach first
            image_url = None
            if file_id and '/' in file_id:
                # Cloudinary public_id → direct URL
                cloud_name = os.environ.get('CLOUDINARY_CLOUD_NAME')
                if cloud_name:
                    image_url = f"https://res.cloudinary.com/{cloud_name}/image/upload/{file_id}"
                    logger.info(f"Using Cloudinary URL for visual search: {image_url}")
            elif file_id:
                # Try Drive public URL
                image_url = self._make_image_public(file_id)

            # If no public URL, use base64 upload approach
            if not image_url:
                # Read image and encode as base64 for upload
                with open(image_path, 'rb') as f:
                    image_data = f.read()

                # SerpApi accepts base64 via 'image' parameter for some engines
                # For Google Lens, we'll use a workaround: upload to imgbb or similar
                # For now, we'll proceed with limited search capability
                logger.warning("Could not create public URL for image. Visual search may be limited.")

                # Use thumbnail from SerpApi if available, or skip visual search
                return VisualSearchResult(
                    search_successful=False,
                    error_message="Could not create public URL for visual search. Proceeding with GPT-only analysis."
                )

            # Build Google Lens search params
            # KEY CHANGE: Add `q` parameter for hybrid search seeding
            params = {
                'api_key': self.serpapi_key,
                'engine': 'google_lens',
                'url': image_url
            }

            # HYBRID SEARCH: If brand hint exists, seed the search query
            if brand_hint:
                params['q'] = brand_hint
                logger.info(f"[SEEDED SEARCH] Added query parameter: q={brand_hint}")

            search = GoogleSearch(params)
            results = search.get_dict()

            # ============================================================
            # TRUTH GROUNDING: Extract all text evidence from SerpApi
            # This data takes priority over visual perception for colors
            # ============================================================

            # SOURCE A: Knowledge Graph (highest priority for product identity)
            knowledge_graph_title = None
            kg_subtitle = None
            kg_description = None

            if 'knowledge_graph' in results:
                kg = results['knowledge_graph']
                knowledge_graph_title = kg.get('title')
                kg_subtitle = kg.get('subtitle') or kg.get('type')
                kg_description = kg.get('description') or kg.get('snippet')
                logger.info(f"[TRUTH GROUNDING] Knowledge Graph found:")
                logger.info(f"   Title: {knowledge_graph_title}")
                if kg_subtitle:
                    logger.info(f"   Subtitle: {kg_subtitle}")
                if kg_description:
                    logger.info(f"   Description: {kg_description[:100]}...")

            # SOURCE B: AI Overview (Google's AI summary - very reliable for colors/attributes)
            ai_overview = None
            if 'ai_overview' in results:
                ai_data = results['ai_overview']
                if isinstance(ai_data, dict):
                    ai_overview = ai_data.get('text') or ai_data.get('snippet') or ai_data.get('description')
                elif isinstance(ai_data, str):
                    ai_overview = ai_data
                if ai_overview:
                    logger.info(f"[TRUTH GROUNDING] AI Overview found: {ai_overview[:150]}...")

            # Also check for 'answer_box' which sometimes contains similar info
            if not ai_overview and 'answer_box' in results:
                ab = results['answer_box']
                ai_overview = ab.get('answer') or ab.get('snippet') or ab.get('result')
                if ai_overview:
                    logger.info(f"[TRUTH GROUNDING] Answer Box found: {ai_overview[:150]}...")

            # SOURCE C: Visual Matches (for model name consensus)
            # Now includes domain reputation scoring (4A feature)
            visual_matches = []
            visual_match_titles = []
            source_links = []

            if 'visual_matches' in results:
                for match in results['visual_matches'][:10]:  # Top 10
                    title = match.get('title', '')
                    source = match.get('source', '')
                    link = match.get('link', '')

                    visual_matches.append({
                        'title': title,
                        'source': source,
                        'link': link,
                        'thumbnail': match.get('thumbnail', '')
                    })
                    if title:
                        visual_match_titles.append(title)

                    # Extract domain and compute reputation score
                    if link:
                        domain = get_domain_from_url(link)
                        reputation = get_domain_reputation_score(domain)
                        source_links.append(SourceLink(
                            url=link,
                            domain=domain,
                            title=title,
                            reputation_score=reputation['score'],
                            reputation_tier=reputation['tier'],
                            reputation_label=reputation['label']
                        ))

                logger.info(f"[TRUTH GROUNDING] Found {len(visual_matches)} visual matches")

                # Log reputation analysis
                if source_links:
                    tier_counts = {}
                    total_score = 0
                    for sl in source_links:
                        tier_counts[sl.reputation_tier] = tier_counts.get(sl.reputation_tier, 0) + 1
                        total_score += sl.reputation_score

                    avg_score = total_score / len(source_links) if source_links else 0
                    high_tier = tier_counts.get(1, 0) + tier_counts.get(2, 0)
                    low_tier = tier_counts.get(4, 0)

                    logger.info(f"[DOMAIN REPUTATION] Avg score: {avg_score:.2f}, "
                               f"High-tier: {high_tier}, Low-tier (red flags): {low_tier}")

                    if low_tier > high_tier:
                        logger.warning(f"[DOMAIN REPUTATION] ⚠️ More low-credibility than trusted sources - "
                                      f"brand identification may be unreliable")

            # Compute aggregated reputation metrics
            avg_reputation = 0.0
            high_tier_count = 0
            low_tier_count = 0
            if source_links:
                total_score = sum(sl.reputation_score for sl in source_links)
                avg_reputation = total_score / len(source_links)
                high_tier_count = sum(1 for sl in source_links if sl.reputation_tier in [1, 2])
                low_tier_count = sum(1 for sl in source_links if sl.reputation_tier == 4)

            # Bundle all truth grounding data into SearchContext
            search_context = SearchContext(
                kg_title=knowledge_graph_title,
                kg_subtitle=kg_subtitle,
                kg_description=kg_description,
                ai_overview=ai_overview,
                visual_match_titles=visual_match_titles,
                source_links=source_links,
                avg_reputation_score=avg_reputation,
                high_tier_count=high_tier_count,
                low_tier_count=low_tier_count
            )

            # Log complete truth grounding status
            truth_sources = []
            if knowledge_graph_title:
                truth_sources.append("Knowledge Graph")
            if ai_overview:
                truth_sources.append("AI Overview")
            if visual_match_titles:
                truth_sources.append(f"Visual Matches ({len(visual_match_titles)})")

            if truth_sources:
                logger.info(f"[TRUTH GROUNDING COMPLETE] Sources: {', '.join(truth_sources)}")
            else:
                logger.warning("[TRUTH GROUNDING] No text evidence found - relying on visual analysis only")

            # Log seeded search success
            if brand_hint and (knowledge_graph_title or visual_matches):
                logger.info(f"[SEEDED SEARCH SUCCESS] Brand hint '{brand_hint}' improved search results")

            return VisualSearchResult(
                knowledge_graph_title=knowledge_graph_title,
                visual_matches=visual_matches,
                search_context=search_context,
                raw_response=results,
                search_successful=True
            )

        except Exception as e:
            logger.error(f"Visual search failed: {e}")
            return VisualSearchResult(
                search_successful=False,
                error_message=str(e)
            )

    def _encode_image_base64(self, image_path: Path) -> str:
        """Encode image to base64 for GPT-4o Vision."""
        with open(image_path, 'rb') as f:
            return base64.b64encode(f.read()).decode('utf-8')

    def _build_synthesis_prompt(
        self,
        search_result: VisualSearchResult,
        english_name_draft: str,
        material_info: str,
        brand_hint: Optional[str] = None
    ) -> str:
        """Build the system prompt for GPT-4o Vision synthesis with Truth Grounding protocol."""

        # Extract visual matches with domain reputation (4A feature)
        ctx = search_result.search_context
        visual_matches_lines = []
        for sl in ctx.source_links[:10]:
            tier_emoji = "🟢" if sl.reputation_tier in [1, 2] else "🟡" if sl.reputation_tier in [0, 3] else "🔴"
            visual_matches_lines.append(
                f"- {sl.title} | {sl.domain} | {tier_emoji} {sl.reputation_label}"
            )
        visual_matches_text = "\n".join(visual_matches_lines) or "No visual matches found"

        # Domain reputation summary for GPT context
        domain_reputation_section = ""
        if ctx.source_links:
            domain_reputation_section = f"""
### 📊 DOMAIN REPUTATION ANALYSIS (4A Feature)
- **Average Reputation Score:** {ctx.avg_reputation_score:.2f}/1.0
- **High-Credibility Sources (Tier 1-2):** {ctx.high_tier_count}
- **Low-Credibility Sources (Tier 4 - RED FLAG):** {ctx.low_tier_count}

**🟢 Tier 1-2 (Official/Authorized):** Trust brand identification from these sources
**🟡 Tier 3 (Mixed):** Use for consensus only, not definitive brand ID
**🔴 Tier 4 (Replica Markets):** IGNORE for brand identification - these are unreliable

⚠️ **RULE:** If most sources are 🔴 Tier 4, brand confidence should be UNCONFIRMED.
"""

        # Build materials and design details lists
        materials_list = ", ".join(self.attribute_matrix.get('materials', []))
        design_details_list = ", ".join(self.attribute_matrix.get('design_details', []))
        sole_types_list = ", ".join(self.attribute_matrix.get('sole_types', []))
        brand_hooks_list = ", ".join(self.attribute_matrix.get('brand_hooks', []))

        # Build brand hint section if available
        brand_hint_section = ""
        if brand_hint:
            brand_hint_section = f"""
## IMPORTANT: Brand Hint from Supplier
The supplier listing explicitly mentions: **{brand_hint}**
This is a strong indicator of the designer brand. Use this information to confirm your visual identification.
"""

        # ============================================================
        # TRUTH GROUNDING: Build text evidence section
        # (ctx already initialized above for domain reputation)
        # ============================================================

        truth_grounding_section = """
## ⚠️ TRUTH GROUNDING PROTOCOL (CRITICAL - READ FIRST)

**You are analyzing a product image. Lighting in product photos is often DECEPTIVE:**
- Black leather can appear Navy/Blue under studio lights
- Brown can appear Grey or Olive
- White can appear Cream or Beige

**THE HIERARCHY OF TRUTH (Follow this order!):**

| Priority | Source | Trust Level | Use For |
|----------|--------|-------------|---------|
| 1 | Knowledge Graph / AI Overview | ABSOLUTE | Color, Material, Model Name |
| 2 | Visual Match Consensus (8+/10) | HIGH | Model Name, Brand |
| 3 | Visual Match Consensus (4-7/10) | MEDIUM | Supporting evidence |
| 4 | Your Visual Perception | LOW | Only when text disagrees |

**RULE: If the text evidence says "Black" but you see "Blue" in the image → USE "Black".**
**RULE: If the text evidence says "Damier Canvas" but you see "Checkered Leather" → USE "Damier Canvas".**
"""

        # Add Knowledge Graph data if available
        kg_section = ""
        if ctx.kg_title or ctx.kg_subtitle or ctx.kg_description:
            kg_section = f"""
### 📊 SOURCE A: Google Knowledge Graph (HIGHEST PRIORITY)
- **Title:** {ctx.kg_title or 'Not available'}
- **Subtitle:** {ctx.kg_subtitle or 'Not available'}
- **Description:** {ctx.kg_description or 'Not available'}

⚡ If Knowledge Graph mentions a color (Black, Brown, White) or material (Leather, Canvas, Suede), **THAT IS THE CORRECT ANSWER.**
"""

        # Add AI Overview if available
        ai_section = ""
        if ctx.ai_overview:
            ai_section = f"""
### 🤖 SOURCE B: Google AI Overview (VERY HIGH PRIORITY)
{ctx.ai_overview}

⚡ The AI Overview is Google's synthesized understanding. Trust color and material info from here.
"""

        # Build the complete prompt
        brand_name = self.fallback_brand
        prompt = f"""You are the Senior Buyer for '{brand_name}', a luxury e-commerce brand. Your task is to identify and name this product using REAL market model names and ACCURATE colors/materials from text evidence.
{truth_grounding_section}
{kg_section}
{ai_section}
{brand_hint_section}
### 📷 SOURCE C: Visual Matches (from Google Lens) - For Model Name Consensus
{visual_matches_text}
{domain_reputation_section}
## Translated Text from Supplier
- Name: {english_name_draft or 'Not available'}
- Materials: {material_info or 'Not specified'}

## {brand_name} Brand Vocabulary Matrix (FOR IN-HOUSE NAMING)
- **Materials:** {materials_list}
- **Sole Types:** {sole_types_list}
- **Design Details:** {design_details_list}
- **Brand Hooks:** {brand_hooks_list}

## Your Tasks

### 1. TRUTH EXTRACTION (MANDATORY FIRST STEP)

**Before analyzing the image, extract these from the TEXT evidence above:**

A. **Color from Text:** What color do the Knowledge Graph / AI Overview / Visual Matches say?
   - If text says "Black" → color = "Black" (even if image looks blue)

B. **Material from Text:** What material do the sources mention?
   - "Leather", "Canvas", "Suede", "Mesh", "Patent Leather", etc.

C. **Model Name from Frequency Analysis:**
   - Count how many Visual Match titles mention specific model names
   - Examples: "Horsebit" (8/10), "D-Wander" (6/10), "Triple S" (7/10)

### 2. ⚠️ BRAND CONFIDENCE CHECK (CRITICAL - DO NOT SKIP)

**Question: Is this a CONFIRMED Designer Item?**

**✅ YES - Designer Confirmed (set `brand_confidence` = "CONFIRMED"):**
- Agent 1 found an explicit brand tag (e.g., `[Brand: GUCCI]`) - THIS IS PRESENT: {f'YES - "{brand_hint}"' if brand_hint else 'NO'}
- OR: Knowledge Graph explicitly names a luxury designer brand
- OR: >50% of Visual Match results (5+/10) name a SPECIFIC designer (e.g., "Gucci", "Dior", "Balenciaga")

**❌ NO - Generic/Unbranded (set `brand_confidence` = "UNCONFIRMED"):**
- No brand tag from Agent 1
- Visual results are generic: "Men's Casual Shoe", "Fashion Sneaker", "Pinterest", "AliExpress", "DHgate"
- Knowledge Graph is missing or doesn't name a specific designer
- Visual matches show mixed brands or no consistent brand

**⚠️ ANTI-HALLUCINATION RULE:**
If you cannot CONFIRM a designer with >50% confidence from text evidence, **DO NOT GUESS.**
Generic-looking products with no brand evidence should use "{brand_name}" branding.

### 3. Designer Identification (Based on Brand Confidence)

**IF `brand_confidence` = "CONFIRMED":**
- Set `designer_brand` to the confirmed brand (e.g., "Gucci", "Dior")
- Use the specific model name from frequency analysis

**IF `brand_confidence` = "UNCONFIRMED":**
- Set `designer_brand` to **"{brand_name}"** (our in-house premium brand)
- DO NOT invent or guess a designer name
- This is a legitimate premium product, just unbranded

### 4. Product Type Classification
Sneaker | Trainer | Runner | Loafer | Moccasin | Boot | Chelsea Boot | Oxford | Derby | Sandal | Slide | Other

### 5. Product Naming - TWO PATHS

**PATH A: Designer Confirmed (brand_confidence = "CONFIRMED")**
Formula: "[Designer] [Model Name] Men's [Color] [Material] [Product_Type]"
Examples:
- "Gucci Horsebit Men's Black Leather Loafer"
- "Dior D-Wander Men's White Mesh Sneaker"

**PATH B: {brand_name} In-House (brand_confidence = "UNCONFIRMED")**
Formula: "[Brand Hook] [Material] [Design Detail] [Product_Type] - [Color]"
Use vocabulary from the {brand_name} Brand Matrix above to create PREMIUM-sounding names.

✅ CORRECT {brand_name} names (sounds boutique-quality):
- "Heritage Appeal Burnished Leather Chelsea Boot - Cognac Brown"
- "Urban Elegance Grained Leather Platform Sneaker - Midnight Black"
- "Modern Classic Nubuck Leather Lug Sole Boot - Espresso"
- "Effortless Style Patent Leather Slip-On Loafer - Onyx"

❌ WRONG {brand_name} names (sounds like AliExpress):
- "Men's Casual Brown Shoe"
- "Fashion Leather Sneaker Black"
- "Comfortable Walking Shoes"

### 6. Confidence Assessment

Set `naming_confidence`:
- **"HIGH"**: Designer CONFIRMED with brand tag or >70% visual consensus
- **"MEDIUM"**: Designer likely with 50-70% consensus, OR {brand_name} with good attributes
- **"LOW"**: Uncertain classification, minimal evidence

### 7. Attribute Extraction
{{
  "brand_confidence": "CONFIRMED | UNCONFIRMED",
  "brand_evidence": "Description of why brand is confirmed or not",
  "model_name": "From frequency analysis, or null for {brand_name}",
  "model_frequency": "X/10 or N/A",
  "color": "FROM TEXT EVIDENCE",
  "color_source": "Knowledge Graph | AI Overview | Visual Match Consensus | Visual Only",
  "material": "FROM TEXT EVIDENCE or Matrix vocabulary",
  "material_source": "Knowledge Graph | AI Overview | Visual Match Consensus | Matrix",
  "sole_type": "From Matrix if needed",
  "closure": "Lace-Up | Slip-On | Buckle | Zipper",
  "hardware": "Horsebit | Buckle | D-Ring | None",
  "style_tags": ["From Matrix vocabulary"]
}}

## Response Format (JSON only, no markdown)

**Example A - Designer Confirmed:**
{{
  "designer_brand": "Gucci",
  "brand_confidence": "CONFIRMED",
  "brand_evidence": "Agent 1 brand tag [Brand: GUCCI] present, Knowledge Graph says 'Gucci Horsebit Loafer', 8/10 visual matches mention Gucci",
  "product_type": "Loafer",
  "model_name": "Horsebit",
  "model_frequency": "8/10",
  "naming_confidence": "HIGH",
  "final_product_name": "Gucci Horsebit Men's Black Leather Loafer",
  "confidence_score": 0.95,
  "reasoning": "Brand CONFIRMED via Agent 1 tag and 8/10 visual consensus. Text evidence for color: Knowledge Graph says Black.",
  "attributes": {{
    "brand_confidence": "CONFIRMED",
    "brand_evidence": "Agent 1 tag + 8/10 visual consensus",
    "model_name": "Horsebit",
    "model_frequency": "8/10",
    "color": "Black",
    "color_source": "Knowledge Graph",
    "material": "100% Genuine Leather",
    "material_source": "AI Overview",
    "sole_type": "Leather Sole",
    "closure": "Slip-On",
    "hardware": "Horsebit",
    "style_tags": ["Classic", "Luxury"]
  }}
}}

**Example B - {brand_name} In-House (No Designer Found):**
{{
  "designer_brand": "{brand_name}",
  "brand_confidence": "UNCONFIRMED",
  "brand_evidence": "No brand tag from Agent 1. Visual matches show generic results: 'Men's Casual Shoe' (3), 'Fashion Sneaker' (2), mixed brands. No consistent designer identified.",
  "product_type": "Sneaker",
  "model_name": null,
  "model_frequency": "N/A",
  "naming_confidence": "MEDIUM",
  "final_product_name": "Elevated Street-Style Burnished Leather Platform Sneaker - Midnight Black",
  "confidence_score": 0.75,
  "reasoning": "Brand UNCONFIRMED - no tag, generic visual results. Using {brand_name} in-house naming with Matrix vocabulary. Color grounded from visual consensus showing black leather.",
  "attributes": {{
    "brand_confidence": "UNCONFIRMED",
    "brand_evidence": "Generic visual results, no brand tag",
    "model_name": null,
    "model_frequency": "N/A",
    "color": "Midnight Black",
    "color_source": "Visual Match Consensus",
    "material": "Burnished Leather",
    "material_source": "Matrix",
    "sole_type": "Platform Sole",
    "closure": "Lace-Up",
    "hardware": "None",
    "style_tags": ["Elevated Street-Style", "Modern Classic"]
  }}
}}"""

        return prompt

    def synthesize_product(
        self,
        image_path: Path,
        search_result: VisualSearchResult,
        english_name_draft: str,
        material_info: str,
        brand_hint: Optional[str] = None
    ) -> Optional[ProductIntelligence]:
        """
        Use GPT-4o Vision to synthesize product intelligence.

        Args:
            image_path: Path to hero image
            search_result: Visual search results from SerpApi
            english_name_draft: Translated product name from Agent 1
            material_info: Material info from Agent 1
            brand_hint: Optional brand hint extracted from raw text (e.g., "GUCCI")

        Returns:
            ProductIntelligence with designer, type, name, and attributes
        """
        try:
            if brand_hint:
                logger.info(f"Synthesizing product with GPT-4o Vision (brand hint: {brand_hint})...")
            else:
                logger.info("Synthesizing product with GPT-4o Vision...")

            # Encode image
            image_base64 = self._encode_image_base64(image_path)

            # Build prompt (with brand hint if available)
            system_prompt = self._build_synthesis_prompt(
                search_result,
                english_name_draft,
                material_info,
                brand_hint=brand_hint
            )

            # Call GPT-4o Vision
            response = self.openai_client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {
                        "role": "system",
                        "content": "You are an expert luxury fashion buyer. Respond only with valid JSON."
                    },
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": system_prompt
                            },
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{image_base64}",
                                    "detail": "high"
                                }
                            }
                        ]
                    }
                ],
                max_tokens=1500,
                temperature=0.3
            )

            # Log token usage & estimated cost (GPT-4o: $2.50/1M input, $10.00/1M output)
            u = response.usage
            cost = (u.prompt_tokens / 1_000_000 * 2.50) + (u.completion_tokens / 1_000_000 * 10.00)
            self._run_tokens += u.total_tokens
            self._run_cost += cost
            logger.info(
                f"[COST][Agent2] prompt={u.prompt_tokens} completion={u.completion_tokens} "
                f"total={u.total_tokens} est_cost=${cost:.5f}"
            )

            # Parse response
            content = response.choices[0].message.content.strip()

            # Remove markdown code blocks if present
            if content.startswith('```'):
                content = content.split('```')[1]
                if content.startswith('json'):
                    content = content[4:]
                content = content.strip()

            result = json.loads(content)

            # Extract key identification results
            designer_brand = result.get('designer_brand', self.fallback_brand)
            product_type = result.get('product_type', 'Footwear')
            model_name = result.get('model_name') or result.get('attributes', {}).get('model_name')
            model_frequency = result.get('model_frequency') or result.get('attributes', {}).get('model_frequency', 'N/A')
            naming_confidence = result.get('naming_confidence', 'LOW')

            # Extract brand confidence (new field for anti-overfitting)
            brand_confidence = result.get('brand_confidence') or result.get('attributes', {}).get('brand_confidence', 'UNCONFIRMED')
            brand_evidence = result.get('brand_evidence') or result.get('attributes', {}).get('brand_evidence', 'No evidence provided')

            # Extract truth grounding sources
            attributes = result.get('attributes', {})
            color = attributes.get('color', 'Unknown')
            color_source = attributes.get('color_source', 'Visual Only')
            material = attributes.get('material', 'Unknown')
            material_source = attributes.get('material_source', 'Visual Only')

            # Log identification with confidence assessment
            logger.info(f"GPT identified: {designer_brand} - {product_type}")

            # BRAND CONFIDENCE LOGGING (Anti-Overfitting Check)
            if brand_confidence == 'CONFIRMED':
                logger.info(f"[BRAND CONFIDENCE] ✅ CONFIRMED - Designer '{designer_brand}' verified")
                logger.info(f"[BRAND CONFIDENCE] Evidence: {brand_evidence[:100]}...")
            else:
                logger.info(f"[BRAND CONFIDENCE] ⚠️ UNCONFIRMED - Using {self.fallback_brand} in-house branding")
                logger.info(f"[BRAND CONFIDENCE] Reason: {brand_evidence[:100]}...")
                # Ensure fallback brand is used for unconfirmed brands
                if designer_brand != self.fallback_brand:
                    logger.warning(f"[BRAND CONFIDENCE] Override: GPT returned '{designer_brand}' but confidence is UNCONFIRMED")
                    logger.warning(f"[BRAND CONFIDENCE] This may indicate overfitting - review visual matches")

            # TRUTH GROUNDING VALIDATION LOGGING
            logger.info(f"[TRUTH GROUNDING] Color: '{color}' (source: {color_source})")
            logger.info(f"[TRUTH GROUNDING] Material: '{material}' (source: {material_source})")

            # Check if truth was grounded or relied on visual perception
            text_sources = ['Knowledge Graph', 'AI Overview', 'Visual Match Consensus']
            color_grounded = any(src in color_source for src in text_sources)
            material_grounded = any(src in material_source for src in text_sources)

            if color_grounded and material_grounded:
                logger.info(f"[TRUTH GROUNDING] ✅ Both color and material grounded in text evidence")
            elif color_grounded or material_grounded:
                logger.info(f"[TRUTH GROUNDING] ⚠️ Partial grounding - some attributes from visual perception")
            else:
                logger.warning(f"[TRUTH GROUNDING] ❌ No text evidence used - relying on visual perception")

            # MODEL NAME LOGGING (only relevant for confirmed designers)
            if brand_confidence == 'CONFIRMED':
                if model_name:
                    logger.info(f"[MODEL ID] ✅ Model name identified: '{model_name}' (frequency: {model_frequency})")
                else:
                    logger.info(f"[MODEL ID] ⚠️ Designer confirmed but no specific model name found")
            else:
                logger.info(f"[MODEL ID] N/A - Using {self.fallback_brand} naming formula")

            logger.info(f"[FINAL NAME] {result.get('final_product_name', '')}")

            # Ensure all extracted fields are in attributes
            if model_name and 'model_name' not in attributes:
                attributes['model_name'] = model_name
            if model_frequency and 'model_frequency' not in attributes:
                attributes['model_frequency'] = model_frequency
            attributes['naming_confidence'] = naming_confidence
            attributes['brand_confidence'] = brand_confidence
            attributes['brand_evidence'] = brand_evidence
            attributes['truth_grounded'] = color_grounded and material_grounded

            return ProductIntelligence(
                designer_brand=designer_brand,
                product_type=product_type,
                final_product_name=result.get('final_product_name', ''),
                confidence_score=result.get('confidence_score', 0.5),
                reasoning=result.get('reasoning', ''),
                attributes=attributes
            )

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse GPT response as JSON: {e}")
            logger.error(f"Raw response: {content[:500]}")
            return None
        except Exception as e:
            logger.error(f"GPT synthesis failed: {e}", exc_info=True)
            return None

    def _apply_self_correction(
        self,
        intelligence: ProductIntelligence,
        brand_hint: Optional[str] = None
    ) -> ProductIntelligence:
        """
        Apply self-correction rules to ensure consistency.

        Rules applied:
        1. BRAND SANITIZATION: Remove non-ASCII characters from designer_brand
        2. BRAND CONFIDENCE CHECK: Respect brand confidence - don't override fallback brand if UNCONFIRMED
        3. MODEL NAME PRIORITY: Ensure model name is in final_product_name (only for confirmed designers)
        4. NAME CONSISTENCY: Ensure proper naming format based on brand type
        """
        # Get brand confidence from attributes
        brand_confidence = intelligence.attributes.get('brand_confidence', 'UNCONFIRMED')

        # Rule 0: Sanitize designer_brand (remove non-ASCII characters like Chinese)
        original_brand = intelligence.designer_brand
        intelligence.designer_brand = self.sanitize_brand(intelligence.designer_brand)
        if original_brand != intelligence.designer_brand:
            logger.info(f"[SELF-CORRECTION] Sanitized brand: '{original_brand}' → '{intelligence.designer_brand}'")

        # Rule 1: Brand hint override - ONLY if brand confidence is CONFIRMED or brand_hint exists
        # Brand tags from Agent 1 are strong evidence and should trigger CONFIRMED status
        if brand_hint and intelligence.designer_brand == self.fallback_brand:
            clean_brand_hint = self.sanitize_brand(brand_hint)

            # If we have a brand hint, it's strong evidence - upgrade to CONFIRMED
            if brand_confidence == 'UNCONFIRMED':
                logger.info(f"[SELF-CORRECTION] Brand hint '{clean_brand_hint}' present - upgrading confidence")
                brand_confidence = 'CONFIRMED'
                intelligence.attributes['brand_confidence'] = 'CONFIRMED'
                intelligence.attributes['brand_evidence'] = f"Agent 1 brand tag: [{clean_brand_hint}]"

            logger.info(f"[SELF-CORRECTION] GPT defaulted to {self.fallback_brand} but supplier mentioned '{clean_brand_hint}'")
            logger.info(f"[SELF-CORRECTION] Overriding to use brand hint: {clean_brand_hint}")
            intelligence.designer_brand = clean_brand_hint

            # Also update the name to include the brand
            if not intelligence.final_product_name.upper().startswith(clean_brand_hint.upper()):
                # Try to convert in-house naming to designer naming
                # In-house format: "Heritage Appeal Burnished Leather Boot - Cognac"
                # Designer format: "Brand Model Men's Color Material Type"

                # Check if name contains the fallback brand and replace
                if self.fallback_brand in intelligence.final_product_name:
                    intelligence.final_product_name = intelligence.final_product_name.replace(
                        self.fallback_brand, clean_brand_hint, 1
                    )
                else:
                    # Prepend the brand
                    intelligence.final_product_name = f"{clean_brand_hint} {intelligence.final_product_name}"
                logger.info(f"[SELF-CORRECTION] Updated name to: {intelligence.final_product_name}")

        # Rule 2: Model name priority (only for CONFIRMED designers)
        model_name = intelligence.attributes.get('model_name')
        if brand_confidence == 'CONFIRMED' and model_name:
            if model_name.lower() not in intelligence.final_product_name.lower():
                # Insert model name after designer brand
                brand = intelligence.designer_brand
                if intelligence.final_product_name.upper().startswith(brand.upper()):
                    rest = intelligence.final_product_name[len(brand):].strip()
                    intelligence.final_product_name = f"{brand} {model_name} {rest}"
                else:
                    intelligence.final_product_name = f"{brand} {model_name} {intelligence.final_product_name}"
                logger.info(f"[SELF-CORRECTION] Added model name '{model_name}' to: {intelligence.final_product_name}")

        # Rule 3: Name consistency based on brand type
        if brand_confidence == 'CONFIRMED' and intelligence.designer_brand != self.fallback_brand:
            # Designer names should start with the brand
            if not intelligence.final_product_name.upper().startswith(intelligence.designer_brand.upper()):
                intelligence.final_product_name = f"{intelligence.designer_brand} {intelligence.final_product_name}"
                logger.info(f"[SELF-CORRECTION] Prepended designer to name")
        elif intelligence.designer_brand == self.fallback_brand:
            # In-house names should NOT start with the brand name - they use the hook format
            if intelligence.final_product_name.startswith(f'{self.fallback_brand} '):
                # Remove brand prefix - the name should start with a Brand Hook
                intelligence.final_product_name = intelligence.final_product_name[len(self.fallback_brand) + 1:]
                logger.info(f"[SELF-CORRECTION] Removed '{self.fallback_brand}' prefix - using hook format")

        # Rule 4: Ensure product type is in the name
        if intelligence.product_type.lower() not in intelligence.final_product_name.lower():
            logger.warning(f"Product type '{intelligence.product_type}' not found in name")

        # Rule 5: Final sanitization - clean up any double spaces
        intelligence.final_product_name = ' '.join(intelligence.final_product_name.split())

        # Rule 6: Final validation summary
        model_name = intelligence.attributes.get('model_name')
        model_frequency = intelligence.attributes.get('model_frequency', 'N/A')

        logger.info(f"[VALIDATION SUMMARY]")
        logger.info(f"   Brand: {intelligence.designer_brand} ({brand_confidence})")
        if brand_confidence == 'CONFIRMED' and model_name:
            logger.info(f"   Model: {model_name} | Frequency: {model_frequency}")
            logger.info(f"   ✅ Designer product with model identification")
        elif brand_confidence == 'CONFIRMED':
            logger.info(f"   ⚠️ Designer product without specific model name")
        else:
            logger.info(f"   ✅ {self.fallback_brand} in-house product (using premium naming)")
        logger.info(f"   Final: {intelligence.final_product_name}")

        return intelligence

    def cleanup_tmp(self, product_id: str) -> None:
        """Clean up temporary files for a product."""
        product_tmp = self.tmp_dir / product_id
        if product_tmp.exists():
            shutil.rmtree(product_tmp)
            logger.info(f"Cleaned up {product_tmp}")

    def process_product(self, row_data: Dict[str, Any]) -> Optional[ResearchResult]:
        """
        Process a single product row.
        Full pipeline: Download → Extract Brand Hint → Visual Search (Seeded) → Synthesize → Self-Correct

        HYBRID SEARCH SEEDING: If Agent 1 found a brand hint in the raw Chinese text
        (e.g., 【GUCCI】), it will be in English_Name_Draft as "[Brand: GUCCI] ...".
        We extract this hint and use it to seed the SerpApi visual search for better accuracy.

        Args:
            row_data: Row data from Google Sheet

        Returns:
            ResearchResult ready for sheet update, or None if failed
        """
        product_id = row_data.get('product_id', 'unknown')
        main_image_id = row_data.get('main_image_id')
        english_name_draft = row_data.get('english_name_draft', '')
        material_info = row_data.get('material_info', '')

        logger.info(f"Processing product: {product_id}")

        # Validation
        if not main_image_id:
            logger.error(f"Missing main_image_id for {product_id}")
            return None

        try:
            # Step 1: Download image
            image_path = self.download_image(main_image_id, product_id)
            if not image_path:
                logger.error(f"Failed to download image for {product_id}")
                return None

            # Step 2: Extract brand hint from English_Name_Draft (if present)
            # Format: "[Brand: GUCCI] Original Translation" → brand_hint="GUCCI", clean_name="Original Translation"
            brand_hint, clean_english_name = self.extract_brand_hint(english_name_draft)

            if brand_hint:
                logger.info(f"[HYBRID SEARCH] Using brand hint for seeded visual search: {brand_hint}")

            # Step 3: Visual search with optional brand seeding (may fail gracefully)
            # Pass main_image_id so visual_search can build the Cloudinary public URL
            search_result = self.visual_search(image_path, main_image_id, brand_hint=brand_hint)

            if not search_result.search_successful:
                logger.warning(f"Visual search failed: {search_result.error_message}")
                # Continue with GPT-only analysis

            # Step 4: GPT synthesis (use clean name without brand tag for synthesis)
            intelligence = self.synthesize_product(
                image_path,
                search_result,
                clean_english_name,  # Use clean name (without [Brand: X] tag)
                material_info,
                brand_hint=brand_hint  # Pass brand hint for GPT context
            )

            if not intelligence:
                logger.error(f"GPT synthesis failed for {product_id}")
                return None

            # Step 5: Self-correction (ensure brand consistency)
            intelligence = self._apply_self_correction(intelligence, brand_hint)

            # Step 6: Build result with source transparency (4A/4B features)
            researched_at = datetime.now(timezone.utc).isoformat()

            # Extract source links from search context
            search_context = search_result.search_context
            source_urls = search_context.get_source_urls(max_sources=5)
            source_summary = search_context.get_top_sources_summary(max_sources=5)
            avg_reputation = search_context.avg_reputation_score

            # Log source transparency
            if source_urls:
                logger.info(f"[SOURCE TRANSPARENCY] Top {len(source_urls)} sources saved for verification")
                logger.info(f"[SOURCE TRANSPARENCY] Summary: {source_summary}")

            result = ResearchResult(
                designer_brand=intelligence.designer_brand,
                product_type=intelligence.product_type,
                final_product_name=intelligence.final_product_name,
                attribute_json=json.dumps(intelligence.attributes, ensure_ascii=False),
                researched_at=researched_at,
                status='READY_FOR_SEO',
                # Source transparency (4B feature)
                source_links=' | '.join(source_urls),
                source_summary=source_summary,
                avg_source_reputation=round(avg_reputation, 2)
            )

            logger.info(f"Research complete: {intelligence.final_product_name}")

            return result

        finally:
            # Always cleanup
            self.cleanup_tmp(product_id)

    @abstractmethod
    def get_fallback_brand(self) -> str:
        """Return the fallback brand name when no designer is identified."""
        pass
