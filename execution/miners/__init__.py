"""
Miners package: Supplier-specific scrapers for HolloEngine.
"""

from .base_miner import BaseMiner, ProductData, UploadResult, TranslationResult
from .yupoo_miner import YupooMiner

__all__ = [
    'BaseMiner',
    'ProductData',
    'UploadResult',
    'TranslationResult',
    'YupooMiner'
]
