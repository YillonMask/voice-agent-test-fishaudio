"""Programmatically join the LiveKit room and observe what the agent sends.

Hits the portal's token endpoint, connects as a fake debtor participant, and
records every DataReceived frame plus a count of audio tracks subscribed.
Used to verify the conversation_item_added → publish_data pipeline end-to-end
without needing a browser. Times out after `--wait` seconds.

Run with the venv active and startup.sh already running:

    python -m agent.tests.livekit_smoketest --debtor 2 --wait 25
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import time
from dataclasses import dataclass, field

import httpx
from dotenv import load_dotenv
from livekit import rtc

load_dotenv()


@dataclass
class Capture:
    started_at: float
    data_events: list[dict] = field(default_factory=list)
    audio_tracks: int = 0
    participants_seen: set[str] = field(default_factory=set)

    def relative_ms(self) -> int:
        return int((time.perf_counter() - self.started_at) * 1000)


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--debtor", default="2")
    parser.add_argument("--wait", type=float, default=25.0)
    parser.add_argument("--portal", default="http://localhost:47821")
    args = parser.parse_args()

    async with httpx.AsyncClient(timeout=10) as http:
        r = await http.post(
            f"{args.portal}/api/livekit/token",
            json={"debtorId": args.debtor},
        )
        r.raise_for_status()
        body = r.json()
    token, url = body["token"], body["url"]
    print(f"[smoke] minted token, room url={url}")

    capture = Capture(started_at=time.perf_counter())
    room = rtc.Room()

    @room.on("data_received")
    def _on_data(packet: rtc.DataPacket) -> None:
        try:
            payload = json.loads(packet.data.decode("utf-8"))
        except Exception:  # noqa: BLE001
            payload = {"raw": packet.data.decode("utf-8", errors="replace")}
        record = {
            "t_ms": capture.relative_ms(),
            "from": packet.participant.identity if packet.participant else None,
            "payload": payload,
        }
        capture.data_events.append(record)
        print(f"[smoke] data t+{record['t_ms']}ms from={record['from']!r} {record['payload']}")

    @room.on("track_subscribed")
    def _on_track(track: rtc.Track, _pub, participant: rtc.RemoteParticipant) -> None:
        if track.kind == rtc.TrackKind.KIND_AUDIO:
            capture.audio_tracks += 1
            print(
                f"[smoke] audio track #{capture.audio_tracks} from {participant.identity!r} "
                f"(sid={track.sid}) at t+{capture.relative_ms()}ms"
            )

    @room.on("participant_connected")
    def _on_join(p: rtc.RemoteParticipant) -> None:
        capture.participants_seen.add(p.identity)
        print(f"[smoke] participant joined: {p.identity!r} at t+{capture.relative_ms()}ms")

    await room.connect(url, token)
    print(f"[smoke] connected as {room.local_participant.identity!r}; waiting {args.wait}s ...")
    # Note: we do NOT publish a microphone — the agent should still greet first.
    await asyncio.sleep(args.wait)
    await room.disconnect()

    print(
        f"\n[smoke] summary: data_events={len(capture.data_events)} "
        f"audio_tracks_subscribed={capture.audio_tracks} "
        f"participants_seen={sorted(capture.participants_seen)}"
    )
    transcripts = [e for e in capture.data_events if e["payload"].get("type") == "transcript"]
    print(f"[smoke] transcript events: {len(transcripts)}")
    for ev in transcripts:
        print(f"  - role={ev['payload'].get('role')!r}: {ev['payload'].get('text')!r}")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
