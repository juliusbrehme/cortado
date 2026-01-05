from pydantic import BaseModel
import functools
import operator
from typing import List, Mapping, Tuple
from typing import Any
import numpy as np
from cortado_core.clustering.clusterer import Clusterer
from cortado_core.clustering.variant_clusterer_adapter import calculate_clusters
from cortado_core.models.infix_type import InfixType
from cortado_core.utils.split_graph import ConcurrencyGroup, Group
from pm4py.objects.log.obj import Trace
from fastapi import APIRouter

import cache.cache as cache
from api.routes.variants.models import (
    ClusteringParameters,
    VariantFragment,
    VariantInformation,
)
from api.routes.variants.utils import (
    get_clusterer,
    get_fragment_counts,
    get_trace_counts,
    map_clusters,
)
from cache import cache_util

# i think its better to have one prefix for everything which
# is related to variants instead of defining a prefix for
# every endpoint.
# e.g. /variantQuery should be /variant/query
# because otherwise the generated api docs are not really convenient
router = APIRouter(tags=["Variants"], prefix="/variant")


@router.post("/countFragmentOccurrences")
def count_fragment_occurrences(payload: VariantFragment):
    fragment: Group = Group.deserialize(payload.fragment)

    variants: Mapping[int, Tuple[ConcurrencyGroup, Trace, List, VariantInformation]] = (
        cache.variants
    )
    variants = {k: v for k, v in variants.items() if not v[3].is_user_defined}

    infixType = InfixType[payload.infixType]

    trace_counts = get_trace_counts(variants)
    fragment_counts = get_fragment_counts(variants, fragment, infixType)

    # number of pattern occurrences among all variants
    total_variant_occurrences = functools.reduce(operator.add, fragment_counts)
    # number of variants having at least once the pattern
    variant_occurrences = np.count_nonzero(fragment_counts)
    # number traces having at least once the pattern
    trace_occurrences = np.sum(
        np.array(trace_counts)[np.nonzero(fragment_counts)]
    ).item()

    # number of pattern occurrences among all traces
    total_trace_occurrences = np.sum(
        np.array(trace_counts) * np.array(fragment_counts)
    ).item()

    return {
        "totalOccurrences": total_variant_occurrences,
        "variantOccurrences": variant_occurrences,
        "traceOccurrences": trace_occurrences,
        "totalTraceOccurrences": total_trace_occurrences,
        "variantOccurrencesFraction": round(variant_occurrences / len(variants), 4),
        "traceOccurrencesFraction": round(trace_occurrences / np.sum(trace_counts), 4),
    }


class GroupToSort(BaseModel):
    variants: Any = None


class IdQuery(BaseModel):
    index: Any = None


class caseQuery(BaseModel):
    index: Any = None
    caseId: Any = None


@router.post("/sortvariant")
def sort_variant(payload: GroupToSort):
    sorted_variant = Group.deserialize(payload.variants).sort().serialize()
    res = {
        "variants": sorted_variant,
    }
    return res


@router.post("/cluster")
def cluster(params: ClusteringParameters):
    variants: List[Group] = cache_util.get_variant_list(True)
    clusterer: Clusterer = get_clusterer(params)
    clusters: List[List[Group]] = calculate_clusters(
        variants=variants, clusterer=clusterer
    )
    result = map_clusters(clusters)
    return result


@router.post("/caseStatistics")
def calculateStatistics(query: IdQuery):
    index = int(query.index)
    traces = cache.variants[index][1]
    trace_statistics = []
    for trace in traces:
        statistics_temp = {}
        statistics_temp["case_id"] = trace.attributes["concept:name"]
        statistics_temp["activity_num"] = len(trace)
        earliest_time = min(
            min([act["start_timestamp"] for act in trace]),
            max([act["time:timestamp"] for act in trace]),
        )
        statistics_temp["earliest_time"] = earliest_time.strftime(
            "%Y-%m-%d %H:%M:%S"
        )  # there might not be a start
        latest_time = max([act["time:timestamp"] for act in trace])
        statistics_temp["latest_time"] = latest_time.strftime("%Y-%m-%d %H:%M:%S")
        duration = latest_time - earliest_time
        statistics_temp["total_duration"] = (
            f"{duration.days} days, {duration.seconds // 3600:02}:{(duration.seconds % 3600) // 60:02}:{duration.seconds % 60:02}"
        )
        trace_statistics.append(statistics_temp)

    res = {
        "statistics": trace_statistics,
    }
    return res


@router.post("/caseActivities")
def getCaseActivities(query: caseQuery):
    index = int(query.index)
    id = str(query.caseId)
    traces = cache.variants[index][1]
    case_activities = []
    key_set = set()
    for trace in traces:
        key_set = key_set.union(list(trace[0].keys()))
    for trace in traces:
        if trace.attributes["concept:name"] == id:
            for act in trace:
                activities_temp = {}
                activities_temp["act_id"] = act["concept:name"]
                activities_temp["end_timestamp"] = act["time:timestamp"].strftime(
                    "%Y-%m-%d %H:%M:%S"
                )
                activities_temp["start_timestamp"] = act["start_timestamp"].strftime(
                    "%Y-%m-%d %H:%M:%S"
                )
                duration = act["time:timestamp"] - act["start_timestamp"]
                activities_temp["duration"] = (
                    f"{duration.days} days, {duration.seconds // 3600:02}:{(duration.seconds % 3600) // 60:02}:{duration.seconds % 60:02}"
                )
                activities_temp["property"] = act
                case_activities.append(activities_temp)
            break
    key_set.difference_update(
        {
            "cortado_activity_instance",
            "concept:name",
            "time:timestamp",
            "start_timestamp",
        }
    )
    res = {
        "statistics": case_activities,
        "keys": key_set,
    }
    return res
