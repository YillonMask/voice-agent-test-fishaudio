"""Parallel-per-sentence TTS adapter.

LiveKit's built-in `tts.StreamAdapter` already cuts incoming LLM text into
sentences via a tokenizer and feeds each sentence to `synthesize()`. It does
this serially though — sentence N+1's `synthesize()` only starts after every
audio frame of sentence N has arrived. With a network-bound TTS like
Fish Audio that has a multi-hundred-millisecond first-byte latency per
request, this leaves the second-half of a multi-sentence reply waiting on
the wire instead of preparing in the background.

This adapter is a drop-in replacement that fans out `synthesize()` calls
concurrently as soon as a sentence boundary is detected (capped at
`max_parallel` in-flight requests). Audio frames are still emitted in the
original sentence order — each sentence has its own internal queue, and the
consumer drains them sequentially — so the listener hears no reordering.

Net effect: sentence 2 is being synthesized while sentence 1 is still playing
through the speakers. Time-to-first-audio is unchanged (still bounded by
sentence 1's first chunk); time-to-end-of-utterance drops by roughly the
per-request latency × (N-1) for an N-sentence reply.
"""

from __future__ import annotations

import asyncio
from typing import ClassVar

from livekit.agents import tokenize, utils
from livekit.agents.tts import TTS
from livekit.agents.tts.stream_adapter import StreamAdapter, StreamAdapterWrapper
from livekit.agents.tts.tts import AudioEmitter
from livekit.agents.types import (
    DEFAULT_API_CONNECT_OPTIONS,
    NOT_GIVEN,
    APIConnectOptions,
    NotGivenOr,
)


class ParallelSentenceStreamAdapter(StreamAdapter):
    def __init__(
        self,
        *,
        tts: TTS,
        sentence_tokenizer: NotGivenOr[tokenize.SentenceTokenizer] = NOT_GIVEN,
        max_parallel: int = 4,
    ) -> None:
        super().__init__(tts=tts, sentence_tokenizer=sentence_tokenizer)
        self._max_parallel = max_parallel

    def stream(
        self, *, conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS
    ) -> "_ParallelStreamWrapper":
        return _ParallelStreamWrapper(
            tts=self,
            conn_options=conn_options,
            max_parallel=self._max_parallel,
        )


class _ParallelStreamWrapper(StreamAdapterWrapper):
    _tts_request_span_name: ClassVar[str] = "parallel_sentence_tts_stream"

    def __init__(
        self,
        *,
        tts: ParallelSentenceStreamAdapter,
        conn_options: APIConnectOptions,
        max_parallel: int,
    ) -> None:
        super().__init__(tts=tts, conn_options=conn_options)
        self._sem = asyncio.Semaphore(max_parallel)

    async def _run(self, output_emitter: AudioEmitter) -> None:
        from livekit.agents.voice.io import TimedString

        sent_stream = self._tts._sentence_tokenizer.stream()

        request_id = utils.shortuuid()
        output_emitter.initialize(
            request_id=request_id,
            sample_rate=self._tts.sample_rate,
            num_channels=self._tts.num_channels,
            mime_type="audio/pcm",
            stream=True,
        )
        segment_id = utils.shortuuid()
        output_emitter.start_segment(segment_id=segment_id)

        # FIFO of in-flight (token, frame_queue) pairs. Producer enqueues a
        # pair the moment a sentence boundary is detected and kicks off
        # synthesis in the background; consumer drains pairs in order so
        # audio frames are emitted in original sentence order.
        ordered_q: asyncio.Queue = asyncio.Queue()

        async def _forward_input() -> None:
            async for data in self._input_ch:
                if isinstance(data, self._FlushSentinel):
                    sent_stream.flush()
                    continue
                sent_stream.push_text(data)
            sent_stream.end_input()

        async def _synth_one(text: str, frame_q: asyncio.Queue) -> None:
            try:
                async with self._sem:
                    async with self._tts._wrapped_tts.synthesize(
                        text, conn_options=self._wrapped_tts_conn_options
                    ) as tts_stream:
                        async for audio in tts_stream:
                            await frame_q.put(audio)
            finally:
                await frame_q.put(None)  # sentinel

        async def _producer() -> None:
            try:
                async for ev in sent_stream:
                    if not (text := ev.token.strip()):
                        continue
                    frame_q: asyncio.Queue = asyncio.Queue()
                    asyncio.create_task(_synth_one(text, frame_q))
                    await ordered_q.put((ev.token, frame_q))
            finally:
                await ordered_q.put(None)  # sentinel

        async def _consumer() -> None:
            duration = 0.0
            while True:
                item = await ordered_q.get()
                if item is None:
                    break
                token, frame_q = item
                output_emitter.push_timed_transcript(
                    TimedString(text=token, start_time=duration)
                )
                while True:
                    audio = await frame_q.get()
                    if audio is None:
                        break
                    output_emitter.push(audio.frame.data.tobytes())
                    duration += audio.frame.duration
                output_emitter.flush()

        tasks = [
            asyncio.create_task(_forward_input()),
            asyncio.create_task(_producer()),
            asyncio.create_task(_consumer()),
        ]
        try:
            await asyncio.gather(*tasks)
        finally:
            await sent_stream.aclose()
            await utils.aio.cancel_and_wait(*tasks)
