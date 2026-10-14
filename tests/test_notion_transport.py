"""REST-shaped synthetic service tests, not live Notion/device outage evidence."""

from copy import deepcopy
from dataclasses import asdict, replace
import io
import json
from pathlib import Path
import tempfile
import unittest
from urllib.error import HTTPError
from urllib.parse import urlsplit, parse_qs, unquote

from rpos.bridge_event import BridgeEvent
from rpos.delivery_store import DeliveryStore
from rpos.delivery_worker import DeliveryWorker, DeliveryConflict
from rpos.notion_transport import (API_VERSION, EVIDENCE_PREFIX, NotionHttp, NotionRestPort,
    ReviewedTargets, TransportError, NoRedirect, alias_marker, rich_text, text_of, event_hash)


SOURCE = "00000000-0000-4000-8000-000000000001"
PAGE = "00000000-0000-4000-8000-000000000002"
BLOCK = "00000000-0000-4000-8000-000000000003"
OTHER = "00000000-0000-4000-8000-000000000004"
EDIT = "2026-01-01T01:00:00Z"


def event():
    return BridgeEvent("samsung_health", "synthetic-exercise-a", "2026-01-01T12:00:00.123Z",
                       "exercise", {"custom_title": "Synthetic", "sessions": []})


def review(ev=None):
    ev = ev or event()
    return ReviewedTargets({"schema_version": "rpos.reconciliation.v1", "entries": [{
        "source": ev.source, "uid": ev.source_record_id, "payload_hash": event_hash(ev),
        "target_page_id": PAGE, "expected_last_edited_time": EDIT,
        "expected_source": "fixture_scheduler", "expected_uid": "fixture-capture-a",
        "review_basis": "Synthetic source window and segment sequence reviewed"}]})


