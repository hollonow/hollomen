"""
AGENT 2: THE ARCHITECT - Researcher Module
Visual product identification using SerpApi and GPT-4o Vision.
Includes Truth Grounding protocol to prevent color/material hallucination.
Includes Domain Reputation scoring for source credibility weighting.
"""

from .base_researcher import (
    BaseResearcher,
    SearchContext,
    VisualSearchResult,
    ProductIntelligence,
    ResearchResult,
    SourceLink,
    get_domain_from_url,
    get_domain_reputation_score,
    TIER_1_DOMAINS,
    TIER_2_DOMAINS,
    TIER_3_DOMAINS,
    TIER_4_DOMAINS,
)

__all__ = [
    'BaseResearcher',
    'SearchContext',
    'VisualSearchResult',
    'ProductIntelligence',
    'ResearchResult',
    'SourceLink',
    'get_domain_from_url',
    'get_domain_reputation_score',
    'TIER_1_DOMAINS',
    'TIER_2_DOMAINS',
    'TIER_3_DOMAINS',
    'TIER_4_DOMAINS',
]
