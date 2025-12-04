from cortado_core.variant_query_language.check_query_tree_against_graph import (
    check_query_tree,
)
from cortado_core.variant_query_language.error_handling import LexerError, ParseError
from cortado_core.variant_query_language.parse_query import parse_query_to_query_tree
from cortado_core.utils.split_graph import SequenceGroup, ConcurrencyGroup
from cortado_core.visual_query_language.query import check_variant

from typing import Tuple, Mapping, Any

def evaluate_query_against_variant_graphs(query, variants, activities):
    ids = []

    try:
        qt = parse_query_to_query_tree(query.queryString)

        for bid, (variant, _, _, info) in variants.items():
            for g in variant.graphs.keys():
                b = check_query_tree(qt, g, activities, True)

                if b:
                    ids.append(bid)
                    break

    except ParseError as PE:
        res = {"error": PE.msg, "error_index": PE.column}
        return res

    except LexerError as LE:
        res = {"error": LE.msg, "error_index": LE.column}
        return res

    return {"ids": ids}

def evaluate_pattern_agains_variant_graphs(pattern: SequenceGroup, variants: Mapping[int, Tuple[ConcurrencyGroup, Any, Any, Any]]):
    try: 
        return [id for id, (variant, _, _, _) in variants.items() if check_variant(pattern, variant)]
    except Exception as e:
        return {"error": str(e)}