class RestService:
    def __init__(self):
        self.page = {"object": "page", "id": PAGE, "parent": {"type": "data_source_id",
                     "data_source_id": SOURCE}, "last_edited_time": EDIT, "properties": {
            "Source": {"id": "source", "type": "rich_text", "rich_text": rich_text("fixture_scheduler")},
            "Source Record ID": {"id": "uid", "type": "rich_text", "rich_text": rich_text("fixture-capture-a")},
            "Notes": {"id": "no%3Ates", "type": "rich_text", "rich_text": rich_text("Manual notes")},
            "Date": {"id": "date", "type": "date", "date": {"start": "2026-01-01"}},
            "Calories kcal": {"type": "number", "number": 123},
            "Capture State": {"type": "select", "select": {"name": "Pending"}},
            "Workout Detail": {"type": "rich_text", "rich_text": rich_text("Keep original manual evidence")}}}
        self.blocks = []
        self.calls = []
        self.writes = 0
        self.fault = None
        self.duplicate = False
        self.schema_wrong = False
        self.paginate_notes = False
        self.alias_results = [PAGE]
        self.nested = None

    def list_response(self, items, cursor=None):
        return {"object": "list", "results": deepcopy(items), "has_more": cursor is not None,
                "next_cursor": cursor}

    def request(self, method, path, payload=None):
        self.calls.append((method, path, deepcopy(payload)))
        uri = urlsplit(path)
        parts = uri.path.strip("/").split("/")
        cursor = parse_qs(uri.query).get("start_cursor", [None])[0]
        if parts == ["data_sources", SOURCE]:
            props = {k: {"type": v} for k, v in {"Session": "title", "Source": "rich_text",
                "Source Record ID": "rich_text", "Notes": "rich_text", "Date": "date"}.items()}
            if self.schema_wrong: props["Notes"] = {"type": "number"}
            return {"id": SOURCE, "properties": props}
        if parts == ["data_sources", SOURCE, "query"]:
            filt = payload["filter"]
            if "and" not in filt:
                return self.list_response([{"object": "page", "id": id} for id in self.alias_results])
            props = self.page["properties"]
            matches = (text_of(props["Source"]["rich_text"]) == filt["and"][0]["rich_text"]["equals"]
                and text_of(props["Source Record ID"]["rich_text"]) == filt["and"][1]["rich_text"]["equals"])
            rows = [{"object": "page", "id": PAGE}] if matches else []
            if self.duplicate and not payload.get("start_cursor"):
                return self.list_response(rows, "second")
            if self.duplicate: rows = [{"object": "page", "id": OTHER}]
            return self.list_response(rows)
        if parts == ["pages", PAGE] and method == "GET":
            return deepcopy(self.page)
        if parts[:3] == ["pages", PAGE, "properties"]:
            prop = next(v for v in self.page["properties"].values() if unquote(v.get("id", "")) == unquote(parts[3]))
            values = prop["rich_text"]
            if self.paginate_notes and parts[3] == "no%3Ates":
                if not cursor: return self.list_response([{"type": "rich_text", "rich_text": values[0]}], "notes-second")
                values = values[1:]
            return self.list_response([{"type": "rich_text", "rich_text": x} for x in values])
        if parts[:1] == ["blocks"] and parts[-1] == "children" and method == "GET":
            if self.nested and parts[1] == PAGE:
                return self.list_response([{"id": OTHER, "type": "toggle", "toggle": {"rich_text": []}, "has_children": True}])
            return self.list_response(self.blocks)
        if parts == ["pages", PAGE] and method == "PATCH":
            self.writes += 1
            for name, value in payload["properties"].items():
                self.page["properties"][name].update(deepcopy(value))
            self.page["last_edited_time"] = "2026-01-01T02:00:00Z"
            return {"id": PAGE}
        if parts[:1] == ["blocks"] and method == "PATCH":
            if self.fault == "before_evidence":
                raise TransportError("Synthetic evidence request not applied")
            self.writes += 1
            if parts[-1] == "children":
                self.blocks.extend([dict(deepcopy(x), id=(BLOCK if not self.blocks else OTHER),
                                         has_children=False) for x in payload["children"]])
            else:
                next(b for b in self.blocks if b["id"] == parts[1])["code"] = deepcopy(payload["code"])
            if self.fault == "after_evidence":
                raise TransportError("Synthetic response lost after applying evidence")
            return {"id": parts[1]}
        raise AssertionError((method, path))


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "receipt.sqlite3"
        self.http = RestService()
        self.port = NotionRestPort(self.http, SOURCE, review())
        self.worker = DeliveryWorker(DeliveryStore(self.path), self.port)

    def test_delivery_preserves_manual_metrics_and_replay_writes_nothing(self):
        before = deepcopy(self.http.page["properties"])
        self.assertEqual(self.worker.deliver(event()), "confirmed")
        for name in ["Calories kcal", "Workout Detail", "Capture State"]:
            self.assertEqual(self.http.page["properties"][name], before[name])
        self.assertIn(alias_marker("fixture_scheduler", "fixture-capture-a"), text_of(self.http.page["properties"]["Notes"]["rich_text"]))
        self.assertEqual(self.http.page["properties"]["Date"]["date"]["start"], event().recorded_at)
        self.assertEqual(self.port.read_page(PAGE).payload_hash, event_hash(event()))
        writes = self.http.writes
        fresh = DeliveryWorker(DeliveryStore(self.path), NotionRestPort(self.http, SOURCE))
        self.assertEqual(fresh.deliver(event()), "confirmed")
        self.assertEqual(self.http.writes, writes)

    def test_lost_response_after_evidence_recovers_without_more_writes(self):
        self.http.fault = "after_evidence"
        with self.assertRaises(TransportError): self.worker.deliver(event())
        self.assertEqual(self.worker.store.stage(event()).state, "attempting")
        self.http.fault = None
        writes = self.http.writes
        fresh = DeliveryWorker(DeliveryStore(self.path), NotionRestPort(self.http, SOURCE))
        self.assertEqual(fresh.resume(), ["confirmed"])
        self.assertEqual(self.http.writes, writes)

    def test_partial_properties_write_remains_unresolved_without_retry(self):
        self.http.fault = "before_evidence"
        with self.assertRaises(TransportError): self.worker.deliver(event())
        self.http.fault = None
        fresh = DeliveryWorker(DeliveryStore(self.path), NotionRestPort(self.http, SOURCE))
        self.assertEqual(fresh.resume(), ["unresolved"])
        self.assertEqual(self.http.writes, 1)
        self.assertEqual(self.worker.store.stage(event()).state, "attempting")

    def test_uid_query_paginates_and_duplicates_block_writes(self):
        self.worker.deliver(event())
        self.http.duplicate = True
        self.assertEqual(self.port.find_uid(*event().dedupe_key), [PAGE, OTHER])
        writes = self.http.writes
        with self.assertRaises(DeliveryConflict): self.worker.deliver(event())
        self.assertEqual(self.http.writes, writes)

    def test_notes_pagination_preserves_mentions_links_and_annotations(self):
        note = {"type": "mention", "mention": {"type": "page", "page": {"id": OTHER}},
                "plain_text": "Referenced page", "href": "https://notion.so/example",
                "annotations": {"bold": True}}
        link = {"type": "text", "text": {"content": "Useful", "link": {"url": "https://example.org"}}}
        self.http.page["properties"]["Notes"]["rich_text"] = [note, link]
        self.http.paginate_notes = True
        self.worker.deliver(event())
        written = self.http.page["properties"]["Notes"]["rich_text"]
        self.assertEqual(written[0]["mention"], note["mention"])
        self.assertEqual(written[0]["annotations"], note["annotations"])
        self.assertNotIn("plain_text", written[0])
        self.assertEqual(written[1], link)
        self.assertTrue(any("start_cursor=notes-second" in path for _, path, _ in self.http.calls))

    def test_stale_review_and_changed_event_block_manual_matching(self):
        self.http.page["last_edited_time"] = "changed"
        with self.assertRaises(DeliveryConflict): self.worker.deliver(event())
        self.assertEqual(self.http.writes, 0)
        self.http.page["last_edited_time"] = EDIT
        self.assertEqual(self.worker.deliver(replace(event(), objective={"sessions": [1]})), "needs_reconciliation")
        self.assertEqual(self.http.writes, 0)

    def test_schema_mismatch_and_cross_source_page_block_writes(self):
        self.http.schema_wrong = True
        with self.assertRaises(DeliveryConflict): self.worker.deliver(event())
        self.http.schema_wrong = False
        self.http.page["parent"]["data_source_id"] = OTHER
        with self.assertRaises(DeliveryConflict): self.worker.deliver(event())
        self.assertEqual(self.http.writes, 0)

    def test_body_traversal_and_hash_tampering_prevent_confirmation(self):
        self.worker.deliver(event())
        self.http.nested = True
        self.assertEqual(self.port.read_page(PAGE).payload_hash, event_hash(event()))
        block = self.http.blocks[0]
        text = text_of(block["code"]["rich_text"])
        value = json.loads(text[len(EVIDENCE_PREFIX):])
        value["event"]["objective"]["custom_title"] = "Tampered"
        block["code"]["rich_text"] = rich_text(EVIDENCE_PREFIX + json.dumps(value))
        with self.assertRaises(DeliveryConflict): self.port.read_page(PAGE)

    def test_alias_lookup_verifies_exact_marker_line(self):
        self.worker.deliver(event())
        self.assertEqual(self.port.find_alias("fixture_scheduler", "fixture-capture-a"), [PAGE])
        notes = self.http.page["properties"]["Notes"]
        notes["rich_text"] = rich_text("prefix" + alias_marker("fixture_scheduler", "fixture-capture-a"))
        self.assertEqual(self.port.find_alias("fixture_scheduler", "fixture-capture-a"), [])

    def test_incomplete_review_cannot_create_a_fitness_page(self):
        worker = DeliveryWorker(DeliveryStore(self.path), NotionRestPort(self.http, SOURCE))
        self.assertEqual(worker.deliver(event()), "needs_reconciliation")
        self.assertEqual(self.http.writes, 0)
        with self.assertRaises(DeliveryConflict): self.port.create_evidence(event(), event_hash(event()))

    def test_duplicate_or_bad_hash_review_is_rejected(self):
        manifest = {"schema_version": "rpos.reconciliation.v1", "entries": list(review()._entries.values()) * 2}
        with self.assertRaises(ValueError): ReviewedTargets(manifest)
        with self.assertRaises(DeliveryConflict): self.port.update_evidence(PAGE, event(), "wrong")
        self.assertEqual(self.http.writes, 0)

    def test_concurrent_notes_edit_is_detected_before_write(self):
        original = self.http.request
        def request(method, path, payload=None):
            result = original(method, path, payload)
            if "/properties/no%3Ates?" in path:
                self.http.page["last_edited_time"] = "concurrent edit"
            return result
        self.http.request = request
        with self.assertRaises(DeliveryConflict): self.worker.deliver(event())
        self.assertEqual(self.http.writes, 0)

    def test_nonterminating_pagination_fails_closed(self):
        original = self.http.request
        def request(method, path, payload=None):
            result = original(method, path, payload)
            if path.endswith("/query"):
                result.update(has_more=True, next_cursor="same-cursor")
            return result
        self.http.request = request
        with self.assertRaises(DeliveryConflict): self.port.find_uid(*event().dedupe_key)
        self.assertEqual(self.http.writes, 0)

    def test_oversized_notes_block_before_mutation(self):
        self.http.page["properties"]["Notes"]["rich_text"] = rich_text("x" * 200_000)
        with self.assertRaises(DeliveryConflict): self.worker.deliver(event())
        self.assertEqual(self.http.writes, 0)

    def test_legacy_readback_and_updated_record_reuse_one_evidence_block(self):
        self.worker.deliver(event())
        self.http.blocks = [{"id": BLOCK, "type": "paragraph", "paragraph": {
            "rich_text": rich_text("Bridge payload SHA256: `" + event_hash(event()) + "`")}}]
        self.assertEqual(self.port.read_page(PAGE).payload_hash, event_hash(event()))
        self.assertEqual(self.worker.deliver(event()), "confirmed")
        changed = replace(event(), objective={"custom_title": "Updated", "sessions": []})
        self.assertEqual(self.worker.deliver(changed), "confirmed")
        newer = replace(changed, objective={"custom_title": "Updated again", "sessions": []})
        self.assertEqual(self.worker.deliver(newer), "confirmed")
        self.assertEqual(len([b for b in self.http.blocks if b["type"] == "code"]), 1)


