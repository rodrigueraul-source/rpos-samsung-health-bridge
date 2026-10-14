"""Delivery coordinator for the existing evidence runner; no embedded credentials.

The runner supplies a NotionPort backed by its existing authenticated transport.
This module does not deploy a scheduler or add another Fitness ingestion path.
"""

from contextlib import contextmanager
from dataclasses import dataclass
import fcntl
import os
from typing import Protocol

from rpos.bridge_event import BridgeEvent
from rpos.delivery_store import DeliveryStore, StagedDelivery


@dataclass(frozen=True)
class PageReadback:
    page_id: str
    source: str
    uid: str
    payload_hash: str | None


@dataclass(frozen=True)
class Reconciliation:
    """Runner-reviewed source window/sequence match, never date-only matching.

    target_page_id=None means the existing evidence path was checked and no
    manual/Drive workout matches. Ambiguity or an incomplete check forbids writes.
    """
    evidence_checked: bool
    target_page_id: str | None = None
    ambiguous: bool = False


class NotionPort(Protocol):
    def find_uid(self, source: str, uid: str) -> list[str]:
        """Return ALL exact Source+UID matches, including all query pages."""
        ...

    def reconcile(self, event: BridgeEvent) -> Reconciliation: ...

    def update_evidence(self, page_id: str, event: BridgeEvent, payload_hash: str) -> str:
        """Archive prior aliases; preserve manual metrics, Notes and Gym V4.

        Write source/UID/date and versioned objective evidence + payload hash
        to the existing page. The hash belongs to evidence, not a new DB schema.
        """
        ...

    def create_evidence(self, event: BridgeEvent, payload_hash: str) -> str: ...

    def read_page(self, page_id: str) -> PageReadback:
        """Read actual remote identity and persisted evidence hash."""
        ...


class DeliveryConflict(ValueError): pass


class DeliveryBusy(RuntimeError): pass


class DeliveryWorker:
    """Serialize one local receipt DB and fail closed on uncertain writes.

    All workers for the destination must use this same DB/lock. The lock does
    not coordinate separate machines, DBs or external Notion writers.
    """
    def __init__(self, store: DeliveryStore, remote: NotionPort):
        self.store = store
        self.remote = remote

    @contextmanager
    def _exclusive(self):
        fd = os.open(self.store.path + ".worker.lock", os.O_CREAT | os.O_RDWR, 0o600)
        try:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise DeliveryBusy("Another worker owns this receipt DB") from error
            yield
        finally:
            os.close(fd)

    def deliver(self, event: BridgeEvent) -> str:
        with self._exclusive():
            return self._deliver(event)

    def resume(self) -> list[str]:
        with self._exclusive():
            return [self._deliver(event) for event in self.store.outstanding()]

    def _verify(self, delivery: StagedDelivery, page_id: str) -> bool:
        page = self.remote.read_page(page_id)
        if (page.page_id, page.source, page.uid) != (page_id, delivery.source, delivery.uid):
            raise DeliveryConflict("Remote readback does not match the original source/UID")
        if page.payload_hash != delivery.payload_hash:
            return False
        if self.remote.find_uid(delivery.source, delivery.uid) != [page_id]:
            raise DeliveryConflict("Remote uniqueness changed during readback")
        self.store.confirm_readback(delivery, notion_page_id=page_id,
                                    observed_source=page.source, observed_uid=page.uid)
        return True

    def _deliver(self, event: BridgeEvent) -> str:
        delivery = self.store.stage(event)
        matches = self.remote.find_uid(delivery.source, delivery.uid)
        if len(matches) > 1:
            raise DeliveryConflict("Multiple remote pages match this source/UID")
        target = matches[0] if matches else None
        if target and delivery.notion_page_id and target != delivery.notion_page_id:
            raise DeliveryConflict("Remote UID points to a different reconciled page")
        if target and self._verify(delivery, target):
            return "confirmed"

        # A timeout, exception or process crash might have applied the write.
        # An empty query or a different hash is NOT proof that it did not apply.
        if delivery.state == "attempting":
            return "unresolved"
        if delivery.state == "confirmed":
            raise DeliveryConflict("Previously confirmed remote evidence changed or disappeared")

        if not target:
            if delivery.notion_page_id:
                raise DeliveryConflict("Reconciled target no longer has the expected UID")
            resolution = self.remote.reconcile(event)
            if not resolution.evidence_checked or resolution.ambiguous:
                return "needs_reconciliation"
            target = resolution.target_page_id
            if target:
                prior = self.remote.read_page(target)
                if prior.page_id != target or (prior.source == delivery.source and prior.uid != delivery.uid):
                    raise DeliveryConflict("Manual reconciliation targets another Samsung UID")

        kind = "update" if target else "create"
        self.store.begin_attempt(delivery, kind=kind, notion_page_id=target)
        page_id = (self.remote.update_evidence(target, event, delivery.payload_hash) if target
                   else self.remote.create_evidence(event, delivery.payload_hash))
        self.store.retain_attempt_target(delivery, page_id)
        if not self._verify(delivery, page_id):
            return "unresolved"
        return "confirmed"
