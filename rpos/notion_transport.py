"""Notion REST adapter for the existing Fitness source; never deploys a runner.

Credentials are supplied by the approved host, never by the Android app. All
HTTP calls are single attempts. DeliveryWorker retains uncertain write intent.
"""

from copy import deepcopy
from dataclasses import asdict
import hashlib
import json
import re
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urlencode
from urllib.request import Request, HTTPRedirectHandler, build_opener
from uuid import UUID

from rpos.bridge_event import BridgeEvent
from rpos.delivery_worker import DeliveryConflict, PageReadback, Reconciliation


API_VERSION = "2026-03-11"
EVIDENCE_PREFIX = "rpos.notion.evidence.v1\n"


def canonical_event(event):
    return json.dumps(asdict(event), sort_keys=True, separators=(",", ":"), allow_nan=False)


def event_hash(event):
    return hashlib.sha256(canonical_event(event).encode()).hexdigest()


def alias_marker(source, uid):
    key = json.dumps([source, uid], separators=(",", ":"), ensure_ascii=True)
    return "rpos.alias.v1:" + hashlib.sha256(key.encode()).hexdigest()


def identifier(value):
    return str(UUID(value))


class TransportError(RuntimeError):
    """Only a bounded status reaches logs; no response bodies or credentials."""


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args):
        return None


class NotionHttp:
    def __init__(self, token, *, opener=None, timeout=30):
        if not isinstance(token, str) or not token.strip() or "\n" in token or "\r" in token:
            raise ValueError("A host-managed Notion token is required")
        if not 0 < timeout <= 60:
            raise ValueError("HTTP timeout must be between zero and 60 seconds")
        self._token = token
        self._opener = opener or build_opener(NoRedirect())
        self.timeout = timeout

    def request(self, method, path, payload=None):
        # A fixed origin prevents credential forwarding to configurable hosts.
        if not path.startswith("/") or "//" in path or "#" in path:
            raise ValueError("Invalid Notion endpoint")
        data = None if payload is None else json.dumps(payload, allow_nan=False).encode()
        if data is not None and len(data) > 500_000:
            raise ValueError("Notion request is too large; nothing was sent")
        request = Request("https://api.notion.com/v1" + path, data=data, method=method,
                          headers={"Authorization": "Bearer " + self._token,
                                   "Notion-Version": API_VERSION,
                                   "Content-Type": "application/json"})
        try:
            with self._opener.open(request, timeout=self.timeout) as response:
                raw = response.read(8_000_001)
            if len(raw) > 8_000_000:
                raise TransportError("Notion response exceeded the read limit")
            value = json.loads(raw)
            if not isinstance(value, dict):
                raise TransportError("Invalid Notion response shape")
            return value
        except HTTPError as error:
            # No automatic retry, even for 429/5xx or a write redirect.
            raise TransportError(f"Notion HTTP {error.code}; preserve receipt") from None
        except (URLError, TimeoutError, OSError):
            raise TransportError("Notion transport failed; preserve receipt") from None
        except (ValueError, UnicodeError):
            raise TransportError("Invalid Notion JSON response; preserve receipt") from None


def rich_text(value):
    return [{"type": "text", "text": {"content": value[i:i + 2000]}}
            for i in range(0, len(value), 2000)]


def text_of(items):
    result = []
    for item in items:
        if item.get("type") == "text":
            result.append(item.get("text", {}).get("content", ""))
        else:
            result.append(item.get("plain_text", ""))
    return "".join(result)


def writable_rich_text(items):
    """Retain formatting/links/mentions, removing only response-only fields."""
    result = []
    for item in items:
        kind = item.get("type")
        if kind not in {"text", "mention", "equation"} or kind not in item:
            raise DeliveryConflict("Unsupported rich text; preserve original Notes")
        clean = {"type": kind, kind: deepcopy(item[kind])}
        if "annotations" in item:
            clean["annotations"] = deepcopy(item["annotations"])
        result.append(clean)
    return result


class ReviewedTargets:
    """Private event-hash-bound review, not automatic date/title matching."""
    def __init__(self, manifest=None):
        self._entries = {}
        if manifest is None:
            return
        if manifest.get("schema_version") != "rpos.reconciliation.v1":
            raise ValueError("Unsupported private reconciliation manifest")
        for item in manifest.get("entries", []):
            required = {"source", "uid", "payload_hash", "target_page_id",
                        "expected_last_edited_time", "expected_source", "expected_uid",
                        "review_basis"}
            if not required <= item.keys() or not item["review_basis"].strip():
                raise ValueError("Complete source-window/sequence review is required")
            key = (item["source"], item["uid"], item["payload_hash"])
            if key in self._entries:
                raise ValueError("Duplicate review entry")
            clean = dict(item, target_page_id=identifier(item["target_page_id"]))
            if not clean["expected_last_edited_time"]:
                raise ValueError("Review must retain target edit time")
            self._entries[key] = clean

    def get(self, event):
        return self._entries.get((*event.dedupe_key, event_hash(event)))