class HttpTests(unittest.TestCase):
    def test_auth_version_and_redacted_single_attempt_failure(self):
        class Opener:
            calls = 0
            def open(self, request, timeout):
                self.calls += 1
                self.request = request
                raise HTTPError(request.full_url, 503, "sensitive server body", {}, io.BytesIO(b"private data"))
        opener = Opener()
        http = NotionHttp("fixture-token-never-log", opener=opener)
        with self.assertRaises(TransportError) as raised:
            http.request("PATCH", "/pages/" + PAGE, {"properties": {}})
        self.assertEqual(opener.calls, 1)
        self.assertEqual(opener.request.get_header("Notion-version"), API_VERSION)
        self.assertEqual(opener.request.get_header("Authorization"), "Bearer fixture-token-never-log")
        self.assertNotIn("private", str(raised.exception))
        self.assertNotIn("fixture-token", str(raised.exception))

    def test_no_authenticated_redirect_or_oversize_request(self):
        self.assertIsNone(NoRedirect().redirect_request(None, None, 302, "", {}, "https://example.org"))
        class NeverCalled:
            def open(self, *args, **kwargs): raise AssertionError("Network should not be called")
        http = NotionHttp("fixture-token", opener=NeverCalled())
        with self.assertRaises(ValueError): http.request("POST", "//example.org", {})
        with self.assertRaises(ValueError): http.request("PATCH", "/pages/" + PAGE, {"value": "x" * 500_000})


if __name__ == "__main__":
    unittest.main()