class NotionRestPort:
    """Updates reviewed existing Fitness pages only; never creates a session.

    The durable coordinator and this port must share one approved receipt DB.
    An empty UID query without a reviewed target returns needs_reconciliation.
    """
    def __init__(self, http, data_source_id, reviews=None):
        self.http = http
        self.data_source_id = identifier(data_source_id)
        self.reviews = reviews or ReviewedTargets()
        self._schema_checked = False

    def validate_schema(self):
        source = self.http.request("GET", "/data_sources/" + self.data_source_id)
        if identifier(source.get("id", "")) != self.data_source_id:
            raise DeliveryConflict("Wrong Fitness data source")
        properties = source.get("properties", {})
        for name, kind in {"Session": "title", "Source": "rich_text",
                           "Source Record ID": "rich_text", "Date": "date",
                           "Notes": "rich_text"}.items():
            if properties.get(name, {}).get("type") != kind:
                raise DeliveryConflict("Existing Fitness schema does not match the adapter")
        self._schema_checked = True

    def _ensure_schema(self):
        if not self._schema_checked:
            self.validate_schema()

    def _list(self, method, path, payload=None):
        seen = set()
        cursor = None
        while True:
            query = {"page_size": 100}
            if cursor:
                query["start_cursor"] = cursor
            if method == "GET":
                response = self.http.request(method, path + "?" + urlencode(query))
            else:
                response = self.http.request(method, path, {**(payload or {}), **query})
            if response.get("object") != "list" or not isinstance(response.get("results"), list):
                raise DeliveryConflict("Incomplete Notion list response")
            yield from response["results"]
            if response.get("has_more") is False:
                return
            cursor = response.get("next_cursor")
            if not isinstance(cursor, str) or not cursor or cursor in seen:
                raise DeliveryConflict("Notion pagination did not complete")
            seen.add(cursor)

    def _query(self, filter):
        self._ensure_schema()
        pages = list(self._list("POST", "/data_sources/" + self.data_source_id + "/query",
                                {"filter": filter}))
        if any(page.get("object") != "page" for page in pages):
            raise DeliveryConflict("Query returned a non-page result")
        return [identifier(page["id"]) for page in pages]

    def find_uid(self, source, uid):
        return self._query({"and": [
            {"property": "Source", "rich_text": {"equals": source}},
            {"property": "Source Record ID", "rich_text": {"equals": uid}}]})

    def find_alias(self, source, uid):
        """Exact archived-token lookup for a future scheduler binding."""
        marker = alias_marker(source, uid)
        candidates = self._query({"property": "Notes", "rich_text": {"contains": marker}})
        verified = []
        for page_id in candidates:
            page = self._page(page_id)
            lines = text_of(self._property(page, "Notes")).splitlines()
            if marker in lines:
                verified.append(page_id)
        return verified

    def _page(self, page_id):
        self._ensure_schema()
        page_id = identifier(page_id)
        page = self.http.request("GET", "/pages/" + page_id)
        parent = page.get("parent", {})
        if (page.get("object") != "page" or identifier(page.get("id", "")) != page_id
                or parent.get("type") != "data_source_id"
                or identifier(parent.get("data_source_id", "")) != self.data_source_id
                or page.get("archived") or page.get("is_archived") or page.get("in_trash")):
            raise DeliveryConflict("Target is not an active page in the approved Fitness source")
        return page

    def _property(self, page, name):
        prop = page["properties"][name]
        if prop.get("type") != "rich_text":
            raise DeliveryConflict("Expected an existing rich-text property")
        # Always read all property items; the page response can be truncated.
        path = "/pages/" + identifier(page["id"]) + "/properties/" + quote(unquote(prop["id"]), safe="")
        items = list(self._list("GET", path))
        if any(item.get("type") != "rich_text" for item in items):
            raise DeliveryConflict("Unexpected rich-text property item")
        return [item["rich_text"] for item in items]

    def _identity(self, page):
        return text_of(self._property(page, "Source")), text_of(self._property(page, "Source Record ID"))

    def _blocks(self, page_id):
        pending = [(identifier(page_id), 0)]
        seen = set()
        result = []
        while pending:
            parent, depth = pending.pop()
            if parent in seen or depth > 30 or len(result) > 10_000:
                raise DeliveryConflict("Evidence block traversal did not complete")
            seen.add(parent)
            children = list(self._list("GET", "/blocks/" + parent + "/children"))
            result.extend(children)
            for block in reversed(children):
                if block.get("has_children"):
                    pending.append((identifier(block["id"]), depth + 1))
        return result

    def _evidence(self, page_id):
        managed = []
        legacy = set()
        for block in self._blocks(page_id):
            kind = block.get("type")
            text = text_of(block.get(kind, {}).get("rich_text", []))
            if kind == "code" and text.startswith(EVIDENCE_PREFIX):
                try:
                    value = json.loads(text[len(EVIDENCE_PREFIX):])
                    event = BridgeEvent(**value["event"])
                    if value["payload_hash"] != event_hash(event):
                        raise ValueError("hash mismatch")
                except (KeyError, TypeError, ValueError):
                    raise DeliveryConflict("Persisted Bridge evidence is invalid") from None
                managed.append((identifier(block["id"]), value))
            legacy.update(re.findall(r"Bridge payload SHA256:\s*`?([0-9a-f]{64})", text))
        if len(managed) > 1 or (not managed and len(legacy) > 1):
            raise DeliveryConflict("Conflicting Bridge evidence blocks")
        return (managed[0] if managed else (None, None)), (next(iter(legacy)) if legacy else None)

    def read_page(self, page_id):
        page = self._page(page_id)
        source, uid = self._identity(page)
        (_, evidence), legacy = self._evidence(page_id)
        if evidence:
            event = BridgeEvent(**evidence["event"])
            if event.dedupe_key != (source, uid):
                raise DeliveryConflict("Evidence and canonical page identity disagree")
        return PageReadback(identifier(page_id), source, uid,
                            evidence["payload_hash"] if evidence else legacy)

    def reconcile(self, event):
        review = self.reviews.get(event)
        if not review:
            return Reconciliation(False)
        page = self._page(review["target_page_id"])
        if (page.get("last_edited_time") != review["expected_last_edited_time"]
                or self._identity(page) != (review["expected_source"], review["expected_uid"])):
            raise DeliveryConflict("Reviewed target changed; review it again")
        return Reconciliation(True, review["target_page_id"])

    def update_evidence(self, page_id, event, payload_hash):
        if payload_hash != event_hash(event):
            raise DeliveryConflict("Write hash does not match the event")
        page = self._page(page_id)
        prior_source, prior_uid = self._identity(page)
        if prior_source == event.source and prior_uid != event.source_record_id:
            raise DeliveryConflict("Cannot replace another Samsung UID")
        if (prior_source, prior_uid) != event.dedupe_key:
            review = self.reviews.get(event)
            if not review or review["target_page_id"] != identifier(page_id):
                raise DeliveryConflict("Manual target needs its event-bound review")
            if (page.get("last_edited_time") != review["expected_last_edited_time"]
                    or (prior_source, prior_uid) != (review["expected_source"], review["expected_uid"])):
                raise DeliveryConflict("Reviewed target changed before writing")
        (block_id, previous), _ = self._evidence(page_id)
        aliases = deepcopy(previous.get("aliases", [])) if previous else []
        notes = self._property(page, "Notes")
        properties = {"Source": {"rich_text": rich_text(event.source)},
                      "Source Record ID": {"rich_text": rich_text(event.source_record_id)},
                      "Date": {"date": {"start": event.recorded_at}}}
        if prior_uid and (prior_source, prior_uid) != event.dedupe_key:
            prior = {"source": prior_source, "uid": prior_uid,
                     "date": deepcopy(page["properties"]["Date"].get("date"))}
            if prior not in aliases:
                aliases.append(prior)
            marker = alias_marker(prior_source, prior_uid)
            if marker not in text_of(notes).splitlines():
                notes = writable_rich_text(notes) + rich_text("\n" + marker + "\n" +
                    json.dumps(prior, ensure_ascii=False, separators=(",", ":")))
                properties["Notes"] = {"rich_text": notes}
        evidence = {"event": asdict(event), "payload_hash": payload_hash, "aliases": aliases}
        code = {"rich_text": rich_text(EVIDENCE_PREFIX + json.dumps(evidence, sort_keys=True,
                separators=(",", ":"), allow_nan=False)), "language": "json"}
        # Validate both writes before sending the first; never truncate evidence.
        if len(code["rich_text"]) > 100 or len(notes) > 100:
            raise DeliveryConflict("Evidence/Notes exceed Notion limits; preserve originals")
        fresh = self._page(page_id)
        if (fresh.get("last_edited_time") != page.get("last_edited_time")
                or self._identity(fresh) != (prior_source, prior_uid)):
            raise DeliveryConflict("Target changed while preparing evidence; review it again")
        result = self.http.request("PATCH", "/pages/" + identifier(page_id), {"properties": properties})
        if identifier(result.get("id", "")) != identifier(page_id):
            raise DeliveryConflict("Update returned a different target")
        if block_id:
            self.http.request("PATCH", "/blocks/" + block_id, {"code": code})
        else:
            self.http.request("PATCH", "/blocks/" + identifier(page_id) + "/children",
                              {"children": [{"object": "block", "type": "code", "code": code}]})
        return identifier(page_id)

    def create_evidence(self, event, payload_hash):
        raise DeliveryConflict("This reviewed adapter only reuses existing Fitness pages")
